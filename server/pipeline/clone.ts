import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, inArray, like } from 'drizzle-orm'
import { candidates, characters, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, registerLocalJob, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob, quoteItemsFor, type JobSpec } from '../jobs/runner.js'
import { displayPrice } from '../costs/quotes.js'
import { isVideoOp } from '../core/clips.js'
import { fill, hardWrap } from '../core/text.js'
import { buildEditPrompt } from '../core/scenes.js'
import { pickPerson, targetWords, type Point } from '../core/cloneTarget.js'
import type { RealismWarning } from '../core/realism.js'
import { lintPrompt, type RuleViolation } from '../core/rules.js'
import { assembleVideoPrompt } from '../core/promptWriter.js'
import { finalize, type QaReport } from '../core/qa/marks.js'
import { transcodeSource } from '../media/meme.js'
import { cleanClip, detectEndCard, detectOverlays } from '../media/cleanup.js'
import { muxSound } from '../media/edit.js'
import { ffmpeg, probeFile, withTempDir } from '../media/ffmpeg.js'
import { compareTexture } from '../qa/texture.js'
import type { GenRequest } from '../providers/types.js'
import { readBilling } from '../providers/billing.js'
import { listCredentials } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { effectiveModel, MODEL_OVERRIDES_KEY, readModelOverrides } from '../providers/modelOverrides.js'
import { getAsset, readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import { approvedAssets, getCandidate, getCharacter, toData } from './characters.js'
import { pronounVars } from '../core/prompts.js'
import { createContent, getContent, specSchemas, updateContent, type CloneSource, type ContentKind } from './content.js'
import { lintOrThrow, runModel, type SceneBuilt } from './sceneActions.js'
import { freeChecksOnly } from './sceneHooks.js'
import { clipFrames } from './videoAssets.js'
import { scorePerformer, scoreSceneIdentity } from './identity.js'
import { ruleSwitches } from './rules.js'
import { getSetting, resolveRoute, setSetting } from './settings.js'

// Clone Video (SPEC 13.1 R1; UX-PLAN.md: "Clone a TikTok or Reel" in a
// post's Video step). The owner brings a saved TikTok or Reel; the worker
// keeps a lean copy with its sound. One run rebuilds it for one or more
// characters (one quote, a line each) with the same motion and camera. The
// provider never keeps the source's sound: "Keep original sound" (off by
// default) puts it back on the worker, free and the same for every model.
// Each result is checked for free (the face against REF-00, the skin, and
// that it is not the person in the source clip), kept in Library > Clips,
// and picked in the post with "Use this clip".
//
// Two modes (owner, 2026-10-14, G28). "Replace the person (keep the scene)",
// the default, swaps only the person picked on the first frame (the largest
// unless the owner taps another) and keeps the clip's place, light, crowd
// and outfit; it gets REF-00 and one three-quarter view, nothing else from
// the sheet. "Copy the moves into a new scene" first makes a scene still
// (the first frame edited to put the character in place of that person,
// shown before the run), then copies the moves onto that still. A bare
// sheet image is never the image a motion model gets: a rave clip run that
// way came back in a gray studio, in the sheet's tee and jeans, with a
// background dancer turned into a second copy of the character.

export type CloneMode = 'replace' | 'motion'
const CLONE_MODEL_KEY: Record<CloneMode, string> = { replace: 'clone_model_replace', motion: 'clone_model_motion' }

const warn = (ruleId: string, title: string, message: string): RuleViolation => ({ ruleId, spec: '13.1', title, severity: 'warning', message })

function modelEntry(deps: Deps, ref: string) {
  const m = deps.config.models.models.find(x => x.ref === ref)
  if (!m?.clone) throw new AppError('bad_request', `${ref} does not clone a video. Pick one of the listed models.`)
  return m as typeof m & { clone: NonNullable<typeof m.clone> }
}

function cloneOf(post: { kind: string; spec: unknown }): CloneSource | null {
  if (post.kind !== 'meme' && post.kind !== 'batch') return null
  return (specSchemas[post.kind as ContentKind].parse(post.spec) as { clone: CloneSource | null }).clone
}

// ── The source clip ─────────────────────────────────────────────────

export async function addCloneSource(deps: Deps, ctx: Ctx, input: { contentId: string; uploadId: string; name: string }): Promise<{ ok: true }> {
  const post = await getContent(deps, ctx, input.contentId)
  if (post.kind !== 'meme' && post.kind !== 'batch') throw new AppError('bad_request', 'Clone a video in a video post or a batch.')
  if (!/^upl_[a-z0-9]{20}$/.test(input.uploadId)) throw new AppError('bad_request', 'That upload id is not valid.')
  if (!(await deps.store.exists(uploadKey(ctx.accountId, input.uploadId)))) throw new AppError('bad_request', `${input.name} did not finish uploading. Try again.`)
  const name = input.name.replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 120) || 'Clip to clone'
  const clone: CloneSource = { status: 'preparing', name, uploadId: input.uploadId, assetId: null, durationSec: null, hasAudio: false, trimmed: false, error: null, firstFrameId: null, people: [], target: null, stills: {}, originalAssetId: null, cleanAssetId: null, cleanup: null, textFrameId: null, sourceCaption: null }
  await updateContent(deps, ctx, post.id, { spec: { clone } })
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `clone_source:${post.id}`, label: `Prepare the clip to clone: ${name}`, characterId: post.characterId, request: { uploadId: input.uploadId, name } })
  return { ok: true }
}

