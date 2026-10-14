import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { jobEvents, quotes, refImages } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { fill, hardWrap } from '../core/text.js'
import { buildHeroPrompts, buildSheetPrompt } from '../core/prompts.js'
import { blocking, lintPrompt, type RuleViolation } from '../core/rules.js'
import { validateCharacter } from '../core/character.js'
import { invalidationFor } from '../core/sheet.js'
import { observationJsonSchema } from '../core/qa/perception.js'
import { idealObservation } from '../core/qa/ideal.js'
import { breakdownJsonSchema, cardUpdateJsonSchema, conceptsJsonSchema } from '../core/llmSchemas.js'
import { AppError } from '../lib/errors.js'
import { getAsset } from '../storage/assets.js'
import { getJob, quoteItemsFor, quoteJobs, runJobs, type JobSpec } from '../jobs/runner.js'
import { displayPrice, modelLabel } from '../costs/quotes.js'
import type { QuoteView } from '../costs/quotes.js'
import type { GenRequest } from '../providers/types.js'
import { forMode, liveRoute, resolveRoute } from './settings.js'
import { identityForModel } from '../core/identity.js'
import type { RealismWarning } from '../core/realism.js'
import { assertSuiteCap, buildModelSuite, buildModelTest, startModelSuite, startModelTest } from './modelTests.js'
import { approvedAssets, getCandidate, getCharacter, getRef, inspirationAssetIds, setCharacterFields, sheetState, toData } from './characters.js'
import { skinFor } from '../core/scenes.js'
import { buildSceneEndFrame, buildSceneIdeas, buildScenePlan, buildScenePromptWrite, buildSceneRecheck, buildSceneRun, buildSceneEdit, buildSceneUpscale, buildSceneVideo, buildVideoUpscale, type SceneBuilt } from './sceneActions.js'
import { markSceneBusy, saveVideoModel } from './scenes.js'
import { buildContentCaptions, buildContentSlides } from './content.js'
import { buildClone, buildCloneStill, saveCloneModel } from './clone.js'
import { ruleSwitches } from './rules.js'
import { readBilling } from '../providers/billing.js'
import { effectiveModel, readModelOverrides } from '../providers/modelOverrides.js'

