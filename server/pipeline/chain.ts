import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { candidates } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { isVideoOp } from '../core/clips.js'
import { twoShotCut, type Cut } from '../core/cut.js'
import { extractLastFrame } from '../media/frames.js'
import { normalizeClip, trimClip } from '../media/edit.js'
import { joinClips, type SeamReport } from '../media/join.js'
import { probeFile, withTempDir } from '../media/ffmpeg.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { getContent, postScene, specSchemas, updateContent, type ContinueFrom, type MemeSpec } from './content.js'

// Chaining (Phase 3; SPEC 4.2, 4.3 and 5.4 rule 33): "Continue this shot"
// in a video post's Video step. The kept clip's last frame, extracted at
// full resolution (stepped back about half a second when it is blurry or
// mid-motion), becomes a still of the post's scene and the start frame of
// the next take, on the same model, with "same place, same light, same
// wardrobe, same camera" in its prompt. Using a take that started there
// joins it onto the clip: both are normalized, the handoff frame is
// trimmed, and the seam is scored and cut, color-matched, or failed. Never
// crossfaded. A failed seam can become two shots with a real cut instead.

type CandidateRow = typeof candidates.$inferSelect
export interface ChainMeta { parts?: string[]; seams?: SeamReport[]; model?: string | null; lastPrompt?: string; handoffSec?: number; steppedBackSec?: number; fromClipId?: string }

const metaOf = (c: Pick<CandidateRow, 'meta'>): ChainMeta => (c.meta ?? {}) as ChainMeta

async function candidate(deps: Deps, ctx: Ctx, candidateId: string): Promise<CandidateRow> {
  const [row] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, candidateId)))
  if (!row) throw notFound('Clip')
  return row
}

// The takes a clip is made of (a chain lists its parts; anything else is
// one part), and the model to continue it on.
export function partsOf(c: Pick<CandidateRow, 'id' | 'op' | 'meta'>): string[] {
  const m = metaOf(c)
  return c.op === 'chain' && m.parts?.length ? m.parts : [c.id]
}
const modelOf = (c: Pick<CandidateRow, 'meta'>): string | null => metaOf(c).model ?? null

async function memePost(deps: Deps, ctx: Ctx, postId: string) {
  const row = await getContent(deps, ctx, postId)
  if (row.kind !== 'meme') throw new AppError('bad_request', 'Continue this shot works on a video post.')
  return { row, spec: specSchemas.meme.parse(row.spec) as MemeSpec }
}

async function setContinue(deps: Deps, ctx: Ctx, postId: string, next: ContinueFrom | null, extra: Partial<MemeSpec> = {}) {
  return updateContent(deps, ctx, postId, { spec: { continueFrom: next, ...extra } })
}

// "Continue this shot" (free): the post's clip's last frame becomes the next
// take's start frame. The worker extracts it.
export async function continueShot(deps: Deps, ctx: Ctx, postId: string) {
  const { row, spec } = await memePost(deps, ctx, postId)
  if (!spec.clipId) throw new AppError('bad_request', 'Pick a clip first; then you can continue it.')
  const clip = await candidate(deps, ctx, spec.clipId)
  if (!isVideoOp(clip.op) || !clip.assetId || clip.status !== 'approved') throw new AppError('bad_request', 'The clip is still being prepared. Try again in a moment.')
  const cfg = deps.config.pipeline.content.chain
  if (partsOf(clip).length >= cfg.max_parts) throw new AppError('bad_request', `A chained clip holds at most ${cfg.max_parts} takes. Start a new post to go on.`)
  if (spec.continueFrom && ['preparing', 'joining'].includes(spec.continueFrom.status)) throw new AppError('bad_request', 'This post is already continuing its clip.')
  // The next take is made in the post's scene (made from the idea if the
  // clip came from an upload or a clone).
  const post = row.sceneId ? row : await postScene(deps, ctx, row.id)
  await setContinue(deps, ctx, row.id, { clipId: clip.id, frameId: null, status: 'preparing', model: modelOf(clip), takeId: null, error: null })
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `chain_frame:${row.id}`, label: 'Take the last frame of the clip', characterId: row.characterId, request: { clipId: clip.id, sceneId: post.sceneId } })
  return getContent(deps, ctx, row.id)
}

