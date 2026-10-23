import { z } from 'zod'

// What a post keeps from its plan row, or from the hook it was drafted
// from (structure, effects, moment, alt hook, score): shown on the post
// and written into post.json. Every field has a default, so older posts
// read as having none.
const s = (max: number) => z.string().max(max).default('')
export const planMetaSchema = z.object({
  // The plan import: its row, which import, the day and slot.
  rowId: s(20), planId: s(40), date: s(10), slot: s(12), format: s(40),
  tension: s(12), pillar: s(12), audience: s(12),
  product: z.boolean().default(false), mentionMother: z.boolean().default(false),
  // The playbook fields (also set by Use this hook).
  structure: z.string().max(4).nullable().default(null),
  effectOpen: z.string().max(3).nullable().default(null),
  effectPayoff: z.string().max(3).nullable().default(null),
  hookScore: z.number().int().min(1).max(5).nullable().default(null),
  momentId: s(30), moment: s(800), altHook: s(200),
  // The row's words kept as written: the scene, the clip's action, the
  // CTA line, the stat's source and the notes; a video post's caption and
  // hashtags (a slideshow keeps them in its own fields).
  scene: s(4000), clipAction: s(2000), cta: s(300), statSource: s(200), notes: s(1500),
  caption: s(2200), hashtags: z.array(z.string().max(60)).max(15).default([]),
  // Weeks (UX-PLAN.md section 37): the plan CSV's own columns (spec v1),
  // and the Line Engine fields (item 19), kept on the post and in post.json.
  week: s(10), postType: s(12), deviceId: s(60), lifeOrJob: s(4), voiceFit: s(10), storyBeat: s(800), lineId: s(40),
  placeId: s(60), videoPrompt: s(2000), soundName: s(200), soundType: s(20), voiceoverClip: s(200),
  lane: s(60), lineFormat: s(60), feeling: s(60), topic: s(60),
}).prefault({})
export type PlanMeta = z.infer<typeof planMetaSchema>
export const hasPlan = (p: Partial<PlanMeta> | null | undefined) => !!p && !!(p.rowId || p.structure || p.moment || p.altHook)
