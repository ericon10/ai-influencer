import type { Ctx, Deps } from '../context'
import { hasRole } from '../context'
import type { GenRequest } from '../providers/types'
import { AppError } from '../lib/errors'
import { hardWrap } from '../core/text'
import { lintPrompt, blocking, type RuleViolation } from '../core/rules'
import { renderPlaceholderPortrait } from '../providers/mock'
import { saveAsset } from '../storage/assets'
import type { JobSpec } from '../jobs/runner'
import type { JobOutcome, JobRow } from '../jobs/hooks'
import { effectiveModel, MODEL_OVERRIDES_KEY, readModelOverrides, type ModelOverrides } from '../providers/modelOverrides'
import { providerMode, setSetting } from './settings'

// One small paid test per model before it counts as confirmed (owner's rule,
// 2026-10-12): the endpoint comes from Higgsfield's official Model API
// Reference, then the cheapest request the model accepts runs once, with its
// price shown first like any other run. A completed result confirms the
// endpoint that was tested; a failure keeps the model unconfirmed and shows
// the provider's answer.

const PROMPTS = {
  image: 'A plain white ceramic mug on a wooden table, soft daylight, simple photo.',
  video: 'The scene holds still while the camera pushes in slowly. Calm, no people moving.',
  audio: 'Soft rain on a window, steady, no music.',
}

export interface BuiltModelTest {
  purpose: string
  characterId: null
  specs: JobSpec[]
  preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: RuleViolation[]; invalidates: string[] }
}

function first<T>(v: unknown): T | undefined {
  return Array.isArray(v) ? (v[0] as T | undefined) : undefined
}

export async function buildModelTest(deps: Deps, ctx: Ctx, modelRef: string): Promise<BuiltModelTest> {
  if (!hasRole(ctx, 'admin')) throw new AppError('forbidden', 'Only an owner or admin can test a model.')
  const base = deps.config.models.models.find(m => m.ref === modelRef && m.ref.startsWith('higgsfield/'))
  if (!base) throw new AppError('bad_request', `Unknown Higgsfield model "${modelRef}".`)
  const entry = effectiveModel(base, (await readModelOverrides(deps.db, ctx.accountId))[modelRef])
  if (!entry.endpoint) throw new AppError('bad_request', `Enter ${entry.label}'s endpoint from the official Model API Reference first.`)
  if ((await providerMode(deps.db, ctx.accountId)) !== 'live') throw new AppError('bad_request', 'Switch to live mode to test a model. Demo mode never calls a provider.')

  const kind = entry.kinds[0]!
  const resolution = first<string>(entry.params.resolution)
  let request: GenRequest
  if (kind === 'video' || kind === 'video_extend') {
    const frame = await testImage(deps, ctx)
    const minDuration = first<number>(entry.params.duration_sec)
    request = { kind: 'video', model: entry.ref, prompt: PROMPTS.video, startFrame: { assetId: frame }, durationSec: Math.min(5, minDuration ?? 5), resolution, audio: false, modelTest: true }
  } else if (kind === 'upscale') {
    request = { kind: 'upscale', model: entry.ref, prompt: 'Upscale, keep every detail identical.', refs: [{ assetId: await testImage(deps, ctx) }], resolution, scale: 2, modelTest: true }
  } else if (kind === 'audio') {
    request = { kind: 'audio', model: entry.ref, prompt: PROMPTS.audio, durationSec: 3, modelTest: true }
  } else {
    request = { kind: 'image', model: entry.ref, prompt: PROMPTS.image, aspect: '1:1', resolution, modelTest: true }
  }
  const violations = lintPrompt(deps.config.pipeline.rules, request.prompt, { kind: request.kind, request })
  const errors = blocking(violations)
  if (errors.length) throw new AppError('prompt_rejected', errors.map(e => e.message).join(' '))
  return {
    purpose: `model_test:${entry.ref}`,
    characterId: null,
    specs: [{ type: 'gen', stage: 'model_test', purpose: `model_test:${entry.ref}`, label: `Test ${entry.label}`, request }],
    preview: { title: `Test ${entry.label} (${entry.endpoint})`, prompts: [{ label: 'Test prompt', text: request.prompt, wrapped: hardWrap(request.prompt) }], warnings: [], invalidates: [] },
  }
}

// A small neutral frame for video and upscale tests.
async function testImage(deps: Deps, ctx: Ctx): Promise<string> {
  const asset = await saveAsset(deps, ctx, { data: await renderPlaceholderPortrait('Model test'), origin: 'fixture', label: 'Model test frame' })
  return asset.id
}

// Records the endpoint being tested, so the result confirms that path and no
// other (an admin may edit the path while the test runs).
export async function startModelTest(deps: Deps, ctx: Ctx, modelRef: string, jobId: string): Promise<void> {
  const overrides = await readModelOverrides(deps.db, ctx.accountId)
  const base = deps.config.models.models.find(m => m.ref === modelRef)!
  const endpoint = effectiveModel(base, overrides[modelRef]).endpoint!
  await save(deps, ctx, { ...overrides, [modelRef]: { ...overrides[modelRef], pendingTest: { jobId, endpoint } } })
}

export async function onModelTest(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const ref = job.purpose.slice('model_test:'.length)
  const overrides = await readModelOverrides(deps.db, job.accountId)
  const current = { ...(overrides[ref] ?? {}) }
  const base = deps.config.models.models.find(m => m.ref === ref)
  if (!base) return
  const endpointNow = effectiveModel(base, current).endpoint
  const ok = out.status === 'completed' && (out.assets?.length ?? 0) > 0
  const sameEndpoint = current.pendingTest?.jobId === job.id && current.pendingTest.endpoint === endpointNow
  const message = ok
    ? (sameEndpoint ? `Test passed: ${out.assets!.length} output(s) at ${endpointNow}.` : 'Test passed, but the endpoint changed while it ran. Test again to confirm the new one.')
    : `Test failed: ${out.error ?? out.status}`
  current.lastTest = { at: deps.clock.now().toISOString(), ok: ok && sameEndpoint, message, jobId: job.id }
  if (ok && sameEndpoint) { current.confirmedAt = deps.clock.now().toISOString(); current.confirmedBy = job.userId }
  delete current.pendingTest
  await save(deps, ctx, { ...overrides, [ref]: current })
}

async function save(deps: Deps, ctx: Ctx, overrides: ModelOverrides): Promise<void> {
  await setSetting(deps, ctx, MODEL_OVERRIDES_KEY, overrides)
}