async function runChainFrame(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const postId = job.purpose.split(':')[1]!
  const { clipId, sceneId } = job.request as { clipId: string; sceneId: string }
  const { spec } = await memePost(deps, ctx, postId)
  const keep = spec.continueFrom
  try {
    const clip = await candidate(deps, ctx, clipId)
    const result = await withTempDir(async dir => {
      const video = join(dir, 'clip.mp4'), png = join(dir, 'last.png')
      await writeFile(video, (await readAsset(deps, ctx, clip.assetId!)).data)
      const frame = await extractLastFrame(video, png, dir, { stepBackSec: deps.config.pipeline.content.chain.step_back_sec })
      const asset = await saveAsset(deps, ctx, { data: await readFile(png), mime: 'image/png', origin: 'derived', label: `Last frame of ${clip.id}`, sourceJobId: job.id })
      return { asset, frame }
    })
    const frameId = newId('cand')
    await deps.db.insert(candidates).values({
      id: frameId, accountId: ctx.accountId, characterId: clip.characterId, target: 'scene', sceneId, parentId: clip.id, op: 'last_frame',
      assetId: result.asset.id, status: 'approved', jobId: job.id, createdBy: job.userId, label: 'Last frame',
      meta: { fromClipId: clip.id, handoffSec: result.frame.timeSec, steppedBackSec: result.frame.steppedBackSec } satisfies ChainMeta,
    })
    await setContinue(deps, ctx, postId, { ...(keep ?? { clipId, model: null, takeId: null }), clipId, frameId, status: 'ready', error: null }, { stillId: frameId })
    return { frameId, steppedBackSec: result.frame.steppedBackSec }
  } catch (e) {
    await setContinue(deps, ctx, postId, { clipId, frameId: null, status: 'failed', model: keep?.model ?? null, takeId: null, error: `The last frame could not be taken (${(e as Error).message.slice(0, 200)}).` })
    throw e
  }
}

// "Use this take" on a take that started from the last frame: it is joined
// onto the clip (free, on the worker).
export async function useChainTake(deps: Deps, ctx: Ctx, postId: string, takeId: string) {
  const { row, spec } = await memePost(deps, ctx, postId)
  const c = spec.continueFrom
  if (!c?.frameId || !['ready', 'failed'].includes(c.status)) throw new AppError('bad_request', 'Continue the shot first.')
  const take = await candidate(deps, ctx, takeId)
  const parent = take.parentId ? await candidate(deps, ctx, take.parentId) : null
  const startedThere = take.parentId === c.frameId || (take.op === 'video_upscale' && parent?.parentId === c.frameId)
  if (!isVideoOp(take.op) || !take.assetId || !startedThere) throw new AppError('bad_request', 'Use a take that starts from the last frame of the clip.')
  if (take.status !== 'approved') throw new AppError('bad_request', 'Keep the take first.')
  await setContinue(deps, ctx, row.id, { ...c, status: 'joining', takeId: take.id, error: null })
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `chain_join:${row.id}`, label: 'Join the takes into one clip', characterId: row.characterId, request: { clipId: c.clipId, takeId: take.id, frameId: c.frameId } })
  return getContent(deps, ctx, row.id)
}

// A cut that used the old clip uses the joined one instead.
function swapInCut(cut: Cut | null, from: string, to: string): Cut | null {
  if (!cut || cut.auto) return cut
  return { ...cut, shots: cut.shots.map(s => (s.kind === 'clip' && s.ref === from ? { ...s, ref: to, in: 0, out: null } : s)) }
}

