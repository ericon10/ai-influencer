import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { cancelJob, getJob, quoteJobs, runJobs, tick, wakeFromWebhook, type JobSpec } from './runner.js'
import { jobEvents, jobOutputs, jobs } from '../db/schema.js'
import { heldMicros, spentMicros } from '../costs/ledger.js'
import { setBudget } from '../costs/budgets.js'
import { getAsset, readAsset } from '../storage/assets.js'
import { probeMedia } from '../media/ffmpeg.js'
import { saveAsset } from '../storage/assets.js'
import { createMockAdapter, renderPlaceholderPortrait } from '../providers/mock.js'
import type { GenRequest, ProviderAdapter } from '../providers/types.js'
import { finalizeImagePrompt } from '../core/realism.js'
import { loadConfig } from '../config/load.js'
import { registerJobHook } from './hooks.js'

// Image prompts go through the realism step like every built prompt.
const img = (prompt: string, extra: Partial<GenRequest> = {}): JobSpec => ({
  type: 'gen', stage: 'hero', purpose: 'test:hero', label: 'Test image',
  request: { kind: 'image', model: 'mock/image', prompt: finalizeImagePrompt(prompt, { stage: 'hero' }).prompt, aspect: '3:4', resolution: '2k', quality: 'high', ...extra },
})
const raw = (prompt: string, stage = 'scene'): JobSpec => ({
  type: 'gen', stage, purpose: 'test:raw', label: 'Raw prompt',
  request: { kind: 'image', model: 'mock/image', prompt, aspect: '3:4', resolution: '2k', quality: 'high' },
})

async function quoteAndRun(h: Harness, specs: JobSpec[], opts: { confirmed?: boolean; characterId?: string | null } = {}) {
  const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: opts.characterId ?? null, specs })
  const rows = await runJobs(h.deps, h.ctx, { quoteId: q.id, confirmed: opts.confirmed, purpose: 'test', characterId: opts.characterId ?? null, specs })
  return { q, rows }
}

// Rule zero: the runner refuses what the prompt builder would never send.
describe('realism guard', () => {
  let h: Harness
  beforeEach(async () => { h = await createHarness() })
  afterEach(async () => { await h.close() })

  it('refuses an image prompt without the REALISM block, before any quote', async () => {
    await expect(quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [raw('A woman at a market, wearing a linen shirt.')] }))
      .rejects.toMatchObject({ code: 'prompt_rejected', message: expect.stringMatching(/REALISM block/) })
    const ok = raw(finalizeImagePrompt('A woman at a market, wearing a linen shirt.').prompt)
    await expect(quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [ok] })).resolves.toMatchObject({ status: 'open' })
  })

  it('refuses smoothing words even with the REALISM block', async () => {
    const p = `A woman with flawless porcelain skin, wearing a linen shirt.\n${finalizeImagePrompt('x').prompt.split('\n').slice(1).join('\n')}`
    await expect(quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [raw(p)] }))
      .rejects.toMatchObject({ code: 'prompt_rejected', message: expect.stringMatching(/flawless, porcelain/) })
  })

  it('refuses a hero or sheet prompt without the bare-face line', async () => {
    const p = finalizeImagePrompt('Chest-up portrait, wearing a white tee.').prompt
    await expect(quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [raw(p, 'sheet')] }))
      .rejects.toMatchObject({ code: 'prompt_rejected', message: expect.stringMatching(/Bare face, no makeup, no retouching/) })
  })
})