async function runCloneSource(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const postId = job.purpose.split(':')[1]!
  const { uploadId, name } = job.request as { uploadId: string; name: string }
  const cfg = deps.config.pipeline.content.clone
  const key = uploadKey(ctx.accountId, uploadId)
  // Only the upload the post still points at is written back (the owner may
  // have picked another clip meanwhile).
  const write = async (patch: Partial<CloneSource>) => {
    const post = await getContent(deps, ctx, postId)
    const current = cloneOf(post)
    if (current?.uploadId !== uploadId) return
    await updateContent(deps, ctx, postId, { spec: { clone: { ...current, ...patch } } })
  }
  try {
    const made = await withTempDir(async dir => {
      const input = join(dir, 'upload.bin'), out = join(dir, 'source.mp4')
      await writeFile(input, await deps.store.get(key))
      const original = await probeFile(input)
      const { hasAudio } = await transcodeSource(input, out, { maxSeconds: cfg.max_seconds })
      const asset = await saveAsset(deps, ctx, { data: await readFile(out), mime: 'video/mp4', origin: 'upload', label: `Clip to clone: ${name}`, sourceJobId: job.id })
      // The cleanup (overnight item 3): TikTok's end card off, burned-in
      // text filled in, so the clone does not copy them. The clip as
      // uploaded is kept for "Undo the cleanup".
      let clean: { asset: Awaited<ReturnType<typeof saveAsset>>; endCardSec: number | null; spots: number } | null = null
      if (cfg.cleanup) {
        const endAt = await detectEndCard(out).catch(() => null)
        const boxes = await detectOverlays(out, { until: endAt }).catch(() => [])
        if (endAt != null || boxes.length) {
          const cleaned = join(dir, 'clean.mp4')
          await cleanClip(out, cleaned, { endAt, boxes })
          const info = await probeFile(out)
          clean = {
            asset: await saveAsset(deps, ctx, { data: await readFile(cleaned), mime: 'video/mp4', origin: 'derived', label: `Clip to clone (cleaned): ${name}`, sourceJobId: job.id }),
            endCardSec: endAt != null ? Math.round(((info.durationSec ?? endAt) - endAt) * 10) / 10 : null,
            spots: boxes.length,
          }
        }
      }
      const frame = await firstFrame(deps, ctx, clean ? join(dir, 'clean.mp4') : out, name, job.id).catch(() => null)
      // A frame with the caption still on, for "Read its caption".
      const textFrame = await textFrameOf(deps, ctx, out, name, job.id).catch(() => null)
      return { asset, clean, hasAudio, trimmed: (original.durationSec ?? 0) > cfg.max_seconds + 0.25, frame, textFrame }
    })
    const used = made.clean?.asset ?? made.asset
    const seconds = Math.round((used.durationMs ?? 0) / 100) / 10
    await deps.store.delete(key).catch(() => undefined)
    if (seconds < cfg.min_seconds) {
      await write({ status: 'failed', error: `This clip is ${seconds} s long. A clone needs at least ${cfg.min_seconds} s of video.` })
      return { seconds }
    }
    await write({
      status: 'ready', assetId: used.id, durationSec: seconds, hasAudio: made.hasAudio, trimmed: made.trimmed, error: null, firstFrameId: made.frame?.assetId ?? null, people: made.frame?.people ?? [], target: null, stills: {},
      originalAssetId: made.asset.id, cleanAssetId: made.clean?.asset.id ?? null, textFrameId: made.textFrame, sourceCaption: null,
      cleanup: made.clean ? { endCardSec: made.clean.endCardSec, spots: made.clean.spots, on: true } : null,
    })
    return { assetId: used.id, seconds, cleanup: made.clean ? { endCardSec: made.clean.endCardSec, spots: made.clean.spots } : null }
  } catch (e) {
    await write({ status: 'failed', error: `This file could not be read as a video (${(e as Error).message.slice(0, 200)}).` })
    throw e
  }
}

async function textFrameOf(deps: Deps, ctx: Ctx, video: string, name: string, jobId: string): Promise<string> {
  return withTempDir(async dir => {
    const info = await probeFile(video)
    const png = join(dir, 'text.png')
    await ffmpeg(['-ss', String(Math.min(1.5, (info.durationSec ?? 2) / 2)), '-i', video, '-frames:v', '1', '-vf', 'scale=720:-2', png], 60_000)
    return (await saveAsset(deps, ctx, { data: await readFile(png), mime: 'image/png', origin: 'derived', label: `Caption frame of ${name}`, sourceJobId: jobId })).id
  })
}

// "Read its caption" (overnight item 3): Claude reads the caption burned
// into the clip; the post's caption takes it (editable). Priced on the button.
export async function buildCloneCaption(deps: Deps, ctx: Ctx, row: { id: string }, contentId: string): Promise<SceneBuilt> {
  const post = await getContent(deps, ctx, contentId)
  const src = cloneOf(post)
  if (post.characterId !== row.id) throw new AppError('bad_request', 'Pick a post of this character.')
  if (!src || src.status !== 'ready' || !src.textFrameId) throw new AppError('bad_request', 'Add the clip to clone first, then read its caption.')
  const t = deps.config.pipeline.templates.clone_caption
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const purpose = `clone_caption:${post.id}`
  return {
    purpose,
    preview: { title: 'Read its caption', prompts: [{ label: 'Caption reader', text: `${t.system}\n${t.prompt}`, wrapped: hardWrap(`${t.system}\n${t.prompt}`) }], warnings: [], invalidates: [] },
    specs: [{ type: 'llm', stage: 'content', purpose, label: 'Read the clip\'s caption', request: { model: route.model, system: t.system, prompt: t.prompt, schema: { type: 'object', properties: { caption: { type: 'string' } }, required: ['caption'], additionalProperties: false }, schemaName: 'clone_caption', maxTokens: 300, effort: 'low', imageAssetIds: [src.textFrameId], meta: { itemId: post.id } } } satisfies JobSpec],
  }
}

async function onCloneCaption(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const text = typeof (out.data as { caption?: unknown } | null)?.caption === 'string' ? ((out.data as { caption: string }).caption).trim().slice(0, 400) : ''
  const post = await getContent(deps, ctx, job.purpose.split(':')[1]!)
  const src = cloneOf(post)
  if (!src) return
  await updateContent(deps, ctx, post.id, { spec: { clone: { ...src, sourceCaption: text }, ...(text && post.kind === 'meme' ? { caption: text } : {}) } })
}

