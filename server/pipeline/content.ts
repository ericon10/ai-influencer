import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { z } from 'zod'
import { brollClips, candidates, contentItems, scenes } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, registerLocalJob, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob, type JobSpec } from '../jobs/runner.js'
import { captionPng, slideImage } from '../core/overlay.js'
import { fill, hardWrap } from '../core/text.js'
import { pronounVars } from '../core/prompts.js'
import { renderMeme, transcodeBroll } from '../media/meme.js'
import { withTempDir } from '../media/ffmpeg.js'
import { getAsset, readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import { getCharacter, toData, type CharacterRow } from './characters.js'
import { resolveRoute } from './settings.js'
import type { SceneBuilt } from './sceneActions.js'

// The text-overlay content builder (owner, 2026-10-13): the owner's B-roll
// library, meme videos (a kept clip, optional B-roll cut in hard, a TikTok
// caption box), slideshows (stills with Claude's hook and slide text) and
// batches (many captions, one clip, many videos). Rendering is local and
// free (ffmpeg and sharp on the worker); only the Claude steps are priced.

export type BrollRow = typeof brollClips.$inferSelect
export type ContentRow = typeof contentItems.$inferSelect
export type ContentKind = 'meme' | 'slideshow' | 'batch'

const VIDEO_OPS = ['video', 'video_upscale']

// ── B-roll library ──────────────────────────────────────────────────

export async function listBroll(deps: Deps, ctx: Ctx): Promise<BrollRow[]> {
  return deps.db.select().from(brollClips)
    .where(and(eq(brollClips.accountId, ctx.accountId), isNull(brollClips.archivedAt)))
    .orderBy(desc(brollClips.createdAt))
}

async function getBroll(deps: Deps, ctx: Ctx, id: string): Promise<BrollRow> {
  const [row] = await deps.db.select().from(brollClips).where(and(eq(brollClips.accountId, ctx.accountId), eq(brollClips.id, id)))
  if (!row || row.archivedAt) throw notFound('B-roll clip')
  return row
}

const cleanTag = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 60)

// A direct upload becomes a B-roll clip: the worker converts it (lean H.264,
// no sound) and keeps the copy; the upload itself is then removed.
export async function addBroll(deps: Deps, ctx: Ctx, input: { uploadId: string; name: string; title?: string; product?: string }): Promise<BrollRow> {
  if (!/^upl_[a-z0-9]{20}$/.test(input.uploadId)) throw new AppError('bad_request', 'That upload id is not valid.')
  if (!(await deps.store.exists(uploadKey(ctx.accountId, input.uploadId)))) throw new AppError('bad_request', `${input.name} did not finish uploading. Try again.`)
  const id = newId('brl')
  const [row] = await deps.db.insert(brollClips).values({
    id, accountId: ctx.accountId, title: (input.title?.trim() || input.name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 120),
    product: cleanTag(input.product ?? ''), status: 'processing', createdBy: ctx.userId,
  }).returning()
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `broll_ingest:${id}`, label: `Prepare B-roll: ${row!.title}`, characterId: null, request: { uploadId: input.uploadId } })
  return row!
}

export async function updateBroll(deps: Deps, ctx: Ctx, id: string, patch: { title?: string; product?: string }): Promise<BrollRow> {
  const row = await getBroll(deps, ctx, id)
  const [out] = await deps.db.update(brollClips).set({
    title: patch.title !== undefined ? patch.title.trim().slice(0, 120) : row.title,
    product: patch.product !== undefined ? cleanTag(patch.product) : row.product,
    updatedAt: deps.clock.now(),
  }).where(eq(brollClips.id, row.id)).returning()
  return out!
}

export async function archiveBroll(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const row = await getBroll(deps, ctx, id)
  await deps.db.update(brollClips).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(brollClips.id, row.id))
}

