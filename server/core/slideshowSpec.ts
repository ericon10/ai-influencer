import { z } from 'zod'
import { CTA_IDS, PATTERN_IDS, SPECIAL_IDS, TEXT_STYLE_IDS } from './slides.js'
import { EFFECT_CODES, STRUCTURE_CODES } from './playbook.js'
import { planMetaSchema } from './planMeta.js'
import { resultsSchema } from './results.js'
import { postingSchema } from './postingDay.js'

// A slideshow post's spec (UX-PLAN.md sections 5 and 27). The slides run in
// parallel lists by slide number: slide 1 is the hook, then `slides`; each
// slide's picture is `stillIds[i]` (an empty string is a slide with no
// picture yet) or `specials[i]`; `shots[i]` is what its photo shows inside
// the locked scene; `textPos[i]` is where its words were dragged. Every
// field has a default, so a slideshow made before section 27 reads as it
// did (its stills repeat when there are fewer of them than slides).

const id = z.string().max(60)
const str = (max: number) => z.string().max(max).default('')

// A slide's words: where they sit, who put them there (a drag by the owner
// sticks; R1's auto-place moves only its own) and a size step when the
// words had to shrink to miss a face (item 8).
export const slidePosSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), by: z.enum(['owner', 'auto']).optional(), scale: z.number().min(0.5).max(1).optional() })

export const specialSchema = z.object({
  type: z.enum(SPECIAL_IDS),
  from: str(80),
  title: str(200),
  body: str(600),
  lines: z.array(z.string().max(300)).max(12).default([]),
  time: str(40),
  // Section 28: a form's empty or filled state, an invoice or a receipt;
  // a form's field count or a survey's picked score; blurred amounts; the
  // uploaded product screenshot and its size on the slide.
  variant: str(20),
  count: z.number().int().min(-1).max(200).default(0),
  blur: z.boolean().default(false),
  assetId: id.nullable().default(null),
  scale: z.number().min(0.2).max(1).default(0.72),
  // The screenshot's width over its height (its box on the slide).
  ratio: z.number().min(0.1).max(10).default(0.5),
})

// A hook offered in the Idea step. From the vault: its pattern. From
// Claude (section 28, the playbook way): the moment, the structure or lens
// code, the effects, the alt hook (the runner-up), the writer's own rank
// and the reviewer's score and note (only a 1 or 2 is shown).
export const hookIdeaSchema = z.object({
  text: z.string().max(200), pattern: z.enum(PATTERN_IDS), source: z.enum(['vault', 'claude', 'typed']).default('vault'),
  code: z.enum(STRUCTURE_CODES).nullable().default(null),
  effectOpen: z.enum(EFFECT_CODES).nullable().default(null),
  effectPayoff: z.enum(EFFECT_CODES).nullable().default(null),
  moment: z.string().max(400).default(''),
  alt: z.string().max(200).default(''),
  selfScore: z.number().int().min(1).max(5).nullable().default(null),
  score: z.number().int().min(1).max(5).nullable().default(null),
  note: z.string().max(300).default(''),
  reviewed: z.boolean().default(false),
  // The reviewer's stop test (THE STANDARD v1.2, five checks): pain 1 to
  // 10, whether it passed, and the checks it failed (stops, job, exact,
  // pain, friend).
  pain: z.number().int().min(1).max(10).nullable().default(null),
  stops: z.boolean().nullable().default(null),
  fails: z.array(z.enum(['stops', 'job', 'exact', 'pain', 'friend'])).max(5).default([]),
})

// The locked scene: one place, light and phone for every slide, so the set
// reads like one camera roll. Empty fields fall back to the post's scene
// (character) or are left out (topic). Light and camera are preset ids
// from config/scenes.yaml (or empty); place, outfit and details are words.
export const sceneLockSchema = z.object({
  place: str(1000),
  light: str(40),
  camera: str(40),
  phone: z.enum(['', 'front', 'rear']).default(''),
  outfit: str(300),
  // The hair styling for every photo (a plan row's "Hair:"), else the
  // post's own scene.
  hair: str(200),
  details: z.array(z.string().max(160)).max(2).default([]),
  // The saved scene this came from (Scene library), and its look picture.
  savedId: id.nullable().default(null),
  lookAssetId: id.nullable().default(null),
  // Fields the owner typed: the draft never replaces them.
  ownerSet: z.array(z.string().max(20)).max(8).default([]),
}).prefault({})
export type SceneLock = z.infer<typeof sceneLockSchema>

