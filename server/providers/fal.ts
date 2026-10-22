import type { ModelEntry, StudioConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { forceBeautifyOff } from '../core/realism.js'
import { ProviderError, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// fal (owner, 2026-10-22, item 19): the API path for Recreate when there is
// no Higgsfield plan. Seedream 4.5 edit (the stills' fallback), Wan 2.2
// Animate in replace mode and Kling 3.0 Motion Control (the motion step).
// The key is the account's own (Settings > Provider keys), sealed in
// the vault like every provider key; never in code or the browser.
//
// The queue API (fal.ai docs, Queue): POST https://queue.fal.run/{endpoint}
// with "Authorization: Key FAL_KEY" and the model's input as JSON answers
// { request_id, status_url, response_url, cancel_url }. Status is IN_QUEUE,
// IN_PROGRESS or COMPLETED; the result (GET response_url) carries `images`
// or `video`. A failed request answers the result call with an error, and
// fal does not charge for it. `?fal_webhook=` wakes the job; the runner
// polls without it. Reference images and the clip are passed as URLs (the
// runner's presigned storage links).

export interface FalOptions {
  apiKey: string
  config: StudioConfig
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const STATE: Record<string, JobState> = {
  IN_QUEUE: 'queued', IN_PROGRESS: 'running', COMPLETED: 'succeeded',
  FAILED: 'failed', ERROR: 'failed', CANCELLED: 'canceled', CANCELED: 'canceled',
}

function needUrl(ref: { url?: string } | undefined, what: string): string {
  if (!ref?.url) throw new ProviderError(`${what} has no link fal can read. Set up cloud storage (R2) for live runs with references.`, { retryable: false, submitted: 'no' })
  return ref.url
}

// fal's image sizes are named; 9:16 is portrait_16_9 in its words.
const FAL_SIZE: Record<string, string> = { '9:16': 'portrait_16_9', '16:9': 'landscape_16_9', '3:4': 'portrait_4_3', '4:3': 'landscape_4_3', '1:1': 'square_hd' }

// Request shapes per model (each model's page on fal.ai). Only these fields
// are sent, and any beautify, face-enhance or prompt-enhance option is
// forced off (Realism principle).
export function mapFalInput(entry: ModelEntry, req: GenRequest): Record<string, unknown> {
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)))
  const input = (() => {
    switch (entry.input_map) {
      case 'fal_seedream_edit':
        // Seedream 4.5 edit: the clip's frame and the face refs as image_urls.
        return clean({
          prompt: req.prompt,
          image_urls: (req.refs ?? []).slice(0, entry.max_refs).map(r => needUrl(r, 'A reference image')),
          image_size: FAL_SIZE[req.aspect ?? '9:16'] ?? 'portrait_16_9',
          num_images: 1,
          seed: req.seed,
          enable_safety_checker: true,
        })
      case 'fal_wan_animate_replace':
        // Wan 2.2 Animate, replace mode: the clip keeps its place, light
        // and motion; the person becomes the one in the image.
        return clean({
          video_url: needUrl(req.sourceVideo, 'The source clip'),
          image_url: needUrl(req.refs?.[0], 'The character image'),
          resolution: req.resolution === '480p' || req.resolution === '580p' ? req.resolution : '720p',
          seed: req.seed || undefined,
          enable_safety_checker: true,
        })
      case 'fal_kling_motion_control':
        // Kling 3.0 Motion Control: the still takes the clip's motion; the
        // clip's orientation (up to 30 s). The clip's sound is put back by
        // the Studio when asked, never kept here.
        return clean({
          prompt: req.prompt || undefined,
          image_url: needUrl(req.refs?.[0], 'The character image'),
          video_url: needUrl(req.sourceVideo, 'The source clip'),
          character_orientation: 'video',
          keep_original_sound: false,
        })
      default:
        throw new ProviderError(`No fal input mapping "${entry.input_map}" for ${entry.ref}.`, { retryable: false, submitted: 'no' })
    }
  })()
  return forceBeautifyOff({ ...input, ...(entry.force_off ?? {}) })
}

// A fal job id carries the app the request belongs to, because status and
// result live under the app ("fal-ai/wan"), not the full endpoint path.
const appOf = (endpoint: string) => endpoint.split('/').slice(0, 2).join('/')
const packId = (endpoint: string, requestId: string) => `${appOf(endpoint)}|${requestId}`
function unpackId(jobId: string): { app: string; requestId: string } {
  const i = jobId.lastIndexOf('|')
  if (i < 1) throw new ProviderError(`Not a fal job id: ${jobId}`, { retryable: false, submitted: 'no' })
  return { app: jobId.slice(0, i), requestId: jobId.slice(i + 1) }
}

function outputsOf(r: { images?: Array<{ url: string; width?: number; height?: number }>; image?: { url: string }; video?: { url: string } }): Output[] {
  const out: Output[] = (r.images ?? []).map(i => ({ url: i.url, kind: 'image' as const, width: i.width, height: i.height }))
  if (r.image?.url) out.push({ url: r.image.url, kind: 'image' })
  if (r.video?.url) out.push({ url: r.video.url, kind: 'video' })
  return out
}

