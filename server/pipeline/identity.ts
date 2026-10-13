import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { candidates } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import type { SheetShot } from '../config/pipeline.js'
import type { IdentityScore, QaFinding } from '../core/qa/marks.js'
import { cosineSimilarity, type FaceAnalysis } from '../qa/faces.js'
import { readAsset } from '../storage/assets.js'
import { getRef, inspirationAssetIds } from './characters.js'

// Face-embedding checks from SPEC 6: a sheet shot must be the same person
// as REF-00 (or its closest-angle ref), and a hero must not be the person in
// the inspiration image.

export interface IdentityResult {
  findings: QaFinding[]
  identity: IdentityScore | null
}

const fmt = (x: number) => x.toFixed(2)
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function analyzeAsset(deps: Deps, ctx: Ctx, assetId: string): Promise<FaceAnalysis | null> {
  const { row, data } = await readAsset(deps, ctx, assetId)
  return deps.faces.analyze(data, row.checksumSha256 ?? undefined)
}

async function facesReady(deps: Deps): Promise<string | null> {
  const s = await deps.faces.status()
  return s.available ? null : (s.reason ?? 'Face matching is not available.')
}

// The refs a shot is compared with: REF-00 plus its approved, face-showing
// attach refs (the closest angles).
async function referenceAssets(deps: Deps, ctx: Ctx, characterId: string, shot: SheetShot): Promise<Array<{ refId: string; assetId: string }>> {
  const views = deps.config.pipeline.views.views
  const shots = deps.config.pipeline.sheet.shots
  const ids = ['REF-00', ...shot.attach].filter((id, i, all) => all.indexOf(id) === i && id !== shot.id)
  const out: Array<{ refId: string; assetId: string; candidateId: string }> = []
  for (const refId of ids) {
    const def = shots.find(s => s.id === refId)
    if (!def || views[def.view]?.identity === 'skip') continue
    const ref = await getRef(deps, ctx, characterId, refId)
    if (!ref.approvedCandidateId || (refId !== 'REF-00' && ref.status !== 'approved')) continue
    out.push({ refId, assetId: '', candidateId: ref.approvedCandidateId })
  }
  if (!out.length) return []
  const rows = await deps.db.select({ id: candidates.id, assetId: candidates.assetId }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, out.map(o => o.candidateId))))
  const byId = new Map(rows.map(r => [r.id, r.assetId]))
  return out.map(o => ({ refId: o.refId, assetId: byId.get(o.candidateId) ?? '' })).filter(o => o.assetId)
}

const DEMO = 'Demo images have no real face, so face matching runs on live results only.'

export async function scoreIdentity(deps: Deps, ctx: Ctx, input: { characterId: string; shot: SheetShot; assetId: string; demo?: boolean }): Promise<IdentityResult> {
  const { shot } = input
  const view = deps.config.pipeline.views.views[shot.view]
  const skip = (message: string): IdentityResult => ({ findings: [{ code: 'identity_skipped', severity: 'info', message }], identity: null })
  if (input.demo) return skip(DEMO)
  if (view?.identity === 'skip') return skip(`Face matching is skipped for the ${view.label.toLowerCase()} angle; check the face yourself.`)
  if (shot.id === 'REF-00') return skip('REF-00 is the reference face, so there is nothing to match it against.')
  const unavailable = await facesReady(deps)
  if (unavailable) return skip(`Face matching is off: ${unavailable}`)

  const refs = await referenceAssets(deps, ctx, input.characterId, shot)
  if (!refs.length) return skip('No approved reference face yet, so identity was not scored.')
  const threshold = deps.config.pipeline.review.qa.identity_min_similarity
  try {
    const candidate = await analyzeAsset(deps, ctx, input.assetId)
    if (!candidate) {
      return { findings: [{ code: 'uncertain', severity: 'warn', message: 'No clear face was found, so identity could not be scored.' }], identity: null }
    }
    let best: { refId: string; score: number } | null = null
    for (const ref of refs) {
      const face = await analyzeAsset(deps, ctx, ref.assetId)
      if (!face) continue
      const score = cosineSimilarity(candidate.embedding, face.embedding)
      if (!best || score > best.score) best = { refId: ref.refId, score }
    }
    if (!best) return skip('No face was found in the reference images, so identity was not scored.')
    const identity: IdentityScore = { kind: 'identity', score: best.score, threshold, against: best.refId }
    if (best.score < threshold) {
      return { identity, findings: [{ code: 'face_drift', severity: 'fail', message: `The face does not match ${best.refId} (match ${fmt(best.score)}, needs ${fmt(threshold)}). Face drift is never an edit; regenerate.` }] }
    }
    return { identity, findings: [{ code: 'identity_match', severity: 'info', message: `Same face as ${best.refId} (match ${fmt(best.score)}).` }] }
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, 'identity check failed')
    return { findings: [{ code: 'uncertain', severity: 'warn', message: `Face matching failed (${(e as Error).message}). Check the face yourself.` }], identity: null }
  }
}

