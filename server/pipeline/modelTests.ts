import type { Ctx, Deps } from '../context.js'
import { hasRole } from '../context.js'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { and, eq, isNull } from 'drizzle-orm'
import { assets } from '../db/schema.js'
import type { GenRequest } from '../providers/types.js'
import { AppError } from '../lib/errors.js'
import { formatUsd } from '../costs/money.js'
import { hardWrap } from '../core/text.js'
import { lintPrompt, blocking, type RuleViolation } from '../core/rules.js'
import { finalizeImagePrompt } from '../core/realism.js'
import { renderPlaceholderPortrait, renderVideo } from '../providers/mock.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import type { JobSpec } from '../jobs/runner.js'
import type { JobOutcome, JobRow } from '../jobs/hooks.js'
import { effectiveModel, MODEL_OVERRIDES_KEY, readModelOverrides, type ModelOverrides } from '../providers/modelOverrides.js'
import { providerMode, setSetting } from './settings.js'
import { listCredentials } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'

// One small paid test per model before it counts as confirmed (owner's rule,
// 2026-10-12): the endpoint comes from Higgsfield's official Model API
// Reference, then the cheapest request the model accepts runs once, with its
// price shown first like any other run. A completed result confirms the
// endpoint that was tested; a failure keeps the model unconfirmed and shows
// the provider's answer.

const PROMPTS = {
  image: 'A plain white ceramic mug on a wooden table, soft daylight, simple photo.',
  video: 'The scene holds still while the camera pushes in slowly. Calm, no people moving. Silent, no audio, no dialogue.',
  audio: 'Soft rain on a window, steady, no music.',
  clone: 'The person in the reference image performs the motion of the source video: the same timing and camera. Calm, simple. Silent, no audio, no dialogue.',
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
  if (base.api === false) throw new AppError('bad_request', `${base.label} is not on the Higgsfield API, so there is no API endpoint to test. It runs through your Higgsfield account (Settings, Model tests covers it there).`)
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
  } else if (kind === 'video_clone') {
    // Clone Video: the test portrait as the character and a short motion
    // clip made from it as the source (4 s, the shortest every clone model
    // takes). A provider that wants a real person in the source fails the
    // test without charging; a real clone run also confirms the model.
    const frame = await testImage(deps, ctx)
    const sourceVideo = { assetId: await testClip(deps, ctx, frame) }
    request = {
      kind: 'video_clone', model: entry.ref, prompt: entry.clone?.prompt === 'none' ? '' : PROMPTS.clone, refs: [{ assetId: frame }], sourceVideo,
      durationSec: 4, resolution, audio: false, cloneBackground: entry.clone?.background[0] ?? 'image', modelTest: true,
    }
  } else if (kind === 'upscale') {
    request = { kind: 'upscale', model: entry.ref, prompt: 'Upscale, keep every detail identical.', refs: [{ assetId: await testImage(deps, ctx) }], resolution, scale: 2, modelTest: true }
  } else if (kind === 'audio') {
    request = { kind: 'audio', model: entry.ref, prompt: PROMPTS.audio, durationSec: 3, modelTest: true }
  } else {
    // Every image prompt carries a REALISM line, tests included; the test
    // shot has no person, so it is the plain one (never the skin block).
    request = { kind: 'image', model: entry.ref, prompt: finalizeImagePrompt(PROMPTS.image, { person: false, plainLine: deps.config.pipeline.templates.slideshow_topic_realism }).prompt, aspect: '1:1', resolution, modelTest: true }
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
  return saveTestImage(deps, ctx, await renderPlaceholderPortrait('Model test'), 'Model test frame')
}

// The motion clip for a clone model test, made once per account and found
// again by its label (so the estimate and the run name the same asset).
async function testClip(deps: Deps, ctx: Ctx, frameAssetId: string): Promise<string> {
  const label = 'Model test motion clip'
  const [found] = await deps.db.select({ id: assets.id }).from(assets)
    .where(and(eq(assets.accountId, ctx.accountId), eq(assets.label, label), eq(assets.origin, 'fixture'), isNull(assets.archivedAt))).limit(1)
  if (found) return found.id
  const { data } = await readAsset(deps, ctx, frameAssetId)
  return (await saveAsset(deps, ctx, { data: await renderVideo(data, 4, 'Model test'), mime: 'video/mp4', origin: 'fixture', label })).id
}

