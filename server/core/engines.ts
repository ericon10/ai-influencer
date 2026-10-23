import type { EnginesConfig } from '../config/load.js'
import type { GenKind } from '../providers/types.js'

// Step > model > provider (owner, 2026-10-23; UX-PLAN.md section 40): which
// provider runs a model on a step. Pure; the choices come from the account
// settings (pipeline/engines.ts).

export type EngineStep = 'still' | 'edit' | 'video' | 'recreate_still' | 'recreate_motion'
export type Family = EnginesConfig['families'][number]

// The provider's picks: for a whole run (Weeks > Make the week), for this
// character on this step, for the step on every character. The run's wins,
// then the character's, then the step's; none means the family's default
// (the ref the step asked for).
export interface EngineChoices {
  run?: string | null
  character?: Record<string, string>
  step?: Record<string, string>
}

export const providerOf = (ref: string) => ref.slice(0, Math.max(0, ref.indexOf('/')))

export function familyOf(engines: EnginesConfig, ref: string): Family | null {
  return engines.families.find(f => f.providers.includes(ref)) ?? null
}

// The step a run belongs to, from what it makes (a Recreate still names its
// step itself, since it is an edit too).
export function stepOfKind(kind: GenKind): EngineStep | null {
  if (kind === 'image') return 'still'
  if (kind === 'image_edit') return 'edit'
  if (kind === 'video') return 'video'
  if (kind === 'video_clone') return 'recreate_motion'
  return null
}

export function providerLabel(engines: EnginesConfig, provider: string): string {
  return engines.providers[provider]?.label ?? provider
}

// The ref that runs: the same model on the picked provider, when that
// provider runs it on this step; otherwise the ref as asked.
export function routeRef(engines: EnginesConfig, ref: string, step: EngineStep | null, choices: EngineChoices): string {
  const fam = familyOf(engines, ref)
  if (!fam || !step || !fam.steps.includes(step)) return ref
  const on = (p: string | null | undefined) => (p ? fam.providers.find(r => providerOf(r) === p) ?? null : null)
  return on(choices.run) ?? on(choices.character?.[fam.id]) ?? on(choices.step?.[fam.id]) ?? ref
}

// The other providers that run the same model on this step, default first
// (a failed run's next tries).
export function alternatives(engines: EnginesConfig, ref: string, step: EngineStep | null): string[] {
  const fam = familyOf(engines, ref)
  if (!fam || (step && !fam.steps.includes(step))) return []
  return fam.providers.filter(r => r !== ref)
}
