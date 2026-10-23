import type { ModelEntry, StudioConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { forceBeautifyOff } from '../core/realism.js'
import { ProviderError, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// Kie.ai (owner, 2026-10-23; UX-PLAN.md section 40): one more provider for
// models the Studio already runs (Nano Banana 2.1, Seedream 4.5 edit, Kling
// 3.0, Wan 2.2 Animate replace, Kling 3.0 Motion Control) and Seedance 1.5
// Pro. The key is the account's own (Settings > Provider keys), sealed in
// the vault; never in code or the browser.
//
// The Market API (docs.kie.ai, read from Kie's own OpenAPI files as of
// 2026-10-21): POST https://api.kie.ai/api/v1/jobs/createTask with
// "Authorization: Bearer KEY" and { model, input, callBackUrl? } answers
// { code, msg, data: { taskId } }. GET /api/v1/jobs/recordInfo?taskId=
// answers data.state (waiting, queuing, generating, success, fail),
// data.resultJson (a JSON string with resultUrls), data.failMsg and
// data.creditsConsumed. GET /api/v1/chat/credit answers the balance in
// credits (200 credits = $1). A body's `code` can say an error even with
// HTTP 200, so both are read. Every input link is one the runner made
// (a presigned storage link); Kie's own safety check is always on.

export interface KieOptions {
  apiKey: string
  config: StudioConfig
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export const KIE_CREDITS_PER_USD = 200

const STATE: Record<string, JobState> = { waiting: 'queued', queuing: 'queued', generating: 'running', success: 'succeeded', fail: 'failed' }

function needUrl(ref: { url?: string } | undefined, what: string): string {
  if (!ref?.url) throw new ProviderError(`${what} has no link Kie.ai can read. Set up cloud storage (R2) for live runs with references.`, { retryable: false, submitted: 'no' })
  return ref.url
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)))
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))
const ASPECTS_IMAGE = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const aspectOf = (req: GenRequest, allowed: string[], fallback = '9:16') => (req.aspect && allowed.includes(req.aspect) ? req.aspect : fallback)

