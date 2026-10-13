import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { createFakeHiggsfield, type FakeHiggsfield } from '../testing/fakeHiggsfield.js'
import { quoteJobs, runJobs, getJob, type JobSpec } from '../jobs/runner.js'
import { ledgerEntries } from '../db/schema.js'
import { saveAsset } from '../storage/assets.js'
import { renderPlaceholderPortrait } from './mock.js'
import { setSetting } from '../pipeline/settings.js'
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
    // Soul carries the trained character as soul_id.
    const soul = accountParams(accountModel(cfg, 'higgsfield/soul-2'), { kind: 'image', model: 'higgsfield/soul-2', prompt: 'p', aspect: '3:4', identityId: '0fdc33c0-7a1a-40a9-9b12-0dc35f44e29e' })
    expect(soul).toEqual({ model: 'soul_2', prompt: 'p', aspect_ratio: '3:4', soul_id: '0fdc33c0-7a1a-40a9-9b12-0dc35f44e29e', quality: '2k' })
  })

  it('refuses a model with no account path, with a way forward', async () => {
    await expect(quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [{ type: 'gen', stage: 'scene', purpose: 'test', label: 'Clip', request: { kind: 'video', model: 'higgsfield/wan-3.0', prompt: 'p', audio: false } }] }))
      .rejects.toThrow(/Switch Higgsfield billing to the API/)
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

  it('reads answers sent as an event stream', async () => {
    fake.sse = true
    try {
      const est = await adapter().estimate(video)
      expect(est.credits).toBe(70)
    } finally {
      fake.sse = false
    }
  })

  it('refuses video with audio on before anything is sent', async () => {
    await expect(adapter().submit({ ...video, audio: undefined }, { idempotencyKey: 'k' })).rejects.toThrow(/audio off/)
    expect(fake.calls).toHaveLength(0)
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
    // Nano Banana 2.1 has no credit cost in the price book: a clear message, fast.
    fake.hangOn = 'generate_image'
    try {
      const started = Date.now()
      const err = await slow.estimate(still().request as GenRequest).catch(e => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).message).toMatch(/did not price .* in time/)
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      fake.hangOn = null
    }
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
})
