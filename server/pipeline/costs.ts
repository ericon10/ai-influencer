import { and, desc, eq, sql } from 'drizzle-orm'
import { candidates, characters, ledgerEntries } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { effectiveBudgets } from '../costs/budgets.js'
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
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, characterId), eq(candidates.status, 'approved')))
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
  const [monthSpent, held, budgets] = await Promise.all([
    spentMicros(deps.db, ctx.accountId, { since, until }),
    heldMicros(deps.db, ctx.accountId),
    effectiveBudgets(deps.db, ctx.accountId, deps.config.budgets),
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
  return {
    month: { since: since.toISOString(), spentMicros: monthSpent, spent: formatUsd(monthSpent), capMicros: budgets.monthCapMicros, cap: formatUsd(budgets.monthCapMicros), warnPct: budgets.warnPct },
    heldMicros: held, held: formatUsd(held),
    budgets: {
      job: formatUsd(budgets.jobCapMicros), character: formatUsd(budgets.characterCapMicros), month: formatUsd(budgets.monthCapMicros),
      confirmAbove: formatUsd(budgets.confirmAboveMicros), raw: budgets,
    },
    byCharacter: byCharacter.map(r => ({ characterId: r.characterId, name: r.name ?? 'Account', micros: Number(r.total), amount: formatUsd(Number(r.total)) })),
    byModel: byModel.map(r => ({ model: `${r.provider}/${r.model}`, runs: Number(r.runs), micros: Number(r.total), amount: formatUsd(Number(r.total)) })),
    recent: recent.map(r => ({ id: r.id, at: r.createdAt.toISOString(), type: r.entryType, amount: formatUsd(r.amountMicros), micros: r.amountMicros, stage: r.stage, model: `${r.provider}/${r.model}`, note: r.note, source: r.source })),
  }
}
