import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { loadConfig, type StudioConfig } from '../config/load.js'
import { createMockAdapter } from './mock.js'
import { createHiggsfieldAdapter, mapInput } from './higgsfield.js'
import { withModelOverrides } from './modelOverrides.js'
import { ProviderError, type GenRequest, type ProviderAdapter } from './types.js'
import { renderPlaceholderPortrait } from './mock.js'

// Every adapter must pass this contract. CI runs it against the mock and
// against the Higgsfield adapter talking to a fake in-process API. Real
// providers are only exercised by hand, after a quote is approved.

const config = loadConfig()

function verifiedConfig(): StudioConfig {
  const c = structuredClone(config)
  for (const m of c.models.models) {
    // Endpoints as config/models.yaml has them from the official reference;
    // only the paid-test confirmation is faked.
    if (m.ref === 'higgsfield/gpt-image-2.5' || m.ref === 'higgsfield/seedance-2.0') m.verified = true
  }
  return c
}

interface FakeCall { method: string; url: string; headers: Record<string, string>; body?: unknown }

function fakeHiggsfield(behavior: { submitStatus?: number; submitDetail?: string; finalStatus?: 'completed' | 'failed' | 'nsfw' | 'canceled'; submitDelayMs?: number; emptyCompleted?: boolean } = {}) {
  const calls: FakeCall[] = []
  const reqs = new Map<string, number>()
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    // Higgsfield's presigned storage: bytes, no API credentials.
    if (url.startsWith('https://upload.higgsfield.test/')) {
      calls.push({ method: init?.method ?? 'GET', url, headers, body: { bytes: (init?.body as Uint8Array).byteLength } })
      return new Response(null, { status: init?.method === 'PUT' ? 200 : 405 })
    }
    calls.push({ method: init?.method ?? 'GET', url, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (headers.Authorization !== 'Key kid_123:ksecret_456') return json(401, { detail: 'Invalid API credentials' })
    if (url.endsWith('/files/generate-upload-url')) {
      const n = calls.filter(c => c.url.endsWith('/files/generate-upload-url')).length
      return json(200, { upload_url: `https://upload.higgsfield.test/slot-${n}?sig=x`, public_url: `https://cdn.higgsfield.ai/uploads/slot-${n}.png` })
    }
    const status = url.match(/\/requests\/([^/]+)\/status$/)
    if (status) {
      const id = decodeURIComponent(status[1]!)
      if (!reqs.has(id)) return json(404, { detail: 'not found' })
      const n = (reqs.get(id) ?? 0) + 1
      reqs.set(id, n)
      if (n === 1) return json(200, { status: 'queued', request_id: id })
      if (n === 2) return json(200, { status: 'in_progress', request_id: id })
      const fin = behavior.finalStatus ?? 'completed'
      return json(200, { status: fin, request_id: id, images: fin === 'completed' && !behavior.emptyCompleted ? [{ url: 'https://cdn.higgsfield.ai/out/1.png' }] : undefined })
    }
    if (init?.method === 'POST' && url.includes('/cancel')) return json(200, { status: 'canceled', request_id: 'x' })
    if (init?.method === 'POST') {
      if (behavior.submitDelayMs) await new Promise(r => setTimeout(r, behavior.submitDelayMs))
      if (behavior.submitStatus) return json(behavior.submitStatus, { detail: behavior.submitDetail ?? 'nope' })
      const id = `req-${reqs.size + 1}`
      reqs.set(id, 0)
      return json(200, { status: 'queued', request_id: id, status_url: `https://api.higgsfield.ai/requests/${id}/status`, cancel_url: `https://api.higgsfield.ai/requests/${id}/cancel` })
    }
    return json(404, {})
  }) as typeof fetch
  return { fetchImpl, calls }
}

// The official SDK submits over HTTP (axios), so a local bridge serves the
// fake API to it. Calls are recorded as if made to api.higgsfield.ai.
const servers: Server[] = []
afterAll(() => { for (const s of servers) s.close() })

