import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { candidates, characters, jobs, ledgerEntries } from '../db/schema.js'
import type { CostCheck } from '../core/costCheck.js'
import { modelLabel } from '../costs/quotes.js'
import type { Ctx, Deps } from '../context.js'
import { capText, dayWindow, daySpend, effectiveBudgets, todayText } from '../costs/budgets.js'
import { heldMicros, monthWindow, spendByStage, spentMicros } from '../costs/ledger.js'
import { formatUsd } from '../costs/money.js'

// Money views (SPEC 9): the KPI is cost per approved asset, not per run.

export async function characterCosts(deps: Deps, ctx: Ctx, characterId: string) {
  const [spent, held, byStage, budgets] = await Promise.all([
    spentMicros(deps.db, ctx.accountId, { characterId }),
    heldMicros(deps.db, ctx.accountId, { characterId }),
    spendByStage(deps.db, ctx.accountId, { characterId }),
    effectiveBudgets(deps.db, ctx.accountId, deps.config.budgets, characterId),
  ])
  const [approved] = await deps.db.select({ n: sql<string>`count(*)` }).from(candidates)
    // Uploaded clips cost nothing to make, so they do not count as made here.
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, characterId), eq(candidates.status, 'approved'), ne(candidates.op, 'upload')))
  const approvedCount = Number(approved?.n ?? 0)
  return {
    spentMicros: spent, spent: formatUsd(spent), heldMicros: held, held: formatUsd(held),
    byStage: byStage.map(s => ({ ...s, amount: formatUsd(s.micros) })),
    approvedAssets: approvedCount,
    costPerApproved: approvedCount ? formatUsd(Math.round(spent / approvedCount)) : null,
    capMicros: budgets.characterCapMicros, cap: formatUsd(budgets.characterCapMicros),
  }
}

export async function accountUsage(deps: Deps, ctx: Ctx) {
  const { since, until } = monthWindow(deps.clock.now())
  const rate = deps.config.pricebook.api_credit_usd
  const [monthSpent, held, budgets, today] = await Promise.all([
    spentMicros(deps.db, ctx.accountId, { since, until }),
    heldMicros(deps.db, ctx.accountId),
    effectiveBudgets(deps.db, ctx.accountId, deps.config.budgets),
    daySpend(deps.db, ctx.accountId, deps.clock.now(), rate),
  ])
  const byCharacter = await deps.db.select({ characterId: ledgerEntries.characterId, name: characters.name, total: sql<string>`sum(${ledgerEntries.amountMicros})` })
    .from(ledgerEntries).leftJoin(characters, eq(characters.id, ledgerEntries.characterId))
    .where(and(eq(ledgerEntries.accountId, ctx.accountId), sql`${ledgerEntries.entryType} in ('charge','refund','adjustment')`, sql`${ledgerEntries.createdAt} >= ${since.toISOString()}::timestamptz`))
    .groupBy(ledgerEntries.characterId, characters.name)
  const byModel = await deps.db.select({ provider: ledgerEntries.provider, model: ledgerEntries.model, total: sql<string>`sum(${ledgerEntries.amountMicros})`, runs: sql<string>`count(*)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.accountId, ctx.accountId), eq(ledgerEntries.entryType, 'charge'), sql`${ledgerEntries.createdAt} >= ${since.toISOString()}::timestamptz`))
    .groupBy(ledgerEntries.provider, ledgerEntries.model)
  const recent = await deps.db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, ctx.accountId)).orderBy(desc(ledgerEntries.createdAt)).limit(50)
  // The real cost of recent runs next to their quotes (owner, 2026-10-14).
  const checked = await deps.db.select({ id: jobs.id, provider: jobs.provider, model: jobs.model, request: jobs.request, costCheck: jobs.costCheck, completedAt: jobs.completedAt })
    .from(jobs).where(and(eq(jobs.accountId, ctx.accountId), isNotNull(jobs.costCheck))).orderBy(desc(jobs.completedAt)).limit(40)
  return {
    month: { since: since.toISOString(), spentMicros: monthSpent, spent: formatUsd(monthSpent), capMicros: budgets.monthCapMicros, cap: formatUsd(budgets.monthCapMicros), warnPct: budgets.warnPct },
    heldMicros: held, held: formatUsd(held),
    // Section 31: today (UTC), plan credits at the API rate, held runs included.
    day: {
      since: dayWindow(deps.clock.now()).since.toISOString(), spentMicros: today.spentMicros, heldMicros: today.heldMicros,
      capMicros: budgets.dayCapMicros, spent: formatUsd(today.spentMicros + today.heldMicros), cap: capText(budgets.dayCapMicros),
      label: todayText(today.spentMicros + today.heldMicros, budgets.dayCapMicros), creditUsd: rate,
    },
    budgets: {
      job: formatUsd(budgets.jobCapMicros), character: formatUsd(budgets.characterCapMicros), month: formatUsd(budgets.monthCapMicros), day: formatUsd(budgets.dayCapMicros),
      confirmAbove: formatUsd(budgets.confirmAboveMicros), raw: budgets,
    },
    byCharacter: byCharacter.map(r => ({ characterId: r.characterId, name: r.name ?? 'Account', micros: Number(r.total), amount: formatUsd(Number(r.total)) })),
    byModel: byModel.map(r => ({ model: `${r.provider}/${r.model}`, runs: Number(r.runs), micros: Number(r.total), amount: formatUsd(Number(r.total)) })),
    recent: recent.map(r => ({ id: r.id, at: r.createdAt.toISOString(), type: r.entryType, amount: formatUsd(r.amountMicros), micros: r.amountMicros, stage: r.stage, model: `${r.provider}/${r.model}`, note: r.note, source: r.source })),
    costChecks: checked.map(j => {
      const c = j.costCheck as CostCheck
      const ref = (j.request as { modelRef?: string; model?: string }).modelRef ?? (j.request as { model?: string }).model ?? `${j.provider}/${j.model}`
      return { jobId: j.id, at: (j.completedAt ?? new Date(c.at)).toISOString(), model: modelLabel(deps, ref), offPct: c.offPct, flagged: c.flagged, note: c.note, source: c.actual.source }
    }),
    flaggedChecks: checked.filter(j => (j.costCheck as CostCheck).flagged).length,
  }
}
