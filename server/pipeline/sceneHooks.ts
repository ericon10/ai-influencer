import { and, eq, sql } from 'drizzle-orm'
import { candidates, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { activateChildren, cancelChildren, childJobs } from '../jobs/runner.js'
import { checkSceneFields, sceneFieldsSchema, type SceneFields } from '../core/scenes.js'
import { finalize, type QaReport } from '../core/qa/marks.js'
import { evaluateScene, sceneMirrorFix } from '../core/qa/scene.js'
import { parseObservation } from '../core/qa/perception.js'
import type { GenRequest } from '../providers/types.js'
import { approvedAssets, getCharacter, toData } from './characters.js'
import { clipFrames } from './videoAssets.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { compareTexture } from '../qa/texture.js'
import { scoreSceneIdentity } from './identity.js'
import { draftFields, getScene, refreshSceneStatus, sceneFields, updateScene } from './scenes.js'
import { textureCheck, textureSummary } from './texture.js'
import { ruleSwitches } from './rules.js'

// What each finished scene job does (Stage 7 and 8). Failed QA never
// reaches the review queue (SPEC 6); a still waits with its reasons and a
// one-click fix (an edit, a free mirror, or a regenerate).

const ACTIVE = ['waiting', 'queued', 'submitting', 'running', 'ingesting']
const sceneIdOf = (job: JobRow) => job.purpose.split(':')[1]!
const parentCandidateOf = (job: JobRow) => job.purpose.split(':')[2]

async function newCandidate(deps: Deps, job: JobRow, fields: Partial<typeof candidates.$inferInsert>): Promise<string> {
  const id = newId('cand')
  await deps.db.insert(candidates).values({
    id, accountId: job.accountId, characterId: job.characterId!, jobId: job.id, createdBy: job.userId,
    prompt: (job.request as { prompt?: string }).prompt ?? '', target: 'scene', sceneId: sceneIdOf(job), ...fields,
  })
  return id
}

// A waiting child's own waiting children go too (a drift lock's QA).
async function cancelTree(deps: Deps, parentJobId: string, reason: string): Promise<void> {
  for (const c of await childJobs(deps, parentJobId)) await cancelChildren(deps, c.id, reason)
  await cancelChildren(deps, parentJobId, reason)
}

// QA was quoted with the still; it starts now that the image exists.
async function startQa(deps: Deps, job: JobRow, assetId: string, candidateId: string, texture: QaReport['texture']): Promise<boolean> {
  const qa = (await childJobs(deps, job.id)).filter(c => c.purpose.startsWith('scene_qa:') && c.status === 'waiting')
  if (!qa.length) return false
  await activateChildren(deps, job.id, child => (child.purpose.startsWith('scene_qa:')
    ? { imageAssetIds: [assetId], estimateImages: undefined, meta: { ...((child.request as { meta?: object }).meta ?? {}), candidateId, texture } }
    : {}))
  return true
}

const info = (message: string): QaReport => finalize([{ code: 'uncertain', severity: 'info', message }], null)

async function onScenePlan(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const scene = await getScene(deps, ctx, sceneIdOf(job))
  const raw = (out.data ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...draftFields(scene) }
  for (const key of Object.keys(sceneFieldsSchema.shape)) if (typeof raw[key] === 'string') merged[key] = raw[key]
  // A preset the planner made up is dropped, so the form asks for it.
  const parsed = sceneFieldsSchema.safeParse(merged)
  if (parsed.success) for (const issue of checkSceneFields(deps.config.pipeline.scenes, deps.config.pipeline.views, parsed.data)) delete merged[issue.field]
  await updateScene(deps, ctx, scene.id, { fields: merged as Partial<SceneFields>, title: scene.title || (typeof raw.title === 'string' ? raw.title : undefined) })
}

async function onScene(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const asset = out.assets?.[0]
  if (out.status === 'completed' && asset) {
    const children = await childJobs(deps, job.id)
    const lock = children.find(c => c.purpose.startsWith('drift_lock:') && c.status === 'waiting')
    if (lock) {
      // The trained character's still waits for its drift lock (DECISIONS D3).
      await newCandidate(deps, job, { assetId: asset.id, status: 'superseded', qaReport: info('Still from the saved character, before the drift lock.'), qaVerdict: 'uncertain' })
      await activateChildren(deps, job.id, child => (child.id === lock.id
        ? { refs: [{ assetId: asset.id }, ...((child.request as GenRequest).refs ?? []).slice(1)] }
        : {}))
    } else {
      const id = await newCandidate(deps, job, { assetId: asset.id, status: 'qa_pending' })
      if (!(await startQa(deps, job, asset.id, id, null))) {
        await deps.db.update(candidates).set({ status: 'in_review' }).where(eq(candidates.id, id))
      }
    }
  } else {
    await newCandidate(deps, job, { status: 'failed', rejectNote: out.error ?? '' })
    await cancelTree(deps, job.id, 'The still it was waiting for did not finish.')
  }
  await refreshSceneStatus(deps, ctx, sceneIdOf(job))
}

async function onDriftLock(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const req = job.request as GenRequest & { parentJobId?: string }
  const [base] = req.parentJobId ? await deps.db.select().from(candidates).where(and(eq(candidates.accountId, job.accountId), eq(candidates.jobId, req.parentJobId))) : []
  const asset = out.assets?.[0]
  if (out.status === 'completed' && asset) {
    const texture = await textureCheck(deps, ctx, base?.assetId ?? undefined, asset.id, true)
    const t = texture ? textureSummary(texture) : null
    const id = await newCandidate(deps, job, { assetId: asset.id, parentId: base?.id ?? null, op: 'drift_lock', status: 'qa_pending' })
    if (!(await startQa(deps, job, asset.id, id, t))) {
      const report = t?.smoothed ? finalize([{ code: 'skin_smoothed', severity: 'fail', message: t.message }], null) : info('Face locked to REF-00 after the saved character still.')
      await deps.db.update(candidates).set({ status: t?.smoothed ? 'qa_failed' : 'in_review', qaReport: { ...report, texture: t }, qaVerdict: report.verdict }).where(eq(candidates.id, id))
    }
  } else {
    // The still before the lock stays reviewable, with the reason.
    if (base) await deps.db.update(candidates).set({ status: 'in_review', qaReport: finalize([{ code: 'uncertain', severity: 'warn', message: `The drift lock did not finish (${out.error ?? 'no result'}). This is the saved character's still before the face lock; check the face yourself.` }], null), qaVerdict: 'uncertain' }).where(eq(candidates.id, base.id))
    await cancelChildren(deps, job.id, 'The drift lock it was checking did not finish.')
  }
  await refreshSceneStatus(deps, ctx, sceneIdOf(job))
}

// One-change edits and upscales keep the still's real skin (Realism
// principle): a smoothed result never replaces its source.
async function onSceneEdit(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const parentId = parentCandidateOf(job) ?? null
  const op = job.purpose.startsWith('scene_upscale:') ? 'upscale' : job.purpose.startsWith('scene_end_frame:') ? 'end_frame' : 'edit'
  const asset = out.assets?.[0]
  if (out.status === 'completed' && asset) {
    const texture = await textureCheck(deps, ctx, (job.request as GenRequest).refs?.[0]?.assetId, asset.id, true)
    const t = texture ? textureSummary(texture) : null
    const id = await newCandidate(deps, job, { assetId: asset.id, parentId, op, status: 'qa_pending' })
    if (!(await startQa(deps, job, asset.id, id, t))) {
      const findings: QaReport['findings'] = t?.smoothed
        ? [{ code: 'skin_smoothed', severity: 'fail', message: `${t.message} Run it again.` }]
        : t ? [{ code: 'skin_real', severity: 'info', message: t.message }] : []
      if (op === 'upscale') findings.push({ code: 'uncertain', severity: 'info', message: 'Upscaled 2x with an upscaler: same frame, more detail.' })
      const report = { ...finalize(findings, null), texture: t }
      await deps.db.update(candidates).set({ status: t?.smoothed ? 'qa_failed' : 'in_review', qaReport: report, qaVerdict: report.verdict }).where(eq(candidates.id, id))
    }
  } else {
    await newCandidate(deps, job, { parentId, op, status: 'failed', rejectNote: out.error ?? '' })
    await cancelChildren(deps, job.id, `The ${op} did not finish.`)
  }
  await refreshSceneStatus(deps, ctx, sceneIdOf(job))
}

// A video take (Stage 9): checked locally and free. The face is matched to
// REF-00 on a middle and a late frame, and the skin is compared with the
// start still (video compression softens skin a little, so only a clear loss
// is pointed out). A person always decides; face drift asks to confirm.
async function onSceneVideo(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const parentId = parentCandidateOf(job) ?? null
  const asset = out.assets?.find(a => a.kind === 'video') ?? out.assets?.[0]
  const req = job.request as GenRequest
  if (out.status === 'completed' && asset) {
    const id = await newCandidate(deps, job, { assetId: asset.id, parentId, op: 'video', status: 'qa_pending' })
    const findings: QaReport['findings'] = []
    if (job.purpose.split(':')[3] === 'test') {
      findings.push({ code: 'uncertain', severity: 'info', message: `${deps.config.pipeline.scenes.video.test.label}: faces not representative. Judge the motion only.` })
    }
    try {
      const frames = await clipFrames(deps, ctx, asset.id, [0.5, 0.95])
      const ref00 = (await approvedAssets(deps, ctx, job.characterId!)).get('REF-00')
      for (const [i, png] of frames.entries()) {
        const frame = await saveAsset(deps, ctx, { data: png, mime: 'image/png', origin: 'derived', label: `${i === 0 ? 'middle' : 'last'} frame of ${asset.id}`, sourceJobId: job.id })
        const r = await scoreSceneIdentity(deps, ctx, { assetId: frame.id, refs: ref00 ? [{ refId: 'REF-00', assetId: ref00 }] : [], demo: job.provider === 'mock' })
        for (const f of r.findings) if (!findings.some(x => x.code === f.code && x.severity === f.severity)) findings.push({ ...f, message: `${i === 0 ? 'Middle' : 'Last'} frame: ${f.message}` })
      }
      if (req.startFrame?.assetId && frames[0]) {
        const { data: still } = await readAsset(deps, ctx, req.startFrame.assetId)
        const t = await compareTexture(still, frames[0], { faces: deps.faces, minRatio: deps.config.runtime.qa.texture_min_ratio * 0.6, sameFraming: false })
        if (t.smoothed) findings.push({ code: 'skin_smoothed', severity: 'warn', message: 'The skin looks smoothed in this take compared with the still. Look closely before keeping it.' })
      }
    } catch (e) {
      findings.push({ code: 'uncertain', severity: 'warn', message: `The automatic check could not run on this take (${(e as Error).message}). Look at the face yourself.` })
    }
    const report = finalize(findings, null)
    await deps.db.update(candidates).set({ status: 'in_review', qaReport: report, qaVerdict: report.verdict }).where(eq(candidates.id, id))
  } else {
    await newCandidate(deps, job, { parentId, op: 'video', status: 'failed', rejectNote: out.error ?? '' })
  }
  await refreshSceneStatus(deps, ctx, sceneIdOf(job))
}

// "Upscale this take": the same frames, more detail. If the skin comes out
// smoothed, the upscale is flagged and the original take stays.
async function onVideoUpscale(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const parentId = parentCandidateOf(job) ?? null
  const asset = out.assets?.find(a => a.kind === 'video') ?? out.assets?.[0]
  const src = (job.request as GenRequest).sourceVideo?.assetId
  if (out.status === 'completed' && asset) {
    const findings: QaReport['findings'] = [{ code: 'uncertain', severity: 'info', message: 'Upscaled take: the same frames with more detail.' }]
    let smoothed = false
    try {
      if (src) {
        const [a] = await clipFrames(deps, ctx, src, [0.5])
        const [b] = await clipFrames(deps, ctx, asset.id, [0.5])
        const t = await compareTexture(a!, b!, { faces: deps.faces, minRatio: deps.config.runtime.qa.texture_min_ratio, sameFraming: true })
        smoothed = t.smoothed
        findings.push(t.smoothed
          ? { code: 'skin_smoothed', severity: 'fail', message: `${t.message} The original take stays; try the upscale again or keep the original.` }
          : { code: 'skin_real', severity: 'info', message: t.message })
      }
    } catch (e) {
      findings.push({ code: 'uncertain', severity: 'warn', message: `The texture check could not run (${(e as Error).message}). Compare the skin with the original take yourself.` })
    }
    const report = finalize(findings, null)
    await newCandidate(deps, job, { assetId: asset.id, parentId, op: 'video_upscale', status: smoothed ? 'qa_failed' : 'in_review', qaReport: report, qaVerdict: report.verdict })
  } else {
    await newCandidate(deps, job, { parentId, op: 'video_upscale', status: 'failed', rejectNote: out.error ?? '' })
  }
  await refreshSceneStatus(deps, ctx, sceneIdOf(job))
}

interface QaMeta { sceneId?: string; candidateId?: string; pass?: string; group?: string; faceRefs?: Array<{ refId: string; assetId: string }>; framing?: string; texture?: QaReport['texture'] }

async function siblings(deps: Deps, job: JobRow): Promise<JobRow[]> {
  const req = job.request as { parentJobId?: string; meta?: QaMeta }
  if (req.parentJobId) return (await childJobs(deps, req.parentJobId)).filter(c => c.purpose.startsWith('scene_qa:'))
  if (!req.meta?.group) return [job]
  return deps.db.select().from(jobs).where(sql`${jobs.request}->'meta'->>'group' = ${req.meta.group}`)
}

async function onSceneQa(deps: Deps, ctx: Ctx, job: JobRow, _out: JobOutcome): Promise<void> {
  const meta = (job.request as { meta?: QaMeta }).meta ?? {}
  if (!meta.candidateId) return
  const all = await siblings(deps, job)
  if (all.some(s => ACTIVE.includes(s.status))) return
  const pass = (s: JobRow) => (s.request as { meta?: QaMeta }).meta?.pass
  const orig = all.find(s => pass(s) === 'orig')
  const mirror = all.find(s => pass(s) === 'mirror')
  const [cand] = await deps.db.select({ id: candidates.id, assetId: candidates.assetId, status: candidates.status, qaReport: candidates.qaReport, provider: jobs.provider })
    .from(candidates).leftJoin(jobs, eq(jobs.id, candidates.jobId))
    .where(and(eq(candidates.accountId, job.accountId), eq(candidates.id, meta.candidateId)))
  if (!cand) return
  const scene = await getScene(deps, ctx, sceneIdOf(job))
  const f = sceneFields(deps, scene)
  const ch = toData(await getCharacter(deps, ctx, job.characterId!))
  const { views, scenes: sc } = deps.config.pipeline

  // The face is measured, not read: skipped when it is small by design or
  // turned away (profiles and backs).
  const framing = sc.framings.find(x => x.id === f.framing)
  const view = views.views[f.view]
  const skip = framing?.identity === 'skip' ? 'The character is small in this frame by design, so identity was not scored. Check the face yourself.'
    : view?.identity === 'skip' ? `Face matching is skipped for the ${view.label.toLowerCase()} angle; check the face yourself.` : undefined
  const id = cand.assetId
    ? await scoreSceneIdentity(deps, ctx, { assetId: cand.assetId, refs: meta.faceRefs ?? [], demo: cand.provider === 'mock', skip })
    : { findings: [], identity: null }
  const texture = meta.texture ?? (cand.qaReport as QaReport | null)?.texture ?? null
  if (texture?.smoothed) id.findings.push({ code: 'skin_smoothed', severity: 'fail', message: texture.message })

  let report: QaReport
  if (!orig || orig.status !== 'completed') {
    report = finalize([{ code: 'uncertain', severity: 'warn', message: `Automatic QA could not run (${(orig?.error as { message?: string } | null)?.message ?? 'no result'}). Check this still yourself.` }, ...id.findings], null)
  } else {
    try {
      const observation = parseObservation((orig.resultMeta as { data: unknown }).data)
      const mirrored = mirror?.status === 'completed' ? parseObservation((mirror.resultMeta as { data: unknown }).data) : undefined
      const sw = await ruleSwitches(deps, ctx, job.characterId)
      const rules = { logos: sw.on('qa-logos') && sw.on('scene-brand-free') && !f.brands, jewelry: sw.on('qa-extra-jewelry'), mirror: sw.on('qa-mirror') }
      const input = { views, marks: ch.marks, jewelryAsked: f.jewelry, framing: f.framing, eyeColor: ch.eyes, observation, mirrored, pronoun: ch.pronouns.poss, extraFindings: id.findings, rules }
      const scored = evaluateScene(input)
      scored.mirrorFix = sceneMirrorFix(input, scored)
      report = scored
    } catch (e) {
      report = finalize([{ code: 'uncertain', severity: 'warn', message: `The QA answer could not be read (${(e as Error).message}). Check this still yourself.` }, ...id.findings], null)
    }
  }
  report.identity = id.identity
  report.texture = texture

  // A re-check only attaches the new report; a person then decides.
  const recheck = !(job.request as { parentJobId?: string }).parentJobId
  const patch: Partial<typeof candidates.$inferInsert> = { qaReport: report, qaVerdict: report.verdict, updatedAt: deps.clock.now() }
  if (!recheck) patch.status = report.verdict === 'regenerate' ? 'qa_failed' : 'in_review'
  await deps.db.update(candidates).set(patch).where(and(eq(candidates.accountId, job.accountId), eq(candidates.id, cand.id)))
  await refreshSceneStatus(deps, ctx, scene.id)
}

let registered = false
export function registerSceneHooks(): void {
  if (registered) return
  registered = true
  registerJobHook('scene_plan', onScenePlan)
  registerJobHook('scene', onScene)
  registerJobHook('drift_lock', onDriftLock)
  registerJobHook('scene_edit', onSceneEdit)
  registerJobHook('scene_upscale', onSceneEdit)
  registerJobHook('scene_end_frame', onSceneEdit)
  registerJobHook('scene_video', onSceneVideo)
  registerJobHook('scene_video_upscale', onVideoUpscale)
  registerJobHook('scene_qa', onSceneQa)
}