// Test images are stored once per account and found again by content, so the
// estimate and the run name the same asset (the quote covers asset ids).
async function saveTestImage(deps: Deps, ctx: Ctx, data: Buffer, label: string): Promise<string> {
  const sum = createHash('sha256').update(data).digest('hex')
  const [found] = await deps.db.select({ id: assets.id }).from(assets)
    .where(and(eq(assets.accountId, ctx.accountId), eq(assets.checksumSha256, sum), eq(assets.origin, 'fixture'), isNull(assets.archivedAt))).limit(1)
  return found?.id ?? (await saveAsset(deps, ctx, { data, origin: 'fixture', label })).id
}

// ── The model test suite ──
// One quoted run that checks each real model path once on the pay-per-use
// API (config/runtime.yaml, model_suite). Test images are neutral renders (a
// mug, a potted plant), never a character. The run is refused when its
// estimate is over the cap, and a model without an endpoint is skipped.

const SUITE_PROMPTS = {
  refs: 'Place the white mug from the first image beside the potted plant from the second image on a wooden table. Soft daylight, simple photo.',
  image: PROMPTS.image,
  startEnd: 'The camera pushes in slowly on a white mug on a wooden table, from the first frame to the last. Nothing else moves. Soft daylight. Silent, no audio, no dialogue.',
  start: 'The camera pushes in slowly on a white mug on a wooden table. Nothing else moves. Soft daylight. Silent, no audio, no dialogue.',
}

const SIZE: Record<string, [number, number]> = { '1:1': [1024, 1024], '9:16': [720, 1280], '16:9': [1280, 720], '3:4': [960, 1280] }

