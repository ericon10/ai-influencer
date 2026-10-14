import { and, eq } from 'drizzle-orm'
import type { Ctx, Deps } from '../context.js'
import type { ModelEntry } from '../config/load.js'
import { fill, hardWrap, normalizePrompt } from '../core/text.js'
import { blocking, lintPrompt, type RuleViolation } from '../core/rules.js'
import { identityForModel } from '../core/identity.js'
import { pronounVars } from '../core/prompts.js'
import type { RealismWarning } from '../core/realism.js'
import {
  aspectFor, assembleAsWritten, assembleStillPrompt, buildEditPrompt, buildScenePrompt, comboConflict, comboEntryFor, mockSceneIdeas, oneChangeProblem, plannerRules,
  sceneIdeasJsonSchema, scenePlanJsonSchema, scenePlanPrompt, skinFor, videoWriterFacts, writerFacts, type ReferenceMode, type SceneFields,
} from '../core/scenes.js'
import { assembleVideoPrompt, mockDirectorNotes, mockWrittenPrompt, promptWriterSchema, scenePrompts, type PromptTarget } from '../core/promptWriter.js'
import { sha256Hex } from '../lib/passwords.js'
import { ruleSwitches } from './rules.js'
import { idealObservation } from '../core/qa/ideal.js'
import { observationJsonSchema } from '../core/qa/perception.js'
import { isVideoOp } from '../core/clips.js'
import { AppError } from '../lib/errors.js'
import { quoteItemsFor, type JobSpec } from '../jobs/runner.js'
import { displayPrice } from '../costs/quotes.js'
import type { GenRequest } from '../providers/types.js'
import { listCredentials } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { forMode, providerMode, resolveRoute } from './settings.js'
import { approvedAssets, getCandidate, toData, type CharacterRow } from './characters.js'
import { comboEntries, comboProblem, getScene, sceneFields, sceneRefs, videoModel, type SceneRef } from './scenes.js'
import { assertFace } from './videoAssets.js'
import { getAsset } from '../storage/assets.js'
import { assets } from '../db/schema.js'

// Paid steps for scenes (Stage 7) and still edits (Stage 8). Each returns the
// job specs for the estimate and the run (one builder for both, so the run
// matches its quote), plus the prompts to preview, hard-wrapped.

export interface SceneBuilt {
  purpose: string
  specs: JobSpec[]
  preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: RuleViolation[]; invalidates: string[] }
  // A later step whose price is shown with this one (a video take shows what
  // "Upscale this take" will cost). Quoted for display only, never run here.
  followUp?: { label: string; specs: JobSpec[] }
}

type Ch = ReturnType<typeof toData>

// Placeholder for the image a parent job will make; swapped in when the
// parent finishes (the quote already covers the child).
export const PARENT_OUTPUT = 'parent-output'

const dedupe = (list: RealismWarning[]): RuleViolation[] => {
  const seen = new Map<string, RuleViolation>()
  for (const w of list) if (!seen.has(`${w.ruleId}|${w.match}`)) seen.set(`${w.ruleId}|${w.match}`, w)
  return [...seen.values()]
}

export function lintOrThrow(violations: RuleViolation[], label: string): RuleViolation[] {
  const errors = blocking(violations)
  if (errors.length) throw new AppError('prompt_rejected', `${label}: ${errors.map(e => `${e.title} (SPEC ${e.spec})`).join('; ')}`, errors)
  return violations.filter(v => v.severity === 'warning')
}

function modelEntry(deps: Deps, ref: string): ModelEntry {
  const m = deps.config.models.models.find(x => x.ref === ref)
  if (!m) throw new AppError('bad_request', `Unknown model "${ref}".`)
  return m
}

// The model that runs (the mock in demo mode) and the Higgsfield billing
// path. A model the API does not offer runs on the owner's account, which
// must be connected (DECISIONS E5).
export async function runModel(deps: Deps, ctx: Ctx, model: string, kind: GenRequest['kind']): Promise<{ model: string; billing?: 'account' }> {
  const live = (await providerMode(deps.db, ctx.accountId)) === 'live'
  if (!live) return { model: (await forMode(deps, ctx, { model, kind })).model }
  const entry = modelEntry(deps, model)
  if (entry.api === false) {
    const connected = (await listCredentials(deps.db, ctx.accountId)).some(c => c.provider === ACCOUNT_PROVIDER)
    if (!connected) throw new AppError('bad_request', `${entry.label} runs only through your Higgsfield account. Connect it in Settings, Connected accounts, or pick another model.`)
    return { model, billing: 'account' }
  }
  return { model }
}

const QA_SIZE: Record<string, { width: number; height: number }> = {
  '9:16': { width: 882, height: 1568 }, '4:5': { width: 1254, height: 1568 }, '1:1': { width: 1568, height: 1568 }, '3:4': { width: 1176, height: 1568 },
}

const FRAMING_SEEN: Record<string, 'chest_up' | 'waist_up' | 'three_quarter_length' | 'full_body'> = {
  chest_up: 'chest_up', waist_up: 'waist_up', knees_up: 'three_quarter_length', full_body: 'full_body', wide_small: 'full_body',
}

function qaHints(ch: Ch, f: SceneFields): string {
  const jewelry = ch.marks.filter(m => m.kind === 'jewelry').map(m => `jewelry on either ear such as a ${m.description}`)
  const skin = ch.marks.filter(m => m.kind === 'skin').map(m => `skin marks near either ${m.region} such as a ${m.description}`)
  const asked = f.jewelry ? [`any other jewelry (the scene asked for: ${f.jewelry})`] : ['any other jewelry']
  return [...jewelry, ...skin, ...asked, 'logos or readable text on clothes, shoes, cups, bags and signs', 'hands and fingers'].join('; ')
}