// "Undo the cleanup" (and back): which copy of the clip the clone uses.
export async function setCloneCleanup(deps: Deps, ctx: Ctx, contentId: string, on: boolean): Promise<CloneSource> {
  const post = await getContent(deps, ctx, contentId)
  const src = cloneOf(post)
  if (!src || src.status !== 'ready' || !src.originalAssetId || !src.cleanAssetId || !src.cleanup) throw new AppError('bad_request', 'This clip was not cleaned, so there is nothing to undo.')
  const assetId = on ? src.cleanAssetId : src.originalAssetId
  const asset = await getAsset(deps, ctx, assetId)
  const next = { ...src, assetId, durationSec: Math.round((asset.durationMs ?? 0) / 100) / 10, cleanup: { ...src.cleanup, on } }
  await updateContent(deps, ctx, post.id, { spec: { clone: next } })
  return next
}

// The clip's first frame and the faces on it (largest first). A frame the
// face finder cannot read still shows; the main person is then the default.
async function firstFrame(deps: Deps, ctx: Ctx, video: string, name: string, jobId: string): Promise<{ assetId: string; people: CloneSource['people'] }> {
  return withTempDir(async dir => {
    const png = join(dir, 'first.png')
    await ffmpeg(['-ss', '0.05', '-i', video, '-frames:v', '1', png], 60_000)
    const data = await readFile(png)
    const asset = await saveAsset(deps, ctx, { data, mime: 'image/png', origin: 'derived', label: `First frame of ${name}`, sourceJobId: jobId })
    let people: CloneSource['people'] = []
    if ((await deps.faces.status()).available && asset.width && asset.height) {
      const W = asset.width, H = asset.height
      people = (await deps.faces.detect(data).catch(() => []))
        .filter(f => f.score >= 0.6 && f.box.w >= W * 0.02)
        .map(f => ({ x: f.box.x / W, y: f.box.y / H, w: f.box.w / W, h: f.box.h / H }))
        .sort((a, b) => b.w * b.h - a.w * a.h)
        .slice(0, 12)
    }
    return { assetId: asset.id, people }
  })
}

// A clip prepared before first frames existed gets one when the panel opens.
async function runCloneFrame(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const postId = job.purpose.split(':')[1]!
  const post = await getContent(deps, ctx, postId)
  const source = cloneOf(post)
  if (!source?.assetId || source.firstFrameId) return { skipped: true }
  const frame = await withTempDir(async dir => {
    const v = join(dir, 'source.mp4')
    await writeFile(v, (await readAsset(deps, ctx, source.assetId!)).data)
    return firstFrame(deps, ctx, v, source.name, job.id)
  })
  const now = cloneOf(await getContent(deps, ctx, postId))
  if (now?.assetId === source.assetId) await updateContent(deps, ctx, postId, { spec: { clone: { ...now, firstFrameId: frame.assetId, people: frame.people } } })
  return frame
}

// "Tap the person to replace": a point on the first frame, or null for the
// largest person again.
export async function setCloneTarget(deps: Deps, ctx: Ctx, contentId: string, at: Point | null): Promise<CloneSource> {
  const post = await getContent(deps, ctx, contentId)
  const source = cloneOf(post)
  if (!source || source.status !== 'ready') throw new AppError('bad_request', 'Add the TikTok or Reel to clone first.')
  const target = at ? { x: Math.min(1, Math.max(0, at.x)), y: Math.min(1, Math.max(0, at.y)) } : null
  // Kept scene stills showed the old pick, so they no longer apply.
  const next = { ...source, target, stills: {} }
  await updateContent(deps, ctx, post.id, { spec: { clone: next } })
  return next
}

export const cloneTargetWords = (deps: Deps, source: CloneSource) => targetWords(deps.config.pipeline.templates.clone, source.people, source.target)

// ── The model ───────────────────────────────────────────────────────

async function onAccount(deps: Deps, ctx: Ctx): Promise<boolean> {
  const billing = (await readBilling(deps.db, ctx.accountId)).default
  return billing === 'account' && (await listCredentials(deps.db, ctx.accountId)).some(c => c.provider === ACCOUNT_PROVIDER)
}

// The account's last pick for the mode; else the mode's default on the
// owner's Higgsfield plan when that is the default and connected, else the
// API one.
export async function cloneModel(deps: Deps, ctx: Ctx, mode: CloneMode = deps.config.pipeline.content.clone.mode): Promise<string> {
  const cfg = deps.config.pipeline.content.clone
  const saved = await getSetting<string | null>(deps.db, ctx.accountId, CLONE_MODEL_KEY[mode], null)
  if (saved && cfg.models.some(m => m.ref === saved) && modelEntry(deps, saved).clone.mode === mode) return saved
  const account = await onAccount(deps, ctx)
  if (mode === 'replace') return account ? cfg.account_model : cfg.model
  return account ? cfg.motion_account_model : cfg.motion_model
}

export async function saveCloneModel(deps: Deps, ctx: Ctx, model: string): Promise<void> {
  if (!deps.config.pipeline.content.clone.models.some(m => m.ref === model)) throw new AppError('bad_request', `${model} is not offered for cloning.`)
  await setSetting(deps, ctx, CLONE_MODEL_KEY[modelEntry(deps, model).clone.mode], model)
}

