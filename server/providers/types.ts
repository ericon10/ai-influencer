// Provider layer contract (SPEC.md section 7.1), extended with what a
// production runner needs: capabilities, submit options, webhook handling,
// error classification, and a free credentials check.

export type GenKind = 'image' | 'image_edit' | 'video' | 'video_extend' | 'audio' | 'train_identity' | 'upscale'

export interface AssetRef {
  assetId: string
  // A URL the provider can fetch. Filled in by the runner just before submit
  // (for example a short-lived presigned R2 URL); never stored in requests.
  url?: string
}

export interface GenRequest {
  kind: GenKind
  model: string // model ref, for example "higgsfield/gpt-image-2.5"
  prompt: string
  refs?: AssetRef[]
  startFrame?: AssetRef
  endFrame?: AssetRef
  sourceVideo?: AssetRef
  aspect?: string
  resolution?: string
  quality?: string
  durationSec?: number
  // Video: always false (SPEC 5.4 rule 27). The type allows nothing else.
  audio?: false
  seed?: number
  // Upscale factor for kind "upscale" (SPEC 5.1 rule 6: 2x, never more).
  scale?: 2
}

export interface ModelInfo {
  ref: string
  provider: string
  label: string
  kinds: GenKind[]
  maxRefs: number
  verified: boolean
}

export interface CostLine {
  label: string
  quantity: number
  unit: string
  unitPriceMicros: number
  amountMicros: number
}

export interface CostEstimate {
  totalMicros: number
  lines: CostLine[]
  priceVersion: string
  // False when the price book entry is a placeholder not yet confirmed
  // against the provider's published price. The UI says so.
  verified: boolean
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'nsfw' | 'canceled'

export interface Output {
  url: string
  kind: 'image' | 'video' | 'audio'
  mime?: string
  width?: number
  height?: number
  durationSec?: number
}

export interface JobStatus {
  state: JobState
  outputs?: Output[]
  error?: string
  // Seconds the provider suggests waiting before the next poll.
  pollAfterSec?: number
  raw?: unknown
}

export interface SubmitOptions {
  idempotencyKey: string
  webhookUrl?: string
}

export interface WebhookInput {
  headers: Record<string, string>
  query: Record<string, string>
  body: string
}

export interface ProviderAdapter {
  id: string
  // True when reference images must be reachable by URL (real providers).
  needsPublicAssetUrls?: boolean
  // Puts bytes in the provider's own storage and returns a URL its models
  // accept. Preferred over our own public URLs when available.
  uploadAsset?(data: Buffer, mime: string): Promise<string>
  listModels(): Promise<ModelInfo[]>
  estimate(req: GenRequest): Promise<CostEstimate>
  submit(req: GenRequest, opts: SubmitOptions): Promise<{ jobId: string; raw?: unknown }>
  status(jobId: string): Promise<JobStatus>
  result(jobId: string): Promise<Output[]>
  cancel?(jobId: string): Promise<void>
  // Most providers sign nothing; the runner's per-job URL token is the
  // primary check, and webhook bodies are never trusted for results.
  verifyWebhook?(input: WebhookInput): boolean
  // Custom download (the mock serves bytes without HTTP).
  download?(output: Output): Promise<Buffer>
  // A free call that proves the stored credentials work.
  verifyCredentials?(): Promise<{ ok: boolean; message: string }>
}

// Thrown by adapters so the runner can decide between retry, fail and
// "needs a human". `submitted` says whether the provider may have accepted
// the job: "unknown" is never auto-resubmitted (double-charge protection).
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly opts: { retryable: boolean; submitted: 'no' | 'unknown'; status?: number; code?: string } = { retryable: false, submitted: 'no' },
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// ── Text and vision LLM calls (synchronous providers) ─────────────

export interface LlmImage {
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  data: Buffer
  width?: number
  height?: number
  label?: string
}

export interface LlmRequest {
  model: string // model ref, for example "anthropic/claude-opus-5-5"
  system: string
  // Stable context (character file, rules) placed before the volatile part
  // and cached, so it is not re-billed in full on every call.
  cachedContext?: string
  prompt: string
  images?: LlmImage[]
  // JSON Schema for the structured result.
  schema: Record<string, unknown>
  schemaName: string
  maxTokens: number
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // Never sent to a real provider. Lets the mock answer consistently in
  // demo mode and tests (for example the observation QA expects).
  meta?: Record<string, unknown>
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  servedModel: string
}

export interface LlmResult {
  data: unknown
  usage: LlmUsage
}

export interface LlmProvider {
  id: string
  estimate(req: LlmRequest): Promise<CostEstimate>
  run(req: LlmRequest): Promise<LlmResult>
  actualCost(req: LlmRequest, usage: LlmUsage): CostEstimate
  verifyCredentials?(): Promise<{ ok: boolean; message: string }>
}