// Every paid step is an action. The same builder produces the job specs for
// the estimate and for the run, so the run's fingerprint must match its
// quote exactly (DECISIONS.md B8). Prompts are previewed, hard-wrapped, with
// their rule-lint results, before anything is spent.

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('breakdown'), characterId: z.string(), notes: z.string().max(2000).optional() }),
  z.object({ type: z.literal('concepts'), characterId: z.string(), notes: z.string().max(2000).optional() }),
  // Candidates per hero prompt, across the 3 prompts (4 to 8 by default,
  // rule hero-runs); one pick becomes REF-00.
  z.object({ type: z.literal('hero'), characterId: z.string(), runsPerPrompt: z.number().int().min(1).max(8) }),
  z.object({ type: z.literal('upscale'), characterId: z.string() }),
  z.object({ type: z.literal('card_update'), characterId: z.string() }),
  z.object({
    type: z.literal('sheet'), characterId: z.string(), refId: z.string().regex(/^REF-\d{2}$/),
    variations: z.number().int().min(1).max(4), reason: z.string().optional(),
    refsMode: z.enum(['graph', 'ref00_only']).default('graph'), withQa: z.boolean().optional(),
  }),
  z.object({ type: z.literal('qa'), characterId: z.string(), candidateId: z.string() }),
  // One small paid test that confirms a model (Settings, Models).
  z.object({ type: z.literal('model_test'), model: z.string() }),
  // Retry a failed run on its own, with a new price (feedback everywhere).
  z.object({ type: z.literal('retry'), jobId: z.string() }),
  // Every real model path once, in one quoted run under a cap (Settings).
  z.object({ type: z.literal('model_suite') }),
  // Scenes (Stage 7): plan the fields from the owner's words, then stills on
  // one or two models with QA (and the drift lock after a trained character).
  z.object({ type: z.literal('scene_plan'), characterId: z.string(), sceneId: z.string() }),
  z.object({ type: z.literal('scene_ideas'), characterId: z.string(), idea: z.string().trim().min(3).max(600) }),
  // The prompt writer (default rule scene-prompt-writer): Claude writes the
  // final still or video prompt from the scene details.
  z.object({
    type: z.literal('scene_prompt'), characterId: z.string(), sceneId: z.string(), target: z.enum(['still', 'video']),
    motion: z.string().max(3000).optional(), directions: z.string().max(600).optional(),
    startCandidateId: z.string().optional(), endCandidateId: z.string().optional(),
    // The director's notes the owner set (followed as given), and the take's
    // length, shape and sound for the FORMAT and AUDIO lines.
    notes: z.string().max(600).optional(), durationSec: z.number().int().min(2).max(15).optional(), audio: z.boolean().optional(), aspect: z.string().max(8).optional(),
  }),
  z.object({
    type: z.literal('scene'), characterId: z.string(), sceneId: z.string(),
    models: z.array(z.string()).min(1).max(4), variations: z.number().int().min(1).max(8),
    reason: z.string().optional(), withQa: z.boolean().optional(),
    // Silences the repeat note (rule scene-combo-log, off unless switched on).
    allowRepeat: z.boolean().optional(),
    // "Write and generate" (owner, 2026-10-13): the prompt writer runs first
    // and the stills use what it writes; one price for both.
    write: z.boolean().optional(),
  }),
  // Still edits (Stage 8): one change per pass, an upscale, a re-check.
  z.object({
    type: z.literal('scene_edit'), characterId: z.string(), candidateId: z.string(), change: z.string().max(400),
    face: z.boolean().default(false), model: z.string().optional(), withQa: z.boolean().optional(),
  }),
  z.object({ type: z.literal('scene_upscale'), characterId: z.string(), candidateId: z.string() }),
  z.object({ type: z.literal('scene_qa'), characterId: z.string(), candidateId: z.string() }),
  // Video from a picked still (Stage 9): straight to the final model, the
  // quick motion test optional; then "Upscale this take"; the end frame
  // helper inpaints only the head of the start frame.
  z.object({
    type: z.literal('scene_video'), characterId: z.string(), candidateId: z.string(), endCandidateId: z.string().optional(),
    model: z.string().max(80).optional(),
    motion: z.string().max(3000), directions: z.string().max(600).default(''), durationSec: z.number().int().min(2).max(15).default(5),
    aspect: z.string().max(8).default('9:16'), audio: z.boolean().default(false), takes: z.number().int().min(1).max(8).default(1), test: z.boolean().default(false),
  }),
  z.object({ type: z.literal('scene_video_upscale'), characterId: z.string(), candidateId: z.string() }),
  z.object({ type: z.literal('scene_end_frame'), characterId: z.string(), candidateId: z.string(), change: z.string().max(400), withQa: z.boolean().optional() }),
  // The content builder: Claude writes slideshow text, or batch captions.
  z.object({ type: z.literal('content_slides'), characterId: z.string(), contentId: z.string() }),
  z.object({ type: z.literal('content_captions'), characterId: z.string(), contentId: z.string() }),
  // Clone Video (SPEC 13.1 R1): the post's source clip rebuilt for one or
  // more characters, one quote with a line each.
  z.object({
    type: z.literal('clone'), contentId: z.string(), characterIds: z.array(z.string().max(60)).min(1).max(10),
    model: z.string().max(80).optional(), mode: z.enum(['replace', 'motion']).optional(), background: z.enum(['video', 'image']).optional(),
    outfit: z.enum(['source', 'hers']).optional(),
    looks: z.record(z.string().max(60), z.string().max(60)).default({}), keepSound: z.boolean().default(false),
  }),
  // "Copy the moves into a new scene": the clip's first frame with the
  // character in place of the picked person, shown before the motion run.
  z.object({ type: z.literal('clone_still'), contentId: z.string(), characterId: z.string().max(60), outfit: z.enum(['source', 'hers']).optional(), look: z.string().max(60).optional() }),
])

export type StudioAction = z.infer<typeof actionSchema>

export interface ActionPreview {
  title: string
  prompts: Array<{ label: string; text: string; wrapped: string }>
  warnings: RuleViolation[]
  invalidates: string[]
  // The price of a later step, shown with this one (never run here).
  followUp?: { label: string; display: string; verified: boolean; models: string[] }
}

export interface BuiltAction {
  purpose: string
  characterId: string | null
  specs: JobSpec[]
  preview: ActionPreview
  followUp?: { label: string; specs: JobSpec[] }
}

