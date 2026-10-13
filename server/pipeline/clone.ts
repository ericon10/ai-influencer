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
import { lintPrompt, type RuleViolation } from '../core/rules.js'
import { assembleVideoPrompt } from '../core/promptWriter.js'
import { finalize, type QaReport } from '../core/qa/marks.js'
import { transcodeSource } from '../media/meme.js'
import { muxSound } from '../media/edit.js'
import { probeFile, withTempDir } from '../media/ffmpeg.js'
import { compareTexture } from '../qa/texture.js'
import type { GenRequest } from '../providers/types.js'
import { readBilling } from '../providers/billing.js'
import { listCredentials } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { effectiveModel, MODEL_OVERRIDES_KEY, readModelOverrides } from '../providers/modelOverrides.js'
import { getAsset, readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import { approvedAssets, getCandidate, getCharacter, toData } from './characters.js'
import { createContent, getContent, specSchemas, updateContent, type CloneSource, type ContentKind } from './content.js'
import { lintOrThrow, runModel } from './sceneActions.js'
import { freeChecksOnly } from './sceneHooks.js'
import { clipFrames } from './videoAssets.js'
import { scorePerformer, scoreSceneIdentity } from './identity.js'
import { ruleSwitches } from './rules.js'
import { getSetting, setSetting } from './settings.js'

// Clone Video (SPEC 13.1 R1; UX-PLAN.md: "Clone a TikTok or Reel" in a
// post's Video step). The owner brings a saved TikTok or Reel; the worker
// keeps a lean copy with its sound. One run rebuilds it for one or more
// characters (one quote, a line each) with the same motion and camera. The
// provider never keeps the source's sound: "Keep original sound" (off by
// default) puts it back on the worker, free and the same for every model.
// Each result is checked for free (the face against REF-00, the skin, and
// that it is not the person in the source clip), kept in Library > Clips,
// and picked in the post with "Use this clip".

const CLONE_MODEL_KEY = 'clone_model'

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
  const clone: CloneSource = { status: 'preparing', name, uploadId: input.uploadId, assetId: null, durationSec: null, hasAudio: false, trimmed: false, error: null }
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
      return { asset, hasAudio, trimmed: (original.durationSec ?? 0) > cfg.max_seconds + 0.25 }
    })
    const seconds = Math.round((made.asset.durationMs ?? 0) / 100) / 10
    await deps.store.delete(key).catch(() => undefined)
    if (seconds < cfg.min_seconds) {
      await write({ status: 'failed', error: `This clip is ${seconds} s long. A clone needs at least ${cfg.min_seconds} s of video.` })
      return { seconds }
    }
    await write({ status: 'ready', assetId: made.asset.id, durationSec: seconds, hasAudio: made.hasAudio, trimmed: made.trimmed, error: null })
    return { assetId: made.asset.id, seconds }
  } catch (e) {
    await write({ status: 'failed', error: `This file could not be read as a video (${(e as Error).message.slice(0, 200)}).` })
    throw e
  }
}

// ── The model ───────────────────────────────────────────────────────

// The account's last pick; else Kling 3.0 Motion Control on the owner's
// Higgsfield plan when that is the default and connected, else the API one.
export async function cloneModel(deps: Deps, ctx: Ctx): Promise<string> {
  const cfg = deps.config.pipeline.content.clone
  const saved = await getSetting<string | null>(deps.db, ctx.accountId, CLONE_MODEL_KEY, null)
  if (saved && cfg.models.some(m => m.ref === saved)) return saved
  const billing = (await readBilling(deps.db, ctx.accountId)).default
  if (billing === 'account' && (await listCredentials(deps.db, ctx.accountId)).some(c => c.provider === ACCOUNT_PROVIDER)) return cfg.account_model
  return cfg.model
}

export async function saveCloneModel(deps: Deps, ctx: Ctx, model: string): Promise<void> {
  if (!deps.config.pipeline.content.clone.models.some(m => m.ref === model)) throw new AppError('bad_request', `${model} is not offered for cloning.`)
  await setSetting(deps, ctx, CLONE_MODEL_KEY, model)
}

