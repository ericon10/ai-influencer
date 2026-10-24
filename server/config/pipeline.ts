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
    aspect: z.object({ chest_up: z.string(), full_body: z.string(), waist_up: z.string().default('3:4') }),
    upscale_ref00_below_px: z.number().int().positive(),
  }),
  shots: z.array(z.object({
    id: z.string().regex(/^REF-\d{2}$/),
    label: z.string(),
    view: z.string(),
    framing: z.enum(['chest_up', 'waist_up', 'full_body']),
    expression: z.string(),
    attach: z.array(z.string()),
    source: z.enum(['hero', 'generate']).default('generate'),
    // The build refs (owner, 2026-10-22, item 3e): REF-12 and REF-13 are
    // made only for a character with "Build refs" on (or once one exists).
    optional: z.boolean().default(false),
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

// Catalog wording (config/wording.yaml, DECISIONS G46).
const wordingPair = z.object({ from: z.string().min(1), to: z.string() })
const wordingSchema = z.object({
  fit: z.array(z.string().min(1)).default([]),
  body: z.array(z.string().min(1)).default([]),
  swaps: z.array(wordingPair).default([]),
  pose: z.array(wordingPair).default([]),
  // Cup sizes and the like: case-sensitive regular expressions, taken out
  // like a fit word.
  patterns: z.array(z.string().min(1).refine(p => { try { new RegExp(p); return true } catch { return false } }, 'Not a valid pattern')).default([]),
  // Garment types: the outfit the clip reader writes names at least one
  // (rule outfit-garment, UX-PLAN section 26).
  garments: z.array(z.string().min(1)).default([]),
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
  // Words the provider's filter often blocks (config/wording.yaml, filled
  // in when the config loads).
  z.object({ type: z.literal('risky_wording'), wording: wordingSchema.optional() }),
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
    reference: z.object({ refs: z.string(), trained: z.string(), text: z.string(), as_written: z.string() }),
    sheet_outfit: z.string(),
    outfit_override: z.string(),
    outfit_free: z.string(),
    adult: z.string(),
    brand_free: z.string(),
    wearing: z.string(),
    wearing_only: z.string(),
    colors: z.string(),
    makeup: z.object({ bare: z.string(), natural: z.string(), everyday: z.string().default('soft everyday makeup'), soft_glam: z.string(), groomed: z.string().default('Groomed brows and beard') }),
  }),
  edit: z.object({ base: z.string(), face_ref: z.string() }),
  scene_plan: z.object({ system: z.string(), prompt: z.string() }),
  scene_ideas: z.object({ system: z.string(), prompt: z.string() }),
  punch_up_lines: z.object({ system: z.string(), prompt: z.string() }),
  video: z.object({ base: z.string(), silent: z.string(), end_frame: z.string(), continue: z.string() }),
  clone: z.object({ swap: z.string(), image: z.string(), replace: z.string(), scene_still: z.string(), recreate_still: z.string(), recreate_not_like: z.string(), recreate_element_api: z.string(), recreate_realism: z.string(), face_pass: z.string(), face_pass_refs: z.string().default(" (the face in the other images)"), recreate_keep: z.string(), recreate_pair: z.string(), recreate_pair_element: z.string(), recreate_new_set: z.string(), recreate_new_set_default: z.string(), outfit_keep_named: z.string(), outfit_hers_named: z.string(), motion: z.string(), motion_scene: z.string(), motion_what: z.string(), outfit_source: z.string(), outfit_hers: z.string(), target_main: z.string(), target_at: z.string() }),
  clone_traits: z.object({ system: z.string(), prompt: z.string() }),
  clone_outfit: z.object({ system: z.string(), prompt: z.string() }),
  content_slides: z.object({ system: z.string(), prompt: z.string() }),
  content_captions: z.object({ system: z.string(), prompt: z.string() }),
  clone_caption: z.object({ system: z.string(), prompt: z.string() }),
  hook_variants: z.object({ system: z.string(), prompt: z.string() }),
  slideshow_hooks: z.object({ system: z.string(), prompt: z.string() }),
  slideshow_draft: z.object({ system: z.string(), prompt: z.string() }),
  // The general standard for slide 1 (section 29), for every post whose
  // product is on it or that has no product.
  hook_standard: z.string(),
  // The SideStep standard's writers (sections 28 and 29): THE STANDARD for
  // slide 1, the ladder, the playbook's menu, the honest endings, the
  // stop-test reviewer, and its own hook writer and draft. Only posts whose
  // product is on the SideStep standard use them.
  sidestep_slideshow_hooks: z.object({ system: z.string(), prompt: z.string() }),
  sidestep_slideshow_hooks_review: z.object({ system: z.string(), prompt: z.string() }),
  // The line bank (UX-PLAN section 36, item 29): tags, writer, reviewer, voice.
  line_bank_tags: z.object({ system: z.string(), prompt: z.string() }),
  line_bank_writer: z.object({ system: z.string(), prompt: z.string() }),
  line_bank_reviewer: z.object({ system: z.string(), prompt: z.string() }),
  line_bank_voice: z.object({ system: z.string(), prompt: z.string() }),
  // Weeks (UX-PLAN section 37): Fit to voice, and Tag the bank (life or job).
  week_fit: z.object({ system: z.string(), prompt: z.string() }),
  line_bank_retag: z.object({ system: z.string(), prompt: z.string() }),
  sidestep_slideshow_draft: z.object({ system: z.string(), prompt: z.string() }),
  sidestep_playbook_menu: z.string(),
  sidestep_hook_standard: z.string(),
  sidestep_playbook_ladder: z.string(),
  sidestep_product_endings: z.string(),
  slideshow_special_menu: z.string(),
  slideshow_caption: z.object({ system: z.string(), prompt: z.string() }),
  slideshow_variations: z.object({ system: z.string(), prompt: z.string() }),
  slideshow_topic: z.string(),
  slideshow_topic_realism: z.string(),
  slideshow_same_place: z.string(),
  slideshow_set: z.string(),
  slideshow_element: z.string(),
  // Every slide still leaves room for its words (item 8, R1).
  slideshow_caption_space: z.string().default('Leave clear space in the top third of the frame for a caption.'),
  // A slide whose image line wins drops "the same place" when its outfit
  // lock says the place changes (item 13).
  slideshow_set_outfit: z.string().default('This photo is one of a set from the same day: the same outfit in every photo of the set.'),
  prompt_writer: z.object({
    still_system: z.string(), still_prompt: z.string(), video_system: z.string(), video_prompt: z.string(),
    end_frame: z.string(),
    video_format: z.string(), video_recipe_caught_you: z.string().default(''), video_format_caught_you: z.string().optional(), video_audio_off: z.string(), video_audio_on: z.string(), continue_facts: z.string(),
    directors_still: z.string(), directors_video: z.string(), notes_given: z.string(),
  }),
})

const preset = z.object({ id: z.string(), label: z.string(), hint: z.string().optional() })

const scenesSchema = z.object({
  version: z.number(),
  settings: z.object({
    quality: z.string(),
    resolution: z.string(),
    still_level: z.string().default('standard'),
    still_levels: z.record(z.string(), z.object({ label: z.string(), quality: z.string(), resolution: z.string(), models: z.record(z.string(), z.object({ quality: z.string().optional(), resolution: z.string().optional() })).default({}) })).default({}),
    default_still_model: z.string().optional(),
    default_variations: z.number().int().min(1).max(8).default(2),
    body_ref_framings: z.array(z.string()).default(['knees_up', 'full_body']),
    combo_window: z.number().int().positive(),
    hair_window: z.number().int().positive().default(5),
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
  makeup_by_setting: z.object({ bare: z.array(z.string().min(1)).default([]) }).default({ bare: [] }),
  hair_bank: z.array(z.string().min(1)).default([]),
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
    directions_caught_you: z.string().optional(),
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
    position: z.enum(['top', 'upper_third', 'middle', 'bottom']),
    // "box": TikTok's white box. "outline": white text with a black stroke
    // (TikTok Classic). "plain": big text, no box (text behind subject).
    style: z.enum(['box', 'outline', 'plain']).default('box'),
    outline: z.object({ text: z.string(), stroke: z.string(), width: z.number().min(0) }).default({ text: '#ffffff', stroke: '#000000', width: 0.11 }),
    // Karaoke: the word being said, lit up.
    karaoke: z.object({ fill: z.string(), text: z.string(), color: z.string() }).default({ fill: '#ffd60a', text: '#000000', color: '#ffd60a' }),
  }),
  meme: z.object({ max_clip_seconds: z.number().positive(), broll_seconds: z.number().positive(), max_broll_seconds: z.number().positive(), order: z.enum(['clip_first', 'broll_first']) }),
  broll: z.object({ max_upload_mb: z.number().positive(), max_seconds: z.number().positive() }),
  slideshow: z.object({
    slides: z.tuple([z.number().int().positive(), z.number().int().positive()]), hashtags: z.tuple([z.number().int().min(0), z.number().int().positive()]), max_stills: z.number().int().positive(), image: z.object({ quality: z.number().int().min(50).max(100) }),
    // Section 27 (the power-up): slides a draft makes, the Instagram size,
    // variations, batch and the mock-screen names (a real brand on a mock
    // screen becomes a generic name). Section 30: the models a slide with
    // no one in it may use (the cheapest on the picked path runs).
    draft_slides: z.number().int().min(3).max(10).default(6),
    instagram: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).default({ width: 1080, height: 1440 }),
    empty_still_models: z.array(z.string()).min(1).default(['higgsfield/gpt-image-2.5-flare', 'higgsfield/nano-banana-2.1']),
    // A character slideshow's framings in turn, slide by slide (item 12): a
    // framing preset and, for over the shoulder, a camera. A default; the
    // slide card picks one.
    framing_mix: z.array(z.object({ id: z.string(), label: z.string(), framing: z.string(), camera: z.string().optional() })).default([
      { id: 'close', label: 'Close-up', framing: 'chest_up' },
      { id: 'mid', label: 'Mid', framing: 'waist_up' },
      { id: 'wide', label: 'Wide', framing: 'wide_small' },
      { id: 'hands', label: 'Hands only', framing: 'hands_only' },
      { id: 'over_shoulder', label: 'Over the shoulder', framing: 'waist_up', camera: 'over_shoulder' },
    ]),
    max_variations: z.number().int().min(1).max(10).default(5),
    // A batch post stores at most 10 hooks (slideshowSpec batchHooks).
    batch_max: z.number().int().min(1).max(10).default(10),
    hooks: z.number().int().min(3).max(20).default(10),
    brand_names: z.array(z.string()).default([]),
    generic_names: z.array(z.string()).default([]),
  }),
  // The playbook's fit table (section 28): a primary and a backup code per
  // account tag or character name.
  playbook: z.object({ fit: z.record(z.string(), z.tuple([z.string(), z.string()])).default({}) }).default({ fit: {} }),
  // The rules a product adds on top of the general standard (section 29):
  // a product picks one of these, or none; its posts follow it. `names` start a product of that
  // name on it; `review` runs the stop-test reviewer after Write 10; `lint`
  // shows the language notes; `endings` the honest product endings;
  // `structures` the playbook's structures per account.
  writing_standards: z.record(z.string(), z.object({
    label: z.string(), names: z.array(z.string()).default([]),
    review: z.boolean().default(false), lint: z.boolean().default(false), endings: z.boolean().default(false), structures: z.boolean().default(false),
    // The ICP's pain points (the line bank's tags, UX-PLAN section 36, 29c).
    pains: z.array(z.string()).default([]),
    // The owner's own product rules: only the owner's account can pick,
    // load or be given them; any other account reads them as none.
    owner_only: z.boolean().default(false),
  })).default({}),
  // The line bank (UX-PLAN section 36, item 29): the free first pass's word
  // lists, the tags, the batch sizes and the reviewer's bar.
  line_bank: z.object({
    min_likes: z.number().int().min(0).default(2),
    min_words: z.number().int().min(1).default(4),
    max_words: z.number().int().min(4).max(30).default(12),
    pass_score: z.number().int().min(1).max(10).default(8),
    tag_batch: z.number().int().min(5).max(100).default(30),
    examples: z.number().int().min(0).max(20).default(8),
    emotions: z.array(z.string()).min(1),
    topics: z.array(z.string()).min(1),
    formats: z.array(z.string()).min(1),
    fits: z.array(z.object({ id: z.enum(['first', 'secondhand', 'both']), label: z.string() })).length(3),
    topic_words: z.array(z.string()).min(1),
    video_words: z.array(z.string()).default([]),
    foreign_words: z.array(z.string()).default([]),
    english_words: z.array(z.string()).min(1),
    first_person_words: z.array(z.string()).default([]),
  }),
  // Weeks (UX-PLAN section 37): the fill rules, blends and Drive layout.
  weeks: z.object({
    rules: z.object({ pain_window: z.number().int().min(0).max(50).default(7), max_run: z.number().int().min(1).max(10).default(2) }).default({ pain_window: 7, max_run: 2 }),
    blend_defaults: z.record(z.string(), z.number().min(0).max(100)).default({}),
    blend_fallback: z.number().min(0).max(100).default(50),
    slots_per_day: z.number().int().min(1).max(24).default(3),
    platforms: z.array(z.string()).min(1).default(['tiktok', 'instagram', 'youtube']),
    near_duplicate: z.number().min(0.5).max(1).default(0.8),
    ai_label: z.string().default('AI-generated'),
    settings: z.array(z.string()).default([]),
    place_themes: z.array(z.object({ id: z.string().min(1), line: z.array(z.string()).default([]), place: z.array(z.string()).default([]) })).default([]),
    drive: z.object({ week_folder: z.string().default('week of {date}'), manifest: z.string().default('manifest {date}') }).default({ week_folder: 'week of {date}', manifest: 'manifest {date}' }),
  }).prefault({}),
  // The language lint's word lists (section 28; the checks are rules), for
  // the writing standards with lint on.
  copy_lint: z.object({ values: z.array(z.string()), hype: z.array(z.string()), products: z.array(z.string()), max_hashtags: z.number().int().min(0).max(30), hook_max_words: z.number().int().min(4).max(40).default(22), hook_labels: z.array(z.string()).default([]), job_words: z.array(z.string()).default([]), ending_never: z.array(z.string()).default([]), setup_openers: z.array(z.string()).optional(), emotion_words: z.array(z.string()).optional() })
    .default({ values: ['should', 'need to', 'needs to', 'must', 'ought'], hype: ['dream job', 'unlock', 'level up', 'game-changer', 'game changer', 'supercharge'], products: [], max_hashtags: 5, hook_max_words: 22, hook_labels: ['Exhibit', 'Levels of', 'Previously on', 'Calendar invite'], job_words: [], ending_never: [] }),
  // Results (section 32): the decision hints' thresholds, data not code.
  results: z.object({ variations_views: z.number().int().positive(), variations_count: z.number().int().min(1).max(10), drop_views: z.number().int().positive(), drop_posts: z.number().int().min(1).max(10) })
    .default({ variations_views: 50000, variations_count: 3, drop_views: 1000, drop_posts: 2 }),
  // Download day (section 33): each plan slot's clock time (HH:MM).
  posting: z.object({ slot_times: z.record(z.string(), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)) }).default({ slot_times: { AM: '09:00', Daily: '12:00', PM: '18:00' } }),
  batch: z.object({ max: z.number().int().positive(), default_count: z.number().int().positive(), zip_part_mb: z.number().positive().default(150) }),
  clone: z.object({
    mode: z.enum(['replace', 'motion']).default('replace'),
    model: z.string(),
    account_model: z.string(),
    motion_model: z.string(),
    outfit: z.enum(['source', 'hers']).default('source'),
    face_refs: z.array(z.string()).min(1).default(['REF-00', 'REF-01', 'REF-02']),
    // Mass recreate (item 24): the model that fetches a TikTok link.
    mass: z.object({ fetch_model: z.string() }).default({ fetch_model: 'apify/tiktok-video' }),
    scene_still: z.object({ model: z.string(), api_model: z.string(), fallback_model: z.string().optional(), fallback_note: z.string().default('') }),
    // Recreate from a real clip (owner, 2026-10-14).
    recreate: z.object({
      frame_at: z.number().min(0).max(5), takes: z.number().int().min(1).max(4), face_takes: z.number().int().min(1).max(4), face_pass: z.boolean().default(true), dark_luma: z.number(), busy_motion: z.number(),
      gate: z.object({ face_min: z.number().min(0).max(1), margin: z.number().min(0).max(1).default(0.12), source_max: z.number().min(0).max(1) }).default({ face_min: 0.45, margin: 0.12, source_max: 0.45 }),
      face_skip_margin: z.number().min(0).max(1).default(0.3),
      resolution: z.string().default('720p'),
      review_step: z.number().positive().default(0.5), ocr_step: z.number().positive().default(1), cut_threshold: z.number().min(0).max(1).default(0.35),
      batch_max: z.number().int().min(1).max(50).default(20),
      credit_usd: z.number().positive().default(0.0625),
    })
      .default({ frame_at: 0.2, takes: 4, face_takes: 2, face_pass: true, dark_luma: 70, busy_motion: 14, gate: { face_min: 0.45, margin: 0.12, source_max: 0.45 }, face_skip_margin: 0.3, resolution: '720p', review_step: 0.5, ocr_step: 1, cut_threshold: 0.35, batch_max: 20, credit_usd: 0.0625 }),
    models: z.array(z.object({ ref: z.string(), resolution: z.string().optional() })).min(1),
    min_seconds: z.number().positive(),
    max_seconds: z.number().positive(),
    max_upload_mb: z.number().positive(),
    max_characters: z.number().int().positive(),
    keep_sound: z.boolean(),
    // Clean the clip before cloning (overnight item 3): trim TikTok's end
    // card, blur out burned-in captions and the handle watermark.
    cleanup: z.boolean().default(true),
  }),
  chain: z.object({ max_parts: z.number().int().min(2), max_seconds: z.number().positive(), step_back_sec: z.number().min(0), max_seam_diff: z.number().positive() }),
  sound: z.object({
    target_lufs: z.number(), true_peak: z.number(), ambience_only_lufs: z.number(), ambience_lufs: z.number(), music_lufs: z.number(),
    levels: z.object({ quiet: z.number(), normal: z.number(), loud: z.number() }),
    duck: z.object({ threshold: z.number().positive(), ratio: z.number().min(1), attack_ms: z.number().positive(), release_ms: z.number().positive() }),
    default_ambience: z.enum(['none', 'room']),
    max_upload_mb: z.number().positive(),
    max_seconds: z.number().positive(),
    // Voice lines (overnight item 4): the converted line's level before the
    // mix, the model, the longest take, and how captions break into phrases.
    voice: z.object({
      model: z.string(), lufs: z.number(), max_seconds: z.number().positive(), max_takes: z.number().int().positive(),
      phrases: z.object({ max_words: z.number().int().positive(), max_sec: z.number().positive(), pause_sec: z.number().positive(), hold_sec: z.number().min(0) }),
    }),
  }),
  cut: z.object({ max_seconds: z.number().positive(), max_shots: z.number().int().positive(), max_captions: z.number().int().positive() }),
  export_presets: z.array(z.object({ id: z.string(), label: z.string(), max_seconds: z.number().positive(), video_kbps: z.number().int().positive(), lufs: z.number().max(0), true_peak: z.number().max(0) })).min(1).default([{ id: 'tiktok', label: 'TikTok', max_seconds: 90, video_kbps: 12000, lufs: -14, true_peak: -1 }]),
  hook_variants: z.object({ max: z.number().int().min(1).max(5), seconds: z.number().positive().max(10) }).default({ max: 3, seconds: 2 }),
  cover: z.object({ quality: z.number().int().min(50).max(100) }).default({ quality: 90 }),
})

