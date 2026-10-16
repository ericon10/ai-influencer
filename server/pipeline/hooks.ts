import { and, eq, sql } from 'drizzle-orm'
import { candidates, concepts, jobs, refImages } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { activateChildren, cancelChildren, childJobs } from '../jobs/runner.js'
import { breakdownSchema, conceptsSchema } from '../core/llmSchemas.js'
import { validateCharacter } from '../core/character.js'
import { evaluateSheetShot, finalize, mirrorFixFor, type QaReport } from '../core/qa/marks.js'
import { parseObservation } from '../core/qa/perception.js'
import { getCharacter, getRef, setCharacterFields, toData } from './characters.js'
import { refreshRefStatus } from './review.js'
import { scoreDistinctness, scoreIdentity } from './identity.js'
import { onModelTest } from './modelTests.js'
import { registerImportCheck } from './importCheck.js'
import { textureCheck, textureSummary } from './texture.js'
import { freeChecksOnly, registerSceneHooks } from './sceneHooks.js'
import { registerContent } from './content.js'
import { registerClips } from './clips.js'
import { registerClone } from './clone.js'
import { registerRecreate } from './recreate.js'
import { registerOpenReel } from './openreel.js'
import { registerChain } from './chain.js'
import { registerSounds } from './sounds.js'
import { registerVoiceLines } from './voiceLines.js'
import { registerSlideshow } from './slideshow.js'
import { registerScaleKit } from './scaleKit.js'
import { registerCloseup } from './closeup.js'
import { registerStorage } from './storage.js'
import type { GenRequest } from '../providers/types.js'

// What each finished job does to the character. Registered once at boot.

async function createCandidate(deps: Deps, ctx: Ctx, job: JobRow, fields: Partial<typeof candidates.$inferInsert>): Promise<string> {
  const id = newId('cand')
  await deps.db.insert(candidates).values({
    id, accountId: job.accountId, characterId: job.characterId!, jobId: job.id, createdBy: job.userId,
    prompt: (job.request as { prompt?: string }).prompt ?? '', target: 'sheet', ...fields,
  })
  return id
}


async function onBreakdown(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const data = breakdownSchema.parse(out.data)
  await setCharacterFields(deps, ctx, job.characterId!, { breakdown: data })
}

async function onConcepts(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const raw = out.data as { concepts?: Array<Record<string, unknown>> }
  const parsed = conceptsSchema.parse({
    concepts: (raw.concepts ?? []).map(c => ({ ...c, features: { eyes: String(c.eyes ?? (c.features as Record<string, string> | undefined)?.eyes ?? '') } })),
  })
  await deps.db.update(concepts).set({ status: 'discarded' }).where(and(eq(concepts.characterId, job.characterId!), eq(concepts.status, 'proposed')))
  // One insert, so the set shares a timestamp and orders by position.
  const rows = parsed.concepts.slice(0, 3).map((c, i) => ({
    id: newId('cpt'), accountId: job.accountId, characterId: job.characterId!, position: i, sourceJobId: job.id,
    data: { ...c, issues: validateCharacter({ age: c.age, card: c.card, marks: c.marks, body: c.body }) },
  }))
  if (rows.length) await deps.db.insert(concepts).values(rows)
  const ch = await getCharacter(deps, ctx, job.characterId!)
  if (ch.stage < 2) await setCharacterFields(deps, ctx, ch.id, { stage: 2 })
}

async function onHero(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const index = Number(job.purpose.split(':')[1] ?? 0)
  if (out.status === 'completed') {
    for (const asset of out.assets ?? []) {
      // Distinctness (SPEC 6): a hero that is the inspiration person never
      // reaches the pick.
      const check = await scoreDistinctness(deps, ctx, { characterId: job.characterId!, assetId: asset.id, demo: job.provider === 'mock' })
      const report = check ? { ...finalize(check.findings, null), identity: check.identity } : null
      await createCandidate(deps, ctx, job, {
        target: 'hero', heroPromptIndex: index, assetId: asset.id,
        status: report?.verdict === 'regenerate' ? 'qa_failed' : 'in_review',
        qaReport: report, qaVerdict: report?.verdict ?? null,
      })
    }
  } else {
    await createCandidate(deps, ctx, job, { target: 'hero', heroPromptIndex: index, status: 'failed', rejectNote: out.error ?? '' })
  }
}

