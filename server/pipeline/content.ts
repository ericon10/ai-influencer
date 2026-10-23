import { writeFile, readFile } from 'node:fs/promises'
import { soundToAdd } from '../core/faceless.js'
import { join } from 'node:path'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { zipSync } from 'fflate'
import sharp from 'sharp'
import { z } from 'zod'
import { brollClips, candidates, contentItems, products, scenes } from '../db/schema.js'
import { isVideoOp } from '../core/clips.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, registerLocalJob, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob, type JobSpec } from '../jobs/runner.js'
import { captionPng, captionWords, type CaptionLook } from '../core/overlay.js'
import { slideshowSpecSchema } from '../core/slideshowSpec.js'
import { renderSlideshow, slideshowProblems } from './slideshow.js'
import { checkProduct, defaultProductFor, GENERAL_LABEL, standardOf } from './products.js'
import { fill, hardWrap } from '../core/text.js'
import { pronounVars } from '../core/prompts.js'
import { transcodeBroll } from '../media/meme.js'
import { planShots, renderTimeline, type TimelineCaption, type TimelineShot } from '../media/timeline.js'
import { applySoundBed, type SoundBedResult } from '../media/sound.js'
import { cutProblems, cutSchema, effectiveCut, type Cut } from '../core/cut.js'
import { stackSchema } from '../core/editorStyle.js'
import { soundFile } from './sounds.js'
import { voiceFile, voiceForPost } from './voiceLines.js'
import { cleanVoiceCard, voiceCardText } from '../core/voiceCard.js'
import { EDIT_IDS } from '../config/pipeline.js'
import { applyEdit, DEFAULT_FACE, detectBeats, mapTime, overlayBehind, type EditStyle } from '../media/edits.js'
import { personMaskVideo, segmentAvailable } from '../media/segment.js'
import { applyCameraBlocks } from '../media/camera.js'
import { stackPlan, workerTimeline } from './workerTimeline.js'
import type { CameraBlock } from '../core/camera.js'
import { normalizeForRender, NORMALIZE_VERSION } from '../media/normalize.js'
import { makeScratch } from '../media/sound.js'
import { extractFrameAt } from '../media/frames.js'
import { probeFile, withTempDir } from '../media/ffmpeg.js'
import { capBitrate } from '../media/bitrate.js'
import { headBlocks, hookCaptions, presetFor, replaceHead, type ExportPreset } from '../core/exportPresets.js'
import type { PresetInfo } from '../core/timelinePlan.js'
import { getAsset, readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import { getCharacter, toData, type CharacterRow } from './characters.js'
import { createScene, getScene, updateScene } from './scenes.js'
import { resolveRoute } from './settings.js'
import type { SceneBuilt } from './sceneActions.js'
import { lintSettings } from './copyLint.js'
import { planMetaSchema } from '../core/planMeta.js'
import { resultsSchema } from '../core/results.js'
import { postingSchema } from '../core/postingDay.js'
import { videoPostExportJson } from '../core/postExport.js'
import { postCaption } from '../core/slides.js'

// Posts (UX-PLAN.md; the content builder of 2026-10-13): the owner's B-roll
// library, video posts (kind "meme": a kept clip, optional B-roll cut in
// hard, a TikTok caption box), slideshows (stills with Claude's hook and
// slide text) and batches (many captions, clips and B-roll rotated across
// them, many videos). Each post keeps its idea, its scene, an account tag
// and the step it was left on. Rendering is local and free (ffmpeg and
// sharp on the worker); only the Claude steps are priced.

export type BrollRow = typeof brollClips.$inferSelect
export type ContentRow = typeof contentItems.$inferSelect
export type ContentKind = 'meme' | 'slideshow' | 'batch'

// ── B-roll library ──────────────────────────────────────────────────

export async function listBroll(deps: Deps, ctx: Ctx): Promise<BrollRow[]> {
  return deps.db.select().from(brollClips)
    .where(and(eq(brollClips.accountId, ctx.accountId), isNull(brollClips.archivedAt)))
    .orderBy(desc(brollClips.createdAt))
}

export async function getBroll(deps: Deps, ctx: Ctx, id: string): Promise<BrollRow> {
  const [row] = await deps.db.select().from(brollClips).where(and(eq(brollClips.accountId, ctx.accountId), eq(brollClips.id, id)))
  if (!row || row.archivedAt) throw notFound('B-roll clip')
  return row
}

const cleanTag = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 60)

// A direct upload becomes a B-roll clip: the worker converts it (lean H.264,
// no sound) and keeps the copy; the upload itself is then removed.
// Its product is picked from the account's products (section 29), or none.
export async function addBroll(deps: Deps, ctx: Ctx, input: { uploadId: string; name: string; title?: string; productId?: string | null }): Promise<BrollRow> {
  if (!/^upl_[a-z0-9]{20}$/.test(input.uploadId)) throw new AppError('bad_request', 'That upload id is not valid.')
  if (!(await deps.store.exists(uploadKey(ctx.accountId, input.uploadId)))) throw new AppError('bad_request', `${input.name} did not finish uploading. Try again.`)
  const productId = await checkProduct(deps, ctx, input.productId)
  const id = newId('brl')
  const [row] = await deps.db.insert(brollClips).values({
    id, accountId: ctx.accountId, title: (input.title?.trim() || input.name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 120),
    productId, status: 'processing', createdBy: ctx.userId,
  }).returning()
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `broll_ingest:${id}`, label: `Prepare B-roll: ${row!.title}`, characterId: null, request: { uploadId: input.uploadId } })
  return row!
}

