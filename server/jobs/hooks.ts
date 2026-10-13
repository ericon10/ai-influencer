import type { Ctx, Deps } from '../context.js'
import type { AssetRow } from '../storage/assets.js'
import type { jobs } from '../db/schema.js'

export type JobRow = typeof jobs.$inferSelect

export interface JobOutcome {
  status: 'completed' | 'failed' | 'canceled' | 'needs_attention'
  assets?: AssetRow[]
  data?: unknown
  error?: string
}

export type JobHook = (deps: Deps, ctx: Ctx, job: JobRow, outcome: JobOutcome) => Promise<void>

// Pipeline stages react to finished jobs through hooks keyed by the job
// purpose prefix ("sheet:REF-04" runs the "sheet" hook).
const hooks = new Map<string, JobHook>()

export function registerJobHook(prefix: string, hook: JobHook): void {
  hooks.set(prefix, hook)
}

export function hookFor(purpose: string): JobHook | undefined {
  return hooks.get(purpose.split(':')[0] ?? purpose)
}

// Free work the worker does itself (no provider, no money), for example the
// face and texture check on imported sheet images. Same purpose prefixes.
export type LocalJob = (deps: Deps, ctx: Ctx, job: JobRow) => Promise<unknown>
const locals = new Map<string, LocalJob>()

export function registerLocalJob(prefix: string, run: LocalJob): void {
  locals.set(prefix, run)
}

export function localJobFor(purpose: string): LocalJob | undefined {
  return locals.get(purpose.split(':')[0] ?? purpose)
}
