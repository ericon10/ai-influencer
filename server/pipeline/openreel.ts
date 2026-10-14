import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { contentItems } from '../db/schema.js'
import { effectiveCut } from '../core/cut.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { withTempDir } from '../media/ffmpeg.js'
import { normalizeForRender } from '../media/normalize.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { getAsset, readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import { candidateAsset, getBroll, getContent, setOutputs, specSchemas, updateContent, type ContentOutputs, type MemeSpec } from './content.js'

// The OpenReel editor (owner, 2026-10-14, G29): the Studio's editor is the
// owner's OpenReel fork, served at /editor/ and opened from a post. The
// Studio stays the source of truth: the editor asks for the post (its
// shots, B-roll, captions and saved project) and Done hands back the MP4
// it exported in the browser and the project, which is kept for the next
// edit. The MP4 becomes the post's video on the worker (free).

const CANVAS = { width: 1080, height: 1920, fps: 30 }
const assetUrl = (id: string) => `/api/v1/assets/${id}/content`

export interface EditorMedia { id: string; name: string; kind: 'video' | 'audio' | 'image'; url: string; role: 'clip' | 'broll' | 'music' | 'ambience' | 'voice'; start: number; in: number; out: number | null }

function memeOf(post: { kind: string; spec: unknown }): MemeSpec {
  if (post.kind !== 'meme') throw new AppError('bad_request', 'The editor opens video posts for now.')
  return specSchemas.meme.parse(post.spec) as MemeSpec
}

// What the editor loads: the post's cut as media at their places on the
// timeline, its captions, and the saved project when there is one.
export async function editorManifest(deps: Deps, ctx: Ctx, contentId: string) {
  const post = await getContent(deps, ctx, contentId)
  const s = memeOf(post)
  if (!post.characterId) throw new AppError('bad_request', 'Pick a character for this post first.')
  const cut = effectiveCut(s, deps.config.pipeline.content.meme.max_broll_seconds)
  if (!cut.shots.length) throw new AppError('bad_request', 'Pick a clip in the Video step first.')
  const media: EditorMedia[] = []
  let at = 0
  for (const [i, shot] of cut.shots.entries()) {
    const assetId = shot.kind === 'clip' ? await candidateAsset(deps, ctx, shot.ref, post.characterId, 'video') : (await getBroll(deps, ctx, shot.ref)).assetId
    if (!assetId) throw new AppError('bad_request', 'A B-roll clip is still being prepared. Try again in a moment.')
    const asset = await getAsset(deps, ctx, assetId)
    const length = (asset.durationMs ?? 0) / 1000
    const end = shot.out ?? length
    media.push({ id: assetId, name: shot.kind === 'clip' ? `Shot ${i + 1}` : `B-roll ${i + 1}`, kind: 'video', url: assetUrl(assetId), role: shot.kind, start: Math.round(at * 1000) / 1000, in: shot.in, out: shot.out })
    at += Math.max(0.1, end - shot.in)
  }
  const duration = Math.round(at * 1000) / 1000
  const captions = cut.captions.map(c => ({ text: (c.text ?? s.caption).trim(), start: c.start, end: c.end })).filter(c => c.text)
  let project: unknown = null
  if (s.editor?.projectAssetId) {
    const saved = await readAsset(deps, ctx, s.editor.projectAssetId).catch(() => null)
    if (saved) project = JSON.parse(saved.data.toString('utf8'))
  }
  // A saved project names media by Studio asset id; they all load again.
  const known = new Set(media.map(m => m.id))
  const savedMedia = (project as { studioMedia?: Record<string, string> } | null)?.studioMedia ?? {}
  for (const assetId of Object.values(savedMedia)) {
    if (known.has(assetId)) continue
    const asset = await getAsset(deps, ctx, assetId).catch(() => null)
    if (!asset) continue
    known.add(assetId)
    media.push({ id: assetId, name: asset.label || assetId, kind: asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'image' : 'video', url: assetUrl(assetId), role: 'broll', start: 0, in: 0, out: null })
  }
  // The payoff the video builds to (the post's own, else a little before
  // the end) as a suggested spot, and the Idea step's Format as the preset
  // placed on first open.
  const edits = deps.config.pipeline.edits
  const payoff = Math.max(0, Math.min(duration, s.edit.payoff ?? duration - edits.payoff_from_end))
  const suggestions = duration > 1 ? [{ label: 'Payoff', time: Math.round(payoff * 100) / 100, why: 'The moment the video builds to. Good for a speed ramp, a freeze or a snap zoom.' }] : []
  const style = edits.styles.find(x => x.id === s.edit.style)
  const format = !project && style?.preset ? { preset: style.preset, strength: s.edit.strength } : null
  return { post: { id: post.id, title: post.title || s.caption.slice(0, 60) || 'Video post' }, canvas: CANVAS, media, captions, duration, project, suggestions, format }
}

