import axios from 'axios'
import {
  APIError, AuthenticationError, BadInputError, NotEnoughCreditsError, ValidationError, createHiggsfieldClient,
} from '@higgsfield/client/v2'
import type { ModelEntry, StudioConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { forceBeautifyOff } from '../core/realism.js'
import { ProviderError, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// Higgsfield pay-per-use API (not the web subscription), through the
// official SDK (@higgsfield/client, v2 client), as documented at
// docs.higgsfield.ai (read 2026-10-13). Submits use subscribe() with
// withPolling false: POST /{endpoint id}?hf_webhook=<url>, "Authorization:
// Key KEY_ID:KEY_SECRET", answered with { status, request_id, status_url,
// cancel_url }. Every submit carries an Idempotency-Key (the job's own key),
// so Higgsfield never starts or charges the same generation twice for it.
// The SDK's automatic retries stay off: an unknown outcome (a timeout, a 5xx
// after sending) goes to a person, who can check the console.
//
// Status values: queued, in_progress, completed, failed, nsfw, canceled.
// Only "completed" with at least one output counts as success; failed, nsfw
// (moderated) and canceled are never a success, and Higgsfield refunds failed
// and nsfw requests. Errors: 400 invalid input (or concurrency reached), 401
// bad key, 403 not enough credits, 404 model not found, 422 validation (or an
// idempotency key reused with other parameters), 423 model blocked for now,
// 500 server error, 503 model disabled or not ready.
//
// Endpoint ids and input fields are per model, from each model's page in the
// official Model API Reference; they live in config/models.yaml, and the
// adapter refuses any model not yet confirmed by its paid test.
//
// Reference images go through Higgsfield's own upload: POST
// /files/generate-upload-url { content_type } returns { upload_url,
// public_url, upload_headers }; the bytes are PUT to upload_url with those
// headers and without our credentials, and public_url is passed as the
// image. No cloud storage of our own is needed.

// The part of the SDK client the adapter uses (tests can pass their own).
export interface HiggsfieldSubmitter {
  subscribe(endpoint: string, options: { input: Record<string, unknown>; withPolling?: boolean; webhook?: { url: string; secret: string } }): Promise<unknown>
}

export interface HiggsfieldOptions {
  credentials: string // "KEY_ID:KEY_SECRET"
  config: StudioConfig
  baseUrl?: string
  // Status, cancel and uploads.
  fetchImpl?: typeof fetch
  // Submits. Defaults to the official SDK client, one per submit so it can
  // carry that submit's Idempotency-Key header.
  sdk?: (headers: Record<string, string>) => HiggsfieldSubmitter
  timeoutMs?: number
}

interface HfResponse {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'
  request_id: string
  status_url?: string
  cancel_url?: string
  images?: Array<{ url: string }>
  video?: { url: string }
  error?: string
  detail?: unknown
}

// Anything not listed keeps polling (and is flagged stuck if it never ends);
// nothing but "completed" is ever a success.
const STATE: Record<string, JobState> = {
  queued: 'queued', in_progress: 'running', completed: 'succeeded',
  failed: 'failed', error: 'failed',
  nsfw: 'nsfw', moderated: 'nsfw', content_filtered: 'nsfw', rejected: 'nsfw',
  canceled: 'canceled', cancelled: 'canceled',
}

// SDK and transport errors, classified so the runner never double-charges.
export function classifySubmitError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  if (e instanceof AuthenticationError) return new ProviderError('Higgsfield rejected the API key. Check it in Settings.', { retryable: false, submitted: 'no', status: 401 })
  if (e instanceof NotEnoughCreditsError) return new ProviderError('Not enough Higgsfield API credits. Top up in the Higgsfield Console.', { retryable: false, submitted: 'no', status: 403, code: 'credits' })
  if (e instanceof ValidationError || e instanceof BadInputError) {
    // The same key with other parameters: the first request was accepted.
    // (The SDK puts a text detail in the message.)
    if (/idempotency/i.test(e.message)) {
      return new ProviderError('Higgsfield already accepted this job earlier. Find it in the Higgsfield console and attach its request id.', { retryable: false, submitted: 'unknown', status: e.statusCode })
    }
    const d = (e as { details?: Array<{ loc?: string[]; msg?: string }> }).details
    const detail = Array.isArray(d) && d.length ? d.map(x => `${(x.loc ?? []).slice(1).join('.') || 'input'}: ${x.msg ?? ''}`).join('; ') : e.message
    return new ProviderError(`Higgsfield rejected the request: ${detail}`, { retryable: false, submitted: 'no', status: e.statusCode })
  }
  if (e instanceof APIError) {
    const s = e.statusCode
    const detail = typeof (e.responseData as { detail?: unknown } | undefined)?.detail === 'string' ? (e.responseData as { detail: string }).detail : e.message
    if (s === 404) return new ProviderError('Higgsfield could not find that model for this account.', { retryable: false, submitted: 'no', status: s })
    if (s === 423) return new ProviderError('Higgsfield has this model blocked for now. Will retry.', { retryable: true, submitted: 'no', status: s })
    if (s === 429 || s === 503) return new ProviderError(`Higgsfield is busy or the model is not ready (${s}). Will retry.`, { retryable: true, submitted: 'no', status: s })
    return new ProviderError(`Higgsfield error ${s ?? ''}: ${detail}`.trim(), { retryable: false, submitted: 'unknown', status: s })
  }
  if (axios.isAxiosError(e)) {
    // Never connected: safe to try again. Anything after the request left
    // (a timeout, a dropped connection) may have started the job.
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
      return new ProviderError(`Could not reach Higgsfield: ${e.code}`, { retryable: true, submitted: 'no' })
    }
    return new ProviderError(e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' ? 'Higgsfield did not answer in time.' : `Higgsfield connection failed: ${e.code ?? e.message}`, { retryable: false, submitted: 'unknown' })
  }
  return new ProviderError(`Higgsfield submit failed: ${(e as Error).message}`, { retryable: false, submitted: 'unknown' })
}

const imageUrl = (url?: string) => (url ? { type: 'image_url', image_url: url } : undefined)

function needUrl(ref: { url?: string } | undefined, what: string): string {
  if (!ref?.url) throw new ProviderError(`${what} was not uploaded to Higgsfield.`, { retryable: false, submitted: 'no' })
  return ref.url
}

// Request shapes per model family. Only these fields are sent, and any
// beautify, face-enhance, skin-smoothing or prompt-enhance option is always
// off (Realism principle), whatever the family mapping or config says.
export function mapInput(entry: ModelEntry, req: GenRequest): Record<string, unknown> {
  return forceBeautifyOff({ ...mapFamily(entry, req), ...(entry.force_off ?? {}) })
}

function mapFamily(entry: ModelEntry, req: GenRequest): Record<string, unknown> {
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)))
  switch (entry.input_map) {
    case 'marketing_image':
      // Marketing Studio Image (GPT Image 2.5 Flare and Sunburst): plain
      // reference URLs, and prompt enhancement always off.
      return clean({
        prompt: req.prompt,
        image_urls: (req.refs ?? []).map(r => needUrl(r, 'A reference image')),
        aspect_ratio: req.aspect,
        resolution: req.resolution,
        quality: req.quality,
        enhance_prompt: false,
      })
    case 'soul_v2':
      // A trained Soul character rides along as a custom reference.
      return clean({
        prompt: req.prompt, aspect_ratio: req.aspect, resolution: req.resolution, seed: req.seed, batch_size: 1, enhance_prompt: false,
        custom_reference_id: req.identityId, custom_reference_strength: req.identityId ? 1 : undefined,
      })
    case 'generic_image':
      return clean({
        prompt: req.prompt,
        aspect_ratio: req.aspect,
        resolution: req.resolution,
        quality: req.quality,
        seed: req.seed,
        input_images: (req.refs ?? []).map(r => imageUrl(needUrl(r, 'A reference image'))),
      })
    case 'soul_v1':
      // A trained Soul character rides along as a custom reference (official SDK).
      return clean({
        prompt: req.prompt, width_and_height: soulSize(req.aspect), quality: '1080p', batch_size: 1, seed: req.seed, enhance_prompt: false,
        custom_reference_id: req.identityId, custom_reference_strength: req.identityId ? 1 : undefined,
      })
    case 'generic_upscale':
      return clean({ input_image: imageUrl(needUrl(req.refs?.[0], 'The image to upscale')), scale: req.scale ?? 2, resolution: req.resolution })
    case 'seedance_i2v':
      // Seedance image to video: start frame (which sets the framing and the
      // aspect) and an optional end frame. The schema takes nothing else, and
      // generate_audio defaults to true, so it is always sent off. The web app
      // and MCP need mode omni_reference for frames instead (config notes).
      if (req.kind === 'video_extend') throw new ProviderError(`${entry.label} has no extend endpoint on the API. Use the Higgsfield account path to extend.`, { retryable: false, submitted: 'no' })
      return clean({
        prompt: req.prompt,
        image_url: needUrl(req.startFrame, 'The start frame'),
        end_image_url: req.endFrame ? needUrl(req.endFrame, 'The end frame') : undefined,
        duration: req.durationSec,
        resolution: req.resolution,
        generate_audio: false,
      })
    case 'wan_i2v':
      // Wan image to video: first and optional last frame. Audio off, and
      // the model's own prompt rewriting ("thinking") off.
      return clean({
        prompt: req.prompt,
        image_url: needUrl(req.startFrame, 'The start frame'),
        end_image_url: req.endFrame ? needUrl(req.endFrame, 'The end frame') : undefined,
        duration: req.durationSec,
        resolution: req.resolution,
        aspect_ratio: req.aspect,
        seed: req.seed || undefined,
        generate_audio: false,
        enable_thinking: false,
      })
    case 'kling_v3':
      // Standard and Pro: sound defaults to on, so it is always sent off.
      // Turbo has no sound, last-frame or elements field; the Studio strips
      // its audio on arrival.
      return clean({
        prompt: req.prompt,
        image_url: needUrl(req.startFrame, 'The start frame'),
        last_image_url: req.endFrame && entry.audio !== 'always_on' ? needUrl(req.endFrame, 'The end frame') : undefined,
        duration: req.durationSec,
        resolution: entry.audio === 'always_on' ? req.resolution : undefined,
        sound: entry.audio === 'always_on' ? undefined : 'off',
      })
    case 'generic_audio':
      return clean({ prompt: req.prompt, duration: req.durationSec })
    case 'generic_video':
      return clean({
        prompt: req.prompt,
        input_images: [imageUrl(needUrl(req.startFrame, 'The start frame'))],
        end_image: req.endFrame ? imageUrl(needUrl(req.endFrame, 'The end frame')) : undefined,
        source_video: req.sourceVideo ? { type: 'video_url', video_url: needUrl(req.sourceVideo, 'The source video') } : undefined,
        duration: req.durationSec,
        resolution: req.resolution,
        aspect_ratio: req.aspect,
        seed: req.seed,
        // Audio off, always (SPEC 5.4 rule 27).
        generate_audio: false,
        enhance_prompt: false,
      })
    default:
      throw new ProviderError(`No input mapping "${entry.input_map}" for ${entry.ref}.`, { retryable: false, submitted: 'no' })
  }
}

