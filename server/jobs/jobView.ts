import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { jobs } from '../db/schema.js'
import type { Deps } from '../context.js'
import { formatUsd } from '../costs/money.js'
import { modelLabel } from '../costs/quotes.js'
import { findRiskyWords } from '../core/wording.js'

// The live status of a run (owner, 2026-10-13: feedback everywhere): what it
// is doing now from the runner's real state, how long it has been at it and
// how long this model usually takes, and, when it fails, what happened in
// plain words, whether anything was charged, and the provider's own message.

export type JobPhase =
  | 'waiting' | 'queued' | 'submitting' | 'working' | 'sent' | 'provider_queued' | 'generating'
  | 'downloading' | 'checking' | 'done' | 'failed' | 'canceled' | 'needs_attention'

export interface JobViewRow {
  id: string; label: string; purpose: string; stage: string; status: string; kind: string
  model: string; modelName: string; characterId: string | null
  estimate: string; actual: string | null
  phase: JobPhase; phaseLabel: string; since: string; typicalSec: number | null
  // Failed runs: plain words, the provider's own message, and the money.
  error: string | null; detail: string | null; charged: 'no' | 'yes' | 'maybe' | null
  retry: boolean
  // A refusal by the provider's filter: the likely trigger words in what
  // was sent, and whether "Retry with safer wording" can run (G46).
  triggers: string[]; safer: boolean
  createdAt: string; completedAt: string | null
}

// The provider's content filter refused it (the same words explainFailure
// turns into "The provider's content filter blocked this result.").
export const FILTER_REFUSAL = /nsfw|content filter|safety|moderation|policy/i

type JobRow = typeof jobs.$inferSelect
const LOCAL = 'local'

