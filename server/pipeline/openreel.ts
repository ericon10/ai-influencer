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
import { candidateAsset, getBroll, getContent, setOutputs, specSchemas, updateContent, voicePhrases, type ContentOutputs, type MemeSpec } from './content.js'
import { getSound } from './sounds.js'
import { getVoiceLine } from './voiceLines.js'
import { getSetting, setSetting } from './settings.js'
import { newId } from '../lib/ids.js'
import { editorStyleSchema, stackSchema, type EditorStyle } from '../core/editorStyle.js'

// The OpenReel editor (owner, 2026-10-14, G29): the Studio's editor is the
// owner's OpenReel fork, served at /editor/ and opened from a post. The
// Studio stays the source of truth: the editor asks for the post (its
// shots, B-roll, captions and saved project) and Done hands back the MP4
// it exported in the browser and the project, which is kept for the next
// edit. The MP4 becomes the post's video on the worker (free).

const CANVAS = { width: 1080, height: 1920, fps: 30 }
const assetUrl = (id: string) => `/api/v1/assets/${id}/content`

// `src` is a fresh direct link to the file in storage (R2). The take never
// reached the timeline on the live site (owner, 2026-10-15): the post page
// had just played it through `url`, the browser kept that redirect and
// storage's answer (no CORS header, as a plain <video> needs none), and the
// editor's fetch of the same address got the kept copy and was refused. A
// new link, fetched without the cache, always asks storage again.
export interface EditorMedia { id: string; name: string; kind: 'video' | 'audio' | 'image'; url: string; src: string | null; role: 'clip' | 'broll' | 'music' | 'ambience' | 'voice'; start: number; in: number; out: number | null }

// A direct storage link for the editor (null on local disk, where the
// Studio serves the file itself).
export async function directLink(deps: Deps, ctx: Ctx, assetId: string): Promise<string | null> {
  if (deps.store.driver !== 's3') return null
  const asset = await getAsset(deps, ctx, assetId).catch(() => null)
  return asset ? deps.store.presignGet(asset.storageKey, 6 * 3600, { cors: true }) : null
}

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
  const cut = effectiveCut(s, deps.config.pipeline.content.meme.max_broll_seconds, voicePhrases(deps))
  if (!cut.shots.length) throw new AppError('bad_request', 'Pick a clip in the Video step first.')
  const media: EditorMedia[] = []
  let at = 0
  for (const [i, shot] of cut.shots.entries()) {
    const assetId = shot.kind === 'clip' ? await candidateAsset(deps, ctx, shot.ref, post.characterId, 'video') : (await getBroll(deps, ctx, shot.ref)).assetId
    if (!assetId) throw new AppError('bad_request', 'A B-roll clip is still being prepared. Try again in a moment.')
    const asset = await getAsset(deps, ctx, assetId)
    const length = (asset.durationMs ?? 0) / 1000
    const end = shot.out ?? length
    media.push({ id: assetId, name: shot.kind === 'clip' ? `Shot ${i + 1}` : `B-roll ${i + 1}`, kind: 'video', url: assetUrl(assetId), src: null, role: shot.kind, start: Math.round(at * 1000) / 1000, in: shot.in, out: shot.out })
    at += Math.max(0.1, end - shot.in)
  }
  const duration = Math.round(at * 1000) / 1000
  // The sound bed's uploads go on their own tracks: music (the editor finds
  // its beat) and a recorded ambience. Room tone is made on the worker.
  for (const [role, soundId] of [['music', s.sound.music], ['ambience', s.sound.ambience && !['none', 'room'].includes(s.sound.ambience) ? s.sound.ambience : null]] as const) {
    if (!soundId) continue
    const sound = await getSound(deps, ctx, soundId).catch(() => null)
    if (!sound?.assetId || sound.status !== 'ready') continue
    media.push({ id: sound.assetId, name: sound.title || (role === 'music' ? 'Music' : 'Ambience'), kind: 'audio', url: assetUrl(sound.assetId), src: null, role, start: 0, in: 0, out: null })
  }
  // The voiceover (a converted voice line) at its place; its phrases are
  // the captions when "Captions from the voice line" is on.
  if (s.sound.voice) {
    const line = await getVoiceLine(deps, ctx, s.sound.voice.id).catch(() => null)
    if (line?.assetId && line.status === 'ready') media.push({ id: line.assetId, name: `Voice: ${line.title}`, kind: 'audio', url: assetUrl(line.assetId), src: null, role: 'voice', start: s.sound.voice.at, in: 0, out: null })
  }
  // No caption (owner, 2026-10-15): the cut has none, and a saved project's
  // caption track is left out when it opens (captionOff).
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
    media.push({ id: assetId, name: asset.label || assetId, kind: asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'image' : 'video', url: assetUrl(assetId), src: null, role: 'broll', start: 0, in: 0, out: null })
  }
  // Each file's direct storage link (see EditorMedia).
  for (const m of media) m.src = await directLink(deps, ctx, m.id)
  // The payoff the video builds to (the post's own, else a little before
  // the end) as a suggested spot, and the Idea step's Format as the preset
  // placed on first open.
  const edits = deps.config.pipeline.edits
  const payoff = Math.max(0, Math.min(duration, s.edit.payoff ?? duration - edits.payoff_from_end))
  const suggestions = duration > 1 ? [{ label: 'Payoff', time: Math.round(payoff * 100) / 100, why: 'The moment the video builds to. Good for a speed ramp, a freeze or a snap zoom.' }] : []
  const style = edits.styles.find(x => x.id === s.edit.style)
  // A stack carried from "Make another like this" wins over the Format
  // (it already holds the Format's preset where the owner moved it).
  const stack = !project && s.editor?.stack?.length ? s.editor.stack : null
  const format = !project && !stack && style?.preset ? { preset: style.preset, strength: s.edit.strength } : null
  // The caption's look and place to start from (the post's, else the
  // Studio's default: the white box in the upper third).
  const captionLook = { style: s.captionStyle ?? deps.config.pipeline.content.caption.style, position: deps.config.pipeline.content.caption.position }
  // The sound bed's ducking, so the editor's export matches the Studio's
  // render (editor QA, 2026-10-15).
  const soundBed = { duck: s.sound.duck, clipSound: s.sound.clipSound }
  return { post: { id: post.id, title: post.title || s.caption.slice(0, 60) || 'Video post' }, canvas: CANVAS, media, captions, captionOff: s.captionOff, captionLook, duration, project, suggestions, format, stack, styles: await listStyles(deps, ctx), sound: soundBed }
}

