import type { StudioConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { ProviderError, type GenRequest, type JobState, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// Apify for mass recreate (owner, 2026-10-22, item 24): a TikTok link from
// the owner's sheet becomes the video file, through the owner's own Apify
// account (the same one the comment scrapes run on). The Studio itself never
// scrapes; the key is the account's own (Settings > Provider keys).
//
// Apify API v2: POST /v2/acts/{actor}/runs?token= starts the actor with the
// input as JSON and answers { data: { id, defaultDatasetId, status } };
// GET /v2/actor-runs/{id} reads the status (READY, RUNNING, SUCCEEDED,
// FAILED, TIMED-OUT, ABORTED); GET /v2/datasets/{id}/items the results. The
// TikTok scraper (clockworks/tiktok-scraper) with shouldDownloadVideos keeps
// each video in the run's key-value store and lists it in `mediaUrls`.
// The file is read with the key (the store is private), here, never by URL
// from the browser.

const API = 'https://api.apify.com'

export interface ApifyOptions {
  apiKey: string
  config: StudioConfig
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const STATE: Record<string, JobState> = {
  READY: 'queued', RUNNING: 'running', SUCCEEDED: 'succeeded', FAILED: 'failed', 'TIMED-OUT': 'failed', 'TIMING-OUT': 'running', ABORTED: 'canceled', ABORTING: 'running',
}

export function apifyInput(req: GenRequest): Record<string, unknown> {
  if (!req.fetchUrl) throw new ProviderError('A clip fetch needs its link.', { retryable: false, submitted: 'no' })
  return { postURLs: [req.fetchUrl], shouldDownloadVideos: true, shouldDownloadCovers: false, shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false, resultsPerPage: 1 }
}

interface ApifyItem { mediaUrls?: string[]; videoMeta?: { downloadAddr?: string; duration?: number }; error?: string; errorDescription?: string }

export function createApifyAdapter(o: ApifyOptions): ProviderAdapter {
  const base = (o.baseUrl ?? API).replace(/\/$/, '')
  const f = o.fetchImpl ?? fetch
  const key = o.apiKey.trim()
  const timeoutMs = o.timeoutMs ?? 60_000

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, phase: 'submit' | 'read' = 'read'): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await f(`${base}${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal })
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError'
      throw new ProviderError(aborted ? 'Apify did not answer in time.' : `Could not reach Apify: ${(e as Error).message}`, { retryable: !aborted || phase === 'read', submitted: phase === 'submit' && aborted ? 'unknown' : 'no' })
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json: (T & { error?: { message?: string } }) | undefined
    try { json = text ? JSON.parse(text) : undefined } catch { /* non-JSON */ }
    if (res.ok && json) return json
    const s = res.status
    const detail = json?.error?.message ?? text.slice(0, 300)
    if (s === 401 || s === 403) throw new ProviderError(`Apify refused the key: ${detail}`, { retryable: false, submitted: 'no', status: s })
    if (s === 402) throw new ProviderError(`Apify needs a balance: ${detail}`, { retryable: false, submitted: 'no', status: s, code: 'credits' })
    if (s === 400 || s === 404) throw new ProviderError(`Apify rejected the request: ${detail}`, { retryable: false, submitted: 'no', status: s })
    if (s === 429 || s >= 500) throw new ProviderError(`Apify is busy (${s}). Will retry.`, { retryable: true, submitted: phase === 'submit' && s >= 500 ? 'unknown' : 'no', status: s })
    throw new ProviderError(`Apify error ${s}: ${detail}`, { retryable: false, submitted: phase === 'submit' ? 'unknown' : 'no', status: s })
  }

  function actorFor(ref: string): string {
    const entry = o.config.models.models.find(m => m.ref === ref)
    if (!entry || !ref.startsWith('apify/') || !entry.endpoint) throw new ProviderError(`Unknown Apify actor "${ref}".`, { retryable: false, submitted: 'no' })
    return entry.endpoint
  }

  return {
    id: 'apify',
    async listModels() {
      return o.config.models.models.filter(m => m.ref.startsWith('apify/')).map(m => ({ ref: m.ref, provider: 'apify', label: m.label, kinds: m.kinds, maxRefs: 0, verified: m.verified }))
    },
    async estimate(req) { return estimateGen(o.config, req) },
    async submit(req, { webhookUrl }) {
      const actor = actorFor(req.model)
      const hook = webhookUrl ? `?webhooks=${Buffer.from(JSON.stringify([{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'], requestUrl: webhookUrl }])).toString('base64')}` : ''
      const r = await call<{ data?: { id?: string; defaultDatasetId?: string } }>('POST', `/v2/acts/${encodeURIComponent(actor)}/runs${hook}`, apifyInput(req), 'submit')
      if (!r.data?.id || !r.data.defaultDatasetId) throw new ProviderError('Apify started the run but returned no id.', { retryable: false, submitted: 'unknown' })
      return { jobId: `${r.data.id}|${r.data.defaultDatasetId}`, raw: r.data }
    },
    async status(jobId): Promise<JobStatus> {
      const [runId, datasetId] = jobId.split('|')
      const r = await call<{ data?: { status?: string; statusMessage?: string } }>('GET', `/v2/actor-runs/${encodeURIComponent(runId!)}`)
      const state = STATE[String(r.data?.status)] ?? 'running'
      if (state !== 'succeeded') return { state, error: state === 'failed' ? `Apify could not fetch the clip${r.data?.statusMessage ? `: ${r.data.statusMessage}` : ''} (the run is not charged beyond its compute).` : undefined, raw: r.data }
      const items = await call<ApifyItem[]>('GET', `/v2/datasets/${encodeURIComponent(datasetId!)}/items?clean=true&limit=1`)
      const item = items[0]
      const url = item?.mediaUrls?.[0]
      if (!url) return { state: 'failed', error: item?.errorDescription ?? item?.error ?? 'Apify found no video at that link (private, removed or a photo post).', raw: items }
      return { state: 'succeeded', outputs: [{ url, kind: 'video', mime: 'video/mp4', durationSec: item?.videoMeta?.duration }], raw: items }
    },
    async result(jobId) {
      return (await this.status(jobId)).outputs ?? []
    },
    async download(out: Output) {
      // The run's key-value store is private: read with the key, on Apify's
      // own host only.
      const u = new URL(out.url)
      if (u.protocol !== 'https:' || !(u.hostname === 'api.apify.com' || u.hostname.endsWith('.apify.com'))) throw new ProviderError(`Apify gave a file on ${u.hostname}; only Apify's own storage is read.`, { retryable: false, submitted: 'no' })
      const res = await f(u.toString(), { headers: { Authorization: `Bearer ${key}` } })
      if (!res.ok) throw new ProviderError(`Reading the clip from Apify failed (${res.status}).`, { retryable: res.status >= 500, submitted: 'no', status: res.status })
      const data = Buffer.from(await res.arrayBuffer())
      if (data.length > 500 * 1024 * 1024) throw new ProviderError('The clip is over 500 MB.', { retryable: false, submitted: 'no' })
      return data
    },
    async verifyCredentials() {
      try {
        await call('GET', '/v2/users/me')
        return { ok: true, message: 'Apify key works.' }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    },
  }
}