export async function updateBroll(deps: Deps, ctx: Ctx, id: string, patch: { title?: string; productId?: string | null }): Promise<BrollRow> {
  const row = await getBroll(deps, ctx, id)
  const [out] = await deps.db.update(brollClips).set({
    title: patch.title !== undefined ? patch.title.trim().slice(0, 120) : row.title,
    productId: patch.productId !== undefined ? await checkProduct(deps, ctx, patch.productId) : row.productId,
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
// Clone Video's source clip (SPEC 13.1 R1), prepared by the worker from an
// upload and kept with its sound so "Keep original sound" can put it back.
const cloneSource = z.object({
  status: z.enum(['preparing', 'ready', 'failed']),
  name: z.string().max(300),
  uploadId: z.string().max(40).nullable().default(null),
  assetId: id.nullable().default(null),
  durationSec: z.number().nullable().default(null),
  hasAudio: z.boolean().default(false),
  trimmed: z.boolean().default(false),
  error: z.string().max(500).nullable().default(null),
  // The clip's first frame and the people on it (face boxes, 0 to 1, the
  // largest first), for "tap the person to replace" and the preview (G28).
  firstFrameId: id.nullable().default(null),
  people: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })).max(12).default([]),
  // Where the owner tapped (0 to 1); unset means the largest person.
  target: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().default(null),
  // "Copy the moves": the scene still kept per character (candidate ids).
  stills: z.record(id, id).default({}),
  // The cleanup before cloning (overnight item 3): the clip as uploaded and
  // as cleaned, what was done, and whether the clean one is used.
  originalAssetId: id.nullable().default(null),
  cleanAssetId: id.nullable().default(null),
  cleanup: z.object({ endCardSec: z.number().nullable().default(null), spots: z.number().int().min(0).default(0), on: z.boolean().default(true) }).nullable().default(null),
  // A frame of the clip as uploaded (its caption still on), for "Read its
  // caption", and what was read.
  textFrameId: id.nullable().default(null),
  sourceCaption: z.string().max(400).nullable().default(null),
  // Recreate from a real clip (owner, 2026-10-14): the frame about 0.2 s
  // into the clip as uploaded (captions still on; the still removes them),
  // the traits the character must not take from that person, and the free
  // read of the clip that suggests the route (dark, a lot of movement).
  rawFrameId: id.nullable().default(null),
  motionAssetId: id.nullable().default(null),
  notLike: z.string().max(300).default(''),
  look: z.object({ dark: z.boolean(), motion: z.number(), suggest: z.enum(['replace', 'motion']), why: z.string().max(200) }).nullable().default(null),
  // Step 2 (owner, 2026-10-14): what to keep from the frame (chips), the
  // outfit (the clip's, named, or hers: one of her stills or typed), and
  // one line of what happens in the clip for the motion prompt.
  keep: z.array(z.string().max(80)).max(12).default([]),
  outfit: z.object({ choice: z.enum(['source', 'hers']).default('source'), text: z.string().max(160).default(''), lookId: id.nullable().default(null) }).prefault({}),
  motion: z.string().max(400).default(''),
  // What the owner typed (not read by Claude): the outfit text and the keep
  // chips they added. Claude's words go into a Recreate prompt plain (color
  // and garment, no sleeve or fit details); the owner's go as typed.
  typed: z.object({ outfit: z.boolean().default(false), keep: z.array(z.string().max(80)).max(12).default([]) }).prefault({}),
  // A spend cap for this post in credits (the Recreate link's cap), and
  // what its priced steps have started so far.
  capCredits: z.number().positive().max(100000).nullable().default(null),
  spentCredits: z.number().min(0).default(0),
  // Where the clip came from (an upload, a link, a Higgsfield media ID).
  from: z.string().max(400).default(''),
  // The preparation run this record waits for.
  prep: z.string().max(40).default(''),
  // Frames through the clip (a quarter, half, three quarters) for "Read
  // them for me" to say what happens in it.
  motionFrameIds: z.array(id).max(4).default([]),
})
export type CloneSource = z.infer<typeof cloneSource>
// The sound bed (Phase 3; SPEC 5.5): ambience ("none", "room" for the
// built-in Room tone, or an uploaded recording's id; unset means the
// configured default), an optional uploaded music track, levels, ducking,
// and whether the clips' own sound stays.
const level = z.enum(['quiet', 'normal', 'loud']).default('normal')
export const soundSpec = z.object({
  ambience: z.string().max(60).optional(),
  ambienceLevel: level,
  music: id.nullable().default(null),
  musicLevel: level,
  duck: z.boolean().default(true),
  clipSound: z.boolean().default(true),
  // A voiceover (voice lines, overnight item 4): a converted voice line,
  // where it starts, its level, and whether its words are the captions.
  // The words are copied from the line when it is picked.
  voice: z.object({
    id,
    at: z.number().min(0).max(600).default(0),
    level,
    captions: z.boolean().default(true),
    title: z.string().max(120).default(''),
    words: z.array(z.object({ text: z.string().max(80), start: z.number().min(0).max(700), end: z.number().min(0).max(700) })).max(400).default([]),
  }).nullable().default(null),
}).prefault({})
export type SoundSpec = z.infer<typeof soundSpec>
// "Continue this shot" (Phase 3 chaining): the clip being continued, the
// last frame that starts the next take, and how far along it is.
const continueFrom = z.object({
  clipId: id,
  frameId: id.nullable().default(null),
  status: z.enum(['preparing', 'ready', 'joining', 'failed']),
  model: z.string().max(80).nullable().default(null),
  takeId: id.nullable().default(null),
  error: z.string().max(600).nullable().default(null),
})
export type ContinueFrom = z.infer<typeof continueFrom>
// Amazing Edits (Phase 5; config/edits.yaml): the post's edit style (the
// Idea step's Format and the Finish step's Edit style set the same field),
// its strength, where a one-shot edit lands (null: near the end), and the
// pop text of a freeze. Rendered free by code.
export const editSpec = z.object({
  style: z.enum(['none', ...EDIT_IDS]).default('none'),
  strength: z.enum(['subtle', 'normal', 'strong']).default('normal'),
  payoff: z.number().min(0).max(600).nullable().default(null),
  text: z.string().max(120).default(''),
  // A layout choice (split screen: stacked or side by side).
  variant: z.string().max(20).default(''),
}).prefault({})
export type EditSpec = z.infer<typeof editSpec>
// The caption look for one post (null: the account's default from
// content.yaml): TikTok's white box or the Outline style.
const captionStyle = z.enum(['box', 'outline']).nullable().default(null)
const memeSpec = z.object({
  // The Idea step's two ways in (owner, 2026-10-14): "Describe it" or
  // "Start from a real clip" (Recreate).
  start: z.enum(['describe', 'clip']).default('describe'),
  // A post made by a mass recreate row (item 24): its batch and row.
  massOf: z.object({ batchId: id, rowId: z.string().max(40) }).nullable().default(null),
  clipId: id.nullable().default(null),
  // The still the clip was made from, when it was made in this post.
  stillId: id.nullable().default(null),
  brollId: id.nullable().default(null),
  order: z.enum(['clip_first', 'broll_first']).default('clip_first'),
  brollStart: z.number().min(0).max(600).default(0),
  brollSeconds: z.number().min(0.5).max(60).default(6),
  caption: z.string().max(400).default(''),
  clone: cloneSource.nullable().default(null),
  sound: soundSpec,
  // The rough cut once the owner edits it (null: the automatic cut).
  cut: cutSchema.nullable().default(null),
  continueFrom: continueFrom.nullable().default(null),
  edit: editSpec,
  // Shot B of a two-shot edit (crash zoom, whip pan, hand over the lens),
  // and the still it is being made from.
  clipB: id.nullable().default(null),
  stillB: id.nullable().default(null),
  captionStyle,
  // No caption (owner, 2026-10-15): none in the editor or any export; the
  // caption's words stay for switching back.
  captionOff: z.boolean().default(false),
  // The OpenReel editor's project for this post (G29), saved by Done.
  // stack: its presets with relative places (editor phase C), which "Make
  // another like this" carries to the next post.
  editor: z.object({ projectAssetId: id.nullable().default(null), savedAt: z.string().max(40).nullable().default(null), stack: stackSchema.nullable().default(null) }).nullable().default(null),
  // Earlier failures cleared from the gray line (owner, 2026-10-15): the
  // ones made before this time stay out of sight; the records stay.
  failuresClearedAt: z.string().max(40).nullable().default(null),
  // Export for TikTok, Reels or Shorts (long run part 4): the preset's
  // length cap, bitrate cap and loudness, for every export of this post.
  exportPreset: z.string().max(20).default('tiktok'),
  // Hook variants: up to 3 lines, each over the first seconds of its own
  // version of the same timeline.
  hookVariants: z.array(z.string().max(200)).max(5).default([]),
  // Per version, an optional first shot (an asset of this account: one of
  // the post's takes or stills, or a clip) and an optional first edit (a
  // camera preset), over the same first seconds.
  hookShots: z.array(z.string().max(40).nullable()).max(5).default([]),
  hookEdits: z.array(z.string().max(40).nullable()).max(5).default([]),
  // The cover: a frame of the export and its text.
  cover: z.object({ at: z.number().min(0).max(600), text: z.string().max(200).default('') }).nullable().default(null),
  // Section 28: what the post keeps from its plan row (the on-screen text
  // is the caption above; the post's own caption, hashtags and CTA line
  // are in plan), and its alt hook.
  plan: planMetaSchema,
  // Section 32: what the post did once posted. Never copied.
  results: resultsSchema.nullable().default(null),
  // A faceless character's post (UX-PLAN.md section 35, item 4): the place,
  // the still's line, a product, the video prompt, the post's caption and
  // hashtags, the sound picks, Posted (server/pipeline/faceless.ts reads it).
  faceless: z.record(z.string(), z.unknown()).nullable().default(null),
  // "Finished damage" on any video post (owner, 2026-10-22, item 4j): one
  // still, a 7 s just-existing clip, a sad song and the on-screen line.
  recipe: z.enum(['finished_damage']).nullable().default(null),
  // Section 33: Approve for posting, its own day and slot, the Download day
  // zip it went into. Never copied.
  posting: postingSchema.nullable().default(null),
  // Weeks (UX-PLAN.md section 37): saved on its own; never copied.
  week: z.record(z.string(), z.unknown()).nullable().default(null),
})
// A slideshow (server/core/slideshowSpec.ts; UX-PLAN.md section 27).
const slideshowSpec = slideshowSpecSchema
// A batch rotates its clips and B-roll clips across the captions (owner,
// 2026-10-13): video i uses clip i mod n and B-roll i mod m. Older drafts
// with one clipId and brollId read as lists of one.
const batchObject = z.object({
  // Export for TikTok, Reels or Shorts (long run part 4).
  exportPreset: z.string().max(20).default('tiktok'),
  clipIds: z.array(id).max(20).default([]),
  brollIds: z.array(id).max(20).default([]),
  order: z.enum(['clip_first', 'broll_first']).default('clip_first'),
  brollStart: z.number().min(0).max(600).default(0),
  brollSeconds: z.number().min(0.5).max(60).default(6),
  topic: z.string().max(400).default(''),
  count: z.number().int().min(1).max(50).default(20),
  captions: z.array(z.string().max(400)).max(50).default([]),
  clone: cloneSource.nullable().default(null),
  sound: soundSpec,
  // A batch takes the one-shot edits (each video has one clip).
  edit: editSpec,
  captionStyle,
  // No caption on any video of the batch (owner, 2026-10-15).
  captionOff: z.boolean().default(false),
  // A saved style from the editor (editor phase D): its presets placed on
  // every video at that video's own payoff, cuts and beats.
  stack: stackSchema.nullable().default(null),
  styleName: z.string().max(60).nullable().default(null),
  // A batch of recreates (owner, 2026-10-14): up to 20 rows, each a clip
  // and a character in its own video post, with its own motion model.
  recreate: z.object({ rows: z.array(z.object({ postId: id, model: z.string().max(80).nullable().default(null) })).max(50).default([]) }).nullable().default(null),
  // Mass recreate (item 24; server/pipeline/massRecreate.ts reads it): the
  // sheet and folder, and each row from fetch to take.
  mass: z.record(z.string(), z.unknown()).nullable().default(null),
  // Section 32: what the batch did once posted. Never copied.
  results: resultsSchema.nullable().default(null),
})
const batchSpec = z.preprocess(raw => {
  if (!raw || typeof raw !== 'object') return raw
  const { clipId, brollId, ...rest } = raw as Record<string, unknown>
  return {
    ...rest,
    ...(rest.clipIds === undefined && typeof clipId === 'string' ? { clipIds: [clipId] } : {}),
    ...(rest.brollIds === undefined && typeof brollId === 'string' ? { brollIds: [brollId] } : {}),
  }
}, batchObject)
export const specSchemas = { meme: memeSpec, slideshow: slideshowSpec, batch: batchSpec }
export type MemeSpec = z.infer<typeof memeSpec>
export type SlideshowSpec = z.infer<typeof slideshowSpec>
export type BatchSpec = z.infer<typeof batchObject>

// The clip and B-roll for video i of a batch.
export function batchSources(s: BatchSpec, index: number): { clipId: string | null; brollId: string | null } {
  return {
    clipId: s.clipIds.length ? s.clipIds[index % s.clipIds.length]! : null,
    brollId: s.brollIds.length ? s.brollIds[index % s.brollIds.length]! : null,
  }
}

export const POST_STEPS = ['idea', 'stills', 'video', 'text', 'finish'] as const
export type PostStep = (typeof POST_STEPS)[number]

export interface ContentOutputs {
  videoAssetId?: string
  imageAssetIds?: string[]
  // A slideshow's Instagram set (1080 x 1440), in the same order, and its
  // post.json (UX-PLAN.md section 27).
  instagramAssetIds?: string[]
  jsonAssetId?: string
  // One post, three platforms (item 28): the Instagram carousel, the reel,
  // the Shorts copy and their zip.
  platforms?: { carouselIds: string[]; reelId: string; shortsId: string; zipId: string; slideSec: number[]; reelSec: number; madeAt: string }
  // A batch, by caption order (a failed video leaves a gap), with the clip
  // and B-roll each one used (they rotate).
  videos?: Array<{ caption: string; assetId: string; clipId?: string; brollId?: string | null } | null>
  zipAssetId?: string
  done?: number
  failed?: number
  total?: number
  dropped?: string[]
  renderedAt?: string
  durationSec?: number
  sound?: Pick<SoundBedResult, 'layers' | 'targetLufs' | 'ducked'>
  // A batch: why each failed video failed (by index), and the zip parts.
  errors?: Record<string, string>
  zipParts?: Array<{ assetId: string; from: number; to: number }>
  // What the edit did (Phase 5), in plain words.
  editNote?: string | null
  // R1 (item 9): the face boxes found across the clip (shares of the
  // frame), shown on the preview; the captions stay clear of them.
  faceBoxes?: Array<{ x: number; y: number; w: number; h: number }>
  // Exported from the OpenReel editor (G29) rather than rendered here.
  fromEditor?: boolean
  // Rendered here from the post's timeline (editor phase D, G32), and what
  // only the editor's own export draws.
  fromTimeline?: boolean
  editorOnly?: string[]
  // The export preset it was made for, and whether the bitrate was capped.
  preset?: string
  capped?: boolean
  // Hook variants (long run part 4): one video per hook, same timeline.
  variants?: Array<{ hook: string; shot?: string | null; edit?: string | null; letter?: string; assetId: string; durationSec: number }>
  variantsRunning?: boolean
  variantsError?: string | null
  // The cover image and the frame and text it was made from.
  cover?: { assetId: string; at: number; text: string }
  coverRunning?: boolean
}

function parseSpec(kind: string, raw: unknown) {
  const schema = specSchemas[kind as ContentKind]
  if (!schema) throw new AppError('bad_request', `Unknown content kind "${kind}".`)
  const r = schema.safeParse(raw ?? {})
  if (!r.success) throw new AppError('invalid_request', `That ${kind} is not valid: ${r.error.issues.map(i => `${i.path.join('.') || 'value'} ${i.message.toLowerCase()}`).join('; ')}.`)
  return r.data
}

// The newest posts first (the list holds the newest 200; Posts home pages
// past them with contentPage).
export const LIST_SIZE = 200
export async function listContent(deps: Deps, ctx: Ctx, characterId?: string | null): Promise<ContentRow[]> {
  return deps.db.select().from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), ...(characterId ? [eq(contentItems.characterId, characterId)] : [])))
    .orderBy(desc(contentItems.updatedAt), desc(contentItems.id)).limit(LIST_SIZE)
}

