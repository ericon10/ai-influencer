// Earlier failures in one gray line (owner, 2026-10-15): blocked, not-run
// and failed runs other than the one just started are counted by reason
// instead of shown red one by one. Failed and canceled runs are never
// charged; a run the provider may have charged says so.

export type FailureKind = 'blocked' | 'not_run' | 'failed'
export interface FailureItem { kind: FailureKind; facePass?: boolean; charged?: 'no' | 'yes' | 'maybe' | null }

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`

// "4 blocked by the filter, refunded; 2 face passes not run. Nothing charged."
export function failureLine(items: readonly FailureItem[]): string {
  const blocked = items.filter(i => i.kind === 'blocked').length
  const notRun = items.filter(i => i.kind === 'not_run')
  const failed = items.filter(i => i.kind === 'failed').length
  const parts: string[] = []
  if (blocked) parts.push(`${blocked} blocked by the filter, refunded`)
  if (notRun.length) parts.push(notRun.every(i => i.facePass) ? `${n(notRun.length, 'face pass', 'face passes')} not run` : `${notRun.length} not run`)
  if (failed) parts.push(`${failed} failed`)
  const maybe = items.filter(i => i.charged === 'maybe').length
  const charged = items.filter(i => i.charged === 'yes').length
  const money = maybe ? `${n(maybe, 'run', 'runs')} may have been charged (see Activity).` : charged ? `${n(charged, 'run was', 'runs were')} charged.` : 'Nothing charged.'
  return `${parts.join('; ')}. ${money}`
}

// Within this of the newest run's start, a run counts as the one just started.
export const FRESH_MS = 15 * 60_000

// Job ids cleared from the run rows, remembered in this browser.
const KEY = 'studio.clearedRuns'
export function clearedRuns(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]) } catch { return new Set() }
}
export function clearRuns(ids: readonly string[]): void {
  try {
    const next = [...new Set([...clearedRuns(), ...ids])].slice(-500)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* private window: cleared for this visit only */ }
}

// A finished run's failure kind, from its status and message.
export function jobFailureKind(j: { phase: string; error: string | null; detail?: string | null }): FailureKind {
  if (j.phase === 'canceled') return 'not_run'
  return /content filter|filter blocked|blocked by|moderation|safety system/i.test(`${j.error ?? ''} ${j.detail ?? ''}`) ? 'blocked' : 'failed'
}