async function runChainJoin(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const postId = job.purpose.split(':')[1]!
  const { clipId, takeId, frameId } = job.request as { clipId: string; takeId: string; frameId: string }
  const { spec } = await memePost(deps, ctx, postId)
  const cfg = deps.config.pipeline.content.chain
  const c = spec.continueFrom ?? { clipId, frameId, status: 'joining' as const, model: null, takeId, error: null }
  const [base, take, frame] = await Promise.all([candidate(deps, ctx, clipId), candidate(deps, ctx, takeId), candidate(deps, ctx, frameId)])
  const handoff = metaOf(frame)
  try {
    const joined = await withTempDir(async dir => {
      const a = join(dir, 'a.mp4'), b = join(dir, 'b.mp4'), an = join(dir, 'a_n.mp4'), bn = join(dir, 'b_n.mp4'), out = join(dir, 'chain.mp4')
      await writeFile(a, (await readAsset(deps, ctx, base.assetId!)).data)
      await writeFile(b, (await readAsset(deps, ctx, take.assetId!)).data)
      // One size and frame rate for both (the first clip's), so the seam is
      // judged on equal frames.
      const pa = await probeFile(a)
      const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
      const target = { width: even(pa.width ?? 720), height: even(pa.height ?? 1280), fps: Math.round(pa.fps ?? 24) }
      // When the frame was stepped back, the clip ends at that frame.
      let first = a
      if ((handoff.steppedBackSec ?? 0) > 0 && handoff.handoffSec != null) {
        first = join(dir, 'a_trim.mp4')
        await trimClip(a, first, { endSec: handoff.handoffSec + 1 / target.fps })
      }
      await normalizeClip(first, an, target)
      await normalizeClip(b, bn, target)
      const r = await joinClips([an, bn], out, dir, { maxSeamDiff: cfg.max_seam_diff, dropFirstFrame: true })
      if (!r.passed) return { ok: false as const, seams: r.seams }
      const asset = await saveAsset(deps, ctx, { data: await readFile(out), mime: 'video/mp4', origin: 'derived', label: `Chained clip (${partsOf(base).length + 1} takes)`, sourceJobId: job.id })
      return { ok: true as const, seams: r.seams, asset, durationSec: r.durationSec ?? 0 }
    })
    if (!joined.ok) {
      const s = joined.seams[joined.seams.length - 1]!
      await setContinue(deps, ctx, postId, { ...c, status: 'failed', takeId, error: `The seam did not pass: the frames differ by ${s.diffBefore.toFixed(2)} (the limit is ${cfg.max_seam_diff}), even after matching the color. Regenerate the take, or keep them as two shots with a real cut.` })
      return { passed: false, seams: joined.seams }
    }
    if (joined.durationSec > cfg.max_seconds + 0.5) throw new AppError('bad_request', `The chained clip would run ${Math.round(joined.durationSec)} s; the limit is ${cfg.max_seconds} s.`)
    const parts = [...partsOf(base), take.id]
    const chainId = newId('cand')
    await deps.db.insert(candidates).values({
      id: chainId, accountId: ctx.accountId, characterId: base.characterId, target: 'scene', sceneId: take.sceneId, parentId: parts[0]!,
      op: 'chain', assetId: joined.asset.id, status: 'approved', jobId: job.id, createdBy: job.userId, label: `${parts.length} takes, chained`, prompt: take.prompt,
      meta: { parts, seams: [...(metaOf(base).seams ?? []), ...joined.seams], model: modelOf(take) ?? modelOf(base), lastPrompt: take.prompt } satisfies ChainMeta,
    })
    await setContinue(deps, ctx, postId, null, { clipId: chainId, cut: swapInCut(spec.cut, base.id, chainId) })
    return { passed: true, chainId, parts: parts.length, durationSec: joined.durationSec }
  } catch (e) {
    await setContinue(deps, ctx, postId, { ...c, status: 'failed', takeId, error: `The takes could not be joined (${(e as Error).message.slice(0, 200)}).` })
    throw e
  }
}

// A seam that failed: keep both takes as two shots, with a real cut
// between them in the rough cut (never a blend).
export async function keepTwoShots(deps: Deps, ctx: Ctx, postId: string) {
  const { row, spec } = await memePost(deps, ctx, postId)
  const c = spec.continueFrom
  if (!c?.takeId) throw new AppError('bad_request', 'Use a take first.')
  const cut = twoShotCut(spec, c.clipId, c.takeId, deps.config.pipeline.content.meme.max_broll_seconds)
  await setContinue(deps, ctx, row.id, null, { cut })
  return getContent(deps, ctx, row.id)
}

export async function cancelContinue(deps: Deps, ctx: Ctx, postId: string) {
  const { row } = await memePost(deps, ctx, postId)
  await setContinue(deps, ctx, row.id, null)
  return getContent(deps, ctx, row.id)
}

let registered = false
export function registerChain(): void {
  if (registered) return
  registered = true
  registerLocalJob('chain_frame', runChainFrame)
  registerLocalJob('chain_join', runChainJoin)
}