// Older posts, a page at a time (Posts home, "Show older posts"): newest
// first by the time they were last changed, then by id; `before` is the id
// of the last post shown, so a page starts right after it. The account and
// character filters apply here, so a filter finds older posts too.
// The product filter takes a product id, or "none" for posts with none.
export async function contentPage(deps: Deps, ctx: Ctx, q: { before?: string | null; limit?: number; accountTag?: string | null; characterId?: string | null; productId?: string | null }): Promise<{ items: ReturnType<typeof itemView>[]; next: string | null }> {
  const limit = Math.max(1, Math.min(LIST_SIZE, Math.round(q.limit ?? 60)))
  const conds = [eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt)]
  if (q.characterId) conds.push(eq(contentItems.characterId, q.characterId))
  if (q.accountTag) conds.push(eq(contentItems.accountTag, cleanTag(q.accountTag)))
  if (q.productId) conds.push(q.productId === 'none' ? isNull(contentItems.productId) : eq(contentItems.productId, q.productId))
  if (q.before) conds.push(sql`(${contentItems.updatedAt}, ${contentItems.id}) < (select c.updated_at, c.id from content_items c where c.account_id = ${ctx.accountId} and c.id = ${q.before})`)
  const rows = await deps.db.select().from(contentItems).where(and(...conds)).orderBy(desc(contentItems.updatedAt), desc(contentItems.id)).limit(limit + 1)
  return { items: rows.slice(0, limit).map(itemView), next: rows.length > limit ? rows[limit - 1]!.id : null }
}

export async function getContent(deps: Deps, ctx: Ctx, itemId: string): Promise<ContentRow> {
  const [row] = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, itemId)))
  if (!row || row.archivedAt) throw notFound('Content')
  return row
}

export interface PostInput {
  kind: ContentKind
  characterId: string
  title?: string
  spec?: unknown
  idea?: string
  accountTag?: string
  sceneId?: string | null
  step?: PostStep
  // The post's product (section 29): left out, its account's product (Posts
  // home > Accounts) or none; null, none.
  productId?: string | null
}

// A scene can belong to a post only when it is the post's character's.
async function checkScene(deps: Deps, ctx: Ctx, sceneId: string | null | undefined, characterId: string): Promise<string | null> {
  if (!sceneId) return null
  const scene = await getScene(deps, ctx, sceneId)
  if (scene.characterId !== characterId) throw new AppError('bad_request', 'That scene belongs to another character.')
  return scene.id
}

export async function createContent(deps: Deps, ctx: Ctx, input: PostInput): Promise<ContentRow> {
  await getCharacter(deps, ctx, input.characterId)
  const defaults = deps.config.pipeline.content
  const base = input.kind === 'batch' ? { count: defaults.batch.default_count } : input.kind === 'meme' ? { brollSeconds: defaults.meme.broll_seconds, order: defaults.meme.order } : {}
  const spec = parseSpec(input.kind, { ...base, ...((input.spec as object) ?? {}) })
  const accountTag = cleanTag(input.accountTag ?? '')
  const productId = input.productId !== undefined ? await checkProduct(deps, ctx, input.productId) : await defaultProductFor(deps, ctx, accountTag)
  const [row] = await deps.db.insert(contentItems).values({
    id: newId('cnt'), accountId: ctx.accountId, characterId: input.characterId, kind: input.kind,
    title: (input.title ?? '').slice(0, 120), spec, createdBy: ctx.userId, productId,
    idea: (input.idea ?? '').slice(0, 2000), accountTag,
    sceneId: await checkScene(deps, ctx, input.sceneId, input.characterId), step: input.step ?? 'idea',
  }).returning()
  return row!
}

export interface PostPatch { title?: string; spec?: unknown; idea?: string; accountTag?: string; sceneId?: string | null; step?: PostStep; characterId?: string; productId?: string | null }

// The picks that belong to a character (its clips and stills); B-roll is the
// account's and stays when the character changes.
const CHARACTER_PICKS: Record<ContentKind, Record<string, unknown>> = {
  meme: { clipId: null, stillId: null, clipB: null, stillB: null },
  slideshow: { stillIds: [] },
  batch: { clipIds: [] },
}

export async function updateContent(deps: Deps, ctx: Ctx, itemId: string, patch: PostPatch): Promise<ContentRow> {
  const row = await getContent(deps, ctx, itemId)
  const kind = row.kind as ContentKind
  // Switching the character drops its scene and the clips and stills that
  // were its own; the idea, text and B-roll stay.
  const switching = patch.characterId !== undefined && patch.characterId !== row.characterId
  if (switching) await getCharacter(deps, ctx, patch.characterId!)
  const characterId = switching ? patch.characterId! : row.characterId!
  let spec = row.spec
  if (patch.spec !== undefined || switching) {
    spec = parseSpec(kind, { ...(row.spec as object), ...((patch.spec as object) ?? {}), ...(switching ? CHARACTER_PICKS[kind] : {}) })
    spec = await withVoice(deps, ctx, kind, row.spec, spec, switching ? null : characterId)
  }
  const sceneId = patch.sceneId !== undefined ? await checkScene(deps, ctx, patch.sceneId, characterId) : switching ? null : row.sceneId
  // The scene made from the idea follows the idea while it still reads the
  // same (a scene picked from the Library keeps its own words).
  if (patch.idea !== undefined && sceneId && sceneId === row.sceneId && patch.idea.trim() !== row.idea.trim()) {
    const scene = await getScene(deps, ctx, sceneId)
    if (scene.brief.trim() === row.idea.trim()) await updateScene(deps, ctx, sceneId, { brief: patch.idea.trim() })
  }
  // The product (section 29): picked, else a post with none takes its new
  // account's product when the account changes.
  const accountTag = patch.accountTag !== undefined ? cleanTag(patch.accountTag) : row.accountTag
  const productId = patch.productId !== undefined ? await checkProduct(deps, ctx, patch.productId)
    : !row.productId && accountTag !== row.accountTag ? await defaultProductFor(deps, ctx, accountTag) : row.productId
  const [out] = await deps.db.update(contentItems).set({
    title: patch.title !== undefined ? patch.title.slice(0, 120) : row.title, spec,
    idea: patch.idea !== undefined ? patch.idea.slice(0, 2000) : row.idea,
    accountTag, productId,
    step: patch.step ?? row.step, characterId, sceneId, updatedAt: deps.clock.now(),
  }).where(eq(contentItems.id, row.id)).returning()
  return out!
}

// A voiceover's words come from its voice line when it is picked (and a
// voice line belongs to one character, so switching drops it). Only video
// posts take one.
async function withVoice(deps: Deps, ctx: Ctx, kind: ContentKind, before: unknown, spec: unknown, characterId: string | null): Promise<unknown> {
  const sp = spec as { sound?: SoundSpec }
  const v = sp.sound?.voice
  if (!v) return spec
  if (kind !== 'meme' || !characterId) return { ...sp, sound: { ...sp.sound!, voice: null } }
  const old = (before as { sound?: Partial<SoundSpec> } | null)?.sound?.voice
  if (old && old.id === v.id && v.words.length) return spec
  const line = await voiceForPost(deps, ctx, v.id, characterId)
  return { ...sp, sound: { ...sp.sound!, voice: { ...v, words: line.words, title: line.title } } }
}

// "Make another like this" (owner, 2026-10-13): the same post with
// everything filled in, as a new draft that opens at the Text step. Nothing
// rendered is copied.
export async function duplicateContent(deps: Deps, ctx: Ctx, itemId: string): Promise<ContentRow> {
  const row = await getContent(deps, ctx, itemId)
  // The editor's stack comes along (its places are relative), not the
  // timeline itself, which names this post's media.
  const spec = row.spec as { editor?: { stack?: unknown } | null } | null
  const withStack = spec?.editor ? { ...spec, editor: { projectAssetId: null, savedAt: null, stack: spec.editor.stack ?? null } } : row.spec
  // What the post did once posted and its posting state are its own
  // (sections 32 and 33).
  const copied = { ...((withStack ?? {}) as object), results: null, posting: null, week: null }
  const [out] = await deps.db.insert(contentItems).values({
    id: newId('cnt'), accountId: ctx.accountId, characterId: row.characterId, kind: row.kind,
    title: row.title, idea: row.idea, accountTag: row.accountTag, sceneId: row.sceneId, spec: copied, productId: row.productId,
    step: 'text', createdBy: ctx.userId,
  }).returning()
  return out!
}

// The post's scene: made from the post's idea once there is one (free;
// nothing runs until Generate). The post stays on the step it is on.
export async function postScene(deps: Deps, ctx: Ctx, itemId: string): Promise<ContentRow> {
  const row = await getContent(deps, ctx, itemId)
  if (row.sceneId) return row
  // A slideshow's scene starts from its idea, else its hook (hook first,
  // UX-PLAN.md section 27).
  const hook = row.kind === 'slideshow' ? String((row.spec as { hook?: string } | null)?.hook ?? '').trim() : ''
  const scene = await createScene(deps, ctx, row.characterId!, { brief: row.idea.trim() || hook, title: row.title || undefined })
  return updateContent(deps, ctx, row.id, { sceneId: scene.id })
}

export async function archiveContent(deps: Deps, ctx: Ctx, itemId: string): Promise<void> {
  const row = await getContent(deps, ctx, itemId)
  await deps.db.update(contentItems).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id))
}

// A kept clip (a take, its upscale, later a clone) or a still, from this
// account and character.
export async function candidateAsset(deps: Deps, ctx: Ctx, candidateId: string, characterId: string, media: 'video' | 'image'): Promise<string> {
  const [c] = await deps.db.select({ assetId: candidates.assetId, op: candidates.op, characterId: candidates.characterId }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, candidateId)))
  const isVideo = !!c && isVideoOp(c.op)
  if (!c || c.characterId !== characterId || isVideo !== (media === 'video')) throw new AppError('bad_request', media === 'video' ? 'Pick a clip from this character.' : 'Pick stills from this character.')
  if (!c.assetId) throw new AppError('bad_request', media === 'video' ? 'A picked clip is still being prepared. Try again in a moment.' : 'A picked still has no image yet.')
  return c.assetId
}

// What a render needs, checked before it is queued, so a mistake shows at
// once instead of on the worker.
export function renderProblems(deps: Deps, row: ContentRow): string[] {
  const out: string[] = []
  if (row.kind === 'meme') {
    const s = memeSpec.parse(row.spec)
    const cfg = deps.config.pipeline.content
    const cut = effectiveCut(s, cfg.meme.max_broll_seconds, voicePhrases(deps))
    out.push(...cutProblems(cut, { maxShots: cfg.cut.max_shots, maxCaptions: cfg.cut.max_captions }))
    // A timeline saved by the editor decides its own shots (editor phase D).
    const style = s.editor?.projectAssetId ? undefined : deps.config.pipeline.edits.styles.find(x => x.id === s.edit.style)
    if (style?.shots === 2 && cut.shots.filter(x => x.kind === 'clip').length < 2) out.push(`Add shot B for the ${style.label.toLowerCase()} (Video step)`)
    if (style?.needs.includes('background') && !cut.shots.some(x => x.kind === 'broll')) out.push(`Pick B-roll or a screenshot for the ${style.label.toLowerCase()} background (Video step)`)
  } else if (row.kind === 'batch') {
    const s = batchSpec.parse(row.spec)
    if (!s.clipIds.length) out.push('Pick a clip')
    const bs = deps.config.pipeline.edits.styles.find(x => x.id === s.edit.style)
    if (bs?.shots === 2) out.push('A batch takes one-shot edits only; pick another edit style')
    if (bs?.needs.includes('background')) out.push(`A batch cannot use the ${bs.label.toLowerCase()} yet; pick another edit style`)
  } else {
    out.push(...slideshowProblems(slideshowSpec.parse(row.spec)))
  }
  return out
}

