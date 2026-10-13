import { and, eq, inArray } from 'drizzle-orm'
import { candidates, refImages } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { invalidationFor } from '../core/sheet.js'
import { AppError } from '../lib/errors.js'
import { audit } from '../lib/audit.js'
import sharp from 'sharp'
import { getAsset, readAsset, saveAsset } from '../storage/assets.js'
import { newId } from '../lib/ids.js'
import type { QaReport } from '../core/qa/marks.js'
import { candidatesFor, getCandidate, getCharacter, getRef, setCharacterFields, sheetState } from './characters.js'
import { liveRoute } from './settings.js'
import { refreshSceneStatus } from './scenes.js'

// Human gates (SPEC 6): hero pick and sheet approval. Rejected results are
// archived, never deleted.

// Recomputes a shot's status from its candidates and approval.
export async function refreshRefStatus(deps: Deps, ctx: Ctx, characterId: string, refId: string): Promise<void> {
  const ref = await getRef(deps, ctx, characterId, refId)
  const cands = await candidatesFor(deps, ctx, characterId, { refId })
  let status: string
  if (cands.some(c => c.status === 'generating' || c.status === 'qa_pending')) status = 'generating'
  else if (cands.some(c => c.status === 'in_review')) status = 'in_review'
  else if (ref.approvedCandidateId && ref.staleSince) status = 'stale'
  else if (ref.approvedCandidateId) status = 'approved'
  else status = 'pending'
  if (status !== ref.status) await deps.db.update(refImages).set({ status, updatedAt: deps.clock.now() }).where(eq(refImages.id, ref.id))
}

export async function markDependentsStale(deps: Deps, ctx: Ctx, characterId: string, refId: string): Promise<string[]> {
  const state = await sheetState(deps, ctx, characterId)
  const ids = invalidationFor(state.shots, state.states, refId)
  const now = deps.clock.now()
  for (const id of ids) {
    const r = state.refs.find(x => x.refId === id)!
    await deps.db.update(refImages).set({ status: 'stale', staleReason: `${refId} changed`, staleSince: now, updatedAt: now }).where(eq(refImages.id, r.id))
  }
  return ids
}

export interface ApproveResult { invalidated: string[]; sheetComplete: boolean }

export async function approveCandidate(deps: Deps, ctx: Ctx, candidateId: string): Promise<ApproveResult> {
  const cand = await getCandidate(deps, ctx, candidateId)
  const refId = cand.refId
  if (!refId || !cand.assetId) throw new AppError('bad_request', 'Only sheet shots are approved here. Use "Pick this hero" for heroes.')
  if (!['in_review', 'approved', 'superseded', 'qa_failed', 'rejected'].includes(cand.status)) throw new AppError('conflict', 'This result is not ready for review yet.')
  const ref = await getRef(deps, ctx, cand.characterId, refId)
  const now = deps.clock.now()
  const changed = ref.approvedCandidateId !== cand.id
  await deps.db.transaction(async tx => {
    await tx.update(candidates).set({ status: 'approved', reviewedBy: ctx.userId, reviewedAt: now, updatedAt: now }).where(eq(candidates.id, cand.id))
    await tx.update(candidates).set({ status: 'superseded', updatedAt: now })
      .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, cand.characterId), eq(candidates.refId, refId), eq(candidates.status, 'in_review')))
    await tx.update(refImages).set({ status: 'approved', approvedCandidateId: cand.id, staleReason: '', staleSince: null, updatedAt: now }).where(eq(refImages.id, ref.id))
  })
  const invalidated = changed && ref.approvedCandidateId ? await markDependentsStale(deps, ctx, cand.characterId, refId) : []
  await audit(deps.db, ctx, 'sheet.approved', { type: 'candidate', id: cand.id }, { refId, invalidated })
  const state = await sheetState(deps, ctx, cand.characterId)
  if (state.progress.complete) {
    const ch = await getCharacter(deps, ctx, cand.characterId)
    if (ch.stage < 5) await setCharacterFields(deps, ctx, ch.id, { stage: 5, status: 'active' })
  }
  return { invalidated, sheetComplete: state.progress.complete }
}

export interface FixSuggestion { reason: string; action: string; label: string; available: boolean }

