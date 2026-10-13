import type { Ctx, Deps } from '../context.js'
import type { ModelEntry } from '../config/load.js'
import { fill, hardWrap } from '../core/text.js'
import { blocking, lintPrompt, type RuleViolation } from '../core/rules.js'
import { identityForModel } from '../core/identity.js'
import { pronounVars } from '../core/prompts.js'
import type { RealismWarning } from '../core/realism.js'
import {
  aspectFor, buildEditPrompt, buildScenePrompt, comboConflict, comboEntryFor, oneChangeProblem, plannerRules,
  scenePlanJsonSchema, scenePlanPrompt, type ReferenceMode, type SceneFields,
} from '../core/scenes.js'
import { ruleSwitches } from './rules.js'
import { idealObservation } from '../core/qa/ideal.js'
import { observationJsonSchema } from '../core/qa/perception.js'
import { AppError } from '../lib/errors.js'
import type { JobSpec } from '../jobs/runner.js'
import type { GenRequest } from '../providers/types.js'
import { listCredentials } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { forMode, providerMode, resolveRoute } from './settings.js'
import { approvedAssets, getCandidate, toData, type CharacterRow } from './characters.js'
import { comboEntries, comboProblem, getScene, sceneFields, sceneRefs, type SceneRef } from './scenes.js'

// Paid steps for scenes (Stage 7) and still edits (Stage 8). Each returns the
// job specs for the estimate and the run (one builder for both, so the run
// matches its quote), plus the prompts to preview, hard-wrapped.

export interface SceneBuilt {
  purpose: string
  specs: JobSpec[]
  preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: RuleViolation[]; invalidates: string[] }
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

function lintOrThrow(violations: RuleViolation[], label: string): RuleViolation[] {
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
async function runModel(deps: Deps, ctx: Ctx, model: string, kind: GenRequest['kind']): Promise<{ model: string; billing?: 'account' }> {
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
  const combos = comboEntries(ch)
  // A free pair of moment and camera, like the real planner would choose.
  let momentType = sc.moments[0]!.id, camera = sc.cameras[0]!.id
  outer: for (const m of sc.moments) {
    for (const c of sc.cameras) {
      if (!comboConflict(combos, m.label, c.label, sc.settings.combo_window)) { momentType = m.id; camera = c.id; break outer }
    }
  }
  const words = brief.trim().replace(/[.!?]+$/, '')
  return {
    title: words.split(/\s+/).slice(0, 4).join(' ') || 'Everyday moment',
    momentType, camera,
    moment: `${ch.name} ${words ? words.charAt(0).toLowerCase() + words.slice(1) : 'walks to a neighborhood cafe'}`,
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
    refs: [],
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

// ── Generate: stills for one scene, on one or two models ────────────

export async function buildSceneRun(deps: Deps, ctx: Ctx, row: CharacterRow, input: { sceneId: string; models: string[]; variations: number; reason?: string; withQa: boolean; allowRepeat?: boolean }): Promise<SceneBuilt> {
  const scene = await getScene(deps, ctx, input.sceneId)
  if (scene.characterId !== row.id) throw new AppError('bad_request', 'That scene belongs to another character.')
  const ch = toData(row)
  const f = sceneFields(deps, scene)
  const { templates, scenes: sc, views, rules, review } = deps.config.pipeline
  const sw = await ruleSwitches(deps, ctx, row.id)
  let warnings: RuleViolation[] = []
  // Default rule scene-combo-log: a repeat is a warning with "Use anyway",
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
  for (const model of models) {
    const entry = modelEntry(deps, model)
    const identity = identityForModel(ch.identities, model)
    // SPEC 5.2 rule 14: refs for an edit model, the saved character for a
    // trained one, the full card otherwise.
    const mode: ReferenceMode = entry.max_refs > 0 ? 'refs' : identity ? 'trained' : 'text'
    const prompt = buildScenePrompt(templates, sc, views, f, ch, mode, { identityBlock: identity?.promptBlock, warnings: realism, addendum, rules: sceneRules, flawDose: sw.on('realism-flaw-dose') })
    const kind: GenRequest['kind'] = mode === 'refs' ? 'image_edit' : 'image'
    const run = await runModel(deps, ctx, model, kind)
    const attached = mode === 'refs' ? refs.slice(0, Math.max(1, entry.max_refs)) : []
    prompts.push({ label: `${entry.label} prompt`, text: prompt, wrapped: hardWrap(prompt) })
    for (let v = 0; v < input.variations; v++) {
      const request: GenRequest = {
        kind, model: run.model, prompt, aspect, quality: sc.settings.quality, resolution: sc.settings.resolution, seed: v + 1,
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
      specs.push({ type: 'gen', stage: 'scene', purpose: `scene:${scene.id}`, label: what, request })
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
  return {
    purpose: `scene:${scene.id}`, specs,
    preview: { title: `${label}: ${models.length > 1 ? `${models.length} models x ` : ''}${input.variations} still${input.variations > 1 ? 's' : ''}`, prompts, warnings: [...dedupe(realism), ...warnings], invalidates: [] },
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
  const prompt = buildEditPrompt(templates, input.change, ch, input.face, { warnings: realism, flawDose: sw.on('realism-flaw-dose') })
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

// ── Re-check a still (for example a crop or an edit made without QA) ──

export async function buildSceneRecheck(deps: Deps, ctx: Ctx, row: CharacterRow, candidateId: string): Promise<SceneBuilt> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.characterId !== row.id || !cand.sceneId || !cand.assetId) throw new AppError('bad_request', 'Pick a scene still to check.')
  const scene = await getScene(deps, ctx, cand.sceneId)
  const f = sceneFields(deps, scene)
  const refs = await sceneRefs(deps, ctx, row.id, f, (await ruleSwitches(deps, ctx, row.id)).on('scene-refs-by-angle'))
  const specs = await sceneQaSpecs(deps, ctx, toData(row), f, {
    sceneId: scene.id, assetId: cand.assetId, candidateId: cand.id, group: `recheck:${cand.id}:${deps.clock.now().getTime()}`,
    faceRefs: refs.filter(r => r.role !== 'body').map(r => ({ refId: r.refId, assetId: r.assetId })), label: sceneLabel(scene, f),
  })
  return { purpose: `scene_qa:${scene.id}`, specs, preview: { title: 'Check this still', prompts: [], warnings: [], invalidates: [] } }
}

// The combo log entry a scene would write, for the UI.
export function comboPreview(deps: Deps, f: SceneFields) {
  return comboEntryFor(deps.config.pipeline.scenes, f, '')
}