// A plain still life: a white mug or a potted plant on a wooden table.
export async function renderStillLife(subject: 'mug' | 'plant', aspect = '1:1'): Promise<Buffer> {
  const [w, h] = SIZE[aspect] ?? SIZE['1:1']!
  const u = Math.min(w, h) / 100
  const cx = w / 2, table = h * 0.62
  const grain = Array.from({ length: 6 }, (_, i) => `<path d="M 0 ${table + (i + 1) * (h - table) / 7} Q ${w / 2} ${table + (i + 1.4) * (h - table) / 7} ${w} ${table + (i + 0.8) * (h - table) / 7}" stroke="#7a5233" stroke-width="${u * 0.3}" fill="none" opacity="0.35"/>`).join('')
  const thing = subject === 'mug'
    ? `<ellipse cx="${cx}" cy="${table + u * 1.5}" rx="${u * 15}" ry="${u * 3}" fill="#000" opacity="0.18"/>
       <path d="M ${cx + u * 11} ${table - u * 20} q ${u * 9} ${u * 1} ${u * 8} ${u * 9} q ${-u * 1} ${u * 7} ${-u * 8} ${u * 7}" stroke="#ececec" stroke-width="${u * 2.4}" fill="none"/>
       <rect x="${cx - u * 12}" y="${table - u * 26}" width="${u * 24}" height="${u * 26}" rx="${u * 2}" fill="#f4f4f2"/>
       <ellipse cx="${cx}" cy="${table - u * 26}" rx="${u * 12}" ry="${u * 2.6}" fill="#dcdcd8"/>
       <rect x="${cx - u * 12}" y="${table - u * 26}" width="${u * 5}" height="${u * 26}" fill="#fff" opacity="0.5"/>`
    : `<ellipse cx="${cx}" cy="${table + u * 1.5}" rx="${u * 13}" ry="${u * 2.6}" fill="#000" opacity="0.18"/>
       ${[-40, -15, 10, 35, 60].map((a, i) => `<ellipse cx="${cx + Math.sin(a * Math.PI / 180) * u * 12}" cy="${table - u * 30 - Math.cos(a * Math.PI / 180) * u * 10}" rx="${u * 4}" ry="${u * 11}" transform="rotate(${a} ${cx + Math.sin(a * Math.PI / 180) * u * 12} ${table - u * 30 - Math.cos(a * Math.PI / 180) * u * 10})" fill="hsl(${110 + i * 6},38%,${34 + i * 3}%)"/>`).join('')}
       <path d="M ${cx - u * 11} ${table - u * 20} L ${cx + u * 11} ${table - u * 20} L ${cx + u * 8} ${table} L ${cx - u * 8} ${table} Z" fill="#b8643c"/>
       <rect x="${cx - u * 12}" y="${table - u * 22}" width="${u * 24}" height="${u * 4}" rx="${u * 1}" fill="#a55a35"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ece7df"/><stop offset="1" stop-color="#d6cfc4"/></linearGradient>
      <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b07a4f"/><stop offset="1" stop-color="#8d5d3a"/></linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#wall)"/>
    <rect y="${table}" width="${w}" height="${h - table}" fill="url(#wood)"/>${grain}
    ${thing}
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

// The same scene, closer: the end frame of a slow push-in.
async function pushedIn(start: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(start).metadata()
  const w = Math.round(width * 0.8), h = Math.round(height * 0.8)
  return sharp(start).extract({ left: Math.round((width - w) / 2), top: Math.round((height - h) * 0.6), width: w, height: h }).resize(width, height).png().toBuffer()
}

export async function buildModelSuite(deps: Deps, ctx: Ctx): Promise<BuiltModelTest & { cap: number }> {
  if (!hasRole(ctx, 'admin')) throw new AppError('forbidden', 'Only an owner or admin can test models.')
  if ((await providerMode(deps.db, ctx.accountId)) !== 'live') throw new AppError('bad_request', 'Switch to live mode to test models. Demo mode never calls a provider.')
  const suite = deps.config.runtime.model_suite
  const overrides = await readModelOverrides(deps.db, ctx.accountId)
  // A model the API does not offer is tested on the owner's Higgsfield
  // account instead (plan credits), when it is connected.
  const accountConnected = (await listCredentials(deps.db, ctx.accountId)).some(c => c.provider === ACCOUNT_PROVIDER)
  const specs: JobSpec[] = []
  const prompts: BuiltModelTest['preview']['prompts'] = []
  const skipped: string[] = []
  const notOnApi: string[] = []
  const images = new Map<string, Promise<string>>()
  const image = (key: string, make: () => Promise<Buffer>, label: string) => {
    if (!images.has(key)) images.set(key, make().then(d => saveTestImage(deps, ctx, d, label)))
    return images.get(key)!
  }

  for (const t of suite.tests) {
    const base = deps.config.models.models.find(m => m.ref === t.model)
    if (!base) throw new AppError('bad_request', `The model test list names an unknown model "${t.model}".`)
    const entry = effectiveModel(base, overrides[t.model])
    const onAccount = base.api === false
    if (onAccount && (!accountConnected || !base.mcp_id)) { notOnApi.push(entry.label); continue }
    if (!onAccount && !entry.endpoint) { skipped.push(entry.label); continue }
    const aspect = t.aspect ?? '1:1'
    let request: GenRequest
    if (t.kind === 'video') {
      const startKey = `mug:${aspect}`
      const start = await image(startKey, () => renderStillLife('mug', aspect), 'Model test: start frame')
      const end = t.frames === 'start_end'
        ? await image(`${startKey}:end`, async () => pushedIn(await renderStillLife('mug', aspect)), 'Model test: end frame')
        : undefined
      request = {
        kind: 'video', model: entry.ref, prompt: end ? SUITE_PROMPTS.startEnd : SUITE_PROMPTS.start,
        startFrame: { assetId: start }, ...(end ? { endFrame: { assetId: end } } : {}),
        aspect, resolution: t.resolution, durationSec: t.duration_sec ?? 5, audio: false, modelTest: true,
      }
    } else if (t.kind === 'upscale') {
      const source = await image('mug:small', async () => sharp(await renderStillLife('mug', '1:1')).resize(512, 512).png().toBuffer(), 'Model test: image to upscale')
      request = { kind: 'upscale', model: entry.ref, prompt: 'Upscale, keep every detail identical.', refs: [{ assetId: source }], resolution: t.resolution, scale: 2, modelTest: true }
    } else {
      const refs = t.refs >= 1
        ? [await image('mug:1:1', () => renderStillLife('mug', '1:1'), 'Model test: mug'), await image('plant:1:1', () => renderStillLife('plant', '1:1'), 'Model test: plant')].slice(0, t.refs)
        : []
      // Every image prompt carries the REALISM block, tests included.
      const prompt = finalizeImagePrompt(refs.length ? SUITE_PROMPTS.refs : SUITE_PROMPTS.image, { person: false, plainLine: deps.config.pipeline.templates.slideshow_topic_realism }).prompt
      request = { kind: 'image', model: entry.ref, prompt, ...(refs.length ? { refs: refs.map(assetId => ({ assetId })) } : {}), aspect, resolution: t.resolution, modelTest: true }
    }
    if (onAccount) request = { ...request, billing: 'account' }
    const errors = blocking(lintPrompt(deps.config.pipeline.rules, request.prompt, { kind: request.kind, request }))
    if (errors.length) throw new AppError('prompt_rejected', `${entry.label}: ${errors.map(e => e.message).join(' ')}`)
    specs.push({ type: 'gen', stage: 'model_test', purpose: `model_test:${entry.ref}`, label: `Test ${entry.label}${onAccount ? ' (your Higgsfield account)' : ''}`, request })
    prompts.push({ label: `${entry.label} (${onAccount ? 'your Higgsfield account, plan credits' : entry.endpoint})`, text: request.prompt, wrapped: hardWrap(request.prompt) })
  }
  if (!specs.length) {
    throw new AppError('bad_request', notOnApi.length && !skipped.length
      ? `Connect your Higgsfield account in Settings to test ${notOnApi.join(', ')}; the API does not offer them.`
      : 'Enter the models\' endpoints from the official Model API Reference first (Settings, Higgsfield models).')
  }

  // The cap covers the whole run; it is checked against the run's quote
  // (assertSuiteCap), so the models are priced once.
  const cap = Math.round(suite.cap_usd * 1_000_000)

  const warnings: RuleViolation[] = [
    ...(skipped.length ? [{ ruleId: 'model-suite-skipped', spec: '7.1', title: 'Skipped: no endpoint yet', severity: 'warning' as const, message: `Not tested this run: ${skipped.join(', ')}. Enter each endpoint from the official Model API Reference, then run the tests again.` }] : []),
    ...(notOnApi.length ? [{ ruleId: 'model-suite-account', spec: '7.1', title: 'Skipped: not on the API', severity: 'warning' as const, message: `Not tested this run: ${notOnApi.join(', ')}. The Higgsfield API does not offer them; connect your Higgsfield account in Settings to test them there.` }] : []),
  ]
  return {
    purpose: 'model_suite', characterId: null, specs, cap,
    preview: { title: `Model tests: ${specs.length} model${specs.length === 1 ? '' : 's'}, capped at ${formatUsd(cap)}`, prompts, warnings, invalidates: [] },
  }
}

// The whole suite run stays under its cap: checked when it is estimated and
// again, from the stored quote, when it is started.
export function assertSuiteCap(deps: Deps, totalMicros: number): void {
  const cap = Math.round(deps.config.runtime.model_suite.cap_usd * 1_000_000)
  if (totalMicros > cap) throw new AppError('budget_exceeded', `These model tests would cost about ${formatUsd(totalMicros)}, over the ${formatUsd(cap)} cap for one run.`)
}

// Records the endpoint each suite job tests, like a single test.
export async function startModelSuite(deps: Deps, ctx: Ctx, jobs: JobRow[]): Promise<void> {
  for (const job of jobs) await startModelTest(deps, ctx, job.purpose.slice('model_test:'.length), job.id)
}

// Records the endpoint being tested, so the result confirms that path and no
// other (an admin may edit the path while the test runs).
export async function startModelTest(deps: Deps, ctx: Ctx, modelRef: string, jobId: string): Promise<void> {
  const overrides = await readModelOverrides(deps.db, ctx.accountId)
  const base = deps.config.models.models.find(m => m.ref === modelRef)!
  const endpoint = effectiveModel(base, overrides[modelRef]).endpoint ?? 'account'
  await save(deps, ctx, { ...overrides, [modelRef]: { ...overrides[modelRef], pendingTest: { jobId, endpoint } } })
}

export async function onModelTest(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const ref = job.purpose.slice('model_test:'.length)
  const overrides = await readModelOverrides(deps.db, job.accountId)
  const current = { ...(overrides[ref] ?? {}) }
  const base = deps.config.models.models.find(m => m.ref === ref)
  if (!base) return
  const ok = out.status === 'completed' && (out.assets?.length ?? 0) > 0
  // A model the API does not offer was tested on the owner's account: a pass
  // shows the account path works and confirms no API endpoint.
  if ((job.request as { billing?: string } | null)?.billing === 'account') {
    current.lastTest = { at: deps.clock.now().toISOString(), ok, message: ok ? `Test passed on your Higgsfield account: ${out.assets!.length} output(s).` : `Test failed: ${out.error ?? out.status}`, jobId: job.id }
    delete current.pendingTest
    await save(deps, ctx, { ...overrides, [ref]: current })
    return
  }
  const endpointNow = effectiveModel(base, current).endpoint
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