// Perception QA for a scene still: the image as is, and a mirrored copy to
// catch a model mixing up image left and right.
export async function sceneQaSpecs(deps: Deps, ctx: Ctx, ch: Ch, f: SceneFields, opts: { sceneId: string; parentIndex?: number; assetId?: string; group?: string; candidateId?: string; faceRefs: Array<{ refId: string; assetId: string }>; label: string }): Promise<JobSpec[]> {
  const route = await resolveRoute(deps, ctx, 'qa_perception')
  const t = deps.config.pipeline.templates.qa_perception
  const passes: Array<'orig' | 'mirror'> = deps.config.pipeline.review.qa.mirror_consistency ? ['orig', 'mirror'] : ['orig']
  const aspect = aspectFor(deps.config.pipeline.scenes, f)
  const ideal = idealObservation({ view: f.view, framing: FRAMING_SEEN[f.framing] as never }, deps.config.pipeline.views, ch.marks, ch.eyes)
  const flip = <T extends string>(s: T) => (s === 'image_left' ? 'image_right' : s === 'image_right' ? 'image_left' : s) as T
  const mirrored = { ...ideal, nose: flip(ideal.nose), ears: ideal.ears.map(e => ({ ...e, image_side: flip(e.image_side) })), skin_marks: ideal.skin_marks.map(m => ({ ...m, image_side: flip(m.image_side) })) }
  return passes.map(pass => ({
    type: 'llm' as const,
    stage: 'qa',
    purpose: `scene_qa:${opts.sceneId}`,
    label: pass === 'orig' ? `QA check, ${opts.label}` : `QA mirror check, ${opts.label}`,
    parentIndex: opts.parentIndex,
    request: {
      model: route.model,
      system: t.system,
      prompt: fill(t.prompt, { hints: qaHints(ch, f) }),
      schema: observationJsonSchema,
      schemaName: 'qa_perception',
      maxTokens: 3000,
      effort: route.effort ?? 'medium',
      imageAssetIds: opts.assetId ? [opts.assetId] : [],
      mirrorImages: pass === 'mirror',
      estimateImages: opts.assetId ? undefined : [QA_SIZE[aspect] ?? QA_SIZE['9:16']!],
      meta: {
        sceneId: opts.sceneId, pass, group: opts.group, candidateId: opts.candidateId, faceRefs: opts.faceRefs, framing: f.framing,
        mockObservation: pass === 'orig' ? ideal : mirrored,
      },
    },
  }))
}

function sceneLabel(row: { title: string }, f: SceneFields): string {
  return row.title || f.title || 'Scene'
}

// ── Plan: Claude fills the fields from the owner's words ────────────

function mockPlan(deps: Deps, ch: Ch, brief: string): SceneFields {
  const sc = deps.config.pipeline.scenes
  const { momentType, camera } = sc.settings.defaults
  const words = brief.trim().replace(/[.!?]+$/, '')
  return {
    title: words.split(/\s+/).slice(0, 4).join(' ') || 'Everyday moment',
    momentType, camera,
    moment: `${ch.name} ${words ? words.charAt(0).toLowerCase() + words.slice(1) : 'walks to a neighborhood cafe'}`,
    task: 'carrying an iced coffee and checking the street signs',
    trigger: `a friend calling ${ch.pronouns.poss} name from behind`,
    distance: 'about 2 metres',
    phone: 'rear',
    setting: 'A sunny neighborhood street with a few people in the background',
    location: 'Neighborhood street',
    outfit: 'a white cotton tee tucked into light-wash straight jeans',
    footwear: 'clean white sneakers',
    jewelry: '',
    makeup: 'natural',
    hair: ch.style.hair_options?.[0] ?? 'as usual',
    pose: 'mid-step, glancing to the side',
    view: 'three_quarter_left',
    expression: 'soft_smile',
    foreground: '',
    height: 'eye_level',
    framing: 'waist_up',
    light: 'morning',
    destination: 'vertical',
    brands: false,
    refs: [], asWritten: false,
  }
}

