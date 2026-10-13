import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { setSetting } from './settings.js'
import { MODEL_OVERRIDES_KEY, effectiveModel, readModelOverrides } from '../providers/modelOverrides.js'
import { ProviderError, type GenRequest, type ProviderAdapter } from '../providers/types.js'
import { estimateGen } from '../costs/pricebook.js'

// The owner's rule: a Higgsfield model counts as confirmed only after its
// path comes from the official reference and one small paid test passes.

const REF = 'higgsfield/nano-banana-2.1'
let h: Harness
const seen: GenRequest[] = []
let failNext = false

beforeAll(async () => {
  registerPipelineHooks()
  // A stand-in for the Higgsfield API that completes like the mock.
  h = await createHarness({
    overrides: {
      gen: {
        higgsfield: {
          id: 'higgsfield',
          needsPublicAssetUrls: false,
          listModels: async () => [],
          estimate: async req => estimateGen(h.deps.config, req),
          async submit(req, o) {
            seen.push(req)
            if (failNext) { failNext = false; throw new ProviderError('Higgsfield rejected the request: unknown field "aspect_ratio"', { retryable: false, submitted: 'no', status: 422 }) }
            return h.registry.mockFor(h.ctx.accountId).submit({ ...req, model: req.kind === 'video' ? 'mock/video' : 'mock/image' }, o)
          },
          status: id => h.registry.mockFor(h.ctx.accountId).status(id),
          result: id => h.registry.mockFor(h.ctx.accountId).result(id),
          download: out => h.registry.mockFor(h.ctx.accountId).download!(out),
        } satisfies ProviderAdapter,
      },
    },
  })
}, 120_000)

afterAll(async () => { await h?.close() })

async function runTest() {
  const action = { type: 'model_test' as const, model: REF }
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h)
  return { quote, preview }
}

describe('model confirmation by a small paid test', () => {
  it('needs the path from the official reference, and live mode', async () => {
    await expect(estimateAction(h.deps, h.ctx, { type: 'model_test', model: REF })).rejects.toThrow(/endpoint from the official Model API Reference/)
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, { [REF]: { endpoint: 'google/nano-banana-2.1/text-to-image' } })
    await expect(estimateAction(h.deps, h.ctx, { type: 'model_test', model: REF })).rejects.toThrow(/Switch to live mode/)
  })

  it('is for owners and admins only', async () => {
    await expect(estimateAction(h.deps, { ...h.ctx, role: 'member' }, { type: 'model_test', model: REF })).rejects.toThrow(/owner or admin/)
  })

  it('shows its price first, runs once as a test, and confirms the tested path', async () => {
    await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
    const { quote, preview } = await runTest()
    expect(quote.items).toHaveLength(1)
    expect(quote.items[0]!.model).toBe(REF)
    expect(preview.title).toMatch(/google\/nano-banana-2.1\/text-to-image/)
    expect(seen.at(-1)).toMatchObject({ model: REF, kind: 'image', modelTest: true, resolution: '1k' })
    const o = (await readModelOverrides(h.deps.db, h.ctx.accountId))[REF]!
    expect(o.lastTest).toMatchObject({ ok: true })
    expect(o.confirmedAt).toBeTruthy()
    expect(o.pendingTest).toBeUndefined()
    const entry = h.deps.config.models.models.find(m => m.ref === REF)!
    expect(effectiveModel(entry, o).confirmed).toBe(true)
  })

  it('keeps a model unconfirmed when its test fails, with the provider\'s answer', async () => {
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, { [REF]: { endpoint: 'google/nano-banana-2.1/wrong' } })
    failNext = true
    await runTest()
    const o = (await readModelOverrides(h.deps.db, h.ctx.accountId))[REF]!
    expect(o.confirmedAt).toBeUndefined()
    expect(o.lastTest).toMatchObject({ ok: false })
    expect(o.lastTest!.message).toMatch(/unknown field "aspect_ratio"/)
  })
})

