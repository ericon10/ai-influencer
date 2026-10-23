import { and, eq } from 'drizzle-orm'
import { jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { hardWrap } from '../core/text.js'
import type { CostCheck } from '../core/costCheck.js'
import { formatCredits, modelLabel } from '../costs/quotes.js'
import { formatUsd } from '../costs/money.js'
import { providerLabel, providerOf } from '../core/engines.js'
import type { GenRequest } from '../providers/types.js'
import { approvedAssets, getCandidate, getCharacter, toData } from './characters.js'

// "What was sent" (owner, 2026-10-14), under every still and take: the
// final prompt exactly as the model got it, the images attached (sheet refs
// by their REF id, start and end frames, a source clip), the model, the
// path, the settings, and the price quoted next to the real cost. Failed
// runs too, with why they failed.

export interface SentView {
  candidateId: string | null
  jobId: string
  prompt: string
  wrapped: string
  images: Array<{ assetId: string; role: 'ref' | 'start' | 'end' | 'source'; refId: string | null }>
  // Saved characters the prompt names (a Higgsfield element on the plan).
  elements: Array<{ id: string; name: string }>
  model: string
  ranOn: string
  path: 'plan' | 'api' | 'demo'
  pathLabel: string
  // Who ran it (section 40): Higgsfield, Google AI Studio, fal, Kie.ai, WaveSpeed.
  provider: string
  providerLabel: string
  settings: Array<{ label: string; value: string }>
  quoted: string
  actual: string | null
  costNote: string | null
  flagged: boolean
  offPct: number | null
  status: string
  // Why a failed run failed, and the provider's id for it.
  error: string | null
  providerJobId: string | null
  at: string | null
}

export async function whatWasSent(deps: Deps, ctx: Ctx, candidateId: string): Promise<SentView> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (!cand.jobId) throw new AppError('bad_request', 'Nothing was sent for this one: it was uploaded or made for free (a crop or a mirror).')
  const [job] = await deps.db.select().from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.id, cand.jobId)))
  if (!job) throw notFound('Run')
  return sentView(deps, ctx, job, cand.characterId, cand.id, cand.prompt)
}

// The same for any run, failed ones included (owner, 2026-10-15): a run the
// provider blocked has no still, but what was sent is still worth seeing.
export async function whatWasSentForJob(deps: Deps, ctx: Ctx, jobId: string): Promise<SentView> {
  const [job] = await deps.db.select().from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.id, jobId)))
  if (!job) throw notFound('Run')
  return sentView(deps, ctx, job, job.characterId, null, '')
}

