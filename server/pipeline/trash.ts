import { and, desc, eq, inArray, isNull, lte, or, like } from 'drizzle-orm'
import type { Ctx, Deps } from '../context.js'
import { assets, brollClips, candidates, characters, contentItems, jobs, refImages, sounds, trashItems } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { isVideoOp } from '../core/clips.js'
import { THUMB_WIDTHS, thumbKeyOf } from '../storage/assets.js'
import type { ContentOutputs } from './content.js'

// Delete and the Trash (owner, 2026-10-15; UX-PLAN.md section 22). An item
// deleted in the Library moves to the Trash and waits 7 days, restorable;
// then the daily clean removes its files from storage for good, thumbnails
// and plain copies included. A still, a take, a clip or an uploaded image
// is a candidate (its status becomes "trashed"); B-roll and sounds are
// archived; a render is the post's outputs (the post goes back to a draft).
// Auto-clean puts a post's never-kept takes here N days after the post is
// finished; starred takes never.

export const TRASH_DAYS = 7
export const DEFAULT_AUTO_CLEAN_DAYS = 14
const DAY = 86_400_000

export type TrashKind = 'candidate' | 'broll' | 'sound' | 'render'
export interface TrashRef { kind: TrashKind; id: string }
export interface TrashWarning { id: string; kind: TrashKind; text: string }
export interface TrashView {
  id: string; kind: TrashKind; refId: string; label: string; characterId: string | null; reason: 'owner' | 'auto'
  assetId: string | null; media: 'image' | 'video' | 'audio' | 'file' | null
  deletedAt: string; purgeAfter: string; daysLeft: number
}

const LIVE_POST = isNull(contentItems.archivedAt)
type Spec = Record<string, unknown> & { cut?: { shots?: Array<{ kind?: string; ref?: string }> } | null; sound?: { music?: string | null; ambience?: string | null } }

// Every post that uses an item: its clip or shot B, a picked still, a
// batch's clips, B-roll, a cut's shots, the sound bed.
function uses(spec: Spec, ref: TrashRef): boolean {
  const shots = spec.cut?.shots ?? []
  if (ref.kind === 'candidate') {
    const ids = [spec.clipId, spec.clipB, spec.stillId, ...(Array.isArray(spec.stillIds) ? spec.stillIds : []), ...(Array.isArray(spec.clipIds) ? spec.clipIds : [])]
    return ids.includes(ref.id) || shots.some(s => s.kind === 'clip' && s.ref === ref.id)
  }
  if (ref.kind === 'broll') return spec.brollId === ref.id || (Array.isArray(spec.brollIds) && spec.brollIds.includes(ref.id)) || shots.some(s => s.kind === 'broll' && s.ref === ref.id)
  if (ref.kind === 'sound') return spec.sound?.music === ref.id || spec.sound?.ambience === ref.id
  return false
}

const postName = (p: { title: string; idea: string }) => p.title || p.idea.slice(0, 40) || 'Untitled post'

// What deleting these touches, in plain words: the posts that use them and
// a character's sheet refs. Shown before anything moves.
export async function trashWarnings(deps: Deps, ctx: Ctx, refs: TrashRef[]): Promise<TrashWarning[]> {
  const out: TrashWarning[] = []
  const posts = await deps.db.select({ id: contentItems.id, title: contentItems.title, idea: contentItems.idea, spec: contentItems.spec })
    .from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), LIVE_POST))
  const candIds = refs.filter(r => r.kind === 'candidate').map(r => r.id)
  const cands = candIds.length ? await deps.db.select({ id: candidates.id, assetId: candidates.assetId }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, candIds))) : []
  // A sheet ref: the candidate itself, or one with the same file.
  const refRows = candIds.length ? await deps.db.select({ refId: refImages.refId, characterId: refImages.characterId, candidateId: refImages.approvedCandidateId }).from(refImages).where(eq(refImages.accountId, ctx.accountId)) : []
  const refCands = refRows.length ? await deps.db.select({ id: candidates.id, assetId: candidates.assetId }).from(candidates).where(inArray(candidates.id, refRows.map(r => r.candidateId).filter((x): x is string => !!x))) : []
  const names = new Map((await deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.accountId, ctx.accountId))).map(c => [c.id, c.name]))
  for (const r of refs) {
    const using = posts.filter(p => uses(p.spec as Spec, r))
    if (using.length) out.push({ id: r.id, kind: r.kind, text: `Used in ${using.length === 1 ? '1 post' : `${using.length} posts`}: ${using.slice(0, 3).map(postName).join(', ')}${using.length > 3 ? ' and more' : ''}. ${using.length === 1 ? 'That post loses it' : 'Those posts lose it'} if it is removed for good.` })
    if (r.kind === 'candidate') {
      const asset = cands.find(c => c.id === r.id)?.assetId
      for (const ref of refRows) {
        const rc = refCands.find(c => c.id === ref.candidateId)
        if (ref.candidateId === r.id || (asset && rc?.assetId === asset)) out.push({ id: r.id, kind: r.kind, text: `${ref.refId} of ${names.get(ref.characterId) ?? 'a character'}'s sheet. Removing it for good breaks that sheet.` })
      }
    }
  }
  return out
}

