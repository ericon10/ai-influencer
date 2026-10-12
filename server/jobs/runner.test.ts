import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness'
import { cancelJob, getJob, quoteJobs, runJobs, tick, wakeFromWebhook, type JobSpec } from './runner'
import { jobEvents, jobOutputs, jobs } from '../db/schema'
import { heldMicros, spentMicros } from '../costs/ledger'
import { setBudget } from '../costs/budgets'
import { getAsset, readAsset } from '../storage/assets'
import { probeMedia } from '../media/ffmpeg'
import { saveAsset } from '../storage/assets'
import { renderPlaceholderPortrait } from '../providers/mock'
import type { GenRequest, ProviderAdapter } from '../providers/types'

const img = (prompt: string, extra: Partial<GenRequest> = {}): JobSpec => ({
  type: 'gen', stage: 'hero', purpose: 'test:hero', label: 'Test image',
  request: { kind: 'image', model: 'mock/image', prompt, aspect: '3:4', resolution: '2k', quality: 'high', ...extra },
})

async function quoteAndRun(h: Harness, specs: JobSpec[], opts: { confirmed?: boolean; characterId?: string | null } = {}) {
  const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: opts.characterId ?? null, specs })
  const rows = await runJobs(h.deps, h.ctx, { quoteId: q.id, confirmed: opts.confirmed, purpose: 'test', characterId: opts.characterId ?? null, specs })
  return { q, rows }
}

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
          const { ProviderError } = await import('../providers/types')
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
