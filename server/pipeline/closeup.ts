import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { and, eq } from 'drizzle-orm'
import { candidates } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { isVideoOp } from '../core/clips.js'
import { DEFAULT_FACE } from '../media/edits.js'
import { extractLastFrame } from '../media/frames.js'
import { withTempDir } from '../media/ffmpeg.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { getContent, postScene, specSchemas, updateContent, type MemeSpec } from './content.js'

// "Make the close-up" (Phase 5, crash zoom cut; UX-PLAN.md section 10):
// shot A's last frame, at full size, cropped in 9:16 around her face (the
// face models on the worker find it; else the upper middle of the frame).
// Free. It becomes a still of the post's scene and shot B's start frame;
// the priced Upscale 2x and Generate a take follow, each quoted as usual.
// A crop only cuts pixels away: nothing is smoothed (rule zero).

export async function makeCloseup(deps: Deps, ctx: Ctx, postId: string) {
  const row = await getContent(deps, ctx, postId)
  if (row.kind !== 'meme') throw new AppError('bad_request', 'Make the close-up works on a video post.')
  const spec = specSchemas.meme.parse(row.spec) as MemeSpec
  if (!spec.clipId) throw new AppError('bad_request', 'Pick shot A first; the close-up is made from its last frame.')
  const [clip] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, spec.clipId)))
  if (!clip) throw notFound('Clip')
  if (!isVideoOp(clip.op) || !clip.assetId || clip.status !== 'approved') throw new AppError('bad_request', 'Shot A is still being prepared. Try again in a moment.')
  const post = row.sceneId ? row : await postScene(deps, ctx, row.id)
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `closeup:${row.id}`, label: 'Make the close-up from shot A', characterId: row.characterId, request: { clipId: clip.id, sceneId: post.sceneId } })
  return getContent(deps, ctx, row.id)
}

// The crop box: 9:16, `share` of the frame's height, centered on the face
// and kept inside the frame. Pure, so it is unit-tested.
export function closeupBox(width: number, height: number, face: { x: number; y: number }, share: number) {
  const h = Math.max(16, Math.round(height * share))
  const w = Math.min(width, Math.round((h * 9) / 16))
  const left = Math.round(Math.max(0, Math.min(width - w, face.x * width - w / 2)))
  const top = Math.round(Math.max(0, Math.min(height - h, face.y * height - h / 2)))
  return { left, top, width: w, height: h }
}

async function runCloseup(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const postId = job.purpose.split(':')[1]!
  const { clipId, sceneId } = job.request as { clipId: string; sceneId: string }
  const [clip] = await deps.db.select().from(candidates).where(eq(candidates.id, clipId))
  if (!clip?.assetId) throw new AppError('bad_request', 'Shot A has no video.')
  const share = deps.config.pipeline.edits.closeup.share
  const made = await withTempDir(async dir => {
    const video = join(dir, 'a.mp4'), png = join(dir, 'last.png')
    await writeFile(video, (await readAsset(deps, ctx, clip.assetId!)).data)
    await extractLastFrame(video, png, dir)
    const img = await readFile(png)
    const meta = await sharp(img).metadata()
    let face = DEFAULT_FACE
    let found = false
    try {
      if ((await deps.faces.status()).available) {
        const [f] = (await deps.faces.detect(img)).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
        if (f && meta.width && meta.height) { face = { x: (f.box.x + f.box.w / 2) / meta.width, y: (f.box.y + f.box.h / 2) / meta.height }; found = true }
      }
    } catch { /* the default spot */ }
    const box = closeupBox(meta.width!, meta.height!, face, share)
    const crop = await sharp(img).extract(box).png().toBuffer()
    const asset = await saveAsset(deps, ctx, { data: crop, mime: 'image/png', origin: 'derived', label: `Close-up from ${clip.id}`, sourceJobId: job.id })
    return { asset, box, found }
  })
  const stillId = newId('cand')
  await deps.db.insert(candidates).values({
    id: stillId, accountId: ctx.accountId, characterId: clip.characterId, target: 'scene', sceneId, parentId: clip.id, op: 'crop',
    assetId: made.asset.id, status: 'approved', jobId: job.id, createdBy: job.userId, label: 'Close-up for shot B',
    meta: { closeupOf: clip.id, box: made.box, faceFound: made.found },
  })
  await updateContent(deps, ctx, postId, { spec: { stillB: stillId } })
  return { stillId, faceFound: made.found, width: made.box.width, height: made.box.height }
}

let registered = false
export function registerCloseup(): void {
  if (registered) return
  registered = true
  registerLocalJob('closeup', runCloseup)
}