export async function startRender(deps: Deps, ctx: Ctx, itemId: string): Promise<ContentRow> {
  const row = await getContent(deps, ctx, itemId)
  const problems = renderProblems(deps, row)
  if (problems.length) throw new AppError('bad_request', `${problems.join('; ')}.`)
  if (row.status === 'rendering') throw new AppError('bad_request', 'This is already rendering.')
  // A batch is one short job per video (the worker takes other work in
  // between), and the last one bundles the zip.
  const total = row.kind === 'batch' ? batchCaptions(deps, batchSpec.parse(row.spec)).length : 0
  const outputs: ContentOutputs = row.kind === 'batch' ? { videos: [], errors: {}, done: 0, failed: 0, total } : {}
  const [out] = await deps.db.update(contentItems).set({ status: 'rendering', error: null, outputs, updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id)).returning()
  if (row.kind === 'batch') {
    for (let i = 0; i < total; i++) await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `content_render:${row.id}`, label: `Render batch video ${i + 1} of ${total}`, characterId: row.characterId, request: { index: i } })
  } else {
    await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `content_render:${row.id}`, label: row.kind === 'meme' ? 'Render the meme video' : 'Export the slideshow', characterId: row.characterId, request: {} })
  }
  return out!
}

// One video per caption line. Captions are optional (owner, 2026-10-15):
// with no lines, How many counts the videos; with No caption, the lines
// still count them and none is drawn.
const batchCaptions = (deps: Deps, s: BatchSpec) => {
  const max = deps.config.pipeline.content.batch.max
  const lines = s.captions.map(c => c.trim()).filter(Boolean).slice(0, max)
  return lines.length ? lines : Array.from({ length: Math.min(s.count, max) }, () => '')
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'content'

export async function setOutputs(deps: Deps, itemId: string, outputs: ContentOutputs, status?: string): Promise<void> {
  await deps.db.update(contentItems).set({ outputs, ...(status ? { status } : {}), updatedAt: deps.clock.now() }).where(eq(contentItems.id, itemId))
}

// One video from a cut (Phase 3 rough cut): the shots joined with hard
// cuts, the captions by time, then the sound bed, normalized to social
// loudness. Free: ffmpeg and sharp on the worker.
// The timeline's own picture (editor phase D, G32): camera blocks for the
// camera pass, the one code edit and the caption look a plan sets, and
// for a saved editor timeline its shots as files and its captions.
export interface RenderPlan {
  blocks: CameraBlock[]
  edit: { style: string; strength: EditSpec['strength']; at: number } | null
  captionStyle: 'box' | 'outline' | null
  prepared?: { shots: TimelineShot[]; captions: Array<{ text: string; start: number; end: number | null; position?: CaptionPosition }> }
}
type CaptionPosition = 'top' | 'upper_third' | 'middle' | 'bottom'

async function renderCut(deps: Deps, ctx: Ctx, job: JobRow, fullCut: Cut, input: { characterId: string; caption: string; sound: SoundSpec; label: string; edit?: EditSpec; captionStyle?: 'box' | 'outline' | null; plan?: RenderPlan; preset?: ExportPreset; hook?: string; head?: string | null; firstEdit?: string | null }) {
  const base0 = deps.config.pipeline.content
  // The export preset's length cap (never past the Studio's own).
  const base = input.preset ? { ...base0, cut: { ...base0.cut, max_seconds: Math.min(base0.cut.max_seconds, input.preset.max_seconds) } } : base0
  const plan = input.plan
  // A plan's edit and caption look win; without a plan the post's Format
  // and caption look stand (the cut as before).
  if (plan) {
    input = { ...input, captionStyle: plan.captionStyle ?? input.captionStyle, edit: plan.edit
      ? { ...(input.edit ?? editSpec.parse({})), style: plan.edit.style as EditSpec['style'], strength: plan.edit.strength, payoff: plan.edit.at }
      : { ...(input.edit ?? editSpec.parse({})), style: 'none' } }
  }
  // A hook variant's first edit: a camera preset at 0 s (part 4).
  const seconds = base.hook_variants.seconds
  const firstDef = input.firstEdit ? (deps.config.pipeline.presets.presets as PresetInfo[]).find(p => p.id === input.firstEdit && p.kind === 'camera' && p.keys?.length) : null
  const firstBlock: CameraBlock | null = firstDef ? { start: 0, duration: Math.min(firstDef.duration, seconds), strength: 'normal', keys: firstDef.keys!, preset: firstDef.id } : null
  const blocks = headBlocks(plan?.blocks ?? [], seconds, firstBlock)
  // The post's caption look (box or outline) over the account's default.
  const cfg = { ...base, caption: { ...base.caption, style: input.captionStyle ?? base.caption.style } }
  const style = input.edit?.style ?? 'none'
  const def = deps.config.pipeline.edits.styles.find(x => x.id === style)
  // The green screen puts the B-roll behind her instead of cutting to it.
  const behind = def?.needs.includes('background') ? fullCut.shots.find(x => x.kind === 'broll') ?? null : null
  const cut: Cut = behind ? { ...fullCut, shots: fullCut.shots.filter(x => x !== behind) } : fullCut
  return withTempDir(async dir => {
    const shots: TimelineShot[] = []
    let background: string | undefined
    if (behind) {
      const b = await getBroll(deps, ctx, behind.ref)
      if (b.status !== 'ready' || !b.assetId) throw new AppError('bad_request', `The B-roll clip "${b.title}" is not ready yet.`)
      const a = await readAsset(deps, ctx, b.assetId)
      background = join(dir, `background.${a.row.mime.startsWith('image/') ? 'png' : 'mp4'}`)
      await writeFile(background, a.data)
    }
    // Every shot is made plain first (one size, square pixels, constant
    // frame rate, yuv420p, 48 kHz stereo or no sound): the render only ever
    // sees plain files. A clip's plain copy is kept for the next render.
    if (plan?.prepared) shots.push(...plan.prepared.shots)
    else for (const [i, sh] of cut.shots.entries()) {
      if (sh.kind === 'clip') {
        const path = await plainClip(deps, ctx, sh.ref, input.characterId, dir, `shot${i}`, input.sound.clipSound)
        shots.push({ path, in: sh.in, out: sh.out, maxSeconds: cfg.meme.max_clip_seconds })
      } else {
        const b = await getBroll(deps, ctx, sh.ref)
        if (b.status !== 'ready' || !b.assetId) throw new AppError('bad_request', `The B-roll clip "${b.title}" is not ready yet.`)
        const raw = join(dir, `shot${i}.raw.mp4`), path = join(dir, `shot${i}.mp4`)
        await writeFile(raw, (await readAsset(deps, ctx, b.assetId)).data)
        await normalizeForRender(raw, path, { canvas: cfg.canvas, keepSound: false })
        shots.push({ path, in: sh.in, out: sh.out, maxSeconds: cfg.meme.max_broll_seconds })
      }
    }
    // A hook variant's first shot: the first seconds of picture come from
    // another take, still or clip; the timeline carries on from there.
    if (input.head) {
      const a = await readAsset(deps, ctx, input.head)
      const raw = join(dir, 'head.raw'), path = join(dir, 'head.mp4')
      await writeFile(raw, a.data)
      if (a.row.mime.startsWith('image/')) {
        const still = join(dir, 'head-still.mp4')
        await transcodeBroll(raw, still, { maxSeconds: seconds + 1, fps: cfg.canvas.fps, stillSeconds: seconds + 0.5 })
        await normalizeForRender(still, path, { canvas: cfg.canvas, keepSound: false })
      } else await normalizeForRender(raw, path, { canvas: cfg.canvas, keepSound: input.sound.clipSound })
      const placed = await Promise.all(shots.map(async sh => ({ shot: sh, length: planShots([sh], [await probeFile(sh.path)])[0]?.durationSec ?? 0 })))
      shots.splice(0, shots.length, ...replaceHead(placed, seconds, { path, in: 0, out: null }))
    }
    const captions: TimelineCaption[] = []
    const dropped: string[] = []
    // R1 (item 9): faces across the whole clip, about every 0.5 s; the
    // captions stay clear of every box (free, when the face models are on).
    const faceBoxes = await clipFaces(deps, shots, dir)
    const baseCaptions = plan?.prepared ? plan.prepared.captions : cut.captions.map(c => ({ text: c.text ?? input.caption, start: c.start, end: c.end, position: undefined as CaptionPosition | undefined }))
    // A hook variant: the hook over the first seconds, in place of a caption there.
    const captionList = input.hook ? hookCaptions(baseCaptions, input.hook, base.hook_variants.seconds, (text, start, end) => ({ text, start, end, position: undefined as CaptionPosition | undefined })) : baseCaptions
    for (const [j, c] of captionList.entries()) {
      const text = (c.text ?? input.caption).trim()
      if (!text) continue
      const overlay = await captionPng(text, c.position ? { ...cfg, caption: { ...cfg.caption, position: c.position } } : cfg, { faces: faceBoxes })
      const png = join(dir, `caption${j}.png`)
      await writeFile(png, overlay.png)
      captions.push({ png, start: c.start, end: c.end })
      dropped.push(...overlay.layout.dropped)
    }
    const picture = join(dir, 'picture.mp4'), out = join(dir, 'out.mp4')
    // A clip only has sound when the owner kept it (a clone with "Keep
    // original sound", an upload's own sound); every take is stored silent.
    let finalPicture = picture
    let accents: Array<{ path: string; at: number; db?: number }> = []
    let durationSec: number
    let editNote: string | null = null
    if (style === 'none' && !blocks.length) {
      durationSec = (await renderTimeline({ shots, captions, canvas: cfg.canvas, out: picture, keepSound: input.sound.clipSound, maxSeconds: cfg.cut.max_seconds })).durationSec
    } else if (style === 'none') {
      // Presets from the editor: the clean picture, the camera pass (the
      // editor's own math), then the captions over it, still and readable.
      const clean = join(dir, 'clean.mp4'), moved = join(dir, 'moved.mp4')
      const t = await renderTimeline({ shots, captions: [], canvas: cfg.canvas, out: clean, keepSound: input.sound.clipSound, maxSeconds: cfg.cut.max_seconds })
      await applyCameraBlocks(clean, moved, blocks, cfg.canvas)
      await renderTimeline({ shots: [{ path: moved, in: 0, out: null }], captions, canvas: cfg.canvas, out: picture, keepSound: input.sound.clipSound })
      durationSec = t.durationSec
    } else {
      // Amazing Edits (Phase 5): the clean picture, then the edit, then the
      // captions (moved with the edit's time), then the sound bed.
      const clean = join(dir, 'clean.mp4'), edited = join(dir, 'edited.mp4')
      const t = await renderTimeline({ shots, captions: [], canvas: cfg.canvas, out: clean, keepSound: input.sound.clipSound, maxSeconds: cfg.cut.max_seconds })
      const r = await runEdit(deps, ctx, { style, edit: input.edit!, cut, plan: t.shots, picture: clean, out: blocks.length ? join(dir, 'edited-only.mp4') : edited, dir, totalSec: t.durationSec, sound: input.sound, background })
      // The editor's camera presets after the code edit, before the captions.
      if (blocks.length) await applyCameraBlocks(join(dir, 'edited-only.mp4'), edited, blocks, cfg.canvas)
      editNote = r.note
      const moved = await editCaptions(deps, cut, captions, { style, edit: input.edit!, caption: input.caption, timeMap: r.timeMap, payoff: r.payoff, durationSec: r.durationSec, dir, cfg })
      finalPicture = join(dir, 'captioned.mp4')
      if (style === 'text_behind' && r.mask) {
        // The words go between the room and her.
        await overlayBehind({ video: edited, mask: r.mask, out: finalPicture, canvas: cfg.canvas, captions: moved })
        durationSec = r.durationSec
      } else {
        durationSec = (await renderTimeline({ shots: [{ path: edited, in: 0, out: null }], captions: moved, canvas: cfg.canvas, out: finalPicture, keepSound: input.sound.clipSound })).durationSec
      }
      for (const [i, a] of (r.accents ?? []).entries()) {
        const path = join(dir, `accent${i}.wav`)
        await makeScratch(path)
        accents.push({ path, at: a.at, db: -2 })
      }
    }
    const bed = await layBed(deps, ctx, finalPicture, out, dir, input.sound, accents, input.preset)
    // The preset's bitrate cap: encoded again only when the file is over it.
    const capped = input.preset ? await capBitrate(out, join(dir, 'capped.mp4'), input.preset.video_kbps) : null
    const asset = await saveAsset(deps, ctx, { data: await readFile(capped ? join(dir, 'capped.mp4') : out), mime: 'video/mp4', origin: 'derived', label: input.label, sourceJobId: job.id })
    return { assetId: asset.id, dropped, durationSec, editNote, capped: !!capped?.capped, sound: { layers: bed.layers, targetLufs: bed.targetLufs, ducked: bed.ducked }, faceBoxes }
  })
}

// A clip as a plain file for the render (server/media/normalize.ts). The
// plain copy is saved once per clip (with or without its sound) and reused.
async function plainClip(deps: Deps, ctx: Ctx, clipId: string, characterId: string, dir: string, name: string, keepSound: boolean): Promise<string> {
  const assetId = await candidateAsset(deps, ctx, clipId, characterId, 'video')
  const canvas = deps.config.pipeline.content.canvas
  const key = `v${NORMALIZE_VERSION}:${canvas.width}x${canvas.height}@${canvas.fps}:${keepSound ? 'sound' : 'silent'}:${assetId}`
  const [cand] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, clipId)))
  const meta = (cand?.meta ?? {}) as { plain?: Record<string, string> }
  const path = join(dir, `${name}.mp4`)
  const cached = meta.plain?.[key]
  if (cached) {
    try { await writeFile(path, (await readAsset(deps, ctx, cached)).data); return path } catch { /* made again below */ }
  }
  const raw = join(dir, `${name}.raw`)
  await writeFile(raw, (await readAsset(deps, ctx, assetId)).data)
  await normalizeForRender(raw, path, { canvas, keepSound })
  if (cand) {
    const saved = await saveAsset(deps, ctx, { data: await readFile(path), mime: 'video/mp4', origin: 'derived', label: `Plain copy of ${clipId} for renders` })
    // Only the newest plain copy per clip and sound choice is kept in the list.
    const plain = Object.fromEntries(Object.entries(meta.plain ?? {}).filter(([k]) => !k.endsWith(`:${assetId}`) || k.split(':')[2] !== (keepSound ? 'sound' : 'silent')))
    await deps.db.update(candidates).set({ meta: { ...meta, plain: { ...plain, [key]: saved.id } } }).where(eq(candidates.id, cand.id))
  }
  return path
}