// A hero must be a new person: no closer to any inspiration face than the
// distinctness threshold. Inspirations without a face are ignored.
export async function scoreDistinctness(deps: Deps, ctx: Ctx, input: { characterId: string; assetId: string; demo?: boolean }): Promise<IdentityResult | null> {
  const inspirations = await inspirationAssetIds(deps, ctx, input.characterId)
  if (!inspirations.length) return null
  if (input.demo) return { findings: [{ code: 'identity_skipped', severity: 'info', message: DEMO }], identity: null }
  const unavailable = await facesReady(deps)
  if (unavailable) return { findings: [{ code: 'identity_skipped', severity: 'info', message: `Face matching is off, so distinctness from the inspiration was not scored: ${unavailable}` }], identity: null }
  const threshold = deps.config.pipeline.review.qa.distinctness_max_similarity
  try {
    const hero = await analyzeAsset(deps, ctx, input.assetId)
    if (!hero) return { findings: [{ code: 'uncertain', severity: 'warn', message: 'No clear face was found in this hero.' }], identity: null }
    let worst: { index: number; score: number } | null = null
    for (const [index, assetId] of inspirations.entries()) {
      const face = await analyzeAsset(deps, ctx, assetId)
      if (!face) continue
      const score = cosineSimilarity(hero.embedding, face.embedding)
      if (!worst || score > worst.score) worst = { index, score }
    }
    if (!worst) return null
    const identity: IdentityScore = { kind: 'distinctness', score: worst.score, threshold, against: `inspiration ${worst.index + 1}` }
    if (worst.score >= threshold) {
      return { identity, findings: [{ code: 'too_similar', severity: 'fail', message: `Too close to the person in inspiration ${worst.index + 1} (match ${fmt(worst.score)}, must stay under ${fmt(threshold)}). The character must be a new person.` }] }
    }
    return { identity, findings: [{ code: 'identity_match', severity: 'info', message: `A new person: well clear of the inspiration (match ${fmt(worst.score)}).` }] }
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, 'distinctness check failed')
    return { findings: [{ code: 'uncertain', severity: 'warn', message: `Face matching failed (${(e as Error).message}).` }], identity: null }
  }
}

// Scenes (Stage 7): the still against the face and closest-angle refs it was
// made with. A face too small to judge is skipped, and when other people are
// in the frame a miss goes to a person instead of failing (the largest face
// may be someone else).
const MIN_SCENE_FACE = 64