describe('job runner', () => {
  let h: Harness
  beforeEach(async () => { h = await createHarness() })
  afterEach(async () => { await h.close() })

  it('runs a quoted job end to end and settles the ledger', async () => {
    const { q, rows } = await quoteAndRun(h, [img('portrait')])
    expect(q.total).toBe('$0.04')
    expect(await heldMicros(h.deps.db, h.ctx.accountId)).toBe(40_000)
    await drain(h)
    const job = await getJob(h.deps, h.ctx, rows[0]!.id)
    expect(job.status).toBe('completed')
    expect(job.actualMicros).toBe(40_000)
    const [out] = await h.deps.db.select().from(jobOutputs).where(eq(jobOutputs.jobId, job.id))
    const asset = await getAsset(h.deps, h.ctx, out!.assetId)
    expect(asset).toMatchObject({ kind: 'image', origin: 'generated', sourceJobId: job.id, width: 1152, height: 1536 })
    expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await heldMicros(h.deps.db, h.ctx.accountId)).toBe(0)
    expect(await spentMicros(h.deps.db, h.ctx.accountId)).toBe(40_000)
  })

  it('refuses to run without a quote', async () => {
    await expect(runJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [img('x')] })).rejects.toMatchObject({ code: 'quote_required' })
  })

  it('refuses a reused quote or a run that no longer matches its quote', async () => {
    const specs = [img('portrait')]
    const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs })
    await expect(runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs: [img('a different prompt')] })).rejects.toMatchObject({ code: 'quote_expired' })
    await runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs })
    await expect(runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs })).rejects.toMatchObject({ code: 'quote_expired' })
  })

  it('refuses an expired quote', async () => {
    const specs = [img('portrait')]
    const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs })
    h.clock.advance(16 * 60_000)
    await expect(runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs })).rejects.toMatchObject({ code: 'quote_expired' })
  })

  it('blocks runs over the per-job cap', async () => {
    await setBudget(h.deps, h.ctx, 'job', 0.05)
    const specs = [img('a'), img('b')]
    const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs })
    expect(q.status).toBe('blocked')
    expect(q.budget.blocks[0]).toMatchObject({ scope: 'job', capMicros: 50_000, afterMicros: 80_000 })
    await expect(runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs })).rejects.toMatchObject({ code: 'quote_expired' })
  })

  it('counts holds from unfinished runs, so two runs cannot overspend the month', async () => {
    await setBudget(h.deps, h.ctx, 'month', 0.06)
    const a = [img('a')], b = [img('b')]
    const qa = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: a })
    const qb = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: b })
    expect(qa.status).toBe('open')
    expect(qb.status).toBe('open')
    await runJobs(h.deps, h.ctx, { quoteId: qa.id, purpose: 'test', characterId: null, specs: a })
    await expect(runJobs(h.deps, h.ctx, { quoteId: qb.id, purpose: 'test', characterId: null, specs: b })).rejects.toMatchObject({ code: 'budget_exceeded' })
  })

  it('asks for confirmation above the confirm threshold', async () => {
    const specs = Array.from({ length: 13 }, (_, i) => img(`p${i}`))
    const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs })
    expect(q.needsConfirm).toBe(true)
    await expect(runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs })).rejects.toMatchObject({ code: 'bad_request' })
    const q2 = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs })
    const rows = await runJobs(h.deps, h.ctx, { quoteId: q2.id, confirmed: true, purpose: 'test', characterId: null, specs })
    expect(rows).toHaveLength(13)
  })

  it('releases the hold and charges nothing when the provider fails or filters', async () => {
    const { rows } = await quoteAndRun(h, [img('one [mock:fail]'), img('two [mock:nsfw]')])
    await drain(h)
    for (const r of rows) {
      const j = await getJob(h.deps, h.ctx, r.id)
      expect(j.status).toBe('failed')
      expect(j.actualMicros).toBe(0)
    }
    expect(await heldMicros(h.deps.db, h.ctx.accountId)).toBe(0)
    expect(await spentMicros(h.deps.db, h.ctx.accountId)).toBe(0)
  })

  it('never resubmits when the provider may have accepted the job', async () => {
    const { rows } = await quoteAndRun(h, [img('slow [mock:submit_timeout]')])
    await drain(h)
    const j = await getJob(h.deps, h.ctx, rows[0]!.id)
    expect(j.status).toBe('needs_attention')
    expect(j.attempts).toBe(1)
    expect(await heldMicros(h.deps.db, h.ctx.accountId)).toBe(40_000)
  })

  it('flags a job whose worker died mid-submit instead of resubmitting it', async () => {
    const { rows } = await quoteAndRun(h, [img('portrait')])
    await h.deps.db.update(jobs).set({ status: 'submitting', lockedUntil: new Date(h.clock.now().getTime() - 1000) }).where(eq(jobs.id, rows[0]!.id))
    await tick(h.deps)
    expect((await getJob(h.deps, h.ctx, rows[0]!.id)).status).toBe('needs_attention')
  })

  it('retries a retryable submit error, then succeeds', async () => {
    let calls = 0
    const base = h.registry.mockFor(h.ctx.accountId)
    const flaky: ProviderAdapter = {
      ...base,
      async submit(req, o) {
        calls++
        if (calls === 1) {
          const { ProviderError } = await import('../providers/types.js')
          throw new ProviderError('busy', { retryable: true, submitted: 'no', status: 503 })
        }
        return base.submit(req, o)
      },
    }
    const h2 = await createHarness({ overrides: { gen: { mock: flaky } } })
    try {
      const q = await quoteJobs(h2.deps, h2.ctx, { purpose: 'test', characterId: null, specs: [img('p')] })
      const rows = await runJobs(h2.deps, h2.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs: [img('p')] })
      await drain(h2)
      expect((await getJob(h2.deps, h2.ctx, rows[0]!.id)).status).toBe('completed')
      expect(calls).toBe(2)
    } finally { await h2.close() }
  })

  it('uploads reference images to the provider once and reuses the link, with no public URL set', async () => {
    const base = h.registry.mockFor(h.ctx.accountId)
    const uploads: string[] = []
    const seen: Array<string | undefined> = []
    const uploading: ProviderAdapter = {
      ...base,
      needsPublicAssetUrls: true,
      async uploadAsset(data, mime) { uploads.push(mime); return `https://cdn.provider.test/u/${uploads.length}.png` },
      async submit(req, o) { seen.push(req.refs?.[0]?.url); return base.submit({ ...req, refs: req.refs?.map(r => ({ assetId: r.assetId })) }, o) },
    }
    const h2 = await createHarness({ overrides: { gen: { mock: uploading } } })
    try {
      const ref = await saveAsset(h2.deps, h2.ctx, { data: await renderPlaceholderPortrait('ref'), origin: 'upload' })
      const spec = img('with a ref', { kind: 'image_edit', refs: [{ assetId: ref.id }] })
      for (let i = 0; i < 2; i++) {
        const q = await quoteJobs(h2.deps, h2.ctx, { purpose: 'test', characterId: null, specs: [spec] })
        await runJobs(h2.deps, h2.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs: [spec] })
        await drain(h2)
      }
      expect(seen).toEqual(['https://cdn.provider.test/u/1.png', 'https://cdn.provider.test/u/1.png'])
      expect(uploads).toEqual(['image/png'])
    } finally { await h2.close() }
  })

  it('cancels a queued job and releases its hold', async () => {
    const { rows } = await quoteAndRun(h, [img('portrait')])
    await cancelJob(h.deps, h.ctx, rows[0]!.id)
    expect((await getJob(h.deps, h.ctx, rows[0]!.id)).status).toBe('canceled')
    expect(await heldMicros(h.deps.db, h.ctx.accountId)).toBe(0)
  })

  it('keeps jobs private to their account', async () => {
    const { rows } = await quoteAndRun(h, [img('portrait')])
    const other = await h.newAccount('Other Studio')
    await expect(getJob(h.deps, other, rows[0]!.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('stores generated video without audio and charges the real length', async () => {
    const still = await saveAsset(h.deps, h.ctx, { data: await renderPlaceholderPortrait('still', '9:16'), origin: 'upload' })
    const spec: JobSpec = { type: 'gen', stage: 'video', purpose: 'test:video', label: 'Clip', request: { kind: 'video', model: 'mock/video', prompt: 'listens and nods, silent, no audio, no dialogue', startFrame: { assetId: still.id }, durationSec: 2, audio: false } }
    const { rows } = await quoteAndRun(h, [spec])
    await drain(h)
    const job = await getJob(h.deps, h.ctx, rows[0]!.id)
    expect(job.status).toBe('completed')
    const [out] = await h.deps.db.select().from(jobOutputs).where(eq(jobOutputs.jobId, job.id))
    const { data } = await readAsset(h.deps, h.ctx, out!.assetId)
    expect((await probeMedia(data)).hasAudio).toBe(false)
    const events = await h.deps.db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id))
    expect(events.map(e => e.type)).toContain('audio_stripped')
    expect(job.actualMicros).toBe(200_000)
  })

  it('runs an LLM job and charges from token usage', async () => {
    const spec: JobSpec = { type: 'llm', stage: 'concepts', purpose: 'test:llm', label: 'Concepts', request: { model: 'mock/llm', system: 'sys', prompt: 'make concepts', schema: { type: 'object' }, schemaName: 'concepts', maxTokens: 2000 } }
    const { rows } = await quoteAndRun(h, [spec])
    await drain(h)
    const job = await getJob(h.deps, h.ctx, rows[0]!.id)
    expect(job.status).toBe('completed')
    expect((job.resultMeta as { data: { concepts: unknown[] } }).data.concepts).toHaveLength(3)
    expect(job.actualMicros).toBeGreaterThan(0)
    expect(job.actualMicros!).toBeLessThan(job.estimateMicros)
  })
})

