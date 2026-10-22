import Anthropic from '@anthropic-ai/sdk'
import type { StudioConfig } from '../config/load.js'
import { actualLlm, estimateLlm } from '../costs/pricebook.js'
import { ProviderError, type LlmProvider, type LlmRequest } from './types.js'

// Claude for breakdowns, concepts, card updates and QA perception. Called
// server side with the account's own key. Structured JSON output via
// output_config.format; server-side refusal fallbacks enabled by default.

// Structured output takes a subset of JSON Schema: an array's minItems may
// only be 0 or 1, and maxItems is not taken. Any other count is dropped (a
// minItems above 1 becomes 1). A list the builders need at an exact size
// (minItems = maxItems = n, more than 1: 30 tags for 30 comments) keeps its
// count as the list's description, which the model reads; the callers also
// name the count in the prompt and treat a missing entry as not done.
// Production, 2026-10-22: with the counts simply dropped, a tag call came
// back with one tag for 30 comments; sent as an object with 30 required
// keys instead, Anthropic refused it ("The compiled grammar is too large").
const fixedSize = (s: Record<string, unknown>) => s.type === 'array' && typeof s.minItems === 'number' && s.minItems > 1 && s.minItems === s.maxItems ? s.minItems : 0

export function apiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(apiSchema)
  if (!schema || typeof schema !== 'object') return schema
  const s = schema as Record<string, unknown>
  const n = fixedSize(s)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'maxItems') continue
    if (k === 'minItems') { if (typeof v === 'number' && v >= 1) out[k] = 1; continue }
    // A double quote inside an enum value comes back unescaped and breaks
    // the JSON (production, 2026-10-22: the pain point
    // 'lowball pay and "competitive" salary'). It goes as a single quote;
    // the readers match either.
    if (k === 'enum' && Array.isArray(v)) { out[k] = v.map(x => (typeof x === 'string' ? x.replace(/"/g, "'") : x)); continue }
    out[k] = apiSchema(v)
  }
  if (n) out.description = [typeof s.description === 'string' ? s.description : '', `Exactly ${n} entries, one for each numbered item, numbered 1 to ${n}, in order. Never fewer.`].filter(Boolean).join(' ')
  return out
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
      const texts = res.content.flatMap(b => (b.type === 'text' ? [b.text] : []))
      const text = texts.join('')
      let data: unknown
      try { data = JSON.parse(text) } catch (e) {
        // What came back, so the failure can be read on the job (its start
        // and end, the block types and why it stopped).
        const seen = `stop ${res.stop_reason}, blocks ${res.content.map(b => b.type).join('+')}, ${text.length} chars, ${(e as Error).message}; starts ${JSON.stringify(text.slice(0, 160))}; ends ${JSON.stringify(text.slice(-160))}`
        throw new ProviderError(`The model returned malformed JSON (${seen}).`, { retryable: true, submitted: 'no', code: 'bad_json', usage })
      }
      return { data, usage }
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