async function runBrollIngest(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const id = job.purpose.split(':')[1]!
  const { uploadId } = job.request as { uploadId: string }
  const key = uploadKey(ctx.accountId, uploadId)
  const cfg = deps.config.pipeline.content
  try {
    const row = await getBroll(deps, ctx, id)
    const asset = await withTempDir(async dir => {
      const input = join(dir, 'upload.bin'), out = join(dir, 'broll.mp4')
      await writeFile(input, await deps.store.get(key))
      await transcodeBroll(input, out, { maxSeconds: cfg.broll.max_seconds, fps: cfg.canvas.fps })
      return saveAsset(deps, ctx, { data: await readFile(out), mime: 'video/mp4', origin: 'upload', label: `B-roll: ${row.title}`, sourceJobId: job.id })
    })
    await deps.db.update(brollClips).set({ assetId: asset.id, status: 'ready', error: null, updatedAt: deps.clock.now() }).where(eq(brollClips.id, id))
    await deps.store.delete(key).catch(() => undefined)
    return { assetId: asset.id, durationMs: asset.durationMs }
  } catch (e) {
    await deps.db.update(brollClips).set({ status: 'failed', error: `This file could not be read as a video (${(e as Error).message.slice(0, 200)}).`, updatedAt: deps.clock.now() }).where(eq(brollClips.id, id))
    throw e
  }
}

// ── Content items: drafts, edits, renders ───────────────────────────

const id = z.string().max(60)
const memeSpec = z.object({
  clipId: id.nullable().default(null),
  brollId: id.nullable().default(null),
  order: z.enum(['clip_first', 'broll_first']).default('clip_first'),
  brollStart: z.number().min(0).max(600).default(0),
  brollSeconds: z.number().min(0.5).max(60).default(6),
  caption: z.string().max(400).default(''),
})
const slideshowSpec = z.object({
  stillIds: z.array(id).max(20).default([]),
  topic: z.string().max(400).default(''),
  hook: z.string().max(200).default(''),
  slides: z.array(z.string().max(300)).max(10).default([]),
  caption: z.string().max(2200).default(''),
  hashtags: z.array(z.string().max(60)).max(15).default([]),
})
const batchSpec = memeSpec.omit({ caption: true }).extend({
  topic: z.string().max(400).default(''),
  count: z.number().int().min(1).max(50).default(20),
  captions: z.array(z.string().max(400)).max(50).default([]),
})
export const specSchemas = { meme: memeSpec, slideshow: slideshowSpec, batch: batchSpec }
export type MemeSpec = z.infer<typeof memeSpec>
export type SlideshowSpec = z.infer<typeof slideshowSpec>
export type BatchSpec = z.infer<typeof batchSpec>

export interface ContentOutputs {
  videoAssetId?: string
  imageAssetIds?: string[]
  // A batch, by caption order (a failed video leaves a gap).
  videos?: Array<{ caption: string; assetId: string } | null>
  zipAssetId?: string
  done?: number
  failed?: number
  total?: number
  dropped?: string[]
  renderedAt?: string
}

function parseSpec(kind: string, raw: unknown) {
  const schema = specSchemas[kind as ContentKind]
  if (!schema) throw new AppError('bad_request', `Unknown content kind "${kind}".`)
  const r = schema.safeParse(raw ?? {})
  if (!r.success) throw new AppError('invalid_request', `That ${kind} is not valid: ${r.error.issues.map(i => `${i.path.join('.') || 'value'} ${i.message.toLowerCase()}`).join('; ')}.`)
  return r.data
}

export async function listContent(deps: Deps, ctx: Ctx, characterId?: string | null): Promise<ContentRow[]> {
  return deps.db.select().from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), ...(characterId ? [eq(contentItems.characterId, characterId)] : [])))
    .orderBy(desc(contentItems.createdAt)).limit(100)
}

export async function getContent(deps: Deps, ctx: Ctx, itemId: string): Promise<ContentRow> {
  const [row] = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, itemId)))
  if (!row || row.archivedAt) throw notFound('Content')
  return row
}