const QA_SIZE: Record<string, { width: number; height: number }> = {
  chest_up: { width: 1176, height: 1568 },
  full_body: { width: 882, height: 1568 },
}

const warn = (ruleId: string, title: string, message: string, spec = ''): RuleViolation => ({ ruleId, spec, title, severity: 'warning', message })

// Only fixed rules can stop a run; defaults arrive here as warnings.
function lintOrThrow(violations: RuleViolation[], label: string): RuleViolation[] {
  const errors = blocking(violations)
  if (errors.length) {
    throw new AppError('prompt_rejected', `${label}: ${errors.map(e => `${e.title} (SPEC ${e.spec})`).join('; ')}`, errors)
  }
  return violations.filter(v => v.severity === 'warning')
}

function qaHints(marks: ReturnType<typeof toData>['marks']): string {
  const jewelry = marks.filter(m => m.kind === 'jewelry').map(m => `jewelry on either ear such as a ${m.description}`)
  const skin = marks.filter(m => m.kind === 'skin').map(m => `skin marks near either ${m.region} such as a ${m.description}`)
  return [...jewelry, ...skin].join('; ') || 'any jewelry and skin marks'
}

async function qaSpecs(deps: Deps, ctx: Ctx, characterId: string, refId: string, opts: { parentIndex?: number; assetId?: string; group?: string }): Promise<JobSpec[]> {
  const ch = toData(await getCharacter(deps, ctx, characterId))
  const shot = deps.config.pipeline.sheet.shots.find(s => s.id === refId)!
  const route = await resolveRoute(deps, ctx, 'qa_perception')
  const t = deps.config.pipeline.templates.qa_perception
  const passes: Array<'orig' | 'mirror'> = deps.config.pipeline.review.qa.mirror_consistency ? ['orig', 'mirror'] : ['orig']
  const ideal = idealObservation(shot, deps.config.pipeline.views, ch.marks, ch.eyes)
  return passes.map(pass => ({
    type: 'llm' as const,
    stage: 'qa',
    purpose: `qa:${refId}`,
    label: pass === 'orig' ? `QA check, ${shot.label}` : `QA mirror check, ${shot.label}`,
    parentIndex: opts.parentIndex,
    request: {
      model: route.model,
      system: t.system,
      prompt: fill(t.prompt, { hints: qaHints(ch.marks) }),
      schema: observationJsonSchema,
      schemaName: 'qa_perception',
      maxTokens: 3000,
      effort: route.effort ?? 'medium',
      imageAssetIds: opts.assetId ? [opts.assetId] : [],
      mirrorImages: pass === 'mirror',
      estimateImages: opts.assetId ? undefined : [QA_SIZE[shot.framing]!],
      meta: {
        refId, pass, group: opts.group,
        mockObservation: pass === 'orig' ? ideal : mirrorFor(ideal),
      },
    },
  }))
}

function mirrorFor(o: ReturnType<typeof idealObservation>) {
  const flip = <T extends string>(s: T) => (s === 'image_left' ? 'image_right' : s === 'image_right' ? 'image_left' : s) as T
  return { ...o, nose: flip(o.nose), ears: o.ears.map(e => ({ ...e, image_side: flip(e.image_side) })), skin_marks: o.skin_marks.map(m => ({ ...m, image_side: flip(m.image_side) })) }
}

// The same realism warning once per action, not once per prompt.
function dedupe(list: RealismWarning[]): RuleViolation[] {
  const seen = new Map<string, RuleViolation>()
  for (const w of list) if (!seen.has(`${w.ruleId}|${w.match}`)) seen.set(`${w.ruleId}|${w.match}`, w)
  return [...seen.values()]
}

