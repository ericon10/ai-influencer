import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { createMemoryStore } from '../storage/blobStore.js'
import { createFalAdapter, mapFalInput } from './fal.js'
import { createGoogleAdapter } from './google.js'
import type { GenRequest } from './types.js'

// The API path without a Higgsfield plan (item 19): Google AI Studio for Nano
// Banana 2.1 and fal for Seedream 4.5 edit, Wan 2.2 Animate replace and Kling
// 3.0 Motion Control, against fake networks. Never a real provider.

const config = loadConfig()
const entry = (ref: string) => config.models.models.find(m => m.ref === ref)!

type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown }

function fakeFetch(answer: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { method: init.method ?? 'GET', url: String(url), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(c)
    const a = answer(c)
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('fal', () => {
  it('maps each model to its own fields, the clip and still as links, nothing that beautifies', () => {
    const still = { assetId: 's', url: 'https://r2.example/still.png' }
    const clip = { assetId: 'c', url: 'https://r2.example/clip.mp4' }
    const wan = mapFalInput(entry('fal/wan-2.2-animate-replace'), { kind: 'video_clone', model: 'fal/wan-2.2-animate-replace', prompt: '', refs: [still], sourceVideo: clip, resolution: '720p' })
    expect(wan).toEqual({ video_url: clip.url, image_url: still.url, resolution: '720p', enable_safety_checker: true })
    const kling = mapFalInput(entry('fal/kling-3.0-motion-control'), { kind: 'video_clone', model: 'fal/kling-3.0-motion-control', prompt: 'She dances.', refs: [still], sourceVideo: clip })
    expect(kling).toEqual({ prompt: 'She dances.', image_url: still.url, video_url: clip.url, character_orientation: 'video', keep_original_sound: false })
    const sd = mapFalInput(entry('fal/seedream-4.5-edit'), { kind: 'image_edit', model: 'fal/seedream-4.5-edit', prompt: 'p', refs: [still, still], aspect: '9:16', seed: 2 })
    expect(sd).toEqual({ prompt: 'p', image_urls: [still.url, still.url], image_size: 'portrait_16_9', num_images: 1, seed: 2, enable_safety_checker: true })
    expect(() => mapFalInput(entry('fal/seedream-4.5-edit'), { kind: 'image_edit', model: 'fal/seedream-4.5-edit', prompt: 'p', refs: [{ assetId: 'x' }] })).toThrow(/no link fal can read/)
  })

  it('queues with the key, polls the app, and reads the video', async () => {
    const { f, calls } = fakeFetch(c => {
      if (c.method === 'POST') return { status: 200, body: { request_id: 'req-1' } }
      if (c.url.endsWith('/status')) return { status: 200, body: { status: 'COMPLETED' } }
      return { status: 200, body: { video: { url: 'https://v3.fal.media/files/out.mp4' } } }
    })
    const fal = createFalAdapter({ apiKey: 'fal-key-123', config, fetchImpl: f })
    const req: GenRequest = { kind: 'video_clone', model: 'fal/wan-2.2-animate-replace', prompt: '', refs: [{ assetId: 's', url: 'https://r2/s.png' }], sourceVideo: { assetId: 'c', url: 'https://r2/c.mp4' }, resolution: '720p' }
    const { jobId } = await fal.submit(req, { idempotencyKey: 'k', webhookUrl: 'https://studio/api/v1/webhooks/fal/j1?t=x' })
    expect(jobId).toBe('fal-ai/wan|req-1')
    expect(calls[0]!.url).toBe(`https://queue.fal.run/fal-ai/wan/v2.2-14b/animate/replace?fal_webhook=${encodeURIComponent('https://studio/api/v1/webhooks/fal/j1?t=x')}`)
    expect(calls[0]!.headers.Authorization).toBe('Key fal-key-123')
    const st = await fal.status(jobId)
    expect(st).toMatchObject({ state: 'succeeded', outputs: [{ url: 'https://v3.fal.media/files/out.mp4', kind: 'video' }] })
    expect(calls[1]!.url).toBe('https://queue.fal.run/fal-ai/wan/requests/req-1/status')
  })

  it('a refused key, a failed result and a filtered one are told apart, and none is a success', async () => {
    const refused = createFalAdapter({ apiKey: 'bad-key-123', config, fetchImpl: fakeFetch(() => ({ status: 401, body: { detail: 'no' } })).f })
    await expect(refused.submit({ kind: 'image_edit', model: 'fal/seedream-4.5-edit', prompt: 'p', refs: [{ assetId: 's', url: 'https://r2/s.png' }] }, { idempotencyKey: 'k' })).rejects.toThrow(/fal refused the key/)
    const failed = createFalAdapter({ apiKey: 'k-12345678', config, fetchImpl: fakeFetch(c => (c.url.endsWith('/status') ? { status: 200, body: { status: 'COMPLETED' } } : { status: 422, body: { detail: [{ msg: 'Image has nsfw content' }] } })).f })
    expect((await failed.status('fal-ai/bytedance|r')).state).toBe('nsfw')
    const empty = createFalAdapter({ apiKey: 'k-12345678', config, fetchImpl: fakeFetch(c => (c.url.endsWith('/status') ? { status: 200, body: { status: 'COMPLETED' } } : { status: 200, body: {} })).f })
    expect(await empty.status('fal-ai/bytedance|r')).toMatchObject({ state: 'failed' })
  })
})

describe('Google AI Studio', () => {
  it('sends the prompt and refs inline, keeps the still in storage, and reads it back', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] }, finishReason: 'STOP' }] } }))
    const store = createMemoryStore()
    const g = createGoogleAdapter({ apiKey: 'AIza-test-key', config, store, loadAsset: async () => png, fetchImpl: f })
    const { jobId } = await g.submit({ kind: 'image_edit', model: 'google/nano-banana-2.1', prompt: 'Replace the main person.', refs: [{ assetId: 'a' }, { assetId: 'b' }], aspect: '9:16', resolution: '1k', seed: 3 }, { idempotencyKey: 'k' })
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent')
    expect(calls[0]!.headers['x-goog-api-key']).toBe('AIza-test-key')
    const body = calls[0]!.body as { contents: Array<{ parts: unknown[] }>; generationConfig: Record<string, unknown> }
    expect(body.contents[0]!.parts).toHaveLength(3)
    expect(body.generationConfig).toEqual({ responseModalities: ['IMAGE'], seed: 3, imageConfig: { aspectRatio: '9:16', imageSize: '1K' } })
    const st = await g.status(jobId)
    expect(st.state).toBe('succeeded')
    expect(await g.download!(st.outputs![0]!)).toEqual(png)
  })

  it('a blocked image is filtered, not a success, and not kept', async () => {
    const store = createMemoryStore()
    const g = createGoogleAdapter({ apiKey: 'AIza-test-key', config, store, loadAsset: async () => Buffer.from([0xff]), fetchImpl: fakeFetch(() => ({ status: 200, body: { candidates: [{ finishReason: 'IMAGE_SAFETY' }] } })).f })
    const { jobId } = await g.submit({ kind: 'image_edit', model: 'google/nano-banana-2.1', prompt: 'p', refs: [] }, { idempotencyKey: 'k' })
    expect(await g.status(jobId)).toMatchObject({ state: 'nsfw' })
  })
})

describe('the price book has every API-path model, and every price is marked unconfirmed until its first run', () => {
  it.each([
    [{ kind: 'image_edit', model: 'google/nano-banana-2.1', prompt: '', resolution: '1k' }, 33_600],
    [{ kind: 'image_edit', model: 'fal/seedream-4.5-edit', prompt: '' }, 40_000],
    [{ kind: 'video_clone', model: 'fal/wan-2.2-animate-replace', prompt: '', resolution: '720p', durationSec: 10 }, 800_000],
    [{ kind: 'video_clone', model: 'fal/kling-3.0-motion-control', prompt: '', durationSec: 10 }, 1_680_000],
  ] as Array<[GenRequest, number]>)('%o', (req, micros) => {
    const e = estimateGen(config, req)
    expect(e.totalMicros).toBe(micros)
    expect(e.verified).toBe(false)
  })
})
