import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { advanceQueue, getJob, quoteJobs, resumeCapWaits, runJobs, type JobSpec } from '../jobs/runner.js'
import { jobViews } from '../jobs/jobView.js'
import { jobs, ledgerEntries } from '../db/schema.js'
import { appendLedger } from './ledger.js'
import { capText, checkBudget, creditMicros, dayCapMessage, daySpend, dayValue, dayWindow, setBudget, todayText } from './budgets.js'
import { loadConfig } from '../config/load.js'
import { finalizeImagePrompt } from '../core/realism.js'
import type { GenRequest } from '../providers/types.js'

// The daily spend cap (owner, 2026-10-17; UX-PLAN.md section 31): $10 a
// day by default, today in UTC, plan credits at the price book's API rate,
// a run that would pass it waits and says so, and a queued group of
// Generate N posts waits instead of running, charged nothing.

describe('the day and its numbers', () => {
  it('a day is the calendar day in UTC', () => {
    const w = dayWindow(new Date('2026-10-17T23:59:59Z'))
    expect(w.since.toISOString()).toBe('2026-10-17T00:00:00.000Z')
    expect(w.until.toISOString()).toBe('2026-10-18T00:00:00.000Z')
    expect(dayWindow(new Date('2026-10-18T00:00:00Z')).since.toISOString()).toBe('2026-10-18T00:00:00.000Z')
  })

  it('plan credits count at the price book\'s API rate (1.5 credits = $0.094: $0.0625 a credit); dollars as they are', () => {
    const rate = loadConfig().pricebook.api_credit_usd
    expect(rate).toBe(0.0625)
    expect(creditMicros(1, rate)).toBe(62_500)
    expect(creditMicros(16, rate)).toBe(1_000_000)
    expect(dayValue([{ amountMicros: 0, credits: 6 }, { amountMicros: 120_000, credits: null }], rate)).toBe(6 * 62_500 + 120_000)
  })

  it('says why a run waits, with today\'s spend, the run\'s price and the cap', () => {
    expect(loadConfig().budgets.day).toBe(10)
    expect(capText(10_000_000)).toBe('$10')
    expect(capText(12_500_000)).toBe('$12.50')
    expect(todayText(3_200_000, 10_000_000)).toBe('today $3.20 of $10')
    expect(dayCapMessage(8_400_000, 2_100_000, 10_000_000)).toBe('Waits: today\'s spend $8.40 + this run $2.10 would pass your $10 daily cap. Raise the cap in Settings > Budgets and usage, or run it tomorrow (UTC). Nothing is charged while it waits.')
  })
})

let h: Harness
const still = (n: number, group?: number): JobSpec => ({
  type: 'gen', stage: 'scene', purpose: `test:cap${n}`, label: `Still ${n}`,
  request: { kind: 'image', model: 'mock/image', prompt: finalizeImagePrompt(`A woman at a market, wearing a linen shirt, take ${n}.`).prompt, aspect: '3:4', resolution: '2k', seed: n },
  ...(group != null ? { queue: { group } } : {}),
})
// Spend already on today's ledger: dollars, or plan credits (worth $0 on
// the ledger unless the owner sets a credit value).
const seed = (usd: number, credits?: number, at?: Date) => appendLedger(h.deps.db, [{
  accountId: h.ctx.accountId, stage: 'scene', provider: credits != null ? 'higgsfield' : 'mock', model: credits != null ? 'gpt-image-2.5-flare' : 'image',
  entryType: 'charge', amountMicros: Math.round(usd * 1e6), source: 'computed', note: 'seeded',
  ...(credits != null ? { quantity: credits, unit: 'credit' } : {}), ...(at ? { createdAt: at } : {}),
}])

// The ledger's rows are stamped by the database (now), so the test clock
// runs on today too, as the Studio's does.
beforeAll(async () => { h = await createHarness(); h.clock.set(new Date()) }, 60_000)
afterAll(async () => { await h?.close() })