// The picker: each model with its mode, what it does and the price for this
// clip and one character. Estimates are free. A clip prepared before first
// frames existed gets its frame made now (free, on the worker).
export async function cloneOptions(deps: Deps, ctx: Ctx, contentId: string) {
  const post = await getContent(deps, ctx, contentId)
  const source = cloneOf(post)
  const cfg = deps.config.pipeline.content.clone
  if (source?.status === 'ready' && source.assetId && !source.firstFrameId) {
    const [pending] = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.purpose, `clone_frame:${post.id}`), inArray(jobs.status, ['queued', 'running']))).limit(1)
    if (!pending) await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `clone_frame:${post.id}`, label: `Find the people in ${source.name}`, characterId: post.characterId, request: {} })
  }
  const seconds = Math.max(1, Math.ceil(source?.durationSec ?? 10))
  const models = await Promise.all(cfg.models.map(async m => {
    const entry = modelEntry(deps, m.ref)
    const base = { ref: m.ref, label: entry.label, mode: entry.clone.mode, resolution: m.resolution ?? null, background: entry.clone.background, minSec: entry.clone.min_sec, maxSec: entry.clone.max_sec, path: entry.api === false ? 'account' : 'api', note: entry.notes ?? '' }
    try {
      const run = await runModel(deps, ctx, m.ref, 'video_clone')
      const request: GenRequest = { kind: 'video_clone', model: run.model, prompt: 'price', durationSec: seconds, resolution: m.resolution, audio: false, ...(run.billing ? { billing: run.billing } : {}) }
      const [item] = await quoteItemsFor(deps, ctx, [{ type: 'gen', stage: 'video', purpose: 'clone_price', label: entry.label, request }])
      const e = item!.estimate
      return { ...base, display: displayPrice([{ amountMicros: e.totalMicros, credits: e.credits ?? null }]), verified: e.verified, problem: null as string | null }
    } catch (e) {
      return { ...base, display: null, verified: false, problem: (e as Error).message }
    }
  }))
  const defaults = { replace: await cloneModel(deps, ctx, 'replace'), motion: await cloneModel(deps, ctx, 'motion') }
  return {
    mode: cfg.mode, outfit: cfg.outfit, defaults, model: defaults[cfg.mode], models, seconds,
    target: source ? cloneTargetWords(deps, source) : deps.config.pipeline.templates.clone.target_main,
    maxCharacters: cfg.max_characters, keepSound: cfg.keep_sound, minSeconds: cfg.min_seconds, maxSeconds: cfg.max_seconds, maxUploadMb: cfg.max_upload_mb,
  }
}

// ── The run ─────────────────────────────────────────────────────────

export interface CloneInput {
  contentId: string
  characterIds: string[]
  model?: string
  mode?: CloneMode
  background?: 'video' | 'image'
  // Replace: keep the clip's outfit (default) or wear the outfit of one of
  // the character's stills (`looks`).
  outfit?: 'source' | 'hers'
  // A kept still per character: the outfit to wear ("hers"), or the look
  // and place on a motion model run the older way (kept for old callers).
  looks: Record<string, string>
  keepSound: boolean
}

// REF-00 and the first approved three-quarter view (content.yaml
// clone.face_refs): enough to hold the face, and nothing else from the
// sheet. More sheet images taught one model the sheet's gray studio and
// clothes (G28).
function replaceRefs(deps: Deps, approved: Map<string, string>): string[] {
  const [main, ...side] = deps.config.pipeline.content.clone.face_refs
  const out = [approved.get(main!)].filter((a): a is string => !!a)
  const view = side.map(id => approved.get(id)).find((a): a is string => !!a)
  if (view) out.push(view)
  return out
}

async function lookStill(deps: Deps, ctx: Ctx, cid: string, name: string, poss: string, lookId: string): Promise<string> {
  const still = await getCandidate(deps, ctx, lookId)
  if (still.characterId !== cid || !still.assetId || isVideoOp(still.op) || still.target !== 'scene') throw new AppError('bad_request', `Pick a still of ${name} for ${poss} outfit.`)
  return still.assetId
}

function readySource(post: { kind: string; spec: unknown }): CloneSource & { assetId: string } {
  const source = cloneOf(post)
  if (!source || source.status !== 'ready' || !source.assetId) {
    throw new AppError('bad_request', source?.status === 'preparing' ? 'The clip to clone is still being prepared. Try again in a moment.' : 'Add the TikTok or Reel to clone first.')
  }
  return source as CloneSource & { assetId: string }
}

