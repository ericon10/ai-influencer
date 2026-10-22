import Anthropic from '@anthropic-ai/sdk'
import type { StudioConfig } from '../config/load.js'
import { actualLlm, estimateLlm } from '../costs/pricebook.js'
import { ProviderError, type LlmProvider, type LlmRequest } from './types.js'

// Claude for breakdowns, concepts, card updates and QA perception. Called
// server side with the account's own key. Structured JSON output via
// output_config.format; server-side refusal fallbacks enabled by default.

// Structured output takes a subset of JSON Schema: an array's minItems may
// only be 0 or 1, and maxItems is not taken. A list the builders need at an
// exact size (minItems = maxItems = n, more than 1: 30 tags for 30
// comments) is sent as an object with n required entries "1" to "n", which
// the model must all fill, and turned back into the list on the way out.
// Any other count is dropped (a minItems above 1 becomes 1). Production,
// 2026-10-22: with the counts simply dropped, a tag call came back with one
// tag for 30 comments.
const fixedSize = (s: Record<string, unknown>) => s.type === 'array' && typeof s.minItems === 'number' && s.minItems > 1 && s.minItems === s.maxItems ? s.minItems : 0

export function apiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(apiSchema)
  if (!schema || typeof schema !== 'object') return schema
  const s = schema as Record<string, unknown>
  const n = fixedSize(s)
  if (n) {
    const keys = Array.from({ length: n }, (_, i) => String(i + 1))
    const item = apiSchema(s.items)
    return { type: 'object', additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map(k => [k, item])) }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'maxItems') continue
    if (k === 'minItems') { if (typeof v === 'number' && v >= 1) out[k] = 1; continue }
    out[k] = apiSchema(v)
  }
  return out
}

// The model's answer in the builders' own shape: each exact-size list sent
// as an object comes back as the list, in order.
export function fromApi(schema: unknown, data: unknown): unknown {
  if (!schema || typeof schema !== 'object' || data == null) return data
  const s = schema as Record<string, unknown>
  const n = fixedSize(s)
  if (n && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    return Array.from({ length: n }, (_, i) => obj[String(i + 1)]).filter(v => v !== undefined).map(v => fromApi(s.items, v))
  }
  if (Array.isArray(data)) return data.map(v => fromApi(s.items, v))
  if (typeof data === 'object' && s.properties && typeof s.properties === 'object') {
    const props = s.properties as Record<string, unknown>
    return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, k in props ? fromApi(props[k], v) : v]))
  }
  return data
}

export function createAnthropicLlm(apiKey: string, config: StudioConfig): LlmProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2 })

  function apiModel(ref: string): string {
    const m = config.models.llm_models.find(x => x.ref === ref)
    if (!m) throw new ProviderError(`Unknown LLM model "${ref}".`, { retryable: false, submitted: 'no' })
    return m.api_model
  }

  return {
    id: 'anthropic',
    async estimate(req) { return estimateLlm(config, req) },
    actualCost(req, usage) { return actualLlm(config, req, usage) },

    async run(req: LlmRequest) {
      const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: req.system }]
      if (req.cachedContext) system.push({ type: 'text', text: req.cachedContext, cache_control: { type: 'ephemeral' } })
      const content: Anthropic.Beta.BetaContentBlockParam[] = []
      for (const img of req.images ?? []) {
        if (img.label) content.push({ type: 'text', text: img.label })
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data.toString('base64') } })
      }
      content.push({ type: 'text', text: req.prompt })

      let res: Anthropic.Beta.BetaMessage
      try {
        res = await client.beta.messages.create({
          model: apiModel(req.model),
          max_tokens: req.maxTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          messages: [{ role: 'user', content }],
          output_config: { effort: req.effort ?? 'medium', format: { type: 'json_schema', schema: apiSchema(req.schema) as Record<string, unknown> } },
        })
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new ProviderError('The Anthropic key was rejected. Check it in Settings.', { retryable: false, submitted: 'no', status: 401 })
        if (e instanceof Anthropic.PermissionDeniedError) throw new ProviderError('The Anthropic key does not have access to this model.', { retryable: false, submitted: 'no', status: 403 })
        if (e instanceof Anthropic.BadRequestError) throw new ProviderError(`Anthropic rejected the request: ${e.message}`, { retryable: false, submitted: 'no', status: 400 })
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError('Anthropic rate limit. Will retry.', { retryable: true, submitted: 'no', status: 429 })
        if (e instanceof Anthropic.APIConnectionError) throw new ProviderError('Could not reach Anthropic. Will retry.', { retryable: true, submitted: 'no' })
        if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic error ${e.status}: ${e.message}`, { retryable: (e.status ?? 500) >= 500, submitted: 'no', status: e.status })
        throw e
      }

      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        servedModel: res.model,
      }
      // An answer that came back but cannot be used was still billed: its
      // usage rides on the error, so the run records what it cost.
      if (res.stop_reason === 'refusal') {
        throw new ProviderError('The model declined this request.', { retryable: false, submitted: 'no', code: 'refusal', usage })
      }
      if (res.stop_reason === 'max_tokens') {
        throw new ProviderError('The model ran out of room before finishing. Raise max tokens for this task.', { retryable: false, submitted: 'no', code: 'max_tokens', usage })
      }
      const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')
      let data: unknown
      try { data = JSON.parse(text) } catch {
        throw new ProviderError('The model returned malformed JSON.', { retryable: true, submitted: 'no', code: 'bad_json', usage })
      }
      return { data: fromApi(req.schema, data), usage }
    },

    async verifyCredentials() {
      try {
        await client.models.list({ limit: 1 })
        return { ok: true, message: 'Anthropic key works.' }
      } catch (e) {
        return { ok: false, message: e instanceof Anthropic.AuthenticationError ? 'The Anthropic key was rejected.' : `Could not verify: ${(e as Error).message}` }
      }
    },
  }
}