export async function rejectCandidate(deps: Deps, ctx: Ctx, candidateId: string, reasons: string[], note = ''): Promise<FixSuggestion[]> {
  const cand = await getCandidate(deps, ctx, candidateId)
  const known = deps.config.pipeline.review.reasons
  const unknown = reasons.filter(r => !known.some(k => k.id === r))
  if (unknown.length) throw new AppError('bad_request', `Unknown reason: ${unknown.join(', ')}.`)
  const now = deps.clock.now()
  await deps.db.update(candidates).set({ status: 'rejected', rejectReasons: reasons, rejectNote: note.slice(0, 2000), reviewedBy: ctx.userId, reviewedAt: now, updatedAt: now }).where(eq(candidates.id, cand.id))
  if (cand.refId && !cand.sceneId) await refreshRefStatus(deps, ctx, cand.characterId, cand.refId)
  if (cand.sceneId) await refreshSceneStatus(deps, ctx, cand.sceneId)
  return fixesFor(deps, reasons, { scene: !!cand.sceneId })
}

// Each reason chip maps to the fix it triggers (config/review.yaml). One-change
// edits (phase 2) are for scene stills; a sheet shot is regenerated. Video
// fixes arrive in phase 3.
export function fixesFor(deps: Deps, reasons: string[], opts: { scene?: boolean } = {}): FixSuggestion[] {
  const { reasons: known, actions } = deps.config.pipeline.review
  return reasons.map(r => {
    const reason = known.find(k => k.id === r)!
    const action = actions[reason.action]!
    const available = action.phase <= (opts.scene ? 2 : 1)
    const effective = available ? reason.action : action.fallback ?? 'regenerate'
    const why = action.phase === 2 ? 'is for scene stills' : `arrives in phase ${action.phase}`
    return { reason: r, action: effective, label: available ? action.label : `${actions[effective]?.label ?? 'Regenerate'} (the ${action.label.toLowerCase()} ${why})`, available }
  })
}

export async function pickHero(deps: Deps, ctx: Ctx, candidateId: string): Promise<{ needsUpscale: boolean; height: number | null }> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (cand.target !== 'hero' || !cand.assetId) throw new AppError('bad_request', 'That is not a hero result.')
  if ((cand.qaReport as { findings?: Array<{ code: string; severity: string }> } | null)?.findings?.some(f => f.code === 'too_similar' && f.severity === 'fail')) {
    throw new AppError('bad_request', 'This hero is too close to the inspiration person. Pick another one or generate more.')
  }
  const ch = await getCharacter(deps, ctx, cand.characterId)
  const ref = await getRef(deps, ctx, ch.id, 'REF-00')
  const now = deps.clock.now()
  const previous = ref.approvedCandidateId
  await deps.db.transaction(async tx => {
    await tx.update(candidates).set({ status: 'approved', refId: 'REF-00', reviewedBy: ctx.userId, reviewedAt: now, updatedAt: now }).where(eq(candidates.id, cand.id))
    // One hero across all three prompts (SPEC 5.1 rule 2).
    await tx.update(candidates).set({ status: 'superseded', updatedAt: now })
      .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, ch.id), eq(candidates.target, 'hero'), inArray(candidates.status, ['in_review'])))
    await tx.update(refImages).set({ status: 'approved', approvedCandidateId: cand.id, staleReason: '', staleSince: null, updatedAt: now }).where(eq(refImages.id, ref.id))
  })
  if (previous && previous !== cand.id) await markDependentsStale(deps, ctx, ch.id, 'REF-00')
  if (!ch.sheetLock) {
    // Lock the real model, not demo mode's mock (SPEC 5.1 rule 7).
    const route = await liveRoute(deps, ctx, 'sheet')
    await setCharacterFields(deps, ctx, ch.id, { sheetLock: { model: route.model, quality: deps.config.pipeline.sheet.settings.quality, resolution: deps.config.pipeline.sheet.settings.resolution } })
  }
  if (ch.stage < 4) await setCharacterFields(deps, ctx, ch.id, { stage: 4 })
  await audit(deps.db, ctx, 'hero.picked', { type: 'candidate', id: cand.id })
  const asset = await getAsset(deps, ctx, cand.assetId)
  return { needsUpscale: (asset.height ?? 0) < deps.config.pipeline.sheet.settings.upscale_ref00_below_px, height: asset.height }
}