export async function buildClone(deps: Deps, ctx: Ctx, input: CloneInput) {
  const post = await getContent(deps, ctx, input.contentId)
  const source = readySource(post)
  const cfg = deps.config.pipeline.content.clone
  const t = deps.config.pipeline.templates
  const ids = [...new Set(input.characterIds)]
  if (!ids.length) throw new AppError('invalid_request', 'Pick a character to clone the clip for.')
  if (ids.length > cfg.max_characters) throw new AppError('invalid_request', `Clone for up to ${cfg.max_characters} characters at once.`)
  const mode: CloneMode = input.mode ?? (input.model && cfg.models.some(m => m.ref === input.model) ? modelEntry(deps, input.model).clone.mode : cfg.mode)
  const wanted = input.model ?? await cloneModel(deps, ctx, mode)
  const picked = cfg.models.find(m => m.ref === wanted)
  if (!picked) throw new AppError('bad_request', `${wanted} is not offered for cloning. Pick one of the listed models.`)
  const entry = modelEntry(deps, wanted)
  const c = entry.clone
  if (c.mode !== mode) {
    throw new AppError('bad_request', mode === 'replace'
      ? `${entry.label} copies the moves onto an image; it does not keep the clip's scene. Pick a model under "Replace the person".`
      : `${entry.label} replaces the person in the clip; pick a model under "Copy the moves".`)
  }
  const seconds = source.durationSec ?? 0
  // What a model can take is not a rule: a clip outside it would only fail.
  if (seconds < c.min_sec - 0.05 || seconds > c.max_sec + 0.05) {
    throw new AppError('invalid_request', `${entry.label} takes clips from ${c.min_sec} to ${c.max_sec} s; this one is ${seconds} s. Pick another model.`)
  }
  // Replace keeps the clip's place; a motion run takes the place from its
  // scene still, which is the clip's own first frame.
  const background = mode === 'replace' ? 'video' : input.background && c.background.includes(input.background) ? input.background : c.background.includes('image') ? 'image' : c.background[0]!
  const run = await runModel(deps, ctx, wanted, 'video_clone')
  const warnings: RuleViolation[] = []
  if (input.keepSound && !source.hasAudio) warnings.push(warn('video-audio-off', 'No sound to keep', 'This clip has no sound, so the clone stays silent.'))
  const target = cloneTargetWords(deps, source)
  if (mode === 'replace' && source.people.length > 1 && !source.target) {
    warnings.push(warn('clone-target', 'More than one person', `${source.people.length} people are in this clip; only the largest one is replaced. Tap another person on the first frame to change it.`))
  }
  const specs: JobSpec[] = []
  const prompts: Array<{ label: string; text: string; wrapped: string }> = []
  const names: string[] = []
  for (const cid of ids) {
    const row = await getCharacter(deps, ctx, cid)
    const ch = toData(row)
    const approved = await approvedAssets(deps, ctx, cid)
    if (!approved.get('REF-00')) throw new AppError('bad_request', `${row.name} has no face yet. Set up ${ch.pronouns.poss} face (REF-00) first, or leave ${ch.pronouns.obj} out.`)
    let refs: string[]
    let template: string
    if (mode === 'replace') {
      refs = replaceRefs(deps, approved)
      let outfit = fill(t.clone.outfit_source, pronounVars(ch.pronouns))
      const lookId = input.looks[cid]
      if ((input.outfit ?? cfg.outfit) === 'hers') {
        if (lookId) {
          refs.push(await lookStill(deps, ctx, cid, row.name, ch.pronouns.poss, lookId))
          outfit = fill(t.clone.outfit_hers, pronounVars(ch.pronouns))
        } else {
          warnings.push(warn('clone-outfit', 'The outfit stays', `There is no still of ${row.name} to take an outfit from, so ${ch.pronouns.subj} wears the clothes in the clip. Make a still in the Stills step to dress ${ch.pronouns.obj} in one of ${ch.pronouns.poss} outfits.`))
        }
      }
      refs = refs.slice(0, Math.min(c.image_refs, entry.max_refs))
      template = fill(t.clone.replace, { ...pronounVars(ch.pronouns), target, outfit })
    } else {
      // Never a bare sheet image: the scene still puts the character in the
      // clip's place first, and the owner sees it before this run.
      const stillId = source.stills[cid]
      if (!stillId) throw new AppError('bad_request', `Make ${row.name}'s scene still first. "Copy the moves" starts from ${ch.pronouns.obj} in the clip's place, never from a bare sheet image (that gives a gray studio).`)
      const still = await getCandidate(deps, ctx, stillId).catch(() => null)
      if (!still?.assetId || still.characterId !== cid || still.op !== 'clone_still') throw new AppError('bad_request', `Make ${row.name}'s scene still again; the kept one is gone.`)
      refs = [still.assetId]
      template = fill(t.clone.image, pronounVars(ch.pronouns))
    }
    const sw = await ruleSwitches(deps, ctx, cid)
    // The REALISM block rides along on every model that takes a prompt.
    const prompt = c.prompt === 'none' ? '' : assembleVideoPrompt(t, template, { directions: '', audio: false, realism: ch.realism?.block })
    const request: GenRequest = {
      kind: 'video_clone', model: run.model, prompt, refs: refs.map(assetId => ({ assetId })), sourceVideo: { assetId: source.assetId },
      durationSec: Math.max(1, Math.ceil(seconds)), resolution: picked.resolution, cloneBackground: background, audio: false,
      ...(input.keepSound && source.hasAudio ? { keepSourceSound: true } : {}),
      ...(run.billing ? { billing: run.billing } : {}),
    }
    if (prompt) {
      warnings.push(...lintOrThrow(lintPrompt(deps.config.pipeline.rules, prompt, { stage: 'video', kind: 'video_clone', request: { ...request, model: wanted }, switches: sw }), `Clone for ${row.name}`))
      if (!prompts.some(p => p.text === prompt)) prompts.push({ label: `Clone prompt (${row.name})`, text: prompt, wrapped: hardWrap(prompt) })
    }
    names.push(row.name)
    specs.push({ type: 'gen', stage: 'video', purpose: `clone:${post.id}:${cid}`, label: `Clone for ${row.name}`, request, characterId: cid })
  }
  const seen = new Set<string>()
  return {
    purpose: `clone:${post.id}`,
    characterId: post.characterId ?? ids[0]!,
    specs,
    preview: {
      title: `${mode === 'replace' ? 'Replace the person in' : 'Copy the moves of'} "${source.name}" for ${names.join(', ')}`,
      prompts,
      warnings: warnings.filter(w => { const k = `${w.ruleId}|${w.message}`; if (seen.has(k)) return false; seen.add(k); return true }),
      invalidates: [] as string[],
    },
  }
}

// ── The scene still ("Copy the moves into a new scene") ───────────

export interface CloneStillInput { contentId: string; characterId: string; outfit?: 'source' | 'hers'; look?: string }