export function createFalAdapter(opts: FalOptions): ProviderAdapter {
  const base = (opts.baseUrl ?? 'https://queue.fal.run').replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 60_000
  const headers = { Authorization: `Key ${opts.apiKey.trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' }

  async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, phase: 'submit' | 'read' = 'read'): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal })
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError'
      throw new ProviderError(aborted ? 'fal did not answer in time.' : `Could not reach fal: ${(e as Error).message}`, {
        retryable: !aborted || phase === 'read', submitted: phase === 'submit' && aborted ? 'unknown' : 'no',
      })
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json: (T & { detail?: unknown; error?: unknown }) | undefined
    try { json = text ? JSON.parse(text) : undefined } catch { /* non-JSON error body */ }
    if (res.ok && json) return json
    const d = json?.detail ?? json?.error
    const detail = typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => (x as { msg?: string }).msg ?? JSON.stringify(x)).join('; ') : text.slice(0, 300)
    const s = res.status
    if (s === 401 || s === 403) throw new ProviderError(`fal refused the key${s === 403 ? ' or the account has no balance' : ''}. Check it in Settings > Provider keys.`, { retryable: false, submitted: 'no', status: s, code: s === 403 ? 'credits' : undefined })
    if (s === 400 || s === 422) throw new ProviderError(`fal rejected the request: ${detail}`, { retryable: false, submitted: 'no', status: s, detail: json })
    if (s === 404) throw new ProviderError('fal could not find that model or request.', { retryable: false, submitted: 'no', status: s })
    if (s === 429 || s === 502 || s === 503 || s === 504) throw new ProviderError(`fal is busy (${s}). Will retry.`, { retryable: true, submitted: 'no', status: s })
    throw new ProviderError(`fal error ${s}: ${detail}`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no', status: s })
  }

  function entryFor(ref: string): ModelEntry {
    const entry = opts.config.models.models.find(m => m.ref === ref)
    if (!entry || !ref.startsWith('fal/') || !entry.endpoint) throw new ProviderError(`Unknown fal model "${ref}".`, { retryable: false, submitted: 'no' })
    return entry
  }

  async function read(jobId: string): Promise<JobStatus> {
    const { app, requestId } = unpackId(jobId)
    const s = await call<{ status?: string; error?: string }>('GET', `/${app}/requests/${encodeURIComponent(requestId)}/status`)
    const state = STATE[String(s.status).toUpperCase()] ?? 'running'
    if (state !== 'succeeded') return { state, error: state === 'failed' ? (s.error ?? 'fal reported a failure (not charged).') : undefined, raw: s }
    let r: Parameters<typeof outputsOf>[0] & { has_nsfw_concepts?: boolean[] }
    try {
      r = await call('GET', `/${app}/requests/${encodeURIComponent(requestId)}`)
    } catch (e) {
      // A finished request that failed answers its result with the error.
      if (e instanceof ProviderError && (e.opts.status === 422 || e.opts.status === 400)) {
        const filtered = /nsfw|safety|content.?policy|moderat/i.test(e.message)
        return { state: filtered ? 'nsfw' : 'failed', error: filtered ? 'fal\'s safety check blocked this result (not charged).' : e.message, raw: e.opts.detail }
      }
      throw e
    }
    if (r.has_nsfw_concepts?.some(Boolean)) return { state: 'nsfw', error: 'fal\'s safety check blocked this result.', raw: r }
    const outputs = outputsOf(r)
    return outputs.length ? { state, outputs, raw: r } : { state: 'failed', error: 'fal finished without returning any output.', raw: r }
  }

  return {
    id: 'fal',
    needsPublicAssetUrls: true,
    async listModels() {
      return opts.config.models.models.filter(m => m.ref.startsWith('fal/'))
        .map(m => ({ ref: m.ref, provider: 'fal', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: m.verified }))
    },
    async estimate(req) { return estimateGen(opts.config, req) },
    async submit(req, { webhookUrl }) {
      const entry = entryFor(req.model)
      const endpoint = entry.endpoint!.replace(/^\//, '')
      const q = webhookUrl ? `?fal_webhook=${encodeURIComponent(webhookUrl)}` : ''
      const r = await call<{ request_id?: string }>('POST', `/${endpoint}${q}`, mapFalInput(entry, req), 'submit')
      if (!r.request_id) throw new ProviderError('fal accepted the request but returned no request id.', { retryable: false, submitted: 'unknown' })
      return { jobId: packId(endpoint, r.request_id), raw: r }
    },
    status: read,
    async result(jobId) {
      return (await read(jobId)).outputs ?? []
    },
    async cancel(jobId) {
      const { app, requestId } = unpackId(jobId)
      await call('PUT', `/${app}/requests/${encodeURIComponent(requestId)}/cancel`)
    },
    async verifyCredentials() {
      // The status of a request that does not exist is free: 404 or 422
      // means the key was read, 401 or 403 that it was refused.
      try {
        await call('GET', '/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status')
        return { ok: true, message: 'fal key works.' }
      } catch (e) {
        const status = e instanceof ProviderError ? e.opts.status : undefined
        if (status === 404 || status === 422 || status === 400) return { ok: true, message: 'fal key works.' }
        return { ok: false, message: (e as Error).message }
      }
    },
  }
}
