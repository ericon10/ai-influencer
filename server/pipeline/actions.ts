import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { quotes, refImages } from '../db/schema.js'
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
import { quoteJobs, runJobs, type JobSpec } from '../jobs/runner.js'
import type { QuoteView } from '../costs/quotes.js'
import type { GenRequest } from '../providers/types.js'
import { forMode, liveRoute, resolveRoute } from './settings.js'
import { identityForModel } from '../core/identity.js'
import type { RealismWarning } from '../core/realism.js'
import { assertSuiteCap, buildModelSuite, buildModelTest, startModelSuite, startModelTest } from './modelTests.js'
import { approvedAssets, getCandidate, getCharacter, getRef, inspirationAssetIds, setCharacterFields, sheetState, toData } from './characters.js'
import { buildScenePlan, buildSceneRecheck, buildSceneRun, buildSceneEdit, buildSceneUpscale, type SceneBuilt } from './sceneActions.js'
import { markSceneBusy } from './scenes.js'

// Every paid step is an action. The same builder produces the job specs for
// the estimate and for the run, so the run's fingerprint must match its
// quote exactly (DECISIONS.md B8). Prompts are previewed, hard-wrapped, with
// their rule-lint results, before anything is spent.

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('breakdown'), characterId: z.string(), notes: z.string().max(2000).optional() }),
  z.object({ type: z.literal('concepts'), characterId: z.string(), notes: z.string().max(2000).optional() }),
  // 4 to 8 candidates per hero prompt, across the 3 prompts; one pick becomes REF-00.
  z.object({ type: z.literal('hero'), characterId: z.string(), runsPerPrompt: z.number().int().min(4).max(8) }),
  z.object({ type: z.literal('upscale'), characterId: z.string() }),
  z.object({ type: z.literal('card_update'), characterId: z.string() }),
  z.object({
    type: z.literal('sheet'), characterId: z.string(), refId: z.string().regex(/^REF-\d{2}$/),
    variations: z.number().int().min(1).max(4), reason: z.string().optional(),
    refsMode: z.enum(['graph', 'ref00_only']).default('graph'), withQa: z.boolean().default(true),
  }),
  z.object({ type: z.literal('qa'), characterId: z.string(), candidateId: z.string() }),
  // One small paid test that confirms a model (Settings, Models).
  z.object({ type: z.literal('model_test'), model: z.string() }),
  // Every real model path once, in one quoted run under a cap (Settings).
  z.object({ type: z.literal('model_suite') }),
  // Scenes (Stage 7): plan the fields from the owner's words, then stills on
  // one or two models with QA (and the drift lock after a trained character).
  z.object({ type: z.literal('scene_plan'), characterId: z.string(), sceneId: z.string() }),
  z.object({
    type: z.literal('scene'), characterId: z.string(), sceneId: z.string(),
    models: z.array(z.string()).min(1).max(4), variations: z.number().int().min(1).max(8),
    reason: z.string().optional(), withQa: z.boolean().default(true),
  }),
  // Still edits (Stage 8): one change per pass, an upscale, a re-check.
  z.object({
    type: z.literal('scene_edit'), characterId: z.string(), candidateId: z.string(), change: z.string().max(400),
    face: z.boolean().default(false), model: z.string().optional(), withQa: z.boolean().default(true),
  }),
  z.object({ type: z.literal('scene_upscale'), characterId: z.string(), candidateId: z.string() }),
  z.object({ type: z.literal('scene_qa'), characterId: z.string(), candidateId: z.string() }),
])

export type StudioAction = z.infer<typeof actionSchema>

export interface ActionPreview {
  title: string
  prompts: Array<{ label: string; text: string; wrapped: string }>
  warnings: RuleViolation[]
  invalidates: string[]
}

export interface BuiltAction {
  purpose: string
  characterId: string | null
  specs: JobSpec[]
  preview: ActionPreview
}