async function snapshot(deps: Deps, ctx: Ctx, ref: TrashRef): Promise<{ label: string; characterId: string | null; assetIds: string[]; restore: Record<string, unknown> } | null> {
  const acct = ctx.accountId
  if (ref.kind === 'candidate') {
    const [c] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, acct), eq(candidates.id, ref.id)))
    if (!c || c.status === 'trashed' || c.status === 'purged') return null
    const plain = Object.values(((c.meta ?? {}) as { plain?: Record<string, string> }).plain ?? {})
    const label = c.label || (isVideoOp(c.op) ? (c.op === 'clone' ? 'Recreate take' : c.op === 'upload' ? 'Uploaded clip' : 'Take') : c.op === 'upload_image' ? 'Uploaded image' : 'Still')
    return { label, characterId: c.characterId, assetIds: [c.assetId, ...plain].filter((x): x is string => !!x), restore: { status: c.status } }
  }
  if (ref.kind === 'broll') {
    const [b] = await deps.db.select().from(brollClips).where(and(eq(brollClips.accountId, acct), eq(brollClips.id, ref.id)))
    if (!b || b.archivedAt) return null
    return { label: `B-roll: ${b.title || 'clip'}`, characterId: null, assetIds: b.assetId ? [b.assetId] : [], restore: {} }
  }
  if (ref.kind === 'sound') {
    const [s] = await deps.db.select().from(sounds).where(and(eq(sounds.accountId, acct), eq(sounds.id, ref.id)))
    if (!s || s.archivedAt) return null
    return { label: `${s.kind === 'music' ? 'Music' : s.kind === 'voice' ? 'Voice line' : 'Ambience'}: ${s.title || 'sound'}`, characterId: s.characterId, assetIds: s.assetId ? [s.assetId] : [], restore: {} }
  }
  const [p] = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, acct), eq(contentItems.id, ref.id)))
  if (!p || p.archivedAt) return null
  const o = (p.outputs ?? {}) as ContentOutputs
  const ids = [o.videoAssetId, o.zipAssetId, ...(o.imageAssetIds ?? []), ...(o.videos ?? []).map(v => v?.assetId), ...(o.zipParts ?? []).map(z => z.assetId)].filter((x): x is string => !!x)
  if (!ids.length) return null
  return { label: `Render: ${postName(p)}`, characterId: p.characterId, assetIds: [...new Set(ids)], restore: { outputs: o, status: p.status } }
}

// Into the Trash. Nothing is removed from storage here.
export async function trash(deps: Deps, ctx: Ctx, refs: TrashRef[], opts: { reason?: 'owner' | 'auto' } = {}): Promise<{ moved: number; ids: string[] }> {
  const now = deps.clock.now()
  let moved = 0
  const ids: string[] = []
  for (const ref of refs) {
    const snap = await snapshot(deps, ctx, ref)
    if (!snap) continue
    if (ref.kind === 'candidate') await deps.db.update(candidates).set({ status: 'trashed', updatedAt: now }).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, ref.id)))
    else if (ref.kind === 'broll') await deps.db.update(brollClips).set({ archivedAt: now, updatedAt: now }).where(and(eq(brollClips.accountId, ctx.accountId), eq(brollClips.id, ref.id)))
    else if (ref.kind === 'sound') await deps.db.update(sounds).set({ archivedAt: now, updatedAt: now }).where(and(eq(sounds.accountId, ctx.accountId), eq(sounds.id, ref.id)))
    else await deps.db.update(contentItems).set({ outputs: {}, status: 'draft', updatedAt: now }).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, ref.id)))
    const id = newId('trash')
    ids.push(id)
    await deps.db.insert(trashItems).values({
      id, accountId: ctx.accountId, kind: ref.kind, refId: ref.id, label: snap.label.slice(0, 200), characterId: snap.characterId,
      assetIds: snap.assetIds, restore: snap.restore, reason: opts.reason ?? 'owner', deletedBy: opts.reason === 'auto' ? null : ctx.userId,
      deletedAt: now, purgeAfter: new Date(now.getTime() + TRASH_DAYS * DAY),
    })
    moved++
  }
  return { moved, ids }
}