export const slideshowSpecSchema = z.object({
  stillIds: z.array(id).max(20).default([]),
  topic: z.string().max(400).default(''),
  hook: z.string().max(200).default(''),
  slides: z.array(z.string().max(300)).max(11).default([]),
  caption: z.string().max(2200).default(''),
  hashtags: z.array(z.string().max(60)).max(15).default([]),
  // Section 27. The hooks offered ("Write 10 hooks") and the one picked.
  hookIdeas: z.array(hookIdeaSchema).max(40).default([]),
  // Write 10 with Claude's reviewer (section 28): scoring, done or failed.
  hookReview: z.enum(['pending', 'done', 'failed']).nullable().default(null),
  pattern: z.enum(PATTERN_IDS).nullable().default(null),
  // How many slides a draft makes (6 by default).
  slideCount: z.number().int().min(3).max(10).default(6),
  // (The post's product is the post's own, content_items.product_id, for
  // every kind of post: UX-PLAN.md section 29.)
  // Who is in the photos: the character, or no one (a topic account).
  mode: z.enum(['character', 'topic']).default('character'),
  lock: sceneLockSchema,
  // The shape the stills are made in: TikTok 9:16 or Instagram 3:4.
  made: z.enum(['tiktok', 'instagram']).default('tiktok'),
  shots: z.array(z.string().max(800)).max(12).default([]),
  // A slide whose shot is its own image line (a plan's slide_N_image or
  // "Slide N:"; item 13): sent as written with only the Studio's fixed
  // lines. Kept with its slide when slides move.
  asWritten: z.array(z.boolean()).max(12).default([]),
  // Each character slide's framing from the mix (config slideshow
  // framing_mix; '' takes the mix in turn; item 12).
  framings: z.array(z.string().max(40)).max(12).default([]),
  specials: z.array(specialSchema.nullable()).max(12).default([]),
  textStyle: z.enum(TEXT_STYLE_IDS).default('classic'),
  textPos: z.array(slidePosSchema.nullable()).max(12).default([]),
  // The last slide's CTA: a kind ("own": the last slide as written), the
  // handle typed, the comment word.
  cta: z.object({ kind: z.enum(CTA_IDS).default('own'), handle: str(40), word: str(30) }).prefault({}),
  ad: z.boolean().default(false),
  // The stills model picked last for this post (before section 30; read as
  // its path: Nano Banana 2.1 the plan, GPT Image 2.5 Flare the API).
  stillModel: z.string().max(80).nullable().default(null),
  // Section 30. The path picked last for this post's stills (null: the
  // account's pick): Your Higgsfield plan (credits) or the Higgsfield API.
  stillPath: z.enum(['account', 'api']).nullable().default(null),
  // Who each slide's photo shows, picked on the slide card ('' reads it
  // from the shot: a thing or a place is no one).
  people: z.array(z.enum(['', 'character', 'none'])).max(12).default([]),
  // A batch (the parent post): the pasted hooks, one slideshow each.
  batchHooks: z.array(z.string().max(200)).max(10).default([]),
  // A batch's slideshow: what the review decided.
  review: z.enum(['pending', 'approved', 'rejected']).nullable().default(null),
  // Section 28. The CTA line (a question, a warm offer or a shrug), added
  // after the caption in "As posted" when it is not already in it; and
  // what the post keeps from its plan row or its hook (post.json).
  ctaLine: str(300),
  plan: planMetaSchema,
  // THE STANDARD v1.2. The honest SideStep ending the draft used on a
  // product post (its pain), or "none" when the hook's pain is not one
  // SideStep fixes (then there is no product mention and no Ad label).
  productEnding: z.string().max(200).nullable().default(null),
  // Slideshows are TikTok only: the export makes 1080 x 1920; the
  // 1080 x 1440 set is an option, off by default.
  instagramSet: z.boolean().default(false),
  // Section 32: what the post did once posted (typed on its card or pasted
  // from a CSV). Never copied to a variation or Make another like this.
  results: resultsSchema.nullable().default(null),
  // Section 33: Approve for posting, its own day and slot, the Download day
  // zip it went into. Never copied.
  posting: postingSchema.nullable().default(null),
})
export type SlideshowSpec = z.infer<typeof slideshowSpecSchema>
export type SpecialSlideSpec = z.infer<typeof specialSchema>