// Amazing Edits (Phase 5; config/edits.yaml): code-rendered edits.
const strength = z.record(z.string(), z.number())
export const EDIT_IDS = ['crash_zoom', 'speed_ramp', 'punch_in', 'freeze_pop', 'flash_shake', 'seamless_loop', 'word_pop', 'whip_pan', 'hand_lens', 'zoom_reveal',
  'velocity', 'text_behind', 'karaoke', 'split_screen', 'green_screen', 'glitch', 'spin', 'dolly_zoom', 'record_scratch', 'snap_zoom'] as const
// Where an edit sits when edits are stacked (applied in this order).
export const EDIT_STAGES = ['layout', 'transition', 'camera', 'hit', 'time', 'loop', 'text'] as const
const editsSchema = z.object({
  version: z.number(),
  payoff_from_end: z.number().positive(),
  closeup: z.object({ share: z.number().min(0.15).max(1) }).default({ share: 0.42 }),
  styles: z.array(z.object({
    id: z.enum(EDIT_IDS),
    label: z.string(),
    line: z.string(),
    shots: z.union([z.literal(1), z.literal(2)]),
    anchor: z.enum(['cut', 'payoff', 'beats', 'cut_or_payoff', 'end', 'words', 'start']),
    slots: z.object({ a: z.string(), b: z.string() }).optional(),
    params: z.object({ subtle: strength, normal: strength, strong: strength }),
    stage: z.enum(EDIT_STAGES),
    // What the edit needs besides the clip: her outline (made on the
    // worker) or a background (the post's B-roll).
    needs: z.array(z.enum(['mask', 'background'])).default([]),
    // A layout choice, the first is the default.
    variants: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
    // Default text (the record scratch's line).
    text: z.string().optional(),
    // The editor preset the Idea step's Format places on first open (G29).
    preset: z.string().nullable().default(null),
  })).min(1),
})

