import { and, eq, inArray, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jobEvents, jobOutputs, jobs } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import { newId, newToken } from '../lib/ids.js'
import { AppError, notFound } from '../lib/errors.js'
import { safeEqual, sha256Hex } from '../lib/passwords.js'
import { reportWorkerStart, touchWorker, workerVersion } from './workerStatus.js'
import { appendLedger } from '../costs/ledger.js'
import { actualGen } from '../costs/pricebook.js'
import { consumeQuote, createQuote, type QuoteItem, type QuoteView } from '../costs/quotes.js'
import { getAsset, readAsset, saveAsset, type AssetRow } from '../storage/assets.js'
import { probeFile } from '../media/ffmpeg.js'
import { stripAudio } from '../media/edit.js'
import { headMaskAsset } from '../pipeline/videoAssets.js'
import { ProviderError, type CostEstimate, type GenRequest, type LlmImage, type LlmRequest, type Output, type ProviderAdapter } from '../providers/types.js'
import { withBilling } from '../providers/billing.js'
import { realismBlockers } from '../core/realism.js'
import { EXPLICIT_MESSAGE, findExplicitTerms } from '../core/safety.js'
import { publicAssetUrl } from './assetUrls.js'
import { safeDownload } from './download.js'
import { hookFor, localJobFor, type JobOutcome, type JobRow } from './hooks.js'
import { wakeWorker } from './wake.js'

// Async job runner (SPEC 3): every generation is a Job. Submit, then wake on
// a webhook or poll; on completion copy every output into our own storage
// and settle the ledger (release the hold, record the actual charge).
//
// States: [waiting ->] queued -> submitting -> running -> ingesting -> completed
//         or failed | canceled | needs_attention

export type JobStatusName = 'waiting' | 'queued' | 'submitting' | 'running' | 'ingesting' | 'completed' | 'failed' | 'canceled' | 'needs_attention'

export interface LlmJobRequest extends Omit<LlmRequest, 'images'> {
  imageAssetIds?: string[]
  mirrorImages?: boolean
  // Sizes to price when the images do not exist yet (QA on a pending render).
  estimateImages?: Array<{ width: number; height: number }>
}

// parentIndex: this job waits for another job in the same run (for example
// QA on an image that does not exist yet). It is quoted and held up front,
// and starts when its parent finishes, so no unquoted spend ever happens.
// `characterId` names the character a job belongs to when one run covers
// several (Clone Video across characters); otherwise the run's character.
export type JobSpec =
  | { type: 'gen'; stage: string; purpose: string; label: string; request: GenRequest; parentIndex?: number; characterId?: string }
  | { type: 'llm'; stage: string; purpose: string; label: string; request: LlmJobRequest; parentIndex?: number; characterId?: string }

const ACTIVE: JobStatusName[] = ['waiting', 'queued', 'submitting', 'running', 'ingesting']

// ── Quote and run ────────────────────────────────────────────────

async function llmEstimateRequest(deps: Deps, ctx: Ctx, req: LlmJobRequest): Promise<LlmRequest> {
  const images: LlmImage[] = []
  for (const id of req.imageAssetIds ?? []) {
    const a = await getAsset(deps, ctx, id)
    images.push({ mime: 'image/png', data: Buffer.alloc(0), width: a.width ?? undefined, height: a.height ?? undefined })
  }
  for (const size of req.estimateImages ?? []) images.push({ mime: 'image/png', data: Buffer.alloc(0), ...size })
  const { imageAssetIds: _ids, mirrorImages: _m, estimateImages: _e, ...rest } = req
  return { ...rest, images }
}

// Rule zero, the Realism principle: no generation is quoted or run without
// the REALISM block in an image prompt, with a smoothing word in any prompt,
// or without the bare-face line on a hero or sheet shot. The prompt builders
// never produce these; this refuses any path that skipped them.
function guardRealism(specs: JobSpec[]): void {
  for (const s of specs) {
    if (s.type !== 'gen') continue
    const problems = [...realismBlockers(s.request.prompt, { kind: s.request.kind, stage: s.stage }), ...(findExplicitTerms(s.request.prompt).length ? [EXPLICIT_MESSAGE] : [])]
    if (problems.length) throw new AppError('prompt_rejected', `${s.label}: ${problems.join(' ')}`)
  }
}

// Prices every spec, a few at a time: a live price (the Higgsfield account
// path asks Higgsfield) can take seconds, and an estimate must answer well
// inside the API's time limit. The order of the items is kept.
const QUOTE_CONCURRENCY = 4