// "Punch it up": a rough idea becomes three specific moments to pick from.
// The answer stays on the job; the owner's pick fills the scene box.
export async function buildSceneIdeas(deps: Deps, ctx: Ctx, row: CharacterRow, idea: string): Promise<SceneBuilt> {
  const ch = toData(row)
  const t = deps.config.pipeline.templates
  const route = await resolveRoute(deps, ctx, 'scene_ideas')
  const pv = pronounVars(ch.pronouns)
  const system = fill(t.scene_ideas.system, { ...pv, name: ch.name, look: ch.card.trim() || 'not given' })
  const prompt = fill(t.scene_ideas.prompt, {
    ...pv, name: ch.name, idea: idea.trim(),
    vibe: ch.persona.vibe ?? 'not given',
    settings: ch.persona.settings?.length ? ch.persona.settings.join('; ') : 'none given',
  })
  return {
    purpose: 'scene_ideas',
    preview: { title: 'Punch it up', prompts: [{ label: 'Three moment options', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [{
      type: 'llm', stage: 'scene', purpose: 'scene_ideas', label: 'Punch it up: three moment options',
      request: {
        model: route.model, system, prompt, schema: sceneIdeasJsonSchema(), schemaName: 'scene_ideas',
        maxTokens: 1500, effort: route.effort ?? 'low', meta: { mockIdeas: mockSceneIdeas(ch.name, idea, pv.poss ?? 'her') },
      },
    }],
  }
}

export async function buildScenePlan(deps: Deps, ctx: Ctx, row: CharacterRow, sceneId: string): Promise<SceneBuilt> {
  const scene = await getScene(deps, ctx, sceneId)
  if (scene.characterId !== row.id) throw new AppError('bad_request', 'That scene belongs to another character.')
  if (!scene.brief.trim()) throw new AppError('bad_request', 'Describe the moment first, in your own words.')
  const ch = toData(row)
  const { templates, scenes: sc, views, rules } = deps.config.pipeline
  const sw = await ruleSwitches(deps, ctx, row.id)
  const brands = (scene.fields as { brands?: boolean }).brands === true
  const route = await resolveRoute(deps, ctx, 'scene_plan')
  const combos = sw.on('scene-combo-log') ? comboEntries(ch).slice(-sc.settings.combo_window) : []
  const prompt = scenePlanPrompt(templates, sc, views, ch, scene.brief, combos, { persona: sw.on('scene-persona-never') })
  const system = fill(templates.scene_plan.system, { rules: plannerRules(rules, id => sw.on(id), brands) })
  return {
    purpose: `scene_plan:${scene.id}`,
    preview: { title: 'Plan the scene', prompts: [{ label: 'Scene plan', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [{
      type: 'llm', stage: 'scene', purpose: `scene_plan:${scene.id}`, label: 'Plan the scene from your words',
      request: {
        model: route.model, system, prompt, schema: scenePlanJsonSchema(sc, views), schemaName: 'scene_plan',
        maxTokens: 3000, effort: route.effort ?? 'medium', meta: { sceneId: scene.id, mockPlan: mockPlan(deps, ch, scene.brief) },
      },
    }],
  }
}

// ── The prompt writer: Claude writes the final prompt (default rule) ──

// What a still prompt was written from; a change to it is pointed out.
export function stillBasis(deps: Deps, ch: Ch, f: SceneFields): string {
  const { templates, scenes: sc, views } = deps.config.pipeline
  return sha256Hex(writerFacts(templates, sc, views, f, ch))
}

export interface PromptWriteInput { sceneId: string; target: PromptTarget; motion?: string; directions?: string; startCandidateId?: string; endCandidateId?: string; notes?: string; durationSec?: number; audio?: boolean; aspect?: string }

export async function buildScenePromptWrite(deps: Deps, ctx: Ctx, row: CharacterRow, input: PromptWriteInput): Promise<SceneBuilt> {
  const scene = await getScene(deps, ctx, input.sceneId)
  if (scene.characterId !== row.id) throw new AppError('bad_request', 'That scene belongs to another character.')
  const ch = toData(row)
  const f = sceneFields(deps, scene)
  const { templates: t, scenes: sc, views } = deps.config.pipeline
  const route = await resolveRoute(deps, ctx, 'prompt_writer')
  const pv = pronounVars(ch.pronouns)
  const purpose = `scene_prompt:${scene.id}:${input.target}`
  const label = sceneLabel(scene, f)
  // The director's pass (default rule scene-directors-pass): the writer
  // decides what makes the shot memorable and returns it as notes; notes the
  // owner set are followed as given.
  const sw = await ruleSwitches(deps, ctx, row.id)
  const directors = sw.on('scene-directors-pass')
  const notes = directors ? (input.notes ?? '').trim().slice(0, 600) : ''
  const pass = !directors ? '' : [
    fill(input.target === 'still' ? t.prompt_writer.directors_still : t.prompt_writer.directors_video, { name: ch.name }),
    notes ? fill(t.prompt_writer.notes_given, { notes }) : '',
  ].filter(Boolean).join('\n')
  const directorsMeta = directors ? { directors: true, mockNotes: notes || mockDirectorNotes(input.target), ...(notes ? { notes } : {}) } : {}
  const llm = (system: string, prompt: string, extra: { imageAssetIds?: string[]; meta: Record<string, unknown> }): SceneBuilt => ({
    purpose,
    preview: { title: input.target === 'still' ? 'Write the prompt' : 'Write the video prompt', prompts: [{ label: 'Prompt writer', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [{
      type: 'llm', stage: 'scene', purpose, label: `${input.target === 'still' ? 'Write the prompt' : 'Write the video prompt'}, ${label}`,
      request: {
        model: route.model, system, prompt, schema: promptWriterSchema(directors), schemaName: 'scene_prompt', maxTokens: 1600, effort: route.effort ?? 'medium',
        ...(extra.imageAssetIds?.length ? { imageAssetIds: extra.imageAssetIds } : {}),
        meta: { sceneId: scene.id, target: input.target, ...directorsMeta, ...extra.meta },
      },
    }],
  })
  if (input.target === 'still') {
    const range = sc.settings.prompt_words.still
    const facts = writerFacts(t, sc, views, f, ch)
    const system = fill(t.prompt_writer.still_system, { ...pv, name: ch.name, min: String(range[0]), max: String(range[1]), directors_pass: pass })
    const prompt = fill(t.prompt_writer.still_prompt, { name: ch.name, facts })
    return llm(system, prompt, { meta: { basis: sha256Hex(facts), mockPrompt: mockWrittenPrompt('still', { facts }, range) } })
  }
  // A video prompt: what happens, from the start frame (Claude sees it).
  const motion = (input.motion ?? '').trim()
  if (motion.length < 3) throw new AppError('invalid_request', 'Say what happens in the clip first.')
  const start = input.startCandidateId ? await getCandidate(deps, ctx, input.startCandidateId) : null
  if (start && (start.sceneId !== scene.id || !start.assetId || isVideoCandidate(start))) throw new AppError('bad_request', 'The start frame must be a still from this scene.')
  const directions = (input.directions ?? sc.video.directions).trim()
  // The guide's labeled lines (owner, 2026-10-13). The start frame shows the
  // place and the look, so the writer gets the idea and only the scene's
  // task, trigger, camera and light; the Studio writes FORMAT (9:16 by
  // default) and AUDIO (sound off unless turned on) itself.
  const range = sc.settings.prompt_words.video
  const system = fill(t.prompt_writer.video_system, { ...pv, name: ch.name, min: String(range[0]), max: String(range[1]), directions, end_frame: input.endCandidateId ? t.prompt_writer.end_frame : '', directors_pass: pass })
  let facts = videoWriterFacts(t, sc, views, f, ch)
  // Chaining: a start frame taken from a kept clip continues that shot.
  if (start?.op === 'last_frame' && start.parentId) {
    const previous = await getCandidate(deps, ctx, start.parentId).catch(() => null)
    const text = ((previous?.meta as { lastPrompt?: string } | null)?.lastPrompt || previous?.prompt || 'not known').replace(/\s+/g, ' ').slice(0, 1500)
    facts = `${facts}\n${fill(t.prompt_writer.continue_facts, { previous: text }).trim()}`
  }
  const prompt = fill(t.prompt_writer.video_prompt, { motion, facts })
  const format = fill(t.prompt_writer.video_format, { duration: String(input.durationSec ?? sc.video.duration), aspect: input.aspect ?? sc.video.aspect })
  const audio = input.audio ? t.prompt_writer.video_audio_on : t.prompt_writer.video_audio_off
  return llm(system, prompt, { imageAssetIds: start?.assetId ? [start.assetId] : [], meta: { motion, directions, format, audioLine: audio, mockPrompt: mockWrittenPrompt('video', { motion, name: ch.name, subj: ch.pronouns.subj, poss: ch.pronouns.poss, format, audio }, range) } })
}

// ── Generate: stills for one scene, on one or two models ────────────

// The still prompt for one scene model, from a written text: the Studio adds
// the reference line, the wearing and mark sides, and the REALISM block.
// Used when "Write and generate" hands its written text to the stills.
export async function writtenStillPrompt(deps: Deps, ctx: Ctx, row: CharacterRow, sceneId: string, sceneModel: string, text: string, reason?: string): Promise<string> {
  const scene = await getScene(deps, ctx, sceneId)
  const ch = toData(row)
  const f = sceneFields(deps, scene)
  const { templates, scenes: sc, views, review } = deps.config.pipeline
  const sw = await ruleSwitches(deps, ctx, row.id)
  const entry = modelEntry(deps, sceneModel)
  const identity = identityForModel(ch.identities, sceneModel)
  const mode: ReferenceMode = entry.max_refs > 0 ? 'refs' : identity ? 'trained' : 'text'
  const reasonAction = reason ? review.reasons.find(r => r.id === reason)?.action : undefined
  const addendum = reasonAction ? review.actions[reasonAction]?.prompt_addendum ?? '' : ''
  const sceneRules = { outfitOverride: sw.on('scene-outfit-override'), brandFree: sw.on('scene-brand-free'), colors: sw.on('scene-colors'), referenceLine: sw.on('scene-reference-slot') }
  return assembleStillPrompt(templates, sc, views, f, ch, mode, text, { identityBlock: identity?.promptBlock, warnings: [], addendum, rules: sceneRules, flawDose: sw.on('realism-flaw-dose') })
}

export async function buildSceneRun(deps: Deps, ctx: Ctx, row: CharacterRow, input: { sceneId: string; models: string[]; variations: number; reason?: string; withQa: boolean; allowRepeat?: boolean; write?: boolean; level?: string }): Promise<SceneBuilt> {
  const scene = await getScene(deps, ctx, input.sceneId)
  if (scene.characterId !== row.id) throw new AppError('bad_request', 'That scene belongs to another character.')
  const ch = toData(row)
  const f = sceneFields(deps, scene)
  const { templates, scenes: sc, views, rules, review } = deps.config.pipeline
  const sw = await ruleSwitches(deps, ctx, row.id)
  let warnings: RuleViolation[] = []
  // Default rule scene-combo-log (off unless switched on): a repeat is a note,
  // never a block. A rerun of a logged scene is not a repeat.
  if (!scene.comboLoggedAt && !input.allowRepeat && sw.on('scene-combo-log')) {
    const combo = comboProblem(deps, ch, f)
    if (combo) warnings.push({ ruleId: 'scene-combo-log', spec: '5.2.21', title: 'Repeats a recent combo', severity: 'warning', message: combo })
  }
  const models = [...new Set(input.models)]
  if (!models.length) throw new AppError('bad_request', 'Pick a model.')
  if (models.length > sc.settings.max_models) throw new AppError('bad_request', `Compare at most ${sc.settings.max_models} models in one run.`)
  for (const m of models) if (!sc.settings.still_models.includes(m)) throw new AppError('bad_request', `${m} is not offered for scene stills.`)
  if (!Number.isInteger(input.variations) || input.variations < 1 || input.variations > sc.settings.max_variations) {
    throw new AppError('bad_request', `Run 1 to ${sc.settings.max_variations} stills per model.`)
  }
  const refs = await sceneRefs(deps, ctx, row.id, f, sw.on('scene-refs-by-angle'))
  if (!refs.length) throw new AppError('bad_request', 'Approve REF-00 first: scenes attach the sheet so the face holds.')
  const aspect = aspectFor(sc, f)
  const reasonAction = input.reason ? review.reasons.find(r => r.id === input.reason)?.action : undefined
  const addendum = reasonAction ? review.actions[reasonAction]?.prompt_addendum ?? '' : ''
  const label = sceneLabel(scene, f)
  const specs: JobSpec[] = []
  const prompts: SceneBuilt['preview']['prompts'] = []
  const realism: RealismWarning[] = []
  const sceneRules = { outfitOverride: sw.on('scene-outfit-override'), brandFree: sw.on('scene-brand-free'), colors: sw.on('scene-colors'), referenceLine: sw.on('scene-reference-slot') }
  // Default rule scene-prompt-writer: the written prompt (Claude's, or the
  // owner's edit) is the scene text; the Studio adds its own lines and the
  // REALISM block per model. Without one, the template builds it.
  // A pasted prompt goes as written (owner, 2026-10-14): no writer, no
  // template lines, only the fixed blocks around the owner's text.
  const asWritten = f.asWritten ? (scene.brief.trim() || f.moment) : null
  const written = sw.on('scene-prompt-writer') && !input.write && !asWritten ? scenePrompts(scene.prompts).still : undefined
  // "Write and generate": the writer runs first; every still waits for it
  // and takes its text (until then each holds the template prompt, which is
  // what the quote and the checks below see).
  // Notes the owner set on the still prompt are followed by the writer.
  const ownNotes = scenePrompts(scene.prompts).still
  const writer = input.write && !asWritten ? (await buildScenePromptWrite(deps, ctx, row, { sceneId: scene.id, target: 'still', ...(ownNotes?.notesBy === 'owner' && ownNotes.notes ? { notes: ownNotes.notes } : {}) })).specs[0]! : null
  if (writer) specs.push(writer)
  // Standard by default (scenes.yaml still_levels), High on request.
  const level = sc.settings.still_levels[input.level ?? sc.settings.still_level] ?? { quality: sc.settings.quality, resolution: sc.settings.resolution }
  if (sw.on('scene-prompt-writer') && !written && !input.write && !asWritten) {
    warnings.push({ ruleId: 'scene-prompt-writer', spec: '9', title: 'No written prompt yet', severity: 'warning', message: 'This run uses the template prompt. Write the prompt above Generate to use natural sentences instead.' })
  }
  for (const model of models) {
    const entry = modelEntry(deps, model)
    const identity = identityForModel(ch.identities, model)
    // SPEC 5.2 rule 14: refs for an edit model, the saved character for a
    // trained one, the full card otherwise.
    const mode: ReferenceMode = entry.max_refs > 0 ? 'refs' : identity ? 'trained' : 'text'
    const o = { identityBlock: identity?.promptBlock, warnings: realism, addendum, rules: sceneRules, flawDose: sw.on('realism-flaw-dose') }
    const prompt = asWritten ? assembleAsWritten(templates, sc, f, ch, mode, asWritten, o)
      : written ? assembleStillPrompt(templates, sc, views, f, ch, mode, written.text, o) : buildScenePrompt(templates, sc, views, f, ch, mode, o)
    const kind: GenRequest['kind'] = mode === 'refs' ? 'image_edit' : 'image'
    const run = await runModel(deps, ctx, model, kind)
    const attached = mode === 'refs' ? refs.slice(0, Math.max(1, entry.max_refs)) : []
    prompts.push({ label: `${entry.label} prompt`, text: prompt, wrapped: hardWrap(prompt) })
    for (let v = 0; v < input.variations; v++) {
      const request: GenRequest = {
        kind, model: run.model, modelRef: model, prompt, aspect, quality: level.quality, resolution: level.resolution, seed: v + 1,
        ...(attached.length ? { refs: attached.map(r => ({ assetId: r.assetId })) } : {}),
        ...(mode === 'trained' && identity ? { identityId: identity.externalId } : {}),
        ...(run.billing ? { billing: run.billing } : {}),
      }
      // A scene that allows brands is not asked to be unbranded.
      const lintSwitches = f.brands ? { on: (id: string) => id !== 'scene-brand-free' && sw.on(id), value: sw.value } : sw
      warnings.push(...lintOrThrow(lintPrompt(rules, prompt, {
        stage: 'scene', framing: f.framing, kind, request: { ...request, model }, marks: ch.marks, identityBlock: identity?.promptBlock, switches: lintSwitches,
      }), `${entry.label} scene prompt`))
      const genIndex = specs.length
      const what = `${label}, ${entry.label}${input.variations > 1 ? `, still ${v + 1}` : ''}`
      specs.push(writer
        ? { type: 'gen', stage: 'scene', purpose: `scene:${scene.id}`, label: what, request: { ...request, promptFrom: { sceneModel: model, ...(input.reason ? { reason: input.reason } : {}) } }, parentIndex: 0 }
        : { type: 'gen', stage: 'scene', purpose: `scene:${scene.id}`, label: what, request })
      let qaParent = genIndex
      // Face match against the face and closest-angle refs (SPEC 6).
      const faceRefs = refs.filter(r => r.role !== 'body').map(r => ({ refId: r.refId, assetId: r.assetId }))
      // DECISIONS D3: after a still from a trained character, a face-only
      // pass locks the face to REF-00 and the closest-angle ref.
      if (mode === 'trained' && identity?.followUp && sw.on('scene-drift-lock')) {
        const lock = await driftLockSpec(deps, ctx, ch, refs, identity.followUp, { sceneId: scene.id, parentIndex: genIndex, label: what, aspect })
        specs.push(lock.spec)
        qaParent = specs.length - 1
        prompts.push({ label: `${identity.followUp.name} prompt`, text: lock.spec.request.prompt, wrapped: hardWrap(lock.spec.request.prompt) })
      }
      if (input.withQa) specs.push(...await sceneQaSpecs(deps, ctx, ch, f, { sceneId: scene.id, parentIndex: qaParent, faceRefs, label: what }))
    }
  }
  const count = `${models.length > 1 ? `${models.length} models x ` : ''}${input.variations} still${input.variations > 1 ? 's' : ''}`
  if (writer) {
    const ask = writer.request as { system: string; prompt: string }
    return {
      purpose: `scene:${scene.id}`, specs,
      preview: {
        title: `${label}: write the prompt, then ${count}`,
        prompts: [{ label: 'Prompt writer', text: `${ask.system}\n${ask.prompt}`, wrapped: hardWrap(`${ask.system}\n${ask.prompt}`) }],
        warnings: [...dedupe(realism), ...warnings],
        invalidates: [],
      },
    }
  }
  return {
    purpose: `scene:${scene.id}`, specs,
    preview: { title: `${label}: ${count}`, prompts, warnings: [...dedupe(realism), ...warnings], invalidates: [] },
  }
}

async function driftLockSpec(deps: Deps, ctx: Ctx, ch: Ch, refs: SceneRef[], followUp: NonNullable<Ch['identities'][number]['followUp']>, o: { sceneId: string; parentIndex: number; label: string; aspect: string }) {
  const { templates, scenes: sc, rules } = deps.config.pipeline
  const model = followUp.model ?? sc.settings.edit_models[0]!
  const run = await runModel(deps, ctx, model, 'image_edit')
  const face = refs.filter(r => r.role === 'face' || r.role === 'angle').slice(0, 2)
  const change = fill(sc.edits.drift_lock, pronounVars(ch.pronouns))
  const prompt = buildEditPrompt(templates, change, ch, false)
  const request: GenRequest = {
    kind: 'image_edit', model: run.model, prompt, aspect: o.aspect, quality: sc.settings.quality, resolution: sc.settings.resolution,
    refs: [{ assetId: PARENT_OUTPUT }, ...face.map(r => ({ assetId: r.assetId }))],
    ...(run.billing ? { billing: run.billing } : {}),
  }
  lintOrThrow(lintPrompt(rules, prompt, { stage: 'edit', kind: 'image_edit', request: { ...request, model } }), followUp.name)
  return { spec: { type: 'gen' as const, stage: 'edit', purpose: `drift_lock:${o.sceneId}`, label: `${followUp.name}, ${o.label}`, request, parentIndex: o.parentIndex } }
}

// ── One-change edit (SPEC 5.3) ──────────────────────────────────────

export async function buildSceneEdit(deps: Deps, ctx: Ctx, row: CharacterRow, input: { candidateId: string; change: string; face: boolean; model?: string; withQa: boolean }): Promise<SceneBuilt> {
  const cand = await getCandidate(deps, ctx, input.candidateId)
  if (cand.characterId !== row.id || !cand.sceneId || !cand.assetId) throw new AppError('bad_request', 'Pick a scene still to edit.')
  if (input.change.trim().length < 3) throw new AppError('invalid_request', 'Say what to change.')
  const sw = await ruleSwitches(deps, ctx, row.id)
  const advice: RuleViolation[] = []
  // Defaults, never blocks: face drift is usually a regenerate (rule 25),
  // and one change per pass works best (rule 24).
  const report = cand.qaReport as { findings?: Array<{ code: string; severity: string }> } | null
  if (sw.on('qa-face-drift') && report?.findings?.some(f => f.severity === 'fail' && f.code === 'face_drift')) {
    advice.push({ ruleId: 'qa-face-drift', spec: '5.3.25', title: 'Face drift is usually a regenerate', severity: 'warning', message: 'QA found the face does not match REF-00. An edit rarely fixes a face; regenerating with the closest-angle refs usually does. Running anyway.' })
  }
  const problem = sw.on('edit-one-change') ? oneChangeProblem(input.change) : null
  if (problem) advice.push({ ruleId: 'edit-one-change', spec: '5.3.24', title: 'More than one change', severity: 'warning', message: `${problem} Running anyway.` })
  const scene = await getScene(deps, ctx, cand.sceneId)
  const f = sceneFields(deps, scene)
  const ch = toData(row)
  const { templates, scenes: sc, rules } = deps.config.pipeline
  const model = input.model ?? (sc.settings.edit_models.includes(ch.preferredModels.edit ?? '') ? ch.preferredModels.edit! : sc.settings.edit_models[0]!)
  if (!sc.settings.edit_models.includes(model)) throw new AppError('bad_request', `${model} is not offered for edits.`)
  const run = await runModel(deps, ctx, model, 'image_edit')
  const ref00 = (await approvedAssets(deps, ctx, row.id)).get('REF-00')
  if (input.face && !ref00) throw new AppError('bad_request', 'A face edit attaches REF-00. Approve REF-00 first.')
  const realism: RealismWarning[] = []
  const prompt = buildEditPrompt(templates, input.change, ch, input.face, { warnings: realism, flawDose: sw.on('realism-flaw-dose'), skin: skinFor(sc, f.framing) })
  const request: GenRequest = {
    kind: 'image_edit', model: run.model, prompt, aspect: aspectFor(sc, f), quality: sc.settings.quality, resolution: sc.settings.resolution,
    refs: [{ assetId: cand.assetId }, ...(input.face && ref00 ? [{ assetId: ref00 }] : [])],
    ...(run.billing ? { billing: run.billing } : {}),
  }
  const warnings = [...advice, ...lintOrThrow(lintPrompt(rules, prompt, { stage: 'edit', kind: 'image_edit', request: { ...request, model }, switches: sw }), 'Edit')]
  const label = `${sceneLabel(scene, f)}, edit`
  const specs: JobSpec[] = [{ type: 'gen', stage: 'edit', purpose: `scene_edit:${scene.id}:${cand.id}`, label: `One-change edit: ${input.change.trim().slice(0, 60)}`, request }]
  if (input.withQa) specs.push(...await sceneQaSpecs(deps, ctx, ch, f, { sceneId: scene.id, parentIndex: 0, faceRefs: ref00 ? [{ refId: 'REF-00', assetId: ref00 }] : [], label }))
  return {
    purpose: `scene_edit:${scene.id}`, specs,
    preview: { title: 'One-change edit', prompts: [{ label: 'Edit prompt', text: prompt, wrapped: hardWrap(prompt) }], warnings: [...dedupe(realism), ...warnings], invalidates: [] },
  }
}

// ── Upscale a crop (Callie's scene rules: an upscaler, never Nano Banana) ──

export async function buildSceneUpscale(deps: Deps, ctx: Ctx, row: CharacterRow, candidateId: string): Promise<SceneBuilt> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.characterId !== row.id || !cand.sceneId || !cand.assetId) throw new AppError('bad_request', 'Pick a scene still to upscale.')
  const { scenes: sc, rules } = deps.config.pipeline
  const run = await runModel(deps, ctx, sc.settings.upscale_model, 'upscale')
  const request: GenRequest = { kind: 'upscale', model: run.model, prompt: 'Upscale 2x, keep every detail identical.', refs: [{ assetId: cand.assetId }], scale: 2, ...(run.billing ? { billing: run.billing } : {}) }
  lintOrThrow(lintPrompt(rules, request.prompt, { kind: 'upscale', request, switches: await ruleSwitches(deps, ctx, row.id) }), 'Upscale')
  return {
    purpose: `scene_upscale:${cand.sceneId}`,
    specs: [{ type: 'gen', stage: 'edit', purpose: `scene_upscale:${cand.sceneId}:${cand.id}`, label: 'Upscale 2x', request }],
    preview: { title: 'Upscale 2x', prompts: [], warnings: [], invalidates: [] },
  }
}

// ── Video from a picked still (Stage 9, owner ruling 2026-10-13) ────────
// Straight to the picked model (Kling 3.0 Pro by default, DECISIONS G11),
// one job per take; a quick motion test (Kling 3.0 Turbo, 5 s) is
// optional. Audio off, start frame plus an optional end frame, one
// continuous take, the owner's directions, the REALISM block. Each take is
// checked locally when it arrives (free).

const isVideoCandidate = (c: { op: string }) => isVideoOp(c.op)

export interface SceneVideoInput {
  candidateId: string
  endCandidateId?: string
  // One of scenes.yaml video.models; the account's last pick, else the default.
  model?: string
  motion: string
  directions: string
  durationSec: number
  aspect: string
  audio: boolean
  takes: number
  test: boolean
}

export async function buildSceneVideo(deps: Deps, ctx: Ctx, row: CharacterRow, input: SceneVideoInput): Promise<SceneBuilt> {
  const start = await getCandidate(deps, ctx, input.candidateId)
  if (start.characterId !== row.id || !start.sceneId || !start.assetId || isVideoCandidate(start)) throw new AppError('bad_request', 'Pick a still from this scene as the start frame.')
  const end = input.endCandidateId ? await getCandidate(deps, ctx, input.endCandidateId) : null
  if (end && (end.sceneId !== start.sceneId || !end.assetId || isVideoCandidate(end))) throw new AppError('bad_request', 'The end frame must be a still from the same scene.')
  const scene = await getScene(deps, ctx, start.sceneId)
  const { templates: t, scenes: sc, rules } = deps.config.pipeline
  const v = sc.video
  const sw = await ruleSwitches(deps, ctx, row.id)
  const wanted = input.model ?? (input.test ? v.model : await videoModel(deps, ctx))
  const picked = v.models.find(m => m.ref === wanted)
  if (!picked) throw new AppError('bad_request', `${input.model} is not offered for video. Pick one of the listed models.`)
  const model = input.test ? v.test.model : picked.ref
  const durationSec = input.test ? v.test.duration : input.durationSec
  const resolution = input.test ? v.test.resolution : picked.resolution
  const warnings: RuleViolation[] = []
  const entry = modelEntry(deps, model)
  const endFrame = end && (entry.params as { end_image?: boolean } | undefined)?.end_image !== false ? end : null
  if (end && !endFrame) warnings.push({ ruleId: 'video-single-take', spec: '4.3', title: 'Start frame only', severity: 'warning', message: `${entry.label} takes a start frame only, so the end frame is left out of this test.` })
  if (!input.test && !v.durations.includes(durationSec)) warnings.push({ ruleId: 'video-single-take', spec: '5.4.31', title: 'Unusual length', severity: 'warning', message: `${durationSec} s is not one of the usual lengths (${v.durations.join(' or ')} s). Running anyway.` })
  const run = await runModel(deps, ctx, model, 'video')
  // "What happens in the video" (owner, 2026-10-13: one box): the motion
  // Claude wrote when the still was used, or the owner's own words. The
  // directions, the silent line and the REALISM block are added after it.
  const motion = input.motion.trim().replace(/[.\s]+$/, '')
  if (motion.length < 3) throw new AppError('invalid_request', 'Say what happens in the video.')
  const ch = toData(row)
  // A take that starts from a kept clip's last frame continues that shot
  // (Phase 3 chaining): same place, light, wardrobe and camera.
  const directions = start.op === 'last_frame' ? `${t.video.continue} ${input.directions}`.trim() : input.directions
  const prompt = assembleVideoPrompt(t, `${motion}.`, { directions, audio: input.audio, realism: ch.realism?.block, skin: skinFor(sc, sceneFields(deps, scene).framing) })
  const request: GenRequest = {
    kind: 'video', model: run.model, modelRef: model, prompt, aspect: input.aspect, resolution, durationSec, audio: input.audio,
    startFrame: { assetId: start.assetId },
    ...(endFrame?.assetId ? { endFrame: { assetId: endFrame.assetId } } : {}),
    ...(run.billing ? { billing: run.billing } : {}),
  }
  warnings.push(...lintOrThrow(lintPrompt(rules, prompt, { stage: 'video', kind: 'video', request: { ...request, model }, switches: sw }), 'Video'))
  const takes = Math.max(1, Math.min(v.max_takes, Math.round(input.takes)))
  const label = input.test ? `${v.test.label} (${v.test.note.toLowerCase()})` : 'Video take'
  const specs: JobSpec[] = Array.from({ length: takes }, (_, i) => ({
    type: 'gen' as const, stage: 'video', purpose: `scene_video:${scene.id}:${start.id}${input.test ? ':test' : ''}`, label: takes > 1 ? `${label} ${i + 1}` : label, request,
  }))
  // What "Upscale this take" will cost later, per take (shown, never run here).
  // A video upscale is priced per second like video (the mock video in demo mode).
  const up = await runModel(deps, ctx, v.upscale.model, 'video')
  const followUp = input.test ? undefined : {
    label: 'Upscale this take, later, per take',
    specs: [{ type: 'gen' as const, stage: 'video', purpose: `scene_video_upscale:${scene.id}`, label: 'Upscale this take', request: { kind: 'upscale' as const, model: up.model, prompt: 'Upscale this take; keep every frame identical.', sourceVideo: { assetId: start.assetId }, durationSec, ...(up.billing ? { billing: up.billing } : {}) } }],
  }
  return {
    purpose: `scene_video:${scene.id}`, specs, followUp,
    preview: { title: input.test ? v.test.label : 'Video from the still', prompts: [{ label: 'Video prompt', text: prompt, wrapped: hardWrap(prompt) }], warnings, invalidates: [] },
  }
}

// The price of a take on each video model, for the picker (owner,
// 2026-10-13: "each with its price"). Estimates are free; the account path
// asks Higgsfield (saved for hours), the API path uses the price book.
export async function videoPrices(deps: Deps, ctx: Ctx, input: { durationSec: number; aspect: string }): Promise<Array<{ model: string; label: string; display: string | null; verified: boolean; note: string | null }>> {
  const v = deps.config.pipeline.scenes.video
  const durationSec = Math.max(2, Math.min(15, Math.round(input.durationSec)))
  return Promise.all(v.models.map(async m => {
    const entry = modelEntry(deps, m.ref)
    try {
      const run = await runModel(deps, ctx, m.ref, 'video')
      const request: GenRequest = { kind: 'video', model: run.model, prompt: 'price', aspect: input.aspect, resolution: m.resolution, durationSec, audio: false, ...(run.billing ? { billing: run.billing } : {}) }
      const [item] = await quoteItemsFor(deps, ctx, [{ type: 'gen', stage: 'video', purpose: 'video_price', label: entry.label, request }])
      const e = item!.estimate
      return { model: m.ref, label: entry.label, display: displayPrice([{ amountMicros: e.totalMicros, credits: e.credits ?? null }]), verified: e.verified, note: e.note ?? null }
    } catch (e) {
      return { model: m.ref, label: entry.label, display: null, verified: false, note: (e as Error).message }
    }
  }))
}

// "Upscale this take": the exact take, never re-rolled. The upscaled clip
// keeps its source; a smoothed result never replaces it.
export async function buildVideoUpscale(deps: Deps, ctx: Ctx, row: CharacterRow, candidateId: string): Promise<SceneBuilt> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.characterId !== row.id || !cand.sceneId || !cand.assetId || cand.op !== 'video') throw new AppError('bad_request', 'Pick a video take to upscale.')
  const clip = await getAsset(deps, ctx, cand.assetId)
  const v = deps.config.pipeline.scenes.video
  const run = await runModel(deps, ctx, v.upscale.model, 'video')
  const request: GenRequest = {
    kind: 'upscale', model: run.model, prompt: 'Upscale this take; keep every frame identical.', sourceVideo: { assetId: cand.assetId },
    durationSec: Math.max(1, Math.round((clip.durationMs ?? 5000) / 1000)), ...(run.billing ? { billing: run.billing } : {}),
  }
  return {
    purpose: `scene_video_upscale:${cand.sceneId}`,
    specs: [{ type: 'gen', stage: 'video', purpose: `scene_video_upscale:${cand.sceneId}:${cand.id}`, label: 'Upscale this take', request }],
    preview: { title: 'Upscale this take', prompts: [], warnings: [], invalidates: [] },
  }
}

// The end frame helper: a masked inpaint of the start frame's head only, so
// the scene stays exactly as it is. REF-00 holds the face; QA checks it.
export async function buildSceneEndFrame(deps: Deps, ctx: Ctx, row: CharacterRow, input: { candidateId: string; change: string; withQa: boolean }): Promise<SceneBuilt> {
  const cand = await getCandidate(deps, ctx, input.candidateId)
  if (cand.characterId !== row.id || !cand.sceneId || !cand.assetId || isVideoCandidate(cand)) throw new AppError('bad_request', 'Pick a still from this scene to make the end frame from.')
  const change = input.change.trim().replace(/[.\s]+$/, '')
  if (change.length < 3) throw new AppError('invalid_request', 'Say how the head or face changes.')
  const scene = await getScene(deps, ctx, cand.sceneId)
  const f = sceneFields(deps, scene)
  const ch = toData(row)
  const { templates: t, scenes: sc, rules } = deps.config.pipeline
  const sw = await ruleSwitches(deps, ctx, row.id)
  const run = await runModel(deps, ctx, sc.video.end_frame.model, 'image_edit')
  const ref00 = (await approvedAssets(deps, ctx, row.id)).get('REF-00')
  if (!ref00) throw new AppError('bad_request', 'The end frame attaches REF-00 for the face. Approve REF-00 first.')
  // The mask is made on the worker just before submit; where face detection
  // runs here too, a still with no visible face is caught now.
  if ((await deps.faces.status()).available) await assertFace(deps, ctx, cand.assetId)
  const realism: RealismWarning[] = []
  const prompt = buildEditPrompt(t, fill(t.video.end_frame, { ...pronounVars(ch.pronouns), change }), ch, true, { warnings: realism, flawDose: sw.on('realism-flaw-dose') })
  const request: GenRequest = {
    kind: 'image_edit', model: run.model, prompt, aspect: aspectFor(sc, f), quality: sc.settings.quality, resolution: sc.settings.resolution,
    refs: [{ assetId: cand.assetId }, { assetId: ref00 }], maskFor: { assetId: cand.assetId, region: 'head' },
    ...(run.billing ? { billing: run.billing } : {}),
  }
  const warnings = lintOrThrow(lintPrompt(rules, prompt, { stage: 'edit', kind: 'image_edit', request: { ...request, model: sc.video.end_frame.model }, switches: sw }), 'End frame')
  const label = `${sceneLabel(scene, f)}, end frame`
  const specs: JobSpec[] = [{ type: 'gen', stage: 'edit', purpose: `scene_end_frame:${scene.id}:${cand.id}`, label: `End frame: ${change.slice(0, 60)}`, request }]
  if (input.withQa) specs.push(...await sceneQaSpecs(deps, ctx, ch, f, { sceneId: scene.id, parentIndex: 0, faceRefs: [{ refId: 'REF-00', assetId: ref00 }], label }))
  return {
    purpose: `scene_end_frame:${scene.id}`, specs,
    preview: { title: 'End frame (head only)', prompts: [{ label: 'End frame prompt', text: prompt, wrapped: hardWrap(prompt) }], warnings: [...dedupe(realism), ...warnings], invalidates: [] },
  }
}

// ── Re-check a still (for example a crop or an edit made without QA) ──

export async function buildSceneRecheck(deps: Deps, ctx: Ctx, row: CharacterRow, candidateId: string): Promise<SceneBuilt> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.characterId !== row.id || !cand.sceneId || !cand.assetId) throw new AppError('bad_request', 'Pick a scene still to check.')
  const scene = await getScene(deps, ctx, cand.sceneId)
  const f = sceneFields(deps, scene)
  // A video take is checked on its last frame (saved when the take arrived).
  let image = cand.assetId
  if (isVideoCandidate(cand)) {
    const [frame] = await deps.db.select({ id: assets.id }).from(assets)
      .where(and(eq(assets.accountId, ctx.accountId), eq(assets.label, `last frame of ${cand.assetId}`)))
    if (!frame) throw new AppError('bad_request', 'This take has no saved frame to check. Make a new take to check it.')
    image = frame.id
  }
  const refs = await sceneRefs(deps, ctx, row.id, f, (await ruleSwitches(deps, ctx, row.id)).on('scene-refs-by-angle'))
  const specs = await sceneQaSpecs(deps, ctx, toData(row), f, {
    sceneId: scene.id, assetId: image, candidateId: cand.id, group: `recheck:${cand.id}:${deps.clock.now().getTime()}`,
    faceRefs: refs.filter(r => r.role !== 'body').map(r => ({ refId: r.refId, assetId: r.assetId })), label: sceneLabel(scene, f),
  })
  return { purpose: `scene_qa:${scene.id}`, specs, preview: { title: isVideoCandidate(cand) ? 'Check this take (last frame)' : 'Check this still', prompts: [], warnings: [], invalidates: [] } }
}

// The combo log entry a scene would write, for the UI.
export function comboPreview(deps: Deps, f: SceneFields) {
  return comboEntryFor(deps.config.pipeline.scenes, f, '')
}