// One edit on the clean picture (Phase 5). Two-shot edits work on the cut
// where shot B (the second clip) starts; a zoom finds her face first (the
// face models on the worker), else the middle of the upper frame.
async function runEdit(deps: Deps, ctx: Ctx, a: { style: EditStyle; edit: EditSpec; cut: Cut; plan: Array<{ start: number }>; picture: string; out: string; dir: string; totalSec: number; sound: SoundSpec; background?: string }) {
  const cfg = deps.config.pipeline
  const def = cfg.edits.styles.find(x => x.id === a.style)
  if (!def) throw new AppError('bad_request', `Unknown edit style "${a.style}".`)
  const params = def.params[a.edit.strength] ?? def.params.normal
  const clipIdx = a.cut.shots.map((s, i) => (s.kind === 'clip' ? i : -1)).filter(i => i >= 0)
  const shotB = clipIdx[1] != null ? a.plan[clipIdx[1]]?.start : undefined
  const anyCut = a.plan.slice(1).map(p => p.start)
  // Flash and shake hits the first cut unless the owner placed it.
  const cuts = def.shots === 2 ? (shotB != null ? [shotB] : []) : def.anchor === 'cut_or_payoff' && a.edit.payoff == null ? anyCut.slice(0, 1) : []
  if (def.shots === 2 && !cuts.length) throw new AppError('bad_request', `${def.label} needs shot B: add it in the Video step.`)
  const payoff = Math.max(0.2, Math.min(a.totalSec - 0.2, a.edit.payoff ?? a.totalSec - cfg.edits.payoff_from_end))
  let face = DEFAULT_FACE
  if (['crash_zoom', 'zoom_reveal', 'punch_in', 'snap_zoom', 'dolly_zoom', 'record_scratch'].includes(a.style)) {
    const at = a.style === 'crash_zoom' ? Math.max(0, cuts[0]! - (params.seconds ?? 0.6)) : a.style === 'zoom_reveal' ? 0.05 : a.style === 'punch_in' ? 0.5 : payoff
    face = await faceCenter(deps, a.picture, Math.min(at, a.totalSec - 0.05), a.dir) ?? DEFAULT_FACE
  }
  let beats: number[] | undefined
  if ((a.style === 'punch_in' || a.style === 'velocity') && a.sound.music) beats = await detectBeats(await soundFile(deps, ctx, a.sound.music, a.dir, 'beat-music.m4a'), a.totalSec).catch(() => undefined)
  // Her outline, for the edits that put something behind her (free, on
  // the worker; the person model ships with the face models).
  let mask: string | undefined
  let maskNote = ''
  if (def.needs.includes('mask')) {
    if (!segmentAvailable(deps.env.STUDIO_MODELS_DIR)) throw new AppError('bad_request', `${def.label} needs the person model on the worker (npm run models).`)
    mask = join(a.dir, 'mask.mp4')
    const m = await personMaskVideo(a.picture, mask, { modelsDir: deps.env.STUDIO_MODELS_DIR, fps: cfg.content.canvas.fps })
    if (m.coverage < 0.02) maskNote = ' No person was found in the clip, so nothing sits in front.'
  }
  const r = await applyEdit({ style: a.style, video: a.picture, out: a.out, workDir: a.dir, canvas: cfg.content.canvas, params, cuts, payoff, face, beats, mask, background: a.background, variant: a.edit.variant || def.variants?.[0]?.id })
  return { ...r, note: r.note || maskNote ? `${r.note ?? ''}${maskNote}`.trim() : null, payoff, mask }
}

// Every face box across the shots, sampled about every 0.5 s (at most 120
// frames), as shares of the frame (R1, item 9). [] when the face models are
// off or a frame cannot be read.
export async function clipFaces(deps: Deps, shots: Array<{ path: string; in: number; out: number | null }>, dir: string): Promise<Array<{ x: number; y: number; w: number; h: number }>> {
  try {
    if (!(await deps.faces.status()).available) return []
    const sharp = (await import('sharp')).default
    const out: Array<{ x: number; y: number; w: number; h: number }> = []
    let n = 0
    for (const [k, sh] of shots.entries()) {
      const end = sh.out ?? (await probeFile(sh.path)).durationSec ?? 0
      for (let t = sh.in; t < end && n < 120; t += 0.5, n++) {
        const png = join(dir, `faces-${k}-${Math.round(t * 1000)}.png`)
        try {
          await extractFrameAt(sh.path, t, png)
          const img = await readFile(png)
          const meta = await sharp(img).metadata()
          if (!meta.width || !meta.height) continue
          for (const f of await deps.faces.detect(img)) out.push({ x: f.box.x / meta.width, y: f.box.y / meta.height, w: f.box.w / meta.width, h: f.box.h / meta.height })
        } catch { /* a frame that cannot be read is skipped */ }
      }
    }
    return out
  } catch { return [] }
}

// Where her face is in a frame, as a share of the frame; null when the face
// models are off or no face is found.
async function faceCenter(deps: Deps, video: string, at: number, dir: string): Promise<{ x: number; y: number } | null> {
  try {
    if (!(await deps.faces.status()).available) return null
    const png = join(dir, `face-${Math.round(at * 1000)}.png`)
    await extractFrameAt(video, at, png)
    const img = await readFile(png)
    const meta = await (await import('sharp')).default(img).metadata()
    const [f] = (await deps.faces.detect(img)).sort((x, y) => y.box.w * y.box.h - x.box.w * x.box.h)
    if (!f || !meta.width || !meta.height) return null
    return { x: (f.box.x + f.box.w / 2) / meta.width, y: (f.box.y + f.box.h / 2) / meta.height }
  } catch { return null }
}

