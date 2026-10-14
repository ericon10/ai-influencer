import type { StudioConfig } from '../config/load.js'
import { estimateGen } from '../costs/pricebook.js'
import { ProviderError, type GenRequest, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// Kling 3.0 Motion Control through the Vercel AI Gateway (owner,
// 2026-10-14: "Check it on Vercel AI Gateway first, since we are on
// Vercel"). The Gateway offers it as klingai/kling-v3.0-motion-control: a
// character image plus a reference video (docs: vercel.com/docs/ai-gateway,
// video generation, motion control). The Studio's runner submits and polls,
// so this uses the AI SDK's start and status calls: the start returns an
// opaque operation (JSON) that is stored as the job id and polled from any
// process, so a worker restart never loses a run or starts it twice.
//
// The key is AI_GATEWAY_API_KEY on the server (the worker runs on Railway,
// outside Vercel, so OIDC does not reach it). Never sent to the browser.

export interface GatewaySdk {
  start(o: { modelId: string; image: string; text?: string; providerOptions: Record<string, Record<string, unknown>>; headers: Record<string, string> }): Promise<{ operation: unknown }>
  status(o: { modelId: string; operation: unknown }): Promise<
    | { status: 'pending' }
    | { status: 'completed'; videos: Array<{ type: 'url'; url: string; mediaType: string } | { type: 'base64'; data: string; mediaType: string } | { type: 'binary'; data: Uint8Array; mediaType: string }> }
    | { status: 'error'; error: string }
  >
}

// The real SDK, loaded only when a Gateway run happens.
export function gatewaySdk(apiKey: string): GatewaySdk {
  const load = async () => {
    const [{ experimental_startVideo, experimental_getVideoStatus }, { createGateway }] = await Promise.all([import('ai'), import('@ai-sdk/gateway')])
    return { experimental_startVideo, experimental_getVideoStatus, gateway: createGateway({ apiKey }) }
  }
  return {
    async start(o) {
      const sdk = await load()
      const r = await sdk.experimental_startVideo({
        model: sdk.gateway.videoModel(o.modelId),
        prompt: { image: o.image, ...(o.text ? { text: o.text } : {}) },
        providerOptions: o.providerOptions as never,
        headers: o.headers,
        maxRetries: 0,
      })
      return { operation: r.operation }
    },
    async status(o) {
      const sdk = await load()
      const r = await sdk.experimental_getVideoStatus(sdk.gateway.videoModel(o.modelId), { operation: o.operation as never })
      if (r.status === 'completed') return { status: 'completed', videos: r.videos as never }
      if (r.status === 'error') return { status: 'error', error: r.error }
      return { status: 'pending' }
    },
  }
}

const PREFIX = 'gw1:'
const encode = (modelId: string, operation: unknown) => `${PREFIX}${Buffer.from(JSON.stringify({ m: modelId, op: operation })).toString('base64url')}`
function decode(jobId: string): { m: string; op: unknown } {
  if (!jobId.startsWith(PREFIX)) throw new ProviderError('That is not a Vercel AI Gateway run.', { retryable: false, submitted: 'no' })
  return JSON.parse(Buffer.from(jobId.slice(PREFIX.length), 'base64url').toString('utf8')) as { m: string; op: unknown }
}

export function createVercelGatewayAdapter(o: { config: StudioConfig; sdk: GatewaySdk; fetchImpl?: typeof fetch }): ProviderAdapter {
  const doFetch = o.fetchImpl ?? fetch
  const entryFor = (ref: string) => {
    const m = o.config.models.models.find(x => x.ref === ref)
    if (!m?.endpoint) throw new ProviderError(`${ref} has no Vercel AI Gateway model id.`, { retryable: false, submitted: 'no' })
    return m as typeof m & { endpoint: string }
  }
  return {
    id: 'vercel',
    needsPublicAssetUrls: true,
    async listModels() {
      return o.config.models.models.filter(m => m.ref.startsWith('vercel/')).map(m => ({ ref: m.ref, provider: 'vercel', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: m.verified }))
    },
    async estimate(req) { return estimateGen(o.config, req) },
    async submit(req: GenRequest, opts) {
      if (req.kind !== 'video_clone') throw new ProviderError('The Vercel AI Gateway path only copies motion (a still plus a reference clip).', { retryable: false, submitted: 'no' })
      const entry = entryFor(req.model)
      const image = req.refs?.[0]?.url
      const video = req.sourceVideo?.url
      if (!image?.startsWith('https://') || !video?.startsWith('https://')) throw new ProviderError('The still and the clip need public links for the Gateway.', { retryable: true, submitted: 'no' })
      const mode = (entry.params as { mode?: string } | undefined)?.mode === 'pro' ? 'pro' : 'std'
      try {
        const { operation } = await o.sdk.start({
          modelId: entry.endpoint,
          image,
          ...(req.prompt?.trim() ? { text: req.prompt.slice(0, 2500) } : {}),
          // The clip's orientation (up to 30 s); the original sound is never
          // kept by the provider (the Studio puts it back when asked).
          providerOptions: { klingai: { videoUrl: video, characterOrientation: 'video', mode, keepOriginalSound: 'no' } },
          headers: { 'idempotency-key': opts.idempotencyKey },
        })
        return { jobId: encode(entry.endpoint, operation) }
      } catch (e) {
        throw new ProviderError(`The Vercel AI Gateway did not start the run: ${(e as Error).message.slice(0, 300)}`, { retryable: false, submitted: 'unknown' })
      }
    },
    async status(jobId): Promise<JobStatus> {
      const { m, op } = decode(jobId)
      const r = await o.sdk.status({ modelId: m, operation: op })
      if (r.status === 'pending') return { state: 'running', pollAfterSec: 10 }
      if (r.status === 'error') return { state: 'failed', error: r.error }
      const outputs: Output[] = r.videos.map((v, i) => ({ url: v.type === 'url' ? v.url : `${jobId}#${i}`, kind: 'video', mime: v.mediaType }))
      return { state: 'succeeded', outputs }
    },
    async result(jobId) {
      const s = await this.status(jobId)
      return s.outputs ?? []
    },
    // A video given as data (not a link) is read again from the operation.
    async download(output) {
      if (output.url.startsWith(PREFIX)) {
        const [jobId, i] = output.url.split('#')
        const { m, op } = decode(jobId!)
        const r = await o.sdk.status({ modelId: m, operation: op })
        const v = r.status === 'completed' ? r.videos[Number(i ?? 0)] : undefined
        if (!v || v.type === 'url') throw new ProviderError('The Gateway result is no longer available.', { retryable: true, submitted: 'unknown' })
        return v.type === 'base64' ? Buffer.from(v.data, 'base64') : Buffer.from(v.data)
      }
      if (!output.url.startsWith('https://')) throw new ProviderError('The Gateway returned a link that is not https.', { retryable: false, submitted: 'unknown' })
      const res = await doFetch(output.url)
      if (!res.ok) throw new ProviderError(`Could not download the result (${res.status}).`, { retryable: true, submitted: 'unknown' })
      return Buffer.from(await res.arrayBuffer())
    },
  }
}
