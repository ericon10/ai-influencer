import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { candidates, characters, scenes } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { VIDEO_OPS, isVideoOp } from '../core/clips.js'
import { transcodeBroll } from '../media/meme.js'
import { withTempDir } from '../media/ffmpeg.js'
import { getAsset, saveAsset } from '../storage/assets.js'
import { takeUploads, uploadKey } from '../storage/uploads.js'
import { getCharacter } from './characters.js'
import { getContent, updateContent, type BatchSpec } from './content.js'

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
    const asset = await withTempDir(async dir => {
      const input = join(dir, 'upload.bin'), out = join(dir, 'clip.mp4')
      await writeFile(input, await deps.store.get(key))
      await transcodeBroll(input, out, { maxSeconds: cfg.broll.max_seconds, fps: cfg.canvas.fps })
      return saveAsset(deps, ctx, { data: await readFile(out), mime: 'video/mp4', origin: 'upload', label: `Clip: ${title}`, sourceJobId: job.id })
    })
    // An upload is kept as soon as it is ready: the owner chose it.
    await deps.db.update(candidates).set({ assetId: asset.id, status: 'approved', jobId: job.id, updatedAt: deps.clock.now() }).where(eq(candidates.id, id))
    await deps.store.delete(key).catch(() => undefined)
    return { assetId: asset.id, durationMs: asset.durationMs }
  } catch (e) {
    await deps.db.update(candidates).set({ status: 'failed', rejectNote: `This file could not be read as a video (${(e as Error).message.slice(0, 200)}).`, updatedAt: deps.clock.now() }).where(eq(candidates.id, id))
    throw e
  }
}

// ── The Library: everything made, across characters ─────────────────

export interface LibraryStill { id: string; assetId: string; characterId: string; characterName: string; sceneId: string | null; sceneTitle: string; status: string; op: string; createdAt: string }
export interface LibraryClip extends LibraryStill { posterId: string | null; durationSec: number | null; title: string; error: string | null }

const STILL_STATUSES = ['in_review', 'approved']
const IMAGE_OPS = ['generate', 'edit', 'crop', 'upscale', 'mirror', 'drift_lock', 'end_frame', 'upload_image']

export async function libraryView(deps: Deps, ctx: Ctx, opts: { characterId?: string | null } = {}): Promise<{ stills: LibraryStill[]; clips: LibraryClip[] }> {
  const charRows = await deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.accountId, ctx.accountId))
  const names = new Map(charRows.map(c => [c.id, c.name]))
  const scope = and(eq(candidates.accountId, ctx.accountId), ...(opts.characterId ? [eq(candidates.characterId, opts.characterId)] : []))
  const [stillRows, clipRows] = await Promise.all([
    deps.db.select().from(candidates).where(and(scope, eq(candidates.target, 'scene'), inArray(candidates.op, IMAGE_OPS), inArray(candidates.status, STILL_STATUSES), isNotNull(candidates.assetId)))
      .orderBy(desc(candidates.createdAt)).limit(400),
    // Kept clips, and uploads still being prepared (shown as "Preparing").
    deps.db.select().from(candidates).where(and(scope, inArray(candidates.op, [...VIDEO_OPS]), inArray(candidates.status, ['approved', 'generating', 'failed'])))
      .orderBy(desc(candidates.createdAt)).limit(400),
  ])
  const clipsShown = clipRows.filter(c => c.status === 'approved' || c.op === 'upload')
  const sceneIds = [...new Set([...stillRows, ...clipsShown].map(c => c.sceneId).filter((x): x is string => !!x))]
  const sceneRows = sceneIds.length ? await deps.db.select({ id: scenes.id, title: scenes.title, brief: scenes.brief, archivedAt: scenes.archivedAt }).from(scenes).where(inArray(scenes.id, sceneIds)) : []
  const sceneTitle = new Map(sceneRows.map(s => [s.id, s.title || s.brief.slice(0, 60) || 'Untitled scene']))
  // A take's poster is the still it started from (an upscale's parent is a take).
  const parents = new Map<string, { parentId: string | null; assetId: string | null; op: string }>()
  let wanted = clipsShown.map(c => c.parentId).filter((x): x is string => !!x)
  for (let depth = 0; depth < 3 && wanted.length; depth++) {
    const rows = await deps.db.select({ id: candidates.id, parentId: candidates.parentId, assetId: candidates.assetId, op: candidates.op }).from(candidates)
      .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, [...new Set(wanted)])))
    for (const r of rows) parents.set(r.id, r)
    wanted = rows.filter(r => isVideoOp(r.op) && r.parentId).map(r => r.parentId!)
  }
  const poster = (parentId: string | null): string | null => {
    let p = parentId ? parents.get(parentId) : undefined
    for (let i = 0; p && isVideoOp(p.op) && i < 3; i++) p = p.parentId ? parents.get(p.parentId) : undefined
    return p?.assetId ?? null
  }
  const base = (c: (typeof stillRows)[number]) => ({
    id: c.id, assetId: c.assetId!, characterId: c.characterId, characterName: names.get(c.characterId) ?? '',
    sceneId: c.sceneId, sceneTitle: c.op === 'upload_image' ? c.label || 'Uploaded image' : c.sceneId ? sceneTitle.get(c.sceneId) ?? 'Scene' : '', status: c.status, op: c.op, createdAt: c.createdAt.toISOString(),
  })
  const clips: LibraryClip[] = []
  for (const c of clipsShown) {
    const asset = c.assetId ? await getAsset(deps, ctx, c.assetId).catch(() => null) : null
    clips.push({
      ...base(c), assetId: c.assetId ?? '', posterId: poster(c.parentId),
      durationSec: asset?.durationMs ? Math.round(asset.durationMs / 100) / 10 : null,
      title: c.op === 'upload' || c.op === 'clone' ? c.label || 'Uploaded clip' : c.op === 'chain' ? `${c.sceneId ? sceneTitle.get(c.sceneId) ?? 'Clip' : 'Clip'} (${c.label || 'chained'})` : c.sceneId ? sceneTitle.get(c.sceneId) ?? 'Take' : 'Clip',
      error: c.status === 'failed' ? c.rejectNote || 'This clip failed.' : null,
    })
  }
  return { stills: stillRows.map(base), clips }
}

let registered = false
export function registerClips(): void {
  if (registered) return
  registered = true
  registerLocalJob('clip_ingest', runClipIngest)
}
