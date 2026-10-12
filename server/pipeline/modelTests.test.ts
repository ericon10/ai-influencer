import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness'
import { registerPipelineHooks } from './hooks'
import { estimateAction, runAction } from './actions'
import { setSetting } from './settings'
import { MODEL_OVERRIDES_KEY, effectiveModel, readModelOverrides } from '../providers/modelOverrides'
import { ProviderError, type GenRequest, type ProviderAdapter } from '../providers/types'
import { estimateGen } from '../costs/pricebook'

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
            return h.registry.mockFor(h.ctx.accountId).submit({ ...req, model: 'mock/image' }, o)
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