// The request per model (Kie's schema for each). Only these fields are sent;
// beautify and prompt-enhance options are forced off (Realism principle).
export function mapKieInput(entry: ModelEntry, req: GenRequest): Record<string, unknown> {
  const refs = (req.refs ?? []).slice(0, entry.max_refs)
  const mode = String((entry.params as Record<string, unknown> | undefined)?.mode ?? '')
  const input = (() => {
    switch (entry.input_map) {
      case 'kie_nano_banana':
        return clean({
          prompt: req.prompt,
          image_input: refs.map(r => needUrl(r, 'A reference image')),
          aspect_ratio: aspectOf(req, ASPECTS_IMAGE),
          resolution: /^4k$/i.test(req.resolution ?? '') ? '4K' : /^2k$/i.test(req.resolution ?? '') ? '2K' : '1K',
          output_format: 'png',
        })
      case 'kie_seedream_edit':
        return clean({
          prompt: req.prompt,
          image_urls: refs.map(r => needUrl(r, 'A reference image')),
          aspect_ratio: aspectOf(req, ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']),
          quality: /^4k$/i.test(req.resolution ?? '') || req.quality === 'high' ? 'high' : 'basic',
          nsfw_checker: true,
        })
      case 'kie_kling_video':
        // Kling 3.0, one shot: the start frame, and the end frame when set.
        return clean({
          prompt: req.prompt,
          image_urls: [needUrl(req.startFrame ?? req.refs?.[0], 'The start frame'), ...(req.endFrame ? [needUrl(req.endFrame, 'The end frame')] : [])],
          sound: req.audio === true,
          duration: String(clamp(req.durationSec ?? 5, 3, 15)),
          aspect_ratio: aspectOf(req, ['16:9', '9:16', '1:1']),
          mode: mode || 'pro',
          multi_shots: false,
        })
      case 'kie_seedance':
        return clean({
          prompt: req.prompt,
          input_urls: [needUrl(req.startFrame ?? req.refs?.[0], 'The start frame'), ...(req.endFrame ? [needUrl(req.endFrame, 'The end frame')] : [])],
          aspect_ratio: aspectOf(req, ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']),
          resolution: ['480p', '720p', '1080p'].includes(req.resolution ?? '') ? req.resolution : '720p',
          duration: clamp(req.durationSec ?? 5, 4, 12),
          fixed_lens: false,
          generate_audio: req.audio === true,
          nsfw_checker: true,
        })
      case 'kie_wan_animate_replace':
        return clean({
          video_url: needUrl(req.sourceVideo, 'The source clip'),
          image_url: needUrl(req.refs?.[0], 'The character image'),
          resolution: ['480p', '580p', '720p'].includes(req.resolution ?? '') ? req.resolution : '720p',
          nsfw_checker: true,
        })
      case 'kie_kling_motion_control':
        return clean({
          prompt: req.prompt || undefined,
          input_urls: [needUrl(req.refs?.[0], 'The character image')],
          video_urls: [needUrl(req.sourceVideo, 'The source clip')],
          mode: req.resolution === '1080p' ? '1080p' : '720p',
          character_orientation: 'video',
        })
      default:
        throw new ProviderError(`No Kie.ai input mapping "${entry.input_map}" for ${entry.ref}.`, { retryable: false, submitted: 'no' })
    }
  })()
  return forceBeautifyOff({ ...input, ...(entry.force_off ?? {}) })
}

// The job id carries what the run makes (an image or a video), since Kie's
// result is a plain list of links.
const packId = (kind: 'image' | 'video', taskId: string) => `${kind === 'video' ? 'v' : 'i'}|${taskId}`
function unpackId(jobId: string): { kind: 'image' | 'video'; taskId: string } {
  const [k, ...rest] = jobId.split('|')
  if (!rest.length) throw new ProviderError(`Not a Kie.ai job id: ${jobId}`, { retryable: false, submitted: 'no' })
  return { kind: k === 'v' ? 'video' : 'image', taskId: rest.join('|') }
}

function resultUrls(resultJson: unknown): string[] {
  let r = resultJson
  for (let i = 0; i < 3 && typeof r === 'string'; i++) { try { r = JSON.parse(r) } catch { break } }
  const o = (r ?? {}) as { resultUrls?: unknown; resultUrl?: unknown; urls?: unknown }
  const list = Array.isArray(o.resultUrls) ? o.resultUrls : Array.isArray(o.urls) ? o.urls : typeof o.resultUrl === 'string' ? [o.resultUrl] : []
  return list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
}

const FILTERED = /nsfw|sensitive|safety|content.?policy|moderat|prohibited|violat/i

export function createKieAdapter(opts: KieOptions): ProviderAdapter & { balance(): Promise<{ text: string; usd: number | null; credits: number | null }> } {
  const base = (opts.baseUrl ?? 'https://api.kie.ai').replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 60_000
  const headers = { Authorization: `Bearer ${opts.apiKey.trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' }

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, phase: 'submit' | 'read' = 'read'): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal })
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError'
      throw new ProviderError(aborted ? 'Kie.ai did not answer in time.' : `Could not reach Kie.ai: ${(e as Error).message}`, {
        retryable: !aborted || phase === 'read', submitted: phase === 'submit' && aborted ? 'unknown' : 'no',
      })
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json: { code?: number; msg?: string; message?: string; data?: unknown } | undefined
    try { json = text ? JSON.parse(text) : undefined } catch { /* non-JSON error body */ }
    // Kie answers errors in the body's code, sometimes with HTTP 200.
    const s = json && typeof json.code === 'number' && json.code !== 200 ? json.code : res.status
    const msg = json?.msg ?? json?.message ?? text.slice(0, 300)
    if (s >= 200 && s < 300 && json) return json as T
    if (s === 401 || s === 403) throw new ProviderError('Kie.ai refused the key. Check it in Settings > Provider keys.', { retryable: false, submitted: 'no', status: s })
    if (s === 402) throw new ProviderError('Kie.ai: not enough credits on the account. Top up at kie.ai, then try again.', { retryable: false, submitted: 'no', status: s, code: 'credits' })
    if (s === 400 || s === 422) throw new ProviderError(`Kie.ai rejected the request: ${msg}`, { retryable: false, submitted: 'no', status: s, detail: json })
    if (s === 404) throw new ProviderError('Kie.ai could not find that model or task.', { retryable: false, submitted: 'no', status: s })
    if (s === 429 || s === 455 || s >= 500) throw new ProviderError(`Kie.ai is busy (${s}${msg ? `: ${msg}` : ''}). Will retry.`, { retryable: true, submitted: phase === 'submit' && s >= 500 ? 'unknown' : 'no', status: s })
    throw new ProviderError(`Kie.ai error ${s}: ${msg}`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no', status: s })
  }

  function entryFor(ref: string): ModelEntry {
    const entry = opts.config.models.models.find(m => m.ref === ref)
    if (!entry || !ref.startsWith('kie/') || !entry.endpoint) throw new ProviderError(`Unknown Kie.ai model "${ref}".`, { retryable: false, submitted: 'no' })
    return entry
  }

  async function read(jobId: string): Promise<JobStatus> {
    const { kind, taskId } = unpackId(jobId)
    const r = await call<{ data?: { state?: string; resultJson?: unknown; failMsg?: string; failCode?: string; creditsConsumed?: number } }>('GET', `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`)
    const d = r.data ?? {}
    const state = STATE[String(d.state ?? '').toLowerCase()] ?? 'running'
    if (state === 'failed') {
      const why = d.failMsg || d.failCode || 'Kie.ai reported a failure.'
      return { state: FILTERED.test(why) ? 'nsfw' : 'failed', error: FILTERED.test(why) ? `Kie.ai's safety check blocked this result: ${why}` : `Kie.ai: ${why}`, raw: d }
    }
    if (state !== 'succeeded') return { state, raw: d }
    const urls = resultUrls(d.resultJson)
    // Kie can mark a task done a moment before its links are saved.
    if (!urls.length) return { state: 'running', pollAfterSec: 3, raw: d }
    const outputs: Output[] = urls.map(url => ({ url, kind: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'video' : /\.(png|jpe?g|webp)(\?|$)/i.test(url) ? 'image' : kind }))
    return { state, outputs, raw: d }
  }

  async function balance() {
    const r = await call<{ data?: unknown }>('GET', '/api/v1/chat/credit')
    const credits = typeof r.data === 'number' ? r.data : Number(r.data)
    if (!Number.isFinite(credits)) return { text: 'Kie.ai did not report a balance.', usd: null, credits: null }
    const usd = credits / KIE_CREDITS_PER_USD
    return { text: `${credits.toLocaleString('en-US', { maximumFractionDigits: 1 })} credits (about $${usd.toFixed(2)})`, usd, credits }
  }

  return {
    id: 'kie',
    needsPublicAssetUrls: true,
    async listModels() {
      return opts.config.models.models.filter(m => m.ref.startsWith('kie/'))
        .map(m => ({ ref: m.ref, provider: 'kie', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: m.verified }))
    },
    async estimate(req) { return estimateGen(opts.config, req) },
    async submit(req, { webhookUrl }) {
      const entry = entryFor(req.model)
      const body = { model: entry.endpoint, input: mapKieInput(entry, req), ...(webhookUrl ? { callBackUrl: webhookUrl } : {}) }
      const r = await call<{ data?: { taskId?: string } }>('POST', '/api/v1/jobs/createTask', body, 'submit')
      if (!r.data?.taskId) throw new ProviderError('Kie.ai accepted the request but returned no task id.', { retryable: false, submitted: 'unknown' })
      const kind = req.kind === 'video' || req.kind === 'video_clone' || req.kind === 'video_extend' ? 'video' : 'image'
      return { jobId: packId(kind, r.data.taskId), raw: r }
    },
    status: read,
    async result(jobId) { return (await read(jobId)).outputs ?? [] },
    async verifyCredentials() {
      try { const b = await balance(); return { ok: true, message: `Kie.ai key works. Balance: ${b.text}.` } }
      catch (e) { return { ok: false, message: (e as Error).message } }
    },
    balance,
  }
}