// Back where it was.
export async function restore(deps: Deps, ctx: Ctx, trashIds: string[]): Promise<{ restored: number }> {
  if (!trashIds.length) return { restored: 0 }
  const rows = await deps.db.select().from(trashItems).where(and(eq(trashItems.accountId, ctx.accountId), inArray(trashItems.id, trashIds), isNull(trashItems.restoredAt), isNull(trashItems.purgedAt)))
  const now = deps.clock.now()
  for (const t of rows) {
    const r = t.restore as { status?: string; outputs?: ContentOutputs }
    if (t.kind === 'candidate') await deps.db.update(candidates).set({ status: r.status ?? 'approved', updatedAt: now }).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, t.refId)))
    else if (t.kind === 'broll') await deps.db.update(brollClips).set({ archivedAt: null, updatedAt: now }).where(and(eq(brollClips.accountId, ctx.accountId), eq(brollClips.id, t.refId)))
    else if (t.kind === 'sound') await deps.db.update(sounds).set({ archivedAt: null, updatedAt: now }).where(and(eq(sounds.accountId, ctx.accountId), eq(sounds.id, t.refId)))
    else await deps.db.update(contentItems).set({ outputs: r.outputs ?? {}, status: r.status ?? 'ready', updatedAt: now }).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, t.refId)))
    await deps.db.update(trashItems).set({ restoredAt: now }).where(eq(trashItems.id, t.id))
  }
  return { restored: rows.length }
}

export async function listTrash(deps: Deps, ctx: Ctx): Promise<TrashView[]> {
  const rows = await deps.db.select().from(trashItems).where(and(eq(trashItems.accountId, ctx.accountId), isNull(trashItems.restoredAt), isNull(trashItems.purgedAt))).orderBy(desc(trashItems.deletedAt)).limit(500)
  const first = rows.map(r => (r.assetIds as string[])[0]).filter((x): x is string => !!x)
  const kinds = new Map(first.length ? (await deps.db.select({ id: assets.id, kind: assets.kind }).from(assets).where(inArray(assets.id, first))).map(a => [a.id, a.kind]) : [])
  const now = deps.clock.now().getTime()
  return rows.map(r => {
    const assetId = (r.assetIds as string[])[0] ?? null
    return {
      id: r.id, kind: r.kind as TrashKind, refId: r.refId, label: r.label, characterId: r.characterId, reason: r.reason === 'auto' ? 'auto' : 'owner',
      assetId, media: assetId ? (kinds.get(assetId) as TrashView['media']) ?? null : null,
      deletedAt: r.deletedAt.toISOString(), purgeAfter: r.purgeAfter.toISOString(), daysLeft: Math.max(0, Math.ceil((r.purgeAfter.getTime() - now) / DAY)),
    }
  })
}

// Is a file still used by something that is not in the Trash? Then its
// storage stays (one file can back two items, e.g. a still and its copy).
async function assetInUse(deps: Deps, accountId: string, assetId: string, exceptTrash: string): Promise<boolean> {
  const cands = await deps.db.select({ id: candidates.id, status: candidates.status }).from(candidates).where(and(eq(candidates.accountId, accountId), eq(candidates.assetId, assetId)))
  if (cands.some(c => c.status !== 'trashed' && c.status !== 'purged')) return true
  const [b] = await deps.db.select({ id: brollClips.id }).from(brollClips).where(and(eq(brollClips.accountId, accountId), eq(brollClips.assetId, assetId), isNull(brollClips.archivedAt)))
  if (b) return true
  const [s] = await deps.db.select({ id: sounds.id }).from(sounds).where(and(eq(sounds.accountId, accountId), eq(sounds.assetId, assetId), isNull(sounds.archivedAt)))
  if (s) return true
  // Another item still in the Trash keeps it until that one goes too.
  const others = await deps.db.select({ id: trashItems.id, assetIds: trashItems.assetIds }).from(trashItems)
    .where(and(eq(trashItems.accountId, accountId), isNull(trashItems.purgedAt), isNull(trashItems.restoredAt)))
  if (others.some(t => t.id !== exceptTrash && (t.assetIds as string[]).includes(assetId))) return true
  // A live post's render (its outputs) keeps the file too.
  const posts = await deps.db.select({ outputs: contentItems.outputs }).from(contentItems).where(and(eq(contentItems.accountId, accountId), LIVE_POST))
  return posts.some(p => JSON.stringify(p.outputs ?? {}).includes(assetId))
}