// The clip's first frame with only the picked person replaced by the
// character (REF-00 and a three-quarter view hold the face; everything else
// in the frame stays). It is shown before the motion run, which then copies
// the moves onto it.
export async function buildCloneStill(deps: Deps, ctx: Ctx, input: CloneStillInput) {
  const post = await getContent(deps, ctx, input.contentId)
  const source = readySource(post)
  if (!source.firstFrameId) throw new AppError('bad_request', 'The first frame of the clip is still being prepared. Try again in a moment.')
  const cfg = deps.config.pipeline.content.clone
  const { templates: t, scenes: sc, rules } = deps.config.pipeline
  const row = await getCharacter(deps, ctx, input.characterId)
  const ch = toData(row)
  const approved = await approvedAssets(deps, ctx, row.id)
  if (!approved.get('REF-00')) throw new AppError('bad_request', `${row.name} has no face yet. Set up ${ch.pronouns.poss} face (REF-00) first.`)
  const model = (await onAccount(deps, ctx)) ? cfg.scene_still.model : cfg.scene_still.api_model
  const run = await runModel(deps, ctx, model, 'image_edit')
  const entry = deps.config.models.models.find(m => m.ref === model)!
  const refs = [source.firstFrameId, ...replaceRefs(deps, approved)]
  const warnings: RuleViolation[] = []
  let outfit = fill(t.clone.outfit_source, pronounVars(ch.pronouns))
  if ((input.outfit ?? cfg.outfit) === 'hers') {
    if (input.look) {
      refs.push(await lookStill(deps, ctx, row.id, row.name, ch.pronouns.poss, input.look))
      outfit = fill(t.clone.outfit_hers, pronounVars(ch.pronouns))
    } else {
      warnings.push(warn('clone-outfit', 'The outfit stays', `There is no still of ${row.name} to take an outfit from, so ${ch.pronouns.subj} wears the clothes in the clip.`))
    }
  }
  const frame = await getAsset(deps, ctx, source.firstFrameId)
  const portrait = (frame.height ?? 16) >= (frame.width ?? 9)
  const sw = await ruleSwitches(deps, ctx, row.id)
  const realism: RealismWarning[] = []
  const change = fill(t.clone.scene_still, { ...pronounVars(ch.pronouns), target: cloneTargetWords(deps, source), outfit })
  const prompt = buildEditPrompt(t, change, ch, false, { warnings: realism, flawDose: sw.on('realism-flaw-dose') })
  const request: GenRequest = {
    kind: 'image_edit', model: run.model, prompt, aspect: portrait ? '9:16' : '16:9', quality: sc.settings.quality, resolution: sc.settings.resolution,
    refs: refs.slice(0, entry.max_refs).map(assetId => ({ assetId })),
    ...(run.billing ? { billing: run.billing } : {}),
  }
  warnings.push(...lintOrThrow(lintPrompt(rules, prompt, { stage: 'edit', kind: 'image_edit', request: { ...request, model }, switches: sw }), 'Scene still'))
  for (const w of realism) warnings.push(w)
  return {
    purpose: `clone_still:${post.id}`,
    characterId: row.id,
    specs: [{ type: 'gen' as const, stage: 'edit', purpose: `clone_still:${post.id}:${row.id}`, label: `Scene still for ${row.name}`, request, characterId: row.id }],
    preview: { title: `Scene still: ${row.name} in "${source.name}"`, prompts: [{ label: 'Scene still prompt', text: prompt, wrapped: hardWrap(prompt) }], warnings, invalidates: [] as string[] },
  }
}

async function onCloneStill(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const postId = job.purpose.split(':')[1]!
  const req = job.request as GenRequest
  const characterId = job.characterId!
  const post = await getContent(deps, ctx, postId).catch(() => null)
  const source = post ? cloneOf(post) : null
  const base = { accountId: job.accountId, characterId, jobId: job.id, createdBy: job.userId, prompt: req.prompt ?? '', target: 'clone_still', op: 'clone_still', label: `Scene still: ${source?.name ?? 'a clip'}` }
  const asset = out.assets?.find(a => a.kind === 'image') ?? out.assets?.[0]
  if (out.status !== 'completed' || !asset) {
    await deps.db.insert(candidates).values({ ...base, id: newId('cand'), status: 'failed', rejectNote: out.error || 'The scene still did not finish.' })
    return
  }
  // Free checks: the face against REF-00, and that it is not the person
  // from the clip.
  const findings: QaReport['findings'] = []
  const demo = job.provider === 'mock'
  try {
    const ref00 = (await approvedAssets(deps, ctx, characterId)).get('REF-00')
    const r = await scoreSceneIdentity(deps, ctx, { assetId: asset.id, refs: ref00 ? [{ refId: 'REF-00', assetId: ref00 }] : [], demo })
    findings.push(...r.findings)
    if (source?.firstFrameId) {
      const row = await getCharacter(deps, ctx, characterId)
      const p = await scorePerformer(deps, ctx, { pairs: [{ result: (await readAsset(deps, ctx, asset.id)).data, source: (await readAsset(deps, ctx, source.firstFrameId)).data }], name: row.name, demo })
      findings.push(...p.findings.filter(f => !findings.some(x => x.code === f.code && x.message === f.message)))
    }
  } catch (e) {
    findings.push({ code: 'uncertain', severity: 'warn', message: `The free checks could not run on this still (${(e as Error).message.slice(0, 160)}). Look at the face yourself.` })
  }
  const report = freeChecksOnly(finalize(findings, null))
  const fails = (code: string) => findings.some(f => f.code === code && f.severity === 'fail')
  const status = fails('too_similar') ? 'qa_failed' : fails('face_drift') ? 'in_review' : 'approved'
  const id = newId('cand')
  await deps.db.insert(candidates).values({
    ...base, id, assetId: asset.id, status, qaReport: report, qaVerdict: report.verdict,
    ...(status === 'qa_failed' ? { rejectNote: findings.find(f => f.code === 'too_similar')!.message } : {}),
  })
  // The first good still is kept for the run; "Use this still" picks another.
  const now = post ? cloneOf(await getContent(deps, ctx, postId)) : null
  if (now && status === 'approved' && !now.stills[characterId] && now.firstFrameId === source?.firstFrameId) {
    await updateContent(deps, ctx, postId, { spec: { clone: { ...now, stills: { ...now.stills, [characterId]: id } } } })
  }
}

export interface CloneStillView { id: string; characterId: string; characterName: string; assetId: string | null; status: string; kept: boolean; error: string | null; findings: Array<{ code: string; severity: string; message: string }>; createdAt: string }