// The plan's "0 of 6" (G63): a finished still was marked completed before
// its hook put it in its slide, and on the plan path the Higgsfield charge
// was read in between (a second or more), so a page polling the jobs list
// saw "done" and read the post before the still was there. Now the job is
// completed and "checking" in one step, and "done" only after its hook.
describe('a finished job counts as running until its hook has run', () => {
  let h: Harness | null = null
  afterEach(async () => { await h?.close(); h = null })

  it('is completed and checking in one step, while the plan charge is read and while its hook runs', async () => {
    const seen: Array<{ at: string; status: string; phase: string | null }> = []
    const look = async (at: string) => {
      const [j] = await h!.deps.db.select().from(jobs).where(eq(jobs.purpose, 'test_checking:plan'))
      seen.push({ at, status: j!.status, phase: j!.phase })
    }
    const mock = createMockAdapter({ config: loadConfig(), loadAsset: async () => { throw new Error('no refs here') } })
    // The plan path: the runner reads the account's charges after settling.
    const plan: ProviderAdapter = { ...mock, async charges() { await look('charge'); return [] } }
    h = await createHarness({ overrides: { gen: { mock: plan } } })
    registerJobHook('test_checking', async () => { await look('hook') })
    const spec: JobSpec = { ...img('a still on the plan path'), purpose: 'test_checking:plan', request: { ...img('a still on the plan path').request, billing: 'account' } as GenRequest }
    const { rows } = await quoteAndRun(h, [spec])
    await drain(h)
    expect(seen).toEqual([{ at: 'charge', status: 'completed', phase: 'checking' }, { at: 'hook', status: 'completed', phase: 'checking' }])
    expect((await getJob(h.deps, h.ctx, rows[0]!.id)).phase).toBe('done')
  })
})