async function bridge(fetchImpl: typeof fetch): Promise<string> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length ? Buffer.concat(chunks).toString() : undefined
    const headers: Record<string, string> = { Authorization: String(req.headers.authorization ?? ''), 'Content-Type': String(req.headers['content-type'] ?? '') }
    if (req.headers['idempotency-key']) headers['Idempotency-Key'] = String(req.headers['idempotency-key'])
    try {
      const r = await fetchImpl(`https://api.higgsfield.ai${req.url}`, { method: req.method, headers, body })
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' })
      res.end(await r.text())
    } catch { res.destroy() }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  servers.push(server)
  const addr = server.address() as { port: number }
  return `http://127.0.0.1:${addr.port}`
}

// An adapter whose SDK submits through the bridge and whose status, cancel
// and upload calls go straight to the fake.
async function hf(fake: ReturnType<typeof fakeHiggsfield>, c: StudioConfig = verifiedConfig(), credentials = 'kid_123:ksecret_456', timeoutMs?: number) {
  return createHiggsfieldAdapter({ credentials, config: c, fetchImpl: fake.fetchImpl, baseUrl: await bridge(fake.fetchImpl), timeoutMs })
}

async function contract(name: string, make: () => ProviderAdapter, req: GenRequest) {
  describe(`provider contract: ${name}`, () => {
    it('lists models and estimates a positive price', async () => {
      const a = make()
      expect((await a.listModels()).length).toBeGreaterThan(0)
      const est = await a.estimate(req)
      expect(est.totalMicros).toBeGreaterThan(0)
      expect(est.lines.length).toBeGreaterThan(0)
    })

    it('submits, reports progress, and returns outputs', async () => {
      const a = make()
      const { jobId } = await a.submit(req, { idempotencyKey: 'k1' })
      const seen: string[] = []
      for (let i = 0; i < 10; i++) {
        const st = await a.status(jobId)
        seen.push(st.state)
        if (st.state === 'succeeded') break
      }
      expect(seen.at(-1)).toBe('succeeded')
      expect(seen[0]).toMatch(/queued|running/)
      const outputs = await a.result(jobId)
      expect(outputs.length).toBeGreaterThan(0)
      expect(outputs[0]!.url).toBeTruthy()
    })

    it('takes video with audio on when a request asks for it (default rule video-audio-off)', async () => {
      const a = make()
      const model = req.model.startsWith('mock/') ? 'mock/video' : 'higgsfield/seedance-2.0'
      const withAudio: GenRequest = { kind: 'video', model, prompt: 'x', audio: true, durationSec: 5, startFrame: { assetId: 's', url: 'https://r2.example.com/s.png' } }
      await expect(a.submit(withAudio, { idempotencyKey: 'k2' })).resolves.toMatchObject({ jobId: expect.any(String) })
    })
  })
}

const portrait = await renderPlaceholderPortrait('contract')
await contract('mock', () => createMockAdapter({ config, loadAsset: async () => portrait }),
  { kind: 'image', model: 'mock/image', prompt: 'portrait', aspect: '3:4', resolution: '2k', quality: 'high' })

const contractFake = fakeHiggsfield()
const contractBase = await bridge(contractFake.fetchImpl)
await contract('higgsfield (fake API, official SDK)', () => createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: verifiedConfig(), fetchImpl: contractFake.fetchImpl, baseUrl: contractBase }),
  { kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'portrait', aspect: '3:4', resolution: '2k', quality: 'high' })

