import type { ModelEntry, StudioConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { forceBeautifyOff } from '../core/realism.js'
import { ProviderError, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// WaveSpeed (owner, 2026-10-23; UX-PLAN.md section 40): one more provider
// for Nano Banana 2.1, Seedream 4.5 edit, Kling 3.0, Wan 2.2 Animate and
// Seedance 1.5 Pro. The key is the account's own (Settings > Provider keys),
// sealed in the vault.
//
// The REST API (wavespeed.ai/docs, as indexed 2026-10-23): POST
// https://api.wavespeed.ai/api/v3/{model id} with "Authorization: Bearer
// KEY" and the model's input as JSON answers { code, message, data: { id,
// status } }; `?webhook=` on that link wakes the job when it is done. GET
// /api/v3/predictions/{id}/result answers data.status (created, processing,
// completed, failed, canceled, timeout), data.outputs (links) and
// data.error. Prices are dollars per run. The balance call's path differs
// by account (/api/v3/balance or /api/v3/account/balance): both are tried.

export interface WavespeedOptions {
  apiKey: string
  config: StudioConfig
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const STATE: Record<string, JobState> = { created: 'queued', pending: 'queued', processing: 'running', completed: 'succeeded', failed: 'failed', canceled: 'canceled', cancelled: 'canceled', timeout: 'failed' }

function needUrl(ref: { url?: string } | undefined, what: string): string {
  if (!ref?.url) throw new ProviderError(`${what} has no link WaveSpeed can read. Set up cloud storage (R2) for live runs with references.`, { retryable: false, submitted: 'no' })
  return ref.url
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)))
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))
const ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
// Seedream takes a size in pixels (each side 1024 to 4096): about 2K.
const SEEDREAM_SIZE: Record<string, string> = { '9:16': '1440*2560', '16:9': '2560*1440', '1:1': '2048*2048', '3:4': '1728*2304', '4:3': '2304*1728', '4:5': '1664*2080', '5:4': '2080*1664', '2:3': '1664*2496', '3:2': '2496*1664' }

// The model's path and input (each model's page on wavespeed.ai). A Nano
// Banana still with no reference runs on its text-to-image twin.
export function mapWavespeedInput(entry: ModelEntry, req: GenRequest): { path: string; input: Record<string, unknown> } {
  const refs = (req.refs ?? []).slice(0, entry.max_refs)
  let path = entry.endpoint!.replace(/^\//, '')
  const input = (() => {
    switch (entry.input_map) {
      case 'ws_nano_banana':
        if (!refs.length) path = path.replace(/\/edit$/, '/text-to-image')
        return clean({
          prompt: req.prompt,
          images: refs.map(r => needUrl(r, 'A reference image')),
          aspect_ratio: req.aspect && ASPECTS.includes(req.aspect) ? req.aspect : '9:16',
          resolution: /^4k$/i.test(req.resolution ?? '') ? '4k' : /^2k$/i.test(req.resolution ?? '') ? '2k' : '1k',
          output_format: 'png',
          enable_sync_mode: false,
          enable_base64_output: false,
        })
      case 'ws_seedream_edit':
        return clean({
          prompt: req.prompt,
          images: refs.map(r => needUrl(r, 'A reference image')),
          size: SEEDREAM_SIZE[req.aspect ?? '9:16'] ?? SEEDREAM_SIZE['9:16'],
          enable_sync_mode: false,
          enable_base64_output: false,
        })
      case 'ws_kling_video':
        // Kling 3.0 image to video: the start frame, and the end frame when set.
        return clean({
          image: needUrl(req.startFrame ?? req.refs?.[0], 'The start frame'),
          last_image: req.endFrame ? needUrl(req.endFrame, 'The end frame') : undefined,
          prompt: req.prompt,
          duration: clamp(req.durationSec ?? 5, 3, 15),
          sound: req.audio === true,
        })
      case 'ws_seedance':
        return clean({
          image: needUrl(req.startFrame ?? req.refs?.[0], 'The start frame'),
          last_image: req.endFrame ? needUrl(req.endFrame, 'The end frame') : undefined,
          prompt: req.prompt,
          duration: clamp(req.durationSec ?? 5, 4, 12),
          resolution: ['480p', '720p', '1080p'].includes(req.resolution ?? '') ? req.resolution : '720p',
          aspect_ratio: req.aspect && ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].includes(req.aspect) ? req.aspect : undefined,
          camera_fixed: false,
          generate_audio: req.audio === true,
          seed: req.seed ?? -1,
        })
      case 'ws_wan_animate_replace':
        // Wan 2.2 Animate in replace mode: the clip keeps its place, light
        // and motion; the person becomes the one in the image.
        return clean({
          image: needUrl(req.refs?.[0], 'The character image'),
          video: needUrl(req.sourceVideo, 'The source clip'),
          mode: 'replace',
          resolution: req.resolution === '480p' ? '480p' : '720p',
          prompt: req.prompt || undefined,
          seed: req.seed ?? -1,
        })
      default:
        throw new ProviderError(`No WaveSpeed input mapping "${entry.input_map}" for ${entry.ref}.`, { retryable: false, submitted: 'no' })
    }
  })()
  return { path, input: forceBeautifyOff({ ...input, ...(entry.force_off ?? {}) }) }
}

