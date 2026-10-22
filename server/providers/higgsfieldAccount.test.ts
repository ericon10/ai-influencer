import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { createFakeHiggsfield, type FakeHiggsfield } from '../testing/fakeHiggsfield.js'
import { quoteJobs, runJobs, getJob, type JobSpec } from '../jobs/runner.js'
import { ledgerEntries } from '../db/schema.js'
import { saveAsset } from '../storage/assets.js'
import { renderPlaceholderPortrait } from './mock.js'
import { deleteSetting, setSetting } from '../pipeline/settings.js'
import { readBilling, saveBilling, withBilling } from './billing.js'
import { accountModel, accountParams, createHiggsfieldAccountAdapter } from './higgsfieldAccount.js'
import { ACCOUNT_PROVIDER, disconnectAccount, finishAccountConnect, readAccountTokens, startAccountConnect } from './higgsfieldOAuth.js'
import { createMcpClient } from './mcpClient.js'
import { storeSecret } from './credentials.js'
import { estimateGen } from '../costs/pricebook.js'
import { finalizeImagePrompt } from '../core/realism.js'
import { ProviderError, type GenRequest, type ProviderAdapter } from './types.js'

// The second Higgsfield path: the owner's own account (MCP connector, plan
// credits). Every call here goes to an in-memory fake; nothing is real.

let h: Harness
let fake: FakeHiggsfield

const STILL_PROMPT = finalizeImagePrompt('Callie at a farmers market, wearing a white linen shirt, light jeans, white sandals.').prompt
const still = (over: Partial<GenRequest> = {}): JobSpec => ({
  type: 'gen', stage: 'scene', purpose: 'test_still', label: 'Scene still',
  request: { kind: 'image', model: 'higgsfield/nano-banana-2.1', prompt: STILL_PROMPT, aspect: '3:4', resolution: '2k', ...over },
})

async function connect(): Promise<void> {
  await storeSecret(h.deps, h.ctx, ACCOUNT_PROVIDER, JSON.stringify({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() + 3600_000, clientId: 'client-1' }), 'Higgsfield account', '')
}

beforeAll(async () => {
  fake = createFakeHiggsfield()
  // The REST API path prices from the price book and never submits here.
  const rest: ProviderAdapter = {
    id: 'higgsfield', listModels: async () => [], estimate: async req => estimateGen(h.deps.config, req),
    submit: async () => { throw new Error('The API path must not run in these tests.') },
    status: async () => { throw new Error('unused') }, result: async () => [],
  }
  h = await createHarness({ fetchImpl: fake.fetch, overrides: { gen: { higgsfield: rest } } })
  await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
  await connect()
  await saveBilling(h.deps, h.ctx, { default: 'account', creditUsd: 0 })
}, 120_000)

afterAll(async () => { await h?.close() })

beforeEach(() => { fake.calls.length = 0 })