export async function buildAction(deps: Deps, ctx: Ctx, action: StudioAction): Promise<BuiltAction> {
  if (action.type === 'model_test') return buildModelTest(deps, ctx, action.model)
  if (action.type === 'model_suite') return buildModelSuite(deps, ctx)
  if (action.type === 'retry') return buildRetry(deps, ctx, action.jobId)
  if (action.type === 'clone') return buildClone(deps, ctx, action)
  if (action.type === 'clone_still') return buildCloneStill(deps, ctx, action)
  const row = await getCharacter(deps, ctx, action.characterId)
  const ch = toData(row)
  const tpl = deps.config.pipeline.templates
  const { views, rules, sheet } = deps.config.pipeline
  // Default rules as switched for this character (Settings, Rules).
  const sw = await ruleSwitches(deps, ctx, row.id)
  const looks = { background: sw.on('sheet-background') ? sw.value('sheet-background') ?? null : null, flawDose: sw.on('realism-flaw-dose') }
  // Claude checks run on demand unless the owner switches automatic QA on.
  const autoQa = sw.on('scene-auto-qa')
  const scene = (b: SceneBuilt): BuiltAction => ({ purpose: b.purpose, characterId: row.id, specs: b.specs, preview: b.preview, followUp: b.followUp })

  switch (action.type) {
    case 'scene_plan': return scene(await buildScenePlan(deps, ctx, row, action.sceneId))
    case 'scene_ideas': return scene(await buildSceneIdeas(deps, ctx, row, action.idea))
    case 'scene_prompt': return scene(await buildScenePromptWrite(deps, ctx, row, action))
    case 'content_slides': return scene(await buildContentSlides(deps, ctx, row, action.contentId))
    case 'content_captions': return scene(await buildContentCaptions(deps, ctx, row, action.contentId))
    case 'scene_video': return scene(await buildSceneVideo(deps, ctx, row, action))
    case 'scene_video_upscale': return scene(await buildVideoUpscale(deps, ctx, row, action.candidateId))
    case 'scene_end_frame': return scene(await buildSceneEndFrame(deps, ctx, row, { ...action, withQa: action.withQa ?? autoQa }))
    case 'scene': return scene(await buildSceneRun(deps, ctx, row, { ...action, withQa: action.withQa ?? autoQa }))
    case 'scene_edit': return scene(await buildSceneEdit(deps, ctx, row, { ...action, withQa: action.withQa ?? autoQa }))
    case 'scene_upscale': return scene(await buildSceneUpscale(deps, ctx, row, action.candidateId))
    case 'scene_qa': return scene(await buildSceneRecheck(deps, ctx, row, action.candidateId))

    case 'breakdown': {
      const images = await inspirationAssetIds(deps, ctx, row.id)
      if (!images.length) throw new AppError('bad_request', 'Add at least one inspiration image first.')
      const route = await resolveRoute(deps, ctx, 'breakdown')
      const prompt = fill(tpl.breakdown.prompt, { notes: action.notes?.trim() || 'none' })
      return {
        purpose: 'breakdown', characterId: row.id,
        preview: { title: 'Inspiration breakdown', prompts: [{ label: 'Breakdown', text: prompt, wrapped: hardWrap(prompt) }], warnings: [], invalidates: [] },
        specs: [{ type: 'llm', stage: 'breakdown', purpose: 'breakdown', label: 'Keep and Change breakdown', request: { model: route.model, system: tpl.breakdown.system, prompt, schema: breakdownJsonSchema, schemaName: 'breakdown', maxTokens: 4000, effort: route.effort ?? 'medium', imageAssetIds: images } }],
      }
    }

    case 'concepts': {
      if (!row.breakdown && !action.notes?.trim()) throw new AppError('bad_request', 'Run the inspiration breakdown first, or describe the character in notes.')
      const route = await resolveRoute(deps, ctx, 'concepts')
      const prompt = fill(tpl.concepts.prompt, { breakdown: row.breakdown ? JSON.stringify(row.breakdown, null, 2) : '(none)', notes: action.notes?.trim() || 'none' })
      return {
        purpose: 'concepts', characterId: row.id,
        preview: { title: 'Three character concepts', prompts: [{ label: 'Concepts', text: prompt, wrapped: hardWrap(prompt) }], warnings: [], invalidates: [] },
        specs: [{ type: 'llm', stage: 'concepts', purpose: 'concepts', label: '3 character concepts', request: { model: route.model, system: tpl.concepts.system, prompt, schema: conceptsJsonSchema, schemaName: 'concepts', maxTokens: 8000, effort: route.effort ?? 'high' } }],
      }
    }

    case 'hero': {
      if (!Number.isInteger(action.runsPerPrompt) || action.runsPerPrompt < 1 || action.runsPerPrompt > 8) {
        throw new AppError('bad_request', 'Run 1 to 8 candidates per hero prompt.')
      }
      const issues = validateCharacter(ch).filter(i => i.severity === 'error')
      if (issues.length) throw new AppError('invalid_request', issues.map(i => i.message).join(' '))
      const route = await resolveRoute(deps, ctx, 'hero')
      // A saved identity for the real model (for example a Soul character)
      // rides along with its prompt block, even while demo mode runs the mock.
      const identity = identityForModel(ch.identities, (await liveRoute(deps, ctx, 'hero')).model)
      // Bare-faced, with the REALISM and AVOID blocks (Realism principle).
      const realism: RealismWarning[] = []
      const prompts = buildHeroPrompts(tpl, views, ch, { identityBlock: identity?.promptBlock, warnings: realism, ...looks })
      const warnings: RuleViolation[] = dedupe(realism)
      if (action.runsPerPrompt < 4 && sw.on('hero-runs')) warnings.push(warn('hero-runs', 'Fewer than 4 candidates per prompt', 'More candidates per prompt usually make a better pick. Running anyway.', '5.1.2'))
      const specs: JobSpec[] = []
      prompts.forEach((prompt, i) => {
        for (let r = 0; r < action.runsPerPrompt; r++) {
          // Text only: the hero never carries an attachment (SPEC 5.1 rule 1).
          const request: GenRequest = { kind: 'image', model: route.model, prompt, aspect: route.aspect ?? '3:4', resolution: route.resolution, quality: route.quality, seed: 1000 * (i + 1) + r, ...(identity ? { identityId: identity.externalId } : {}) }
          warnings.push(...lintOrThrow(lintPrompt(rules, prompt, { stage: 'hero', framing: 'chest_up', kind: 'image', request, marks: ch.marks, identityBlock: identity?.promptBlock, switches: sw }), `Hero prompt ${i + 1}`))
          specs.push({ type: 'gen', stage: 'hero', purpose: `hero:${i}`, label: `Hero prompt ${i + 1}, run ${r + 1}`, request })
        }
      })
      return {
        purpose: 'hero', characterId: row.id, specs,
        preview: { title: `Hero: 3 prompts x ${action.runsPerPrompt} runs`, prompts: prompts.map((p, i) => ({ label: `Hero prompt ${i + 1}`, text: p, wrapped: hardWrap(p) })), warnings: uniqueWarnings(warnings), invalidates: [] },
      }
    }

    case 'upscale': {
      const ref00 = (await approvedAssets(deps, ctx, row.id)).get('REF-00')
      if (!ref00) throw new AppError('bad_request', 'Pick a hero (REF-00) first.')
      const asset = await getAsset(deps, ctx, ref00)
      const limit = sheet.settings.upscale_ref00_below_px
      const warnings: RuleViolation[] = []
      if ((asset.height ?? 0) >= limit && sw.on('ref00-upscale-size')) warnings.push(warn('ref00-upscale-size', 'REF-00 is already large', `REF-00 is ${asset.height}px tall; an upscale is usually only needed under ${limit}px. Running anyway.`, '5.1.6'))
      const route = await resolveRoute(deps, ctx, 'upscale')
      const request: GenRequest = { kind: 'upscale', model: route.model, prompt: 'Upscale 2x, keep every detail identical.', refs: [{ assetId: ref00 }], scale: 2 }
      warnings.push(...lintOrThrow(lintPrompt(rules, request.prompt, { kind: 'upscale', request, switches: sw }), 'Upscale'))
      return {
        purpose: 'upscale', characterId: row.id,
        preview: { title: 'Upscale REF-00 2x', prompts: [], warnings, invalidates: [] },
        specs: [{ type: 'gen', stage: 'hero', purpose: 'upscale', label: 'Upscale REF-00 2x', request }],
      }
    }

    case 'card_update': {
      const ref00 = (await approvedAssets(deps, ctx, row.id)).get('REF-00')
      if (!ref00) throw new AppError('bad_request', 'Pick a hero (REF-00) first.')
      const route = await resolveRoute(deps, ctx, 'card_update')
      const marks = ch.marks.map(m => `${m.description} (${m.side} ${m.region})`).join('; ')
      const prompt = fill(tpl.card_update.prompt, { card: ch.card, marks })
      return {
        purpose: 'card_update', characterId: row.id,
        preview: { title: 'Update the card to match the hero', prompts: [{ label: 'Card update', text: prompt, wrapped: hardWrap(prompt) }], warnings: [], invalidates: [] },
        specs: [{ type: 'llm', stage: 'character', purpose: 'card_update', label: 'Compare card with hero', request: { model: route.model, system: tpl.card_update.system, prompt, schema: cardUpdateJsonSchema, schemaName: 'card_update', maxTokens: 3000, effort: route.effort ?? 'medium', imageAssetIds: [ref00], meta: { card: ch.card, marks: ch.marks } } }],
      }
    }

    case 'sheet': {
      const shot = sheet.shots.find(s => s.id === action.refId)
      if (!shot) throw new AppError('bad_request', `Unknown shot ${action.refId}.`)
      if (shot.source === 'hero') throw new AppError('bad_request', 'REF-00 comes from the hero pick. Run more heroes to replace it.')
      const approved = await approvedAssets(deps, ctx, row.id)
      const state = await sheetState(deps, ctx, row.id)
      const wanted = action.refsMode === 'ref00_only' ? ['REF-00'] : shot.attach
      const usable = (id: string) => approved.has(id) && ['approved', 'stale'].includes(state.states.find(s => s.refId === id)?.status ?? '')
      // Default rule sheet-order: a shot attaches the shots it depends on;
      // when one is not approved yet it uses the approved ones and says so.
      const missing = wanted.filter(id => !usable(id))
      let attach = wanted.filter(usable)
      if (!attach.length) attach = usable('REF-00') ? ['REF-00'] : [...approved.keys()].filter(usable).slice(0, 1)
      if (!attach.length) throw new AppError('bad_request', 'Pick a hero (REF-00) first. The sheet is built from it.')
      const orderWarning = missing.length && sw.on('sheet-order')
        ? [warn('sheet-order', 'Built out of order', `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not approved yet, so this shot uses ${attach.join(' and ')}. Running anyway.`, '4.1')]
        : []
      // The lock holds the real model (default rule sheet-one-model); demo
      // mode runs its mock instead. Switched off, the current sheet route runs.
      const lockedModel = sw.on('sheet-one-model') ? await sheetModel(deps, ctx, row.sheetLock as { model: string } | null) : (await liveRoute(deps, ctx, 'sheet')).model
      const route = await forMode(deps, ctx, { ...await liveRoute(deps, ctx, 'sheet'), model: lockedModel })
      const model = route.model
      const reasonAction = action.reason ? deps.config.pipeline.review.reasons.find(r => r.id === action.reason)?.action : undefined
      const addendum = reasonAction ? deps.config.pipeline.review.actions[reasonAction]?.prompt_addendum ?? '' : ''
      const identity = identityForModel(ch.identities, lockedModel)
      const realism: RealismWarning[] = []
      const prompt = buildSheetPrompt(tpl, views, shot, ch, addendum, { identityBlock: identity?.promptBlock, warnings: realism, ...looks, skin: skinFor(deps.config.pipeline.scenes, shot.framing) })
      const specs: JobSpec[] = []
      let warnings: RuleViolation[] = []
      for (let v = 0; v < action.variations; v++) {
        const request: GenRequest = {
          kind: 'image_edit', model, prompt, refs: attach.map(id => ({ assetId: approved.get(id)! })),
          aspect: sheet.settings.aspect[shot.framing], quality: sheet.settings.quality, resolution: sheet.settings.resolution, seed: v + 1,
          ...(identity ? { identityId: identity.externalId } : {}),
        }
        warnings = lintOrThrow(lintPrompt(rules, prompt, {
          stage: 'sheet', framing: shot.framing, kind: 'image_edit', request: { ...request, model: lockedModel }, marks: ch.marks,
          sheetLock: row.sheetLock as { model: string } | null, aspectByFraming: sheet.settings.aspect, identityBlock: identity?.promptBlock, switches: sw,
        }), shot.label)
        warnings = [...orderWarning, ...dedupe(realism), ...warnings]
        const genIndex = specs.length
        specs.push({ type: 'gen', stage: 'sheet', purpose: `sheet:${shot.id}`, label: `${shot.label}${action.variations > 1 ? `, variation ${v + 1}` : ''}`, request })
        if (action.withQa ?? autoQa) specs.push(...await qaSpecs(deps, ctx, row.id, shot.id, { parentIndex: genIndex }))
      }
      const ref = state.refs.find(r => r.refId === shot.id)
      const invalidates = ref?.approvedCandidateId ? invalidationFor(sheet.shots, state.states, shot.id) : []
      return {
        purpose: `sheet:${shot.id}`, characterId: row.id, specs,
        preview: { title: `${shot.id}: ${shot.label}`, prompts: [{ label: shot.label, text: prompt, wrapped: hardWrap(prompt) }], warnings, invalidates },
      }
    }

    case 'qa': {
      const cand = await getCandidate(deps, ctx, action.candidateId)
      if (!cand.assetId || !cand.refId) throw new AppError('bad_request', 'This candidate has no sheet image to check.')
      const specs = await qaSpecs(deps, ctx, row.id, cand.refId, { assetId: cand.assetId, group: `recheck:${cand.id}:${deps.clock.now().getTime()}` })
      for (const s of specs) if (s.type === 'llm') s.request.meta = { ...s.request.meta, candidateId: cand.id }
      return { purpose: `qa:${cand.refId}`, characterId: row.id, specs, preview: { title: `Re-check ${cand.refId}`, prompts: [], warnings: [], invalidates: [] } }
    }
  }
}