const packId = (kind: 'image' | 'video', id: string) => `${kind === 'video' ? 'v' : 'i'}|${id}`
function unpackId(jobId: string): { kind: 'image' | 'video'; id: string } {
  const [k, ...rest] = jobId.split('|')
  if (!rest.length) throw new ProviderError(`Not a WaveSpeed job id: ${jobId}`, { retryable: false, submitted: 'no' })
  return { kind: k === 'v' ? 'video' : 'image', id: rest.join('|') }
}

const FILTERED = /nsfw|sensitive|safety|content.?policy|moderat|prohibited|violat/i

export function createWavespeedAdapter(opts: WavespeedOptions): ProviderAdapter & { balance(): Promise<{ text: string; usd: number | null; credits: number | null }> } {
  const base = (opts.baseUrl ?? 'https://api.wavespeed.ai').replace(/\/$/, '')
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
      throw new ProviderError(aborted ? 'WaveSpeed did not answer in time.' : `Could not reach WaveSpeed: ${(e as Error).message}`, {
        retryable: !aborted || phase === 'read', submitted: phase === 'submit' && aborted ? 'unknown' : 'no',
      })
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json: { code?: number; message?: string; msg?: string; data?: unknown } | undefined
    try { json = text ? JSON.parse(text) : undefined } catch { /* non-JSON error body */ }
    const s = json && typeof json.code === 'number' && json.code !== 200 && json.code !== 0 ? json.code : res.status
    const msg = json?.message ?? json?.msg ?? text.slice(0, 300)
    if (s >= 200 && s < 300 && json) return json as T
    if (s === 401 || s === 403) throw new ProviderError('WaveSpeed refused the key. Check it in Settings > Provider keys.', { retryable: false, submitted: 'no', status: s })
    if (s === 402) throw new ProviderError('WaveSpeed: not enough balance on the account. Top up at wavespeed.ai, then try again.', { retryable: false, submitted: 'no', status: s, code: 'credits' })
    if (s === 400 || s === 422) throw new ProviderError(`WaveSpeed rejected the request: ${msg}`, { retryable: false, submitted: 'no', status: s, detail: json })
    if (s === 404) throw new ProviderError('WaveSpeed could not find that model or prediction.', { retryable: false, submitted: 'no', status: s })
    if (s === 429 || s >= 500) throw new ProviderError(`WaveSpeed is busy (${s}). Will retry.`, { retryable: true, submitted: phase === 'submit' && s >= 500 ? 'unknown' : 'no', status: s })
    throw new ProviderError(`WaveSpeed error ${s}: ${msg}`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no', status: s })
  }

  function entryFor(ref: string): ModelEntry {
    const entry = opts.config.models.models.find(m => m.ref === ref)
    if (!entry || !ref.startsWith('wavespeed/') || !entry.endpoint) throw new ProviderError(`Unknown WaveSpeed model "${ref}".`, { retryable: false, submitted: 'no' })
    return entry
  }

  async function read(jobId: string): Promise<JobStatus> {
    const { kind, id } = unpackId(jobId)
    const r = await call<{ data?: { status?: string; outputs?: unknown[]; error?: string | null } }>('GET', `/api/v3/predictions/${encodeURIComponent(id)}/result`)
    const d = r.data ?? {}
    const state = STATE[String(d.status ?? '').toLowerCase()] ?? 'running'
    if (state === 'failed' || state === 'canceled') {
      const why = d.error || (d.status === 'timeout' ? 'the run timed out' : 'WaveSpeed reported a failure.')
      return { state: FILTERED.test(why) ? 'nsfw' : state, error: FILTERED.test(why) ? `WaveSpeed's safety check blocked this result: ${why}` : `WaveSpeed: ${why}`, raw: d }
    }
    if (state !== 'succeeded') return { state, pollAfterSec: 2, raw: d }
    const urls = (d.outputs ?? []).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
    if (!urls.length) return { state: 'failed', error: 'WaveSpeed finished without returning any output.', raw: d }
    const outputs: Output[] = urls.map(url => ({ url, kind: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'video' : /\.(png|jpe?g|webp)(\?|$)/i.test(url) ? 'image' : kind }))
    return { state, outputs, raw: d }
  }

  async function balance() {
    let r: { data?: unknown } | null = null
    for (const p of ['/api/v3/balance', '/api/v3/account/balance']) {
      try { r = await call<{ data?: unknown }>('GET', p); break } catch (e) {
        if (!(e instanceof ProviderError) || e.opts.status !== 404) throw e
      }
    }
    const d = r?.data as number | { balance?: unknown; amount?: unknown } | undefined
    const usd = typeof d === 'number' ? d : Number((d as { balance?: unknown } | undefined)?.balance ?? (d as { amount?: unknown } | undefined)?.amount)
    if (!r || !Number.isFinite(usd)) return { text: 'WaveSpeed did not report a balance.', usd: null, credits: null }
    return { text: `$${usd.toFixed(2)}`, usd, credits: null }
  }

  return {
    id: 'wavespeed',
    needsPublicAssetUrls: true,
    async listModels() {
      return opts.config.models.models.filter(m => m.ref.startsWith('wavespeed/'))
        .map(m => ({ ref: m.ref, provider: 'wavespeed', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: m.verified }))
    },
    async estimate(req) { return estimateGen(opts.config, req) },
    async submit(req, { webhookUrl }) {
      const entry = entryFor(req.model)
      const { path, input } = mapWavespeedInput(entry, req)
      const q = webhookUrl ? `?webhook=${encodeURIComponent(webhookUrl)}` : ''
      const r = await call<{ data?: { id?: string } }>('POST', `/api/v3/${path}${q}`, input, 'submit')
      if (!r.data?.id) throw new ProviderError('WaveSpeed accepted the request but returned no prediction id.', { retryable: false, submitted: 'unknown' })
      const kind = req.kind === 'video' || req.kind === 'video_clone' || req.kind === 'video_extend' ? 'video' : 'image'
      return { jobId: packId(kind, r.data.id), raw: r }
    },
    status: read,
    async result(jobId) { return (await read(jobId)).outputs ?? [] },
    async verifyCredentials() {
      try {
        const b = await balance()
        return { ok: true, message: `WaveSpeed key works.${b.usd !== null ? ` Balance: ${b.text}.` : ''}` }
      } catch (e) {
        // Some accounts have no balance call: a prediction that does not
        // exist is free, and 404 there still means the key was read.
        if (e instanceof ProviderError && e.opts.status === 404) return { ok: true, message: 'WaveSpeed key works.' }
        return { ok: false, message: (e as Error).message }
      }
    },
    balance,
  }
}
