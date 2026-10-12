import { and, eq, sql } from 'drizzle-orm'
import { candidates, concepts, jobs, refImages } from '../db/schema'
import type { Ctx, Deps } from '../context'
import { newId } from '../lib/ids'
import { registerJobHook, type JobOutcome, type JobRow } from '../jobs/hooks'
import { activateChildren, cancelChildren, childJobs } from '../jobs/runner'
import { breakdownSchema, conceptsSchema } from '../core/llmSchemas'
import { validateCharacter } from '../core/character'
import { evaluateSheetShot, finalize, type QaReport } from '../core/qa/marks'
import { parseObservation } from '../core/qa/perception'
import { getCharacter, getRef, setCharacterFields, toData } from './characters'
import { refreshRefStatus } from './review'

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
    for (const asset of out.assets ?? []) await createCandidate(deps, ctx, job, { target: 'hero', heroPromptIndex: index, assetId: asset.id, status: 'in_review' })
  } else {
    await createCandidate(deps, ctx, job, { target: 'hero', heroPromptIndex: index, status: 'failed', rejectNote: out.error ?? '' })
  }
}

async function onUpscale(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed' || !out.assets?.[0]) return
  const ref = await getRef(deps, ctx, job.characterId!, 'REF-00')
  const id = await createCandidate(deps, ctx, job, { refId: 'REF-00', assetId: out.assets[0].id, status: 'approved', reviewedAt: deps.clock.now() })
  if (ref.approvedCandidateId) await deps.db.update(candidates).set({ status: 'superseded' }).where(eq(candidates.id, ref.approvedCandidateId))
  await deps.db.update(refImages).set({ approvedCandidateId: id, status: 'approved', updatedAt: deps.clock.now() }).where(eq(refImages.id, ref.id))
}

async function onSheet(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const refId = job.purpose.split(':')[1]!
  const children = await childJobs(deps, job.id)
  if (out.status === 'completed' && out.assets?.[0]) {
    const asset = out.assets[0]
    const candId = await createCandidate(deps, ctx, job, { refId, assetId: asset.id, status: children.length ? 'qa_pending' : 'in_review' })
    // QA was quoted with the shot; start it now that the image exists.
    await activateChildren(deps, job.id, child => ({ imageAssetIds: [asset.id], estimateImages: undefined, meta: { ...((child.request as { meta?: object }).meta ?? {}), candidateId: candId } }))
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
  const meta = (job.request as { meta?: { candidateId?: string; refId?: string } }).meta ?? {}
  if (!meta.candidateId || !meta.refId) return
  const siblings = await qaSiblings(deps, job)
  if (siblings.some(s => ['waiting', 'queued', 'submitting', 'running', 'ingesting'].includes(s.status))) return
  const pass = (s: JobRow) => (s.request as { meta?: { pass?: string } }).meta?.pass
  const orig = siblings.find(s => pass(s) === 'orig')
  const mirror = siblings.find(s => pass(s) === 'mirror')
  const ch = toData(await getCharacter(deps, ctx, job.characterId!))
  const shot = deps.config.pipeline.sheet.shots.find(s => s.id === meta.refId)!

  let report: QaReport
  if (!orig || orig.status !== 'completed') {
    report = finalize([{ code: 'uncertain', severity: 'warn', message: `Automatic QA could not run (${(orig?.error as { message?: string } | null)?.message ?? 'no result'}). Check this shot yourself.` }], null)
  } else {
    try {
      const observation = parseObservation((orig.resultMeta as { data: unknown }).data)
      const mirrored = mirror?.status === 'completed' ? parseObservation((mirror.resultMeta as { data: unknown }).data) : undefined
      report = evaluateSheetShot({ shot, views: deps.config.pipeline.views, marks: ch.marks, eyeColor: ch.eyes, observation, mirrored, pronoun: ch.pronouns.poss })
    } catch (e) {
      report = finalize([{ code: 'uncertain', severity: 'warn', message: `The QA answer could not be read (${(e as Error).message}). Check this shot yourself.` }], null)
    }
  }
  report.findings.push({ code: 'identity_skipped', severity: 'info', message: 'Face matching is not set up yet, so identity was not scored automatically.' })

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
}