// The captions after an edit: moved with its time; word by word for Word
// pop; each word lit in turn for Karaoke; big and plain for Text behind
// subject (laid behind her later); a pop during a freeze (the freeze pop
// and the record scratch), with the other captions stepping aside.
type ContentCfg = Deps['config']['pipeline']['content']
async function editCaptions(deps: Deps, cut: Cut, captions: TimelineCaption[], a: { style: EditStyle; edit: EditSpec; caption: string; timeMap: Array<[number, number]>; payoff: number; durationSec: number; dir: string; cfg?: ContentCfg }): Promise<TimelineCaption[]> {
  const cfg = a.cfg ?? deps.config.pipeline.content
  const def = deps.config.pipeline.edits.styles.find(x => x.id === a.style)!
  const params = def.params[a.edit.strength] ?? def.params.normal
  // A voiceover is laid over the finished picture, so captions made from it
  // keep its times; text captions move with the edit's time.
  const voiced = cut.captions.length > 0 && cut.captions.every(c => !!c.words)
  const when = (t: number) => (voiced ? t : mapTime(a.timeMap, t))
  const moved = captions.map(c => ({ ...c, start: when(c.start), end: c.end == null ? null : Math.min(a.durationSec, when(c.end)) }))
  const fps = cfg.canvas.fps
  const png = async (text: string, name: string, over: Partial<typeof cfg.caption> = {}, look: CaptionLook = {}) => {
    const file = join(a.dir, name)
    await writeFile(file, (await captionPng(text, { canvas: cfg.canvas, caption: { ...cfg.caption, ...over } }, look)).png)
    return file
  }
  const texts = cut.captions.map(c => (c.text ?? a.caption).trim())
  if (a.style === 'word_pop') {
    // Each caption appears one word at a time; each new word pops for two
    // frames. Long captions step a few words at a time.
    const out: TimelineCaption[] = []
    for (const [ci, text] of texts.entries()) {
      const at = moved[ci]
      if (!text || !at) continue
      const words = text.split(/\s+/)
      const per = Math.max(1, Math.ceil(words.length / 24))
      const steps = Math.ceil(words.length / per)
      const end = at.end ?? a.durationSec
      for (let k = 1; k <= steps; k++) {
        const shown = words.slice(0, k * per).join(' ')
        const t0 = Math.min(end - 0.05, at.start + (k - 1) * (params.per_word ?? 0.3))
        const t1 = k < steps ? Math.min(end, at.start + k * (params.per_word ?? 0.3)) : end
        if (t1 - t0 < 0.02) continue
        const pop = Math.min(t1, t0 + 2 / fps)
        out.push({ png: await png(shown, `w${ci}_${k}_pop.png`, { size: cfg.caption.size * (params.pop ?? 1.08) }), start: t0, end: pop })
        if (t1 > pop) out.push({ png: await png(shown, `w${ci}_${k}.png`), start: pop, end: k < steps ? t1 : at.end })
      }
    }
    return out
  }
  if (a.style === 'karaoke') {
    // The whole caption shows; each word lights up in turn, timed by its
    // length (or by the voice line's own word times when there are some).
    const out: TimelineCaption[] = []
    for (const [ci, text] of texts.entries()) {
      const at = moved[ci]
      if (!text || !at) continue
      const words = captionWords(text, { canvas: cfg.canvas, caption: cfg.caption })
      const end = at.end ?? a.durationSec
      const timed = cut.captions[ci]?.words
      const times = timed?.length === words.length
        ? timed.map(w => (voiced ? w.start : mapTime(a.timeMap, w.start)))
        : wordStarts(words, at.start, end)
      for (const [k, t0] of times.entries()) {
        const t1 = k < times.length - 1 ? times[k + 1]! : end
        if (t1 - t0 < 0.02) continue
        out.push({ png: await png(text, `k${ci}_${k}.png`, {}, { highlight: k, pill: (params.pill ?? 1) >= 1, pop: params.pop ?? 1 }), start: t0, end: k < times.length - 1 ? t1 : at.end })
      }
    }
    return out
  }
  if (a.style === 'text_behind') {
    // Big, plain words in the upper third; they go behind her later.
    const out: TimelineCaption[] = []
    for (const [ci, text] of texts.entries()) {
      const at = moved[ci]
      if (!text || !at) continue
      out.push({ png: await png(text.toUpperCase(), `tb${ci}.png`, { style: 'plain', size: cfg.caption.size * (params.size ?? 2.2), position: 'upper_third', max_width: cfg.canvas.width - 2 * cfg.caption.safe.left, max_lines: 4 }), start: at.start, end: at.end })
    }
    return out
  }
  if (a.style === 'freeze_pop' || a.style === 'record_scratch') {
    // The pop text springs in during the frozen frame: small, overshoot,
    // settle, then holds. The other captions step aside meanwhile.
    const text = (a.edit.text || (a.style === 'record_scratch' ? def.text ?? '' : texts.find(Boolean) ?? '')).trim()
    if (!text) return moved
    const start = a.payoff
    // The freeze is the jump in the edit's time map at the payoff.
    const held = Math.max(0.3, mapTime(a.timeMap, a.payoff + 0.0001) - a.payoff)
    const end = Math.min(a.durationSec, start + held)
    const scales = a.style === 'record_scratch' ? [0.92, 1.03, 1] : [0.6, 0.85, 1.12, 1.04, 1]
    const big = a.style === 'record_scratch' ? 1 : 1.25
    const out = aside(moved, start, end)
    for (const [i, k] of scales.entries()) {
      const t0 = start + i / fps, t1 = i < scales.length - 1 ? start + (i + 1) / fps : end
      out.push({ png: await png(text, `pop${i}.png`, { size: cfg.caption.size * big * k, position: 'upper_third' }), start: t0, end: t1 })
    }
    return out
  }
  return moved
}

// Captions with a window cut out of them (they step aside for a pop).
function aside(list: TimelineCaption[], from: number, to: number): TimelineCaption[] {
  const out: TimelineCaption[] = []
  for (const c of list) {
    const end = c.end ?? Number.POSITIVE_INFINITY
    if (c.start < from) out.push({ ...c, end: Math.min(end, from) === Number.POSITIVE_INFINITY ? null : Math.min(end, from) })
    if (end > to) out.push({ ...c, start: Math.max(c.start, to) })
  }
  return out
}

// When each word starts, spread over the caption's time by word length.
export function wordStarts(words: string[], start: number, end: number): number[] {
  const weight = words.map(w => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1)
  const total = weight.reduce((x, y) => x + y, 0) || 1
  const span = Math.max(0.1, end - start)
  const out: number[] = []
  let t = start
  for (const w of weight) { out.push(Math.round(t * 1000) / 1000); t += (span * w) / total }
  return out
}

// How a voiceover's words break into captions (config, content.yaml).
export function voicePhrases(deps: Deps) {
  const p = deps.config.pipeline.content.sound.voice.phrases
  return { maxWords: p.max_words, maxSec: p.max_sec, pauseSec: p.pause_sec, holdSec: p.hold_sec, maxPhrases: deps.config.pipeline.content.cut.max_captions }
}

// The sound bed under a finished picture (SPEC 5.5).
async function layBed(deps: Deps, ctx: Ctx, picture: string, out: string, dir: string, s: SoundSpec, accents: Array<{ path: string; at: number; db?: number }> = [], preset?: ExportPreset): Promise<SoundBedResult> {
  const sound = deps.config.pipeline.content.sound
  // The export preset's loudness and true peak for the finished mix.
  const cfg = preset ? { ...sound, target_lufs: preset.lufs, true_peak: preset.true_peak } : sound
  const ambienceId = s.ambience ?? cfg.default_ambience
  const ambience = ambienceId === 'none' ? null : ambienceId === 'room' ? { builtin: 'room' as const } : { path: await soundFile(deps, ctx, ambienceId, dir, 'ambience.m4a') }
  const music = s.music ? { path: await soundFile(deps, ctx, s.music, dir, 'music.m4a') } : null
  // The voiceover is the foreground: the music and ambience dip under it.
  const voice = s.voice ? { path: await voiceFile(deps, ctx, s.voice.id, dir), at: s.voice.at } : null
  return applySoundBed({
    video: picture, out, workDir: dir, clipSound: s.clipSound, ambience, ambienceDb: cfg.levels[s.ambienceLevel], music, musicDb: cfg.levels[s.musicLevel], duck: s.duck, accents,
    voice, voiceDb: s.voice ? cfg.levels[s.voice.level] : 0,
    levels: { target: cfg.target_lufs, truePeak: cfg.true_peak, ambienceAlone: cfg.ambience_only_lufs, ambience: cfg.ambience_lufs, music: cfg.music_lufs, voice: cfg.voice.lufs, duck: { threshold: cfg.duck.threshold, ratio: cfg.duck.ratio, attackMs: cfg.duck.attack_ms, releaseMs: cfg.duck.release_ms } },
  })
}

async function runContentRender(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const row = await getContent(deps, ctx, job.purpose.split(':')[1]!)
  if (row.kind === 'batch') return renderBatchVideo(deps, ctx, job, row, slug(row.title || row.kind))
  const outputs = await exportPostNow(deps, ctx, job, row)
  return row.kind === 'meme' ? outputs : { images: outputs.imageAssetIds?.length ?? 0 }
}

// One video post or slideshow exported now, inside a worker job: the
// Export button's own job, or a Download day zip exporting an approved post
// that had no export yet (UX-PLAN.md section 33). Free.
export async function exportPostNow(deps: Deps, ctx: Ctx, job: JobRow, row: ContentRow): Promise<ContentOutputs> {
  const itemId = row.id
  const name = slug(row.title || row.kind)
  if (row.kind !== 'meme' && row.kind !== 'slideshow') throw new AppError('bad_request', 'Only a video post or a slideshow exports on its own.')
  if (row.status !== 'rendering') await deps.db.update(contentItems).set({ status: 'rendering', error: null }).where(eq(contentItems.id, itemId))
  try {
    if (row.kind === 'meme') {
      const parsed = memeSpec.parse(row.spec)
      // The voiceover's words as the line has them now (it may have been
      // converted again since it was picked).
      const vo = parsed.sound.voice
      const s = vo ? { ...parsed, sound: { ...parsed.sound, voice: { ...vo, words: (await voiceForPost(deps, ctx, vo.id, row.characterId)).words } } } : parsed
      const cut = effectiveCut(s, deps.config.pipeline.content.meme.max_broll_seconds, voicePhrases(deps))
      const preset = presetFor(deps.config.pipeline.content.export_presets, s.exportPreset)
      // The post's timeline (editor phase D): the saved one, a carried
      // stack, or the Format's preset, else the cut as before.
      const { v, notes, timeline } = await withTempDir(async dir => {
        const tl = await workerTimeline(deps, ctx, { characterId: row.characterId!, cut, sound: s.sound, edit: s.edit, editor: s.editor ? { projectAssetId: s.editor.projectAssetId, stack: s.editor.stack } : null, captionOff: s.captionOff, dir })
        const v = await renderCut(deps, ctx, job, tl.cut, { characterId: row.characterId!, caption: s.caption, sound: tl.sound, edit: s.edit, captionStyle: s.captionStyle, label: `Video post: ${s.caption.slice(0, 60)}`, plan: tl.plan, preset })
        return { v, notes: tl.notes, timeline: !!tl.plan }
      })
      const json = await videoPostJson(deps, ctx, row, { file: `${name}.mp4`, assetId: v.assetId, durationSec: v.durationSec ?? null })
      const jsonAsset = await saveAsset(deps, ctx, { data: Buffer.from(`${JSON.stringify(json, null, 2)}\n`), mime: 'application/json', origin: 'derived', label: `Video post ${name} (post.json)`, sourceJobId: job.id })
      const outputs: ContentOutputs = { videoAssetId: v.assetId, jsonAssetId: jsonAsset.id, dropped: v.dropped, faceBoxes: (v.faceBoxes ?? []).slice(0, 400), durationSec: v.durationSec, sound: v.sound, editNote: v.editNote, renderedAt: deps.clock.now().toISOString(), preset: preset.id, ...(v.capped ? { capped: true } : {}), ...(timeline ? { fromTimeline: true } : {}), ...(notes.length ? { editorOnly: notes } : {}) }
      await setOutputs(deps, itemId, outputs, 'ready')
      return outputs
    }
    // Slideshow (UX-PLAN.md section 27): each slide's picture or special
    // slide, its words in the post's text style, both sizes, caption.txt
    // and post.json in one zip.
    const outputs = await renderSlideshow(deps, ctx, job, row, name)
    await setOutputs(deps, itemId, outputs, 'ready')
    return outputs
  } catch (e) {
    await deps.db.update(contentItems).set({ status: 'failed', error: (e as Error).message.slice(0, 400), updatedAt: deps.clock.now() }).where(eq(contentItems.id, itemId))
    throw e
  }
}

// A video post's post.json (section 28): the caption to post, its hashtags
// and CTA line, the plan's fields and the results, next to the MP4. Also
// made by Download day for a video exported from the editor (which writes
// none).
export async function videoPostJson(deps: Deps, ctx: Ctx, row: ContentRow, video: { file: string; assetId: string; durationSec: number | null }): Promise<Record<string, unknown>> {
  const s = memeSpec.parse(row.spec)
  const ch = row.characterId ? toData(await getCharacter(deps, ctx, row.characterId)) : null
  const plan = s.plan
  const max = deps.config.pipeline.content.slideshow.hashtags[1]
  // A faceless post's own caption and hashtags when it has no plan row's.
  const f = (s.faceless ?? {}) as { postCaption?: string; hashtags?: string[]; musicName?: string; voiceover?: { search?: string } | null }
  if (!plan.caption && f.postCaption) plan.caption = f.postCaption
  if (!plan.hashtags.length && f.hashtags?.length) plan.hashtags = f.hashtags
  return videoPostExportJson({
    // A plan row's sound_name and sound_type when the post has no faceless sound (section 42 D).
    sound: soundToAdd(f) ?? (plan.soundName ? { music: plan.soundName, voiceover: '', type: plan.soundType || '' } : null),
    post: { id: row.id, kind: row.kind, title: row.title, idea: row.idea, accountTag: row.accountTag, characterId: row.characterId, characterName: ch?.name ?? null, variationOf: row.variationOf, batchOf: row.batchOf, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() },
    video: { file: video.file, assetId: video.assetId, durationSec: video.durationSec, onScreenText: s.caption, captionOff: s.captionOff },
    caption: { text: plan.caption, hashtags: plan.hashtags.slice(0, max), ctaLine: plan.cta, ad: plan.product, asPosted: postCaption(plan.caption, plan.hashtags, { ad: plan.product, max, cta: plan.cta }) },
    plan, aiLabel: ch?.disclosure ?? 'Label all posts as AI-generated', exportedAt: deps.clock.now().toISOString(), results: s.results,
  })
}