export async function createContent(deps: Deps, ctx: Ctx, input: { kind: ContentKind; characterId: string; title?: string; spec?: unknown }): Promise<ContentRow> {
  await getCharacter(deps, ctx, input.characterId)
  const defaults = deps.config.pipeline.content
  const base = input.kind === 'batch' ? { count: defaults.batch.default_count } : input.kind === 'meme' ? { brollSeconds: defaults.meme.broll_seconds, order: defaults.meme.order } : {}
  const spec = parseSpec(input.kind, { ...base, ...((input.spec as object) ?? {}) })
  const [row] = await deps.db.insert(contentItems).values({
    id: newId('cnt'), accountId: ctx.accountId, characterId: input.characterId, kind: input.kind,
    title: (input.title ?? '').slice(0, 120), spec, createdBy: ctx.userId,
  }).returning()
  return row!
}

export async function updateContent(deps: Deps, ctx: Ctx, itemId: string, patch: { title?: string; spec?: unknown }): Promise<ContentRow> {
  const row = await getContent(deps, ctx, itemId)
  const spec = patch.spec !== undefined ? parseSpec(row.kind, { ...(row.spec as object), ...(patch.spec as object) }) : row.spec
  const [out] = await deps.db.update(contentItems).set({
    title: patch.title !== undefined ? patch.title.slice(0, 120) : row.title, spec, updatedAt: deps.clock.now(),
  }).where(eq(contentItems.id, row.id)).returning()
  return out!
}

export async function archiveContent(deps: Deps, ctx: Ctx, itemId: string): Promise<void> {
  const row = await getContent(deps, ctx, itemId)
  await deps.db.update(contentItems).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id))
}

// A kept clip (a take, its upscale, later a clone) or a still, from this
// account and character.
async function candidateAsset(deps: Deps, ctx: Ctx, candidateId: string, characterId: string, media: 'video' | 'image'): Promise<string> {
  const [c] = await deps.db.select({ assetId: candidates.assetId, op: candidates.op, characterId: candidates.characterId }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, candidateId)))
  const isVideo = !!c && VIDEO_OPS.includes(c.op)
  if (!c?.assetId || c.characterId !== characterId || isVideo !== (media === 'video')) throw new AppError('bad_request', media === 'video' ? 'Pick a clip from this character.' : 'Pick stills from this character.')
  return c.assetId
}

// What a render needs, checked before it is queued, so a mistake shows at
// once instead of on the worker.
function renderProblems(row: ContentRow): string[] {
  const out: string[] = []
  if (row.kind === 'meme') {
    const s = memeSpec.parse(row.spec)
    if (!s.clipId) out.push('Pick a clip')
    if (!s.caption.trim()) out.push('Write the caption')
  } else if (row.kind === 'batch') {
    const s = batchSpec.parse(row.spec)
    if (!s.clipId) out.push('Pick a clip')
    if (!s.captions.some(c => c.trim())) out.push('Add captions (paste them or write them with Claude)')
  } else {
    const s = slideshowSpec.parse(row.spec)
    if (!s.stillIds.length) out.push('Pick stills')
    if (!s.hook.trim() && !s.slides.some(x => x.trim())) out.push('Write the slides (or type them)')
  }
  return out
}

export async function startRender(deps: Deps, ctx: Ctx, itemId: string): Promise<ContentRow> {
  const row = await getContent(deps, ctx, itemId)
  const problems = renderProblems(row)
  if (problems.length) throw new AppError('bad_request', `${problems.join('; ')}.`)
  if (row.status === 'rendering') throw new AppError('bad_request', 'This is already rendering.')
  // A batch is one short job per video (the worker takes other work in
  // between), and the last one bundles the zip.
  const total = row.kind === 'batch' ? batchCaptions(deps, batchSpec.parse(row.spec)).length : 0
  const outputs: ContentOutputs = row.kind === 'batch' ? { videos: [], done: 0, failed: 0, total } : {}
  const [out] = await deps.db.update(contentItems).set({ status: 'rendering', error: null, outputs, updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id)).returning()
  if (row.kind === 'batch') {
    for (let i = 0; i < total; i++) await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `content_render:${row.id}`, label: `Render batch video ${i + 1} of ${total}`, characterId: row.characterId, request: { index: i } })
  } else {
    await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `content_render:${row.id}`, label: row.kind === 'meme' ? 'Render the meme video' : 'Export the slideshow', characterId: row.characterId, request: {} })
  }
  return out!
}

