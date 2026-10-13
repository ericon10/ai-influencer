import type { ModelEntry, StudioConfig } from '../config/load.js'
import { findPrice, splitRef } from '../costs/pricebook.js'
import { usdToMicros } from '../costs/money.js'
import { forceBeautifyOff } from '../core/realism.js'
import type { McpClient } from './mcpClient.js'
import { ProviderError, type CostEstimate, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// How long an estimate waits for Higgsfield's live price on the account path.
const ESTIMATE_WAIT_MS = 20_000

// The owner's own Higgsfield account (the MCP connector, plan credits), next
// to the pay-per-use REST API adapter that customers and production use.
// Which one runs is a per-account default (Settings, Higgsfield billing).
//
// Tools, from the connector's own descriptions (read 2026-10-13):
// - generate_{image,video,audio}_batch submit headless jobs and return job
//   ids; params are { model, prompt, medias[{ value, role }], ...model params }
// - generate_{image,video,audio} with get_cost:true price a request in
//   credits without submitting anything (free)
// - upscale_image needs the source width and height
// - jobs_wait with timeout_seconds 0 is an immediate status snapshot
// - media_upload, PUT to the presigned link, media_confirm: medias take the
//   media id, never a URL
// - balance: credits and plan
// use_unlim is always false: the plan's credits pay, and free-trial
// generations are never spent on the owner's behalf.

export interface HiggsfieldAccountOptions {
  config: StudioConfig
  client: McpClient
  // What one credit is worth in USD, set by the owner (0 unless set). Credit
  // runs count toward budgets at this value.
  creditUsd: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
  // How long an estimate waits for Higgsfield's live price.
  estimateWaitMs?: number
}

export interface AccountBalance { credits: number | null; plan: string | null }

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

const STATE: Record<string, JobState> = {
  completed: 'succeeded', done: 'succeeded', succeeded: 'succeeded',
  failed: 'failed', error: 'failed', rejected: 'failed', lookup_failed: 'failed', not_found: 'failed',
  nsfw: 'nsfw', content_filtered: 'nsfw',
  canceled: 'canceled', cancelled: 'canceled',
  queued: 'queued', pending: 'queued', waiting: 'queued',
}

const BLOCKED = /ip detected|ip.block|vpn detected|blocked this request/i

export function accountModel(config: StudioConfig, ref: string): ModelEntry & { mcp_id: string; mcp: NonNullable<ModelEntry['mcp']> } {
  const entry = config.models.models.find(m => m.ref === ref)
  if (!entry || !ref.startsWith('higgsfield/')) throw new ProviderError(`Unknown Higgsfield model "${ref}".`, { retryable: false, submitted: 'no' })
  if (!entry.mcp_id || !entry.mcp) {
    throw new ProviderError(`${entry.label} is not available through your Higgsfield account. Switch Higgsfield billing to the API in Settings to use it.`, { retryable: false, submitted: 'no', code: 'not_on_account' })
  }
  return entry as ModelEntry & { mcp_id: string; mcp: NonNullable<ModelEntry['mcp']> }
}

function need(ref: { url?: string } | undefined, what: string): string {
  if (!ref?.url) throw new ProviderError(`${what} was not uploaded to Higgsfield.`, { retryable: false, submitted: 'no' })
  return ref.url
}

// The params for one request. Only the inputs the model accepts on the
// account path are sent, plus its fixed values (audio off for video).
export function accountParams(entry: ReturnType<typeof accountModel>, req: GenRequest, withMedia = true): Json {
  const m = entry.mcp
  const candidate: Json = {
    aspect_ratio: req.aspect,
    resolution: req.resolution,
    quality: req.quality,
    seed: req.seed,
    duration: req.durationSec != null ? Math.round(req.durationSec) : undefined,
    soul_id: req.identityId,
  }
  // Seedance needs omni_reference for start and end frames on this path; the
  // default text-to-video mode rejects reference media (verified live).
  if (entry.input_map === 'seedance_i2v') candidate.mode = req.startFrame || req.endFrame ? 'omni_reference' : 't2v'
  const params: Json = { model: entry.mcp_id, prompt: req.prompt }
  for (const k of m.params) if (candidate[k] !== undefined && candidate[k] !== null) params[k] = candidate[k]
  Object.assign(params, m.fixed, entry.force_off ?? {})
  // Beautify, face-enhance and skin-smoothing options are always off.
  if (!withMedia) return forceBeautifyOff(params)

  const medias: Array<{ value: string; role: string }> = []
  const role = (r: string | undefined, what: string) => {
    if (!r) throw new ProviderError(`${entry.label} does not take ${what} on the account path.`, { retryable: false, submitted: 'no' })
    return r
  }
  for (const r of req.refs ?? []) medias.push({ value: need(r, 'A reference image'), role: role(m.roles.refs, 'reference images') })
  if (req.startFrame) medias.push({ value: need(req.startFrame, 'The start frame'), role: role(m.roles.start, 'a start frame') })
  if (req.endFrame) medias.push({ value: need(req.endFrame, 'The end frame'), role: role(m.roles.end, 'an end frame') })
  if (req.sourceVideo) throw new ProviderError(`${entry.label} does not take a source video on the account path.`, { retryable: false, submitted: 'no' })
  if (medias.length) params.medias = medias
  return forceBeautifyOff(params)
}

function tools(req: GenRequest): { batch: string; cost: string } {
  if (req.kind === 'video' || req.kind === 'video_extend') return { batch: 'generate_video_batch', cost: 'generate_video' }
  if (req.kind === 'audio') return { batch: 'generate_audio_batch', cost: 'generate_audio' }
  return { batch: 'generate_image_batch', cost: 'generate_image' }
}

// The job id from a submit answer, or the reason there is none.
function submitted(value: unknown): { jobId?: string; problem?: string; presetId?: string } {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  if (BLOCKED.test(text)) return { problem: 'Higgsfield blocked this request: it detected a protected likeness in the reference images.' }
  const preset = text.match(/declined_preset_id[^a-f0-9]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
  if (isObj(value)) {
    const items = [value.jobs, value.results, value.requests].find(Array.isArray) as unknown[] | undefined
    const first = items?.find(isObj) as Json | undefined
    const id = str(first?.job_id) ?? str(first?.id) ?? str(value.job_id) ?? str(value.id)
    if (id && id !== preset) return { jobId: id }
    const err = str(first?.error) ?? str(first?.message) ?? str(value.error) ?? (Array.isArray(value.errors) && isObj(value.errors[0]) ? str(value.errors[0].error) ?? str(value.errors[0].message) : undefined)
    if (err) return { problem: `Higgsfield did not start the job: ${err}` }
    if (value.unlim_choice !== undefined) return { problem: 'Higgsfield asked which balance to use instead of starting the job. Nothing was charged.' }
    if (value.recovery_tool !== undefined) return { problem: `Higgsfield needs a step first (${str(value.recovery_tool) ?? 'see its message'}). Nothing was started.` }
  }
  if (preset) return { presetId: preset }
  return {}
}

function kindOfUrl(url: string): Output['kind'] | undefined {
  const path = url.split('?')[0]!.toLowerCase()
  if (/\.(mp4|mov|webm|m4v)$/.test(path)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(path)) return 'audio'
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(path)) return 'image'
  return undefined
}

// The type field when present, else the file extension, so a video is
// always known as one (its audio is stripped on arrival).
function outputsFrom(job: Json): Output[] {
  const urls = new Set<string>()
  const add = (v: unknown) => { const u = str(v); if (u?.startsWith('https://')) urls.add(u) }
  add(job.result_url)
  add(job.url)
  if (Array.isArray(job.result_urls)) job.result_urls.forEach(add)
  if (isObj(job.results)) { add(job.results.rawUrl); add(job.results.url) }
  const t = str(job.type)
  const typed: Output['kind'] | undefined = t === 'image' || t === 'video' || t === 'audio' ? t : undefined
  return [...urls].map(url => ({ url, kind: kindOfUrl(url) ?? typed ?? 'image' }))
}

export function createHiggsfieldAccountAdapter(o: HiggsfieldAccountOptions): ProviderAdapter & { balance(): Promise<AccountBalance> } {
  const doFetch = o.fetchImpl ?? fetch
  const timeoutMs = o.timeoutMs ?? 60_000
  const creditMicros = usdToMicros(o.creditUsd)

  function creditEstimate(credits: number, live: boolean, version: string): CostEstimate {
    const amount = Math.round(credits * creditMicros)
    return {
      totalMicros: amount,
      lines: [{ label: `${credits} plan credits`, quantity: credits, unit: 'credit', unitPriceMicros: creditMicros, amountMicros: amount }],
      priceVersion: version,
      verified: live,
      credits,
    }
  }

  // Credits from the price book, when Higgsfield cannot price a request
  // before its media exist (an upscale needs the uploaded image).
  function bookCredits(req: GenRequest): number | null {
    const { provider, model } = splitRef(req.model)
    const video = req.kind === 'video' || req.kind === 'video_extend' || req.kind === 'audio'
    const entry = findPrice(o.config.pricebook, provider, model, video ? 'second' : 'image', { resolution: req.resolution, quality: req.quality, aspect: req.aspect })
    if (entry?.credits == null) return null
    return Math.round(entry.credits * (video ? (req.durationSec ?? 5) : 1) * 100) / 100
  }

  async function balance(): Promise<AccountBalance> {
    const value = await o.client.callTool('balance', {})
    const credits = isObj(value) && typeof value.credits === 'number' ? value.credits : null
    const plan = isObj(value) ? str(value.subscription_plan_type) ?? str(value.plan) ?? null : null
    return { credits, plan: plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null }
  }

  async function snapshot(jobId: string): Promise<Json> {
    const value = await o.client.callTool('jobs_wait', { jobs: [{ index: 0, job_id: jobId }], timeout_seconds: 0 })
    const job = isObj(value) && Array.isArray(value.jobs) ? value.jobs.find(isObj) : undefined
    if (!job) throw new ProviderError('Higgsfield sent no status for that job.', { retryable: true, submitted: 'no' })
    return job as Json
  }

  return {
    id: 'higgsfield_account',
    needsPublicAssetUrls: true,
    async listModels() {
      return o.config.models.models.filter(m => m.ref.startsWith('higgsfield/') && m.mcp_id && m.mcp)
        .map(m => ({ ref: m.ref, provider: 'higgsfield', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: true }))
    },
    async estimate(req) {
      const entry = accountModel(o.config, req.model)
      if (req.kind !== 'upscale') {
        try {
          // A live price from Higgsfield, but never long enough to stall the
          // estimate: past the wait, the price book answers instead.
          let timer: ReturnType<typeof setTimeout> | undefined
          const slow = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProviderError('Higgsfield took too long to price this.', { retryable: true, submitted: 'no', code: 'slow_price' })), o.estimateWaitMs ?? ESTIMATE_WAIT_MS) })
          const value = await Promise.race([o.client.callTool(tools(req).cost, { params: { ...accountParams(entry, req, false), get_cost: true, use_unlim: false } }), slow])
            .finally(() => clearTimeout(timer))
          const cost = isObj(value) && isObj(value.cost) ? value.cost : undefined
          const credits = typeof cost?.credits_exact === 'number' ? cost.credits_exact : typeof cost?.credits === 'number' ? cost.credits : null
          if (credits != null) return creditEstimate(credits, true, 'higgsfield-account-live')
        } catch (e) {
          if (e instanceof ProviderError && e.opts.code === 'reconnect') throw e
        }
      }
      const credits = bookCredits(req)
      if (credits == null) throw new ProviderError(`Higgsfield did not price ${entry.label} in time, and the price book has no credit cost for it. Try again in a moment.`, { retryable: true, submitted: 'no' })
      return creditEstimate(credits, true, `${o.config.pricebook.version} credits`)
    },
    async uploadAsset(data, mime) {
      const ext = mime.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png'
      const slot = await o.client.callTool('media_upload', { filename: `studio_${Date.now()}.${ext}`, content_type: mime })
      const f0 = isObj(slot) ? ([slot.uploads, slot.files, slot.data].find(Array.isArray) as unknown[] | undefined)?.find(isObj) as Json | undefined : undefined
      const uploadUrl = isObj(slot) ? str(slot.upload_url) ?? str(f0?.upload_url) ?? str(f0?.url) : undefined
      const mediaId = isObj(slot) ? str(slot.media_id) ?? str(f0?.media_id) ?? str(f0?.id) ?? str(slot.id) : undefined
      if (!uploadUrl?.startsWith('https://') || !mediaId) throw new ProviderError('Higgsfield did not return an upload link.', { retryable: true, submitted: 'no' })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        // The presigned link carries its own authorization; no sign-in token.
        const res = await doFetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: new Uint8Array(data), signal: controller.signal })
        if (!res.ok) throw new ProviderError(`Uploading a reference image to Higgsfield failed (${res.status}).`, { retryable: res.status >= 500, submitted: 'no', status: res.status })
      } catch (e) {
        if (e instanceof ProviderError) throw e
        throw new ProviderError(`Uploading a reference image to Higgsfield failed: ${(e as Error).message}`, { retryable: true, submitted: 'no' })
      } finally {
        clearTimeout(timer)
      }
      const type = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image'
      await o.client.callTool('media_confirm', { media_id: mediaId, type })
      return mediaId
    },
    async submit(req) {
      const entry = accountModel(o.config, req.model)
      if ((req.kind === 'video' || req.kind === 'video_extend') && req.audio !== false) {
        throw new ProviderError('Video requests must send audio off.', { retryable: false, submitted: 'no' })
      }
      if (req.kind === 'upscale') {
        const src = req.refs?.[0]
        if (!src?.width || !src.height) throw new ProviderError('An upscale needs the source image size.', { retryable: false, submitted: 'no' })
        const value = await o.client.callTool('upscale_image', {
          params: forceBeautifyOff({ image_id: need(src, 'The image to upscale'), width: src.width, height: src.height, provider: entry.mcp_id, ...entry.mcp.fixed, ...(entry.force_off ?? {}) }),
        }, 'submit')
        const r = submitted(value)
        if (r.jobId) return { jobId: r.jobId, raw: value }
        if (r.problem) throw new ProviderError(r.problem, { retryable: false, submitted: 'no' })
        throw new ProviderError('Higgsfield answered the upscale without a job id.', { retryable: false, submitted: 'unknown' })
      }
      const params = { ...accountParams(entry, req), use_unlim: false }
      const tool = tools(req).batch
      let value = await o.client.callTool(tool, { requests: [{ index: 0, params }] }, 'submit')
      let r = submitted(value)
      // A preset suggestion instead of a job: nothing was created, so decline
      // that preset and submit once more.
      if (!r.jobId && !r.problem && r.presetId) {
        value = await o.client.callTool(tool, { requests: [{ index: 0, params: { ...params, declined_preset_id: r.presetId } }] }, 'submit')
        r = submitted(value)
      }
      if (r.jobId) return { jobId: r.jobId, raw: value }
      if (r.problem) throw new ProviderError(r.problem, { retryable: false, submitted: 'no' })
      throw new ProviderError('Higgsfield answered without a job id. It may have started the job; check your Higgsfield history.', { retryable: false, submitted: 'unknown' })
    },
    async status(jobId): Promise<JobStatus> {
      const job = await snapshot(jobId)
      const raw = (str(job.status) ?? '').toLowerCase()
      const state = STATE[raw] ?? 'running'
      if (state === 'succeeded') {
        const outputs = outputsFrom(job)
        // Done but the link is not there yet: ask again shortly.
        if (!outputs.length) return { state: 'running', pollAfterSec: 3, raw: job }
        return { state, outputs, raw: job }
      }
      if (raw === 'lookup_failed' && job.retryable === true) return { state: 'running', pollAfterSec: 10, raw: job }
      return { state, error: state === 'running' || state === 'queued' ? undefined : str(job.error) ?? str(job.message), raw: job }
    },
    async result(jobId) {
      return outputsFrom(await snapshot(jobId))
    },
    async verifyCredentials() {
      try {
        const b = await balance()
        return { ok: true, message: `Connected${b.plan ? `, ${b.plan} plan` : ''}${b.credits != null ? `, ${b.credits.toLocaleString('en-US')} credits` : ''}.` }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    },
    balance,
  }
}
