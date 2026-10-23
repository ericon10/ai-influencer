import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, not, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { candidates, characters, contentItems, jobs, scenes } from '../db/schema.js'
import { postLine, postPlace } from '../core/postRow.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { VIDEO_OPS, isVideoOp } from '../core/clips.js'
import { transcodeBroll } from '../media/meme.js'
import { withTempDir } from '../media/ffmpeg.js'
import { extractFirstFrame } from '../media/frames.js'
import { getAsset, saveAsset } from '../storage/assets.js'
import { takeUploads, uploadKey } from '../storage/uploads.js'
import { getCharacter } from './characters.js'
import { getContent, updateContent, type BatchSpec } from './content.js'
import { MODEL_STUDIO, MODEL_UPLOAD, type LibraryQuery } from '../core/libraryFilter.js'
import { modelLabel } from '../costs/quotes.js'
import { collectionItemIds, collectionNamesOf } from './collections.js'
import { runFacts } from './sent.js'
import { livePostNames, postsUsing } from './trash.js'

// Uploaded clips (UX-PLAN.md): any video file the owner brings in becomes a
// clip of a character, kept, so it shows in Library > Clips and in every clip
// picker. The worker keeps a lean copy (H.264, no sound); the upload itself
// is then removed. Uploading from a post's Video step also picks it there.

export async function addClip(deps: Deps, ctx: Ctx, input: { characterId: string; uploadId: string; name: string; contentId?: string; slot?: 'a' | 'b' }): Promise<{ id: string }> {
  await getCharacter(deps, ctx, input.characterId)
  if (!/^upl_[a-z0-9]{20}$/.test(input.uploadId)) throw new AppError('bad_request', 'That upload id is not valid.')
  if (!(await deps.store.exists(uploadKey(ctx.accountId, input.uploadId)))) throw new AppError('bad_request', `${input.name} did not finish uploading. Try again.`)
  const post = input.contentId ? await getContent(deps, ctx, input.contentId) : null
  if (post && post.characterId !== input.characterId) throw new AppError('bad_request', 'That post belongs to another character.')
  const id = newId('cand')
  const title = input.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120)
  await deps.db.insert(candidates).values({
    id, accountId: ctx.accountId, characterId: input.characterId, target: 'clip', op: 'upload', status: 'generating',
    prompt: '', label: title, createdBy: ctx.userId,
  })
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `clip_ingest:${id}`, label: `Prepare clip: ${title}`, characterId: input.characterId, request: { uploadId: input.uploadId, title } })
  // A two-shot edit's shot B can be uploaded straight into its slot.
  if (post?.kind === 'meme') await updateContent(deps, ctx, post.id, { spec: input.slot === 'b' ? { clipB: id } : { clipId: id } })
  if (post?.kind === 'batch') await updateContent(deps, ctx, post.id, { spec: { clipIds: [...(post.spec as BatchSpec).clipIds ?? [], id].slice(-20) } })
  return { id }
}

// Uploaded images (owner, 2026-10-15): several at once, into Library >
// Stills for the character picked, and from there into a slideshow and the
// editor's Studio picker. Each is kept exactly as uploaded: the same bytes,
// full resolution, never downscaled, recompressed or converted (thumbnails
// for the grid are made separately on request). A slideshow's Stills step
// adds them to the slideshow itself.
export async function addStills(deps: Deps, ctx: Ctx, input: { characterId: string; uploads: Array<{ uploadId: string; name: string; type?: string }>; contentId?: string }): Promise<{ stills: Array<{ id: string; assetId: string; name: string }> }> {
  await getCharacter(deps, ctx, input.characterId)
  const post = input.contentId ? await getContent(deps, ctx, input.contentId) : null
  if (post && post.characterId !== input.characterId) throw new AppError('bad_request', 'That post belongs to another character.')
  const files = await takeUploads(deps, ctx, input.uploads)
  const stills: Array<{ id: string; assetId: string; name: string }> = []
  for (const f of files) {
    if (!f.mime.startsWith('image/')) throw new AppError('bad_request', `${f.name} is not an image. Upload videos in Library > Clips.`)
    const title = f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) || 'Uploaded image'
    const asset = await saveAsset(deps, ctx, { data: f.data, mime: f.mime, origin: 'upload', label: `Upload: ${title}` })
    const id = newId('cand')
    await deps.db.insert(candidates).values({
      id, accountId: ctx.accountId, characterId: input.characterId, target: 'scene', op: 'upload_image', status: 'approved',
      assetId: asset.id, prompt: '', label: title, createdBy: ctx.userId,
    })
    stills.push({ id, assetId: asset.id, name: title })
  }
  return { stills }
}