const batchCaptions = (deps: Deps, s: BatchSpec) => s.captions.map(c => c.trim()).filter(Boolean).slice(0, deps.config.pipeline.content.batch.max)

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'content'

async function setOutputs(deps: Deps, itemId: string, outputs: ContentOutputs, status?: string): Promise<void> {
  await deps.db.update(contentItems).set({ outputs, ...(status ? { status } : {}), updatedAt: deps.clock.now() }).where(eq(contentItems.id, itemId))
}

async function renderVideo(deps: Deps, ctx: Ctx, job: JobRow, s: Pick<MemeSpec, 'clipId' | 'brollId' | 'order' | 'brollStart' | 'brollSeconds'>, characterId: string, caption: string, label: string) {
  const cfg = deps.config.pipeline.content
  const clipAsset = await candidateAsset(deps, ctx, s.clipId!, characterId, 'video')
  const broll = s.brollId ? await getBroll(deps, ctx, s.brollId) : null
  if (broll && (broll.status !== 'ready' || !broll.assetId)) throw new AppError('bad_request', `The B-roll clip "${broll.title}" is not ready yet.`)
  return withTempDir(async dir => {
    const clip = join(dir, 'clip.mp4'), b = join(dir, 'broll.mp4'), cap = join(dir, 'caption.png'), out = join(dir, 'out.mp4')
    await writeFile(clip, (await readAsset(deps, ctx, clipAsset)).data)
    if (broll?.assetId) await writeFile(b, (await readAsset(deps, ctx, broll.assetId)).data)
    const overlay = await captionPng(caption, cfg)
    await writeFile(cap, overlay.png)
    await renderMeme({
      clip, caption: cap, out, canvas: cfg.canvas, order: s.order, maxClipSeconds: cfg.meme.max_clip_seconds,
      broll: broll?.assetId ? { path: b, startSec: s.brollStart, seconds: Math.min(s.brollSeconds, cfg.meme.max_broll_seconds) } : null,
    })
    const asset = await saveAsset(deps, ctx, { data: await readFile(out), mime: 'video/mp4', origin: 'derived', label, sourceJobId: job.id })
    return { assetId: asset.id, dropped: overlay.layout.dropped }
  })
}

async function runContentRender(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const itemId = job.purpose.split(':')[1]!
  const row = await getContent(deps, ctx, itemId)
  const name = slug(row.title || row.kind)
  try {
    if (row.kind === 'meme') {
      const s = memeSpec.parse(row.spec)
      const v = await renderVideo(deps, ctx, job, s, row.characterId!, s.caption, `Meme video: ${s.caption.slice(0, 60)}`)
      const outputs: ContentOutputs = { videoAssetId: v.assetId, dropped: v.dropped, renderedAt: deps.clock.now().toISOString() }
      await setOutputs(deps, itemId, outputs, 'ready')
      return outputs
    }
    if (row.kind === 'batch') return await renderBatchVideo(deps, ctx, job, row, name)
    // Slideshow: the hook on the first image, then one slide per image. With
    // fewer stills than slides, the stills repeat in order.
    const s = slideshowSpec.parse(row.spec)
    const texts = [s.hook, ...s.slides].map(t => t.trim()).filter(Boolean)
    const stills = await Promise.all(s.stillIds.map(sid => candidateAsset(deps, ctx, sid, row.characterId!, 'image')))
    const images: string[] = []
    const files: Record<string, Uint8Array> = {}
    for (const [i, text] of texts.entries()) {
      const still = (await readAsset(deps, ctx, stills[i % stills.length]!)).data
      const jpg = await slideImage(still, text, deps.config.pipeline.content)
      const asset = await saveAsset(deps, ctx, { data: jpg, mime: 'image/jpeg', origin: 'derived', label: `Slide ${i + 1}: ${text.slice(0, 60)}`, sourceJobId: job.id })
      images.push(asset.id)
      files[`${String(i + 1).padStart(2, '0')}-${name}.jpg`] = jpg
    }
    const tags = s.hashtags.map(h => `#${h.replace(/^#+/, '').replace(/\s+/g, '')}`).filter(h => h.length > 1).join(' ')
    files['caption.txt'] = Buffer.from(`${s.caption.trim()}${tags ? `\n\n${tags}` : ''}\n\nPost as a photo slideshow, images in order. Turn on TikTok's AI-generated content label.\n`)
    const zip = await saveAsset(deps, ctx, { data: Buffer.from(zipSync(files, { level: 0 })), mime: 'application/zip', origin: 'derived', label: `Slideshow ${name} (zip)`, sourceJobId: job.id })
    const outputs: ContentOutputs = { imageAssetIds: images, zipAssetId: zip.id, renderedAt: deps.clock.now().toISOString() }
    await setOutputs(deps, itemId, outputs, 'ready')
    return { images: images.length }
  } catch (e) {
    if (row.kind === 'batch') throw e
    await deps.db.update(contentItems).set({ status: 'failed', error: (e as Error).message.slice(0, 400), updatedAt: deps.clock.now() }).where(eq(contentItems.id, itemId))
    throw e
  }
}