describe('webhooks', () => {
  it('wakes a job only with its own token, and never trusts the body', async () => {
    let webhookUrl = ''
    const h = await createHarness({ publicUrl: 'https://studio.example.com', mockPollsUntilDone: 5 })
    const base = h.registry.mockFor(h.ctx.accountId)
    const spy: ProviderAdapter = { ...base, async submit(req, o) { webhookUrl = o.webhookUrl ?? ''; return base.submit(req, o) } }
    const h2 = await createHarness({ publicUrl: 'https://studio.example.com', mockPollsUntilDone: 5, overrides: { gen: { mock: spy } } })
    try {
      const specs = [img('portrait')]
      const q = await quoteJobs(h2.deps, h2.ctx, { purpose: 'test', characterId: null, specs })
      const [row] = await runJobs(h2.deps, h2.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs })
      await tick(h2.deps)
      expect(webhookUrl).toMatch(new RegExp(`^https://studio.example.com/api/v1/webhooks/mock/${row!.id}\\?t=`))
      const token = new URL(webhookUrl).searchParams.get('t')!
      expect(await wakeFromWebhook(h2.deps, 'mock', row!.id, 'wrong-token')).toBe(false)
      expect(await wakeFromWebhook(h2.deps, 'higgsfield', row!.id, token)).toBe(false)
      expect(await wakeFromWebhook(h2.deps, 'mock', row!.id, token)).toBe(true)
      const job = await getJob(h2.deps, h2.ctx, row!.id)
      expect(job.nextPollAt!.getTime()).toBe(h2.clock.now().getTime())
    } finally { await h.close(); await h2.close() }
  })
})

// Phase 4, batch at scale: claimed jobs run one after another, and a job
// another worker took meanwhile (its lock lapsed, a deploy overlap) is
// skipped here instead of running twice.
describe('claims', () => {
  it('renews each claim before running it, and skips a job another worker took', async () => {
    const { registerLocalJob } = await import('./hooks.js')
    const { enqueueLocalJob } = await import('./runner.js')
    const h = await createHarness()
    const ran: string[] = []
    let bId = ''
    registerLocalJob('test_claim_a', async deps => {
      ran.push('a')
      // Meanwhile another worker claims job B with its own lock.
      await deps.db.update(jobs).set({ lockedUntil: new Date(deps.clock.now().getTime() + 999_000) }).where(eq(jobs.id, bId))
      return {}
    })
    registerLocalJob('test_claim_b', async () => { ran.push('b'); return {} })
    const a = await enqueueLocalJob(h.deps, h.ctx, { stage: 'content', purpose: 'test_claim_a:1', label: 'A', characterId: null, request: {} })
    const b = await enqueueLocalJob(h.deps, h.ctx, { stage: 'content', purpose: 'test_claim_b:1', label: 'B', characterId: null, request: {} })
    bId = (b as { id: string }).id
    expect((a as { id: string }).id).toBeTruthy()
    await tick(h.deps, 5)
    expect(ran).toEqual(['a'])
    expect((await getJob(h.deps, h.ctx, bId)).status).toBe('queued')
    await h.close()
  })
})
