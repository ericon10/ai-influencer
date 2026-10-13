import { and, eq } from 'drizzle-orm'
import { candidates } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { finalize, type QaFinding, type QaReport } from '../core/qa/marks.js'
import { compareTexture } from '../qa/texture.js'
import { readAsset } from '../storage/assets.js'
import { getRef } from './characters.js'
import { scoreIdentity } from './identity.js'

// Imported sheet images (for example Callie's "CALLIE MASTER CHARACTER"
// folder) are checked for free on the worker: a face match against REF-00
// and the skin texture check. Shots stay approved; any failure is attached
// to the shot and shown on the Sheet tab.

export async function startImportCheck(deps: Deps, ctx: Ctx, characterId: string, refIds: string[]): Promise<string> {
  const job = await enqueueLocalJob(deps, ctx, {
    stage: 'sheet', purpose: 'import_check', characterId,
    label: `Check ${refIds.length} imported sheet image${refIds.length === 1 ? '' : 's'}`,
    request: { refIds: [...new Set(refIds)].sort() },
  })
  return job.id
}

async function approved(deps: Deps, ctx: Ctx, characterId: string, refId: string): Promise<{ candidateId: string; assetId: string } | null> {
  const ref = await getRef(deps, ctx, characterId, refId)
  if (!ref.approvedCandidateId) return null
  const [c] = await deps.db.select({ id: candidates.id, assetId: candidates.assetId }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, ref.approvedCandidateId)))
  return c?.assetId ? { candidateId: c.id, assetId: c.assetId } : null
}

export interface ImportCheckResult { refId: string; verdict: QaReport['verdict']; summary: string }

export async function runImportCheck(deps: Deps, ctx: Ctx, job: JobRow): Promise<{ results: ImportCheckResult[] }> {
  const { refIds } = job.request as { refIds: string[] }
  const characterId = job.characterId!
  const shots = deps.config.pipeline.sheet.shots
  const views = deps.config.pipeline.views.views
  const ref00 = await approved(deps, ctx, characterId, 'REF-00')
  const ref00Data = ref00 ? (await readAsset(deps, ctx, ref00.assetId)).data : null
  const results: ImportCheckResult[] = []
  for (const refId of refIds) {
    const shot = shots.find(s => s.id === refId)
    const cand = shot ? await approved(deps, ctx, characterId, refId) : null
    if (!shot || !cand) continue
    const id = await scoreIdentity(deps, ctx, { characterId, shot, assetId: cand.assetId })
    const findings: QaFinding[] = [...id.findings]
    let texture: QaReport['texture'] = null
    if (refId !== 'REF-00' && ref00Data && views[shot.view]?.identity !== 'skip') {
      try {
        const t = await compareTexture(ref00Data, (await readAsset(deps, ctx, cand.assetId)).data, { faces: deps.faces, minRatio: deps.config.runtime.qa.texture_min_ratio })
        texture = { ratio: t.ratio, smoothed: t.smoothed, region: t.region, message: t.message }
        findings.push(!t.judged
          ? { code: 'uncertain', severity: 'info', message: t.message }
          : t.smoothed
            ? { code: 'skin_smoothed', severity: 'fail', message: `${t.message.replace(/ Rerun it;.*$/, '')} Compared with REF-00.` }
            : { code: 'skin_real', severity: 'info', message: `${t.message} Compared with REF-00.` })
      } catch (e) {
        findings.push({ code: 'uncertain', severity: 'warn', message: `The skin texture check could not run (${(e as Error).message}).` })
      }
    }
    const report: QaReport = { ...finalize(findings, null), identity: id.identity, texture }
    await deps.db.update(candidates).set({ qaReport: report, qaVerdict: report.verdict, updatedAt: deps.clock.now() })
      .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, cand.candidateId)))
    results.push({ refId, verdict: report.verdict, summary: report.summary })
  }
  return { results }
}

let registered = false
export function registerImportCheck(): void {
  if (registered) return
  registered = true
  registerLocalJob('import_check', runImportCheck)
}
