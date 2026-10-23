import { and, eq } from 'drizzle-orm'
import { candidates, characters, contentItems } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { dropMentions, hardWrap } from '../core/text.js'
import { realismBlock } from '../core/realism.js'
import type { RuleViolation } from '../core/rules.js'
import type { GenRequest } from '../providers/types.js'
import { activateChained, cancelChildren, type JobSpec } from '../jobs/runner.js'
import { registerJobHook, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { parseCsv } from '../core/csvImport.js'
import { draftMotion } from '../core/weeks.js'
import { DOUG, EMPTY_FACELESS, MAX_PLACES, readPlacesCsv, FACELESS_ASPECT, FACELESS_PRODUCT_MODELS, FACELESS_STILL_MODEL, FINISHED_DAMAGE, facelessFinal, facelessProductPrompt, facelessStillPrompt, readFaceless, type FacelessFile } from '../core/faceless.js'
import { createCharacter, getCharacter, type CharacterRow } from './characters.js'
import { getContent, type ContentRow } from './content.js'
import { modelEntry, runModel, stillLevelFor } from './sceneActions.js'
import { stillPathFor } from './slideshow.js'

// Faceless characters (owner, 2026-10-22; UX-PLAN.md section 35, item 4).
// A character is a person (the default) or faceless; a faceless one keeps
// its file in the character's features. It skips the hero, the sheet, the
// likeness gates, the Element and every face check: nothing asks for a
// face. Its posts are video posts in the same workspace: a still (from the
// place bank or written, Soul 2.0 at 9:16; a product post on an edit model
// with the product photo), a video from that still (image-to-video, any
// model, priced), the sound, the text, Posted.

export type CharacterKind = 'person' | 'faceless'
const features = (row: CharacterRow) => (row.features ?? {}) as { kind?: CharacterKind; faceless?: unknown }
export const kindOf = (row: CharacterRow): CharacterKind => (features(row).kind === 'faceless' ? 'faceless' : 'person')
export const facelessOf = (row: CharacterRow): FacelessFile => readFaceless(features(row).faceless ?? EMPTY_FACELESS)

export async function createFacelessCharacter(deps: Deps, ctx: Ctx, input: { name: string; template?: 'doug' | null }): Promise<CharacterRow> {
  const doug = input.template === 'doug'
  const row = await createCharacter(deps, ctx, { name: input.name.trim() || (doug ? DOUG.name : 'Faceless account'), stage: 5 })
  await deps.db.update(characters).set({ features: { ...(row.features as object ?? {}), kind: 'faceless', faceless: doug ? DOUG.file : EMPTY_FACELESS }, status: 'active', updatedAt: deps.clock.now() }).where(eq(characters.id, row.id))
  return getCharacter(deps, ctx, row.id)
}

export async function saveFaceless(deps: Deps, ctx: Ctx, characterId: string, file: unknown): Promise<FacelessFile> {
  const row = await getCharacter(deps, ctx, characterId)
  if (kindOf(row) !== 'faceless') throw new AppError('bad_request', 'This character has a face: its file is the character file.')
  const clean = readFaceless(file)
  await deps.db.update(characters).set({ features: { ...(row.features as object ?? {}), kind: 'faceless', faceless: clean }, updatedAt: deps.clock.now() }).where(eq(characters.id, row.id))
  return clean
}

// Import places (item 18): a CSV of place_id, scene, motion, still_job_id
// into the character's place bank; a place with the same id is replaced,
// the rest kept; a place with no motion line gets one drafted by code.
export async function importPlaces(deps: Deps, ctx: Ctx, characterId: string, csv: string): Promise<{ added: number; replaced: number; drafted: number; total: number; problems: string[] }> {
  const row = await getCharacter(deps, ctx, characterId)
  if (kindOf(row) !== 'faceless') throw new AppError('bad_request', 'Places belong to a faceless character.')
  if (csv.length > 2_000_000) throw new AppError('bad_request', 'That file is too big (2 MB). Split it.')
  const { places, problems, drafted } = readPlacesCsv(parseCsv(csv), draftMotion)
  if (!places.length) throw new AppError('invalid_request', problems[0] ?? 'No places in the file.')
  const file = facelessOf(row)
  const byId = new Map(file.places.map(p => [p.id, p]))
  let added = 0, replaced = 0
  for (const p of places) { if (byId.has(p.id)) replaced++; else added++; byId.set(p.id, p) }
  const merged = [...byId.values()].slice(0, MAX_PLACES)
  await saveFaceless(deps, ctx, row.id, { ...file, places: merged })
  return { added, replaced, drafted, total: merged.length, problems }
}

// A faceless post's own fields (in the video post's spec).
export interface FacelessPost {
  placeId: string | null
  line: string
  // A product post: the product photo (an uploaded image) and its name.
  product: { assetId: string; name: string } | null
  videoPrompt: string
  postCaption: string
  hashtags: string[]
  music: string | null
  voiceover: { search: string; note: string } | null
  posted: boolean
  recipe: 'finished_damage' | null
}
export function readFacelessPost(x: unknown): FacelessPost {
  const f = (x ?? {}) as Partial<FacelessPost>
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
  return {
    placeId: typeof f.placeId === 'string' ? f.placeId.slice(0, 60) : null,
    line: s(f.line, 800),
    product: f.product && typeof f.product.assetId === 'string' ? { assetId: f.product.assetId.slice(0, 60), name: s(f.product.name, 120) } : null,
    videoPrompt: s(f.videoPrompt, 2000),
    postCaption: s(f.postCaption, 2200),
    hashtags: (Array.isArray(f.hashtags) ? f.hashtags : []).map(h => s(h, 60).replace(/^#+/, '')).filter(Boolean).slice(0, 15),
    music: typeof f.music === 'string' ? f.music.slice(0, 60) : null,
    voiceover: f.voiceover && typeof f.voiceover.search === 'string' ? { search: s(f.voiceover.search, 200), note: s(f.voiceover.note, 300) } : null,
    posted: f.posted === true,
    recipe: f.recipe === 'finished_damage' ? 'finished_damage' : null,
  }
}

async function facelessPost(deps: Deps, ctx: Ctx, contentId: string): Promise<{ row: ContentRow; ch: CharacterRow; file: FacelessFile; post: FacelessPost }> {
  const row = await getContent(deps, ctx, contentId)
  if (row.kind !== 'meme' || !row.characterId) throw new AppError('bad_request', 'A faceless still belongs to a video post.')
  const ch = await getCharacter(deps, ctx, row.characterId)
  if (kindOf(ch) !== 'faceless') throw new AppError('bad_request', 'This post\'s character has a face: make its stills in the Stills step.')
  return { row, ch, file: facelessOf(ch), post: readFacelessPost((row.spec as { faceless?: unknown }).faceless) }
}

type Built = { purpose: string; characterId: string | null; specs: JobSpec[]; preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: RuleViolation[]; invalidates: string[] } }
const warn = (ruleId: string, title: string, message: string): RuleViolation => ({ ruleId, title, message, severity: 'warning', spec: '35' } as RuleViolation)

// The still (priced): the place from the bank or the post's own line, Soul
// 2.0 at 9:16 on the picked path (the plan's credits or the API's
// dollars, rule R4); a product post on an edit model with the photo.
export async function buildFacelessStill(deps: Deps, ctx: Ctx, input: { contentId: string; placeId?: string | null; line?: string; path?: 'account' | 'api' | null; model?: string | null }): Promise<Built> {
  const { row, ch, file, post } = await facelessPost(deps, ctx, input.contentId)
  const placeId = input.placeId !== undefined ? input.placeId : post.placeId
  const place = placeId ? file.places.find(p => p.id === placeId) ?? null : null
  const line = (input.line ?? post.line).trim()
  if (!place && line.length < 3) throw new AppError('invalid_request', 'Pick a place from the bank or write what the still shows.')
  const still = facelessStillPrompt({ place: line ? null : place, line: line || undefined, look: file.look })
  const product = post.product
  const model = product ? (FACELESS_PRODUCT_MODELS as readonly string[]).includes(input.model ?? '') ? input.model! : FACELESS_PRODUCT_MODELS[0] : FACELESS_STILL_MODEL
  const path = await stillPathFor(deps, ctx, null, { path: input.path ?? null })
  const run = await runModel(deps, ctx, model, product ? 'image_edit' : 'image')
  const level = stillLevelFor(deps, model)
  const body = product ? facelessProductPrompt(still.prompt, product.name) : still.prompt
  // Rule zero holds: every image prompt carries a REALISM line; with no
  // person in frame it is the plain one, and the faceless ending comes last.
  // Soul never sees text, label, logo or watermark words (not even negated).
  const prompt = dropMentions(facelessFinal(body, realismBlock(deps.config.pipeline.templates.slideshow_topic_realism)), modelEntry(deps, model).prompt_never)
  const request: GenRequest = {
    kind: product ? 'image_edit' : 'image', model: run.model, modelRef: model, prompt, aspect: FACELESS_ASPECT, quality: level.quality, resolution: level.resolution,
    ...(product ? { refs: [{ assetId: product.assetId }] } : {}),
    ...(run.billing ? { billing: run.billing } : path === 'account' ? { billing: 'account' as const } : {}),
  }
  const warnings = still.warnings.map(w => warn(w.id, w.id === 'faceless-tilt' ? 'Kept level' : w.id === 'faceless-person' ? 'No person in a faceless still' : 'Text on objects', w.message))
  if (product) warnings.push(warn('faceless-product', `${modelEntry(deps, model).label} for the product`, 'Soul can\'t render labels, so a product post is made by an edit model with the product photo as the reference.'))
  return {
    purpose: `faceless_still:${row.id}`, characterId: ch.id,
    preview: { title: `The still (${modelEntry(deps, model).label}, 9:16)`, prompts: [{ label: 'Still prompt', text: prompt, wrapped: hardWrap(prompt) }], warnings, invalidates: [] },
    specs: [{ type: 'gen', stage: 'slideshow', purpose: `faceless_still:${row.id}`, label: `Faceless still, ${modelEntry(deps, model).label}`, request }],
  }
}

// The video (priced): image-to-video from the post's still with the
// prompt prefilled from the row, any video model (rule R3: no limit on its
// shots; rule R4: on the plan or the API).
// chain (Make the week, UX-PLAN.md section 37): the still is made in the
// same run, so the video waits for it and starts from it (no start frame
// yet). A place's own motion line is the prompt when the post has none.
export async function buildFacelessVideo(deps: Deps, ctx: Ctx, input: { contentId: string; model?: string | null; prompt?: string; durationSec?: number; chain?: boolean }): Promise<Built> {
  const { row, ch, post, file } = await facelessPost(deps, ctx, input.contentId)
  const stillId = (row.spec as { stillId?: string | null }).stillId
  let still: { assetId: string | null } | undefined
  if (!input.chain) {
    if (!stillId) throw new AppError('invalid_request', 'Make or pick the still first: the video starts from it.')
    ;[still] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, stillId)))
    if (!still?.assetId) throw new AppError('invalid_request', 'The still is still on its way.')
  }
  const place = post.placeId ? file.places.find(p => p.id === post.placeId) : null
  const v = deps.config.pipeline.scenes.video
  const model = input.model && v.models.some(m => m.ref === input.model) ? input.model : v.model
  const picked = v.models.find(m => m.ref === model)
  const text = (input.prompt ?? post.videoPrompt).trim() || place?.motion?.trim() || (post.recipe === 'finished_damage' ? FINISHED_DAMAGE.motion : '')
  if (text.length < 3) throw new AppError('invalid_request', 'Say what happens in the video.')
  const durationSec = Math.max(3, Math.min(15, Math.round(input.durationSec ?? (post.recipe === 'finished_damage' ? FINISHED_DAMAGE.durationSec : v.duration))))
  const run = await runModel(deps, ctx, model, 'video')
  const prompt = `${text.replace(/[.\s]+$/, '')}. Starts from this exact still: the same place, light and objects. No people. ${deps.config.pipeline.templates.video.silent}`
  const request: GenRequest = {
    kind: 'video', model: run.model, modelRef: model, prompt, aspect: FACELESS_ASPECT, resolution: picked?.resolution, durationSec, audio: false,
    ...(still?.assetId ? { startFrame: { assetId: still.assetId } } : {}), ...(run.billing ? { billing: run.billing } : {}),
    ...(input.chain ? { chainStart: true } : {}),
  } as GenRequest
  return {
    purpose: `faceless_video:${row.id}`, characterId: ch.id,
    preview: { title: `The video (${modelEntry(deps, model).label}, ${durationSec} s)`, prompts: [{ label: 'Video prompt', text: prompt, wrapped: hardWrap(prompt) }], warnings: [], invalidates: [] },
    specs: [{ type: 'gen', stage: 'video', purpose: `faceless_video:${row.id}`, label: `Faceless video, ${modelEntry(deps, model).label}`, request }],
  }
}