async function runClipIngest(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const id = job.purpose.split(':')[1]!
  const { uploadId, title } = job.request as { uploadId: string; title: string }
  const key = uploadKey(ctx.accountId, uploadId)
  const cfg = deps.config.pipeline.content
  try {
    const { asset, poster } = await withTempDir(async dir => {
      const input = join(dir, 'upload.bin'), out = join(dir, 'clip.mp4'), still = join(dir, 'poster.jpg')
      await writeFile(input, await deps.store.get(key))
      await transcodeBroll(input, out, { maxSeconds: cfg.broll.max_seconds, fps: cfg.canvas.fps })
      const asset = await saveAsset(deps, ctx, { data: await readFile(out), mime: 'video/mp4', origin: 'upload', label: `Clip: ${title}`, sourceJobId: job.id })
      // Its first frame as a picture, so the Library's grids load a small
      // copy instead of the video (UX-PLAN.md section 34).
      const poster = await extractFirstFrame(out, still).then(async () => saveAsset(deps, ctx, { data: await readFile(still), mime: 'image/jpeg', origin: 'derived', label: `Poster: ${title}`, sourceJobId: job.id })).catch(() => null)
      return { asset, poster }
    })
    // An upload is kept as soon as it is ready: the owner chose it.
    await deps.db.update(candidates).set({ assetId: asset.id, status: 'approved', jobId: job.id, updatedAt: deps.clock.now(), ...(poster ? { meta: { poster: poster.id } } : {}) }).where(eq(candidates.id, id))
    await deps.store.delete(key).catch(() => undefined)
    return { assetId: asset.id, durationMs: asset.durationMs }
  } catch (e) {
    await deps.db.update(candidates).set({ status: 'failed', rejectNote: `This file could not be read as a video (${(e as Error).message.slice(0, 200)}).`, updatedAt: deps.clock.now() }).where(eq(candidates.id, id))
    throw e
  }
}

// ── The Library: everything made, across characters ─────────────────

export interface LibraryStill {
  id: string; assetId: string; characterId: string; characterName: string; sceneId: string | null; sceneTitle: string; status: string; op: string; createdAt: string
  // How many live posts use it (only when the Library page asks, with filters).
  used?: number
  // The post it was made for (section 43): its line and place_id show under
  // the tile, and a tap opens the row.
  post?: { id: string; line: string; placeId: string | null; none: boolean } | null
}
export interface LibraryClip extends LibraryStill { posterId: string | null; durationSec: number | null; title: string; error: string | null }
export interface LibraryView {
  stills: LibraryStill[]; clips: LibraryClip[]
  // The Model filter's choices for the tab asked for (section 34).
  models?: Array<{ id: string; label: string }>
  // The newest 400 are shown; more match.
  more?: boolean
}

const STILL_STATUSES = ['in_review', 'approved']
const IMAGE_OPS = ['generate', 'edit', 'crop', 'upscale', 'mirror', 'drift_lock', 'end_frame', 'upload_image', 'slide_topic']
const UPLOAD_OPS = ['upload', 'upload_image']
const LIMIT = 400

// What a run's model was, for the Model filter: the model asked for.
const askedModel = sql<string | null>`coalesce(${jobs.request}->>'modelRef', ${jobs.request}->>'model')`

function modelCondition(deps: Deps, ctx: Ctx, model: string): SQL {
  const uploads = inArray(candidates.op, UPLOAD_OPS)
  if (model === MODEL_UPLOAD) return uploads
  const local = deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.provider, 'local')))
  if (model === MODEL_STUDIO) return and(not(uploads), or(isNull(candidates.jobId), inArray(candidates.jobId, local)))!
  const ran = deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), ne(jobs.provider, 'local'), sql`${askedModel} = ${model}`))
  return and(not(uploads), inArray(candidates.jobId, ran))!
}

