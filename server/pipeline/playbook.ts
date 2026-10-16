import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { characters, contentItems, socialAccounts } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { STRUCTURE_CODES, readCode, type StructureCode } from '../core/playbook.js'

// The playbook per account (UX-PLAN.md section 28): each account's primary
// and backup structure (the Accounts card, else the playbook's fit table in
// config/content.yaml, by tag or by its character's name), and the code of
// the post before this one, which the next post never repeats.

const isCode = (c: unknown): c is StructureCode => typeof c === 'string' && (STRUCTURE_CODES as readonly string[]).includes(c)

export function fitFor(deps: Deps, keys: Array<string | null | undefined>): { primary: StructureCode | null; backup: StructureCode | null } {
  const fit = deps.config.pipeline.content.playbook.fit
  const byKey = new Map(Object.entries(fit).map(([k, v]) => [k.trim().toUpperCase(), v]))
  for (const k of keys) {
    const hit = k ? byKey.get(k.trim().replace(/^@+/, '').toUpperCase()) : undefined
    if (hit) return { primary: isCode(hit[0]) ? hit[0] : null, backup: isCode(hit[1]) ? hit[1] : null }
  }
  return { primary: null, backup: null }
}

// Schedule order: a plan post by its day and slot (AM, then Daily, then
// PM), then when it was made.
const SLOT_ORDER: Record<string, number> = { am: 0, daily: 1, pm: 2 }
interface Placed { id: string; date: string; slot: string; createdAt: Date; code: StructureCode | null }
const order = (a: Placed, b: Placed) => (a.date || '9999').localeCompare(b.date || '9999') || (SLOT_ORDER[a.slot.toLowerCase()] ?? 1) - (SLOT_ORDER[b.slot.toLowerCase()] ?? 1) || a.createdAt.getTime() - b.createdAt.getTime()

// The code of the post just before `postId` on this account (or of the
// account's latest post when the post has no place yet).
export function codeBefore(posts: Placed[], postId: string | null): StructureCode | null {
  const sorted = [...posts].sort(order)
  const at = postId ? sorted.findIndex(p => p.id === postId) : -1
  const me = at >= 0 ? sorted[at]! : null
  const before = me && (me.date || me.slot) ? sorted.slice(0, at) : sorted.filter(p => p.id !== postId)
  for (let i = before.length - 1; i >= 0; i--) if (before[i]!.code) return before[i]!.code
  return null
}

export async function accountStructures(deps: Deps, ctx: Ctx, tag: string, o: { postId?: string | null; characterId?: string | null } = {}): Promise<{ primary: StructureCode | null; backup: StructureCode | null; last: StructureCode | null; owner: boolean }> {
  const clean = tag.trim()
  const [saved] = clean ? await deps.db.select().from(socialAccounts).where(and(eq(socialAccounts.accountId, ctx.accountId), eq(socialAccounts.tag, clean))) : []
  const charId = saved?.characterId ?? o.characterId ?? null
  const [ch] = charId ? await deps.db.select({ name: characters.name }).from(characters).where(and(eq(characters.accountId, ctx.accountId), eq(characters.id, charId))) : []
  const fit = fitFor(deps, [clean, ch?.name])
  const primary = isCode(saved?.primaryCode) ? saved!.primaryCode as StructureCode : fit.primary
  const backup = isCode(saved?.backupCode) ? saved!.backupCode as StructureCode : fit.backup
  const last = clean ? codeBefore(await placedPosts(deps, ctx, clean), o.postId ?? null) : null
  return { primary, backup, last, owner: !!(saved?.primaryCode || saved?.backupCode) }
}

// The account's posts with their place in the schedule and their code.
export async function placedPosts(deps: Deps, ctx: Ctx, tag: string): Promise<Placed[]> {
  const rows = await deps.db.select({ id: contentItems.id, createdAt: contentItems.createdAt, plan: sql<Record<string, unknown> | null>`${contentItems.spec}->'plan'` })
    .from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.accountTag, tag), isNull(contentItems.archivedAt), ne(contentItems.kind, 'batch')))
  return rows.map(r => ({
    id: r.id, createdAt: r.createdAt,
    date: String(r.plan?.date ?? ''), slot: String(r.plan?.slot ?? ''),
    code: readCode(typeof r.plan?.structure === 'string' ? r.plan.structure : null),
  }))
}