// The same request as a failed run, quoted again. Only a run that failed or
// was canceled on its own (not one waiting on another step, not a model
// test, not free worker steps) can be retried this way.
async function buildRetry(deps: Deps, ctx: Ctx, jobId: string): Promise<BuiltAction> {
  const job = await getJob(deps, ctx, jobId)
  const req = job.request as Record<string, unknown>
  if (!['failed', 'canceled'].includes(job.status)) throw new AppError('bad_request', 'Only a failed run can be retried.')
  if (job.provider === 'local' || req.parentJobId || job.purpose.startsWith('model_test')) throw new AppError('bad_request', 'Run this again from the step it belongs to.')
  const [created] = await deps.db.select().from(jobEvents).where(and(eq(jobEvents.jobId, job.id), eq(jobEvents.type, 'created')))
  const label = (created?.data as { label?: string } | undefined)?.label || job.purpose
  const { parentJobId: _p, quotedCredits: _q, promptFrom: _f, ...request } = req
  const spec = (job.kind === 'llm'
    ? { type: 'llm', stage: job.stage, purpose: job.purpose, label, request }
    : { type: 'gen', stage: job.stage, purpose: job.purpose, label, request }) as unknown as JobSpec
  return { purpose: job.purpose, characterId: job.characterId, specs: [spec], preview: { title: `Retry: ${label}`, prompts: [], warnings: [], invalidates: [] } }
}