export async function scoreSceneIdentity(deps: Deps, ctx: Ctx, input: { assetId: string; refs: Array<{ refId: string; assetId: string }>; demo?: boolean; skip?: string }): Promise<IdentityResult> {
  const skip = (message: string): IdentityResult => ({ findings: [{ code: 'identity_skipped', severity: 'info', message }], identity: null })
  if (input.demo) return skip(DEMO)
  if (input.skip) return skip(input.skip)
  const unavailable = await facesReady(deps)
  if (unavailable) return skip(`Face matching is off: ${unavailable}`)
  if (!input.refs.length) return skip('No approved reference face yet, so identity was not scored.')
  const threshold = deps.config.pipeline.review.qa.identity_min_similarity
  try {
    const candidate = await analyzeAsset(deps, ctx, input.assetId)
    if (!candidate) return { findings: [{ code: 'uncertain', severity: 'warn', message: 'No clear face was found, so identity could not be scored. Check the face yourself.' }], identity: null }
    if (Math.min(candidate.face.box.w, candidate.face.box.h) < MIN_SCENE_FACE) return skip('The face is small in this frame, so identity was not scored. Check the face yourself.')
    let best: { refId: string; score: number } | null = null
    for (const ref of input.refs) {
      const face = await analyzeAsset(deps, ctx, ref.assetId)
      if (!face) continue
      const score = cosineSimilarity(candidate.embedding, face.embedding)
      if (!best || score > best.score) best = { refId: ref.refId, score }
    }
    if (!best) return skip('No face was found in the reference images, so identity was not scored.')
    const identity: IdentityScore = { kind: 'identity', score: best.score, threshold, against: best.refId }
    if (best.score >= threshold) return { identity, findings: [{ code: 'identity_match', severity: 'info', message: `Same face as ${best.refId} (match ${fmt(best.score)}).` }] }
    if (candidate.faces > 1) {
      return { identity, findings: [{ code: 'uncertain', severity: 'warn', message: `There are ${candidate.faces} faces in the frame and the largest one does not match ${best.refId} (match ${fmt(best.score)}). Check that the main face is the character.` }] }
    }
    return { identity, findings: [{ code: 'face_drift', severity: 'fail', message: `The face does not match ${best.refId} (match ${fmt(best.score)}, needs ${fmt(threshold)}). Face drift is never an edit; regenerate.` }] }
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, 'scene identity check failed')
    return { findings: [{ code: 'uncertain', severity: 'warn', message: `Face matching failed (${(e as Error).message}). Check the face yourself.` }], identity: null }
  }
}

// Clone Video: the result must be the character, never the person in the
// source clip (fixed: a new person, never a copy). Each result frame is
// compared with the source frame at the same moment.
export async function scorePerformer(deps: Deps, ctx: Ctx, input: { pairs: Array<{ result: Buffer; source: Buffer }>; name: string; demo?: boolean }): Promise<IdentityResult> {
  const skip = (message: string): IdentityResult => ({ findings: [{ code: 'identity_skipped', severity: 'info', message }], identity: null })
  if (input.demo) return skip(DEMO)
  const unavailable = await facesReady(deps)
  if (unavailable) return skip(`Face matching is off, so the clone was not compared with the person in the source clip: ${unavailable}`)
  const threshold = deps.config.pipeline.review.qa.distinctness_max_similarity
  try {
    let worst: number | null = null
    for (const p of input.pairs) {
      const [r, s] = [await deps.faces.analyze(p.result, sha256(p.result)), await deps.faces.analyze(p.source, sha256(p.source))]
      if (!r || !s) continue
      const score = cosineSimilarity(r.embedding, s.embedding)
      if (worst == null || score > worst) worst = score
    }
    if (worst == null) return skip('No face showed in both the clone and the source clip at the same moment, so they were not compared. Check the face yourself.')
    const identity: IdentityScore = { kind: 'distinctness', score: worst, threshold, against: 'the source clip' }
    if (worst >= threshold) {
      return { identity, findings: [{ code: 'too_similar', severity: 'fail', message: `This looks like the person in the source clip (match ${fmt(worst)}, must stay under ${fmt(threshold)}), not ${input.name}. A clone must be the character, so it is not kept. Try another model or a clearer character image.` }] }
    }
    return { identity, findings: [{ code: 'identity_match', severity: 'info', message: `Not the person in the source clip (match ${fmt(worst)}).` }] }
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, 'performer check failed')
    return { findings: [{ code: 'uncertain', severity: 'warn', message: `Comparing with the source clip failed (${(e as Error).message}). Check the face yourself.` }], identity: null }
  }
}