function soulSize(aspect?: string): string {
  return ({ '3:4': '1536x2048', '9:16': '1152x2048', '4:5': '1632x2048', '1:1': '2048x2048', '16:9': '2048x1152' } as Record<string, string>)[aspect ?? '3:4'] ?? '1536x2048'
}

function outputsOf(r: HfResponse): Output[] {
  const out: Output[] = (r.images ?? []).map(i => ({ url: i.url, kind: 'image' as const }))
  if (r.video?.url) out.push({ url: r.video.url, kind: 'video' })
  return out
}

export function createHiggsfieldAdapter(opts: HiggsfieldOptions): ProviderAdapter {
  const base = (opts.baseUrl ?? 'https://api.higgsfield.ai').replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 60_000
  const credentials = opts.credentials.trim()
  const headers = { Authorization: `Key ${credentials}`, 'Content-Type': 'application/json', Accept: 'application/json' }
  // Retries off for submits (see above); the runner decides what to retry.
  const sdkFor = opts.sdk ?? ((extra: Record<string, string>) => createHiggsfieldClient({ credentials, baseURL: base, timeout: timeoutMs, maxRetries: 0, headers: extra }))

  async function call<T = HfResponse>(method: 'GET' | 'POST', path: string, body?: unknown, phase: 'submit' | 'read' = 'read'): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal })
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError'
      // A timeout after sending a submit may mean the job was accepted.
      throw new ProviderError(aborted ? 'Higgsfield did not answer in time.' : `Could not reach Higgsfield: ${(e as Error).message}`, {
        retryable: !aborted || phase === 'read', submitted: phase === 'submit' && aborted ? 'unknown' : 'no',
      })
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json: (T & { detail?: unknown }) | undefined
    try { json = text ? JSON.parse(text) : undefined } catch { /* non-JSON error body */ }
    if (res.ok && json) return json
    const detail = typeof json?.detail === 'string' ? json.detail : text.slice(0, 300)
    const s = res.status
    if (s === 401) throw new ProviderError('Higgsfield rejected the API key. Check it in Settings.', { retryable: false, submitted: 'no', status: s })
    if (s === 403) throw new ProviderError('Not enough Higgsfield API credits. Top up in the Higgsfield Console.', { retryable: false, submitted: 'no', status: s, code: 'credits' })
    if (s === 400 || s === 422) throw new ProviderError(`Higgsfield rejected the request: ${detail}`, { retryable: false, submitted: 'no', status: s })
    if (s === 404) throw new ProviderError('Higgsfield could not find that endpoint or job.', { retryable: false, submitted: 'no', status: s })
    if (s === 423 || s === 429 || s === 502 || s === 503 || s === 504) throw new ProviderError(`Higgsfield is busy (${s}). Will retry.`, { retryable: true, submitted: 'no', status: s })
    throw new ProviderError(`Higgsfield error ${s}: ${detail}`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no', status: s })
  }

  // Only confirmed models run, except the one small paid test that confirms
  // a model whose endpoint was entered from the official reference.
  function entryFor(ref: string, modelTest = false): ModelEntry {
    const entry = opts.config.models.models.find(m => m.ref === ref)
    if (!entry || !ref.startsWith('higgsfield/')) throw new ProviderError(`Unknown Higgsfield model "${ref}".`, { retryable: false, submitted: 'no' })
    if (entry.api === false) throw new ProviderError(`${entry.label} is not on the Higgsfield API. Run it on your Higgsfield account (Settings, Billing).`, { retryable: false, submitted: 'no', code: 'unverified_model' })
    if (!entry.endpoint || (!entry.verified && !modelTest)) {
      throw new ProviderError(`${entry.label} is not confirmed for the Higgsfield API yet. Enter its endpoint from the official Model API Reference in Settings and run its test first.`, { retryable: false, submitted: 'no', code: 'unverified_model' })
    }
    return entry
  }

  return {
    id: 'higgsfield',
    needsPublicAssetUrls: true,
    async listModels() {
      return opts.config.models.models.filter(m => m.ref.startsWith('higgsfield/'))
        .map(m => ({ ref: m.ref, provider: 'higgsfield', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: m.verified && !!m.endpoint }))
    },
    async estimate(req) { return estimateGen(opts.config, req) },
    async uploadAsset(data, mime) {
      const slot = await call<{ upload_url?: string; public_url?: string; upload_headers?: Record<string, string> }>('POST', '/files/generate-upload-url', { content_type: mime })
      if (!slot.upload_url?.startsWith('https://') || !slot.public_url?.startsWith('https://')) {
        throw new ProviderError('Higgsfield did not return an upload link.', { retryable: true, submitted: 'no' })
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        // The presigned link carries its own authorization; never send our key.
        // Some slots name extra headers the storage expects (the Python SDK copies them).
        const extra = Object.fromEntries(Object.entries(slot.upload_headers ?? {}).filter(([k]) => k.toLowerCase() !== 'authorization'))
        const res = await doFetch(slot.upload_url, { method: 'PUT', headers: { 'Content-Type': mime, ...extra }, body: new Uint8Array(data), signal: controller.signal })
        if (!res.ok) throw new ProviderError(`Uploading a reference image to Higgsfield failed (${res.status}).`, { retryable: res.status >= 500, submitted: 'no', status: res.status })
      } catch (e) {
        if (e instanceof ProviderError) throw e
        throw new ProviderError(`Uploading a reference image to Higgsfield failed: ${(e as Error).message}`, { retryable: true, submitted: 'no' })
      } finally {
        clearTimeout(timer)
      }
      return slot.public_url
    },
    async submit(req, { idempotencyKey, webhookUrl }) {
      const entry = entryFor(req.model, req.modelTest === true)
      if ((req.kind === 'video' || req.kind === 'video_extend') && req.audio !== false) {
        throw new ProviderError('Video requests must send audio off.', { retryable: false, submitted: 'no' })
      }
      const endpoint = entry.endpoint!.startsWith('/') ? entry.endpoint! : `/${entry.endpoint}`
      let r: HfResponse
      try {
        const sdk = sdkFor({ 'Idempotency-Key': idempotencyKey })
        r = await sdk.subscribe(endpoint, { input: mapInput(entry, req), withPolling: false, ...(webhookUrl ? { webhook: { url: webhookUrl, secret: '' } } : {}) }) as HfResponse
      } catch (e) {
        throw classifySubmitError(e)
      }
      if (!r?.request_id) throw new ProviderError('Higgsfield accepted the request but returned no request id.', { retryable: false, submitted: 'unknown' })
      return { jobId: r.request_id, raw: r }
    },
    async status(jobId): Promise<JobStatus> {
      const r = await call('GET', `/requests/${encodeURIComponent(jobId)}/status`)
      const state = STATE[String(r.status).toLowerCase()] ?? 'running'
      if (state === 'succeeded') {
        // Completed without a single output is not a success.
        const outputs = outputsOf(r)
        return outputs.length ? { state, outputs, raw: r } : { state: 'failed', error: 'Higgsfield finished without returning any output.', raw: r }
      }
      const error = state === 'nsfw' ? 'Higgsfield moderation blocked this result (refunded).'
        : state === 'failed' ? (r.error ?? 'Higgsfield reported a failure (refunded).')
        : state === 'canceled' ? 'Canceled on Higgsfield.' : undefined
      return { state, error, raw: r }
    },
    async result(jobId) {
      const r = await call('GET', `/requests/${encodeURIComponent(jobId)}/status`)
      return outputsOf(r)
    },
    async cancel(jobId) {
      await call('POST', `/requests/${encodeURIComponent(jobId)}/cancel`)
    },
    async verifyCredentials() {
      // A status lookup for a job that does not exist is free: 404 proves
      // the key is valid, 401 proves it is not.
      try {
        await call('GET', '/requests/00000000-0000-0000-0000-000000000000/status')
        return { ok: true, message: 'Higgsfield key works.' }
      } catch (e) {
        const status = e instanceof ProviderError ? e.opts.status : undefined
        if (status === 404 || status === 422 || status === 400) return { ok: true, message: 'Higgsfield key works.' }
        return { ok: false, message: (e as Error).message }
      }
    },
  }
}
