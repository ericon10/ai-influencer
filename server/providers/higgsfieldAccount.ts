import type { ModelEntry, StudioConfig } from '../config/load.js'
import { findPrice, splitRef } from '../costs/pricebook.js'
import { usdToMicros } from '../costs/money.js'
import { forceBeautifyOff } from '../core/realism.js'
import type { McpClient } from './mcpClient.js'
import { ProviderError, type CostEstimate, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// How long an estimate waits for Higgsfield's live price on the account path.
// Short, so the owner sees a price within seconds: past it, a saved live
// price or the price book answers.
const ESTIMATE_WAIT_MS = 6_000
// A live price this recent is used as is, without asking Higgsfield again.
export const LIVE_PRICE_FRESH_MS = 6 * 3600_000
// An older live price still beats the price book when Higgsfield is slow.
const LIVE_PRICE_KEEP_MS = 30 * 24 * 3600_000

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
// - motion_control (Kling 3.0 Motion Control) is its own tool: image_id,
//   motion_video_id, resolution 720p or 1080p, scene_control image or video;
//   no prompt and no cost preflight
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
  // Live prices Higgsfield gave before, by request shape (priceSignature).
  livePrices?: LivePriceStore
}

export interface LivePriceStore {
  get(signature: string): Promise<{ credits: number; at: number } | null>
  set(signature: string, credits: number): Promise<void>
}

// What a price depends on. The prompt and the seed do not change it.
export const priceSignature = (req: GenRequest) =>
  [req.model, req.kind, req.resolution ?? '', req.quality ?? '', req.durationSec ?? '', req.audio === true ? 'audio' : ''].join('|')

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

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
// account path are sent, plus its fixed values (audio off for video unless
// the request asks for it).
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
  // Audio is off unless the request asks for it (default rule video-audio-off).
  if ('generate_audio' in params) params.generate_audio = req.audio === true
  if ('sound' in params) params.sound = req.audio === true ? 'on' : 'off'
  // A masked edit changes only the white area of the mask (the end frame
  // helper inpaints the head of the start frame).
  if (req.mask || req.maskFor) {
    if (!m.inpaint_param || !m.roles.mask) throw new ProviderError(`${entry.label} does not take a mask on the account path.`, { retryable: false, submitted: 'no' })
    params[m.inpaint_param] = true
  }
  // Beautify, face-enhance and skin-smoothing options are always off.
  if (!withMedia) return forceBeautifyOff(params)

  const medias: Array<{ value: string; role: string }> = []
  const role = (r: string | undefined, what: string) => {
    if (!r) throw new ProviderError(`${entry.label} does not take ${what} on the account path.`, { retryable: false, submitted: 'no' })
    return r
  }
  for (const r of req.refs ?? []) medias.push({ value: need(r, 'A reference image'), role: role(m.roles.refs, 'reference images') })
  if (req.mask) medias.push({ value: need(req.mask, 'The mask'), role: role(m.roles.mask, 'a mask') })
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