// A finished still or take goes straight into its post (no face check: a
// faceless post has no face to check). The post card shows the still.
async function onFacelessStill(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const asset = out.assets?.find(a => a.kind === 'image') ?? out.assets?.[0]
  // A video chained to this still (Make the week) never waits on a still
  // that did not come.
  if (out.status !== 'completed' || !asset || !job.characterId) { await cancelChildren(deps, job.id, 'The still it was waiting for did not finish.'); return }
  const postId = job.purpose.split(':')[1]!
  const id = newId('cand')
  await deps.db.insert(candidates).values({ id, accountId: job.accountId, characterId: job.characterId, jobId: job.id, createdBy: job.userId, prompt: (job.request as GenRequest).prompt ?? '', target: 'scene', sceneId: null, op: 'generate', status: 'approved', assetId: asset.id, label: 'Faceless still', meta: { faceless: postId } })
  await setPostField(deps, ctx, postId, { stillId: id }, { stillAssetId: asset.id })
  await activateChained(deps, job.id, asset.id, id)
}
async function onFacelessVideo(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const asset = out.assets?.find(a => a.kind === 'video') ?? out.assets?.[0]
  if (out.status !== 'completed' || !asset || !job.characterId) return
  const postId = job.purpose.split(':')[1]!
  const id = newId('cand')
  await deps.db.insert(candidates).values({ id, accountId: job.accountId, characterId: job.characterId, jobId: job.id, createdBy: job.userId, prompt: (job.request as GenRequest).prompt ?? '', target: 'scene', sceneId: null, op: 'video', status: 'approved', assetId: asset.id, label: 'Faceless video', meta: { faceless: postId } })
  await setPostField(deps, ctx, postId, { clipId: id }, { clipAssetId: asset.id })
}