async function onUpscale(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed' || !out.assets?.[0]) return
  const ref = await getRef(deps, ctx, job.characterId!, 'REF-00')
  const texture = await textureCheck(deps, ctx, (job.request as GenRequest).refs?.[0]?.assetId, out.assets[0].id, true)
  if (texture?.smoothed) {
    // A smoothed upscale never replaces the hero: REF-00 keeps its image and
    // the upscale waits with the reason and a rerun.
    const report = { ...finalize([{ code: 'skin_smoothed', severity: 'fail', message: `${texture.message} Run the upscale again.` }], null), texture: textureSummary(texture) }
    await createCandidate(deps, ctx, job, { refId: 'REF-00', assetId: out.assets[0].id, status: 'qa_failed', qaReport: report, qaVerdict: report.verdict })
    return
  }
  const report = texture ? { ...finalize([{ code: 'skin_real', severity: 'info', message: texture.message }], null), texture: textureSummary(texture) } : null
  const id = await createCandidate(deps, ctx, job, { refId: 'REF-00', assetId: out.assets[0].id, status: 'approved', reviewedAt: deps.clock.now(), qaReport: report, qaVerdict: report?.verdict ?? null })
  if (ref.approvedCandidateId) await deps.db.update(candidates).set({ status: 'superseded' }).where(eq(candidates.id, ref.approvedCandidateId))
  await deps.db.update(refImages).set({ approvedCandidateId: id, status: 'approved', updatedAt: deps.clock.now() }).where(eq(refImages.id, ref.id))
}

async function onSheet(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const refId = job.purpose.split(':')[1]!
  const children = await childJobs(deps, job.id)
  if (out.status === 'completed' && out.assets?.[0]) {
    const asset = out.assets[0]
    // A sheet shot is an edit of its first reference: its skin detail must hold.
    const texture = await textureCheck(deps, ctx, (job.request as GenRequest).refs?.[0]?.assetId, asset.id, false)
    const t = texture ? textureSummary(texture) : null
    if (children.length) {
      const candId = await createCandidate(deps, ctx, job, { refId, assetId: asset.id, status: 'qa_pending' })
      // QA was quoted with the shot; start it now that the image exists.
      await activateChildren(deps, job.id, child => ({ imageAssetIds: [asset.id], estimateImages: undefined, meta: { ...((child.request as { meta?: object }).meta ?? {}), candidateId: candId, texture: t } }))
    } else if (t?.smoothed) {
      const report = { ...finalize([{ code: 'skin_smoothed', severity: 'fail', message: t.message }], null), texture: t }
      await createCandidate(deps, ctx, job, { refId, assetId: asset.id, status: 'qa_failed', qaReport: report, qaVerdict: report.verdict })
    } else {
      // No Claude check (on demand): the free face match still runs.
      const shot = deps.config.pipeline.sheet.shots.find(s => s.id === refId)
      const id = shot ? await scoreIdentity(deps, ctx, { characterId: job.characterId!, shot, assetId: asset.id, demo: job.provider === 'mock' }).catch(() => null) : null
      const findings: QaReport['findings'] = [...(id?.findings ?? []), ...(t ? [{ code: 'skin_real' as const, severity: 'info' as const, message: t.message }] : []), { code: 'uncertain', severity: 'info', message: 'Not checked by Claude. Press Check this for a full check of the mark sides and framing.' }]
      const report = { ...freeChecksOnly(finalize(findings, null)), texture: t, identity: id?.identity ?? null }
      await createCandidate(deps, ctx, job, { refId, assetId: asset.id, status: 'in_review', qaReport: report, qaVerdict: report.verdict })
    }
  } else {
    await createCandidate(deps, ctx, job, { refId, status: 'failed', rejectNote: out.error ?? '' })
    await cancelChildren(deps, job.id, 'The shot it was checking did not finish.')
  }
  await refreshRefStatus(deps, ctx, job.characterId!, refId)
}

async function qaSiblings(deps: Deps, job: JobRow): Promise<JobRow[]> {
  const req = job.request as { parentJobId?: string; meta?: { group?: string } }
  if (req.parentJobId) return childJobs(deps, req.parentJobId)
  const group = req.meta?.group
  if (!group) return [job]
  return deps.db.select().from(jobs).where(sql`${jobs.request}->'meta'->>'group' = ${group}`)
}

