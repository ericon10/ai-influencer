import Anthropic from '@anthropic-ai/sdk'
import type { StudioConfig } from '../config/load'
import { actualLlm, estimateLlm } from '../costs/pricebook'
import { ProviderError, type LlmProvider, type LlmRequest } from './types'

// Claude for breakdowns, concepts, card updates and QA perception. Called
// server side with the account's own key. Structured JSON output via
// output_config.format; server-side refusal fallbacks enabled by default.

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
          output_config: { effort: req.effort ?? 'medium', format: { type: 'json_schema', schema: req.schema } },
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

      if (res.stop_reason === 'refusal') {
        throw new ProviderError('The model declined this request.', { retryable: false, submitted: 'no', code: 'refusal' })
      }
      if (res.stop_reason === 'max_tokens') {
        throw new ProviderError('The model ran out of room before finishing. Raise max tokens for this task.', { retryable: false, submitted: 'no', code: 'max_tokens' })
      }
      const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')
      let data: unknown
      try { data = JSON.parse(text) } catch {
        throw new ProviderError('The model returned malformed JSON.', { retryable: true, submitted: 'no', code: 'bad_json' })
      }
      return {
        data,
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
          servedModel: res.model,
        },
      }
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