export async function estimateAction(deps: Deps, ctx: Ctx, action: StudioAction): Promise<{ quote: QuoteView; preview: ActionPreview }> {
  const built = await buildAction(deps, ctx, action)
  const quote = await quoteJobs(deps, ctx, { purpose: built.purpose, characterId: built.characterId, specs: built.specs })
  if (action.type === 'model_suite') assertSuiteCap(deps, quote.totalMicros)
  const untested = action.type === 'model_test' || action.type === 'model_suite' ? [] : await untestedModels(deps, ctx, built)
  // A later step's price (for example "Upscale this take"), quoted for show.
  let followUp: ActionPreview['followUp']
  if (built.followUp) {
    const items = await quoteItemsFor(deps, ctx, built.followUp.specs)
    followUp = { label: built.followUp.label, display: displayPrice(items.map(i => ({ amountMicros: i.estimate.totalMicros, credits: i.estimate.credits ?? null }))), verified: items.every(i => i.estimate.verified), models: [...new Set(items.map(i => modelLabel(deps, `${i.provider}/${i.model}`)))] }
  }
  return { quote, preview: { ...built.preview, warnings: uniqueWarnings([...built.preview.warnings, ...untested]), ...(followUp ? { followUp } : {}) } }
}

function uniqueWarnings(list: RuleViolation[]): RuleViolation[] {
  const seen = new Set<string>()
  return list.filter(w => { const k = `${w.ruleId}|${w.match ?? ''}|${w.message}`; if (seen.has(k)) return false; seen.add(k); return true })
}

