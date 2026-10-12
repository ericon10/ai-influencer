import { z } from 'zod'

// Schemas for the character pipeline's data files: the reference sheet graph
// (SPEC 4.1), camera views and mark visibility, the rules engine (SPEC 5),
// prompt templates (SPEC 10), and review reasons with their fix actions
// (SPEC 11).

export const SIDES = ['LEFT', 'RIGHT'] as const
export type Side = typeof SIDES[number]

const visibility = z.enum(['visible', 'partial', 'hidden'])

const sheetSchema = z.object({
  version: z.number(),
  settings: z.object({
    quality: z.string(),
    resolution: z.string(),
    aspect: z.object({ chest_up: z.string(), full_body: z.string() }),
    upscale_ref00_below_px: z.number().int().positive(),
  }),
  shots: z.array(z.object({
    id: z.string().regex(/^REF-\d{2}$/),
    label: z.string(),
    view: z.string(),
    framing: z.enum(['chest_up', 'full_body']),
    expression: z.string(),
    attach: z.array(z.string()),
    source: z.enum(['hero', 'generate']).default('generate'),
  })).min(1),
})

const viewsSchema = z.object({
  version: z.number(),
  views: z.record(z.string(), z.object({
    label: z.string(),
    // camera: the subject faces the camera, so image-left is the subject's
    // RIGHT. away: seen from behind, so image-left is the subject's LEFT.
    facing: z.enum(['camera', 'away']),
    // Which of the subject's sides is turned toward the camera, if any.
    turn: z.enum(['none', 'LEFT', 'RIGHT']),
    prompt: z.string(),
    sides: z.object({ LEFT: visibility, RIGHT: visibility }),
    // On a partially visible side, the regions that may still show.
    partial_regions: z.array(z.string()).default([]),
  })),
})

const ruleCheck = z.discriminatedUnion('type', [
  z.object({ type: z.literal('forbid_pattern'), pattern: z.string(), flags: z.string().default(''), exclude_after: z.string().optional() }),
  z.object({ type: z.literal('require_phrase'), phrase: z.string() }),
  z.object({ type: z.literal('forbid_char'), codepoint: z.number().int() }),
  z.object({ type: z.literal('no_attachments') }),
  z.object({ type: z.literal('requires_start_frame') }),
  z.object({ type: z.literal('request_fields'), require: z.record(z.string(), z.array(z.union([z.string(), z.number(), z.boolean()]))) }),
  z.object({ type: z.literal('aspect_matches_framing') }),
  z.object({ type: z.literal('sheet_model_locked') }),
  z.object({ type: z.literal('marks_stated') }),
  z.object({ type: z.literal('max_words'), field: z.string(), max: z.number().int() }),
])

const oneOrMany = z.union([z.string(), z.array(z.string())]).transform(v => (Array.isArray(v) ? v : [v]))

const rulesSchema = z.object({
  version: z.number(),
  rules: z.array(z.object({
    id: z.string(),
    spec: z.string(),
    title: z.string(),
    when: z.object({
      stage: oneOrMany.optional(),
      framing: oneOrMany.optional(),
      kind: oneOrMany.optional(),
    }).default({}),
    check: ruleCheck,
    severity: z.enum(['error', 'warning']).default('error'),
    message: z.string(),
  })),
})

const templatesSchema = z.object({
  version: z.number(),
  hero: z.object({ base: z.string(), variants: z.array(z.string()).length(3) }),
  sheet: z.object({ base: z.string() }),
  framing: z.record(z.string(), z.string()),
  outfit: z.record(z.string(), z.string()),
  body_line: z.string(),
  expressions: z.record(z.string(), z.string()),
  marks: z.object({
    required: z.string(),
    required_front_hint: z.string(),
    optional: z.string(),
    hidden: z.string(),
    hidden_other_clean: z.string(),
    hero_line: z.string(),
  }),
  relations: z.record(z.string(), z.string()),
  kind_nouns: z.record(z.string(), z.string()),
  breakdown: z.object({ system: z.string(), prompt: z.string() }),
  concepts: z.object({ system: z.string(), prompt: z.string() }),
  card_update: z.object({ system: z.string(), prompt: z.string() }),
  qa_perception: z.object({ system: z.string(), prompt: z.string() }),
})

const reviewSchema = z.object({
  version: z.number(),
  reasons: z.array(z.object({
    id: z.string(),
    label: z.string(),
    action: z.string(),
    spec: z.string().optional(),
  })),
  actions: z.record(z.string(), z.object({
    label: z.string(),
    prompt_addendum: z.string().default(''),
    phase: z.number().int().default(1),
    fallback: z.string().optional(),
  })),
  qa: z.object({
    identity_min_similarity: z.number(),
    distinctness_max_similarity: z.number(),
    mirror_consistency: z.boolean(),
    eye_color_check: z.boolean(),
  }),
})

export const pipelineSchemas = {
  sheet: sheetSchema,
  views: viewsSchema,
  rules: rulesSchema,
  templates: templatesSchema,
  review: reviewSchema,
}

export type SheetConfig = z.infer<typeof sheetSchema>
export type SheetShot = SheetConfig['shots'][number]
export type ViewsConfig = z.infer<typeof viewsSchema>
export type ViewDef = ViewsConfig['views'][string]
export type RulesConfig = z.infer<typeof rulesSchema>
export type Rule = RulesConfig['rules'][number]
export type TemplatesConfig = z.infer<typeof templatesSchema>
export type ReviewConfig = z.infer<typeof reviewSchema>

export interface PipelineConfig {
  sheet: SheetConfig
  views: ViewsConfig
  rules: RulesConfig
  templates: TemplatesConfig
  review: ReviewConfig
}