const saveBody = z.object({ uploadId: z.string().regex(/^upl_[a-z0-9]{20}$/), project: z.record(z.string(), z.unknown()), stack: stackSchema.optional() })

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
  await updateContent(deps, ctx, post.id, { spec: { editor: { ...(s.editor ?? {}), projectAssetId: asset.id, savedAt: deps.clock.now().toISOString(), stack: body.stack ?? s.editor?.stack ?? null } } })
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

// Saved styles (editor phase C): stacks of presets with relative places,
// kept per account. The editor lists them in its Presets tab; applying
// one places its presets on the open timeline.
const STYLES_KEY = 'editor_styles'
const MAX_STYLES = 50

export async function listStyles(deps: Deps, ctx: Ctx): Promise<EditorStyle[]> {
  const raw = await getSetting<unknown[]>(deps.db, ctx.accountId, STYLES_KEY, [])
  return (Array.isArray(raw) ? raw : []).flatMap(x => { const r = editorStyleSchema.safeParse(x); return r.success ? [r.data] : [] })
}

const newStyle = z.object({ name: z.string().trim().min(1, 'Give the style a name.').max(60), items: stackSchema.min(1, 'Place at least one preset first.') })

export async function saveStyle(deps: Deps, ctx: Ctx, raw: unknown): Promise<EditorStyle> {
  const body = newStyle.parse(raw)
  const list = await listStyles(deps, ctx)
  if (list.length >= MAX_STYLES) throw new AppError('bad_request', `You have ${MAX_STYLES} saved styles. Delete one first.`)
  const style: EditorStyle = { id: newId('sty'), name: body.name, items: body.items, createdAt: deps.clock.now().toISOString() }
  await setSetting(deps, ctx, STYLES_KEY, [...list.filter(x => x.name.toLowerCase() !== body.name.toLowerCase()), style])
  return style
}

export async function deleteStyle(deps: Deps, ctx: Ctx, styleId: string): Promise<{ ok: true }> {
  const list = await listStyles(deps, ctx)
  if (!list.some(x => x.id === styleId)) throw new AppError('not_found', 'That style is already gone.')
  await setSetting(deps, ctx, STYLES_KEY, list.filter(x => x.id !== styleId))
  return { ok: true }
}
