import { and, eq } from 'drizzle-orm'
import { budgets } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import type { BudgetDefaults } from '../config/load.js'
import { newId } from '../lib/ids.js'
import { audit } from '../lib/audit.js'
import { usdToMicros } from './money.js'
import { heldMicros, monthWindow, spentMicros } from './ledger.js'

export type BudgetScope = 'job' | 'character' | 'month' | 'confirm_above' | 'variation_threshold'

export interface EffectiveBudgets {
  jobCapMicros: number
  characterCapMicros: number
  monthCapMicros: number
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
    warnPct: rows.find(r => r.scope === 'month' && r.scopeRef === '')?.warnPct ?? defaults.warn_pct,
    confirmAboveMicros: pick('confirm_above', defaults.confirm_above),
    variationThresholdMicros: pick('variation_threshold', defaults.variation_threshold),
  }
}

export interface BudgetBlock {
  scope: 'job' | 'character' | 'month'
  capMicros: number
  usedMicros: number
  heldMicros: number
  afterMicros: number
}

export interface BudgetCheck {
  ok: boolean
  blocks: BudgetBlock[]
  warnings: BudgetBlock[]
  needsConfirm: boolean
  budgets: EffectiveBudgets
  monthSpentMicros: number
  characterSpentMicros: number
}

// Would a run of `totalMicros` cross any cap? Holds from unfinished runs
// count as spent, so two runs started together cannot overspend.
export async function checkBudget(db: Db, accountId: string, defaults: BudgetDefaults, now: Date, totalMicros: number, characterId?: string | null): Promise<BudgetCheck> {
  const b = await effectiveBudgets(db, accountId, defaults, characterId)
  const { since, until } = monthWindow(now)
  const [monthSpent, monthHeld] = await Promise.all([
    spentMicros(db, accountId, { since, until }),
    heldMicros(db, accountId, {}),
  ])
  let charSpent = 0, charHeld = 0
  if (characterId) {
    ;[charSpent, charHeld] = await Promise.all([
      spentMicros(db, accountId, { characterId }),
      heldMicros(db, accountId, { characterId }),
    ])
  }
  const candidates: BudgetBlock[] = [
    { scope: 'job', capMicros: b.jobCapMicros, usedMicros: 0, heldMicros: 0, afterMicros: totalMicros },
    { scope: 'month', capMicros: b.monthCapMicros, usedMicros: monthSpent, heldMicros: monthHeld, afterMicros: monthSpent + monthHeld + totalMicros },
  ]
  if (characterId) {
    candidates.push({ scope: 'character', capMicros: b.characterCapMicros, usedMicros: charSpent, heldMicros: charHeld, afterMicros: charSpent + charHeld + totalMicros })
  }
  const blocks = candidates.filter(c => c.afterMicros > c.capMicros)
  const warnings = candidates.filter(c => c.scope !== 'job' && c.afterMicros <= c.capMicros && c.afterMicros >= (c.capMicros * b.warnPct) / 100)
  return {
    ok: blocks.length === 0,
    blocks,
    warnings,
    needsConfirm: totalMicros > b.confirmAboveMicros,
    budgets: b,
    monthSpentMicros: monthSpent,
    characterSpentMicros: charSpent,
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