const stillWhere = () => and(eq(candidates.target, 'scene'), inArray(candidates.op, IMAGE_OPS), inArray(candidates.status, STILL_STATUSES), isNotNull(candidates.assetId))
// Kept clips, and uploads still being prepared (shown as "Preparing").
const clipWhere = () => and(inArray(candidates.op, [...VIDEO_OPS]), or(eq(candidates.status, 'approved'), and(eq(candidates.op, 'upload'), inArray(candidates.status, ['generating', 'failed']))))

const split = (names: Iterable<string>) => {
  const cands: string[] = [], files: string[] = []
  for (const n of names) { if (n.startsWith('cand_')) cands.push(n); else if (n.startsWith('ast_')) files.push(n) }
  return { cands, files }
}

// The Library's lists. With `query` (the Library page, section 34) the
// filters run here, on the server, before the newest 400 are taken, and
// each item says how many live posts use it.
export async function libraryView(deps: Deps, ctx: Ctx, opts: { characterId?: string | null; query?: LibraryQuery | null } = {}): Promise<LibraryView> {
  const q = opts.query ?? null
  const characterId = q?.characterId ?? opts.characterId ?? null
  const charRows = await deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.accountId, ctx.accountId))
  const names = new Map(charRows.map(c => [c.id, c.name]))
  const conds: SQL[] = [eq(candidates.accountId, ctx.accountId)]
  if (characterId) conds.push(eq(candidates.characterId, characterId))
  if (q?.from) conds.push(gte(candidates.createdAt, q.from))
  if (q?.to) conds.push(lt(candidates.createdAt, q.to))
  if (q?.set) conds.push(inArray(candidates.id, await collectionItemIds(deps, ctx, q.set)))
  if (q?.model) conds.push(modelCondition(deps, ctx, q.model))
  const index = q ? await livePostNames(deps, ctx) : null
  if (index && q?.used) {
    const { cands, files } = split(index.flatMap(p => [...p.names]))
    conds.push(q.used === 'used'
      ? or(inArray(candidates.id, cands), inArray(candidates.assetId, files))!
      : and(notInArray(candidates.id, cands), or(isNull(candidates.assetId), notInArray(candidates.assetId, files)))!)
  }
  if (index && q?.product) {
    // Made in a post of the product (its scene, or a slideshow's own
    // still), or used by one.
    const mine = index.filter(p => p.productId === q.product)
    const { cands, files } = split(mine.flatMap(p => [...p.names]))
    const sceneIds = mine.map(p => p.sceneId).filter((x): x is string => !!x)
    conds.push(or(inArray(candidates.id, cands), inArray(candidates.assetId, files), inArray(candidates.sceneId, sceneIds), inArray(sql`${candidates.meta}->>'slideshow'`, mine.map(p => p.id)))!)
  }
  const scope = and(...conds)
  const wantStills = !q?.type || q.type === 'still'
  const wantClips = !q?.type || q.type === 'clip'
  const [stillRows, clipRows] = await Promise.all([
    wantStills ? deps.db.select().from(candidates).where(and(scope, stillWhere())).orderBy(desc(candidates.createdAt)).limit(LIMIT + 1) : Promise.resolve([]),
    wantClips ? deps.db.select().from(candidates).where(and(scope, clipWhere())).orderBy(desc(candidates.createdAt)).limit(LIMIT + 1) : Promise.resolve([]),
  ])
  const more = stillRows.length > LIMIT || clipRows.length > LIMIT
  const stillsShown = stillRows.slice(0, LIMIT)
  const clipsShown = clipRows.slice(0, LIMIT)
  const sceneIds = [...new Set([...stillsShown, ...clipsShown].map(c => c.sceneId).filter((x): x is string => !!x))]
  const sceneRows = sceneIds.length ? await deps.db.select({ id: scenes.id, title: scenes.title, brief: scenes.brief, archivedAt: scenes.archivedAt }).from(scenes).where(inArray(scenes.id, sceneIds)) : []
  const sceneTitle = new Map(sceneRows.map(s => [s.id, s.title || s.brief.slice(0, 60) || 'Untitled scene']))
  // A take's poster is the still it started from (an upscale's parent is a
  // take); an uploaded clip's is its own first frame.
  const parents = new Map<string, { parentId: string | null; assetId: string | null; op: string; meta: unknown }>()
  let wanted = clipsShown.map(c => c.parentId).filter((x): x is string => !!x)
  for (let depth = 0; depth < 3 && wanted.length; depth++) {
    const rows = await deps.db.select({ id: candidates.id, parentId: candidates.parentId, assetId: candidates.assetId, op: candidates.op, meta: candidates.meta }).from(candidates)
      .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, [...new Set(wanted)])))
    for (const r of rows) parents.set(r.id, r)
    wanted = rows.filter(r => isVideoOp(r.op) && r.parentId).map(r => r.parentId!)
  }
  const ownPoster = (meta: unknown) => (meta as { poster?: string } | null)?.poster ?? null
  const poster = (c: { parentId: string | null; meta: unknown }): string | null => {
    let p = c.parentId ? parents.get(c.parentId) : undefined
    if (!p) return ownPoster(c.meta)
    for (let i = 0; p && isVideoOp(p.op) && i < 3; i++) {
      if (ownPoster(p.meta)) return ownPoster(p.meta)
      p = p.parentId ? parents.get(p.parentId) : undefined
    }
    return p?.assetId ?? null
  }
  const usedBy = (c: { id: string; assetId: string | null }) => (index ? { used: postsUsing(index, c).length } : {})
  // The post each item was made for: a faceless or slideshow still's own
  // post (its meta), or the post on the item's scene.
  const shownAll = [...stillsShown, ...clipsShown]
  const metaPost = (c: CandRow) => { const m = (c.meta ?? {}) as { faceless?: unknown; slideshow?: unknown }; return typeof m.faceless === 'string' ? m.faceless : typeof m.slideshow === 'string' ? m.slideshow : null }
  const postIds = [...new Set(shownAll.map(metaPost).filter((x): x is string => !!x))]
  const postRows = postIds.length || sceneIds.length ? await deps.db.select({ id: contentItems.id, kind: contentItems.kind, sceneId: contentItems.sceneId, spec: contentItems.spec }).from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), or(postIds.length ? inArray(contentItems.id, postIds) : undefined, sceneIds.length ? inArray(contentItems.sceneId, sceneIds) : undefined))) : []
  const postOf = (c: CandRow): LibraryStill['post'] => {
    const id = metaPost(c)
    const p = id ? postRows.find(r => r.id === id) : c.sceneId ? postRows.find(r => r.sceneId === c.sceneId) : null
    if (!p) return null
    const l = postLine(p.kind, p.spec as Record<string, unknown>)
    return { id: p.id, line: l.text, placeId: postPlace(p.spec as Record<string, unknown>), none: l.mode === 'none' }
  }
  const base = (c: CandRow): LibraryStill => ({
    id: c.id, assetId: c.assetId!, characterId: c.characterId, characterName: names.get(c.characterId) ?? '',
    sceneId: c.sceneId, sceneTitle: stillTitle(c, sceneTitle), status: c.status, op: c.op, createdAt: c.createdAt.toISOString(), ...usedBy(c), post: postOf(c),
  })
  const clips: LibraryClip[] = []
  for (const c of clipsShown) {
    const asset = c.assetId ? await getAsset(deps, ctx, c.assetId).catch(() => null) : null
    clips.push({
      ...base(c), assetId: c.assetId ?? '', posterId: poster(c),
      durationSec: asset?.durationMs ? Math.round(asset.durationMs / 100) / 10 : null,
      title: clipTitle(c, sceneTitle),
      error: c.status === 'failed' ? c.rejectNote || 'This clip failed.' : null,
    })
  }
  return { stills: stillsShown.map(base), clips, ...(q ? { models: await modelChoices(deps, ctx, q.type), more } : {}) }
}