export async function cloneStills(deps: Deps, ctx: Ctx, contentId: string): Promise<CloneStillView[]> {
  const post = await getContent(deps, ctx, contentId)
  const source = cloneOf(post)
  const jobRows = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), like(jobs.purpose, `clone_still:${contentId}:%`)))
  if (!jobRows.length) return []
  const rows = await deps.db.select().from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.op, 'clone_still'), inArray(candidates.jobId, jobRows.map(j => j.id))))
    .orderBy(desc(candidates.createdAt))
  const names = new Map((await deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.accountId, ctx.accountId))).map(c => [c.id, c.name]))
  return rows.map(c => ({
    id: c.id, characterId: c.characterId, characterName: names.get(c.characterId) ?? '', assetId: c.assetId, status: c.status, kept: source?.stills[c.characterId] === c.id,
    error: c.status === 'failed' || c.status === 'qa_failed' ? c.rejectNote || 'The scene still failed.' : null,
    findings: ((c.qaReport as QaReport | null)?.findings ?? []).map(f => ({ code: f.code, severity: f.severity, message: f.message })), createdAt: c.createdAt.toISOString(),
  }))
}

// "Use this still": the scene still a motion run starts from.
export async function useCloneStill(deps: Deps, ctx: Ctx, contentId: string, candidateId: string): Promise<{ ok: true }> {
  const post = await getContent(deps, ctx, contentId)
  const source = readySource(post)
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.op !== 'clone_still' || !cand.assetId) throw new AppError('bad_request', 'That is not a finished scene still.')
  const job = cand.jobId ? (await deps.db.select({ purpose: jobs.purpose }).from(jobs).where(eq(jobs.id, cand.jobId)))[0] : undefined
  if (!job?.purpose.startsWith(`clone_still:${post.id}:`)) throw new AppError('bad_request', 'That scene still belongs to another post.')
  if (cand.status === 'qa_failed') throw new AppError('bad_request', 'This still looks like the person in the clip, not the character. A new person is a fixed rule, so it cannot be used. Make it again.')
  await updateContent(deps, ctx, post.id, { spec: { clone: { ...source, stills: { ...source.stills, [cand.characterId]: cand.id } } } })
  return { ok: true }
}

// ── The result ──────────────────────────────────────────────────────

async function onClone(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const postId = job.purpose.split(':')[1]!
  const req = job.request as GenRequest
  const characterId = job.characterId!
  const post = await getContent(deps, ctx, postId).catch(() => null)
  const source = post ? cloneOf(post) : null
  const label = `Clone: ${source?.assetId === req.sourceVideo?.assetId ? source!.name : 'a clip'}`
  const base = { accountId: job.accountId, characterId, jobId: job.id, createdBy: job.userId, prompt: req.prompt ?? '', target: 'clip', op: 'clone', label }
  const asset = out.assets?.find(a => a.kind === 'video') ?? out.assets?.[0]
  if (out.status !== 'completed' || !asset || !req.sourceVideo) {
    await deps.db.insert(candidates).values({ ...base, id: newId('cand'), status: 'failed', rejectNote: out.error || 'The clone did not finish.' })
    return
  }
  const row = await getCharacter(deps, ctx, characterId)
  const findings: QaReport['findings'] = []
  let clipAssetId = asset.id
  // "Keep original sound": the source clip's sound under the clone (free).
  if (req.keepSourceSound) {
    try {
      clipAssetId = await withTempDir(async dir => {
        const v = join(dir, 'clone.mp4'), s = join(dir, 'source.mp4'), o = join(dir, 'out.mp4')
        await writeFile(v, (await readAsset(deps, ctx, asset.id)).data)
        await writeFile(s, (await readAsset(deps, ctx, req.sourceVideo!.assetId)).data)
        await muxSound(v, s, o)
        return (await saveAsset(deps, ctx, { data: await readFile(o), mime: 'video/mp4', origin: 'derived', label: `${label} (original sound)`, sourceJobId: job.id })).id
      })
      findings.push({ code: 'uncertain', severity: 'info', message: 'The original sound from the source clip is kept.' })
    } catch (e) {
      findings.push({ code: 'uncertain', severity: 'warn', message: `The original sound could not be added (${(e as Error).message.slice(0, 160)}), so this clone is silent.` })
    }
  }
  // Free checks: the face against REF-00 on two frames, that it is not the
  // performer from the source clip at the same moments, and the skin.
  const demo = job.provider === 'mock'
  try {
    const at = [0.3, 0.6, 0.9]
    const frames = await clipFrames(deps, ctx, asset.id, at)
    const sourceFrames = await clipFrames(deps, ctx, req.sourceVideo.assetId, at)
    const ref00 = (await approvedAssets(deps, ctx, characterId)).get('REF-00')
    for (const i of [1, 2]) {
      const frame = await saveAsset(deps, ctx, { data: frames[i]!, mime: 'image/png', origin: 'derived', label: `frame of ${asset.id}`, sourceJobId: job.id })
      const r = await scoreSceneIdentity(deps, ctx, { assetId: frame.id, refs: ref00 ? [{ refId: 'REF-00', assetId: ref00 }] : [], demo })
      for (const f of r.findings) if (!findings.some(x => x.code === f.code && x.severity === f.severity)) findings.push(f)
    }
    const p = await scorePerformer(deps, ctx, { pairs: frames.map((f, i) => ({ result: f, source: sourceFrames[i]! })), name: row.name, demo })
    findings.push(...p.findings.filter(f => !findings.some(x => x.code === f.code && x.message === f.message)))
    if (ref00 && !demo) {
      const { data } = await readAsset(deps, ctx, ref00)
      const tex = await compareTexture(data, frames[1]!, { faces: deps.faces, minRatio: deps.config.runtime.qa.texture_min_ratio * 0.6, sameFraming: false })
      if (tex.smoothed) findings.push({ code: 'skin_smoothed', severity: 'warn', message: 'The skin looks smoothed in this clone compared with REF-00. Look closely before using it.' })
    }
  } catch (e) {
    findings.push({ code: 'uncertain', severity: 'warn', message: `The free checks could not run on this clone (${(e as Error).message.slice(0, 160)}). Look at the face yourself.` })
  }
  const report = freeChecksOnly(finalize(findings, null))
  const fails = (code: string) => findings.some(f => f.code === code && f.severity === 'fail')
  // A copy of the performer breaks a fixed rule (a new person, never a
  // copy), so it is not kept. Face drift is a strong warning: kept for a
  // person to decide, never picked automatically.
  const status = fails('too_similar') ? 'qa_failed' : fails('face_drift') ? 'in_review' : 'approved'
  await deps.db.insert(candidates).values({
    ...base, id: newId('cand'), assetId: clipAssetId, status, qaReport: report, qaVerdict: report.verdict,
    ...(status === 'qa_failed' ? { rejectNote: findings.find(f => f.code === 'too_similar')!.message } : {}),
  })
  await confirmByRun(deps, ctx, job)
}