// A preset Higgsfield recommends instead of running the request (seen live
// 2026-10-13: a "submission_failed" job with preset_recommendation, or an
// older text notice naming declined_preset_id). Nothing was created.
function recommendedPreset(value: unknown, text: string): { id: string; name?: string } | undefined {
  if (isObj(value)) {
    const items = [value.jobs, value.results, value.requests].find(Array.isArray) as unknown[] | undefined
    for (const it of [...(items ?? []), value]) {
      const rec = isObj(it) && isObj(it.preset_recommendation) ? it.preset_recommendation : undefined
      const id = rec ? str(rec.preset_id) ?? str(rec.id) : undefined
      if (id) return { id, name: str(rec!.name) }
    }
  }
  const id = text.match(/declined_preset_id[^a-f0-9]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
  return id ? { id } : undefined
}

// The job id from a submit answer, or the reason there is none.
function submitted(value: unknown): { jobId?: string; problem?: string; presetId?: string; presetName?: string } {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  if (BLOCKED.test(text)) return { problem: 'Higgsfield blocked this request: it detected a protected likeness in the reference images.' }
  const rec = recommendedPreset(value, text)
  const preset = rec?.id
  if (isObj(value)) {
    const items = [value.jobs, value.results, value.requests].find(Array.isArray) as unknown[] | undefined
    const first = items?.find(isObj) as Json | undefined
    const id = str(first?.job_id) ?? str(first?.id) ?? str(value.job_id) ?? str(value.id)
    if (id && id !== preset) return { jobId: id }
    // A recommended preset comes with an error; it is not a failure yet.
    if (rec) return { presetId: rec.id, presetName: rec.name }
    const err = str(first?.error) ?? str(first?.message) ?? str(value.error) ?? (Array.isArray(value.errors) && isObj(value.errors[0]) ? str(value.errors[0].error) ?? str(value.errors[0].message) : undefined)
    if (err) return { problem: `Higgsfield did not start the job: ${err}` }
    if (value.unlim_choice !== undefined) return { problem: 'Higgsfield asked which balance to use instead of starting the job. Nothing was charged.' }
    if (value.recovery_tool !== undefined) return { problem: `Higgsfield needs a step first (${str(value.recovery_tool) ?? 'see its message'}). Nothing was started.` }
  }
  if (rec) return { presetId: rec.id, presetName: rec.name }
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
  // before its media exist (an upscale needs the uploaded image), or is too
  // slow to price it and no live price is saved.
  function bookCredits(req: GenRequest): { credits: number; verified: boolean } | null {
    const { provider, model } = splitRef(req.model)
    const video = req.kind === 'video' || req.kind === 'video_extend' || req.kind === 'video_clone' || req.kind === 'audio' || (req.kind === 'upscale' && !!req.sourceVideo)
    const entry = findPrice(o.config.pricebook, provider, model, video ? 'second' : 'image', { resolution: req.resolution, quality: req.quality, aspect: req.aspect })
    if (entry?.credits == null) return null
    return { credits: Math.round(entry.credits * (video ? (req.durationSec ?? 5) : 1) * 100) / 100, verified: entry.credits_verified === true }
  }

  async function livePrice(req: GenRequest, entry: ReturnType<typeof accountModel>): Promise<number | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const slow = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProviderError(`no answer in ${Math.round((o.estimateWaitMs ?? ESTIMATE_WAIT_MS) / 1000)} s`, { retryable: true, submitted: 'no', code: 'slow_price' })), o.estimateWaitMs ?? ESTIMATE_WAIT_MS) })
    const value = await Promise.race([o.client.callTool(tools(req).cost, { params: { ...accountParams(entry, req, false), get_cost: true, use_unlim: false } }), slow])
      .finally(() => clearTimeout(timer))
    const cost = isObj(value) && isObj(value.cost) ? value.cost : undefined
    return typeof cost?.credits_exact === 'number' ? cost.credits_exact : typeof cost?.credits === 'number' ? cost.credits : null
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
      let reason = ''
      // A model with its own tool (motion_control) has no price preflight:
      // the price book answers, marked not confirmed until a run shows it.
      if (req.kind !== 'upscale' && !entry.mcp.tool) {
        // A recent live price for the same request shape answers at once.
        const sig = priceSignature(req)
        const saved = await o.livePrices?.get(sig).catch(() => null) ?? null
        const now = Date.now()
        if (saved && now - saved.at < LIVE_PRICE_FRESH_MS) return creditEstimate(saved.credits, true, 'higgsfield-account-live')
        try {
          // A live price from Higgsfield, but never long enough to stall the
          // estimate.
          const credits = await livePrice(req, entry)
          if (credits != null) {
            await o.livePrices?.set(sig, credits).catch(() => undefined)
            return creditEstimate(credits, true, 'higgsfield-account-live')
          }
          reason = 'Higgsfield answered without a price'
        } catch (e) {
          if (e instanceof ProviderError && e.opts.code === 'reconnect') throw e
          reason = `Higgsfield did not price it: ${(e as Error).message}`
        }
        if (saved && now - saved.at < LIVE_PRICE_KEEP_MS) {
          return { ...creditEstimate(saved.credits, true, 'higgsfield-account-live'), note: `${reason}. Using Higgsfield's live price from ${day(saved.at)}.` }
        }
      }
      const fromBook = bookCredits(req)
      if (fromBook == null) {
        throw new ProviderError(`${reason || 'Higgsfield could not price this'}, and there is no saved price for ${entry.label} yet. Press Retry, or pick another model.`, { retryable: true, submitted: 'no' })
      }
      const book = creditEstimate(fromBook.credits, fromBook.verified, `${o.config.pricebook.version} credits`)
      return reason ? { ...book, note: `${reason}. Using the price book's credit cost${fromBook.verified ? '' : ', which is not confirmed'}.` } : book
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
      // "Upscale this take": the video upscaler keeps the exact take.
      if (req.kind === 'upscale' && req.sourceVideo) {
        const src = req.sourceVideo
        if (!src.width || !src.height) throw new ProviderError('A video upscale needs the clip\'s size.', { retryable: false, submitted: 'no' })
        const value = await o.client.callTool('upscale_video', {
          params: { provider: entry.mcp_id, video_id: need(src, 'The clip to upscale'), width: src.width, height: src.height, ...entry.mcp.fixed },
        }, 'submit')
        const r = submitted(value)
        if (r.jobId) return { jobId: r.jobId, raw: value }
        if (r.problem) throw new ProviderError(r.problem, { retryable: false, submitted: 'no' })
        throw new ProviderError('Higgsfield answered the video upscale without a job id.', { retryable: false, submitted: 'unknown' })
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
      // Clone Video on the account path: Kling 3.0 Motion Control's own tool.
      // The character image and the source clip are media ids; the place
      // comes from the clip ("video") or the image. It takes no prompt.
      if (req.kind === 'video_clone') {
        if (entry.mcp.tool !== 'motion_control') throw new ProviderError(`${entry.label} does not clone a video on the account path.`, { retryable: false, submitted: 'no' })
        const value = await o.client.callTool('motion_control', {
          params: forceBeautifyOff({
            image_id: need(req.refs?.[0], 'The character image'),
            motion_video_id: need(req.sourceVideo, 'The source clip'),
            resolution: req.resolution === '1080p' ? '1080p' : '720p',
            scene_control: req.cloneBackground === 'image' ? 'image' : 'video',
          }),
        }, 'submit')
        const r = submitted(value)
        if (r.jobId) return { jobId: r.jobId, raw: value }
        if (r.problem) throw new ProviderError(r.problem, { retryable: false, submitted: 'no' })
        throw new ProviderError('Higgsfield answered the clone without a job id. It may have started the job; check your Higgsfield history.', { retryable: false, submitted: 'unknown' })
      }
      // use_unlim is always sent, and always false: the plan's credits pay.
      const params = { ...accountParams(entry, req), use_unlim: false }
      const tool = tools(req).batch
      // Higgsfield marks a recommended preset as a tool error (seen live
      // 2026-10-14: "submission_failed" with preset_recommendation, isError
      // set). Nothing was created, so it is an answer to read, not a
      // failure yet; any other tool error still fails the run.
      const submitCall = async (p: Record<string, unknown>) => {
        try {
          return await o.client.callTool(tool, { requests: [{ index: 0, params: p }] }, 'submit')
        } catch (e) {
          const body = e instanceof ProviderError && e.opts.code === 'tool_error' ? e.opts.detail : undefined
          if (body !== undefined && recommendedPreset(body, typeof body === 'string' ? body : JSON.stringify(body))) return body
          throw e
        }
      }
      let value = await submitCall(params)
      let r = submitted(value)
      // A recommended preset instead of a job: nothing was created. The
      // Studio never uses a preset (the prompt and refs are the owner's), so
      // it declines that exact preset (declined_preset_id, per Higgsfield's
      // tool schema) and submits the same request again, up to twice more
      // when it recommends a different one each time.
      const declined: string[] = []
      for (let attempt = 0; attempt < 2 && !r.jobId && !r.problem && r.presetId; attempt++) {
        declined.push(r.presetName ? `"${r.presetName}"` : 'a preset')
        value = await submitCall({ ...params, declined_preset_id: r.presetId })
        r = submitted(value)
      }
      if (!r.jobId && !r.problem && r.presetId) {
        throw new ProviderError(`Higgsfield kept recommending its presets (${[...declined, r.presetName ? `"${r.presetName}"` : 'a preset'].join(', then ')}) instead of running the take, even after the Studio declined them, so nothing ran and nothing was charged. The Studio never uses presets. Try again, or change the prompt slightly.`, { retryable: false, submitted: 'no' })
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