// Default rule model-tested: a model on the API that has not passed its
// paid test yet runs with a warning instead of being refused.
async function untestedModels(deps: Deps, ctx: Ctx, built: BuiltAction): Promise<RuleViolation[]> {
  const sw = await ruleSwitches(deps, ctx, built.characterId)
  if (!sw.on('model-tested')) return []
  const billing = (await readBilling(deps.db, ctx.accountId)).default
  const overrides = await readModelOverrides(deps.db, ctx.accountId)
  const out: RuleViolation[] = []
  for (const s of built.specs) {
    if (s.type !== 'gen' || !s.request.model.startsWith('higgsfield/')) continue
    const base = deps.config.models.models.find(m => m.ref === s.request.model)
    if (!base || base.api === false || (s.request.billing ?? billing) !== 'api') continue
    if (effectiveModel(base, overrides[base.ref]).confirmed) continue
    out.push(warn('model-tested', `${base.label} has not passed its test yet`, `${base.label} runs on the API without its small paid test. If its endpoint is wrong the run fails and costs nothing. You can test it in Settings, Model tests.`, 'D2'))
  }
  return out
}

export async function runAction(deps: Deps, ctx: Ctx, action: StudioAction, quoteId: string | undefined, confirmed: boolean) {
  if (action.type === 'model_suite') {
    const [q] = quoteId ? await deps.db.select({ total: quotes.totalMicros }).from(quotes).where(and(eq(quotes.accountId, ctx.accountId), eq(quotes.id, quoteId))) : []
    if (!q) throw new AppError('quote_required', 'Get an estimate for the model tests first.')
    assertSuiteCap(deps, q.total)
  }
  const built = await buildAction(deps, ctx, action)
  const jobs = await runJobs(deps, ctx, { quoteId, confirmed, purpose: built.purpose, characterId: built.characterId, specs: built.specs })
  if (action.type === 'model_test') await startModelTest(deps, ctx, action.model, jobs[0]!.id)
  else if (action.type === 'model_suite') await startModelSuite(deps, ctx, jobs)
  else await afterStart(deps, ctx, action, built)
  return { jobs, preview: built.preview }
}