// One video of a batch. The worker runs jobs one at a time, so the outputs
// are read and written in turn; the last video bundles the zip.
async function renderBatchVideo(deps: Deps, ctx: Ctx, job: JobRow, row: ContentRow, name: string): Promise<unknown> {
  const s = batchSpec.parse(row.spec)
  const captions = batchCaptions(deps, s)
  const index = (job.request as { index?: number }).index ?? 0
  const caption = captions[index]
  let result: { caption: string; assetId: string } | null = null
  let error: string | null = null
  if (caption) {
    try {
      const v = await renderVideo(deps, ctx, job, s, row.characterId!, caption, `Batch ${name} ${index + 1}: ${caption.slice(0, 50)}`)
      result = { caption, assetId: v.assetId }
    } catch (e) {
      error = `Video ${index + 1} failed: ${(e as Error).message.slice(0, 300)}`
    }
  }
  const now = await getContent(deps, ctx, row.id)
  const prev = now.outputs as ContentOutputs
  const videos = [...(prev.videos ?? [])]
  if (result) videos[index] = result
  const done = (prev.done ?? 0) + (result ? 1 : 0)
  const failed = (prev.failed ?? 0) + (result ? 0 : 1)
  const total = prev.total ?? captions.length
  const outputs: ContentOutputs = { ...prev, videos, done, failed, total }
  if (done + failed < total) {
    await setOutputs(deps, row.id, outputs)
  } else {
    // One download for all of them (stored, not compressed: MP4 is already).
    const kept = videos.map((v, i) => ({ v, i })).filter((x): x is { v: { caption: string; assetId: string }; i: number } => !!x.v)
    const files: Record<string, Uint8Array> = { 'captions.txt': Buffer.from(kept.map(({ v, i }) => `${String(i + 1).padStart(2, '0')}. ${v.caption}`).join('\n') + '\n') }
    for (const { v, i } of kept) files[`${name}-${String(i + 1).padStart(2, '0')}.mp4`] = (await readAsset(deps, ctx, v.assetId)).data
    const zip = kept.length ? await saveAsset(deps, ctx, { data: Buffer.from(zipSync(files, { level: 0 })), mime: 'application/zip', origin: 'derived', label: `Batch ${name} (zip)`, sourceJobId: job.id }) : null
    await setOutputs(deps, row.id, { ...outputs, ...(zip ? { zipAssetId: zip.id } : {}), renderedAt: deps.clock.now().toISOString() }, failed ? 'failed' : 'ready')
    if (failed) await deps.db.update(contentItems).set({ error: `${failed} of ${total} videos failed; the rest are ready.` }).where(eq(contentItems.id, row.id))
  }
  if (error) throw new Error(error)
  return result
}

// ── Claude: slideshow text and batch captions (priced) ───────────────

export const slidesJsonSchema = (n: number, tags: readonly [number, number]): Record<string, unknown> => ({
  type: 'object',
  properties: {
    hook: { type: 'string' },
    slides: { type: 'array', items: { type: 'string' }, minItems: n, maxItems: n },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' }, minItems: tags[0], maxItems: tags[1] },
  },
  required: ['hook', 'slides', 'caption', 'hashtags'],
  additionalProperties: false,
})