const saveBody = z.object({ uploadId: z.string().regex(/^upl_[a-z0-9]{20}$/), project: z.record(z.string(), z.unknown()) })

// Done: the project is kept (a small JSON file), and the worker turns the
// uploaded MP4 into the post's video. The post shows "Saving your edit"
// until it is there.
export async function saveFromEditor(deps: Deps, ctx: Ctx, contentId: string, raw: unknown): Promise<{ ok: true }> {
  const post = await getContent(deps, ctx, contentId)
  const s = memeOf(post)
  const body = saveBody.parse(raw)
  const json = Buffer.from(JSON.stringify(body.project))
  if (json.length > 4 * 1024 * 1024) throw new AppError('bad_request', 'The edit is too large to save. Remove some layers and try again.')
  if (!(await deps.store.exists(uploadKey(ctx.accountId, body.uploadId)))) throw new AppError('bad_request', 'The exported video did not finish uploading. Press Done again.')
  const asset = await saveAsset(deps, ctx, { data: json, mime: 'application/json', origin: 'derived', label: `Editor project for ${post.title || 'a video post'}` })
  await updateContent(deps, ctx, post.id, { spec: { editor: { ...(s.editor ?? {}), projectAssetId: asset.id, savedAt: deps.clock.now().toISOString() } } })
  await setOutputs(deps, post.id, (post.outputs ?? {}) as ContentOutputs, 'rendering')
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `editor_save:${post.id}`, label: 'Save the edit to the post', characterId: post.characterId, request: { uploadId: body.uploadId } })
  return { ok: true }
}

async function runEditorSave(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const postId = job.purpose.split(':')[1]!
  const { uploadId } = job.request as { uploadId: string }
  const key = uploadKey(ctx.accountId, uploadId)
  const post = await getContent(deps, ctx, postId)
  try {
    // The browser's export (MP4 with H.264, or WebM with VP9 where the
    // browser has no H.264 encoder) is made plain like every input: the
    // canvas size, 30 fps, H.264, 48 kHz stereo AAC (G27).
    const { canvas } = deps.config.pipeline.content
    const data = await withTempDir(async dir => {
      const input = join(dir, 'export.bin'), out = join(dir, 'post.mp4')
      await writeFile(input, await deps.store.get(key))
      await normalizeForRender(input, out, { canvas, keepSound: true })
      return readFile(out)
    })
    const asset = await saveAsset(deps, ctx, { data, mime: 'video/mp4', origin: 'derived', label: `Video post (edited): ${post.title || 'untitled'}`, sourceJobId: job.id })
    if (asset.kind !== 'video' || !asset.durationMs) throw new AppError('bad_request', 'The exported file is not a video the Studio can read. Export again from the editor.')
    await deps.store.delete(key).catch(() => undefined)
    const outputs: ContentOutputs = { videoAssetId: asset.id, durationSec: Math.round(asset.durationMs / 100) / 10, renderedAt: deps.clock.now().toISOString(), fromEditor: true, dropped: [] }
    await setOutputs(deps, postId, outputs, 'ready')
    return outputs
  } catch (e) {
    await deps.db.update(contentItems).set({ status: 'failed', error: (e as Error).message.slice(0, 400), updatedAt: deps.clock.now() }).where(eq(contentItems.id, postId))
    throw e
  }
}

let registered = false
export function registerOpenReel(): void {
  if (registered) return
  registered = true
  registerLocalJob('editor_save', runEditorSave)
}
