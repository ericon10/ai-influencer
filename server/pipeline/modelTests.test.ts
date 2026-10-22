import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { createFakeHiggsfield, type FakeHiggsfield } from '../testing/fakeHiggsfield.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { setSetting } from './settings.js'
import { MODEL_OVERRIDES_KEY, effectiveModel, readModelOverrides } from '../providers/modelOverrides.js'
import { ProviderError, type GenRequest, type ProviderAdapter } from '../providers/types.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { storeSecret } from '../providers/credentials.js'
import { PERSON_WORDS } from '../core/realism.js'
import { estimateGen } from '../costs/pricebook.js'

// The owner's rule: a Higgsfield model counts as confirmed only after its
// path comes from the official reference and one small paid test passes.
// Endpoints in config/models.yaml are from docs.higgsfield.ai (2026-10-13).
// Demo stand-ins only: the REST API is a fake over the mock, the account is
// an in-memory fake of the MCP server. Nothing is spent.

const REF = 'higgsfield/gpt-image-2.5-flare'
let h: Harness
let fake: FakeHiggsfield
const seen: GenRequest[] = []
let failNext = false

beforeAll(async () => {
  registerPipelineHooks()
  fake = createFakeHiggsfield()
  h = await createHarness({
    fetchImpl: fake.fetch,
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

async function runTest(model = REF) {
  const action = { type: 'model_test' as const, model }
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h)
  return { quote, preview }
}

describe('model confirmation by a small paid test', () => {
  it('needs live mode, and refuses a model the API does not offer', async () => {
    await expect(estimateAction(h.deps, h.ctx, { type: 'model_test', model: REF })).rejects.toThrow(/Switch to live mode/)
    await expect(estimateAction(h.deps, h.ctx, { type: 'model_test', model: 'higgsfield/nano-banana-2.1' })).rejects.toThrow(/not on the Higgsfield API/)
  })

  it('is for owners and admins only', async () => {
    await expect(estimateAction(h.deps, { ...h.ctx, role: 'member' }, { type: 'model_test', model: REF })).rejects.toThrow(/owner or admin/)
  })

  it('shows its price first, runs once as a test, and confirms the tested path', async () => {
    await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
    const { quote, preview } = await runTest()
    expect(quote.items).toHaveLength(1)
    expect(quote.items[0]!.model).toBe(REF)
    expect(preview.title).toMatch(/marketing-studio\/image\/flare/)
    expect(seen.at(-1)).toMatchObject({ model: REF, kind: 'image', modelTest: true, billing: 'api' })
    // The test shot is a mug, no person (owner, 2026-10-22: Soul drew a face
    // on it from the skin block): the plain REALISM line, no skin words.
    const sent = String(seen.at(-1)!.prompt)
    expect(sent).toMatch(/^A plain white ceramic mug/)
    expect(sent).toMatch(/\nREALISM: /)
    expect(sent).not.toMatch(PERSON_WORDS)
    expect(preview.prompts[0]!.text).not.toMatch(PERSON_WORDS)
    const o = (await readModelOverrides(h.deps.db, h.ctx.accountId))[REF]!
    expect(o.lastTest).toMatchObject({ ok: true })
    expect(o.confirmedAt).toBeTruthy()
    expect(o.pendingTest).toBeUndefined()
    const entry = h.deps.config.models.models.find(m => m.ref === REF)!
    expect(effectiveModel(entry, o).confirmed).toBe(true)
  })

  it('keeps a model unconfirmed when its test fails, with the provider\'s answer', async () => {
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, {})
    failNext = true
    await runTest()
    const o = (await readModelOverrides(h.deps.db, h.ctx.accountId))[REF]!
    expect(o.confirmedAt).toBeUndefined()
    expect(o.lastTest).toMatchObject({ ok: false })
    expect(o.lastTest!.message).toMatch(/unknown field "aspect_ratio"/)
  })

  it('a single video model test runs too: the estimate and the run name the same test frame', async () => {
    await runTest('higgsfield/seedance-2.5')
    expect((await readModelOverrides(h.deps.db, h.ctx.accountId))['higgsfield/seedance-2.5']!.lastTest).toMatchObject({ ok: true })
  })
})

describe('the model test suite: every real model path once, under a cap', () => {
  const suite = { type: 'model_suite' as const }
  const API = ['higgsfield/gpt-image-2.5-flare', 'higgsfield/seedance-2.5', 'higgsfield/kling-3.0-turbo']
  const ACCOUNT = ['higgsfield/nano-banana-2.1', 'higgsfield/bytedance-upscale']

  it('runs the API paths, and names the models the API does not offer', async () => {
    await setSetting(h.deps, h.ctx, MODEL_OVERRIDES_KEY, {})
    const { quote, preview } = await estimateAction(h.deps, h.ctx, suite)
    expect(quote.items.map(i => i.model)).toEqual(API)
    expect(preview.warnings.map(w => w.message).join(' ')).toMatch(/Not tested this run: Nano Banana 2.1, ByteDance image upscale \(2k\)\. The Higgsfield API does not offer them; connect your Higgsfield account/)
  })

  it('refuses the whole run when its estimate is over the cap', async () => {
    const cfg = h.deps.config.runtime.model_suite
    const cap = cfg.cap_usd
    cfg.cap_usd = 1
    try {
      await expect(estimateAction(h.deps, h.ctx, suite)).rejects.toThrow(/over the \$1\.00 cap/)
    } finally {
      cfg.cap_usd = cap
    }
  })

  it('with the account connected: one estimate, all five paths once, neutral images, each result recorded', async () => {
    await storeSecret(h.deps, h.ctx, ACCOUNT_PROVIDER, JSON.stringify({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() + 3600_000, clientId: 'client-1' }), 'Higgsfield account', '')
    seen.length = 0
    const { quote, preview } = await estimateAction(h.deps, h.ctx, suite)
    expect(quote.items.map(i => i.model).sort()).toEqual([...API, ...ACCOUNT].sort())
    expect(quote.totalMicros).toBeLessThanOrEqual(10_000_000)
    expect(preview.title).toMatch(/5 models, capped at \$10\.00/)
    expect(preview.prompts.find(p => p.label.startsWith('Nano Banana 2.1'))!.label).toMatch(/your Higgsfield account/)
    for (const p of preview.prompts) expect(p.wrapped.split('\n').every(line => line.length <= 80)).toBe(true)
    await runAction(h.deps, h.ctx, suite, quote.id, true)
    await drain(h, 120)

    // The API paths: each once, on the API, with the documented inputs.
    const by = (ref: string) => seen.find(r => r.model === ref)!
    expect(seen.map(r => r.model).sort()).toEqual([...API].sort())
    expect(seen.every(r => r.modelTest && r.billing === 'api')).toBe(true)
    expect(by('higgsfield/gpt-image-2.5-flare')).toMatchObject({ kind: 'image', aspect: '1:1' })
    expect(by('higgsfield/seedance-2.5')).toMatchObject({ kind: 'video', aspect: '9:16', resolution: '720p', durationSec: 5, audio: false })
    expect(by('higgsfield/seedance-2.5').endFrame).toBeTruthy()
    expect(by('higgsfield/kling-3.0-turbo')).toMatchObject({ kind: 'video', durationSec: 5, audio: false })
    expect(by('higgsfield/kling-3.0-turbo').endFrame).toBeUndefined()
    // The account paths: Nano Banana with two reference images, the upscaler.
    const nano = fake.tool('generate_image_batch').find(c => (c.args.requests as Array<{ params: { model: string } }>)[0]!.params.model === 'nano_banana_2_1')!
    expect(nano).toBeTruthy()
    expect(fake.tool('upscale_image')).toHaveLength(1)
    expect(fake.tool('media_upload').length).toBeGreaterThanOrEqual(3)

    const overrides = await readModelOverrides(h.deps.db, h.ctx.accountId)
    for (const ref of [...API, ...ACCOUNT]) expect(overrides[ref]!.lastTest, ref).toMatchObject({ ok: true })
    for (const ref of ACCOUNT) {
      expect(overrides[ref]!.lastTest!.message).toMatch(/on your Higgsfield account/)
      expect(overrides[ref]!.confirmedAt).toBeUndefined()
    }
  })
})