// Gone for good: items in the Trash past their 7 days. Their files and
// thumbnails leave storage; the records stay, marked purged.
export async function purgeDue(deps: Deps, ctx: Ctx): Promise<{ items: number; files: number }> {
  const now = deps.clock.now()
  const due = await deps.db.select().from(trashItems).where(and(eq(trashItems.accountId, ctx.accountId), isNull(trashItems.restoredAt), isNull(trashItems.purgedAt), lte(trashItems.purgeAfter, now)))
  let files = 0
  for (const t of due) {
    for (const assetId of t.assetIds as string[]) {
      if (await assetInUse(deps, ctx.accountId, assetId, t.id)) continue
      const [a] = await deps.db.select().from(assets).where(and(eq(assets.accountId, ctx.accountId), eq(assets.id, assetId)))
      if (!a || a.archivedAt) continue
      for (const key of [a.storageKey, ...THUMB_WIDTHS.map(w => thumbKeyOf(a.storageKey, w))]) {
        if (await deps.store.exists(key)) { await deps.store.delete(key); files++ }
      }
      await deps.db.update(assets).set({ archivedAt: now }).where(eq(assets.id, a.id))
    }
    if (t.kind === 'candidate') await deps.db.update(candidates).set({ status: 'purged', updatedAt: now }).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, t.refId)))
    await deps.db.update(trashItems).set({ purgedAt: now }).where(eq(trashItems.id, t.id))
  }
  return { items: due.length, files }
}

// Auto-clean: takes never kept (not Use this take, not Keep this take) go to
// the Trash `days` after their post was finished. Starred takes, the post's
// own clips and anything a live post uses are never touched.
export async function autoClean(deps: Deps, ctx: Ctx, days: number | null): Promise<{ moved: number }> {
  if (!days) return { moved: 0 }
  const cutoff = deps.clock.now().getTime() - days * DAY
  const posts = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), LIVE_POST, eq(contentItems.status, 'ready')))
  const finished = posts.filter(p => {
    const at = (p.outputs as ContentOutputs | null)?.renderedAt
    return (at ? Date.parse(at) : p.updatedAt.getTime()) <= cutoff
  })
  const usedSpecs = posts.map(p => p.spec as Spec)
  const refs: TrashRef[] = []
  for (const p of finished) {
    const runs = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), like(jobs.purpose, `clone:${p.id}:%`)))
    const scope = [
      ...(runs.length ? [inArray(candidates.jobId, runs.map(r => r.id))] : []),
      ...(p.sceneId ? [eq(candidates.sceneId, p.sceneId)] : []),
    ]
    if (!scope.length) continue
    const takes = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), or(...scope)))
    for (const c of takes) {
      if (!isVideoOp(c.op) || c.op === 'upload' || !c.assetId) continue
      if (c.favorite || c.status === 'approved' || c.status === 'trashed' || c.status === 'purged') continue
      if (usedSpecs.some(s => uses(s, { kind: 'candidate', id: c.id }))) continue
      if (!refs.some(r => r.id === c.id)) refs.push({ kind: 'candidate', id: c.id })
    }
  }
  return trash(deps, ctx, refs, { reason: 'auto' })
}

export function parseRefs(input: unknown): TrashRef[] {
  if (!Array.isArray(input) || input.length > 200) throw new AppError('bad_request', 'Pick between 1 and 200 items.')
  const kinds: TrashKind[] = ['candidate', 'broll', 'sound', 'render']
  return input.map(x => {
    const r = x as { kind?: unknown; id?: unknown }
    if (!kinds.includes(r.kind as TrashKind) || typeof r.id !== 'string' || r.id.length > 60) throw new AppError('bad_request', 'That is not an item of the Library.')
    return { kind: r.kind as TrashKind, id: r.id }
  })
}