// What a failure means, in plain words; the raw message goes under Details.
// Work the worker does itself (a render, a check) never blames a provider.
export const OUR_SIDE = 'The render failed on our side. Nothing was charged.'
const TECHNICAL = /ffmpeg|ffprobe|filter|exited with code|invalid argument|errno|stack|\bat \w+ \(|enoent|eacces/i

export function explainFailure(message: string | null | undefined, opts: { local?: boolean } = {}): { plain: string; detail: string | null } {
  const raw = (message ?? '').trim()
  if (opts.local) {
    if (!raw) return { plain: OUR_SIDE, detail: null }
    // Our own plain messages ("Add shot B ...") stay; anything technical
    // becomes one line, with the detail kept under Details.
    if (TECHNICAL.test(raw) || raw.length > 160 || /[{}[\]\\]/.test(raw)) return { plain: OUR_SIDE, detail: raw }
    return { plain: raw, detail: null }
  }
  if (!raw) return { plain: 'The provider reported a failure without a reason.', detail: null }
  const m = raw.toLowerCase()
  const known: Array<[RegExp, string]> = [
    [/preset .* recommended|recommended its preset/, 'Higgsfield suggested one of its presets instead of running your request, so nothing ran.'],
    [/protected likeness|celebrity|public figure/, 'Higgsfield blocked this request: it thinks the reference looks like a real, protected person.'],
    [/nsfw|content filter|safety|moderation|policy/, 'The provider\'s content filter blocked this result.'],
    [/insufficient|not enough credits|balance|quota exceeded|payment required/, 'Your provider account does not have enough credits for this run.'],
    [/timed? ?out|timeout|deadline/, 'The provider took too long to answer.'],
    [/rate limit|too many requests|429/, 'The provider is busy (too many requests). Try again in a minute.'],
    [/unauthori[sz]ed|401|403|token|sign in|credential/, 'The provider did not accept the Studio\'s sign-in. Check the connection in Settings.'],
    [/prompt writer did not finish/, 'The prompt writer did not finish, so the stills did not run.'],
    [/written prompt was refused/, 'The written prompt broke a fixed rule, so nothing ran. Edit it and run again.'],
    [/did not finish|it was waiting for|it was checking/, 'The step this was waiting for did not finish.'],
    [/could not be read as a video|could not read/, 'This file could not be read as a video.'],
  ]
  const hit = known.find(([re]) => re.test(m))
  // A short, readable message needs no translating.
  const readable = raw.length <= 160 && !/[{}[\]\\]/.test(raw)
  if (hit) return { plain: hit[1], detail: raw }
  if (readable) return { plain: raw, detail: null }
  return { plain: 'The provider reported a failure.', detail: raw }
}

const LABELS: Record<JobPhase, (name: string) => string> = {
  waiting: () => 'Waiting for the step before',
  queued: () => 'Queued',
  submitting: name => `Sending to ${name}`,
  working: () => 'Working',
  sent: name => `Sent to ${name}`,
  provider_queued: name => `Queued at ${name}`,
  generating: () => 'Generating',
  downloading: () => 'Downloading',
  checking: () => 'Checking',
  done: () => 'Done',
  failed: () => 'Failed',
  canceled: () => 'Canceled',
  needs_attention: () => 'Needs you',
}

function phaseOf(j: JobRow): JobPhase {
  switch (j.status) {
    case 'waiting': return 'waiting'
    case 'queued': return 'queued'
    case 'submitting': return j.provider === LOCAL ? 'working' : 'submitting'
    case 'running': return j.phase === 'provider_queued' ? 'provider_queued' : j.phase === 'generating' ? 'generating' : 'sent'
    case 'ingesting': return 'downloading'
    case 'completed': return j.phase === 'checking' ? 'checking' : 'done'
    case 'failed': return 'failed'
    case 'canceled': return 'canceled'
    default: return 'needs_attention'
  }
}

// Median run time per model from this account's recent runs, else the
// configured typical time for the kind of run.
async function typicalTimes(deps: Deps, accountId: string, rows: JobRow[]): Promise<Map<string, number>> {
  const keys = [...new Set(rows.filter(r => r.provider !== LOCAL).map(r => r.model))]
  const out = new Map<string, number>()
  if (!keys.length) return out
  const since = new Date(deps.clock.now().getTime() - 30 * 86_400_000)
  const med = await deps.db.select({
    model: jobs.model,
    sec: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${jobs.completedAt} - coalesce(${jobs.submittedAt}, ${jobs.createdAt}))))`,
    n: sql<number>`count(*)`,
  }).from(jobs).where(and(eq(jobs.accountId, accountId), eq(jobs.status, 'completed'), inArray(jobs.model, keys), gt(jobs.completedAt, since))).groupBy(jobs.model)
  for (const r of med) if (r.sec != null && Number(r.n) >= 3) out.set(r.model, Math.round(Number(r.sec)))
  return out
}

export async function jobViews(deps: Deps, accountId: string, rows: JobRow[], labels: Map<string, string>): Promise<JobViewRow[]> {
  const typical = await typicalTimes(deps, accountId, rows)
  const fallback = deps.config.runtime.jobs.typical_sec
  return rows.map(j => {
    const phase = phaseOf(j)
    const ref = `${j.provider}/${j.model}`
    const name = j.provider === LOCAL ? 'the worker' : j.provider === 'mock' ? 'the demo' : modelLabel(deps, ref)
    const failed = phase === 'failed' || phase === 'canceled' || phase === 'needs_attention'
    const why = failed ? explainFailure((j.error as { message?: string } | null)?.message, { local: j.provider === LOCAL }) : null
    const since = (['sent', 'provider_queued', 'generating', 'checking'].includes(phase) ? j.phaseAt : null) ?? j.submittedAt ?? j.createdAt
    const parent = !!(j.request as { parentJobId?: string } | null)?.parentJobId
    const sent = (j.request as { prompt?: unknown } | null)?.prompt
    const refused = (phase === 'failed' || phase === 'canceled') && j.kind !== 'llm' && typeof sent === 'string' && FILTER_REFUSAL.test((j.error as { message?: string } | null)?.message ?? '')
    const triggers = refused ? findRiskyWords(sent as string, deps.config.pipeline.wording) : []
    const retry = (phase === 'failed' || phase === 'canceled') && j.provider !== LOCAL && !parent
    // A queued group waiting on the daily cap says so (section 31).
    const capWait = phase === 'waiting' ? (j.error as { message?: string; capWait?: boolean } | null) : null
    return {
      id: j.id, label: labels.get(j.id) || j.purpose, purpose: j.purpose, stage: j.stage, status: j.status, kind: j.kind,
      model: ref, modelName: name, characterId: j.characterId,
      estimate: formatUsd(j.estimateMicros), actual: j.actualMicros != null ? formatUsd(j.actualMicros) : null,
      phase, phaseLabel: capWait?.capWait && capWait.message ? capWait.message : LABELS[phase](name), since: since.toISOString(),
      typicalSec: j.provider === LOCAL ? fallback.local ?? null : typical.get(j.model) ?? fallback[j.kind] ?? null,
      error: why?.plain ?? null, detail: why?.detail ?? null,
      // A failed run released its hold (the provider refunds it); a run that
      // needs attention keeps the hold, so money may have moved.
      charged: phase === 'failed' || phase === 'canceled' ? 'no' : phase === 'needs_attention' ? 'maybe' : j.status === 'completed' ? ((j.actualMicros ?? 0) > 0 ? 'yes' : 'no') : null,
      // A paid run can be retried on its own (with a new price); a run that
      // waited on another step is retried from that step.
      retry,
      triggers, safer: retry && triggers.length > 0,
      createdAt: j.createdAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null,
    }
  })
}
