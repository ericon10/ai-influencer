import { and, eq } from 'drizzle-orm'
import { jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { hardWrap } from '../core/text.js'
import type { CostCheck } from '../core/costCheck.js'
import { formatCredits, modelLabel } from '../costs/quotes.js'
import { formatUsd } from '../costs/money.js'
import type { GenRequest } from '../providers/types.js'
import { approvedAssets, getCandidate } from './characters.js'

// "What was sent" (owner, 2026-10-14), under every still and take: the
// final prompt exactly as the model got it, the images attached (sheet refs
// by their REF id, start and end frames, a source clip), the model, the
// path, the settings, and the price quoted next to the real cost.

export interface SentView {
  candidateId: string
  prompt: string
  wrapped: string
  images: Array<{ assetId: string; role: 'ref' | 'start' | 'end' | 'source'; refId: string | null }>
  model: string
  ranOn: string
  path: 'plan' | 'api' | 'demo'
  pathLabel: string
  settings: Array<{ label: string; value: string }>
  quoted: string
  actual: string | null
  costNote: string | null
  flagged: boolean
  offPct: number | null
  status: string
  at: string | null
}

export async function whatWasSent(deps: Deps, ctx: Ctx, candidateId: string): Promise<SentView> {
  const cand = await getCandidate(deps, ctx, candidateId)
  if (!cand.jobId) throw new AppError('bad_request', 'Nothing was sent for this one: it was uploaded or made for free (a crop or a mirror).')
  const [job] = await deps.db.select().from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.id, cand.jobId)))
  if (!job) throw notFound('Run')
  if (job.kind === 'llm' || job.kind === 'local') throw new AppError('bad_request', 'Nothing was sent to an image or video model for this one.')
  const req = job.request as GenRequest
  const byAsset = new Map([...(await approvedAssets(deps, ctx, cand.characterId))].map(([refId, assetId]) => [assetId, refId]))
  const images: SentView['images'] = [
    ...(req.refs ?? []).map(r => ({ assetId: r.assetId, role: 'ref' as const, refId: byAsset.get(r.assetId) ?? null })),
    ...(req.startFrame ? [{ assetId: req.startFrame.assetId, role: 'start' as const, refId: null }] : []),
    ...(req.endFrame ? [{ assetId: req.endFrame.assetId, role: 'end' as const, refId: null }] : []),
    ...(req.sourceVideo ? [{ assetId: req.sourceVideo.assetId, role: 'source' as const, refId: null }] : []),
  ]
  const demo = job.provider === 'mock'
  const path: SentView['path'] = demo ? 'demo' : req.billing === 'account' ? 'plan' : 'api'
  const asked = req.modelRef ?? req.model
  const settings = [
    req.aspect ? { label: 'Aspect', value: req.aspect } : null,
    req.resolution ? { label: 'Resolution', value: req.resolution } : null,
    req.quality ? { label: 'Quality', value: req.quality } : null,
    req.durationSec ? { label: 'Length', value: `${req.durationSec} s` } : null,
    req.kind.startsWith('video') ? { label: 'Sound', value: req.audio === true ? 'on' : 'off' } : null,
    req.seed != null ? { label: 'Seed', value: String(req.seed) } : null,
  ].filter((x): x is { label: string; value: string } => !!x)
  const check = job.costCheck as CostCheck | null
  const quoted = demo ? 'Free (demo)' : req.quotedCredits != null ? formatCredits(req.quotedCredits) : formatUsd(job.estimateMicros)
  const actual = demo ? null
    : check?.actual.credits != null ? formatCredits(check.actual.credits)
    : check?.actual.micros != null && check.actual.source !== 'quote' ? formatUsd(check.actual.micros)
    : null
  return {
    candidateId: cand.id,
    prompt: req.prompt ?? cand.prompt,
    wrapped: hardWrap(req.prompt ?? cand.prompt),
    images,
    model: modelLabel(deps, asked),
    ranOn: demo ? 'Demo mock, free' : modelLabel(deps, req.model),
    path,
    pathLabel: path === 'plan' ? 'Your Higgsfield plan' : path === 'api' ? 'Higgsfield API' : 'Demo mode (a free mock ran)',
    settings,
    quoted,
    actual,
    costNote: demo ? null : check?.note ?? (path === 'plan' ? 'The charge is read from your Higgsfield transactions when the run finishes.' : 'The Higgsfield API reports no cost for a run, so the price book figure stands.'),
    flagged: check?.flagged ?? false,
    offPct: check?.offPct ?? null,
    status: job.status,
    at: job.submittedAt?.toISOString() ?? null,
  }
}