async function onQa(deps: Deps, ctx: Ctx, job: JobRow, _out: JobOutcome): Promise<void> {
  const meta = (job.request as { meta?: { candidateId?: string; refId?: string; texture?: QaReport['texture'] } }).meta ?? {}
  if (!meta.candidateId || !meta.refId) return
  const siblings = await qaSiblings(deps, job)
  if (siblings.some(s => ['waiting', 'queued', 'submitting', 'running', 'ingesting'].includes(s.status))) return
  const pass = (s: JobRow) => (s.request as { meta?: { pass?: string } }).meta?.pass
  const orig = siblings.find(s => pass(s) === 'orig')
  const mirror = siblings.find(s => pass(s) === 'mirror')
  const ch = toData(await getCharacter(deps, ctx, job.characterId!))
  const shot = deps.config.pipeline.sheet.shots.find(s => s.id === meta.refId)!

  // Face identity first: it is measured, not read by the vision model.
  const [cand] = await deps.db.select({ assetId: candidates.assetId, provider: jobs.provider, qaReport: candidates.qaReport }).from(candidates)
    .leftJoin(jobs, eq(jobs.id, candidates.jobId))
    .where(and(eq(candidates.accountId, job.accountId), eq(candidates.id, meta.candidateId)))
  const id = cand?.assetId
    ? await scoreIdentity(deps, ctx, { characterId: job.characterId!, shot, assetId: cand.assetId, demo: cand.provider === 'mock' })
    : { findings: [], identity: null }
  // The texture check ran when the shot arrived; a re-check keeps it.
  const texture = meta.texture ?? (cand?.qaReport as QaReport | null)?.texture ?? null
  if (texture?.smoothed) id.findings.push({ code: 'skin_smoothed', severity: 'fail', message: texture.message })

  let report: QaReport
  if (!orig || orig.status !== 'completed') {
    report = finalize([{ code: 'uncertain', severity: 'warn', message: `Automatic QA could not run (${(orig?.error as { message?: string } | null)?.message ?? 'no result'}). Check this shot yourself.` }, ...id.findings], null)
  } else {
    try {
      const observation = parseObservation((orig.resultMeta as { data: unknown }).data)
      const mirrored = mirror?.status === 'completed' ? parseObservation((mirror.resultMeta as { data: unknown }).data) : undefined
      const input = { shot, views: deps.config.pipeline.views, marks: ch.marks, eyeColor: ch.eyes, observation, mirrored, pronoun: ch.pronouns.poss, extraFindings: id.findings }
      report = evaluateSheetShot(input)
      report.mirrorFix = mirrorFixFor(input, report)
    } catch (e) {
      report = finalize([{ code: 'uncertain', severity: 'warn', message: `The QA answer could not be read (${(e as Error).message}). Check this shot yourself.` }, ...id.findings], null)
    }
  }
  report.identity = id.identity
  report.texture = texture

  // Failed results never reach the human queue (SPEC 6); they wait with
  // their reasons and a one-click, quoted fix.
  // A recheck of an approved (stale) shot only attaches the new report; a
  // person then keeps it or regenerates.
  const isRecheck = !(job.request as { parentJobId?: string }).parentJobId
  const patch: Partial<typeof candidates.$inferInsert> = { qaReport: report, qaVerdict: report.verdict, updatedAt: deps.clock.now() }
  if (!isRecheck) patch.status = report.verdict === 'regenerate' ? 'qa_failed' : 'in_review'
  await deps.db.update(candidates).set(patch).where(and(eq(candidates.accountId, job.accountId), eq(candidates.id, meta.candidateId)))
  await refreshRefStatus(deps, ctx, job.characterId!, meta.refId)
}

let registered = false
export function registerPipelineHooks(): void {
  if (registered) return
  registered = true
  registerJobHook('breakdown', onBreakdown)
  registerJobHook('concepts', onConcepts)
  registerJobHook('hero', onHero)
  registerJobHook('upscale', onUpscale)
  registerJobHook('sheet', onSheet)
  registerJobHook('qa', onQa)
  registerJobHook('model_test', onModelTest)
  registerSceneHooks()
  registerImportCheck()
  registerContent()
  registerClips()
  registerClone()
  registerRecreate()
  registerOpenReel()
  registerChain()
  registerSounds()
  registerVoiceLines()
  registerScaleKit()
  registerSlideshow()
  registerCloseup()
  registerStorage()
}