// fields: the video post's own (stillId, clipId); faceless: merged into its
// faceless fields (the still's and take's files, for the card and the page).
export async function setPostField(deps: Deps, ctx: Ctx, postId: string, fields: Record<string, unknown>, faceless: Record<string, unknown> = {}): Promise<void> {
  await deps.db.transaction(async tx => {
    const [row] = await tx.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, postId))).for('update')
    if (!row || row.archivedAt) return
    const spec = row.spec as { faceless?: Record<string, unknown> | null }
    await tx.update(contentItems).set({ spec: { ...spec, ...fields, faceless: { ...(spec.faceless ?? {}), ...faceless } }, updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id))
  })
}

// An uploaded or pulled still (a plan row's still_job_id or still_url, or
// a picture from the Library): kept as the post's still.
export async function useStillAsset(deps: Deps, ctx: Ctx, postId: string, assetId: string, label = 'Imported still'): Promise<string> {
  const row = await getContent(deps, ctx, postId)
  const id = newId('cand')
  await deps.db.insert(candidates).values({ id, accountId: ctx.accountId, characterId: row.characterId!, createdBy: ctx.userId, prompt: '', target: 'scene', sceneId: null, op: 'upload_image', status: 'approved', assetId, label, meta: { faceless: postId } })
  await setPostField(deps, ctx, postId, { stillId: id }, { stillAssetId: assetId })
  return id
}

let registered = false
export function registerFaceless(): void {
  if (registered) return
  registered = true
  registerJobHook('faceless_still', onFacelessStill)
  registerJobHook('faceless_video', onFacelessVideo)
}