type CandRow = typeof candidates.$inferSelect
const stillTitle = (c: CandRow, sceneTitle: Map<string, string>) =>
  c.op === 'upload_image' ? c.label || 'Uploaded image' : c.op === 'slide_topic' ? 'Slideshow topic photo' : c.sceneId ? sceneTitle.get(c.sceneId) ?? 'Scene' : ''
const clipTitle = (c: CandRow, sceneTitle: Map<string, string>) =>
  c.op === 'upload' || c.op === 'clone' ? c.label || 'Uploaded clip' : c.op === 'chain' ? `${c.sceneId ? sceneTitle.get(c.sceneId) ?? 'Clip' : 'Clip'} (${c.label || 'chained'})` : c.sceneId ? sceneTitle.get(c.sceneId) ?? 'Take' : 'Clip'

// The models that made what is in the tab, then the two kinds that ran none.
async function modelChoices(deps: Deps, ctx: Ctx, type: LibraryQuery['type']): Promise<Array<{ id: string; label: string }>> {
  const kind = type === 'still' ? stillWhere() : type === 'clip' ? clipWhere() : or(stillWhere(), clipWhere())
  const rows = await deps.db.selectDistinct({ ref: askedModel }).from(candidates).innerJoin(jobs, eq(jobs.id, candidates.jobId))
    .where(and(eq(candidates.accountId, ctx.accountId), kind, ne(jobs.provider, 'local'), notInArray(candidates.op, UPLOAD_OPS)))
  const refs = [...new Set(rows.map(r => r.ref).filter((x): x is string => !!x))]
  return [
    ...refs.map(ref => ({ id: ref, label: modelLabel(deps, ref) })).sort((a, b) => a.label.localeCompare(b.label)),
    { id: MODEL_UPLOAD, label: 'Uploaded' },
    { id: MODEL_STUDIO, label: 'Made on the Studio' },
  ]
}