export const captionsJsonSchema = (n: number): Record<string, unknown> => ({
  type: 'object',
  properties: { captions: { type: 'array', items: { type: 'string' }, minItems: n, maxItems: n } },
  required: ['captions'],
  additionalProperties: false,
})

// How many slides follow the hook: one per picked still after the first,
// kept within the configured range (5 to 7).
export function slideCount(deps: Deps, stills: number): number {
  const [min, max] = deps.config.pipeline.content.slideshow.slides
  return Math.max(min, Math.min(max, stills - 1))
}

async function photoNotes(deps: Deps, ctx: Ctx, stillIds: string[]): Promise<string> {
  if (!stillIds.length) return 'none picked yet'
  const rows = await deps.db.select({ id: candidates.id, sceneId: candidates.sceneId }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, stillIds)))
  const sceneIds = [...new Set(rows.map(r => r.sceneId).filter((x): x is string => !!x))]
  const sc = sceneIds.length ? await deps.db.select({ id: scenes.id, title: scenes.title, fields: scenes.fields, brief: scenes.brief }).from(scenes).where(inArray(scenes.id, sceneIds)) : []
  return stillIds.map((sid, i) => {
    const s = sc.find(x => x.id === rows.find(r => r.id === sid)?.sceneId)
    const moment = (s?.fields as { moment?: string } | undefined)?.moment || s?.brief || s?.title || 'a photo'
    return `${i + 1}. ${moment}`
  }).join('; ')
}