// The editor's preset library (config/presets.yaml, copied from the
// OpenReel fork by npm run presets:sync): what the worker needs to render a
// preset the editor placed (editor phase D).
const cameraKeySchema = z.object({
  t: z.number().min(0).max(1),
  scale: z.number().optional(), x: z.number().optional(), y: z.number().optional(), rotation: z.number().optional(),
  blur: z.number().optional(), motionBlur: z.number().optional(), rgb: z.number().optional(), flash: z.number().optional(),
  dark: z.number().optional(), shake: z.number().optional(), saturation: z.number().optional(), brightness: z.number().optional(),
  vignette: z.number().optional(),
  ease: z.enum(['linear', 'in', 'out', 'inOut', 'inExpo', 'outExpo', 'outBack', 'hold']).optional(),
})
const presetsSchema = z.object({
  source: z.object({ repo: z.string(), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  presets: z.array(z.object({
    id: z.string().regex(/^[a-z_]{2,40}$/),
    label: z.string(),
    kind: z.enum(['camera', 'time', 'text', 'caption', 'layout']),
    category: z.string(),
    anchor: z.enum(['playhead', 'cut']),
    // Text, caption and layout presets have no block (0).
    duration: z.number().nonnegative(),
    keys: z.array(cameraKeySchema).optional(),
  })).min(1),
})

export const pipelineSchemas = {
  sheet: sheetSchema,
  views: viewsSchema,
  rules: rulesSchema,
  templates: templatesSchema,
  review: reviewSchema,
  scenes: scenesSchema,
  content: contentSchema,
  edits: editsSchema,
  presets: presetsSchema,
  wording: wordingSchema,
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
export type EditsConfig = z.infer<typeof editsSchema>
export type EditId = (typeof EDIT_IDS)[number]
export type PresetsConfig = z.infer<typeof presetsSchema>
export type PresetConfig = PresetsConfig['presets'][number]
export type WordingConfig = z.infer<typeof wordingSchema>

export interface PipelineConfig {
  sheet: SheetConfig
  views: ViewsConfig
  rules: RulesConfig
  templates: TemplatesConfig
  review: ReviewConfig
  scenes: ScenesConfig
  content: ContentConfig
  edits: EditsConfig
  presets: PresetsConfig
  wording: WordingConfig
}