async function afterStart(deps: Deps, ctx: Ctx, action: StudioAction, built: BuiltAction): Promise<void> {
  const now = deps.clock.now()
  if (action.type === 'scene' || action.type === 'scene_edit' || action.type === 'scene_upscale' || action.type === 'scene_video' || action.type === 'scene_video_upscale' || action.type === 'scene_end_frame'
    || (action.type === 'retry' && /^(scene|scene_edit|scene_upscale|scene_video|scene_video_upscale|scene_end_frame|drift_lock):/.test(built.purpose))) {
    await markSceneBusy(deps, ctx, built.purpose.split(':')[1]!)
  }
  // The video model picked last is the next take's default.
  if (action.type === 'scene_video' && !action.test && action.model) await saveVideoModel(deps, ctx, action.model)
  if (action.type === 'clone' && action.model) await saveCloneModel(deps, ctx, action.model)
  if (action.type === 'hero') {
    const row = await getCharacter(deps, ctx, action.characterId)
    if (row.stage < 3) await setCharacterFields(deps, ctx, row.id, { stage: 3 })
  }
  if (action.type === 'sheet') {
    const row = await getCharacter(deps, ctx, action.characterId)
    if (!row.sheetLock) await setCharacterFields(deps, ctx, row.id, { sheetLock: { model: await sheetModel(deps, ctx, null), quality: deps.config.pipeline.sheet.settings.quality, resolution: deps.config.pipeline.sheet.settings.resolution } })
    const ref = await getRef(deps, ctx, row.id, action.refId)
    // Regenerating a shot revokes its approval (the old version stays in
    // history and can be restored) and marks everything built on it stale.
    await deps.db.update(refImages).set({ status: 'generating', approvedCandidateId: null, updatedAt: now }).where(eq(refImages.id, ref.id))
    for (const dep of built.preview.invalidates) {
      const r = await getRef(deps, ctx, row.id, dep)
      await deps.db.update(refImages).set({ status: 'stale', staleReason: `${action.refId} was regenerated`, staleSince: now, updatedAt: now }).where(eq(refImages.id, r.id))
    }
  }
}

// The real model a character's sheet is locked to (SPEC 5.1 rule 7). A lock
// written by an older demo-mode build names the mock; treat it as unset.
export async function sheetModel(deps: Deps, ctx: Ctx, lock: { model: string } | null): Promise<string> {
  if (lock?.model && !lock.model.startsWith('mock/')) return lock.model
  return (await liveRoute(deps, ctx, 'sheet')).model
}
