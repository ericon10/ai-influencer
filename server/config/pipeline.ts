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
    // Face matching needs most of the face in view: skip profiles and backs.
    identity: z.enum(['check', 'skip']).default('check'),
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
  z.object({ type: z.literal('identity_block') }),
  z.object({ type: z.literal('marks_stated') }),
  z.object({ type: z.literal('max_words'), field: z.string(), max: z.number().int() }),
  z.object({ type: z.literal('require_pattern'), pattern: z.string(), flags: z.string().default(''), ignore: z.string().optional() }),
  z.object({ type: z.literal('reference_slot') }),
  // Read by the code that does the thing (a fallback, a pre-filled field, a
  // QA hint), not by the prompt lint.
  z.object({ type: z.literal('behavior') }),
  // Enforced in code (fixed rules); listed here so every rule is in one place.
  z.object({ type: z.literal('code') }),
])

const oneOrMany = z.union([z.string(), z.array(z.string())]).transform(v => (Array.isArray(v) ? v : [v]))

export const RULE_AREAS = ['safety', 'realism', 'money', 'character', 'hero', 'sheet', 'scene', 'qa', 'edit', 'video', 'copy'] as const

const rulesSchema = z.object({
  version: z.number(),
  rules: z.array(z.object({
    id: z.string(),
    spec: z.string(),
    title: z.string(),
    // fixed: always on and may block. default: on unless switched off, and
    // never more than a warning (owner ruling G1, "defaults, not locks").
    bucket: z.enum(['fixed', 'default']),
    area: z.enum(RULE_AREAS),
    // The line the scene planner gets while the rule is on.
    planner: z.string().optional(),
    // Whether a default starts on (almost all do). The owner can switch it.
    starts_on: z.boolean().default(true),
    // An editable setting that goes with the rule.
    value: z.string().optional(),
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
    other_clean: z.string(),
  }),
  relations: z.record(z.string(), z.string()),
  kind_nouns: z.record(z.string(), z.string()),
  breakdown: z.object({ system: z.string(), prompt: z.string() }),
  concepts: z.object({ system: z.string(), prompt: z.string() }),
  card_update: z.object({ system: z.string(), prompt: z.string() }),
  qa_perception: z.object({ system: z.string(), prompt: z.string() }),
  scene: z.object({
    base: z.string(),
    reference: z.object({ refs: z.string(), trained: z.string(), text: z.string() }),
    sheet_outfit: z.string(),
    outfit_override: z.string(),
    brand_free: z.string(),
    wearing: z.string(),
    wearing_only: z.string(),
    colors: z.string(),
    makeup: z.object({ bare: z.string(), natural: z.string(), soft_glam: z.string() }),
  }),
  edit: z.object({ base: z.string(), face_ref: z.string() }),
  scene_plan: z.object({ system: z.string(), prompt: z.string() }),
  scene_ideas: z.object({ system: z.string(), prompt: z.string() }),
  video: z.object({ base: z.string(), silent: z.string(), end_frame: z.string() }),
  clone: z.object({ swap: z.string(), image: z.string() }),
  content_slides: z.object({ system: z.string(), prompt: z.string() }),
  content_captions: z.object({ system: z.string(), prompt: z.string() }),
  prompt_writer: z.object({
    still_system: z.string(), still_prompt: z.string(), video_system: z.string(), video_prompt: z.string(),
    end_frame: z.string(),
    video_format: z.string(), video_audio_off: z.string(), video_audio_on: z.string(),
    directors_still: z.string(), directors_video: z.string(), notes_given: z.string(),
  }),
})

const preset = z.object({ id: z.string(), label: z.string(), hint: z.string().optional() })

const scenesSchema = z.object({
  version: z.number(),
  settings: z.object({
    quality: z.string(),
    resolution: z.string(),
    combo_window: z.number().int().positive(),
    max_refs: z.number().int().min(2).max(8),
    max_variations: z.number().int().min(1).max(8),
    max_models: z.number().int().min(1).max(4),
    still_models: z.array(z.string()).min(1),
    edit_models: z.array(z.string()).min(1),
    upscale_model: z.string(),
    // Pre-filled starting points, so only the moment itself is ever needed.
    defaults: z.object({ momentType: z.string(), camera: z.string(), light: z.string() }),
    prompt_words: z.object({ still: z.tuple([z.number().int().positive(), z.number().int().positive()]), video: z.tuple([z.number().int().positive(), z.number().int().positive()]) }),
  }),
  moments: z.array(preset).min(1),
  cameras: z.array(preset.extend({ text: z.string(), foreground: z.string().optional() })).min(1),
  heights: z.array(preset.extend({ text: z.string() })).min(1),
  framings: z.array(preset.extend({ text: z.string(), identity: z.enum(['check', 'skip']).default('check'), skin: z.enum(['full', 'natural', 'none']).default('full') })).min(1),
  lights: z.array(preset.extend({ text: z.string() })).min(1),
  expressions: z.array(preset.extend({ text: z.string(), ref_expression: z.string().optional() })).min(1),
  makeup: z.array(preset).min(1),
  destinations: z.array(preset.extend({ aspect: z.string() })).min(1),
  color_triggers: z.string(),
  edits: z.object({
    drift_lock: z.string(),
    presets: z.array(preset.extend({ text: z.string(), face: z.boolean().default(false), group: z.enum(['quick', 'diagnose']).default('quick') })),
  }),
  // The ultra-realism guide's "Diagnose and revise" table (owner,
  // 2026-10-13): a symptom and its first useful revision, shown under the
  // video prompt. The rows a still edit can fix are also edit presets.
  diagnose: z.array(z.object({ symptom: z.string(), revision: z.string() })).default([]),
  video: z.object({
    model: z.string(),
    // The models the owner picks from, each with its resolution if it has one.
    models: z.array(z.object({ ref: z.string(), resolution: z.string().optional() })).min(1),
    durations: z.array(z.number().int().positive()).min(1),
    duration: z.number().int().positive(),
    aspect: z.string(),
    max_takes: z.number().int().min(1).max(8),
    takes: z.number().int().min(1),
    directions: z.string(),
    test: z.object({ model: z.string(), duration: z.number().int().positive(), resolution: z.string(), label: z.string(), note: z.string() }),
    upscale: z.object({ model: z.string() }),
    end_frame: z.object({ model: z.string(), presets: z.array(preset.extend({ text: z.string() })) }),
  }),
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

const contentSchema = z.object({
  version: z.number(),
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().int().positive() }),
  caption: z.object({
    font: z.object({ file: z.string(), weight: z.number().int() }),
    size: z.number().positive(),
    line_height: z.number().positive(),
    box: z.object({ fill: z.string(), text: z.string(), radius: z.number().min(0), pad_x: z.number().min(0), pad_y: z.number().min(0) }),
    max_width: z.number().positive(),
    max_lines: z.number().int().positive(),
    max_chars: z.number().int().positive(),
    safe: z.object({ top: z.number().min(0), bottom: z.number().min(0), left: z.number().min(0), right: z.number().min(0) }),
    position: z.enum(['top', 'middle', 'bottom']),
  }),
  meme: z.object({ max_clip_seconds: z.number().positive(), broll_seconds: z.number().positive(), max_broll_seconds: z.number().positive(), order: z.enum(['clip_first', 'broll_first']) }),
  broll: z.object({ max_upload_mb: z.number().positive(), max_seconds: z.number().positive(), products: z.array(z.string()).default([]) }),
  slideshow: z.object({ slides: z.tuple([z.number().int().positive(), z.number().int().positive()]), hashtags: z.tuple([z.number().int().min(0), z.number().int().positive()]), max_stills: z.number().int().positive(), image: z.object({ quality: z.number().int().min(50).max(100) }) }),
  batch: z.object({ max: z.number().int().positive(), default_count: z.number().int().positive() }),
  clone: z.object({
    model: z.string(),
    account_model: z.string(),
    models: z.array(z.object({ ref: z.string(), resolution: z.string().optional() })).min(1),
    min_seconds: z.number().positive(),
    max_seconds: z.number().positive(),
    max_upload_mb: z.number().positive(),
    max_characters: z.number().int().positive(),
    keep_sound: z.boolean(),
  }),
})

export const pipelineSchemas = {
  sheet: sheetSchema,
  views: viewsSchema,
  rules: rulesSchema,
  templates: templatesSchema,
  review: reviewSchema,
  scenes: scenesSchema,
  content: contentSchema,
}

export type SheetConfig = z.infer<typeof sheetSchema>
export type SheetShot = SheetConfig['shots'][number]
export type ViewsConfig = z.infer<typeof viewsSchema>
export type ViewDef = ViewsConfig['views'][string]
export type RulesConfig = z.infer<typeof rulesSchema>
export type Rule = RulesConfig['rules'][number]
export type TemplatesConfig = z.infer<typeof templatesSchema>
export type ReviewConfig = z.infer<typeof reviewSchema>
export type ScenesConfig = z.infer<typeof scenesSchema>
export type ContentConfig = z.infer<typeof contentSchema>

export interface PipelineConfig {
  sheet: SheetConfig
  views: ViewsConfig
  rules: RulesConfig
  templates: TemplatesConfig
  review: ReviewConfig
  scenes: ScenesConfig
  content: ContentConfig
}