// Hook variants (long run part 4): the post's timeline rendered once per
// hook, each hook over the first seconds in place of a caption there.
// Free, on the worker; the post's own export is left as it is.
export async function startVariants(deps: Deps, ctx: Ctx, itemId: string): Promise<{ jobId: string }> {
  const row = await getContent(deps, ctx, itemId)
  if (row.kind !== 'meme') throw new AppError('bad_request', 'Hook variants are for video posts.')
  const s = memeSpec.parse(row.spec)
  // Each version: a hook line, a first shot, a first edit, or any of them.
  const camera = new Set((deps.config.pipeline.presets.presets as PresetInfo[]).filter(p => p.kind === 'camera').map(p => p.id))
  const variants = Array.from({ length: deps.config.pipeline.content.hook_variants.max }, (_, i) => ({
    letter: String.fromCharCode(65 + i), hook: (s.hookVariants[i] ?? '').trim(),
    shot: s.hookShots[i] || null, edit: s.hookEdits[i] && camera.has(s.hookEdits[i]!) ? s.hookEdits[i]! : null,
  })).filter(v => v.hook || v.shot || v.edit)
  if (!variants.length) throw new AppError('bad_request', 'Write a hook, or pick a first shot or a first edit, first.')
  for (const v of variants) {
    if (!v.shot) continue
    const a = await getAsset(deps, ctx, v.shot)
    if (!a.mime.startsWith('video/') && !a.mime.startsWith('image/')) throw new AppError('bad_request', `Version ${v.letter}: the first shot must be a video or a still.`)
  }
  const problems = renderProblems(deps, row)
  if (problems.length) throw new AppError('bad_request', `${problems.join('; ')}.`)
  const outputs = (row.outputs ?? {}) as ContentOutputs
  if (outputs.variantsRunning) throw new AppError('bad_request', 'The hook variants are already being made.')
  await setOutputs(deps, row.id, { ...outputs, variants: [], variantsRunning: true, variantsError: null })
  const job = await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `content_variants:${row.id}`, label: `Export ${variants.length} hook variant${variants.length === 1 ? '' : 's'}`, characterId: row.characterId, request: { variants } })
  return { jobId: job.id }
}

async function runContentVariants(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const itemId = job.purpose.split(':')[1]!
  // Older jobs carry hook lines only.
  const req = job.request as { variants?: Array<{ letter: string; hook: string; shot: string | null; edit: string | null }>; hooks?: string[] }
  const list = req.variants ?? (req.hooks ?? []).map((hook, i) => ({ letter: String.fromCharCode(65 + i), hook, shot: null, edit: null }))
  const merge = async (patch: Partial<ContentOutputs>) => {
    const fresh = await getContent(deps, ctx, itemId)
    await setOutputs(deps, itemId, { ...((fresh.outputs ?? {}) as ContentOutputs), ...patch })
  }
  try {
    const row = await getContent(deps, ctx, itemId)
    const parsed = memeSpec.parse(row.spec)
    const vo = parsed.sound.voice
    const s = vo ? { ...parsed, sound: { ...parsed.sound, voice: { ...vo, words: (await voiceForPost(deps, ctx, vo.id, row.characterId)).words } } } : parsed
    const cut = effectiveCut(s, deps.config.pipeline.content.meme.max_broll_seconds, voicePhrases(deps))
    const preset = presetFor(deps.config.pipeline.content.export_presets, s.exportPreset)
    const variants: NonNullable<ContentOutputs['variants']> = []
    for (const it of list) {
      const v = await withTempDir(async dir => {
        const tl = await workerTimeline(deps, ctx, { characterId: row.characterId!, cut, sound: s.sound, edit: s.edit, editor: s.editor ? { projectAssetId: s.editor.projectAssetId, stack: s.editor.stack } : null, captionOff: s.captionOff, dir })
        return renderCut(deps, ctx, job, tl.cut, { characterId: row.characterId!, caption: s.caption, sound: tl.sound, edit: s.edit, captionStyle: s.captionStyle, label: `Hook ${it.letter}: ${(it.hook || 'first shot or edit').slice(0, 60)}`, plan: tl.plan, preset, hook: it.hook, head: it.shot, firstEdit: it.edit })
      })
      variants.push({ hook: it.hook, shot: it.shot, edit: it.edit, letter: it.letter, assetId: v.assetId, durationSec: v.durationSec })
      await merge({ variants: [...variants] })
    }
    await merge({ variants, variantsRunning: false, variantsError: null })
    return { variants: variants.length }
  } catch (e) {
    await merge({ variantsRunning: false, variantsError: (e as Error).message.slice(0, 400) })
    throw e
  }
}

// The cover (long run part 4): a frame of the exported video with the
// cover text in the caption look, as a JPEG. Free, on the worker.
export async function startCover(deps: Deps, ctx: Ctx, itemId: string, input: { at: number; text: string }): Promise<{ jobId: string }> {
  const row = await getContent(deps, ctx, itemId)
  if (row.kind !== 'meme') throw new AppError('bad_request', 'A cover is for video posts.')
  const outputs = (row.outputs ?? {}) as ContentOutputs
  if (!outputs.videoAssetId) throw new AppError('bad_request', 'Export the video first; the cover is a frame of it.')
  const at = Math.max(0, Math.min(input.at, Math.max(0, (outputs.durationSec ?? 600) - 0.05)))
  const text = input.text.trim().slice(0, 200)
  await updateContent(deps, ctx, row.id, { spec: { cover: { at, text } } })
  await setOutputs(deps, row.id, { ...((await getContent(deps, ctx, row.id)).outputs as ContentOutputs ?? {}), coverRunning: true })
  const job = await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `content_cover:${row.id}`, label: 'Make the cover', characterId: row.characterId, request: { at, text, videoAssetId: outputs.videoAssetId } })
  return { jobId: job.id }
}

async function runContentCover(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const itemId = job.purpose.split(':')[1]!
  const { at, text, videoAssetId } = job.request as { at: number; text: string; videoAssetId: string }
  const cfg = deps.config.pipeline.content
  try {
    const jpg = await withTempDir(async dir => {
      const video = join(dir, 'video.mp4'), frame = join(dir, 'frame.png')
      await writeFile(video, (await readAsset(deps, ctx, videoAssetId)).data)
      await extractFrameAt(video, at, frame)
      const base = sharp(frame).resize(cfg.canvas.width, cfg.canvas.height, { fit: 'cover', position: 'centre' })
      const layers = text ? [{ input: (await captionPng(text, { ...cfg, caption: { ...cfg.caption, position: 'middle' } })).png, top: 0, left: 0 }] : []
      return base.composite(layers).jpeg({ quality: cfg.cover.quality, mozjpeg: true }).toBuffer()
    })
    const asset = await saveAsset(deps, ctx, { data: jpg, mime: 'image/jpeg', origin: 'derived', label: text ? `Cover: ${text.slice(0, 60)}` : 'Cover', sourceJobId: job.id })
    const fresh = await getContent(deps, ctx, itemId)
    await setOutputs(deps, itemId, { ...((fresh.outputs ?? {}) as ContentOutputs), cover: { assetId: asset.id, at, text }, coverRunning: false })
    return { assetId: asset.id }
  } catch (e) {
    const fresh = await getContent(deps, ctx, itemId)
    await setOutputs(deps, itemId, { ...((fresh.outputs ?? {}) as ContentOutputs), coverRunning: false })
    throw e
  }
}

// One video of a batch (Phase 4: batch at scale). Each video is its own
// short job and owns one slot of the outputs, so a job that runs again
// after a crash or during a deploy overwrites its own slot instead of being
// counted twice. Results are merged under a row lock, so two workers never
// lose each other's results. When every slot is settled, the zip is built
// (in parts, so a big batch never needs all its videos in memory at once).
type BatchVideo = { caption: string; assetId: string; clipId?: string; brollId?: string | null }

async function renderBatchVideo(deps: Deps, ctx: Ctx, job: JobRow, row: ContentRow, name: string): Promise<unknown> {
  // A batch has no voiceover: one line would not match every caption.
  const parsed = batchSpec.parse(row.spec)
  const s = { ...parsed, sound: { ...parsed.sound, voice: null } }
  const captions = batchCaptions(deps, s)
  const index = (job.request as { index?: number }).index ?? 0
  const caption = captions[index]
  let result: BatchVideo | null = null
  let error: string | null = null
  if (caption === undefined) error = `Video ${index + 1} is not in this batch any more.`
  else {
    try {
      const src = batchSources(s, index)
      const cut = effectiveCut({ ...s, ...src }, deps.config.pipeline.content.meme.max_broll_seconds)
      // The batch's style (a saved style from the editor), placed at this
      // video's own payoff, cuts and beats; else its Format as before.
      const v = await withTempDir(async dir => {
        const tl = s.stack?.length
          ? { cut, sound: s.sound, ...(await stackPlan(deps, ctx, { characterId: row.characterId!, cut, stack: s.stack, edit: s.edit, sound: s.sound, dir })) }
          : await workerTimeline(deps, ctx, { characterId: row.characterId!, cut, sound: s.sound, edit: s.edit, editor: null, captionOff: s.captionOff, dir })
        return renderCut(deps, ctx, job, tl.cut, { characterId: row.characterId!, caption: s.captionOff ? '' : caption, sound: tl.sound, edit: s.edit, captionStyle: s.captionStyle, label: `Batch ${name} ${index + 1}${caption ? `: ${caption.slice(0, 50)}` : ''}`, plan: tl.plan, preset: presetFor(deps.config.pipeline.content.export_presets, parsed.exportPreset) })
      })
      result = { caption, assetId: v.assetId, clipId: src.clipId!, brollId: src.brollId }
    } catch (e) {
      error = `Video ${index + 1} failed: ${(e as Error).message.slice(0, 300)}`
    }
  }
  const settled = await deps.db.transaction(async tx => {
    const [now] = await tx.select().from(contentItems).where(eq(contentItems.id, row.id)).for('update')
    const prev = (now?.outputs ?? {}) as ContentOutputs
    const videos = [...(prev.videos ?? [])]
    const errors = { ...(prev.errors ?? {}) }
    if (result) { videos[index] = result; delete errors[String(index)] } else { videos[index] = videos[index] ?? null; errors[String(index)] = error! }
    const total = prev.total ?? captions.length
    const done = videos.filter(Boolean).length
    const failed = Object.keys(errors).filter(k => !videos[Number(k)]).length
    const outputs: ContentOutputs = { ...prev, videos, errors, done, failed, total }
    const complete = done + failed >= total
    await tx.update(contentItems).set({ outputs, updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id))
    return { outputs, complete }
  })
  if (settled.complete) await finishBatch(deps, ctx, job, row.id, name, settled.outputs)
  if (error) throw new Error(error)
  return result
}

