import { describe, expect, it } from 'vitest'
import { loadConfig, type StudioConfig } from '../config/load'
import { createMockAdapter } from './mock'
import { createHiggsfieldAdapter, mapInput } from './higgsfield'
import { withModelOverrides } from './modelOverrides'
import { ProviderError, type GenRequest, type ProviderAdapter } from './types'
import { renderPlaceholderPortrait } from './mock'

// Every adapter must pass this contract. CI runs it against the mock and
// against the Higgsfield adapter talking to a fake in-process API. Real
// providers are only exercised by hand, after a quote is approved.

const config = loadConfig()

function verifiedConfig(): StudioConfig {
  const c = structuredClone(config)
  for (const m of c.models.models) {
    if (m.ref === 'higgsfield/gpt-image-2.5') { m.verified = true; m.endpoint = 'openai/gpt-image-2.5/edit' }
    if (m.ref === 'higgsfield/seedance-2.0') { m.verified = true; m.endpoint = 'bytedance/seedance-2.0/image-to-video' }
  }
  return c
}

interface FakeCall { method: string; url: string; headers: Record<string, string>; body?: unknown }

function fakeHiggsfield(behavior: { submitStatus?: number; finalStatus?: 'completed' | 'failed' | 'nsfw' } = {}) {
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
      return json(200, { status: fin, request_id: id, images: fin === 'completed' ? [{ url: 'https://cdn.higgsfield.ai/out/1.png' }] : undefined })
    }
    if (init?.method === 'POST' && url.includes('/cancel')) return json(200, { status: 'canceled', request_id: 'x' })
    if (init?.method === 'POST') {
      if (behavior.submitStatus) return json(behavior.submitStatus, { detail: 'nope' })
      const id = `req-${reqs.size + 1}`
      reqs.set(id, 0)
      return json(200, { status: 'queued', request_id: id, status_url: `https://api.higgsfield.ai/requests/${id}/status`, cancel_url: `https://api.higgsfield.ai/requests/${id}/cancel` })
    }
    return json(404, {})
  }) as typeof fetch
  return { fetchImpl, calls }
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

    it('refuses video with audio on', async () => {
      const a = make()
      const bad = { kind: 'video', model: req.model.replace(/image.*$/, 'video'), prompt: 'x', audio: true } as unknown as GenRequest
      await expect(a.submit(bad, { idempotencyKey: 'k2' })).rejects.toBeInstanceOf(ProviderError)
    })
  })
}

const portrait = await renderPlaceholderPortrait('contract')
await contract('mock', () => createMockAdapter({ config, loadAsset: async () => portrait }),
  { kind: 'image', model: 'mock/image', prompt: 'portrait', aspect: '3:4', resolution: '2k', quality: 'high' })

await contract('higgsfield (fake API)', () => createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: verifiedConfig(), fetchImpl: fakeHiggsfield().fetchImpl }),
  { kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'portrait', aspect: '3:4', resolution: '2k', quality: 'high' })