describe('the model test suite: every real model path once, under a cap', () => {
  const SUITE = {
    'higgsfield/nano-banana-2.1': { endpoint: 'test/nano-banana-2.1' },
    'higgsfield/gpt-image-2.5-flare': { endpoint: 'test/gpt-image-2.5-flare' },
    'higgsfield/seedance-2.5': { endpoint: 'test/seedance-2.5/image-to-video' },
    'higgsfield/kling-3.0-turbo': { endpoint: 'test/kling-3.0-turbo/image-to-video' },
    'higgsfield/bytedance-upscale': { endpoint: 'test/bytedance/upscale' },
  }
  const suite = { type: 'model_suite' as const }

  it('skips a model with no endpoint yet, and says which', async () => {
    await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, {})
    await expect(estimateAction(h.deps, h.ctx, suite)).rejects.toThrow(/endpoints from the official Model API Reference/)
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, { 'higgsfield/nano-banana-2.1': SUITE['higgsfield/nano-banana-2.1'] })
    const { quote, preview } = await estimateAction(h.deps, h.ctx, suite)
    expect(quote.items.map(i => i.model)).toEqual(['higgsfield/nano-banana-2.1'])
    expect(preview.warnings[0]!.message).toMatch(/Not tested this run: GPT Image 2.5 Flare, Seedance 2.5, Kling 3.0 Turbo, ByteDance image upscale/)
  })

  it('refuses the whole run when its estimate is over the cap', async () => {
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, SUITE)
    const cfg = h.deps.config.runtime.model_suite
    const cap = cfg.cap_usd
    cfg.cap_usd = 1
    try {
      await expect(estimateAction(h.deps, h.ctx, suite)).rejects.toThrow(/over the \$1\.00 cap/)
    } finally {
      cfg.cap_usd = cap
    }
  })

  it('shows one estimate, runs each path once on the API with neutral images, and confirms each', async () => {
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, SUITE)
    seen.length = 0
    const { quote, preview } = await estimateAction(h.deps, h.ctx, suite)
    expect(quote.items).toHaveLength(5)
    expect(quote.totalMicros).toBeLessThanOrEqual(10_000_000)
    expect(preview.title).toMatch(/5 models, capped at \$10\.00/)
    for (const p of preview.prompts) expect(p.wrapped.split('\n').every(line => line.length <= 80)).toBe(true)
    await runAction(h.deps, h.ctx, suite, quote.id, true)
    await drain(h, 80)

    const by = (ref: string) => seen.find(r => r.model === ref)!
    expect(seen).toHaveLength(5)
    expect(seen.every(r => r.modelTest && r.billing === 'api')).toBe(true)
    expect(by('higgsfield/nano-banana-2.1').refs).toHaveLength(2)
    expect(by('higgsfield/gpt-image-2.5-flare')).toMatchObject({ kind: 'image', aspect: '1:1' })
    expect(by('higgsfield/seedance-2.5')).toMatchObject({ kind: 'video', aspect: '9:16', resolution: '720p', durationSec: 5, audio: false })
    expect(by('higgsfield/seedance-2.5').endFrame).toBeTruthy()
    expect(by('higgsfield/kling-3.0-turbo')).toMatchObject({ kind: 'video', durationSec: 5, audio: false })
    expect(by('higgsfield/kling-3.0-turbo').endFrame).toBeUndefined()
    expect(by('higgsfield/bytedance-upscale')).toMatchObject({ kind: 'upscale', resolution: '2k', scale: 2 })

    const overrides = await readModelOverrides(h.deps.db, h.ctx.accountId)
    for (const ref of Object.keys(SUITE)) expect(overrides[ref]!.lastTest, ref).toMatchObject({ ok: true })
  })

  it('a single video model test runs too: the estimate and the run name the same test frame', async () => {
    const action = { type: 'model_test' as const, model: 'higgsfield/seedance-2.5' }
    const { quote } = await estimateAction(h.deps, h.ctx, action)
    await runAction(h.deps, h.ctx, action, quote.id, true)
    await drain(h)
    expect((await readModelOverrides(h.deps.db, h.ctx.accountId))['higgsfield/seedance-2.5']!.lastTest).toMatchObject({ ok: true })
  })
})