// The batch's download: its videos and captions.txt, in zip parts of at
// most batch.zip_part_mb (stored, not compressed: MP4 is already).
async function finishBatch(deps: Deps, ctx: Ctx, job: JobRow, itemId: string, name: string, outputs: ContentOutputs): Promise<void> {
  const cfg = deps.config.pipeline.content.batch
  const videos = outputs.videos ?? []
  const kept = videos.map((v, i) => ({ v, i })).filter((x): x is { v: BatchVideo; i: number } => !!x.v)
  const captionsTxt = Buffer.from(kept.map(({ v, i }) => `${String(i + 1).padStart(2, '0')}. ${v.caption}`).join('\n') + '\n')
  const cap = cfg.zip_part_mb * 1024 * 1024
  const parts: NonNullable<ContentOutputs['zipParts']> = []
  let files: Record<string, Uint8Array> = {}
  let size = 0, from = -1, to = -1
  const flush = async () => {
    if (!Object.keys(files).length) return
    files['captions.txt'] = captionsTxt
    const n = parts.length + 1
    const zip = await saveAsset(deps, ctx, { data: Buffer.from(zipSync(files, { level: 0 })), mime: 'application/zip', origin: 'derived', label: `Batch ${name} (zip${n > 1 ? ` part ${n}` : ''})`, sourceJobId: job.id })
    parts.push({ assetId: zip.id, from: from + 1, to: to + 1 })
    files = {}; size = 0; from = -1
  }
  for (const { v, i } of kept) {
    const data = (await readAsset(deps, ctx, v.assetId)).data
    if (size && size + data.length > cap) await flush()
    if (from < 0) from = i
    to = i
    files[`${name}-${String(i + 1).padStart(2, '0')}.mp4`] = data
    size += data.length
  }
  await flush()
  const failed = outputs.failed ?? 0
  const final: ContentOutputs = { ...outputs, zipParts: parts, renderedAt: deps.clock.now().toISOString() }
  if (parts[0]) final.zipAssetId = parts[0].assetId
  else delete final.zipAssetId
  await deps.db.update(contentItems).set({
    outputs: final, status: failed ? 'failed' : 'ready', error: failed ? `${failed} of ${outputs.total ?? videos.length} videos failed; the rest are ready. Retry the failed ones.` : null, updatedAt: deps.clock.now(),
  }).where(eq(contentItems.id, itemId))
}

// "Retry the failed ones": only the videos that failed render again (free).
export async function retryFailedBatch(deps: Deps, ctx: Ctx, itemId: string): Promise<ContentRow> {
  const row = await getContent(deps, ctx, itemId)
  if (row.kind !== 'batch') throw new AppError('bad_request', 'Retry the failed ones works on a batch.')
  if (row.status === 'rendering') throw new AppError('bad_request', 'This batch is still rendering.')
  const prev = row.outputs as ContentOutputs
  const failed = Object.keys(prev.errors ?? {}).map(Number).filter(i => !(prev.videos ?? [])[i]).sort((a, b) => a - b)
  if (!failed.length) throw new AppError('bad_request', 'No video in this batch failed.')
  const errors = { ...(prev.errors ?? {}) }
  for (const i of failed) delete errors[String(i)]
  const [out] = await deps.db.update(contentItems).set({ status: 'rendering', error: null, outputs: { ...prev, errors, failed: 0 }, updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id)).returning()
  for (const i of failed) await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `content_render:${row.id}`, label: `Render batch video ${i + 1} again`, characterId: row.characterId, request: { index: i } })
  return out!
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

// What a post is about: the idea from its Idea step, else the topic an
// older draft kept in its spec.
export const postTopic = (item: Pick<ContentRow, 'idea'>, specTopic: string): string => item.idea.trim() || specTopic.trim()

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
  const topic = postTopic(item, s.topic)
  if (topic.length < 3) throw new AppError('invalid_request', 'Say what the slideshow is about first.')
  const ch = toData(row)
  const cfg = deps.config.pipeline.content
  const t = deps.config.pipeline.templates.content_slides
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const n = slideCount(deps, s.stillIds.length)
  const vars = { ...pronounVars(ch.pronouns), name: ch.name, slides: String(n), hashtags_min: String(cfg.slideshow.hashtags[0]), hashtags_max: String(cfg.slideshow.hashtags[1]) }
  const system = fill(t.system, vars)
  const prompt = fill(t.prompt, { ...vars, topic, vibe: ch.persona.vibe ?? 'not given', voice: voiceCardText(ch.name, cleanVoiceCard(ch.persona.voice)), photos: await photoNotes(deps, ctx, s.stillIds) })
  const purpose = `content_slides:${item.id}`
  const mock = { hook: `${topic.slice(0, 60)}`, slides: Array.from({ length: n }, (_, i) => `Slide ${i + 2}: ${topic.slice(0, 40)}`), caption: topic, hashtags: ['fyp', 'dayinmylife', 'relatable'].slice(0, Math.max(cfg.slideshow.hashtags[0], 1)) }
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
  const topic = postTopic(item, s.topic)
  if (topic.length < 3) throw new AppError('invalid_request', 'Say what the captions are about first.')
  const count = Math.min(s.count, deps.config.pipeline.content.batch.max)
  const ch = toData(row)
  const t = deps.config.pipeline.templates.content_captions
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const vars = { ...pronounVars(ch.pronouns), name: ch.name, count: String(count) }
  const system = fill(t.system, vars)
  const prompt = fill(t.prompt, { ...vars, topic, vibe: ch.persona.vibe ?? 'not given', voice: voiceCardText(ch.name, cleanVoiceCard(ch.persona.voice)) })
  const purpose = `content_captions:${item.id}`
  const mock = { captions: Array.from({ length: count }, (_, i) => `POV: ${topic.slice(0, 60)} (${i + 1})`) }
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

const itemView = (i: ContentRow) => ({
  id: i.id, kind: i.kind as ContentKind, characterId: i.characterId, title: i.title, idea: i.idea, sceneId: i.sceneId, accountTag: i.accountTag, productId: i.productId, step: i.step,
  variationOf: i.variationOf, batchOf: i.batchOf,
  spec: i.kind === 'batch' ? batchSpec.parse(i.spec) : i.spec, status: i.status, outputs: i.outputs as ContentOutputs, error: i.error, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
})

// One post in the list's shape: a post page opens even when the post is
// older than the newest 200 the list holds.
export async function contentItemView(deps: Deps, ctx: Ctx, itemId: string) {
  return { item: itemView(await getContent(deps, ctx, itemId)) }
}

export async function contentView(deps: Deps, ctx: Ctx) {
  const [broll, items, lint, tagRows, charRows, productRows] = await Promise.all([
    listBroll(deps, ctx), listContent(deps, ctx), lintSettings(deps, ctx),
    // Every account tag and character in use, not only the newest 200 posts'.
    deps.db.select({ tag: contentItems.accountTag, at: sql<string>`max(${contentItems.updatedAt})` }).from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt))).groupBy(contentItems.accountTag).orderBy(desc(sql`max(${contentItems.updatedAt})`)),
    deps.db.selectDistinct({ id: contentItems.characterId }).from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt))),
    deps.db.select({ id: products.id, name: products.name, writing: products.writing }).from(products).where(and(eq(products.accountId, ctx.accountId), isNull(products.archivedAt))).orderBy(products.createdAt),
  ])
  const assetIds = broll.map(b => b.assetId).filter((x): x is string => !!x)
  const durations = new Map<string, number | null>()
  for (const a of assetIds) durations.set(a, (await getAsset(deps, ctx, a).catch(() => null))?.durationMs ?? null)
  const cfg = deps.config.pipeline.content
  return {
    // A clip made before products were picked keeps its old label.
    broll: broll.map(b => ({ id: b.id, title: b.title, productId: b.productId, product: productRows.find(p => p.id === b.productId)?.name ?? b.product, status: b.status, error: b.error, assetId: b.assetId, durationSec: b.assetId && durations.get(b.assetId) ? Math.round(durations.get(b.assetId)! / 100) / 10 : null, createdAt: b.createdAt.toISOString() })),
    // The account's products (section 29) and their writing rules: what the
    // post's product brings (the language notes only with lint on).
    products: productRows.map(p => { const std = standardOf(deps, p.writing); return { id: p.id, name: p.name, writing: std?.key ?? '', writingLabel: std?.label ?? GENERAL_LABEL, lint: !!std?.lint, review: !!std?.review } }),
    items: items.map(itemView),
    // Where Posts home's "Show older posts" starts (null: none older).
    next: items.length === LIST_SIZE ? items[LIST_SIZE - 1]!.id : null,
    // Account tags in use, most recent first (the Idea step suggests them),
    // and the characters with posts: from every post.
    accountTags: tagRows.map(r => r.tag).filter(Boolean),
    characterIds: charRows.map(r => r.id).filter((x): x is string => !!x),
    options: {
      caption: { size: cfg.caption.size, safe: cfg.caption.safe, position: cfg.caption.position, maxChars: cfg.caption.max_chars, box: cfg.caption.box, style: cfg.caption.style, outline: cfg.caption.outline, karaoke: cfg.caption.karaoke },
      canvas: cfg.canvas, meme: cfg.meme, batch: cfg.batch,
      slideshow: {
        slides: cfg.slideshow.slides, maxStills: cfg.slideshow.max_stills, draftSlides: cfg.slideshow.draft_slides, hashtagsMax: cfg.slideshow.hashtags[1],
        maxVariations: cfg.slideshow.max_variations, batchMax: cfg.slideshow.batch_max, hooks: cfg.slideshow.hooks, instagram: cfg.slideshow.instagram,
        brandNames: cfg.slideshow.brand_names, genericNames: cfg.slideshow.generic_names,
        framingMix: cfg.slideshow.framing_mix.map(m => ({ id: m.id, label: m.label })),
      },
      // The language lint (section 28): word lists and switched-off checks.
      lint,
      maxUploadMb: cfg.broll.max_upload_mb,
      cut: cfg.cut,
      sound: { defaultAmbience: cfg.sound.default_ambience, targetLufs: cfg.sound.target_lufs, maxUploadMb: cfg.sound.max_upload_mb },
      chain: { maxParts: cfg.chain.max_parts },
      // Export for (long run part 4) and hook variants.
      exportPresets: cfg.export_presets, hookVariants: cfg.hook_variants,
      // The camera presets a version can open with (its first edit).
      hookEdits: (deps.config.pipeline.presets.presets as PresetInfo[]).filter(p => p.kind === 'camera' && p.keys?.length).map(p => ({ id: p.id, label: p.label })),
      edits: { styles: deps.config.pipeline.edits.styles.map(e => ({ id: e.id, label: e.label, line: e.line, shots: e.shots, anchor: e.anchor, slots: e.slots ?? null, params: e.params, stage: e.stage, needs: e.needs, variants: e.variants ?? null, text: e.text ?? null })), payoffFromEnd: deps.config.pipeline.edits.payoff_from_end },
    },
  }
}

let registered = false
export function registerContent(): void {
  if (registered) return
  registered = true
  registerLocalJob('broll_ingest', runBrollIngest)
  registerLocalJob('content_render', runContentRender)
  registerLocalJob('content_variants', runContentVariants)
  registerLocalJob('content_cover', runContentCover)
  registerJobHook('content_slides', onContentSlides)
  registerJobHook('content_captions', onContentCaptions)
}
