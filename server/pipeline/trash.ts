import { and, desc, eq, inArray, isNull, lte, or, like } from 'drizzle-orm'
import type { Ctx, Deps } from '../context.js'
import { assets, brollClips, candidates, characters, contentItems, jobs, refImages, slideScenes, sounds, trashItems } from '../db/schema.js'
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
const GONE = ['trashed', 'purged']

// Every item, file, B-roll clip or sound a post names: in its fields, its
// render, and its saved editor timeline (a small JSON file listing the
// media picked into it). Null when a saved timeline cannot be read: then
// nothing is known for sure, and nothing is removed.
const TOKEN = /\b(?:cand|ast|brl|snd)_[0-9a-z]{6,}/g
const tokensOf = (x: unknown, into: Set<string>) => { for (const m of JSON.stringify(x ?? null).matchAll(TOKEN)) into.add(m[0]) }
type PostRow = typeof contentItems.$inferSelect
async function namedByPosts(deps: Deps, ctx: Ctx, posts: PostRow[]): Promise<Map<string, Set<string>> | null> {
  const out = new Map<string, Set<string>>()
  for (const p of posts) {
    const names = new Set<string>()
    tokensOf(p.spec, names)
    tokensOf(p.outputs, names)
    const project = (p.spec as { editor?: { projectAssetId?: string | null } | null } | null)?.editor?.projectAssetId
    if (project) {
      const [row] = await deps.db.select().from(assets).where(and(eq(assets.accountId, ctx.accountId), eq(assets.id, project)))
      if (row && !row.archivedAt && (await deps.store.exists(row.storageKey))) {
        try { tokensOf((await deps.store.get(row.storageKey)).toString('utf8'), names) } catch { return null }
      }
    }
    out.set(p.id, names)
  }
  return out
}
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
  const fullPosts = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), LIVE_POST))
  const named = await namedByPosts(deps, ctx, fullPosts)
  for (const r of refs) {
    const file = r.kind === 'candidate' ? cands.find(c => c.id === r.id)?.assetId ?? null : null
    const using = posts.filter(p => uses(p.spec as Spec, r) || (!!named && (named.get(p.id)!.has(r.id) || (!!file && named.get(p.id)!.has(file)))))
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
// `named`: every item and file any post (archived ones too) or character
// names, timelines included.
async function assetInUse(deps: Deps, accountId: string, assetId: string, exceptTrash: string, named: Set<string>): Promise<boolean> {
  if (named.has(assetId)) return true
  const cands = await deps.db.select({ id: candidates.id, status: candidates.status }).from(candidates).where(and(eq(candidates.accountId, accountId), eq(candidates.assetId, assetId)))
  if (cands.some(c => c.status !== 'trashed' && c.status !== 'purged')) return true
  const [b] = await deps.db.select({ id: brollClips.id }).from(brollClips).where(and(eq(brollClips.accountId, accountId), eq(brollClips.assetId, assetId), isNull(brollClips.archivedAt)))
  if (b) return true
  const [s] = await deps.db.select({ id: sounds.id }).from(sounds).where(and(eq(sounds.accountId, accountId), eq(sounds.assetId, assetId), isNull(sounds.archivedAt)))
  if (s) return true
  // Another item still in the Trash keeps it until that one goes too.
  const others = await deps.db.select({ id: trashItems.id, assetIds: trashItems.assetIds }).from(trashItems)
    .where(and(eq(trashItems.accountId, accountId), isNull(trashItems.purgedAt), isNull(trashItems.restoredAt)))
  return others.some(t => t.id !== exceptTrash && (t.assetIds as string[]).includes(assetId))
}

// Everything named by any post or character (null: a timeline could not be read).
async function namedAnywhere(deps: Deps, ctx: Ctx): Promise<Set<string> | null> {
  const posts = await deps.db.select().from(contentItems).where(eq(contentItems.accountId, ctx.accountId))
  const byPost = await namedByPosts(deps, ctx, posts)
  if (!byPost) return null
  const all = new Set<string>()
  for (const names of byPost.values()) for (const n of names) all.add(n)
  for (const c of await deps.db.select().from(characters).where(eq(characters.accountId, ctx.accountId))) tokensOf(c, all)
  for (const r of await deps.db.select({ candidateId: refImages.approvedCandidateId }).from(refImages).where(eq(refImages.accountId, ctx.accountId))) if (r.candidateId) all.add(r.candidateId)
  // A saved slideshow scene's look picture (the Scene library).
  for (const r of await deps.db.select({ look: slideScenes.lookAssetId }).from(slideScenes).where(and(eq(slideScenes.accountId, ctx.accountId), isNull(slideScenes.archivedAt)))) if (r.look) all.add(r.look)
  return all
}

// Gone for good: items in the Trash past their 7 days. Their files and
// thumbnails leave storage; the records stay, marked purged.
export async function purgeDue(deps: Deps, ctx: Ctx): Promise<{ items: number; files: number }> {
  const now = deps.clock.now()
  const due = await deps.db.select().from(trashItems).where(and(eq(trashItems.accountId, ctx.accountId), isNull(trashItems.restoredAt), isNull(trashItems.purgedAt), lte(trashItems.purgeAfter, now)))
  if (!due.length) return { items: 0, files: 0 }
  const named = await namedAnywhere(deps, ctx)
  if (!named) {
    ctx.log.warn({ due: due.length }, 'trash not emptied: a saved editor timeline could not be read')
    return { items: 0, files: 0 }
  }
  let files = 0
  for (const t of due) {
    for (const assetId of t.assetIds as string[]) {
      if (await assetInUse(deps, ctx.accountId, assetId, t.id, named)) continue
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

// Auto-clean (owner, 2026-10-15: "never deletes, regardless of age"). Only
// two kinds of item are ever touched: takes never kept and stills never
// picked, from posts finished `days` ago. Everything below is protected,
// whatever its age:
//  1. a character's sheet refs (REF-00 to REF-11), heroes and anything in a
//     character file (and any item sharing one of their files);
//  2. a take kept with Keep this take or Use this take (kept is the same
//     as starred), and anything starred;
//  3. anything any post uses, live, posted, exported or archived: every
//     item or file named anywhere in a post or its render;
//  4. the stills, start and end frames a kept, starred or used item was
//     made from (all the way back);
//  5. saved clips and images in the Library (kept clips, uploads, clones).
// A scene shared by a post that is not finished yet is left alone.
export interface AutoCleanItem {
  id: string; kind: 'take' | 'still'; label: string; assetId: string | null; media: 'image' | 'video'
  characterId: string; postId: string; postName: string; finishedAt: string
}

const STILL_OPS = ['generate', 'edit', 'crop', 'upscale', 'mirror', 'drift_lock', 'end_frame', 'last_frame', 'clone_still', 'slide_topic']
type Decision = { decision?: { kind?: string } }

export async function autoCleanPlan(deps: Deps, ctx: Ctx, days: number | null): Promise<AutoCleanItem[]> {
  if (!days) return []
  const acct = ctx.accountId
  const now = deps.clock.now().getTime()
  const cutoff = now - days * DAY
  const posts = await deps.db.select().from(contentItems).where(eq(contentItems.accountId, acct))
  const finishedAt = (p: (typeof posts)[number]) => {
    const at = (p.outputs as ContentOutputs | null)?.renderedAt
    return at ? Date.parse(at) : p.updatedAt.getTime()
  }
  const finished = posts.filter(p => !p.archivedAt && p.status === 'ready' && finishedAt(p) <= cutoff)
  if (!finished.length) return []

  // 3. Every item and file any post names (archived posts, renders and
  // saved timelines included), and 1. the sheet refs and character files.
  // A timeline that cannot be read stops this Auto-clean: nothing moves.
  const named = await namedAnywhere(deps, ctx)
  if (!named) return []

  const all = await deps.db.select({
    id: candidates.id, parentId: candidates.parentId, status: candidates.status, favorite: candidates.favorite, meta: candidates.meta, op: candidates.op,
    target: candidates.target, refId: candidates.refId, assetId: candidates.assetId, jobId: candidates.jobId, sceneId: candidates.sceneId, characterId: candidates.characterId, label: candidates.label,
  }).from(candidates).where(eq(candidates.accountId, acct))
  const byId = new Map(all.map(c => [c.id, c]))
  const kept = (c: (typeof all)[number]) => c.favorite || c.status === 'approved' || (c.meta as Decision | null)?.decision?.kind === 'kept'
  const keeper = (c: (typeof all)[number]) =>
    kept(c) || c.target === 'hero' || c.target === 'sheet' || !!c.refId || c.op === 'upload' || c.op === 'upload_image' ||
    named.has(c.id) || (!!c.assetId && named.has(c.assetId))
  // A file shared with a keeper is a keeper's file.
  const keptFiles = new Set(all.filter(keeper).map(c => c.assetId).filter((x): x is string => !!x))
  const protectedIds = new Set(all.filter(c => keeper(c) || (!!c.assetId && keptFiles.has(c.assetId))).map(c => c.id))
  // 4. What a kept item was made from: its parents, and the start and end
  // frames its run named.
  const jobIds = [...new Set(all.filter(c => protectedIds.has(c.id) && c.jobId).map(c => c.jobId!))]
  const requests = jobIds.length ? await deps.db.select({ id: jobs.id, request: jobs.request }).from(jobs).where(inArray(jobs.id, jobIds)) : []
  const fromRuns = new Set<string>()
  for (const j of requests) tokensOf(j.request, fromRuns)
  const queue = [...protectedIds, ...all.filter(c => fromRuns.has(c.id) || (!!c.assetId && fromRuns.has(c.assetId))).map(c => c.id)]
  const walked = new Set<string>()
  while (queue.length) {
    const c = byId.get(queue.pop()!)
    if (!c || walked.has(c.id)) continue
    walked.add(c.id)
    protectedIds.add(c.id)
    if (c.parentId) queue.push(c.parentId)
  }

  // A scene is cleaned only when every live post on it is finished.
  const openScenes = new Set(posts.filter(p => !p.archivedAt && p.sceneId && !finished.includes(p)).map(p => p.sceneId!))
  const out: AutoCleanItem[] = []
  const seen = new Set<string>()
  for (const p of finished) {
    const runs = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, acct), or(like(jobs.purpose, `clone:${p.id}:%`), like(jobs.purpose, `clone_still:${p.id}%`), like(jobs.purpose, `clone_face:${p.id}%`), like(jobs.purpose, `slide_still:${p.id}%`))))
    const runIds = new Set(runs.map(r => r.id))
    const mine = all.filter(c => (c.jobId && runIds.has(c.jobId)) || (p.sceneId && c.sceneId === p.sceneId && !openScenes.has(p.sceneId)))
    for (const c of mine) {
      if (seen.has(c.id) || protectedIds.has(c.id) || !c.assetId || GONE.includes(c.status)) continue
      const take = isVideoOp(c.op)
      if (!take && !STILL_OPS.includes(c.op)) continue
      seen.add(c.id)
      out.push({
        id: c.id, kind: take ? 'take' : 'still', media: take ? 'video' : 'image', assetId: c.assetId, characterId: c.characterId,
        label: c.label || (take ? 'Take never kept' : 'Still never picked'), postId: p.id, postName: postName(p), finishedAt: new Date(finishedAt(p)).toISOString(),
      })
    }
  }
  return out
}

export async function autoClean(deps: Deps, ctx: Ctx, days: number | null): Promise<{ moved: number }> {
  const plan = await autoCleanPlan(deps, ctx, days)
  if (!plan.length) return { moved: 0 }
  return trash(deps, ctx, plan.map(x => ({ kind: 'candidate' as const, id: x.id })), { reason: 'auto' })
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
