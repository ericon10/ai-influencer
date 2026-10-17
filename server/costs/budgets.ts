import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { budgets, jobs, ledgerEntries } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import type { BudgetDefaults } from '../config/load.js'
import { newId } from '../lib/ids.js'
import { audit } from '../lib/audit.js'
import { formatUsd, usdToMicros } from './money.js'
import { heldMicros, monthWindow, spentMicros } from './ledger.js'

export type BudgetScope = 'job' | 'character' | 'month' | 'day' | 'confirm_above' | 'variation_threshold'

export interface EffectiveBudgets {
  jobCapMicros: number
  characterCapMicros: number
  monthCapMicros: number
  dayCapMicros: number
  warnPct: number
  confirmAboveMicros: number
  variationThresholdMicros: number
}

export async function effectiveBudgets(db: Db, accountId: string, defaults: BudgetDefaults, characterId?: string | null): Promise<EffectiveBudgets> {
  const rows = await db.select().from(budgets).where(eq(budgets.accountId, accountId))
  const pick = (scope: BudgetScope, fallbackUsd: number, ref = '') =>
    rows.find(r => r.scope === scope && r.scopeRef === ref)?.capMicros ?? usdToMicros(fallbackUsd)
  const characterDefault = pick('character', defaults.character)
  return {
    jobCapMicros: pick('job', defaults.job),
    characterCapMicros: characterId ? (rows.find(r => r.scope === 'character' && r.scopeRef === characterId)?.capMicros ?? characterDefault) : characterDefault,
    monthCapMicros: pick('month', defaults.month),
    dayCapMicros: pick('day', defaults.day),
    warnPct: rows.find(r => r.scope === 'month' && r.scopeRef === '')?.warnPct ?? defaults.warn_pct,
    confirmAboveMicros: pick('confirm_above', defaults.confirm_above),
    variationThresholdMicros: pick('variation_threshold', defaults.variation_threshold),
  }
}

// ── The daily cap (owner, 2026-10-17; UX-PLAN.md section 31) ──────────

// "Today" is the calendar day in UTC: the Studio does not know the owner's
// time zone, and the UI says "today, UTC".
export function dayWindow(now: Date): { since: Date; until: Date } {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { since, until: new Date(since.getTime() + 86_400_000) }
}

// A plan run is priced in credits (and counts $0 toward the other caps
// unless the owner sets a credit value); the daily cap counts its credits
// at the price book's API rate, so one cap covers both paths.
export const creditMicros = (credits: number, creditUsd: number) => Math.round(credits * usdToMicros(creditUsd))

// What a run counts toward today: credits at the API rate, dollars as they are.
export function dayValue(items: Array<{ amountMicros: number; credits?: number | null }>, creditUsd: number): number {
  return items.reduce((s, i) => s + (i.credits != null ? creditMicros(i.credits, creditUsd) : i.amountMicros), 0)
}

// Today's spend: what was charged today (credits at the API rate), plus
// what runs that are under way hold (they count as spent, so two runs
// started together cannot pass the cap). A queued group that has not
// started yet holds nothing for today: it is checked when its turn comes.
export async function daySpend(db: Db, accountId: string, now: Date, creditUsd: number): Promise<{ spentMicros: number; heldMicros: number }> {
  const { since, until } = dayWindow(now)
  const rate = usdToMicros(creditUsd)
  const value = sql`case when ${ledgerEntries.unit} = 'credit' and ${ledgerEntries.quantity} is not null
    then round(${ledgerEntries.quantity} * ${rate}) * (case when ${ledgerEntries.entryType} = 'refund' then -1 else 1 end)
    else ${ledgerEntries.amountMicros} end`
  const [spent] = await db.select({ total: sql<string>`coalesce(sum(${value}), 0)` }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.accountId, accountId), inArray(ledgerEntries.entryType, ['charge', 'refund', 'adjustment']), gte(ledgerEntries.createdAt, since), lt(ledgerEntries.createdAt, until)))
  const held = sql`case when ${jobs.request} ->> 'quotedCredits' is not null
    then round((${jobs.request} ->> 'quotedCredits')::float * ${rate}) else ${jobs.estimateMicros} end`
  const [hold] = await db.select({ total: sql<string>`coalesce(sum(${held}), 0)` }).from(jobs)
    .where(and(eq(jobs.accountId, accountId), inArray(jobs.status, ['waiting', 'queued', 'submitting', 'running', 'ingesting', 'needs_attention']),
      sql`not (${jobs.status} = 'waiting' and ${jobs.request} -> 'queue' is not null)`))
  return { spentMicros: Number(spent?.total ?? 0), heldMicros: Number(hold?.total ?? 0) }
}

// A cap in plain words: "$10", "$12.50".
export const capText = (micros: number) => (micros % 1_000_000 === 0 ? `$${(micros / 1_000_000).toLocaleString('en-US')}` : formatUsd(micros))

// "today $3.20 of $10", next to every price.
export const todayText = (usedMicros: number, capMicros: number) => `today ${formatUsd(usedMicros)} of ${capText(capMicros)}`

// What a day-cap block says, on the button and on a queued group that waits.
export function dayCapMessage(usedMicros: number, runMicros: number, capMicros: number, what: 'run' | 'group' = 'run'): string {
  return `Waits: today's spend ${formatUsd(usedMicros)} + this ${what === 'run' ? 'run' : 'group'} ${formatUsd(runMicros)} would pass your ${capText(capMicros)} daily cap. Raise the cap in Settings > Budgets and usage, or run it tomorrow (UTC). Nothing is charged while it waits.`
}

