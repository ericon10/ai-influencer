import { and, eq, inArray, like, ne, or } from 'drizzle-orm'
import { candidates, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import type { GenRequest } from '../providers/types.js'
import { gateFor, recreateGate, setRecreateGate, type GateNumbers } from './clone.js'
import { getSetting, setSetting } from './settings.js'

// The Recreate gate check (owner, round 18): after every 10 real recreates
// (a video made from a still on a real model, not the demo), the face match
// and margin of the stills the owner made the videos from, next to the
// stills passed over, with suggested gate numbers. Suggest only: nothing
// changes until the owner approves.

const REVIEW_KEY = 'recreate_gate_review'
const EVERY = 10
// SFace's own "same person" bar; a suggestion never goes below it.
const FACE_FLOOR = 0.363

export interface GateSample {
  postId: string; candidateId: string; assetId: string | null; pass: 'still' | 'face'
  face: number | null; likeness: number | null; margin: number | null; model: string | null; at: string
}

export interface GateCheckView {
  count: number; every: number; reviewedAt: number; due: boolean; nextAt: number
  current: GateNumbers; suggested: GateNumbers | null
  picked: GateSample[]; passedOver: GateSample[]
  // How the stills fare: picked stills that pass, passed-over stills held.
  effect: { current: { pickedPass: number; passedOverHeld: number }; suggested: { pickedPass: number; passedOverHeld: number } | null }
  why: string[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100

function sample(c: typeof candidates.$inferSelect, postId: string, model: string | null): GateSample {
  const meta = (c.meta ?? {}) as { pass?: 'still' | 'face'; faceScore?: number | null; sourceScore?: number | null }
  const face = meta.faceScore ?? null
  const likeness = meta.sourceScore ?? null
  return { postId, candidateId: c.id, assetId: c.assetId, pass: meta.pass ?? 'still', face, likeness, margin: face != null && likeness != null ? r3(face - likeness) : null, model, at: c.createdAt.toISOString() }
}

// Just under the lowest picked face and margin, just over the highest
// picked likeness, never below the standard face match.
export function suggestGate(current: GateNumbers, picked: GateSample[]): { numbers: GateNumbers | null; why: string[] } {
  const faces = picked.map(p => p.face).filter((v): v is number => v != null)
  const margins = picked.map(p => p.margin).filter((v): v is number => v != null)
  const likes = picked.map(p => p.likeness).filter((v): v is number => v != null)
  if (!faces.length) return { numbers: null, why: ['No picked still has face scores yet (demo stills are not scored).'] }
  const why: string[] = []
  const face_min = Math.max(FACE_FLOOR, floor2(Math.min(...faces) - 0.03))
  why.push(`Face: the lowest picked still matched REF-00 at ${Math.min(...faces).toFixed(2)}; ${face_min.toFixed(3).replace(/0$/, '')} keeps it with room to spare${face_min === FACE_FLOOR ? ' (the standard face match is the floor)' : ''}.`)
  const margin = margins.length ? Math.max(0.05, floor2(Math.min(...margins) - 0.03)) : current.margin
  why.push(margins.length ? `Margin: the smallest picked margin was ${Math.min(...margins).toFixed(2)}; ${margin.toFixed(2)} keeps it.` : 'Margin: no picked still had a face in the clip to compare with; it stays.')
  const source_max = likes.length ? Math.min(0.5, Math.max(0.3, ceil2(Math.max(...likes) + 0.03))) : current.source_max
  why.push(likes.length ? `Likeness: the highest picked likeness was ${Math.max(...likes).toFixed(2)}; under ${source_max.toFixed(2)} keeps it.` : 'Likeness: nothing to compare with; it stays.')
  return { numbers: { face_min, margin, source_max }, why }
}

function effectOf(g: GateNumbers, picked: GateSample[], passedOver: GateSample[]) {
  const ok = (s: GateSample) => gateFor(g, { status: 'approved', faceScore: s.face, sourceScore: s.likeness, demo: false }).ok
  return { pickedPass: picked.filter(ok).length, passedOverHeld: passedOver.filter(s => !ok(s)).length }
}

export async function gateCheck(deps: Deps, ctx: Ctx): Promise<GateCheckView> {
  const motion = new Set(deps.config.models.models.filter(m => m.clone?.mode === 'motion').map(m => m.ref))
  // Real recreates: finished motion videos on a real model.
  const runs = (await deps.db.select({ id: jobs.id, purpose: jobs.purpose, request: jobs.request, characterId: jobs.characterId, provider: jobs.provider })
    .from(jobs).where(and(eq(jobs.accountId, ctx.accountId), like(jobs.purpose, 'clone:%'), eq(jobs.status, 'completed'), ne(jobs.provider, 'mock'))))
    .filter(j => motion.has((j.request as GenRequest).modelRef ?? ''))
  const picked: GateSample[] = []
  const passedOver: GateSample[] = []
  const seen = new Set<string>()
  for (const run of runs) {
    const postId = run.purpose.split(':')[1]!
    const stillAsset = (run.request as GenRequest).refs?.[0]?.assetId
    const made = await deps.db.select({ id: jobs.id, request: jobs.request }).from(jobs)
      .where(and(eq(jobs.accountId, ctx.accountId), or(like(jobs.purpose, `clone_still:${postId}:%`), like(jobs.purpose, `clone_face:${postId}:%`))))
    if (!made.length) continue
    const modelOf = new Map(made.map(m => [m.id, (m.request as GenRequest).modelRef ?? null]))
    const rows = await deps.db.select().from(candidates)
      .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.op, 'clone_still'), inArray(candidates.jobId, made.map(m => m.id)), ...(run.characterId ? [eq(candidates.characterId, run.characterId)] : [])))
    const pick = rows.find(c => c.assetId === stillAsset)
    if (!pick) continue
    if (!seen.has(pick.id)) { seen.add(pick.id); picked.push(sample(pick, postId, modelOf.get(pick.jobId ?? '') ?? null)) }
    for (const c of rows) {
      if (c.id === pick.id || seen.has(c.id) || !c.assetId || c.status === 'failed') continue
      seen.add(c.id)
      passedOver.push(sample(c, postId, modelOf.get(c.jobId ?? '') ?? null))
    }
  }
  // A still picked for one video and passed over for another counts as picked.
  const pickedIds = new Set(picked.map(p => p.candidateId))
  const others = passedOver.filter(p => !pickedIds.has(p.candidateId))
  const reviewedAt = (await getSetting<{ count?: number } | null>(deps.db, ctx.accountId, REVIEW_KEY, null))?.count ?? 0
  const count = runs.length
  const current = await recreateGate(deps, ctx)
  const s = suggestGate(current, picked)
  const same = s.numbers && s.numbers.face_min === current.face_min && s.numbers.margin === current.margin && s.numbers.source_max === current.source_max
  return {
    count, every: EVERY, reviewedAt, due: count - reviewedAt >= EVERY, nextAt: reviewedAt + EVERY,
    current, suggested: same ? null : s.numbers,
    picked, passedOver: others,
    effect: { current: effectOf(current, picked, others), suggested: s.numbers && !same ? effectOf(s.numbers, picked, others) : null },
    why: same ? ['The current numbers already fit the stills you picked.', ...s.why] : s.why,
  }
}

// "Use these numbers" (the suggestion, worked out again here, never taken
// from the page) or "Keep the current numbers". Either closes the check
// until the next 10.
export async function answerGateCheck(deps: Deps, ctx: Ctx, use: boolean): Promise<GateCheckView> {
  const view = await gateCheck(deps, ctx)
  if (use) {
    if (!view.suggested) throw new AppError('bad_request', 'There are no new numbers to use.')
    await setRecreateGate(deps, ctx, view.suggested)
  }
  await setSetting(deps, ctx, REVIEW_KEY, { count: view.count, at: deps.clock.now().toISOString(), used: use ? view.suggested : null })
  return gateCheck(deps, ctx)
}