// After a person checks a stale shot and finds it still right.
export async function keepStale(deps: Deps, ctx: Ctx, characterId: string, refId: string): Promise<void> {
  const ref = await getRef(deps, ctx, characterId, refId)
  if (ref.status !== 'stale' || !ref.approvedCandidateId) throw new AppError('conflict', 'That shot is not waiting for a re-check.')
  await deps.db.update(refImages).set({ status: 'approved', staleReason: '', staleSince: null, updatedAt: deps.clock.now() }).where(eq(refImages.id, ref.id))
  await audit(deps.db, ctx, 'sheet.kept_after_recheck', { type: 'ref', id: ref.id }, { refId })
}

export async function setFavorite(deps: Deps, ctx: Ctx, candidateId: string, favorite: boolean): Promise<void> {
  const cand = await getCandidate(deps, ctx, candidateId)
  await deps.db.update(candidates).set({ favorite, updatedAt: deps.clock.now() }).where(eq(candidates.id, cand.id))
}

// Undo for a rejection (or bringing back a superseded result for review).
export async function reopenCandidate(deps: Deps, ctx: Ctx, candidateId: string): Promise<void> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (!['rejected', 'superseded', 'qa_failed'].includes(cand.status) || !cand.assetId) throw new AppError('conflict', 'Only rejected or replaced results can be reopened.')
  await deps.db.update(candidates).set({ status: 'in_review', rejectReasons: [], rejectNote: '', updatedAt: deps.clock.now() }).where(eq(candidates.id, cand.id))
  if (cand.refId && !cand.sceneId) await refreshRefStatus(deps, ctx, cand.characterId, cand.refId)
  if (cand.sceneId) await refreshSceneStatus(deps, ctx, cand.sceneId)
}

// The free fix for a shot whose marks came back on the wrong side: flip it
// horizontally (no provider call, no cost, the face cannot drift). Offered
// only when QA showed that the flip puts every mark on its own side. The
// flipped copy gets the report QA computed for it, and the original stays
// in history.
export async function mirrorCandidate(deps: Deps, ctx: Ctx, candidateId: string): Promise<{ candidateId: string }> {
  const cand = await getCandidate(deps, ctx, candidateId)
  const report = cand.qaReport as QaReport | null
  if (!cand.assetId || (!cand.refId && !cand.sceneId)) throw new AppError('bad_request', 'This result has no image to mirror.')
  if (!report?.mirrorFix?.available || !report.mirrorFix.report) throw new AppError('bad_request', report?.mirrorFix?.message ?? 'QA did not find a mirrored shot here.')
  const { data } = await readAsset(deps, ctx, cand.assetId)
  const flipped = await sharp(data).flop().png().toBuffer()
  const asset = await saveAsset(deps, ctx, { data: flipped, origin: 'derived', label: `${cand.refId ?? 'Scene still'} mirrored fix` })
  const derived: QaReport = {
    ...report.mirrorFix.report,
    identity: report.identity ?? null,
    mirrorFix: null,
    findings: [...report.mirrorFix.report.findings, { code: 'uncertain', severity: 'info', message: 'Mirrored copy of a shot that came back flipped. Checked by mirroring the original inspection; no new generation.' }],
  }
  const id = newId('cand')
  const status = cand.status === 'check' ? 'check' : 'in_review'
  await deps.db.insert(candidates).values({
    id, accountId: ctx.accountId, characterId: cand.characterId, target: cand.target, refId: cand.refId, assetId: asset.id,
    sceneId: cand.sceneId, parentId: cand.sceneId ? cand.id : null, op: cand.sceneId ? 'mirror' : 'generate',
    prompt: cand.prompt, status, qaReport: derived, qaVerdict: derived.verdict, createdBy: ctx.userId,
  })
  await audit(deps.db, ctx, 'candidate.mirrored', { type: 'candidate', id }, { from: cand.id })
  if (cand.sceneId) await refreshSceneStatus(deps, ctx, cand.sceneId)
  else await refreshRefStatus(deps, ctx, cand.characterId, cand.refId!)
  return { candidateId: id }
}