export interface BudgetBlock {
  scope: 'job' | 'character' | 'month' | 'day'
  capMicros: number
  usedMicros: number
  heldMicros: number
  afterMicros: number
}

export interface DayView {
  capMicros: number
  spentMicros: number
  heldMicros: number
  // What this run counts toward today (plan credits at the API rate; a
  // queued run's first group only).
  runMicros: number
  // "today $3.20 of $10" (spent and held), next to the price.
  label: string
}

export interface BudgetCheck {
  ok: boolean
  blocks: BudgetBlock[]
  warnings: BudgetBlock[]
  // Each block in plain words: what it is, the numbers, what to do.
  messages: string[]
  needsConfirm: boolean
  budgets: EffectiveBudgets
  monthSpentMicros: number
  characterSpentMicros: number
  day: DayView
}

function blockMessage(b: BudgetBlock, runMicros: number): string {
  const used = b.usedMicros + b.heldMicros
  if (b.scope === 'day') return dayCapMessage(used, runMicros, b.capMicros)
  if (b.scope === 'job') return `This run costs ${formatUsd(b.afterMicros)}, over your ${capText(b.capMicros)} cap for one run. Raise it in Settings > Budgets and usage.`
  const which = b.scope === 'month' ? `this month's spend ${formatUsd(used)}` : `this character's spend ${formatUsd(used)}`
  return `Over a cap: ${which} + this run ${formatUsd(b.afterMicros - used)} would pass your ${capText(b.capMicros)} ${b.scope === 'month' ? 'monthly' : 'character'} cap. Raise it in Settings > Budgets and usage.`
}

// Would a run of `totalMicros` cross any cap? Holds from unfinished runs
// count as spent, so two runs started together cannot overspend. The daily
// cap counts `dayMicros` (the run's credits at the API rate; for a queued
// run, the group that starts now), default the total.
export async function checkBudget(db: Db, accountId: string, defaults: BudgetDefaults, now: Date, totalMicros: number, characterId?: string | null, opts: { dayMicros?: number; creditUsd?: number } = {}): Promise<BudgetCheck> {
  const b = await effectiveBudgets(db, accountId, defaults, characterId)
  const { since, until } = monthWindow(now)
  const [monthSpent, monthHeld, today] = await Promise.all([
    spentMicros(db, accountId, { since, until }),
    heldMicros(db, accountId, {}),
    daySpend(db, accountId, now, opts.creditUsd ?? 0),
  ])
  let charSpent = 0, charHeld = 0
  if (characterId) {
    ;[charSpent, charHeld] = await Promise.all([
      spentMicros(db, accountId, { characterId }),
      heldMicros(db, accountId, { characterId }),
    ])
  }
  const dayRun = opts.dayMicros ?? totalMicros
  const candidates: BudgetBlock[] = [
    { scope: 'job', capMicros: b.jobCapMicros, usedMicros: 0, heldMicros: 0, afterMicros: totalMicros },
    { scope: 'month', capMicros: b.monthCapMicros, usedMicros: monthSpent, heldMicros: monthHeld, afterMicros: monthSpent + monthHeld + totalMicros },
    { scope: 'day', capMicros: b.dayCapMicros, usedMicros: today.spentMicros, heldMicros: today.heldMicros, afterMicros: today.spentMicros + today.heldMicros + dayRun },
  ]
  if (characterId) {
    candidates.push({ scope: 'character', capMicros: b.characterCapMicros, usedMicros: charSpent, heldMicros: charHeld, afterMicros: charSpent + charHeld + totalMicros })
  }
  // A run that adds nothing today never waits on the daily cap.
  const blocks = candidates.filter(c => c.afterMicros > c.capMicros && !(c.scope === 'day' && dayRun <= 0))
  const warnings = candidates.filter(c => c.scope !== 'job' && c.afterMicros <= c.capMicros && c.afterMicros >= (c.capMicros * b.warnPct) / 100)
  return {
    ok: blocks.length === 0,
    blocks,
    warnings,
    messages: blocks.map(x => blockMessage(x, x.scope === 'day' ? dayRun : totalMicros)),
    needsConfirm: totalMicros > b.confirmAboveMicros,
    budgets: b,
    monthSpentMicros: monthSpent,
    characterSpentMicros: charSpent,
    day: { capMicros: b.dayCapMicros, spentMicros: today.spentMicros, heldMicros: today.heldMicros, runMicros: dayRun, label: todayText(today.spentMicros + today.heldMicros, b.dayCapMicros) },
  }
}

export async function setBudget(deps: Deps, ctx: Ctx, scope: BudgetScope, capUsd: number, opts: { scopeRef?: string; warnPct?: number } = {}): Promise<void> {
  const capMicros = usdToMicros(capUsd)
  const scopeRef = opts.scopeRef ?? ''
  const existing = await deps.db.select().from(budgets)
    .where(and(eq(budgets.accountId, ctx.accountId), eq(budgets.scope, scope), eq(budgets.scopeRef, scopeRef)))
  if (existing[0]) {
    await deps.db.update(budgets).set({ capMicros, warnPct: opts.warnPct ?? existing[0].warnPct, updatedBy: ctx.userId, updatedAt: deps.clock.now() })
      .where(eq(budgets.id, existing[0].id))
  } else {
    await deps.db.insert(budgets).values({ id: newId('bud'), accountId: ctx.accountId, scope, scopeRef, capMicros, warnPct: opts.warnPct ?? deps.config.budgets.warn_pct, updatedBy: ctx.userId })
  }
  await audit(deps.db, ctx, 'budget.set', { type: 'budget', id: `${scope}:${scopeRef}` }, { capMicros, warnPct: opts.warnPct })
}