async function sentView(deps: Deps, ctx: Ctx, job: typeof jobs.$inferSelect, characterId: string | null, candidateId: string | null, fallbackPrompt: string): Promise<SentView> {
  if (job.kind === 'llm' || job.kind === 'local') throw new AppError('bad_request', 'Nothing was sent to an image or video model for this one.')
  const req = job.request as GenRequest
  const byAsset = new Map(characterId ? [...(await approvedAssets(deps, ctx, characterId))].map(([refId, assetId]) => [assetId, refId]) : [])
  const images: SentView['images'] = [
    ...(req.refs ?? []).map(r => ({ assetId: r.assetId, role: 'ref' as const, refId: byAsset.get(r.assetId) ?? null })),
    ...(req.startFrame ? [{ assetId: req.startFrame.assetId, role: 'start' as const, refId: null }] : []),
    ...(req.endFrame ? [{ assetId: req.endFrame.assetId, role: 'end' as const, refId: null }] : []),
    ...(req.sourceVideo ? [{ assetId: req.sourceVideo.assetId, role: 'source' as const, refId: null }] : []),
  ]
  // A saved character named in the prompt (<<<id>>>) is attached too.
  const prompt = req.prompt ?? fallbackPrompt
  const ids = [...new Set([...prompt.matchAll(/<<<([0-9a-f-]{36})>>>/gi)].map(m => m[1]!))]
  const named = new Map<string, string>()
  if (ids.length && characterId) {
    const row = await getCharacter(deps, ctx, characterId).catch(() => null)
    if (row) for (const i of toData(row).identities) if (i.externalId) named.set(i.externalId, i.name || row.name)
  }
  const elements = ids.map(id => ({ id, name: named.get(id) ?? 'Higgsfield element' }))
  const facts = runFacts(deps, job)
  const { demo, path, asked, quoted, actual, check, failed } = facts
  const settings = [
    req.aspect ? { label: 'Aspect', value: req.aspect } : null,
    req.resolution ? { label: 'Resolution', value: req.resolution } : null,
    req.quality ? { label: 'Quality', value: req.quality } : null,
    req.durationSec ? { label: 'Length', value: `${req.durationSec} s` } : null,
    req.kind.startsWith('video') ? { label: 'Sound', value: req.audio === true ? 'on' : 'off' } : null,
    req.seed != null ? { label: 'Seed', value: String(req.seed) } : null,
  ].filter((x): x is { label: string; value: string } => !!x)
  const error = failed ? (job.error as { message?: string } | null)?.message ?? 'The run did not finish.' : null
  return {
    candidateId,
    jobId: job.id,
    prompt,
    wrapped: hardWrap(prompt),
    images,
    elements,
    model: modelLabel(deps, asked),
    ranOn: demo ? 'Demo mock, free' : modelLabel(deps, req.model),
    path,
    pathLabel: facts.pathLabel,
    provider: facts.provider,
    providerLabel: facts.providerLabel,
    settings,
    quoted,
    actual,
    costNote: demo ? null : failed ? null : check?.note ?? (path === 'plan' ? 'The charge is read from your Higgsfield transactions when the run finishes.' : facts.provider === 'higgsfield' ? 'The Higgsfield API reports no cost for a run, so the price book figure stands.' : `The price book figure for ${facts.providerLabel} stands; check its dashboard for the real charge.`),
    flagged: check?.flagged ?? false,
    offPct: check?.offPct ?? null,
    status: job.status,
    error,
    providerJobId: job.providerJobId ?? null,
    at: job.submittedAt?.toISOString() ?? null,
  }
}

const PATH_LABEL: Record<SentView['path'], string> = { plan: 'Your Higgsfield plan', api: 'Higgsfield API', demo: 'Demo mode (a free mock ran)' }

// A run's model, path and cost (also the Library viewer's, UX-PLAN.md
// section 34): the model asked for, the plan or the API (or demo), the price
// quoted (credits on the plan, dollars on the API) and the real cost when it
// is known.
export function runFacts(deps: Pick<Deps, 'config'>, job: typeof jobs.$inferSelect) {
  const req = job.request as GenRequest
  const demo = job.provider === 'mock'
  const path: SentView['path'] = demo ? 'demo' : req.billing === 'account' ? 'plan' : 'api'
  const asked = req.modelRef ?? req.model
  const check = job.costCheck as CostCheck | null
  const failed = ['failed', 'canceled', 'needs_attention'].includes(job.status)
  const quoted = demo ? 'Free (demo)' : req.quotedCredits != null ? formatCredits(req.quotedCredits) : formatUsd(job.estimateMicros)
  const actual = demo ? null
    : check?.actual.credits != null ? formatCredits(check.actual.credits)
    : check?.actual.micros != null && check.actual.source !== 'quote' ? formatUsd(check.actual.micros)
    : null
  const provider = demo ? 'mock' : providerOf(asked) || job.provider
  const providerName = demo ? 'Demo' : providerLabel(deps.config.engines, provider)
  const pathLabel = path === 'api' && provider !== 'higgsfield' ? `${providerName} API` : PATH_LABEL[path]
  return { demo, path, pathLabel, provider, providerLabel: providerName, asked, model: modelLabel(deps, asked), quoted, actual, check, failed }
}
