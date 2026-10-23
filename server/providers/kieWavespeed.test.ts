import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { startFakeProviders, type FakeProviders } from '../testing/fakeProviders.js'
import { createKieAdapter, mapKieInput } from './kie.js'
import { createWavespeedAdapter, mapWavespeedInput } from './wavespeed.js'
import type { GenRequest } from './types.js'

// Kie.ai and WaveSpeed (UX-PLAN.md section 40) against a fake server that
// answers as each provider's docs say. Never a real provider.

const config = loadConfig()
const entry = (ref: string) => config.models.models.find(m => m.ref === ref)!
const still = { assetId: 's', url: 'https://r2.example/still.png' }
const end = { assetId: 'e', url: 'https://r2.example/end.png' }
const clip = { assetId: 'c', url: 'https://r2.example/clip.mp4' }
let fake: FakeProviders

beforeAll(async () => { fake = await startFakeProviders() })
afterAll(async () => { await fake?.stop() })

describe('Kie.ai', () => {
  it('maps each model to Kie\'s own fields: references, start and end frames, the clip, safety on, sound off', () => {
    const nb = mapKieInput(entry('kie/nano-banana-2.1'), { kind: 'image_edit', model: 'kie/nano-banana-2.1', prompt: 'p', refs: [still, still], aspect: '9:16', resolution: '2k' })
    expect(nb).toEqual({ prompt: 'p', image_input: [still.url, still.url], aspect_ratio: '9:16', resolution: '2K', output_format: 'png' })
    expect(mapKieInput(entry('kie/seedream-4.5-edit'), { kind: 'image_edit', model: 'kie/seedream-4.5-edit', prompt: 'p', refs: [still], aspect: '9:16' }))
      .toEqual({ prompt: 'p', image_urls: [still.url], aspect_ratio: '9:16', quality: 'basic', nsfw_checker: true })
    expect(mapKieInput(entry('kie/kling-3.0-pro'), { kind: 'video', model: 'kie/kling-3.0-pro', prompt: 'she laughs', startFrame: still, endFrame: end, durationSec: 5, aspect: '9:16' }))
      .toEqual({ prompt: 'she laughs', image_urls: [still.url, end.url], sound: false, duration: '5', aspect_ratio: '9:16', mode: 'pro', multi_shots: false })
    expect(mapKieInput(entry('kie/kling-3.0-standard'), { kind: 'video', model: 'kie/kling-3.0-standard', prompt: 'p', startFrame: still, durationSec: 30 })).toMatchObject({ mode: 'std', duration: '15', image_urls: [still.url] })
    expect(mapKieInput(entry('kie/seedance-1.5-pro'), { kind: 'video', model: 'kie/seedance-1.5-pro', prompt: 'p', startFrame: still, durationSec: 5, resolution: '720p', aspect: '9:16' }))
      .toEqual({ prompt: 'p', input_urls: [still.url], aspect_ratio: '9:16', resolution: '720p', duration: 5, fixed_lens: false, generate_audio: false, nsfw_checker: true })
    expect(mapKieInput(entry('kie/wan-2.2-animate-replace'), { kind: 'video_clone', model: 'kie/wan-2.2-animate-replace', prompt: '', refs: [still], sourceVideo: clip, resolution: '580p' }))
      .toEqual({ video_url: clip.url, image_url: still.url, resolution: '580p', nsfw_checker: true })
    expect(mapKieInput(entry('kie/kling-3.0-motion-control'), { kind: 'video_clone', model: 'kie/kling-3.0-motion-control', prompt: 'She dances.', refs: [still], sourceVideo: clip }))
      .toEqual({ prompt: 'She dances.', input_urls: [still.url], video_urls: [clip.url], mode: '720p', character_orientation: 'video' })
    expect(() => mapKieInput(entry('kie/seedream-4.5-edit'), { kind: 'image_edit', model: 'kie/seedream-4.5-edit', prompt: 'p', refs: [{ assetId: 'x' }] })).toThrow(/no link Kie.ai can read/)
  })

  it('creates the task with the key and the callback, polls recordInfo, and returns the result links', async () => {
    const kie = createKieAdapter({ apiKey: fake.goodKey.kie, config, baseUrl: fake.url })
    const req: GenRequest = { kind: 'video', model: 'kie/kling-3.0-pro', prompt: 'she laughs', startFrame: still, durationSec: 5 }
    const { jobId } = await kie.submit(req, { idempotencyKey: 'k', webhookUrl: 'https://studio/api/v1/webhooks/kie/j1?t=x' })
    expect(jobId).toMatch(/^v\|kie\d+$/)
    const created = fake.calls.find(c => c.path === '/api/v1/jobs/createTask')!
    expect(created.auth).toBe(`Bearer ${fake.goodKey.kie}`)
    expect(created.body).toMatchObject({ model: 'kling-3.0/video', callBackUrl: 'https://studio/api/v1/webhooks/kie/j1?t=x', input: { image_urls: [still.url], mode: 'pro' } })
    expect(await kie.status(jobId)).toMatchObject({ state: 'running' })
    const done = await kie.status(jobId)
    expect(done).toMatchObject({ state: 'succeeded', outputs: [{ kind: 'video', url: `${fake.url}/files/out.mp4` }] })
  })

  it('a failure, a safety block and a refused key are told apart, and none is a success', async () => {
    const kie = createKieAdapter({ apiKey: fake.goodKey.kie, config, baseUrl: fake.url })
    const fail = await kie.submit({ kind: 'image', model: 'kie/nano-banana-2.1', prompt: 'FAIL please' }, { idempotencyKey: 'a' })
    await kie.status(fail.jobId)
    expect(await kie.status(fail.jobId)).toMatchObject({ state: 'failed', error: 'Kie.ai: Internal error, please try again later.' })
    const nsfw = await kie.submit({ kind: 'image', model: 'kie/nano-banana-2.1', prompt: 'NSFW' }, { idempotencyKey: 'b' })
    await kie.status(nsfw.jobId)
    expect((await kie.status(nsfw.jobId)).state).toBe('nsfw')
    const bad = createKieAdapter({ apiKey: 'wrong-key-0000', config, baseUrl: fake.url })
    await expect(bad.submit({ kind: 'image', model: 'kie/nano-banana-2.1', prompt: 'p' }, { idempotencyKey: 'c' })).rejects.toThrow(/Kie.ai refused the key/)
    expect(await bad.verifyCredentials!()).toMatchObject({ ok: false })
  })

  it('Test key: a free call that reads the balance in credits and dollars', async () => {
    const kie = createKieAdapter({ apiKey: fake.goodKey.kie, config, baseUrl: fake.url })
    expect(await kie.verifyCredentials!()).toEqual({ ok: true, message: 'Kie.ai key works. Balance: 1,234.5 credits (about $6.17).' })
    expect(await kie.balance()).toMatchObject({ credits: 1234.5, usd: 6.1725 })
  })
})

