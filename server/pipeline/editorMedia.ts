import { and, eq, inArray, isNotNull, like, or } from 'drizzle-orm'
import type { Ctx, Deps } from '../context.js'
import { candidates, jobs } from '../db/schema.js'
import { isVideoOp } from '../core/clips.js'
import { getAsset } from '../storage/assets.js'
import { getContent, listBroll } from './content.js'
import { libraryView } from './clips.js'
import { listSounds } from './sounds.js'
import { directLink } from './openreel.js'

// The editor's Add media, Studio first (owner, 2026-10-15; UX-PLAN.md
// section 21): this post's takes and stills, this character's clips and
// stills, then the Library (B-roll, sounds, other characters' clips). From
// computer stays as the picker's second tab. Each item carries a direct
// storage link, like the post's own media (see EditorMedia).

export interface PickerItem { id: string; name: string; kind: 'video' | 'image' | 'audio'; url: string; src: string | null; thumb: string | null; duration: number | null }
export interface PickerGroup { id: 'post' | 'clips' | 'stills' | 'library'; label: string; items: PickerItem[] }

const assetUrl = (id: string) => `/api/v1/assets/${id}/content`
// `cors=1`: the editor shows them with CORS (its page is cross-origin
// isolated), so they get their own storage link (BlobStore.presignGet).
const thumbUrl = (id: string) => `/api/v1/assets/${id}/content?w=320&cors=1`
const LIVE = ['approved', 'in_review', 'qa_failed']

export async function editorLibrary(deps: Deps, ctx: Ctx, contentId: string): Promise<{ groups: PickerGroup[] }> {
  const post = await getContent(deps, ctx, contentId)
  const spec = (post.spec ?? {}) as { clipId?: string | null; clipB?: string | null }
  const seen = new Set<string>()
  const item = async (assetId: string, name: string, kind: PickerItem['kind'], poster: string | null = null, duration: number | null = null): Promise<PickerItem | null> => {
    if (!assetId || seen.has(assetId)) return null
    seen.add(assetId)
    const asset = duration == null && kind !== 'image' ? await getAsset(deps, ctx, assetId).catch(() => null) : null
    return {
      id: assetId, name, kind, url: assetUrl(assetId), src: await directLink(deps, ctx, assetId),
      thumb: kind === 'image' ? thumbUrl(assetId) : poster ? thumbUrl(poster) : null,
      duration: duration ?? (asset?.durationMs ? Math.round(asset.durationMs / 100) / 10 : null),
    }
  }
  const keep = (xs: Array<PickerItem | null>) => xs.filter((x): x is PickerItem => !!x)

  // This post: the clip it uses, its Recreate takes and stills, its scene's
  // takes and stills.
  const runs = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), or(like(jobs.purpose, `clone:${post.id}:%`), like(jobs.purpose, `clone_still:${post.id}:%`), like(jobs.purpose, `clone_face:${post.id}:%`))))
  const own = [spec.clipId, spec.clipB].filter((x): x is string => !!x)
  const rows = await deps.db.select().from(candidates).where(and(
    eq(candidates.accountId, ctx.accountId), isNotNull(candidates.assetId), inArray(candidates.status, LIVE),
    or(
      ...(own.length ? [inArray(candidates.id, own)] : []),
      ...(runs.length ? [inArray(candidates.jobId, runs.map(r => r.id))] : []),
      ...(post.sceneId ? [eq(candidates.sceneId, post.sceneId)] : []),
      eq(candidates.id, '__none__'),
    ),
  ))
  rows.sort((a, b) => Number(!own.includes(a.id)) - Number(!own.includes(b.id)) || Number(!isVideoOp(a.op)) - Number(!isVideoOp(b.op)) || b.createdAt.getTime() - a.createdAt.getTime())
  // A take's thumbnail is the still it started from.
  const parentIds = [...new Set(rows.filter(c => isVideoOp(c.op) && c.parentId).map(c => c.parentId!))]
  const parents = parentIds.length ? await deps.db.select({ id: candidates.id, assetId: candidates.assetId, op: candidates.op }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, parentIds))) : []
  const poster = new Map(parents.filter(p => !isVideoOp(p.op) && p.assetId).map(p => [p.id, p.assetId!]))
  const postItems: Array<PickerItem | null> = []
  let takes = 0, stills = 0
  for (const c of rows) {
    const video = isVideoOp(c.op)
    const n = video ? ++takes : ++stills
    const name = own.includes(c.id) ? (own.indexOf(c.id) === 0 ? 'The clip in this post' : 'Shot B') : video ? `Take ${n}` : c.op === 'clone_still' ? `Recreate still ${n}` : `Still ${n}`
    postItems.push(await item(c.assetId!, name, video ? 'video' : 'image', c.parentId ? poster.get(c.parentId) ?? null : null))
  }

  // This character's clips and stills (the Library's, kept ones).
  const mine = post.characterId ? await libraryView(deps, ctx, { characterId: post.characterId }) : { clips: [], stills: [] }
  const clipItems = await Promise.all(mine.clips.filter(c => c.status === 'approved' && c.assetId).map(c => item(c.assetId, c.title || 'Clip', 'video', c.posterId, c.durationSec)))
  const stillItems = await Promise.all(mine.stills.map(s => item(s.assetId, s.sceneTitle || 'Still', 'image')))
  const name = mine.clips[0]?.characterName ?? mine.stills[0]?.characterName ?? 'This character'

  // The Library: B-roll, music and ambience, other characters' clips.
  const broll = (await listBroll(deps, ctx)).filter(b => b.status === 'ready' && b.assetId)
  const sounds = (await listSounds(deps, ctx)).filter(s => s.status === 'ready' && s.assetId)
  const others = post.characterId
    ? (await libraryView(deps, ctx)).clips.filter(c => c.characterId !== post.characterId && c.status === 'approved' && c.assetId).slice(0, 40)
    : []
  const libraryItems = [
    ...await Promise.all(broll.map(b => item(b.assetId!, `B-roll: ${b.title || 'clip'}`, 'video'))),
    ...await Promise.all(sounds.map(s => item(s.assetId!, `${s.kind === 'music' ? 'Music' : 'Ambience'}: ${s.title || 'sound'}`, 'audio', null, s.durationMs ? Math.round(s.durationMs / 100) / 10 : null))),
    ...await Promise.all(others.map(c => item(c.assetId, `${c.characterName}: ${c.title || 'clip'}`, 'video', c.posterId, c.durationSec))),
  ]

  return {
    groups: [
      { id: 'post', label: "This post's takes and stills", items: keep(postItems) },
      { id: 'clips', label: `${name}'s clips`, items: keep(clipItems) },
      { id: 'stills', label: `${name}'s stills`, items: keep(stillItems) },
      { id: 'library', label: 'Library', items: keep(libraryItems) },
    ],
  }
}
