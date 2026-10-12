import type { PriceBook, PriceEntry, StudioConfig } from '../config/load'
import type { CostEstimate, CostLine, GenRequest, LlmRequest, LlmUsage, Output } from '../providers/types'
import { usdToMicros } from './money'

// Estimates and actual costs come from the price book (data), so every
// provider is priced the same way and prices can change without code.

export function splitRef(ref: string): { provider: string; model: string } {
  const i = ref.indexOf('/')
  if (i < 1) throw new Error(`Model refs look like "provider/model", got "${ref}"`)
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) }
}

export function findPrice(pb: PriceBook, provider: string, model: string, unit: PriceEntry['unit'], attrs: Record<string, string | undefined> = {}): PriceEntry | null {
  let best: PriceEntry | null = null
  let bestScore = -1
  for (const e of pb.entries) {
    if (e.provider !== provider || e.model !== model || e.unit !== unit) continue
    const when = e.when ?? {}
    const keys = Object.keys(when)
    if (keys.some(k => attrs[k] !== when[k])) continue
    if (keys.length > bestScore) { best = e; bestScore = keys.length }
  }
  return best
}

function line(label: string, quantity: number, unit: string, entry: PriceEntry): CostLine {
  const unitPriceMicros = usdToMicros(entry.price)
  return { label, quantity, unit, unitPriceMicros, amountMicros: Math.round(unitPriceMicros * quantity) }
}

export class PriceMissingError extends Error {}

function genUnit(req: GenRequest): { unit: PriceEntry['unit']; quantity: number; label: string } {
  if (req.kind === 'video' || req.kind === 'video_extend') {
    const seconds = req.durationSec ?? 5
    return { unit: 'second', quantity: seconds, label: `${seconds}s of video` }
  }
  if (req.kind === 'audio') return { unit: 'second', quantity: req.durationSec ?? 10, label: 'audio' }
  if (req.kind === 'train_identity') return { unit: 'call', quantity: 1, label: 'identity training' }
  return { unit: 'image', quantity: 1, label: req.kind === 'upscale' ? 'upscale' : 'image' }
}

export function estimateGen(cfg: StudioConfig, req: GenRequest, pb: PriceBook = cfg.pricebook): CostEstimate {
  const { provider, model } = splitRef(req.model)
  const u = genUnit(req)
  const entry = findPrice(pb, provider, model, u.unit, { resolution: req.resolution, quality: req.quality, aspect: req.aspect })
  if (!entry) throw new PriceMissingError(`No price for ${req.model} per ${u.unit}. Add it to the price book before running.`)
  const l = line(u.label, u.quantity, u.unit, entry)
  return { totalMicros: l.amountMicros, lines: [l], priceVersion: pb.version, verified: entry.verified }
}

// Actual cost after the run, from what was actually produced (for example
// the real clip length). Failed and filtered runs are refunded by providers,
// so they cost zero.
export function actualGen(cfg: StudioConfig, req: GenRequest, outputs: Output[], pb: PriceBook = cfg.pricebook): CostEstimate {
  if ((req.kind === 'video' || req.kind === 'video_extend') && outputs[0]?.durationSec) {
    return estimateGen(cfg, { ...req, durationSec: Math.round(outputs[0].durationSec * 10) / 10 }, pb)
  }
  return estimateGen(cfg, req, pb)
}

// Rough token estimate before an LLM call: about 3.5 characters per token for
// text, and image tokens from pixel area (capped). Output is priced at
// max_tokens, so the estimate is an upper bound.
export function estimateLlmTokens(cfg: StudioConfig, req: LlmRequest): { input: number; output: number } {
  const text = req.system.length + (req.cachedContext?.length ?? 0) + req.prompt.length + JSON.stringify(req.schema).length
  let input = Math.ceil(text / 3.5)
  const maxEdge = cfg.runtime.llm.image_max_edge
  for (const img of req.images ?? []) {
    const w = img.width ?? maxEdge, h = img.height ?? maxEdge
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    input += Math.min(cfg.runtime.llm.image_max_tokens, Math.ceil((w * scale * h * scale) / 750))
  }
  return { input, output: req.maxTokens }
}

function llmCost(cfg: StudioConfig, ref: string, usage: { input: number; output: number; cacheRead: number; cacheWrite: number }, pb: PriceBook): CostEstimate {
  const { provider, model } = splitRef(ref)
  const apiModel = cfg.models.llm_models.find(m => m.ref === ref)?.api_model ?? model
  const lines: CostLine[] = []
  let verified = true
  const parts: Array<[PriceEntry['unit'], number, string]> = [
    ['mtok_in', usage.input, 'input tokens'],
    ['mtok_out', usage.output, 'output tokens'],
    ['mtok_cache_read', usage.cacheRead, 'cached input tokens'],
    ['mtok_cache_write', usage.cacheWrite, 'cache writes'],
  ]
  for (const [unit, tokens, label] of parts) {
    if (!tokens) continue
    const entry = findPrice(pb, provider, apiModel, unit)
    if (!entry) throw new PriceMissingError(`No ${unit} price for ${ref}.`)
    verified &&= entry.verified
    lines.push(line(label, tokens / 1_000_000, unit, entry))
  }
  return { totalMicros: lines.reduce((s, l) => s + l.amountMicros, 0), lines, priceVersion: pb.version, verified }
}

export function estimateLlm(cfg: StudioConfig, req: LlmRequest, pb: PriceBook = cfg.pricebook): CostEstimate {
  const t = estimateLlmTokens(cfg, req)
  return llmCost(cfg, req.model, { input: t.input, output: t.output, cacheRead: 0, cacheWrite: 0 }, pb)
}

export function actualLlm(cfg: StudioConfig, req: LlmRequest, usage: LlmUsage, pb: PriceBook = cfg.pricebook): CostEstimate {
  // If a server-side fallback served the request, price it on the served
  // model when the price book knows it.
  const provider = splitRef(req.model).provider
  const servedRef = `${provider}/${usage.servedModel}`
  const known = cfg.models.llm_models.some(m => m.ref === servedRef)
  return llmCost(cfg, known ? servedRef : req.model, {
    input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens,
  }, pb)
}