describe('Higgsfield account path (plan credits)', () => {
  it('prices a run in plan credits before anything is sent', async () => {
    const quote = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [still()] })
    expect(quote.credits).toBe(1.5)
    expect(quote.display).toBe('1.5 credits')
    expect(quote.items[0]!.amount).toBe('1.5 credits')
    // A free preflight only: no job was created.
    expect(fake.tool('generate_image')[0]!.args.params).toMatchObject({ model: 'nano_banana_2_1', get_cost: true, use_unlim: false })
    expect(fake.calls.some(c => c.tool.endsWith('_batch'))).toBe(false)
  })

  it('prices identical stills once, then answers from the saved live price', async () => {
    await deleteSetting(h.deps.db, h.ctx.accountId, 'higgsfield_live_prices')
    const quote = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [still({ seed: 1 }), still({ seed: 2 })] })
    expect(quote.display).toBe('3 credits')
    expect(fake.tool('generate_image')).toHaveLength(1)
    await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [still()] })
    expect(fake.tool('generate_image')).toHaveLength(1)
  })

  it('runs on the account and records the credits it used', async () => {
    const quote = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [still()] })
    const [job] = await runJobs(h.deps, h.ctx, { quoteId: quote.id, purpose: 'test_still', characterId: null, specs: [still()] })
    expect((job!.request as GenRequest).billing).toBe('account')
    expect((job!.request as GenRequest).quotedCredits).toBe(1.5)
    await drain(h)
    const done = await getJob(h.deps, h.ctx, job!.id)
    expect(done.status).toBe('completed')
    const submit = fake.tool('generate_image_batch')[0]!.args
    expect(submit.requests[0].params).toEqual({
      model: 'nano_banana_2_1', prompt: still().request.prompt, aspect_ratio: '3:4', resolution: '2k', use_unlim: false,
    })
    const rows = await h.deps.db.select().from(ledgerEntries).where(eq(ledgerEntries.jobId, job!.id))
    const charge = rows.find(r => r.entryType === 'charge')!
    expect(charge).toMatchObject({ quantity: 1.5, unit: 'credit', amountMicros: 0 })
  })

  it('logs the credits Higgsfield actually took next to the quote, and flags one more than 20% off', async () => {
    fake.now = () => h.clock.now()
    const spec = still({ seed: 7 })
    const quote = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [spec] })
    const [job] = await runJobs(h.deps, h.ctx, { quoteId: quote.id, purpose: 'test_still', characterId: null, specs: [spec] })
    await drain(h)
    expect(fake.tool('transactions').length).toBeGreaterThan(0)
    expect((await getJob(h.deps, h.ctx, job!.id)).costCheck).toMatchObject({ quoted: { credits: 1.5 }, actual: { credits: 1.5, source: 'transactions' }, offPct: 0, flagged: false })
    fake.chargeFactor = 2
    try {
      const spec2 = still({ seed: 8 })
      const q2 = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [spec2] })
      const [j2] = await runJobs(h.deps, h.ctx, { quoteId: q2.id, purpose: 'test_still', characterId: null, specs: [spec2] })
      await drain(h)
      const check = (await getJob(h.deps, h.ctx, j2!.id)).costCheck as { actual: { credits: number }; offPct: number; flagged: boolean; note: string }
      expect(check).toMatchObject({ actual: { credits: 3 }, offPct: 100, flagged: true })
      expect(check.note).toMatch(/^Quote off by \+100%: 3 credits taken, 1.5 quoted/)
    } finally {
      fake.chargeFactor = 1
    }
  })

  it('counts credits toward budgets at the value the owner sets', async () => {
    await saveBilling(h.deps, h.ctx, { default: 'account', creditUsd: 0.05 })
    const quote = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [still()] })
    expect(quote.totalMicros).toBe(75_000)
    expect(quote.display).toBe('1.5 credits')
    await saveBilling(h.deps, h.ctx, { default: 'account', creditUsd: 0 })
  })

  it('needs a new estimate when the billing default changes', async () => {
    const quote = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [still()] })
    await saveBilling(h.deps, h.ctx, { default: 'api', creditUsd: 0 })
    try {
      const err = await runJobs(h.deps, h.ctx, { quoteId: quote.id, purpose: 'test_still', characterId: null, specs: [still()] }).catch(e => e)
      expect(err).toMatchObject({ code: 'quote_expired' })
      expect(fake.calls.some(c => c.tool.endsWith('_batch'))).toBe(false)
      // A fresh estimate on the API path is in dollars.
      const api = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [still()] })
      expect(api.display).toBe('$0.15')
      expect(api.credits).toBe(0)
    } finally {
      await saveBilling(h.deps, h.ctx, { default: 'account', creditUsd: 0 })
    }
  })

  it('uploads reference images to Higgsfield and passes them as media ids', async () => {
    const png = await renderPlaceholderPortrait('REF-00')
    const asset = await saveAsset(h.deps, h.ctx, { data: png, origin: 'fixture', label: 'REF-00' })
    const spec = still({ kind: 'image_edit', refs: [{ assetId: asset.id }] })
    const quote = await quoteJobs(h.deps, h.ctx, { purpose: 'test_still', characterId: null, specs: [spec] })
    await runJobs(h.deps, h.ctx, { quoteId: quote.id, purpose: 'test_still', characterId: null, specs: [spec] })
    await drain(h)
    const mediaId = fake.tool('media_upload').length ? [...fake.uploads.keys()].pop()! : ''
    expect(fake.uploads.get(mediaId)?.equals(png)).toBe(true)
    expect(fake.tool('media_confirm')[0]!.args).toEqual({ media_id: mediaId, type: 'image' })
    expect(fake.tool('generate_image_batch')[0]!.args.requests[0].params.medias).toEqual([{ value: mediaId, role: 'image_references' }])
  })

  it('sends Seedance frames with omni_reference and audio off, Kling with sound off', () => {
    const cfg = h.deps.config
    const frames = { startFrame: { assetId: 'a', url: 'm-start' }, endFrame: { assetId: 'b', url: 'm-end' } }
    const seedance = accountParams(accountModel(cfg, 'higgsfield/seedance-2.5'), { kind: 'video', model: 'higgsfield/seedance-2.5', prompt: 'p', durationSec: 12, resolution: '720p', aspect: '9:16', audio: false, ...frames })
    expect(seedance).toEqual({
      model: 'seedance_2_5', prompt: 'p', aspect_ratio: '9:16', duration: 12, resolution: '720p', mode: 'omni_reference', generate_audio: false,
      medias: [{ value: 'm-start', role: 'start_image' }, { value: 'm-end', role: 'end_image' }],
    })
    const kling = accountParams(accountModel(cfg, 'higgsfield/kling-3.0-pro'), { kind: 'video', model: 'higgsfield/kling-3.0-pro', prompt: 'p', durationSec: 10, aspect: '9:16', resolution: '1080p', audio: false, ...frames })
    expect(kling).toMatchObject({ model: 'kling3_0', mode: 'pro', sound: 'off', duration: 10 })
    expect(kling.resolution).toBeUndefined()
    // Turbo takes no end frame on this path.
    expect(() => accountParams(accountModel(cfg, 'higgsfield/kling-3.0-turbo'), { kind: 'video', model: 'higgsfield/kling-3.0-turbo', prompt: 'p', audio: false, ...frames })).toThrow(/end frame/)
    // The end frame helper: a masked edit sends the mask and is_inpaint.
    const masked = accountParams(accountModel(cfg, 'higgsfield/nano-banana-2.1'), { kind: 'image_edit', model: 'higgsfield/nano-banana-2.1', prompt: 'p', aspect: '9:16', refs: [{ assetId: 'a', url: 'm-still' }], mask: { assetId: 'b', url: 'm-mask' } })
    expect(masked).toMatchObject({ model: 'nano_banana_2_1', is_inpaint: true, medias: [{ value: 'm-still', role: 'image_references' }, { value: 'm-mask', role: 'mask' }] })
    expect(() => accountParams(accountModel(cfg, 'higgsfield/gpt-image-2.5-flare'), { kind: 'image_edit', model: 'higgsfield/gpt-image-2.5-flare', prompt: 'p', mask: { assetId: 'b', url: 'm-mask' } })).toThrow(/does not take a mask/)
    // Soul carries the trained character as soul_id.
    const soul = accountParams(accountModel(cfg, 'higgsfield/soul-2'), { kind: 'image', model: 'higgsfield/soul-2', prompt: 'p', aspect: '3:4', identityId: '0fdc33c0-7a1a-40a9-9b12-0dc35f44e29e' })
    expect(soul).toEqual({ model: 'soul_2', prompt: 'p', aspect_ratio: '3:4', soul_id: '0fdc33c0-7a1a-40a9-9b12-0dc35f44e29e', quality: '2k' })
  })

  it('refuses a model with no account path, with a way forward', async () => {
    // Every listed model has an account path today; one without it is refused.
    const cfg = h.deps.config
    const noPath = { ...cfg, models: { ...cfg.models, models: cfg.models.models.map(m => (m.ref === 'higgsfield/wan-3.0' ? { ...m, mcp_id: undefined, mcp: undefined } : m)) } }
    expect(() => accountModel(noPath, 'higgsfield/wan-3.0')).toThrow(/Switch Higgsfield billing to the API/)
  })

  it('runs Wan 3.0 Prime on the account with audio off, and Kling sound follows the request', () => {
    const cfg = h.deps.config
    const wan = accountParams(accountModel(cfg, 'higgsfield/wan-3.0'), { kind: 'video', model: 'higgsfield/wan-3.0', prompt: 'p', aspect: '9:16', resolution: '720p', durationSec: 5, audio: false }, false)
    expect(wan).toMatchObject({ model: 'wan3_0_prime', aspect_ratio: '9:16', resolution: '720p', duration: 5, generate_audio: false })
    const kling = (audio: boolean) => accountParams(accountModel(cfg, 'higgsfield/kling-3.0-pro'), { kind: 'video', model: 'higgsfield/kling-3.0-pro', prompt: 'p', aspect: '9:16', durationSec: 5, audio }, false)
    expect(kling(false)).toMatchObject({ model: 'kling3_0', mode: 'pro', sound: 'off' })
    expect(kling(true)).toMatchObject({ sound: 'on' })
  })

  it('keeps model tests on the API, since they confirm API endpoints', async () => {
    const req = await withBilling(h.deps.db, h.ctx.accountId, { kind: 'image', model: 'higgsfield/nano-banana-2.1', prompt: 'p', modelTest: true })
    expect(req.billing).toBe('api')
    const normal = await withBilling(h.deps.db, h.ctx.accountId, { kind: 'image', model: 'higgsfield/nano-banana-2.1', prompt: 'p' })
    expect(normal.billing).toBe('account')
    const mock = await withBilling(h.deps.db, h.ctx.accountId, { kind: 'image', model: 'mock/image', prompt: 'p' })
    expect(mock.billing).toBeUndefined()
  })
})