describe('higgsfield adapter specifics', () => {
  it('sends the documented auth header, endpoint and webhook parameter', async () => {
    const fake = fakeHiggsfield()
    const a = createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: verifiedConfig(), fetchImpl: fake.fetchImpl })
    await a.submit({ kind: 'image_edit', model: 'higgsfield/gpt-image-2.5', prompt: 'p', aspect: '3:4', resolution: '2k', quality: 'high', refs: [{ assetId: 'a1', url: 'https://r2.example.com/a1.png' }] },
      { idempotencyKey: 'k', webhookUrl: 'https://studio.example.com/api/v1/webhooks/higgsfield/job_1?t=abc' })
    const call = fake.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.headers.Authorization).toBe('Key kid_123:ksecret_456')
    expect(call.url).toBe('https://api.higgsfield.ai/openai/gpt-image-2.5/edit?hf_webhook=' + encodeURIComponent('https://studio.example.com/api/v1/webhooks/higgsfield/job_1?t=abc'))
    expect(call.body).toEqual({ prompt: 'p', aspect_ratio: '3:4', resolution: '2k', quality: 'high', input_images: [{ type: 'image_url', image_url: 'https://r2.example.com/a1.png' }] })
  })

  it('refuses models whose endpoint is not verified yet', async () => {
    const a = createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config, fetchImpl: fakeHiggsfield().fetchImpl })
    await expect(a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ opts: { code: 'unverified_model', submitted: 'no' } })
  })

  it('always sends audio off for video', () => {
    const entry = verifiedConfig().models.models.find(m => m.ref === 'higgsfield/seedance-2.0')!
    const body = mapInput(entry, { kind: 'video', model: entry.ref, prompt: 'p', startFrame: { assetId: 's', url: 'https://r2.example.com/s.png' }, durationSec: 5, audio: false })
    expect(body.generate_audio).toBe(false)
  })

  it('classifies errors so the runner never double-charges', async () => {
    const cases: Array<[number, { retryable: boolean; submitted: string }]> = [
      [401, { retryable: false, submitted: 'no' }],
      [403, { retryable: false, submitted: 'no' }],
      [422, { retryable: false, submitted: 'no' }],
      [503, { retryable: true, submitted: 'no' }],
      [500, { retryable: false, submitted: 'unknown' }],
    ]
    for (const [status, expected] of cases) {
      const a = createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: verifiedConfig(), fetchImpl: fakeHiggsfield({ submitStatus: status }).fetchImpl })
      await expect(a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' })).rejects.toMatchObject({ opts: expected })
    }
  })

  it('maps nsfw and failed results, and verifies keys for free', async () => {
    const a = createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: verifiedConfig(), fetchImpl: fakeHiggsfield({ finalStatus: 'nsfw' }).fetchImpl })
    const { jobId } = await a.submit({ kind: 'image', model: 'higgsfield/gpt-image-2.5', prompt: 'p' }, { idempotencyKey: 'k' })
    await a.status(jobId); await a.status(jobId)
    expect((await a.status(jobId)).state).toBe('nsfw')
    expect((await a.verifyCredentials!()).ok).toBe(true)
    const bad = createHiggsfieldAdapter({ credentials: 'wrong:creds', config: verifiedConfig(), fetchImpl: fakeHiggsfield().fetchImpl })
    expect((await bad.verifyCredentials!()).ok).toBe(false)
  })

  it('runs an unconfirmed model only for its paid test, and freely once the account confirms it', async () => {
    const ref = 'higgsfield/nano-banana-2.1'
    const path = 'google/nano-banana-2.1/text-to-image'
    const fake = fakeHiggsfield()
    const pending = createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: withModelOverrides(config, { [ref]: { endpoint: path } }), fetchImpl: fake.fetchImpl })
    await expect(pending.submit({ kind: 'image', model: ref, prompt: 'p' }, { idempotencyKey: 'k1' })).rejects.toMatchObject({ opts: { code: 'unverified_model' } })
    await pending.submit({ kind: 'image', model: ref, prompt: 'p', resolution: '1k', modelTest: true }, { idempotencyKey: 'k2' })
    expect(fake.calls.at(-1)!.url).toBe(`https://api.higgsfield.ai/${path}`)
    // The test flag never reaches the provider.
    expect(fake.calls.at(-1)!.body).toEqual({ prompt: 'p', resolution: '1k' })
    const confirmed = createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: withModelOverrides(config, { [ref]: { endpoint: path, confirmedAt: '2026-10-12T12:00:00Z' } }), fetchImpl: fake.fetchImpl })
    await expect(confirmed.submit({ kind: 'image', model: ref, prompt: 'p' }, { idempotencyKey: 'k3' })).resolves.toMatchObject({ jobId: expect.any(String) })
  })

  it('refuses to send a reference image that was not uploaded', () => {
    const entry = verifiedConfig().models.models.find(m => m.ref === 'higgsfield/gpt-image-2.5')!
    expect(() => mapInput(entry, { kind: 'image_edit', model: entry.ref, prompt: 'p', refs: [{ assetId: 'a1' }] })).toThrow(/not uploaded to Higgsfield/)
  })

  it('uploads reference images to Higgsfield storage without sending the key there', async () => {
    const fake = fakeHiggsfield()
    const a = createHiggsfieldAdapter({ credentials: 'kid_123:ksecret_456', config: verifiedConfig(), fetchImpl: fake.fetchImpl })
    const url = await a.uploadAsset!(portrait, 'image/png')
    expect(url).toBe('https://cdn.higgsfield.ai/uploads/slot-1.png')
    const [slot, put] = fake.calls
    expect(slot).toMatchObject({ method: 'POST', url: 'https://api.higgsfield.ai/files/generate-upload-url', body: { content_type: 'image/png' } })
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
    const { mockAngle } = await import('./mock')
    expect(mockAngle('Full side profile: head turned 90 degrees so only her RIGHT side faces the camera')).toMatchObject({ label: 'right profile', turn: 1 })
    expect(mockAngle('turned about 45 degrees so her LEFT cheek and LEFT ear face the camera')).toMatchObject({ label: 'left three-quarter', turn: -1 })
    expect(mockAngle('Full-body framing, standing. Seen from directly behind')).toMatchObject({ label: 'Full body, back', back: true })
  })
})
