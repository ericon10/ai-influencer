import type { SheetShot } from '../config/pipeline.js'

// The reference sheet as a dependency graph (SPEC 4.1): shots run in plain
// number order, each depending only on lower numbers, so the next shot is
// always unblocked once earlier shots are approved.

export type ShotStatus = 'pending' | 'generating' | 'in_review' | 'approved' | 'stale'

export interface ShotState {
  refId: string
  status: ShotStatus
}

const num = (id: string) => Number(id.slice(4))

export function validateGraph(shots: SheetShot[]): void {
  const ids = new Set<string>()
  for (const s of shots) {
    if (ids.has(s.id)) throw new Error(`Duplicate shot ${s.id}.`)
    for (const dep of s.attach) {
      if (!ids.has(dep)) throw new Error(`${s.id} attaches ${dep}, which is not an earlier shot.`)
      if (num(dep) >= num(s.id)) throw new Error(`${s.id} may only attach lower-numbered shots (got ${dep}).`)
    }
    ids.add(s.id)
  }
  if (!shots[0] || shots[0].source !== 'hero' || shots[0].attach.length) throw new Error('The first shot must be the hero (REF-00) with no attachments.')
}

// Every shot that depends on `refId`, directly or through another shot.
// SPEC example: a regenerated REF-04 invalidates REF-05 and REF-08
// (REF-08 attaches REF-05, which attaches REF-04).
export function dependentsOf(shots: SheetShot[], refId: string): string[] {
  const out = new Set<string>()
  let frontier = [refId]
  while (frontier.length) {
    const next: string[] = []
    for (const s of shots) {
      if (!out.has(s.id) && s.attach.some(a => frontier.includes(a))) { out.add(s.id); next.push(s.id) }
    }
    frontier = next
  }
  return shots.map(s => s.id).filter(id => out.has(id))
}

// Shots to mark stale when `refId` is regenerated: dependents that already
// have work on them. Pending shots have nothing to invalidate.
export function invalidationFor(shots: SheetShot[], states: ShotState[], refId: string): string[] {
  const byId = new Map(states.map(s => [s.refId, s.status]))
  return dependentsOf(shots, refId).filter(id => {
    const st = byId.get(id) ?? 'pending'
    return st === 'approved' || st === 'in_review' || st === 'generating'
  })
}

export function blockers(shot: SheetShot, states: ShotState[]): string[] {
  const byId = new Map(states.map(s => [s.refId, s.status]))
  return shot.attach.filter(dep => byId.get(dep) !== 'approved')
}

export interface NextUp {
  shot: SheetShot
  // "review": a candidate is waiting; "recheck": approved before, now stale;
  // "generate": nothing yet.
  action: 'review' | 'recheck' | 'generate'
}

// One "next up" card at a time, in order (SPEC 11).
export function nextUp(shots: SheetShot[], states: ShotState[]): NextUp | null {
  const byId = new Map(states.map(s => [s.refId, s.status]))
  for (const shot of shots) {
    const st = byId.get(shot.id) ?? 'pending'
    if (st === 'approved' || st === 'generating') continue
    if (blockers(shot, states).length) continue
    if (st === 'in_review') return { shot, action: 'review' }
    if (st === 'stale') return { shot, action: 'recheck' }
    return { shot, action: 'generate' }
  }
  return null
}

export function sheetProgress(shots: SheetShot[], states: ShotState[]): { approved: number; total: number; stale: number; complete: boolean } {
  const byId = new Map(states.map(s => [s.refId, s.status]))
  const approved = shots.filter(s => byId.get(s.id) === 'approved').length
  const stale = shots.filter(s => byId.get(s.id) === 'stale').length
  return { approved, total: shots.length, stale, complete: approved === shots.length }
}