describe('account sign-in tokens', () => {
  it('renews a refused token once, repeats the call, and seals the new tokens', async () => {
    fake.validTokens.delete('at-1')
    const b = await h.deps.providers.higgsfieldAccountBalance(h.ctx.accountId)
    expect(b).toEqual({ credits: 1078.45, plan: 'Ultra' })
    const stored = await readAccountTokens(h.deps.db, h.deps.vault, h.ctx.accountId)
    expect(stored!.tokens.accessToken).toBe('at-2')
    expect(stored!.tokens.refreshToken).toBe('rt-2')
    expect(fake.tokenRequests.at(-1)!.get('grant_type')).toBe('refresh_token')
  })

  it('asks for a reconnect when Higgsfield refuses the renewal', async () => {
    const other = await h.newAccount('Other')
    await storeSecret(h.deps, other, ACCOUNT_PROVIDER, JSON.stringify({ accessToken: 'at-dead', refreshToken: 'rt-dead', clientId: 'client-1' }), 'Higgsfield account', '')
    fake.refuseRefresh = true
    try {
      const err = await h.deps.providers.higgsfieldAccountBalance(other.accountId).catch(e => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).opts.code).toBe('reconnect')
      expect((await readAccountTokens(h.deps.db, h.deps.vault, other.accountId))!.verifyStatus).toBe('failed')
    } finally {
      fake.refuseRefresh = false
    }
  })
})