// One item for the viewer (section 34): its name, date, character, model
// and cost (the run's, read the way "What was sent" reads it), the posts
// that use it and its collections.
export interface LibraryItemView {
  id: string; name: string; media: 'image' | 'video'; assetId: string | null; createdAt: string
  characterId: string; characterName: string; op: string
  model: string; cost: string; costNote: string | null
  usedIn: Array<{ id: string; name: string }>
  collections: Array<{ id: string; name: string }>
  width: number | null; height: number | null; durationSec: number | null
}

export async function libraryItem(deps: Deps, ctx: Ctx, id: string): Promise<LibraryItemView> {
  const [c] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, id)))
  if (!c || c.status === 'purged') throw new AppError('not_found', 'That item is not in your Library any more.')
  const [ch] = await deps.db.select({ name: characters.name }).from(characters).where(eq(characters.id, c.characterId))
  const scene = c.sceneId ? (await deps.db.select({ id: scenes.id, title: scenes.title, brief: scenes.brief }).from(scenes).where(eq(scenes.id, c.sceneId)))[0] : undefined
  const sceneTitle = new Map(scene ? [[scene.id, scene.title || scene.brief.slice(0, 60) || 'Untitled scene']] : [])
  const asset = c.assetId ? await getAsset(deps, ctx, c.assetId).catch(() => null) : null
  const video = isVideoOp(c.op)
  let model = 'Made on the Studio', cost = 'Free (made on the Studio)', costNote: string | null = null
  if (UPLOAD_OPS.includes(c.op)) { model = 'Uploaded'; cost = 'Free (uploaded)' }
  else if (c.jobId) {
    const [job] = await deps.db.select().from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.id, c.jobId)))
    if (job && job.provider !== 'local' && job.kind !== 'llm' && job.kind !== 'check') {
      const f = runFacts(deps, job)
      model = f.model
      cost = f.demo ? 'Free (demo)' : f.actual ?? f.quoted
      costNote = f.demo ? null : `${f.pathLabel}${f.actual ? '' : ', the price quoted'}`
    }
  }
  const [index, collections] = await Promise.all([livePostNames(deps, ctx), collectionNamesOf(deps, ctx, c.id)])
  return {
    id: c.id, name: (video ? clipTitle(c, sceneTitle) : stillTitle(c, sceneTitle)) || c.label || (video ? 'Clip' : 'Still'),
    media: video ? 'video' : 'image', assetId: c.assetId, createdAt: c.createdAt.toISOString(),
    characterId: c.characterId, characterName: ch?.name ?? '', op: c.op,
    model, cost, costNote,
    usedIn: postsUsing(index, c), collections,
    width: asset?.width ?? null, height: asset?.height ?? null, durationSec: asset?.durationMs ? Math.round(asset.durationMs / 100) / 10 : null,
  }
}


let registered = false
export function registerClips(): void {
  if (registered) return
  registered = true
  registerLocalJob('clip_ingest', runClipIngest)
}