export async function quoteItemsFor(deps: Deps, ctx: Ctx, specs: JobSpec[]): Promise<QuoteItem[]> {
  guardRealism(specs)
  // Identical requests (stills that differ only by seed) are priced once.
  const priced = new Map<string, Promise<CostEstimate>>()
  const priceOne = async (s: JobSpec): Promise<QuoteItem> => {
    const [provider, model] = s.request.model.split('/') as [string, string]
    if (s.type === 'gen') {
      // Higgsfield requests carry the billing path they are quoted on.
      const request = await withBilling(deps.db, ctx.accountId, s.request)
      const key = JSON.stringify({ ...request, seed: undefined })
      let estimate = priced.get(key)
      if (!estimate) {
        estimate = deps.providers.gen(ctx.accountId, request.model, { billing: request.billing }).then(a => a.estimate(request))
        priced.set(key, estimate)
        estimate.then(e => { if (e.note) deps.log.warn({ model: request.model, billing: request.billing, note: e.note }, 'estimate used a fallback price') }, () => undefined)
      }
      return { label: s.label, provider, model, kind: request.kind, request, estimate: await estimate }
    }
    const llm = await deps.providers.llm(ctx.accountId, s.request.model)
    const { meta: _meta, ...fingerprinted } = s.request
    return { label: s.label, provider, model, kind: 'llm', request: fingerprinted, estimate: await llm.estimate(await llmEstimateRequest(deps, ctx, s.request)) }
  }
  const items: QuoteItem[] = new Array(specs.length)
  let next = 0
  const lane = async () => {
    while (next < specs.length) {
      const i = next++
      items[i] = await priceOne(specs[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(QUOTE_CONCURRENCY, specs.length) }, lane))
  return items
}

export async function quoteJobs(deps: Deps, ctx: Ctx, input: { purpose: string; characterId: string | null; specs: JobSpec[] }): Promise<QuoteView> {
  const items = await quoteItemsFor(deps, ctx, input.specs)
  return createQuote(deps, ctx, { purpose: input.purpose, characterId: input.characterId, items })
}

// Creates the jobs for an approved quote and reserves their cost.
export async function runJobs(deps: Deps, ctx: Ctx, input: { quoteId?: string; confirmed?: boolean; purpose: string; characterId: string | null; specs: JobSpec[] }): Promise<JobRow[]> {
  const rows = await createJobs(deps, ctx, input)
  await wakeWorker(deps)
  return rows
}

// Queues free work the worker does itself: no provider, no quote, no money.
export async function enqueueLocalJob(deps: Deps, ctx: Ctx, input: { stage: string; purpose: string; label: string; characterId: string | null; request: Record<string, unknown> }): Promise<JobRow> {
  const id = newId('job')
  const [row] = await deps.db.insert(jobs).values({
    id, accountId: ctx.accountId, userId: ctx.userId, characterId: input.characterId,
    stage: input.stage, purpose: input.purpose, provider: 'local', model: input.purpose.split(':')[0]!, kind: 'check',
    request: input.request, idempotencyKey: id, quoteId: null, estimateMicros: 0, status: 'queued', nextPollAt: deps.clock.now(),
  }).returning()
  await deps.db.insert(jobEvents).values({ id: newId('jev'), accountId: ctx.accountId, jobId: id, type: 'created', data: { label: input.label } })
  await wakeWorker(deps)
  return row!
}

async function createJobs(deps: Deps, ctx: Ctx, input: { quoteId?: string; confirmed?: boolean; purpose: string; characterId: string | null; specs: JobSpec[] }): Promise<JobRow[]> {
  const items = await quoteItemsFor(deps, ctx, input.specs)
  return deps.db.transaction(async tx => {
    const quote = await consumeQuote(tx as unknown as Db, deps, ctx, input.quoteId, input.purpose, input.characterId, items, !!input.confirmed)
    const quotedItems = quote.items as Array<{ amountMicros: number; priceVersion: string }>
    const rows: JobRow[] = []
    for (const [i, spec] of input.specs.entries()) {
      const estimate = quotedItems[i]?.amountMicros ?? items[i]!.estimate.totalMicros
      const credits = items[i]!.estimate.credits
      const [provider, model] = spec.request.model.split('/') as [string, string]
      // The stored request is the quoted one (with its billing path), plus
      // the credits quoted on the account path.
      const request = spec.type === 'gen'
        ? { ...(items[i]!.request as GenRequest), ...(credits != null ? { quotedCredits: credits } : {}) }
        : spec.request
      const id = newId('job')
      const parent = spec.parentIndex != null ? rows[spec.parentIndex] : undefined
      if (spec.parentIndex != null && !parent) throw new AppError('bad_request', 'A dependent job must come after its parent.')
      const characterId = spec.characterId ?? input.characterId
      const [row] = await tx.insert(jobs).values({
        id, accountId: ctx.accountId, userId: ctx.userId, characterId,
        stage: spec.stage, purpose: spec.purpose, provider, model,
        kind: spec.type === 'gen' ? spec.request.kind : 'llm',
        request: parent ? { ...request, parentJobId: parent.id } : request,
        idempotencyKey: `${quote.id}:${i}`, quoteId: quote.id,
        estimateMicros: estimate, status: parent ? 'waiting' : 'queued', nextPollAt: parent ? null : deps.clock.now(),
      }).returning()
      await appendLedger(tx as unknown as Db, [{
        accountId: ctx.accountId, userId: ctx.userId, characterId, jobId: id, quoteId: quote.id,
        stage: spec.stage, provider, model, entryType: 'hold', amountMicros: estimate,
        priceVersion: quotedItems[i]?.priceVersion, source: 'estimate', note: spec.label,
        ...(credits != null ? { quantity: credits, unit: 'credit' } : {}),
      }])
      await tx.insert(jobEvents).values({ id: newId('jev'), accountId: ctx.accountId, jobId: id, type: 'created', data: { label: spec.label } })
      rows.push(row!)
    }
    return rows
  })
}

// ── Worker ───────────────────────────────────────────────────────

function systemCtx(deps: Deps, job: JobRow): Ctx {
  return { accountId: job.accountId, userId: job.userId, role: 'admin', email: '', requestId: job.id, log: deps.log.child({ jobId: job.id, accountId: job.accountId }) }
}

async function event(db: Db, job: JobRow, type: string, data: Record<string, unknown> = {}): Promise<void> {
  await db.insert(jobEvents).values({ id: newId('jev'), accountId: job.accountId, jobId: job.id, type, data })
}

async function update(deps: Deps, job: JobRow, patch: Partial<typeof jobs.$inferInsert>): Promise<void> {
  await deps.db.update(jobs).set({ ...patch, updatedAt: deps.clock.now() }).where(eq(jobs.id, job.id))
}

async function claimDue(deps: Deps, limit: number): Promise<JobRow[]> {
  const now = deps.clock.now()
  const lockUntil = new Date(now.getTime() + deps.config.runtime.jobs.lock_sec * 1000)
  const res = await deps.db.execute(sql`
    update jobs set locked_until = ${lockUntil.toISOString()}::timestamptz
    where id in (
      select id from jobs
      where status in ('queued', 'submitting', 'running', 'ingesting')
        and (next_poll_at is null or next_poll_at <= ${now.toISOString()}::timestamptz)
        and (locked_until is null or locked_until < ${now.toISOString()}::timestamptz)
      order by coalesce(next_poll_at, created_at)
      limit ${limit}
      for update skip locked
    )
    returning id`)
  const ids = (res as unknown as { rows: Array<{ id: string }> }).rows.map(r => r.id)
  if (!ids.length) return []
  return deps.db.select().from(jobs).where(inArray(jobs.id, ids))
}

export async function tick(deps: Deps, limit = 10): Promise<number> {
  const due = await claimDue(deps, limit)
  for (const job of due) {
    try {
      await processJob(deps, job)
    } catch (e) {
      deps.log.error({ err: e, jobId: job.id }, 'job processing crashed')
      await update(deps, job, { lockedUntil: null, nextPollAt: new Date(deps.clock.now().getTime() + 10_000), error: { message: (e as Error).message } })
    }
  }
  return due.length
}

async function processJob(deps: Deps, job: JobRow): Promise<void> {
  switch (job.status as JobStatusName) {
    case 'queued': return job.provider === 'local' ? runLocal(deps, job) : job.kind === 'llm' ? runLlm(deps, job) : submitGen(deps, job)
    case 'submitting':
      // Free local work (a render, a check) that was cut off runs again.
      if (job.provider === 'local') return runLocal(deps, job)
      // The lock expired mid-submit: the worker died and we cannot know if the
      // provider accepted (and charged) the job. Never resubmit blindly.
      return needsAttention(deps, job, 'The worker stopped while submitting this job. Check the provider console before retrying; it may have been charged.')
    case 'running': return pollGen(deps, job)
    case 'ingesting': return ingestGen(deps, job)
    default: return update(deps, job, { lockedUntil: null })
  }
}

function backoffMs(deps: Deps, attempt: number): number {
  const j = deps.config.runtime.jobs
  return Math.min(j.poll_max_sec, j.poll_initial_sec * Math.pow(j.poll_backoff, Math.max(0, attempt - 1))) * 1000
}

// Provider uploads are reused for a while: the same REF-00 rides along on
// many jobs. Keyed by provider and the asset's checksum.
const UPLOAD_TTL_MS = 6 * 3600_000
const uploads = new Map<string, { url: string; at: number }>()

async function refUrl(deps: Deps, ctx: Ctx, adapter: ProviderAdapter, assetId: string): Promise<{ url: string; width?: number; height?: number }> {
  if (adapter.uploadAsset) {
    const { row, data } = await readAsset(deps, ctx, assetId)
    const size = { width: row.width ?? undefined, height: row.height ?? undefined }
    const key = `${ctx.accountId}:${adapter.id}:${row.checksumSha256 ?? row.id}`
    const hit = uploads.get(key)
    const now = deps.clock.now().getTime()
    if (hit && now - hit.at < UPLOAD_TTL_MS) return { url: hit.url, ...size }
    const url = await adapter.uploadAsset(data, row.mime)
    uploads.set(key, { url, at: now })
    if (uploads.size > 500) uploads.delete(uploads.keys().next().value!)
    return { url, ...size }
  }
  const url = await publicAssetUrl(deps, ctx, assetId)
  if (!url) throw new ProviderError('Reference images need a public URL. Set up cloud storage (R2) or STUDIO_PUBLIC_URL for live runs with references.', { retryable: false, submitted: 'no' })
  return { url }
}

async function resolveRefs(deps: Deps, ctx: Ctx, adapter: ProviderAdapter, req: GenRequest): Promise<GenRequest> {
  if (!adapter.needsPublicAssetUrls) return req
  const withUrl = async <T extends { assetId: string } | undefined>(r: T): Promise<T> => (r ? { ...r, ...await refUrl(deps, ctx, adapter, r.assetId) } : r)
  return {
    ...req,
    refs: req.refs ? await Promise.all(req.refs.map(r => withUrl(r))) : undefined,
    startFrame: await withUrl(req.startFrame),
    endFrame: await withUrl(req.endFrame),
    sourceVideo: await withUrl(req.sourceVideo),
    mask: await withUrl(req.mask),
  }
}

// The adapter that quoted the job runs it to the end. Higgsfield jobs from
// before billing paths existed ran on the API.
const adapterFor = (deps: Deps, job: JobRow, req: GenRequest) => deps.providers.gen(job.accountId, req.model, { billing: req.billing ?? 'api' })

async function submitGen(deps: Deps, job: JobRow): Promise<void> {
  const ctx = systemCtx(deps, job)
  const req = job.request as GenRequest
  const adapter = await adapterFor(deps, job, req)
  const token = newToken(24)
  const attempts = job.attempts + 1
  await update(deps, job, { status: 'submitting', attempts, webhookTokenHash: sha256Hex(token) })
  const base = deps.env.STUDIO_PUBLIC_URL?.replace(/\/$/, '')
  const webhookUrl = base ? `${base}/api/v1/webhooks/${job.provider}/${job.id}?t=${token}` : undefined
  try {
    // A head mask is made here, on the worker, where the face models are.
    const masked = req.maskFor && !req.mask ? { ...req, mask: { assetId: await headMaskAsset(deps, ctx, req.maskFor.assetId) } } : req
    const resolved = await resolveRefs(deps, ctx, adapter, masked)
    const { jobId } = await adapter.submit(resolved, { idempotencyKey: job.idempotencyKey, webhookUrl })
    const now = deps.clock.now()
    await update(deps, job, { status: 'running', providerJobId: jobId, submittedAt: now, phase: 'sent', phaseAt: now, nextPollAt: new Date(now.getTime() + backoffMs(deps, 1)), lockedUntil: null })
    await event(deps.db, job, 'submitted', { providerJobId: jobId, webhook: !!webhookUrl })
  } catch (e) {
    await handleProviderError(deps, job, e, attempts, 'submit')
  }
}

async function handleProviderError(deps: Deps, job: JobRow, e: unknown, attempts: number, phase: 'submit' | 'poll' | 'llm'): Promise<void> {
  const pe = e instanceof ProviderError ? e : null
  const appErr = e instanceof AppError ? e : null
  const message = (e as Error).message
  if (pe?.opts.submitted === 'unknown') return needsAttention(deps, job, `${message} The provider may have accepted this job; check its console before retrying.`)
  const retryable = pe ? pe.opts.retryable : !appErr
  if (retryable && attempts < deps.config.runtime.jobs.submit_max_attempts) {
    const status: JobStatusName = phase === 'poll' ? 'running' : 'queued'
    await update(deps, job, { status, nextPollAt: new Date(deps.clock.now().getTime() + backoffMs(deps, attempts + 1)), lockedUntil: null, error: { message } })
    await event(deps.db, job, 'retry_scheduled', { phase, message, attempts })
    return
  }
  await finishWithoutCharge(deps, job, 'failed', message)
}

async function pollGen(deps: Deps, job: JobRow): Promise<void> {
  const req = job.request as GenRequest
  const adapter = await adapterFor(deps, job, req)
  const now = deps.clock.now()
  let st
  try {
    st = await adapter.status(job.providerJobId!)
  } catch (e) {
    return handleProviderError(deps, job, e, job.pollCount + 1, 'poll')
  }
  const pollCount = job.pollCount + 1
  if (st.state === 'queued' || st.state === 'running') {
    const delay = st.pollAfterSec != null && st.pollAfterSec > 0 ? st.pollAfterSec * 1000 : backoffMs(deps, pollCount)
    // The provider's own state, for the live status: still in its queue, or
    // generating (and since when).
    const phase = st.state === 'queued' ? 'provider_queued' : 'generating'
    await update(deps, job, { pollCount, lastPolledAt: now, nextPollAt: new Date(now.getTime() + delay), lockedUntil: null, ...(job.phase !== phase ? { phase, phaseAt: now } : {}) })
    const stuckAfter = (deps.config.runtime.jobs.stuck_after_sec[job.kind] ?? 900) * 1000
    if (job.submittedAt && now.getTime() - job.submittedAt.getTime() > stuckAfter) {
      const already = await deps.db.select({ id: jobEvents.id }).from(jobEvents).where(and(eq(jobEvents.jobId, job.id), eq(jobEvents.type, 'stuck')))
      if (!already.length) {
        await event(deps.db, job, 'stuck', { minutes: Math.round((now.getTime() - job.submittedAt.getTime()) / 60000) })
        deps.log.warn({ jobId: job.id }, 'job looks stuck')
      }
    }
    return
  }
  if (st.state === 'succeeded') {
    const outputs = st.outputs ?? await adapter.result(job.providerJobId!)
    await update(deps, job, { status: 'ingesting', pollCount, lastPolledAt: now, resultMeta: { outputs } })
    return ingestGen(deps, { ...job, status: 'ingesting', resultMeta: { outputs } })
  }
  // Failed, filtered or canceled runs are refunded by the provider.
  await finishWithoutCharge(deps, job, st.state === 'canceled' ? 'canceled' : 'failed', st.error ?? (st.state === 'nsfw' ? 'The provider content filter blocked this result.' : 'The provider reported a failure.'))
}

async function downloadOutput(deps: Deps, job: JobRow, adapter: ProviderAdapter, o: Output): Promise<Buffer> {
  if (adapter.download) return adapter.download(o)
  const d = deps.config.runtime.downloads
  const { data } = await safeDownload(o.url, { allowedHosts: d.allowed_hosts[job.provider] ?? [], maxBytes: d.max_bytes, timeoutMs: d.timeout_sec * 1000 })
  return data
}

// Generated clips are stored without audio when audio was requested off,
// because some models return a track anyway (SPEC 5.4 rule 34).
async function silence(data: Buffer): Promise<{ data: Buffer; hadAudio: boolean }> {
  const dir = await mkdtemp(join(tmpdir(), 'ingest-'))
  try {
    const src = join(dir, 'in.mp4'), out = join(dir, 'out.mp4')
    await writeFile(src, data)
    const probe = await probeFile(src)
    if (!probe.hasAudio) return { data, hadAudio: false }
    await stripAudio(src, out)
    return { data: await readFile(out), hadAudio: true }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function ingestGen(deps: Deps, job: JobRow): Promise<void> {
  const ctx = systemCtx(deps, job)
  const req = job.request as GenRequest
  const adapter = await adapterFor(deps, job, req)
  const outputs = ((job.resultMeta as { outputs?: Output[] } | null)?.outputs ?? [])
  if (!outputs.length) return finishWithoutCharge(deps, job, 'failed', 'The provider finished without returning any output.')

  const existing = await deps.db.select().from(jobOutputs).where(eq(jobOutputs.jobId, job.id))
  const assets: AssetRow[] = []
  const measured: Output[] = []
  try {
    for (const [i, o] of outputs.entries()) {
      const done = existing.find(e => e.position === i)
      if (done) {
        const a = await getAsset(deps, ctx, done.assetId)
        assets.push(a)
        measured.push({ ...o, durationSec: a.durationMs != null ? a.durationMs / 1000 : undefined })
        continue
      }
      let data = await downloadOutput(deps, job, adapter, o)
      // Audio off by default: a clip is stored silent unless its request
      // asked for audio (default rule video-audio-off).
      if (o.kind === 'video' && req.audio !== true) {
        const s = await silence(data)
        data = s.data
        if (s.hadAudio) await event(deps.db, job, 'audio_stripped', { position: i })
      }
      const asset = await saveAsset(deps, ctx, { data, origin: 'generated', sourceJobId: job.id, sourceUrl: o.url, label: job.purpose })
      await deps.db.insert(jobOutputs).values({ accountId: job.accountId, jobId: job.id, position: i, assetId: asset.id, providerUrl: o.url })
      assets.push(asset)
      measured.push({ ...o, width: asset.width ?? undefined, height: asset.height ?? undefined, durationSec: asset.durationMs != null ? asset.durationMs / 1000 : undefined })
    }
  } catch (e) {
    // Downloads are retried; the provider URL is valid for days.
    const attempts = job.attempts + 1
    if (attempts < deps.config.runtime.jobs.submit_max_attempts + 3) {
      await update(deps, job, { attempts, lockedUntil: null, nextPollAt: new Date(deps.clock.now().getTime() + backoffMs(deps, attempts)), error: { message: (e as Error).message } })
      await event(deps.db, job, 'ingest_retry', { message: (e as Error).message })
      return
    }
    return needsAttention(deps, job, `Could not copy the output into storage: ${(e as Error).message}`)
  }

  if (req.billing === 'account') {
    // Plan credits are charged as quoted (the request fixes the duration).
    const credits = req.quotedCredits ?? 0
    await settle(deps, job, 'completed', job.estimateMicros, `${credits} plan credits`, { quantity: credits, unit: 'credit' })
  } else {
    const actual = actualGen(deps.config, req, measured)
    await settle(deps, job, 'completed', actual.totalMicros, `${actual.lines.map(l => l.label).join(', ')}`)
  }
  // The free checks (face match, skin texture) run in the hook.
  await update(deps, job, { phase: 'checking', phaseAt: deps.clock.now() })
  await runHook(deps, ctx, job, { status: 'completed', assets })
  await update(deps, job, { phase: 'done', phaseAt: deps.clock.now() })
}

async function loadLlmImages(deps: Deps, ctx: Ctx, req: LlmJobRequest): Promise<LlmImage[]> {
  const maxEdge = deps.config.runtime.llm.image_max_edge
  const out: LlmImage[] = []
  for (const id of req.imageAssetIds ?? []) {
    const { data } = await readAsset(deps, ctx, id)
    let img = sharp(data).rotate().resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    if (req.mirrorImages) img = img.flop()
    const { data: png, info } = await img.png().toBuffer({ resolveWithObject: true })
    out.push({ mime: 'image/png', data: png, width: info.width, height: info.height })
  }
  return out
}

async function runLlm(deps: Deps, job: JobRow): Promise<void> {
  const ctx = systemCtx(deps, job)
  const req = job.request as LlmJobRequest
  const attempts = job.attempts + 1
  await update(deps, job, { status: 'submitting', attempts, submittedAt: deps.clock.now() })
  try {
    const llm = await deps.providers.llm(job.accountId, req.model)
    const { imageAssetIds: _ids, mirrorImages: _m, estimateImages: _e, ...rest } = req
    const full: LlmRequest = { ...rest, images: await loadLlmImages(deps, ctx, req) }
    const result = await llm.run(full)
    const cost = llm.actualCost(full, result.usage)
    await update(deps, job, { resultMeta: { data: result.data, usage: result.usage } })
    await settle(deps, job, 'completed', cost.totalMicros, `${result.usage.inputTokens} in, ${result.usage.outputTokens} out`)
    await runHook(deps, ctx, job, { status: 'completed', data: result.data })
  } catch (e) {
    await handleProviderError(deps, job, e, attempts, 'llm')
  }
}

// Free work done by the worker itself. Nothing to settle: no money moves.
async function runLocal(deps: Deps, job: JobRow): Promise<void> {
  const ctx = systemCtx(deps, job)
  const run = localJobFor(job.purpose)
  await update(deps, job, { status: 'submitting', attempts: job.attempts + 1, submittedAt: deps.clock.now() })
  if (!run) return finishLocal(deps, ctx, job, 'failed', undefined, `No worker step for "${job.purpose}".`)
  // A long render keeps its lock, so it is never picked up twice.
  const lockMs = deps.config.runtime.jobs.lock_sec * 1000
  const beat = setInterval(() => {
    void deps.db.update(jobs).set({ lockedUntil: new Date(deps.clock.now().getTime() + lockMs) }).where(eq(jobs.id, job.id)).catch(() => undefined)
  }, Math.max(5_000, lockMs / 3))
  try {
    const data = await run(deps, ctx, job)
    await finishLocal(deps, ctx, job, 'completed', data)
  } catch (e) {
    ctx.log.error({ err: e }, 'local job failed')
    await finishLocal(deps, ctx, job, 'failed', undefined, (e as Error).message)
  } finally {
    clearInterval(beat)
  }
}

async function finishLocal(deps: Deps, ctx: Ctx, job: JobRow, status: 'completed' | 'failed', data?: unknown, message?: string): Promise<void> {
  await update(deps, job, { status, resultMeta: data === undefined ? null : { data }, actualMicros: 0, actualSource: 'computed', completedAt: deps.clock.now(), lockedUntil: null, nextPollAt: null, error: message ? { message } : null })
  await event(deps.db, job, status, message ? { message } : {})
  await runHook(deps, ctx, job, status === 'completed' ? { status, data } : { status, error: message })
}

// Final ledger entries for a finished job: release the hold, record the
// actual charge (computed from the price book until reconciled).
async function settle(deps: Deps, job: JobRow, status: 'completed', actualMicros: number, note: string, amount: { quantity?: number; unit?: string } = {}): Promise<void> {
  await deps.db.transaction(async tx => {
    await appendLedger(tx as unknown as Db, [
      { accountId: job.accountId, userId: job.userId, characterId: job.characterId, jobId: job.id, quoteId: job.quoteId, stage: job.stage, provider: job.provider, model: job.model, entryType: 'release', amountMicros: -job.estimateMicros, source: 'estimate', note: 'hold released' },
      { accountId: job.accountId, userId: job.userId, characterId: job.characterId, jobId: job.id, quoteId: job.quoteId, stage: job.stage, provider: job.provider, model: job.model, entryType: 'charge', amountMicros: actualMicros, source: 'computed', note, ...amount },
    ])
    await tx.update(jobs).set({ status, actualMicros, actualSource: 'computed', completedAt: deps.clock.now(), lockedUntil: null, nextPollAt: null, error: null, updatedAt: deps.clock.now() }).where(eq(jobs.id, job.id))
  })
  await event(deps.db, job, status, { actualMicros })
}

async function finishWithoutCharge(deps: Deps, job: JobRow, status: 'failed' | 'canceled', message: string): Promise<void> {
  await deps.db.transaction(async tx => {
    await appendLedger(tx as unknown as Db, [{ accountId: job.accountId, userId: job.userId, characterId: job.characterId, jobId: job.id, quoteId: job.quoteId, stage: job.stage, provider: job.provider, model: job.model, entryType: 'release', amountMicros: -job.estimateMicros, source: 'estimate', note: `${status}: hold released` }])
    await tx.update(jobs).set({ status, actualMicros: 0, actualSource: 'computed', completedAt: deps.clock.now(), lockedUntil: null, nextPollAt: null, error: { message }, updatedAt: deps.clock.now() }).where(eq(jobs.id, job.id))
  })
  await event(deps.db, job, status, { message })
  await runHook(deps, systemCtx(deps, job), job, { status, error: message })
}

// The hold stays in place: money may have been spent. A person decides.
async function needsAttention(deps: Deps, job: JobRow, message: string): Promise<void> {
  await update(deps, job, { status: 'needs_attention', lockedUntil: null, nextPollAt: null, error: { message } })
  await event(deps.db, job, 'needs_attention', { message })
  deps.log.warn({ jobId: job.id }, message)
  await runHook(deps, systemCtx(deps, job), job, { status: 'needs_attention', error: message })
}

async function runHook(deps: Deps, ctx: Ctx, job: JobRow, outcome: JobOutcome): Promise<void> {
  const hook = hookFor(job.purpose)
  if (!hook) return
  try {
    await hook(deps, ctx, job, outcome)
  } catch (e) {
    ctx.log.error({ err: e }, 'job hook failed')
    await event(deps.db, job, 'hook_failed', { message: (e as Error).message })
  }
}

// ── Dependent jobs ───────────────────────────────────────────────

export async function childJobs(deps: Deps, parentJobId: string): Promise<JobRow[]> {
  return deps.db.select().from(jobs).where(sql`${jobs.request}->>'parentJobId' = ${parentJobId}`)
}

// Starts a parent's waiting children, patching their requests (for example
// with the asset the parent produced).
export async function activateChildren(deps: Deps, parentJobId: string, patch: (child: JobRow) => Record<string, unknown>): Promise<JobRow[]> {
  const children = (await childJobs(deps, parentJobId)).filter(c => c.status === 'waiting')
  for (const c of children) {
    await deps.db.update(jobs).set({ request: { ...(c.request as object), ...patch(c) }, status: 'queued', nextPollAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(jobs.id, c.id))
    await event(deps.db, c, 'activated', { parentJobId })
  }
  return children
}

export async function cancelChildren(deps: Deps, parentJobId: string, reason: string): Promise<void> {
  for (const c of await childJobs(deps, parentJobId)) {
    if (c.status === 'waiting') await finishWithoutCharge(deps, c, 'canceled', reason)
  }
}

// ── Webhooks, cancel, manual resolution ──────────────────────────

// A webhook only wakes the job. Its body is never trusted: the runner
// re-fetches status from the provider. Unknown ids and bad tokens get the
// same answer, so nothing leaks.
export async function wakeFromWebhook(deps: Deps, provider: string, jobId: string, token: string): Promise<boolean> {
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId))
  if (!job || job.provider !== provider || !job.webhookTokenHash || !safeEqual(job.webhookTokenHash, sha256Hex(token))) return false
  await event(deps.db, job, 'webhook', {})
  if (job.status === 'running' || job.status === 'submitting') {
    await deps.db.update(jobs).set({ nextPollAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(jobs.id, job.id))
    await wakeWorker(deps, { force: true })
  }
  return true
}

export async function getJob(deps: Deps, ctx: Ctx, id: string): Promise<JobRow> {
  const [job] = await deps.db.select().from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.id, id)))
  if (!job) throw notFound('Job')
  return job
}

