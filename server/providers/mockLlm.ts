import type { StudioConfig } from '../config/load.js'
import { actualLlm, estimateLlm, estimateLlmTokens } from '../costs/pricebook.js'
import type { LlmProvider, LlmRequest } from './types.js'

// Free stand-in for the LLM. Answers by schema name with plausible data, or
// with a responder supplied by a test (for example a recorded perception of
// a mirrored image).

export type LlmResponder = (req: LlmRequest) => unknown

const DEFAULTS: Record<string, LlmResponder> = {
  breakdown: () => ({
    keep: [
      { aspect: 'hair styling', detail: 'Loose, lived-in waves with a deep side part' },
      { aspect: 'wardrobe', detail: 'Simple neutrals, fitted tees, high-rise denim' },
      { aspect: 'palette', detail: 'Warm sand, cream and soft gold' },
      { aspect: 'camera feel', detail: 'Candid phone photo, natural light' },
    ],
    change: [
      { feature: 'face shape', observed: 'Square jaw', direction: 'Soft oval face' },
      { feature: 'eyes', observed: 'Blue, almond', direction: 'Warm hazel-brown, slightly rounder' },
      { feature: 'brows', observed: 'Thin, arched', direction: 'Full, straighter light-brown brows' },
    ],
    vibe: 'Sunny, easygoing, quietly confident',
    cautions: [],
  }),
  concepts: () => ({
    concepts: [
      concept('Maya', 25, 'long dark-brown curls with a center part, deep brown eyes, heart-shaped face, thick straight brows, full lips, warm tan skin, fit athletic build', [
        mark('mole', 'small subtle mole', 'RIGHT', 'cheek', 'skin'), mark('stud', 'tiny silver hoop', 'LEFT', 'ear', 'jewelry')]),
      concept('Elena', 27, 'shoulder-length auburn waves with a side part, green eyes, soft oval face, arched brows, medium lips, fair skin with light freckles, slim toned build', [
        mark('freckle', 'subtle freckle cluster', 'LEFT', 'cheek', 'skin'), mark('cuff', 'thin gold ear cuff', 'RIGHT', 'ear', 'jewelry')]),
      concept('Jade', 23, 'sleek black bob with a deep side part, dark brown eyes, round face, soft brows, full lips, light olive skin, petite toned build', [
        mark('mole', 'subtle mole', 'LEFT', 'brow', 'skin'), mark('stud', 'small pearl stud', 'RIGHT', 'ear', 'jewelry')]),
    ],
  }),
  card_update: req => ({
    differences: [],
    card: String(req.meta?.card ?? ''),
    marks: (req.meta?.marks as unknown[]) ?? [],
  }),
  qa_perception: req => req.meta?.mockObservation ?? {
    pose: 'frontal', nose: 'toward_camera', confidence: 0.9,
    framing: 'chest_up', standing: true, ears: [], skin_marks: [], other_jewelry: [],
    eye_color: 'unknown', text_or_logos: [], artifacts: [], skin: { texture: 'real', flaws: ['visible pores'] }, notes: 'Mock observation.',
  },
}

function mark(name: string, description: string, side: 'LEFT' | 'RIGHT', region: string, kind: 'skin' | 'jewelry') {
  return { name, description, side, region, kind }
}

function concept(name: string, age: number, look: string, marks: unknown[]) {
  return {
    name, age,
    card: `${age}, ${look}.`,
    features: { look },
    marks,
    body: 'fit, athletic build, defined waist, natural proportions',
    style: 'Relaxed everyday basics with one standout piece',
    vibe: 'Warm and candid',
    pronouns: { subj: 'she', obj: 'her', poss: 'her', noun: 'woman' },
  }
}

export function createMockLlm(config: StudioConfig, responders: Record<string, LlmResponder> = {}): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = []
  return {
    id: 'mock',
    calls,
    async estimate(req) { return estimateLlm(config, req) },
    async run(req) {
      calls.push(req)
      const responder = responders[req.schemaName] ?? DEFAULTS[req.schemaName]
      if (!responder) throw new Error(`Mock LLM has no answer for schema "${req.schemaName}".`)
      const t = estimateLlmTokens(config, req)
      return {
        data: responder(req),
        usage: { inputTokens: t.input, outputTokens: Math.min(400, req.maxTokens), cacheReadTokens: 0, cacheWriteTokens: 0, servedModel: 'llm' },
      }
    },
    actualCost(req, usage) { return actualLlm(config, req, usage) },
    async verifyCredentials() { return { ok: true, message: 'Mock LLM needs no key.' } },
  }
}