// A real clone that finished on the API counts as the model's one paid test
// when it has not had one (the same endpoint, a real output).
async function confirmByRun(deps: Deps, ctx: Ctx, job: JobRow): Promise<void> {
  const req = job.request as GenRequest
  if (job.provider !== 'higgsfield' || (req.billing ?? 'api') !== 'api') return
  const base = deps.config.models.models.find(m => m.ref === req.model)
  if (!base) return
  const overrides = await readModelOverrides(deps.db, job.accountId)
  const current = effectiveModel(base, overrides[base.ref])
  if (current.confirmed || !current.endpoint) return
  const now = deps.clock.now().toISOString()
  await setSetting(deps, ctx, MODEL_OVERRIDES_KEY, {
    ...overrides,
    [base.ref]: { ...overrides[base.ref], confirmedAt: now, confirmedBy: job.userId, lastTest: { at: now, ok: true, message: `Confirmed by a real clone at ${current.endpoint}.`, jobId: job.id } },
  })
}

// ── The post's clones ───────────────────────────────────────────────

export interface CloneView {
  id: string; characterId: string; characterName: string; assetId: string | null; status: string; label: string
  durationSec: number | null; error: string | null; findings: Array<{ code: string; severity: string; message: string }>; createdAt: string
}

export async function postClones(deps: Deps, ctx: Ctx, contentId: string): Promise<CloneView[]> {
  await getContent(deps, ctx, contentId)
  const jobRows = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), like(jobs.purpose, `clone:${contentId}:%`)))
  if (!jobRows.length) return []
  const rows = await deps.db.select().from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.op, 'clone'), inArray(candidates.jobId, jobRows.map(j => j.id))))
    .orderBy(desc(candidates.createdAt))
  const names = new Map((await deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.accountId, ctx.accountId))).map(c => [c.id, c.name]))
  const out: CloneView[] = []
  for (const c of rows) {
    const asset = c.assetId ? await getAsset(deps, ctx, c.assetId).catch(() => null) : null
    const report = c.qaReport as QaReport | null
    out.push({
      id: c.id, characterId: c.characterId, characterName: names.get(c.characterId) ?? '', assetId: c.assetId, status: c.status, label: c.label ?? 'Clone',
      durationSec: asset?.durationMs ? Math.round(asset.durationMs / 100) / 10 : null, error: c.status === 'failed' || c.status === 'qa_failed' ? c.rejectNote || 'The clone failed.' : null,
      findings: (report?.findings ?? []).map(f => ({ code: f.code, severity: f.severity, message: f.message })), createdAt: c.createdAt.toISOString(),
    })
  }
  return out
}

// "Use this clip" keeps a clone the checks left for a person (face drift
// asks first). A copy of the performer can never be used.
export async function keepClone(deps: Deps, ctx: Ctx, candidateId: string, acknowledge = false): Promise<{ ok: true }> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.op !== 'clone' || !cand.assetId) throw new AppError('bad_request', 'That is not a finished clone.')
  const findings = (cand.qaReport as QaReport | null)?.findings ?? []
  const fails = (code: string) => findings.some(f => f.code === code && f.severity === 'fail')
  if (fails('too_similar')) throw new AppError('bad_request', 'This clone looks like the person in the source clip, not the character. A new person is a fixed rule, so it cannot be used. Try another model or a clearer character image.')
  if (cand.status === 'approved') return { ok: true }
  if (fails('face_drift') && !acknowledge && (await ruleSwitches(deps, ctx, cand.characterId)).on('qa-face-drift')) {
    throw new AppError('confirm_required', 'The face in this clone does not match REF-00. Use it anyway?')
  }
  const now = deps.clock.now()
  await deps.db.update(candidates).set({ status: 'approved', reviewedBy: ctx.userId, reviewedAt: now, updatedAt: now }).where(eq(candidates.id, cand.id))
  return { ok: true }
}

// "Make a video post" with a clone of another character: a new post of
// that character with the clip picked, the idea and account tag copied,
// opening at the Text step.
export async function postFromClone(deps: Deps, ctx: Ctx, contentId: string, candidateId: string, acknowledge = false): Promise<{ id: string }> {
  const from = await getContent(deps, ctx, contentId)
  await keepClone(deps, ctx, candidateId, acknowledge)
  const cand = await getCandidate(deps, ctx, candidateId)
  const row = await createContent(deps, ctx, { kind: 'meme', characterId: cand.characterId, idea: from.idea, accountTag: from.accountTag, spec: { clipId: cand.id }, step: 'text' })
  return { id: row.id }
}

let registered = false
export function registerClone(): void {
  if (registered) return
  registered = true
  registerLocalJob('clone_source', runCloneSource)
  registerJobHook('clone_caption', onCloneCaption)
  registerLocalJob('clone_frame', runCloneFrame)
  registerJobHook('clone', onClone)
  registerJobHook('clone_still', onCloneStill)
}
