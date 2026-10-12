import { and, eq, sql } from 'drizzle-orm'
import { quotes } from '../db/schema'
import type { Db } from '../db/client'
import type { Ctx, Deps } from '../context'
import type { CostEstimate } from '../providers/types'
import { AppError } from '../lib/errors'
import { newId } from '../lib/ids'
import { sha256Hex } from '../lib/passwords'
import { checkBudget, type BudgetCheck } from './budgets'
import { formatUsd } from './money'
import { stableStringify } from './stableJson'

// Every paid run is two steps: a quote (price + budget check) that the UI
// shows, then a run that must present that quote. The server refuses to run
// anything without a fresh, matching quote (DECISIONS.md B8).

export interface QuoteItem {
  label: string
  provider: string
  model: string
  kind: string
  request: unknown
  estimate: CostEstimate
}

export interface QuoteView {
  id: string
  purpose: string
  characterId: string | null
  totalMicros: number
  total: string
  verified: boolean
  items: Array<{ label: string; model: string; amount: string; amountMicros: number; verified: boolean }>
  budget: BudgetCheck
  status: 'open' | 'blocked'
  expiresAt: string
  needsConfirm: boolean
}

export function fingerprintItems(purpose: string, characterId: string | null, items: Array<Pick<QuoteItem, 'provider' | 'model' | 'kind' | 'request'>>): string {
  return sha256Hex(stableStringify({ purpose, characterId, items: items.map(i => ({ p: i.provider, m: i.model, k: i.kind, r: i.request })) }))
}

export async function createQuote(deps: Deps, ctx: Ctx, input: { purpose: string; characterId: string | null; items: QuoteItem[] }): Promise<QuoteView> {
  if (!input.items.length) throw new AppError('bad_request', 'Nothing to quote.')
  const total = input.items.reduce((s, i) => s + i.estimate.totalMicros, 0)
  const now = deps.clock.now()
  const budget = await checkBudget(deps.db, ctx.accountId, deps.config.budgets, now, total, input.characterId)
  const id = newId('qte')
  const expiresAt = new Date(now.getTime() + deps.config.runtime.jobs.quote_ttl_sec * 1000)
  const status = budget.ok ? 'open' : 'blocked'
  const items = input.items.map(i => ({
    label: i.label, provider: i.provider, model: i.model, kind: i.kind,
    amountMicros: i.estimate.totalMicros, verified: i.estimate.verified, lines: i.estimate.lines, priceVersion: i.estimate.priceVersion,
  }))
  await deps.db.insert(quotes).values({
    id, accountId: ctx.accountId, userId: ctx.userId, characterId: input.characterId, purpose: input.purpose,
    fingerprint: fingerprintItems(input.purpose, input.characterId, input.items),
    items, totalMicros: total, budget, status, expiresAt,
  })
  return {
    id, purpose: input.purpose, characterId: input.characterId, totalMicros: total, total: formatUsd(total),
    verified: input.items.every(i => i.estimate.verified),
    items: items.map(i => ({ label: i.label, model: `${i.provider}/${i.model}`, amount: formatUsd(i.amountMicros), amountMicros: i.amountMicros, verified: i.verified })),
    budget, status, expiresAt: expiresAt.toISOString(), needsConfirm: budget.needsConfirm,
  }
}

// Validates and consumes a quote inside the run's transaction. Re-checks the
// budget, because spend may have changed since the quote was shown.
export async function consumeQuote(tx: Db, deps: Deps, ctx: Ctx, quoteId: string | undefined, purpose: string, characterId: string | null, items: QuoteItem[], confirmed: boolean): Promise<typeof quotes.$inferSelect> {
  if (!quoteId) throw new AppError('quote_required', 'Get a price estimate first. Every run needs an approved estimate.')
  // Serialize runs per account so concurrent runs cannot both pass a cap.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.accountId}))`)
  const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.accountId, ctx.accountId)))
  if (!q) throw new AppError('quote_required', 'That estimate was not found. Get a new estimate.')
  if (q.status !== 'open') throw new AppError('quote_expired', q.status === 'used' ? 'That estimate was already used. Get a new estimate.' : 'That estimate is blocked by a budget cap.')
  if (q.expiresAt.getTime() < deps.clock.now().getTime()) throw new AppError('quote_expired', 'That estimate expired. Get a new estimate.')
  if (q.fingerprint !== fingerprintItems(purpose, characterId, items)) {
    throw new AppError('quote_expired', 'The run no longer matches its estimate. Get a new estimate.')
  }
  const budget = await checkBudget(tx, ctx.accountId, deps.config.budgets, deps.clock.now(), q.totalMicros, characterId)
  if (!budget.ok) {
    await tx.update(quotes).set({ status: 'blocked', budget }).where(eq(quotes.id, q.id))
    throw new AppError('budget_exceeded', 'This run would go over a budget cap.', budget.blocks)
  }
  if (budget.needsConfirm && !confirmed) {
    throw new AppError('bad_request', `This run costs ${formatUsd(q.totalMicros)}. Confirm to continue.`, { needsConfirm: true })
  }
  await tx.update(quotes).set({ status: 'used', usedAt: deps.clock.now() }).where(eq(quotes.id, q.id))
  return q
}