export async function cancelJob(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const job = await getJob(deps, ctx, id)
  if (!ACTIVE.includes(job.status as JobStatusName)) return
  if (job.status === 'running' && job.providerJobId) {
    const adapter = await adapterFor(deps, job, job.request as GenRequest)
    await adapter.cancel?.(job.providerJobId).catch(() => undefined)
  }
  await finishWithoutCharge(deps, job, 'canceled', 'Canceled by a person.')
}

// For needs_attention jobs: the owner checked the provider console.
export async function resolveJob(deps: Deps, ctx: Ctx, id: string, resolution: { action: 'not_charged' } | { action: 'attach'; providerJobId: string }): Promise<void> {
  const job = await getJob(deps, ctx, id)
  if (job.status !== 'needs_attention') throw new AppError('conflict', 'Only jobs that need attention can be resolved.')
  if (resolution.action === 'not_charged') {
    await finishWithoutCharge(deps, job, 'failed', 'Marked as not charged after checking the provider console.')
  } else {
    await update(deps, job, { status: 'running', providerJobId: resolution.providerJobId, nextPollAt: deps.clock.now(), error: null })
    await event(deps.db, job, 'resolved_attach', { providerJobId: resolution.providerJobId })
    await wakeWorker(deps)
  }
}

// When the next job is due, or null when nothing is queued or running.
async function nextDueAt(deps: Deps): Promise<Date | null> {
  const res = await deps.db.execute(sql`
    select min(coalesce(next_poll_at, created_at)) as due from jobs
    where status in ('queued', 'submitting', 'running', 'ingesting')`)
  const due = (res as unknown as { rows: Array<{ due: string | Date | null }> }).rows[0]?.due
  return due ? new Date(due) : null
}

