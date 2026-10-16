import { z } from 'zod'
import { CTA_IDS, PATTERN_IDS, SPECIAL_IDS, TEXT_STYLE_IDS } from './slides.js'

// A slideshow post's spec (UX-PLAN.md sections 5 and 27). The slides run in
// parallel lists by slide number: slide 1 is the hook, then `slides`; each
// slide's picture is `stillIds[i]` (an empty string is a slide with no
// picture yet) or `specials[i]`; `shots[i]` is what its photo shows inside
// the locked scene; `textPos[i]` is where its words were dragged. Every
// field has a default, so a slideshow made before section 27 reads as it
// did (its stills repeat when there are fewer of them than slides).

const id = z.string().max(60)
const str = (max: number) => z.string().max(max).default('')

export const slidePosSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })

export const specialSchema = z.object({
  type: z.enum(SPECIAL_IDS),
  from: str(80),
  title: str(200),
  body: str(600),
  lines: z.array(z.string().max(300)).max(12).default([]),
  time: str(40),
})

export const hookIdeaSchema = z.object({ text: z.string().max(200), pattern: z.enum(PATTERN_IDS), source: z.enum(['vault', 'claude', 'typed']).default('vault') })

// The locked scene: one place, light and phone for every slide, so the set
// reads like one camera roll. Empty fields fall back to the post's scene
// (character) or are left out (topic). Light and camera are preset ids
// from config/scenes.yaml (or empty); place, outfit and details are words.
export const sceneLockSchema = z.object({
  place: str(300),
  light: str(40),
  camera: str(40),
  phone: z.enum(['', 'front', 'rear']).default(''),
  outfit: str(300),
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
  pattern: z.enum(PATTERN_IDS).nullable().default(null),
  // How many slides a draft makes (6 by default).
  slideCount: z.number().int().min(3).max(10).default(6),
  productId: id.nullable().default(null),
  // Who is in the photos: the character, or no one (a topic account).
  mode: z.enum(['character', 'topic']).default('character'),
  lock: sceneLockSchema,
  // The shape the stills are made in: TikTok 9:16 or Instagram 3:4.
  made: z.enum(['tiktok', 'instagram']).default('tiktok'),
  shots: z.array(z.string().max(300)).max(12).default([]),
  specials: z.array(specialSchema.nullable()).max(12).default([]),
  textStyle: z.enum(TEXT_STYLE_IDS).default('classic'),
  textPos: z.array(slidePosSchema.nullable()).max(12).default([]),
  // The last slide's CTA: a kind ("own": the last slide as written), the
  // handle typed, the comment word.
  cta: z.object({ kind: z.enum(CTA_IDS).default('own'), handle: str(40), word: str(30) }).prefault({}),
  ad: z.boolean().default(false),
  // The stills model picked last for this post (null: the account's pick).
  stillModel: z.string().max(80).nullable().default(null),
  // A batch (the parent post): the pasted hooks, one slideshow each.
  batchHooks: z.array(z.string().max(200)).max(10).default([]),
  // A batch's slideshow: what the review decided.
  review: z.enum(['pending', 'approved', 'rejected']).nullable().default(null),
})
export type SlideshowSpec = z.infer<typeof slideshowSpecSchema>
export type SpecialSlideSpec = z.infer<typeof specialSchema>