// The picker: each model with what it does and the price for this clip and
// one character. Estimates are free.
export async function cloneOptions(deps: Deps, ctx: Ctx, contentId: string) {
  const post = await getContent(deps, ctx, contentId)
  const source = cloneOf(post)
  const cfg = deps.config.pipeline.content.clone
  const seconds = Math.max(1, Math.ceil(source?.durationSec ?? 10))
  const models = await Promise.all(cfg.models.map(async m => {
    const entry = modelEntry(deps, m.ref)
    const base = { ref: m.ref, label: entry.label, resolution: m.resolution ?? null, background: entry.clone.background, minSec: entry.clone.min_sec, maxSec: entry.clone.max_sec, path: entry.api === false ? 'account' : 'api', note: entry.notes ?? '' }
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
  return { model: await cloneModel(deps, ctx), models, seconds, maxCharacters: cfg.max_characters, keepSound: cfg.keep_sound, minSeconds: cfg.min_seconds, maxSeconds: cfg.max_seconds, maxUploadMb: cfg.max_upload_mb }
}

// ── The run ─────────────────────────────────────────────────────────

export interface CloneInput {
  contentId: string
  characterIds: string[]
  model?: string
  background?: 'video' | 'image'
  // A kept still per character for its look (the place too, on models that
  // take it from the image); REF-00 otherwise.
  looks: Record<string, string>
  keepSound: boolean
}

// REF-00 first, then the approved sheet shots that show the face, in sheet
// order: more images hold the face better on the models that take them.
function faceRefs(deps: Deps, approved: Map<string, string>): string[] {
  const { sheet, views } = deps.config.pipeline
  return sheet.shots.filter(s => approved.has(s.id) && views.views[s.view]?.identity !== 'skip').map(s => approved.get(s.id)!)
}

export async function buildClone(deps: Deps, ctx: Ctx, input: CloneInput) {
  const post = await getContent(deps, ctx, input.contentId)
  const source = cloneOf(post)
  if (!source || source.status !== 'ready' || !source.assetId) {
    throw new AppError('bad_request', source?.status === 'preparing' ? 'The clip to clone is still being prepared. Try again in a moment.' : 'Add the TikTok or Reel to clone first.')
  }
  const cfg = deps.config.pipeline.content.clone
  const t = deps.config.pipeline.templates
  const ids = [...new Set(input.characterIds)]
  if (!ids.length) throw new AppError('invalid_request', 'Pick a character to clone the clip for.')
  if (ids.length > cfg.max_characters) throw new AppError('invalid_request', `Clone for up to ${cfg.max_characters} characters at once.`)
  const wanted = input.model ?? await cloneModel(deps, ctx)
  const picked = cfg.models.find(m => m.ref === wanted)
  if (!picked) throw new AppError('bad_request', `${wanted} is not offered for cloning. Pick one of the listed models.`)
  const entry = modelEntry(deps, wanted)
  const c = entry.clone
  const seconds = source.durationSec ?? 0
  // What a model can take is not a rule: a clip outside it would only fail.
  if (seconds < c.min_sec - 0.05 || seconds > c.max_sec + 0.05) {
    throw new AppError('invalid_request', `${entry.label} takes clips from ${c.min_sec} to ${c.max_sec} s; this one is ${seconds} s. Pick another model.`)
  }
  const background = input.background && c.background.includes(input.background) ? input.background : c.background[0]!
  const run = await runModel(deps, ctx, wanted, 'video_clone')
  const warnings: RuleViolation[] = []
  if (input.keepSound && !source.hasAudio) warnings.push(warn('video-audio-off', 'No sound to keep', 'This clip has no sound, so the clone stays silent.'))
  const specs: JobSpec[] = []
  const prompts: Array<{ label: string; text: string; wrapped: string }> = []
  const names: string[] = []
  for (const cid of ids) {
    const row = await getCharacter(deps, ctx, cid)
    const ch = toData(row)
    const approved = await approvedAssets(deps, ctx, cid)
    const ref00 = approved.get('REF-00')
    if (!ref00) throw new AppError('bad_request', `${row.name} has no face yet. Set up ${ch.pronouns.poss} face (REF-00) first, or leave ${ch.pronouns.obj} out.`)
    let look = ref00
    const lookId = input.looks[cid]
    if (lookId) {
      const still = await getCandidate(deps, ctx, lookId)
      if (still.characterId !== cid || !still.assetId || isVideoOp(still.op) || still.target !== 'scene') throw new AppError('bad_request', `Pick a still of ${row.name} for ${ch.pronouns.poss} look.`)
      look = still.assetId
    } else if (background === 'image') {
      warnings.push(warn('clone-place', 'The place comes from REF-00', `${entry.label} takes the place from the character image. REF-00 has a plain gray background, so ${row.name}'s clone will too. Pick a still of ${ch.pronouns.obj} somewhere for a full scene.`))
    }
    const extra = c.image_refs > 1 ? faceRefs(deps, approved).filter(a => a !== look).slice(0, Math.min(c.image_refs, entry.max_refs) - 1) : []
    const sw = await ruleSwitches(deps, ctx, cid)
    // The REALISM block rides along on every model that takes a prompt.
    const prompt = c.prompt === 'none' ? '' : assembleVideoPrompt(t, fill(background === 'video' ? t.clone.swap : t.clone.image, { poss: ch.pronouns.poss }), { directions: '', audio: false, realism: ch.realism?.block })
    const request: GenRequest = {
      kind: 'video_clone', model: run.model, prompt, refs: [look, ...extra].map(assetId => ({ assetId })), sourceVideo: { assetId: source.assetId },
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
      title: `Clone "${source.name}" for ${names.join(', ')}`,
      prompts,
      warnings: warnings.filter(w => { const k = `${w.ruleId}|${w.message}`; if (seen.has(k)) return false; seen.add(k); return true }),
      invalidates: [] as string[],
    },
  }
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
  registerJobHook('clone', onClone)
}