export type WorkerHandle = (() => Promise<void>) & { wake(): void }

// "poll" checks every second (local development). "wake" runs while work is
// due and otherwise waits for wake() (an HTTP call from the API), so a
// hosted worker sends no queries when idle and the database can suspend.
export function startWorker(deps: Deps, opts: { intervalMs?: number; batch?: number; idle?: 'poll' | 'wake'; maxWaitMs?: number } = {}): WorkerHandle {
  const interval = opts.intervalMs ?? 1000
  const idle = opts.idle ?? 'poll'
  let stopped = false
  let wakeUp: (() => void) | null = null
  let woken = false
  const sleep = (ms: number) => new Promise<void>(resolve => {
    if (woken) { woken = false; resolve(); return }
    const timer = Number.isFinite(ms) ? setTimeout(() => { wakeUp = null; resolve() }, ms) : null
    wakeUp = () => { if (timer) clearTimeout(timer); wakeUp = null; resolve() }
  })
  const running = (async () => {
    // The worker light in the Studio header: this code's version, then
    // "still here" while there is work (server/jobs/workerStatus.ts).
    try {
      await reportWorkerStart(deps, { version: workerVersion(), commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null })
    } catch (e) {
      deps.log.error({ err: e }, 'worker could not report its version')
    }
    while (!stopped) {
      let n = 0
      try {
        n = await tick(deps, opts.batch ?? 5)
        if (n > 0) await touchWorker(deps)
      } catch (e) {
        deps.log.error({ err: e }, 'worker tick failed')
      }
      if (stopped) break
      if (n > 0) continue
      if (idle === 'poll') { await sleep(interval); continue }
      let due: Date | null = null
      try { due = await nextDueAt(deps) } catch (e) { deps.log.error({ err: e }, 'worker could not read the queue') }
      if (!due) {
        deps.log.info('worker idle until woken')
        await sleep(opts.maxWaitMs ?? Number.POSITIVE_INFINITY)
      } else {
        await sleep(Math.min(30_000, Math.max(interval, due.getTime() - deps.clock.now().getTime())))
      }
    }
  })()
  const stop = (async () => {
    stopped = true
    wakeUp?.()
    await running
  }) as WorkerHandle
  stop.wake = () => { if (wakeUp) wakeUp(); else woken = true }
  return stop
}
