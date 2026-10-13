import { and, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
import { ledgerEntries } from '../db/schema.js'
import type { Db } from '../db/client.js'
import { newId } from '../lib/ids.js'

export type EntryType = 'hold' | 'release' | 'charge' | 'refund' | 'adjustment'
export type LedgerInsert = Omit<typeof ledgerEntries.$inferInsert, 'id'>

// Append-only. Corrections are new rows (adjustment), never edits.
export async function appendLedger(db: Db, rows: LedgerInsert[]): Promise<void> {
  if (!rows.length) return
  await db.insert(ledgerEntries).values(rows.map(r => ({ id: newId('led'), ...r })))
}

export interface LedgerFilter {
  characterId?: string
  since?: Date
  until?: Date
  stage?: string
}

function where(accountId: string, f: LedgerFilter, types: EntryType[]): SQL {
  const conds: SQL[] = [eq(ledgerEntries.accountId, accountId), inArray(ledgerEntries.entryType, types)]
  if (f.characterId) conds.push(eq(ledgerEntries.characterId, f.characterId))
  if (f.stage) conds.push(eq(ledgerEntries.stage, f.stage))
  if (f.since) conds.push(gte(ledgerEntries.createdAt, f.since))
  if (f.until) conds.push(lt(ledgerEntries.createdAt, f.until))
  return and(...conds)!
}

async function sum(db: Db, accountId: string, f: LedgerFilter, types: EntryType[]): Promise<number> {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMicros}), 0)` })
    .from(ledgerEntries).where(where(accountId, f, types))
  return Number(row?.total ?? 0)
}

// Real money spent (charges net of refunds and adjustments).
export const spentMicros = (db: Db, accountId: string, f: LedgerFilter = {}) => sum(db, accountId, f, ['charge', 'refund', 'adjustment'])

// Money reserved by runs that have not finished yet.
export const heldMicros = (db: Db, accountId: string, f: LedgerFilter = {}) => sum(db, accountId, f, ['hold', 'release'])

export async function spendByStage(db: Db, accountId: string, f: LedgerFilter = {}): Promise<Array<{ stage: string; micros: number }>> {
  const rows = await db.select({ stage: ledgerEntries.stage, total: sql<string>`sum(${ledgerEntries.amountMicros})` })
    .from(ledgerEntries).where(where(accountId, f, ['charge', 'refund', 'adjustment'])).groupBy(ledgerEntries.stage)
  return rows.map(r => ({ stage: r.stage, micros: Number(r.total) }))
}

export function monthWindow(now: Date): { since: Date; until: Date } {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { since, until }
}