describe('WaveSpeed', () => {
  it('maps each model to WaveSpeed\'s fields; a still with no reference runs on the text-to-image twin', () => {
    expect(mapWavespeedInput(entry('wavespeed/nano-banana-2.1'), { kind: 'image_edit', model: 'wavespeed/nano-banana-2.1', prompt: 'p', refs: [still], aspect: '9:16', resolution: '1k' }))
      .toEqual({ path: 'google/nano-banana-2.1/edit', input: { prompt: 'p', images: [still.url], aspect_ratio: '9:16', resolution: '1k', output_format: 'png', enable_sync_mode: false, enable_base64_output: false } })
    expect(mapWavespeedInput(entry('wavespeed/nano-banana-2.1'), { kind: 'image', model: 'wavespeed/nano-banana-2.1', prompt: 'p' }).path).toBe('google/nano-banana-2.1/text-to-image')
    expect(mapWavespeedInput(entry('wavespeed/seedream-4.5-edit'), { kind: 'image_edit', model: 'wavespeed/seedream-4.5-edit', prompt: 'p', refs: [still], aspect: '9:16' }).input).toMatchObject({ images: [still.url], size: '1440*2560' })
    expect(mapWavespeedInput(entry('wavespeed/kling-3.0-pro'), { kind: 'video', model: 'wavespeed/kling-3.0-pro', prompt: 'p', startFrame: still, endFrame: end, durationSec: 5 }))
      .toEqual({ path: 'kwaivgi/kling-v3.0-pro/image-to-video', input: { image: still.url, last_image: end.url, prompt: 'p', duration: 5, sound: false } })
    expect(mapWavespeedInput(entry('wavespeed/wan-2.2-animate-replace'), { kind: 'video_clone', model: 'wavespeed/wan-2.2-animate-replace', prompt: '', refs: [still], sourceVideo: clip }).input)
      .toEqual({ image: still.url, video: clip.url, mode: 'replace', resolution: '720p', seed: -1 })
    expect(mapWavespeedInput(entry('wavespeed/seedance-1.5-pro'), { kind: 'video', model: 'wavespeed/seedance-1.5-pro', prompt: 'p', startFrame: still, durationSec: 5 }).input).toMatchObject({ image: still.url, duration: 5, generate_audio: false, camera_fixed: false })
  })

  it('submits to the model\'s path with the webhook, polls the prediction, and returns its outputs', async () => {
    const ws = createWavespeedAdapter({ apiKey: fake.goodKey.wavespeed, config, baseUrl: fake.url })
    const { jobId } = await ws.submit({ kind: 'image_edit', model: 'wavespeed/seedream-4.5-edit', prompt: 'p', refs: [still] }, { idempotencyKey: 'k', webhookUrl: 'https://studio/hook?t=1' })
    expect(jobId).toMatch(/^i\|ws\d+$/)
    const sent = fake.calls.find(c => c.provider === 'wavespeed' && c.method === 'POST')!
    expect(sent.path).toBe(`/api/v3/bytedance/seedream-v4.5/edit?webhook=${encodeURIComponent('https://studio/hook?t=1')}`)
    expect(await ws.status(jobId)).toMatchObject({ state: 'running' })
    expect(await ws.status(jobId)).toMatchObject({ state: 'succeeded', outputs: [{ kind: 'image', url: `${fake.url}/files/out.png` }] })
  })

  it('a failure, a safety block and a refused key are told apart; Test key reads the balance', async () => {
    const ws = createWavespeedAdapter({ apiKey: fake.goodKey.wavespeed, config, baseUrl: fake.url })
    const fail = await ws.submit({ kind: 'image', model: 'wavespeed/nano-banana-2.1', prompt: 'WSFAIL' }, { idempotencyKey: 'a' })
    await ws.status(fail.jobId)
    expect(await ws.status(fail.jobId)).toMatchObject({ state: 'failed', error: 'WaveSpeed: The model could not finish this request.' })
    const nsfw = await ws.submit({ kind: 'image', model: 'wavespeed/nano-banana-2.1', prompt: 'NSFW' }, { idempotencyKey: 'b' })
    await ws.status(nsfw.jobId)
    expect((await ws.status(nsfw.jobId)).state).toBe('nsfw')
    expect(await ws.verifyCredentials!()).toEqual({ ok: true, message: 'WaveSpeed key works. Balance: $7.25.' })
    const bad = createWavespeedAdapter({ apiKey: 'wrong-key-0000', config, baseUrl: fake.url })
    expect(await bad.verifyCredentials!()).toMatchObject({ ok: false, message: expect.stringMatching(/refused the key/) })
  })
})

describe('the price book', () => {
  it('prices each provider for the same request, sound on where it costs more, and dates each price', () => {
    const price = (model: string, extra: Partial<GenRequest> = {}) => estimateGen(config, { kind: 'video', model, prompt: '', durationSec: 5, ...extra }).totalMicros / 1e6
    expect(price('kie/kling-3.0-pro')).toBeCloseTo(0.45)
    expect(price('kie/kling-3.0-pro', { audio: true })).toBeCloseTo(0.675)
    expect(price('wavespeed/kling-3.0-pro')).toBeCloseTo(0.56)
    expect(price('kie/seedance-1.5-pro', { resolution: '720p' })).toBeCloseTo(0.0875)
    expect(estimateGen(config, { kind: 'image_edit', model: 'kie/seedream-4.5-edit', prompt: '' }).totalMicros / 1e6).toBeCloseTo(0.0325)
    for (const e of config.pricebook.entries.filter(x => x.provider === 'kie' || x.provider === 'wavespeed')) {
      expect(e.checked).toBe('2026-10-23')
      expect(e.verified).toBe(false)
    }
  })
})
