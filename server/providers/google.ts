import { randomUUID } from 'node:crypto'
import type { StudioConfig } from '../config/load.js'
import type { BlobStore } from '../storage/blobStore.js'
import { estimateGen } from '../costs/pricebook.js'
import { ProviderError, type GenRequest, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// Google AI Studio (the Gemini API) for Nano Banana 2.1 on the API path
// (owner, 2026-10-22, item 19): the model the proven recreates used, without
// a Higgsfield plan. The key is the account's own, made in the AI Studio
// dashboard and pasted in Settings > Provider keys (sealed in the
// vault); never in code or the browser.
//
// POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// with "x-goog-api-key", the prompt and the reference images inline, and
// generationConfig { responseModalities: [IMAGE], imageConfig { aspectRatio,
// imageSize } } (ai.google.dev, image generation). The answer is direct, so
// submit does the work and keeps the image in storage under the job id, like
// ElevenLabs: any worker process can then read it. A blocked prompt or image
// (promptFeedback.blockReason, finishReason SAFETY or IMAGE_SAFETY) is
// reported as filtered, and Google does not charge for an image it did not
// make.

const API = 'https://generativelanguage.googleapis.com/v1beta'

export interface GoogleOptions {
  apiKey: string
  config: StudioConfig
  store: BlobStore
  loadAsset: (assetId: string) => Promise<Buffer>
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const cacheKey = (jobId: string) => `provider-cache/google/${jobId}.bin`
const metaKey = (jobId: string) => `provider-cache/google/${jobId}.json`

const mimeOf = (data: Buffer) => (data[0] === 0x89 ? 'image/png' : data[0] === 0x52 && data[8] === 0x57 ? 'image/webp' : 'image/jpeg')

interface GeminiPart { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }
interface GeminiAnswer {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string; finishMessage?: string }>
  promptFeedback?: { blockReason?: string }
}

const FILTERED = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_PROHIBITED_CONTENT', 'RECITATION'])

// The request body: text first, then each reference image. Only these fields
// are sent; Gemini has no beautify or prompt-enhance option to switch off.
export function geminiBody(req: GenRequest, images: Buffer[]): Record<string, unknown> {
  const size = req.resolution === '2k' ? '2K' : req.resolution === '4k' ? '4K' : '1K'
  return {
    contents: [{ role: 'user', parts: [{ text: req.prompt }, ...images.map(d => ({ inline_data: { mime_type: mimeOf(d), data: d.toString('base64') } }))] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(req.seed ? { seed: req.seed } : {}),
      imageConfig: { aspectRatio: req.aspect ?? '9:16', imageSize: size },
    },
  }
}

export function createGoogleAdapter(o: GoogleOptions): ProviderAdapter {
  const f = o.fetchImpl ?? fetch
  const base = (o.baseUrl ?? API).replace(/\/$/, '')
  const timeoutMs = o.timeoutMs ?? 120_000

  function apiModel(ref: string): string {
    const entry = o.config.models.models.find(m => m.ref === ref)
    if (!entry || !ref.startsWith('google/') || !entry.endpoint) throw new ProviderError(`Unknown Google model "${ref}".`, { retryable: false, submitted: 'no' })
    return entry.endpoint
  }

  async function post(path: string, body: unknown): Promise<GeminiAnswer> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await f(`${base}${path}`, { method: 'POST', headers: { 'x-goog-api-key': o.apiKey.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError'
      throw new ProviderError(aborted ? 'Google did not answer in time.' : `Could not reach Google: ${(e as Error).message}`, { retryable: !aborted, submitted: aborted ? 'unknown' : 'no' })
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json: (GeminiAnswer & { error?: { message?: string; status?: string } }) | undefined
    try { json = text ? JSON.parse(text) : undefined } catch { /* non-JSON error body */ }
    if (res.ok && json) return json
    const s = res.status
    const detail = json?.error?.message ?? text.slice(0, 300)
    if (s === 400 && /api key/i.test(detail)) throw new ProviderError('Google refused the API key. Check it in Settings > Provider keys.', { retryable: false, submitted: 'no', status: 401 })
    if (s === 401 || s === 403) throw new ProviderError(`Google refused the key: ${detail}`, { retryable: false, submitted: 'no', status: s })
    if (s === 400 || s === 404) throw new ProviderError(`Google rejected the request: ${detail}`, { retryable: false, submitted: 'no', status: s })
    if (s === 429) throw new ProviderError(`Google's rate limit or quota was reached: ${detail}`, { retryable: true, submitted: 'no', status: s, code: /quota|billing/i.test(detail) ? 'credits' : undefined })
    if (s >= 500) throw new ProviderError(`Google is busy (${s}). Will retry.`, { retryable: true, submitted: 'no', status: s })
    throw new ProviderError(`Google error ${s}: ${detail}`, { retryable: false, submitted: 'no', status: s })
  }

  return {
    id: 'google',
    async listModels() {
      return o.config.models.models.filter(m => m.ref.startsWith('google/'))
        .map(m => ({ ref: m.ref, provider: 'google', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: m.verified }))
    },
    async estimate(req) { return estimateGen(o.config, req) },
    async submit(req) {
      if (req.kind !== 'image' && req.kind !== 'image_edit') throw new ProviderError('Google runs stills only here.', { retryable: false, submitted: 'no' })
      const model = apiModel(req.model)
      const entry = o.config.models.models.find(m => m.ref === req.model)!
      const images = await Promise.all((req.refs ?? []).slice(0, entry.max_refs).map(r => o.loadAsset(r.assetId)))
      const jobId = randomUUID()
      const answer = await post(`/models/${encodeURIComponent(model)}:generateContent`, geminiBody(req, images))
      const block = answer.promptFeedback?.blockReason
      const cand = answer.candidates?.[0]
      const part = cand?.content?.parts?.find(p => p.inlineData?.data || p.inline_data?.data)
      const data = part?.inlineData?.data ?? part?.inline_data?.data
      const status: JobStatus = block || (cand?.finishReason && FILTERED.has(cand.finishReason))
        ? { state: 'nsfw', error: `Google's safety check blocked this (${block ?? cand?.finishReason}). Not charged.` }
        : data ? { state: 'succeeded' }
        : { state: 'failed', error: `Google made no image${cand?.finishReason ? ` (${cand.finishReason}${cand.finishMessage ? `: ${cand.finishMessage}` : ''})` : ''}.` }
      if (data) await o.store.put(cacheKey(jobId), Buffer.from(data, 'base64'), part?.inlineData?.mimeType ?? part?.inline_data?.mime_type ?? 'image/png')
      await o.store.put(metaKey(jobId), Buffer.from(JSON.stringify(status)), 'application/json')
      return { jobId }
    },
    async status(jobId): Promise<JobStatus> {
      if (!(await o.store.exists(metaKey(jobId)))) return { state: 'failed', error: 'The still was not kept. Run it again; a failed run is not charged.' }
      const s = JSON.parse((await o.store.get(metaKey(jobId))).toString()) as JobStatus
      return s.state === 'succeeded' ? { state: 'succeeded', outputs: await this.result(jobId) } : s
    },
    async result(jobId): Promise<Output[]> {
      return [{ url: `google-cache://${jobId}`, kind: 'image' }]
    },
    async download(output) {
      const m = output.url.match(/^google-cache:\/\/([\w-]+)$/)
      if (!m) throw new ProviderError('Unknown Google output.', { retryable: false, submitted: 'no' })
      return o.store.get(cacheKey(m[1]!))
    },
    async verifyCredentials() {
      // Listing models is free and needs a valid key.
      const res = await f(`${base}/models?pageSize=1`, { headers: { 'x-goog-api-key': o.apiKey.trim() } }).catch(() => null)
      return res?.ok ? { ok: true, message: 'Google AI Studio key works.' } : { ok: false, message: `Google refused the key${res ? ` (${res.status})` : ''}.` }
    },
  }
}
