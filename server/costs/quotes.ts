import { and, eq, sql } from 'drizzle-orm'
import { quotes } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import type { CostEstimate } from '../providers/types.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { sha256Hex } from '../lib/passwords.js'
import { checkBudget, dayValue, type BudgetCheck } from './budgets.js'
import { formatUsd } from './money.js'
import { stableStringify } from './stableJson.js'

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
  // Plan credits on the Higgsfield account path, and the price as shown:
  // dollars, credits, or both ("70 credits + $0.03").
  credits: number
  display: string
  verified: boolean
  items: Array<{ label: string; model: string; modelLabel: string; amount: string; amountMicros: number; credits: number | null; verified: boolean }>
  // The models that will run, by name, shown next to the price.
  models: string[]
  // Why a price is not a fresh live one (Higgsfield was slow), once each.
  notes: string[]
  budget: BudgetCheck
  status: 'open' | 'blocked'
  expiresAt: string
  needsConfirm: boolean
}

// A model's name as people know it ("Claude Sonnet 5.5", "Nano Banana 2.1").
// Demo mode runs free mocks, and says so.
export function modelLabel(deps: Pick<Deps, 'config'>, ref: string): string {
  if (ref.startsWith('mock/')) return 'Demo mock, free'
  const { models, llm_models } = deps.config.models
  return llm_models.find(m => m.ref === ref)?.label ?? models.find(m => m.ref === ref)?.label ?? ref
}

export function formatCredits(credits: number): string {
  const n = Math.round(credits * 100) / 100
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`
}

// Credit items show credits; everything else shows dollars.
export function displayPrice(items: Array<{ amountMicros: number; credits?: number | null }>): string {
  const credits = items.reduce((s, i) => s + (i.credits ?? 0), 0)
  const usd = items.filter(i => i.credits == null).reduce((s, i) => s + i.amountMicros, 0)
  const hasCredits = items.some(i => i.credits != null)
  const parts: string[] = []
  if (hasCredits) parts.push(formatCredits(credits))
  if (!hasCredits || usd > 0) parts.push(formatUsd(usd))
  return parts.join(' + ')
}

export function fingerprintItems(purpose: string, characterId: string | null, items: Array<Pick<QuoteItem, 'provider' | 'model' | 'kind' | 'request'>>): string {
  return sha256Hex(stableStringify({ purpose, characterId, items: items.map(i => ({ p: i.provider, m: i.model, k: i.kind, r: i.request })) }))
}

// What a run counts toward today's cap (section 31): its plan credits at
// the price book's API rate, its dollars as they are; for a run queued in
// groups (Generate N posts), only what starts now (each later group is
// checked when its turn comes).
export function runDayMicros(deps: Pick<Deps, 'config'>, items: Array<{ estimate: { totalMicros: number; credits?: number } }>, startNow?: boolean[]): number {
  return dayValue(items.filter((_, i) => startNow?.[i] !== false).map(i => ({ amountMicros: i.estimate.totalMicros, credits: i.estimate.credits ?? null })), deps.config.pricebook.api_credit_usd)
}

export async function createQuote(deps: Deps, ctx: Ctx, input: { purpose: string; characterId: string | null; items: QuoteItem[]; startNow?: boolean[] }): Promise<QuoteView> {
  if (!input.items.length) throw new AppError('bad_request', 'Nothing to quote.')
  const total = input.items.reduce((s, i) => s + i.estimate.totalMicros, 0)
  const now = deps.clock.now()
  const budget = await checkBudget(deps.db, ctx.accountId, deps.config.budgets, now, total, input.characterId, { dayMicros: runDayMicros(deps, input.items, input.startNow), creditUsd: deps.config.pricebook.api_credit_usd })
  const id = newId('qte')
  const expiresAt = new Date(now.getTime() + deps.config.runtime.jobs.quote_ttl_sec * 1000)
  const status = budget.ok ? 'open' : 'blocked'
  const items = input.items.map(i => ({
    label: i.label, provider: i.provider, model: i.model, kind: i.kind,
    amountMicros: i.estimate.totalMicros, verified: i.estimate.verified, lines: i.estimate.lines, priceVersion: i.estimate.priceVersion,
    credits: i.estimate.credits ?? null,
  }))
  await deps.db.insert(quotes).values({
    id, accountId: ctx.accountId, userId: ctx.userId, characterId: input.characterId, purpose: input.purpose,
    fingerprint: fingerprintItems(input.purpose, input.characterId, input.items),
    items, totalMicros: total, budget, status, expiresAt,
  })
  // Demo mode runs the free mock in place of a real model; a generation
  // names the model it stands in for, so the button reads as it will live
  // (section 30: model and price on every generate button).
  const labels = input.items.map(i => {
    const stands = i.provider === 'mock' ? (i.request as { modelRef?: string } | null)?.modelRef : undefined
    return stands && !stands.startsWith('mock/') ? `${modelLabel(deps, stands)} (demo mock, free)` : modelLabel(deps, `${i.provider}/${i.model}`)
  })
  return {
    id, purpose: input.purpose, characterId: input.characterId, totalMicros: total, total: formatUsd(total),
    credits: items.reduce((s, i) => s + (i.credits ?? 0), 0),
    display: displayPrice(items),
    verified: input.items.every(i => i.estimate.verified),
    items: items.map((i, k) => ({ label: i.label, model: `${i.provider}/${i.model}`, modelLabel: labels[k]!, amount: i.credits != null ? formatCredits(i.credits) : formatUsd(i.amountMicros), amountMicros: i.amountMicros, credits: i.credits, verified: i.verified })),
    models: [...new Set(labels)],
    notes: [...new Set(input.items.map(i => i.estimate.note).filter((n): n is string => !!n))],
    budget, status, expiresAt: expiresAt.toISOString(), needsConfirm: budget.needsConfirm,
  }
}

// Validates and consumes a quote inside the run's transaction. Re-checks the
// budget, because spend may have changed since the quote was shown.
export async function consumeQuote(tx: Db, deps: Deps, ctx: Ctx, quoteId: string | undefined, purpose: string, characterId: string | null, items: QuoteItem[], confirmed: boolean, startNow?: boolean[]): Promise<typeof quotes.$inferSelect> {
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
  const budget = await checkBudget(tx, ctx.accountId, deps.config.budgets, deps.clock.now(), q.totalMicros, characterId, { dayMicros: runDayMicros(deps, items, startNow), creditUsd: deps.config.pricebook.api_credit_usd })
  if (!budget.ok) {
    await tx.update(quotes).set({ status: 'blocked', budget }).where(eq(quotes.id, q.id))
    throw new AppError('budget_exceeded', budget.messages[0] ?? 'This run would go over a budget cap.', budget.blocks)
  }
  if (budget.needsConfirm && !confirmed) {
    throw new AppError('bad_request', `This run costs ${displayPrice(q.items as Array<{ amountMicros: number; credits?: number | null }>)}. Confirm to continue.`, { needsConfirm: true })
  }
  await tx.update(quotes).set({ status: 'used', usedAt: deps.clock.now() }).where(eq(quotes.id, q.id))
  return q
}