const QA_SIZE: Record<string, { width: number; height: number }> = {
  chest_up: { width: 1176, height: 1568 },
  full_body: { width: 882, height: 1568 },
}

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
  const row = await getCharacter(deps, ctx, action.characterId)
  const ch = toData(row)
  const tpl = deps.config.pipeline.templates
  const { views, rules, sheet } = deps.config.pipeline
  const scene = (b: SceneBuilt): BuiltAction => ({ purpose: b.purpose, characterId: row.id, specs: b.specs, preview: b.preview })

  switch (action.type) {
    case 'scene_plan': return scene(await buildScenePlan(deps, ctx, row, action.sceneId))
    case 'scene': return scene(await buildSceneRun(deps, ctx, row, action))
    case 'scene_edit': return scene(await buildSceneEdit(deps, ctx, row, action))
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
      if (!Number.isInteger(action.runsPerPrompt) || action.runsPerPrompt < 4 || action.runsPerPrompt > 8) {
        throw new AppError('bad_request', 'Run 4 to 8 candidates per hero prompt, across the 3 prompts, then pick one.')
      }
      const issues = validateCharacter(ch).filter(i => i.severity === 'error')
      if (issues.length) throw new AppError('invalid_request', issues.map(i => i.message).join(' '))
      const route = await resolveRoute(deps, ctx, 'hero')
      // A saved identity for the real model (for example a Soul character)
      // rides along with its prompt block, even while demo mode runs the mock.
      const identity = identityForModel(ch.identities, (await liveRoute(deps, ctx, 'hero')).model)
      // Bare-faced, with the REALISM and AVOID blocks (Realism principle).
      const realism: RealismWarning[] = []
      const prompts = buildHeroPrompts(tpl, views, ch, { identityBlock: identity?.promptBlock, warnings: realism })
      const warnings: RuleViolation[] = dedupe(realism)
      const specs: JobSpec[] = []
      prompts.forEach((prompt, i) => {
        for (let r = 0; r < action.runsPerPrompt; r++) {
          // Text only: the hero never carries an attachment (SPEC 5.1 rule 1).
          const request: GenRequest = { kind: 'image', model: route.model, prompt, aspect: route.aspect ?? '3:4', resolution: route.resolution, quality: route.quality, seed: 1000 * (i + 1) + r, ...(identity ? { identityId: identity.externalId } : {}) }
          warnings.push(...lintOrThrow(lintPrompt(rules, prompt, { stage: 'hero', framing: 'chest_up', kind: 'image', request, marks: ch.marks, identityBlock: identity?.promptBlock }), `Hero prompt ${i + 1}`))
          specs.push({ type: 'gen', stage: 'hero', purpose: `hero:${i}`, label: `Hero prompt ${i + 1}, run ${r + 1}`, request })
        }
      })
      return {
        purpose: 'hero', characterId: row.id, specs,
        preview: { title: `Hero: 3 prompts x ${action.runsPerPrompt} runs`, prompts: prompts.map((p, i) => ({ label: `Hero prompt ${i + 1}`, text: p, wrapped: hardWrap(p) })), warnings, invalidates: [] },
      }
    }

    case 'upscale': {
      const ref00 = (await approvedAssets(deps, ctx, row.id)).get('REF-00')
      if (!ref00) throw new AppError('bad_request', 'Pick a hero (REF-00) first.')
      const asset = await getAsset(deps, ctx, ref00)
      const limit = sheet.settings.upscale_ref00_below_px
      if ((asset.height ?? 0) >= limit) throw new AppError('bad_request', `REF-00 is already ${asset.height}px tall; upscaling is only needed under ${limit}px.`)
      const route = await resolveRoute(deps, ctx, 'upscale')
      const request: GenRequest = { kind: 'upscale', model: route.model, prompt: 'Upscale 2x, keep every detail identical.', refs: [{ assetId: ref00 }], scale: 2 }
      lintOrThrow(lintPrompt(rules, request.prompt, { kind: 'upscale', request }), 'Upscale')
      return {
        purpose: 'upscale', characterId: row.id,
        preview: { title: 'Upscale REF-00 2x', prompts: [], warnings: [], invalidates: [] },
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
      const attach = action.refsMode === 'ref00_only' ? ['REF-00'] : shot.attach
      const missing = attach.filter(id => !approved.has(id) || state.states.find(s => s.refId === id)?.status !== 'approved')
      if (missing.length) throw new AppError('bad_request', `Approve ${missing.join(' and ')} first.`)
      // The lock holds the real model; demo mode runs its mock instead.
      const lockedModel = await sheetModel(deps, ctx, row.sheetLock as { model: string } | null)
      const route = await forMode(deps, ctx, { ...await liveRoute(deps, ctx, 'sheet'), model: lockedModel })
      const model = route.model
      const reasonAction = action.reason ? deps.config.pipeline.review.reasons.find(r => r.id === action.reason)?.action : undefined
      const addendum = reasonAction ? deps.config.pipeline.review.actions[reasonAction]?.prompt_addendum ?? '' : ''
      const identity = identityForModel(ch.identities, lockedModel)
      const realism: RealismWarning[] = []
      const prompt = buildSheetPrompt(tpl, views, shot, ch, addendum, { identityBlock: identity?.promptBlock, warnings: realism })
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
          sheetLock: { model: lockedModel }, aspectByFraming: sheet.settings.aspect, identityBlock: identity?.promptBlock,
        }), shot.label)
        warnings = [...dedupe(realism), ...warnings]
        const genIndex = specs.length
        specs.push({ type: 'gen', stage: 'sheet', purpose: `sheet:${shot.id}`, label: `${shot.label}${action.variations > 1 ? `, variation ${v + 1}` : ''}`, request })
        if (action.withQa) specs.push(...await qaSpecs(deps, ctx, row.id, shot.id, { parentIndex: genIndex }))
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

export async function estimateAction(deps: Deps, ctx: Ctx, action: StudioAction): Promise<{ quote: QuoteView; preview: ActionPreview }> {
  const built = await buildAction(deps, ctx, action)
  const quote = await quoteJobs(deps, ctx, { purpose: built.purpose, characterId: built.characterId, specs: built.specs })
  if (action.type === 'model_suite') assertSuiteCap(deps, quote.totalMicros)
  return { quote, preview: built.preview }
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
  if (action.type === 'scene' || action.type === 'scene_edit' || action.type === 'scene_upscale') {
    await markSceneBusy(deps, ctx, built.purpose.split(':')[1]!)
  }
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