export async function buildContentSlides(deps: Deps, ctx: Ctx, row: CharacterRow, itemId: string): Promise<SceneBuilt> {
  const item = await getContent(deps, ctx, itemId)
  if (item.kind !== 'slideshow' || item.characterId !== row.id) throw new AppError('bad_request', 'Pick a slideshow of this character.')
  const s = slideshowSpec.parse(item.spec)
  if (s.topic.trim().length < 3) throw new AppError('invalid_request', 'Say what the slideshow is about first.')
  const ch = toData(row)
  const cfg = deps.config.pipeline.content
  const t = deps.config.pipeline.templates.content_slides
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const n = slideCount(deps, s.stillIds.length)
  const vars = { ...pronounVars(ch.pronouns), name: ch.name, slides: String(n), hashtags_min: String(cfg.slideshow.hashtags[0]), hashtags_max: String(cfg.slideshow.hashtags[1]) }
  const system = fill(t.system, vars)
  const prompt = fill(t.prompt, { ...vars, topic: s.topic.trim(), vibe: ch.persona.vibe ?? 'not given', photos: await photoNotes(deps, ctx, s.stillIds) })
  const purpose = `content_slides:${item.id}`
  const mock = { hook: `${s.topic.trim().slice(0, 60)}`, slides: Array.from({ length: n }, (_, i) => `Slide ${i + 2}: ${s.topic.trim().slice(0, 40)}`), caption: `${s.topic.trim()}`, hashtags: ['fyp', 'dayinmylife', 'relatable'].slice(0, Math.max(cfg.slideshow.hashtags[0], 1)) }
  return {
    purpose,
    preview: { title: 'Write the slides', prompts: [{ label: 'Slideshow writer', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [{ type: 'llm', stage: 'content', purpose, label: `Slideshow text, ${n + 1} slides`, request: { model: route.model, system, prompt, schema: slidesJsonSchema(n, cfg.slideshow.hashtags), schemaName: 'content_slides', maxTokens: 1500, effort: route.effort ?? 'low', meta: { itemId: item.id, mockSlides: mock } } } satisfies JobSpec],
  }
}

export async function buildContentCaptions(deps: Deps, ctx: Ctx, row: CharacterRow, itemId: string): Promise<SceneBuilt> {
  const item = await getContent(deps, ctx, itemId)
  if (item.kind !== 'batch' || item.characterId !== row.id) throw new AppError('bad_request', 'Pick a batch of this character.')
  const s = batchSpec.parse(item.spec)
  if (s.topic.trim().length < 3) throw new AppError('invalid_request', 'Say what the captions are about first.')
  const count = Math.min(s.count, deps.config.pipeline.content.batch.max)
  const ch = toData(row)
  const t = deps.config.pipeline.templates.content_captions
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const vars = { ...pronounVars(ch.pronouns), name: ch.name, count: String(count) }
  const system = fill(t.system, vars)
  const prompt = fill(t.prompt, { ...vars, topic: s.topic.trim(), vibe: ch.persona.vibe ?? 'not given' })
  const purpose = `content_captions:${item.id}`
  const mock = { captions: Array.from({ length: count }, (_, i) => `POV: ${s.topic.trim().slice(0, 60)} (${i + 1})`) }
  return {
    purpose,
    preview: { title: `Write ${count} captions`, prompts: [{ label: 'Caption writer', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [{ type: 'llm', stage: 'content', purpose, label: `${count} captions`, request: { model: route.model, system, prompt, schema: captionsJsonSchema(count), schemaName: 'content_captions', maxTokens: 2500, effort: route.effort ?? 'low', meta: { itemId: item.id, mockCaptions: mock } } } satisfies JobSpec],
  }
}

async function onContentSlides(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const d = (out.data ?? {}) as { hook?: unknown; slides?: unknown; caption?: unknown; hashtags?: unknown }
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean) : [])
  await updateContent(deps, ctx, job.purpose.split(':')[1]!, {
    spec: {
      hook: typeof d.hook === 'string' ? d.hook.trim().slice(0, 200) : '',
      slides: strs(d.slides).map(x => x.slice(0, 300)).slice(0, 10),
      caption: typeof d.caption === 'string' ? d.caption.trim().slice(0, 2200) : '',
      hashtags: strs(d.hashtags).map(h => h.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase().slice(0, 60)).slice(0, 15),
    },
  })
}

async function onContentCaptions(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const d = (out.data ?? {}) as { captions?: unknown }
  const captions = Array.isArray(d.captions) ? d.captions.filter((x): x is string => typeof x === 'string').map(x => x.trim().replace(/^["“]+|["”]+$/g, '')).filter(Boolean).map(x => x.slice(0, 400)) : []
  await updateContent(deps, ctx, job.purpose.split(':')[1]!, { spec: { captions: captions.slice(0, 50) } })
}

// ── The view the Content page reads ──────────────────────────────────

export async function contentView(deps: Deps, ctx: Ctx) {
  const [broll, items] = await Promise.all([listBroll(deps, ctx), listContent(deps, ctx)])
  const assetIds = broll.map(b => b.assetId).filter((x): x is string => !!x)
  const durations = new Map<string, number | null>()
  for (const a of assetIds) durations.set(a, (await getAsset(deps, ctx, a).catch(() => null))?.durationMs ?? null)
  const cfg = deps.config.pipeline.content
  return {
    broll: broll.map(b => ({ id: b.id, title: b.title, product: b.product, status: b.status, error: b.error, assetId: b.assetId, durationSec: b.assetId && durations.get(b.assetId) ? Math.round(durations.get(b.assetId)! / 100) / 10 : null, createdAt: b.createdAt.toISOString() })),
    products: [...new Set([...cfg.broll.products, ...broll.map(b => b.product).filter(Boolean)])].sort((a, b) => a.localeCompare(b)),
    items: items.map(i => ({ id: i.id, kind: i.kind as ContentKind, characterId: i.characterId, title: i.title, spec: i.spec, status: i.status, outputs: i.outputs as ContentOutputs, error: i.error, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() })),
    options: {
      caption: { size: cfg.caption.size, safe: cfg.caption.safe, position: cfg.caption.position, maxChars: cfg.caption.max_chars, box: cfg.caption.box },
      canvas: cfg.canvas, meme: cfg.meme, slideshow: { slides: cfg.slideshow.slides, maxStills: cfg.slideshow.max_stills }, batch: cfg.batch,
      maxUploadMb: cfg.broll.max_upload_mb,
    },
  }
}

let registered = false
export function registerContent(): void {
  if (registered) return
  registered = true
  registerLocalJob('broll_ingest', runBrollIngest)
  registerLocalJob('content_render', runContentRender)
  registerJobHook('content_slides', onContentSlides)
  registerJobHook('content_captions', onContentCaptions)
}