describe('higgsfield adapter specifics', () => {
  it('sends the documented auth header, endpoint and webhook parameter', async () => {
    const fake = fakeHiggsfield()
    const a = await hf(fake)
    await a.submit({ kind: 'image_edit', model: 'higgsfield/gpt-image-2.5', prompt: 'p', aspect: '3:4', resolution: '2k', quality: 'high', refs: [{ assetId: 'a1', url: 'https://r2.example.com/a1.png' }] },
      { idempotencyKey: 'qte_1:0', webhookUrl: 'https://studio.example.com/api/v1/webhooks/higgsfield/job_1?t=abc' })
    const call = fake.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.headers.Authorization).toBe('Key kid_123:ksecret_456')
    // The job's own key, so a repeated submit never starts a second generation.
    expect(call.headers['Idempotency-Key']).toBe('qte_1:0')
    expect(call.url).toBe('https://api.higgsfield.ai/marketing-studio/image/sunburst?hf_webhook=' + encodeURIComponent('https://studio.example.com/api/v1/webhooks/higgsfield/job_1?t=abc'))
    // Marketing Studio Image schema: plain reference URLs, enhancement off.
    expect(call.body).toEqual({ prompt: 'p', image_urls: ['https://r2.example.com/a1.png'], aspect_ratio: '3:4', resolution: '2k', quality: 'high', enhance_prompt: false })
  })

  it('sends each video model exactly the fields its official schema takes', () => {
    const c = verifiedConfig()
    const entry = (ref: string) => c.models.models.find(m => m.ref === ref)!
    const start = { assetId: 's', url: 'https://r2.example.com/s.png' }, end = { assetId: 'e', url: 'https://r2.example.com/e.png' }
    const base = { kind: 'video' as const, prompt: 'p', startFrame: start, endFrame: end, durationSec: 5, resolution: '720p', aspect: '9:16', audio: false as const, seed: 7 }
    // Seedance 2.5: framing follows the start frame; no seed or aspect field; audio defaults to on, so off.
    expect(mapInput(entry('higgsfield/seedance-2.5'), { ...base, model: 'higgsfield/seedance-2.5' }))
      .toEqual({ prompt: 'p', image_url: start.url, end_image_url: end.url, duration: 5, resolution: '720p', generate_audio: false })
    // Kling 3.0 Turbo: no sound, last-frame or elements field.
    expect(mapInput(entry('higgsfield/kling-3.0-turbo'), { ...base, model: 'higgsfield/kling-3.0-turbo' }))
      .toEqual({ prompt: 'p', image_url: start.url, duration: 5, resolution: '720p' })
    // Kling 3.0 Standard: sound defaults to on, so off; last frame allowed.
    expect(mapInput(entry('higgsfield/kling-3.0-standard'), { ...base, model: 'higgsfield/kling-3.0-standard' }))
      .toEqual({ prompt: 'p', image_url: start.url, last_image_url: end.url, duration: 5, sound: 'off' })
    // Wan 3.0 Prime: audio and the model's own prompt rewriting off.
    expect(mapInput(entry('higgsfield/wan-3.0'), { ...base, model: 'higgsfield/wan-3.0' }))
      .toEqual({ prompt: 'p', image_url: start.url, end_image_url: end.url, duration: 5, resolution: '720p', aspect_ratio: '9:16', seed: 7, generate_audio: false, enable_thinking: false })
    // Soul 2: one image, prompt enhancement off.
    expect(mapInput(entry('higgsfield/soul-2'), { kind: 'image', model: 'higgsfield/soul-2', prompt: 'p', aspect: '3:4', resolution: '1080p' }))
      .toEqual({ prompt: 'p', aspect_ratio: '3:4', resolution: '1080p', batch_size: 1, enhance_prompt: false })
  })

  it('refuses a model the API does not offer, pointing to the account path', async () => {
    const a = await hf(fakeHiggsfield())
    await expect(a.submit({ kind: 'image', model: 'higgsfield/nano-banana-2.1', prompt: 'p', modelTest: true }, { idempotencyKey: 'k' }))
      .rejects.toThrow(/not on the Higgsfield API/)
  })

  it('refuses only a model with no endpoint; an untested one runs (default rule model-tested)', async () => {
    const noEndpoint = { ...config, models: { ...config.models, models: config.models.models.map(m => (m.ref === 'higgsfield/gpt-image-2.5' ? { ...m, endpoint: null } : m)) } } as typeof config
    await expect((await hf(fakeHiggsfield(), noEndpoint)).submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ opts: { code: 'unverified_model', submitted: 'no' } })
    await expect((await hf(fakeHiggsfield(), config)).submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' }))
      .resolves.toMatchObject({ jobId: expect.any(String) })
  })

  it('sends audio off for video unless the request asks for it', () => {
    const entry = verifiedConfig().models.models.find(m => m.ref === 'higgsfield/seedance-2.0')!
    const frame = { assetId: 's', url: 'https://r2.example.com/s.png' }
    expect(mapInput(entry, { kind: 'video', model: entry.ref, prompt: 'p', startFrame: frame, durationSec: 5, audio: false }).generate_audio).toBe(false)
    expect(mapInput(entry, { kind: 'video', model: entry.ref, prompt: 'p', startFrame: frame, durationSec: 5 }).generate_audio).toBe(false)
    expect(mapInput(entry, { kind: 'video', model: entry.ref, prompt: 'p', startFrame: frame, durationSec: 5, audio: true }).generate_audio).toBe(true)
  })

  it('classifies errors so the runner never double-charges', async () => {
    const cases: Array<[number, { retryable: boolean; submitted: string }]> = [
      [401, { retryable: false, submitted: 'no' }],
      [403, { retryable: false, submitted: 'no' }],
      [422, { retryable: false, submitted: 'no' }],
      [423, { retryable: true, submitted: 'no' }],
      [503, { retryable: true, submitted: 'no' }],
      [500, { retryable: false, submitted: 'unknown' }],
    ]
    for (const [status, expected] of cases) {
      const a = await hf(fakeHiggsfield({ submitStatus: status }))
      await expect(a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' })).rejects.toMatchObject({ opts: expected })
    }
  })

  it('treats a reused idempotency key as an earlier accepted job, not a new one', async () => {
    const a = await hf(fakeHiggsfield({ submitStatus: 422, submitDetail: 'Idempotency-Key was already used with different request parameters' }))
    await expect(a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ opts: { submitted: 'unknown', retryable: false }, message: expect.stringMatching(/already accepted this job/) })
  })

  it('maps nsfw and failed results, and verifies keys for free', async () => {
    const a = await hf(fakeHiggsfield({ finalStatus: 'nsfw' }))
    const { jobId } = await a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' })
    await a.status(jobId); await a.status(jobId)
    expect((await a.status(jobId)).state).toBe('nsfw')
    expect((await a.verifyCredentials!()).ok).toBe(true)
    const bad = await hf(fakeHiggsfield(), verifiedConfig(), 'wrong:creds')
    expect((await bad.verifyCredentials!()).ok).toBe(false)
  })

  it('runs a model before and after its paid test; the test flag never reaches Higgsfield', async () => {
    const ref = 'higgsfield/gpt-image-2.5-flare'
    const path = 'marketing-studio/image/flare'
    const fake = fakeHiggsfield()
    const pending = await hf(fake, config)
    await expect(pending.submit({ kind: 'image', model: ref, prompt: 'p' }, { idempotencyKey: 'k1' })).resolves.toMatchObject({ jobId: expect.any(String) })
    await pending.submit({ kind: 'image', model: ref, prompt: 'p', resolution: '1k', modelTest: true }, { idempotencyKey: 'k2' })
    expect(fake.calls.at(-1)!.url).toBe(`https://api.higgsfield.ai/${path}`)
    // The test flag never reaches the provider.
    expect(fake.calls.at(-1)!.body).toEqual({ prompt: 'p', resolution: '1k', enhance_prompt: false })
    const confirmed = await hf(fake, withModelOverrides(config, { [ref]: { confirmedAt: '2026-10-12T12:00:00Z' } }))
    await expect(confirmed.submit({ kind: 'image', model: ref, prompt: 'p' }, { idempotencyKey: 'k3' })).resolves.toMatchObject({ jobId: expect.any(String) })
  })

  it('never lets the SDK retry a submit that timed out: one POST, outcome unknown', async () => {
    const fake = fakeHiggsfield({ submitDelayMs: 400 })
    const a = await hf(fake, verifiedConfig(), 'kid_123:ksecret_456', 100)
    await expect(a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ opts: { submitted: 'unknown', retryable: false } })
    await new Promise(r => setTimeout(r, 1500))
    expect(fake.calls.filter(c => c.method === 'POST')).toHaveLength(1)
  })

  it('never counts failed, canceled, moderated or empty results as success', async () => {
    for (const [behavior, state] of [
      [{ finalStatus: 'failed' as const }, 'failed'],
      [{ finalStatus: 'canceled' as const }, 'canceled'],
      [{ finalStatus: 'nsfw' as const }, 'nsfw'],
      [{ emptyCompleted: true }, 'failed'],
    ] as const) {
      const a = await hf(fakeHiggsfield(behavior))
      const { jobId } = await a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' })
      await a.status(jobId); await a.status(jobId)
      const st = await a.status(jobId)
      expect(st.state).toBe(state)
      expect(st.outputs ?? []).toEqual([])
      expect(st.error).toBeTruthy()
    }
  })

  it('refuses to send a reference image that was not uploaded', () => {
    const entry = verifiedConfig().models.models.find(m => m.ref === 'higgsfield/gpt-image-2.5')!
    expect(() => mapInput(entry, { kind: 'image_edit', model: entry.ref, prompt: 'p', refs: [{ assetId: 'a1' }] })).toThrow(/not uploaded to Higgsfield/)
  })

  it('uploads reference images to Higgsfield storage without sending the key there', async () => {
    const fake = fakeHiggsfield()
    const a = await hf(fake)
    const url = await a.uploadAsset!(portrait, 'image/png')
    expect(url).toBe('https://cdn.higgsfield.ai/uploads/slot-1.png')
    const [slot, put] = fake.calls
    expect(slot).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/files\/generate-upload-url$/), body: { content_type: 'image/png' } })
    expect(put).toMatchObject({ method: 'PUT', url: 'https://upload.higgsfield.test/slot-1?sig=x', body: { bytes: portrait.length } })
    expect(put!.headers['Content-Type']).toBe('image/png')
    expect(put!.headers.Authorization).toBeUndefined()
  })

  it('sends Seedance 2.5 frames with audio off, and Kling 3.0 with sound off', () => {
    const models = verifiedConfig().models.models
    const frames = { startFrame: { assetId: 's', url: 'https://cdn.higgsfield.ai/s.png' }, endFrame: { assetId: 'e', url: 'https://cdn.higgsfield.ai/e.png' } }
    const seedance = models.find(m => m.ref === 'higgsfield/seedance-2.5')!
    expect(mapInput(seedance, { kind: 'video', model: seedance.ref, prompt: 'p', ...frames, durationSec: 10, resolution: '720p', audio: false }))
      .toEqual({ prompt: 'p', image_url: 'https://cdn.higgsfield.ai/s.png', end_image_url: 'https://cdn.higgsfield.ai/e.png', duration: 10, resolution: '720p', generate_audio: false })
    const kling = models.find(m => m.ref === 'higgsfield/kling-3.0-pro')!
    expect(mapInput(kling, { kind: 'video', model: kling.ref, prompt: 'p', ...frames, durationSec: 10, audio: false }))
      .toEqual({ prompt: 'p', image_url: 'https://cdn.higgsfield.ai/s.png', last_image_url: 'https://cdn.higgsfield.ai/e.png', duration: 10, sound: 'off' })
    // Turbo takes a start frame only and has no sound switch (audio is stripped on arrival).
    const turbo = models.find(m => m.ref === 'higgsfield/kling-3.0-turbo')!
    expect(turbo.audio).toBe('always_on')
    expect(mapInput(turbo, { kind: 'video', model: turbo.ref, prompt: 'p', ...frames, durationSec: 5, resolution: '720p', audio: false }))
      .toEqual({ prompt: 'p', image_url: 'https://cdn.higgsfield.ai/s.png', duration: 5, resolution: '720p' })
  })
})

describe('mock renders', () => {
  it('label the camera angle a sheet prompt asks for', async () => {
    const { mockAngle } = await import('./mock.js')
    expect(mockAngle('Full side profile: head turned 90 degrees so only her RIGHT side faces the camera')).toMatchObject({ label: 'right profile', turn: 1 })
    expect(mockAngle('turned about 45 degrees so her LEFT cheek and LEFT ear face the camera')).toMatchObject({ label: 'left three-quarter', turn: -1 })
    expect(mockAngle('Full-body framing, standing. Seen from directly behind')).toMatchObject({ label: 'Full body, back', back: true })
  })
})