describe('the daily cap on runs', () => {
  it('counts today only, plan credits at the API rate, and the runs under way', async () => {
    const ctx = await h.newAccount('Day window')
    const now = h.clock.now()
    await appendLedger(h.deps.db, [
      { accountId: ctx.accountId, stage: 'scene', provider: 'mock', model: 'image', entryType: 'charge', amountMicros: 500_000, source: 'computed', note: 'yesterday', createdAt: new Date(dayWindow(now).since.getTime() - 1000) },
      { accountId: ctx.accountId, stage: 'scene', provider: 'mock', model: 'image', entryType: 'charge', amountMicros: 200_000, source: 'computed', note: 'today' },
      { accountId: ctx.accountId, stage: 'scene', provider: 'higgsfield', model: 'gpt-image-2.5-flare', entryType: 'charge', amountMicros: 0, quantity: 16, unit: 'credit', source: 'computed', note: '16 plan credits' },
    ])
    expect(await daySpend(h.deps.db, ctx.accountId, now, 0.0625)).toEqual({ spentMicros: 1_200_000, heldMicros: 0 })
    const check = await checkBudget(h.deps.db, ctx.accountId, h.deps.config.budgets, now, 100_000, null, { creditUsd: 0.0625 })
    expect(check.day).toMatchObject({ capMicros: 10_000_000, spentMicros: 1_200_000, runMicros: 100_000, label: 'today $1.20 of $10' })
    expect(check.ok).toBe(true)
  })

  it('a run that would pass the cap waits: the quote says why and the run is refused, nothing charged', async () => {
    await setBudget(h.deps, h.ctx, 'day', 0.1)
    await seed(0.04)
    // Two mock stills: $0.08. Today $0.04 + $0.08 > $0.10.
    const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [still(1), still(2)] })
    expect(q.status).toBe('blocked')
    expect(q.budget.blocks.map(b => b.scope)).toEqual(['day'])
    expect(q.budget.messages).toEqual(['Waits: today\'s spend $0.04 + this run $0.08 would pass your $0.10 daily cap. Raise the cap in Settings > Budgets and usage, or run it tomorrow (UTC). Nothing is charged while it waits.'])
    expect(q.budget.day.label).toBe('today $0.04 of $0.10')
    await expect(runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs: [still(1), still(2)] })).rejects.toMatchObject({ code: 'quote_expired' })
    // One still fits.
    const one = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [still(3)] })
    expect(one.status).toBe('open')
    // Spend that lands between the price and the click is checked again.
    await seed(0.04)
    await expect(runJobs(h.deps, h.ctx, { quoteId: one.id, purpose: 'test', characterId: null, specs: [still(3)] })).rejects.toMatchObject({ code: 'budget_exceeded', message: expect.stringMatching(/^Waits: today's spend \$0\.08 \+ this run \$0\.04 would pass your \$0\.10 daily cap/) })
    const charges = await h.deps.db.select().from(ledgerEntries).where(and(eq(ledgerEntries.accountId, h.ctx.accountId), eq(ledgerEntries.entryType, 'charge')))
    expect(charges.every(c => c.note === 'seeded')).toBe(true)
  })

  it('plan credits count toward it: 16 credits today is $1 against the cap', async () => {
    const ctx = await h.newAccount('Credits')
    await setBudget(h.deps, ctx, 'day', 1.05)
    await appendLedger(h.deps.db, [{ accountId: ctx.accountId, stage: 'scene', provider: 'higgsfield', model: 'gpt-image-2.5-flare', entryType: 'charge', amountMicros: 0, quantity: 16, unit: 'credit', source: 'computed', note: '16 plan credits' }])
    const q = await quoteJobs(h.deps, ctx, { purpose: 'test', characterId: null, specs: [still(4), still(5)] })
    expect(q.budget.messages[0]).toMatch(/^Waits: today's spend \$1\.00 \+ this run \$0\.08 would pass your \$1\.05 daily cap/)
  })

  it('a queued group of Generate N posts waits with the same message instead of running, charged nothing; it starts when the cap is raised', async () => {
    const ctx = await h.newAccount('Queue')
    // Group 0 ($0.08) fits a $0.10 cap; group 1 ($0.08) would pass it after.
    await setBudget(h.deps, ctx, 'day', 0.1)
    const specs = [still(10, 0), still(11, 0), still(12, 1), still(13, 1)]
    const q = await quoteJobs(h.deps, ctx, { purpose: 'test', characterId: null, specs })
    expect(q.status).toBe('open')
    expect(q.budget.day.runMicros).toBe(80_000)
    const rows = await runJobs(h.deps, ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs, confirmed: true })
    await drain(h, 40)
    const after = await h.deps.db.select().from(jobs).where(inArray(jobs.id, rows.map(r => r.id)))
    const byGroup = (g: number) => after.filter(r => (r.request as { queue: { group: number } }).queue.group === g)
    expect(byGroup(0).every(r => r.status === 'completed')).toBe(true)
    expect(byGroup(1).every(r => r.status === 'waiting')).toBe(true)
    const message = 'Waits: today\'s spend $0.08 + this group $0.08 would pass your $0.10 daily cap. Raise the cap in Settings > Budgets and usage, or run it tomorrow (UTC). Nothing is charged while it waits.'
    expect(byGroup(1).every(r => (r.error as { message: string; capWait: boolean }).message === message && (r.error as { capWait: boolean }).capWait)).toBe(true)
    // The run list says why it waits.
    const views = await jobViews(h.deps, ctx.accountId, byGroup(1), new Map())
    expect(views.every(v => v.phase === 'waiting' && v.phaseLabel === message)).toBe(true)
    // Nothing charged for the waiting group; today counts only what ran.
    const charged = await h.deps.db.select().from(ledgerEntries).where(and(inArray(ledgerEntries.jobId, byGroup(1).map(r => r.id)), eq(ledgerEntries.entryType, 'charge')))
    expect(charged).toHaveLength(0)
    expect(await daySpend(h.deps.db, ctx.accountId, h.clock.now(), 0.0625)).toEqual({ spentMicros: 80_000, heldMicros: 0 })
    // Asking again does not start it while the cap still says no.
    expect(await advanceQueue(h.deps, byGroup(0)[0]!)).toEqual([])
    expect(await resumeCapWaits(h.deps, ctx.accountId)).toEqual([])
    // Raise the cap: the group starts and runs.
    await setBudget(h.deps, ctx, 'day', 1)
    const started = await resumeCapWaits(h.deps, ctx.accountId)
    expect(started.sort()).toEqual(byGroup(1).map(r => r.id).sort())
    await drain(h, 40)
    for (const r of byGroup(1)) {
      const j = await getJob(h.deps, ctx, r.id)
      expect(j.status).toBe('completed')
      expect(j.error).toBeNull()
    }
  })

  it('a new day (UTC) lets a waiting group start', async () => {
    const ctx = await h.newAccount('Next day')
    await setBudget(h.deps, ctx, 'day', 0.1)
    const specs = [still(20, 0), still(21, 0), still(22, 1), still(23, 1)]
    const q = await quoteJobs(h.deps, ctx, { purpose: 'test', characterId: null, specs })
    const rows = await runJobs(h.deps, ctx, { quoteId: q.id, purpose: 'test', characterId: null, specs, confirmed: true })
    await drain(h, 40)
    const waiting = (await h.deps.db.select().from(jobs).where(inArray(jobs.id, rows.map(r => r.id)))).filter(r => r.status === 'waiting')
    expect(waiting).toHaveLength(2)
    const before = h.clock.now()
    h.clock.set(new Date(dayWindow(before).until.getTime() + 60_000))
    try {
      expect((await resumeCapWaits(h.deps, ctx.accountId)).sort()).toEqual(waiting.map(r => r.id).sort())
      expect(((await getJob(h.deps, ctx, waiting[0]!.id)).request as GenRequest).model).toBe('mock/image')
    } finally {
      h.clock.set(before)
    }
  })
})