describe('account adapter edge cases', () => {
  const client = (timeoutMs = 2000) => createMcpClient({ url: 'https://mcp.higgsfield.ai/mcp', getToken: async () => [...fake.validTokens].pop()!, refreshToken: async () => [...fake.validTokens].pop()!, timeoutMs, clientName: 'test', fetchImpl: fake.fetch })
  const adapter = (timeoutMs?: number) => createHiggsfieldAccountAdapter({ config: h.deps.config, client: client(timeoutMs), creditUsd: 0, fetchImpl: fake.fetch })
  const video: GenRequest = { kind: 'video', model: 'higgsfield/seedance-2.5', prompt: 'p', durationSec: 10, audio: false, startFrame: { assetId: 'a', url: 'm1' } }

  it('never resubmits a submit that timed out', async () => {
    fake.hangOn = 'generate_video_batch'
    try {
      const err = await adapter(50).submit(video, { idempotencyKey: 'k' }).catch(e => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).opts.submitted).toBe('unknown')
      expect(fake.tool('generate_video_batch')).toHaveLength(1)
    } finally {
      fake.hangOn = null
    }
  })

  it('declines a preset suggestion once and submits the real request', async () => {
    fake.presetNoticeOnce = true
    const { jobId } = await adapter().submit(video, { idempotencyKey: 'k' })
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/)
    const sent = fake.tool('generate_video_batch').map(c => c.args.requests[0].params)
    expect(sent).toHaveLength(2)
    expect(sent[1].declined_preset_id).toBe('11111111-2222-4333-8444-555555555555')
    expect(sent[1].generate_audio).toBe(false)
  })

  it('a recommended preset (the live answer: a tool error) is declined and the same request runs; use_unlim is false', async () => {
    fake.presetRecommend = 'once'
    try {
      const kling: GenRequest = { ...video, model: 'higgsfield/kling-3.0-pro', durationSec: 5 }
      const { jobId } = await adapter().submit(kling, { idempotencyKey: 'k' })
      expect(jobId).toMatch(/^[0-9a-f-]{36}$/)
      const sent = fake.tool('generate_video_batch').slice(-2).map(c => c.args.requests[0].params)
      expect(sent[0].declined_preset_id).toBeUndefined()
      expect(sent[1].declined_preset_id).toBe('24bae836-2c4a-48e0-89b6-49fcc0b21612')
      // The same request, only the decline added; never the preset itself.
      expect({ ...sent[1], declined_preset_id: undefined }).toEqual({ ...sent[0], declined_preset_id: undefined })
      for (const p of sent) { expect(p.use_unlim).toBe(false); expect(p).not.toHaveProperty('preset_id') }
    } finally {
      fake.presetRecommend = null
    }
  })

  it('the same recommendation sent as a normal answer (not flagged as an error) is declined too', async () => {
    fake.presetRecommend = 'once'
    fake.presetAsError = false
    try {
      const { jobId } = await adapter().submit({ ...video, model: 'higgsfield/kling-3.0-pro', durationSec: 5 }, { idempotencyKey: 'k' })
      expect(jobId).toMatch(/^[0-9a-f-]{36}$/)
      const sent = fake.tool('generate_video_batch').slice(-2).map(c => c.args.requests[0].params)
      expect(sent[1].declined_preset_id).toBe('24bae836-2c4a-48e0-89b6-49fcc0b21612')
    } finally {
      fake.presetRecommend = null
      fake.presetAsError = true
    }
  })

  it('keeps declining when Higgsfield keeps recommending, then fails plainly with nothing started', async () => {
    fake.presetRecommend = 'always'
    try {
      const before = fake.tool('generate_image_batch').length
      const err = await adapter().submit({ kind: 'image', model: 'higgsfield/nano-banana-2.1', prompt: 'p', aspect: '9:16' }, { idempotencyKey: 'k' }).catch(e => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).opts.submitted).toBe('no')
      expect((err as Error).message).toMatch(/kept recommending its presets \("IN THE DARK", then "IN THE DARK", then "IN THE DARK"\).*nothing was charged/)
      expect(fake.tool('generate_image_batch').length - before).toBe(3)
      // Each retry declines the preset it was just offered.
      const sent = fake.tool('generate_image_batch').slice(-3).map(c => c.args.requests[0].params)
      expect(sent.map(p => p.declined_preset_id)).toEqual([undefined, '24bae836-2c4a-48e0-89b6-49fcc0b21612', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'])
    } finally {
      fake.presetRecommend = null
    }
  })

  it('reads answers sent as an event stream', async () => {
    fake.sse = true
    try {
      const est = await adapter().estimate(video)
      expect(est.credits).toBe(70)
    } finally {
      fake.sse = false
    }
  })

  it('sends audio off unless the request asks for it (default rule video-audio-off)', async () => {
    await adapter().submit({ ...video, audio: undefined }, { idempotencyKey: 'k' })
    expect(fake.tool('generate_video_batch').at(-1)!.args.requests[0].params.generate_audio).toBe(false)
    await adapter().submit({ ...video, audio: true }, { idempotencyKey: 'k2' })
    expect(fake.tool('generate_video_batch').at(-1)!.args.requests[0].params.generate_audio).toBe(true)
  })

  it('reports status from an immediate snapshot, and a missing job as failed', async () => {
    const a = adapter()
    const { jobId } = await a.submit(video, { idempotencyKey: 'k' })
    expect((await a.status(jobId)).state).toBe('queued')
    const done = await a.status(jobId)
    expect(done.state).toBe('succeeded')
    expect(done.outputs![0]).toMatchObject({ kind: 'video' })
    expect(fake.tool('jobs_wait')[0]!.args.timeout_seconds).toBe(0)
    expect((await a.status('00000000-0000-0000-0000-000000000000')).state).toBe('failed')
  })

  it('falls back to the price book when Higgsfield is slow to price, and never stalls the estimate', async () => {
    const slow = createHiggsfieldAccountAdapter({ config: h.deps.config, client: client(2000), creditUsd: 0, fetchImpl: fake.fetch, estimateWaitMs: 50 })
    fake.hangOn = 'generate_video'
    try {
      const started = Date.now()
      const est = await slow.estimate(video)
      expect(est.credits).toBe(70)
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      fake.hangOn = null
    }
    // A still falls back to the price book's placeholder credits, marked as
    // not confirmed, with the reason.
    fake.hangOn = 'generate_image'
    try {
      const started = Date.now()
      // Above 2k Nano Banana 2.1 still has placeholder credits.
      const est = await slow.estimate(still({ resolution: '4k' }).request as GenRequest)
      expect(est.credits).toBe(4)
      expect(est.verified).toBe(false)
      expect(est.note).toMatch(/no answer in 0 s.*price book/)
      expect(Date.now() - started).toBeLessThan(1000)
      // With no credit cost anywhere: a clear message with what to do, fast.
      const bare = { ...h.deps.config, pricebook: { ...h.deps.config.pricebook, entries: h.deps.config.pricebook.entries.filter(e => e.model !== 'nano-banana-2.1') } }
      const noBook = createHiggsfieldAccountAdapter({ config: bare, client: client(2000), creditUsd: 0, fetchImpl: fake.fetch, estimateWaitMs: 50 })
      const err = await noBook.estimate(still().request as GenRequest).catch(e => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).message).toMatch(/no saved price for Nano Banana 2.1 yet. Press Retry/)
    } finally {
      fake.hangOn = null
    }
  })

  it('saves live prices and answers from them: at once when recent, and when Higgsfield is slow', async () => {
    const saved = new Map<string, { credits: number; at: number }>()
    const livePrices = { get: async (s: string) => saved.get(s) ?? null, set: async (s: string, c: number) => { saved.set(s, { credits: c, at: Date.now() }) } }
    const a = createHiggsfieldAccountAdapter({ config: h.deps.config, client: client(2000), creditUsd: 0, fetchImpl: fake.fetch, estimateWaitMs: 50, livePrices })
    const req = still().request as GenRequest
    const live = await a.estimate(req)
    expect(live.verified).toBe(true)
    expect(saved.size).toBe(1)
    // A recent price answers without asking Higgsfield again, whatever the prompt.
    const before = fake.calls.length
    const again = await a.estimate({ ...req, prompt: `${req.prompt} Another moment.` })
    expect(again.credits).toBe(live.credits)
    expect(fake.calls.length).toBe(before)
    // An older one still beats the price book when Higgsfield is slow.
    const [sig] = [...saved.keys()]
    saved.set(sig!, { credits: live.credits!, at: Date.now() - 7 * 3600_000 })
    fake.hangOn = 'generate_image'
    try {
      const old = await a.estimate(req)
      expect(old.credits).toBe(live.credits)
      expect(old.verified).toBe(true)
      expect(old.note).toMatch(/live price from \d{4}-\d{2}-\d{2}/)
    } finally {
      fake.hangOn = null
    }
  })

  it('"Upscale this take" sends the exact take to the video upscaler, priced per second from the price book', async () => {
    const a = adapter()
    const req: GenRequest = { kind: 'upscale', model: 'higgsfield/video-upscale', prompt: 'Upscale this take.', sourceVideo: { assetId: 'v', url: '9b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', width: 720, height: 1280 }, durationSec: 5 }
    const est = await a.estimate(req)
    expect(est.credits).toBe(10)
    expect(est.verified).toBe(false)
    const { jobId } = await a.submit(req, { idempotencyKey: 'k-up' })
    expect(jobId).toBeTruthy()
    expect(fake.tool('upscale_video')[0]!.args.params).toEqual({ provider: 'bytedance', video_id: '9b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', width: 720, height: 1280, resolution: '1080p', preset: 'aigc', fps: 24 })
  })

  it('Clone Video runs Kling 3.0 Motion Control through its own tool, with no prompt and the price book price', async () => {
    const a = adapter()
    const req: GenRequest = {
      kind: 'video_clone', model: 'higgsfield/kling-3.0-motion-control', prompt: '', resolution: '720p', durationSec: 12, cloneBackground: 'video', audio: false,
      refs: [{ assetId: 'r', url: '1b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b' }], sourceVideo: { assetId: 's', url: '2b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b' },
    }
    const est = await a.estimate(req)
    // No price preflight for this tool: 2 credits per second, not confirmed.
    expect(est.credits).toBe(24)
    expect(est.verified).toBe(false)
    expect(fake.calls).toHaveLength(0)
    const { jobId } = await a.submit(req, { idempotencyKey: 'k-clone' })
    expect(jobId).toBeTruthy()
    expect(fake.tool('motion_control')[0]!.args.params).toEqual({ image_id: '1b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', motion_video_id: '2b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', resolution: '720p', scene_control: 'video' })
    // The place from the character image, at 1080p (3 credits per second).
    await a.submit({ ...req, cloneBackground: 'image', resolution: '1080p' }, { idempotencyKey: 'k-clone-2' })
    expect(fake.tool('motion_control')[1]!.args.params).toMatchObject({ resolution: '1080p', scene_control: 'image' })
    expect((await a.estimate({ ...req, resolution: '1080p' })).credits).toBe(36)
  })

  it('Clone Video "Replace the person" runs Genjutsu replace through generate_video: her face images and exactly one clip (G28)', async () => {
    const a = adapter()
    const req: GenRequest = {
      kind: 'video_clone', model: 'higgsfield/genjutsu-replace', prompt: 'Replace only the main person.', resolution: '720p', durationSec: 10, cloneBackground: 'video', audio: false,
      refs: [{ assetId: 'r0', url: '1b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b' }, { assetId: 'r1', url: '3b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b' }], sourceVideo: { assetId: 's', url: '2b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b' },
    }
    expect(accountParams(accountModel(h.deps.config, req.model), req)).toEqual({
      model: 'hf_mult_replace_object', prompt: 'Replace only the main person.', resolution: '720p',
      medias: [
        { value: '1b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', role: 'image_references' },
        { value: '3b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', role: 'image_references' },
        { value: '2b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', role: 'video_references' },
      ],
    })
    // Higgsfield cannot price it before the clip is uploaded: the price
    // book answers (7 credits per second, the Object Swap charges in the
    // account's transactions, so confirmed), with no call.
    const est = await a.estimate(req)
    expect(est.credits).toBe(70)
    expect(est.verified).toBe(true)
    expect(fake.calls).toHaveLength(0)
    const { jobId } = await a.submit(req, { idempotencyKey: 'k-replace' })
    expect(jobId).toBeTruthy()
    expect(fake.tool('motion_control')).toHaveLength(0)
    const sent = fake.tool('generate_video_batch').at(-1)!.args.requests[0].params
    expect(sent).toMatchObject({ model: 'hf_mult_replace_object', use_unlim: false })
    expect(sent.medias.filter((m: { role: string }) => m.role === 'video_references')).toHaveLength(1)
  })

  it('Recreate from a real clip runs Genjutsu motion control: the still and the clip as uploaded, 7 credits a second at 720p', async () => {
    const a = adapter()
    const req: GenRequest = {
      kind: 'video_clone', model: 'higgsfield/genjutsu-motion-control', prompt: 'The person in the reference image performs the exact motion of the source video.', resolution: '720p', durationSec: 10, cloneBackground: 'image', audio: false,
      refs: [{ assetId: 'still', url: '4b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b' }], sourceVideo: { assetId: 's', url: '5b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b' },
    }
    expect(accountParams(accountModel(h.deps.config, req.model), req)).toMatchObject({
      model: 'hf_mult_motion_control', resolution: '720p',
      medias: [{ value: '4b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', role: 'image_references' }, { value: '5b2f7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b', role: 'video_references' }],
    })
    // The owner's real charges: 70 credits for 10 s, 42 for 6 s.
    const est = await a.estimate(req)
    expect(est.credits).toBe(70)
    expect((await a.estimate({ ...req, durationSec: 6 })).credits).toBe(42)
    await a.submit(req, { idempotencyKey: 'k-recreate' })
    expect(fake.tool('generate_video_batch').at(-1)!.args.requests[0].params).toMatchObject({ model: 'hf_mult_motion_control', use_unlim: false })
  })

  it('refuses a clone on a model the account path cannot clone with', async () => {
    const req: GenRequest = { kind: 'video_clone', model: 'higgsfield/kling-3.0-pro', prompt: 'x', durationSec: 5, refs: [{ assetId: 'r', url: 'u' }], sourceVideo: { assetId: 's', url: 'v' } }
    await expect(adapter().submit(req, { idempotencyKey: 'k-x' })).rejects.toThrow(/does not clone a video/)
  })

  it('prices an upscale from the price book, since Higgsfield needs the image first', async () => {
    const est = await adapter().estimate({ kind: 'upscale', model: 'higgsfield/bytedance-upscale', prompt: 'Upscale.', resolution: '2k', scale: 2 })
    expect(est.credits).toBe(2)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('connecting the account (OAuth with PKCE)', () => {
  it('sends the owner to Higgsfield with a one-time state and an S256 challenge', async () => {
    const { url } = await startAccountConnect(h.deps, h.ctx, { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://mcp.higgsfield.ai/oauth2/authorize')
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/v1/oauth/higgsfield/callback')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')!.startsWith(`${h.ctx.accountId}.`)).toBe(true)
    expect(fake.registrations.at(-1)!.redirect_uris).toEqual(['http://localhost:5173/api/v1/oauth/higgsfield/callback'])
  })

  it('finishes the sign-in once, with the matching verifier, and seals the tokens', async () => {
    const account = await h.newAccount('Fresh')
    const { url } = await startAccountConnect(h.deps, account, { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })
    const state = new URL(url).searchParams.get('state')!
    const challenge = new URL(url).searchParams.get('code_challenge')!
    const r = await finishAccountConnect(h.deps, { code: 'good-code', state }, { fetchImpl: fake.fetch })
    expect(r).toEqual({ ok: true, returnTo: 'http://localhost:5173' })
    const verifier = fake.tokenRequests.at(-1)!.get('code_verifier')!
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge)
    const stored = await readAccountTokens(h.deps.db, h.deps.vault, account.accountId)
    expect(stored!.tokens).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', clientId: expect.stringMatching(/^client-/) })
    // The same link cannot be used twice.
    expect((await finishAccountConnect(h.deps, { code: 'good-code', state }, { fetchImpl: fake.fetch })).ok).toBe(false)
    // Nothing chosen yet, so the connected account becomes the default payer.
    expect((await readBilling(h.deps.db, account.accountId)).default).toBe('account')
  })

  it('connecting keeps a billing choice already made', async () => {
    const account = await h.newAccount('Chose the API')
    await saveBilling(h.deps, account, { default: 'api', creditUsd: 0 })
    const { url } = await startAccountConnect(h.deps, account, { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })
    expect((await finishAccountConnect(h.deps, { code: 'good-code', state: new URL(url).searchParams.get('state')! }, { fetchImpl: fake.fetch })).ok).toBe(true)
    expect((await readBilling(h.deps.db, account.accountId)).default).toBe('api')
  })

  it('rejects a forged or expired state', async () => {
    const account = await h.newAccount('Forged')
    const { url } = await startAccountConnect(h.deps, account, { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })
    const state = new URL(url).searchParams.get('state')!
    expect((await finishAccountConnect(h.deps, { code: 'good-code', state: `${account.accountId}.forged` }, { fetchImpl: fake.fetch })).ok).toBe(false)
    expect((await finishAccountConnect(h.deps, { code: 'good-code', state: `${h.ctx.accountId}.${state.split('.')[1]}` }, { fetchImpl: fake.fetch })).ok).toBe(false)
    const again = await startAccountConnect(h.deps, account, { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })
    h.clock.advance(11 * 60_000)
    const late = await finishAccountConnect(h.deps, { code: 'good-code', state: new URL(again.url).searchParams.get('state')! }, { fetchImpl: fake.fetch })
    expect(late).toMatchObject({ ok: false, message: expect.stringMatching(/too long/) })
    expect(await readAccountTokens(h.deps.db, h.deps.vault, account.accountId)).toBeNull()
  })

  it('is for owners and admins only', async () => {
    await expect(startAccountConnect(h.deps, { ...h.ctx, role: 'member' }, { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })).rejects.toThrow(/owner or admin/)
  })

  it('disconnecting puts billing back on the API', async () => {
    const account = await h.newAccount('Leaving')
    await storeSecret(h.deps, account, ACCOUNT_PROVIDER, JSON.stringify({ accessToken: 'at-1', clientId: 'c' }), 'Higgsfield account', '')
    await saveBilling(h.deps, account, { default: 'account', creditUsd: 0 })
    await disconnectAccount(h.deps, account)
    expect((await readBilling(h.deps.db, account.accountId)).default).toBe('api')
    expect(await readAccountTokens(h.deps.db, h.deps.vault, account.accountId)).toBeNull()
  })
})

describe('when Higgsfield cannot be reached', () => {
  it('says so instead of failing with a server error', async () => {
    const account = await h.newAccount('Offline')
    const down = async () => { throw new TypeError('fetch failed') }
    await expect(startAccountConnect(h.deps, account, { origin: 'http://localhost:5173' }, { fetchImpl: down as typeof fetch, retryDelayMs: 1 }))
      .rejects.toMatchObject({ code: 'provider_error', message: expect.stringMatching(/Could not reach Higgsfield/) })
  })

  it('a sign-in that hangs gives up inside the deadline, with the plain message (never the 60 s function timeout)', async () => {
    const account = await h.newAccount('Hanging')
    let calls = 0
    // Answers only when aborted, like a server that never replies.
    const hang = (_url: string, init?: RequestInit) => { calls++; return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) }
    const started = Date.now()
    await expect(startAccountConnect(h.deps, account, { origin: 'http://localhost:5173' }, { fetchImpl: hang as typeof fetch, retryDelayMs: 1, deadlineMs: 300 }))
      .rejects.toMatchObject({ code: 'provider_error', message: expect.stringMatching(/Could not reach Higgsfield/) })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(calls).toBe(1)
  })
})
