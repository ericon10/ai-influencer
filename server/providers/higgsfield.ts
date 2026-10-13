import type { ModelEntry, StudioConfig } from '../config/load'
import { estimateGen } from '../costs/pricebook'
import { forceBeautifyOff } from '../core/realism'
import { ProviderError, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types'

// Higgsfield pay-per-use API (not the web subscription). Wire format from the
// official SDK (MIT): base https://api.higgsfield.ai, header
// "Authorization: Key KEY_ID:KEY_SECRET", POST /{endpoint}?hf_webhook=<url>
// returns { status, request_id, status_url, cancel_url }, and
// GET /requests/{id}/status returns the same shape with images[] or video.
// 401 = bad key, 403 = not enough credits, 400/422 = bad input.
//
// Model endpoints and input shapes vary per model; they live in
// config/models.yaml and the adapter refuses to submit to any model not yet
// marked verified, so nothing is sent until the owner has confirmed it.
//
// Reference images go through Higgsfield's own upload (also from the SDK):
// POST /files/generate-upload-url { content_type } returns { upload_url,
// public_url }; the bytes are PUT to upload_url without our credentials and
// public_url is passed as the image. No cloud storage of our own is needed.

export interface HiggsfieldOptions {
  credentials: string // "KEY_ID:KEY_SECRET"
  config: StudioConfig
  baseUrl?: string
  fetchImpl?: typeof fetch
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

const STATE: Record<HfResponse['status'], JobState> = {
  queued: 'queued', in_progress: 'running', completed: 'succeeded', failed: 'failed', nsfw: 'nsfw', canceled: 'canceled',
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
      // REST takes start and end frames directly; the web app and MCP need
      // mode omni_reference for them instead (both paths are recorded in
      // config/models.yaml). Field names are confirmed by the model's paid
      // test. Audio is always sent off.
      return clean({
        prompt: req.prompt,
        image_url: needUrl(req.startFrame, 'The start frame'),
        end_image_url: req.endFrame ? needUrl(req.endFrame, 'The end frame') : undefined,
        duration: req.durationSec,
        resolution: req.resolution,
        seed: req.seed,
        generate_audio: false,
      })
    case 'kling_v3':
      // Sound is always sent off. Turbo has no sound switch; the Studio
      // strips its audio on arrival. Field names are confirmed by the
      // model's paid test.
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
  const headers = { Authorization: `Key ${opts.credentials}`, 'Content-Type': 'application/json', Accept: 'application/json' }

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
    if (s === 429 || s === 502 || s === 503 || s === 504) throw new ProviderError(`Higgsfield is busy (${s}). Will retry.`, { retryable: true, submitted: 'no', status: s })
    throw new ProviderError(`Higgsfield error ${s}: ${detail}`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no', status: s })
  }

  // Only confirmed models run, except the one small paid test that confirms
  // a model whose endpoint was entered from the official reference.
  function entryFor(ref: string, modelTest = false): ModelEntry {
    const entry = opts.config.models.models.find(m => m.ref === ref)
    if (!entry || !ref.startsWith('higgsfield/')) throw new ProviderError(`Unknown Higgsfield model "${ref}".`, { retryable: false, submitted: 'no' })
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
    async submit(req, { webhookUrl }) {
      const entry = entryFor(req.model, req.modelTest === true)
      if ((req.kind === 'video' || req.kind === 'video_extend') && req.audio !== false) {
        throw new ProviderError('Video requests must send audio off.', { retryable: false, submitted: 'no' })
      }
      const endpoint = entry.endpoint!.startsWith('/') ? entry.endpoint! : `/${entry.endpoint}`
      const path = webhookUrl ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}hf_webhook=${encodeURIComponent(webhookUrl)}` : endpoint
      const r = await call('POST', path, mapInput(entry, req), 'submit')
      if (!r.request_id) throw new ProviderError('Higgsfield accepted the request but returned no request id.', { retryable: false, submitted: 'unknown' })
      return { jobId: r.request_id, raw: r }
    },
    async status(jobId): Promise<JobStatus> {
      const r = await call('GET', `/requests/${encodeURIComponent(jobId)}/status`)
      const state = STATE[r.status] ?? 'running'
      return { state, outputs: state === 'succeeded' ? outputsOf(r) : undefined, error: r.error, raw: r }
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
