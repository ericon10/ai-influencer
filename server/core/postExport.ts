import { patternLabel, type HookPattern } from './slides.js'
import { effectName, structureName } from './playbook.js'
import type { PlanMeta } from './planMeta.js'
import { hasResults, type PostResults } from './results.js'

// post.json (UX-PLAN.md section 27): every field of an exported slideshow,
// one file per post in its zip. The posting engine's format is coming
// later; this module is the only place that maps the Studio's fields to
// the file's, so changing the format means changing this file only.

// Version 2 (section 28): the plan's fields, the CTA line, and a post.json
// for video posts too. Section 32 adds `results` (null until typed) and
// section 33 adds `posting` (only in a Download day pack); both are new
// keys, so version 2 readers keep working.
export const POST_EXPORT_VERSION = 2

export interface PostExportInput {
  post: {
    id: string; kind: string; title: string; idea: string; accountTag: string
    characterId: string | null; characterName: string | null
    variationOf: string | null; batchOf: string | null
    createdAt: string; updatedAt: string
  }
  slideshow: {
    mode: 'character' | 'topic'; pattern: HookPattern | null; hook: string
    textStyle: string; made: 'tiktok' | 'instagram'
    caption: string; postCaption: string; hashtags: string[]; ad: boolean
    cta: { kind: string; handle: string; word: string; text: string | null }
    scene: { place: string; light: string; camera: string; phone: string; outfit: string; details: string[]; savedId: string | null }
  }
  slides: Array<{
    index: number; text: string; shot: string
    picture: 'still' | 'special' | 'none'
    stillId: string | null
    special: { type: string; from: string; title: string; body: string; lines: string[]; time: string; variant?: string; count?: number; blur?: boolean; assetId?: string | null; scale?: number; ratio?: number } | null
    position: { x: number; y: number } | null
    files: { tiktok: string; instagram: string | null }
  }>
  files: { caption: string; tiktok: string[]; instagram: string[] }
  sizes: { tiktok: { width: number; height: number }; instagram?: { width: number; height: number } }
  aiLabel: string
  exportedAt: string
  // What the post keeps from its plan row or its hook (section 28).
  plan?: PlanMeta | null
  ctaLine?: string
  // What the post did once posted (section 32).
  results?: PostResults | null
}

// The plan's fields as the plan's CSV names them (section 28).
export function planJson(p: PlanMeta | null | undefined): Record<string, unknown> | null {
  if (!p || !(p.rowId || p.structure || p.moment || p.altHook)) return null
  return {
    row_id: p.rowId || null, plan_id: p.planId || null, date: p.date || null, slot: p.slot || null, format: p.format || null,
    tension: p.tension || null, pillar: p.pillar || null, audience: p.audience || null,
    product: p.product, mention_mother: p.mentionMother,
    structure: p.structure ? { code: p.structure, name: structureName(p.structure) } : null,
    effect_open: p.effectOpen ? { code: p.effectOpen, name: effectName(p.effectOpen) } : null,
    effect_payoff: p.effectPayoff ? { code: p.effectPayoff, name: effectName(p.effectPayoff) } : null,
    hook_score: p.hookScore, moment_id: p.momentId || null, moment: p.moment || null, alt_hook: p.altHook || null,
    scene: p.scene || null, clip_action: p.clipAction || null, cta: p.cta || null, stat_source: p.statSource || null, notes: p.notes || null,
    // The sound to add in the app (section 42 D).
    sound_name: (p as { soundName?: string }).soundName || null, sound_type: (p as { soundType?: string }).soundType || null,
  }
}

// The results as the results CSV names them (section 32): null until any
// field is typed. The numbers are the first 72 hours.
export function resultsJson(r: PostResults | null | undefined): Record<string, unknown> | null {
  if (!r || !(hasResults(r) || r.postUrl || r.postedAt || r.decision || r.notes)) return null
  return {
    post_url: r.postUrl || null, posted_at: r.postedAt || null,
    views_72h: r.views72h, follows_72h: r.follows72h, saves_72h: r.saves72h, shares_72h: r.shares72h,
    decision: r.decision, notes: r.notes || null, updated_at: r.updatedAt,
  }
}

// A special slide in post.json: its words, and for a product screenshot
// the uploaded asset and where it sits.
function specialJson(sp: PostExportInput['slides'][number]['special']) {
  if (!sp) return null
  const { type, from, title, body, lines, time } = sp
  if (type === 'product_shot') return { type, asset_id: sp.assetId ?? null, width: sp.scale ?? null, position: sp.variant === 'top' ? 'top' : 'middle' }
  return { type, from, title, body, lines, time, ...(sp.variant ? { variant: sp.variant } : {}), ...(type === 'survey' ? { score: sp.count != null && sp.count >= 0 ? sp.count : null } : sp.count ? { count: sp.count } : {}), ...(sp.blur ? { blur: true } : {}) }
}

export function postExportJson(i: PostExportInput): Record<string, unknown> {
  const s = i.slideshow
  return {
    format: 'character-studio.post',
    version: POST_EXPORT_VERSION,
    exported_at: i.exportedAt,
    post: {
      id: i.post.id,
      kind: i.post.kind,
      title: i.post.title,
      idea: i.post.idea,
      account: i.post.accountTag || null,
      character: i.post.characterId ? { id: i.post.characterId, name: i.post.characterName } : null,
      variation_of: i.post.variationOf,
      batch_of: i.post.batchOf,
      created_at: i.post.createdAt,
      updated_at: i.post.updatedAt,
    },
    slideshow: {
      photos_of: s.mode,
      hook: s.hook,
      hook_pattern: s.pattern ? { id: s.pattern, label: patternLabel(s.pattern) } : null,
      text_style: s.textStyle,
      made_for: s.made,
      scene: { place: s.scene.place, light: s.scene.light, camera: s.scene.camera, phone: s.scene.phone, outfit: s.scene.outfit, details: s.scene.details, saved_scene_id: s.scene.savedId },
      cta: { kind: s.cta.kind, handle: s.cta.handle || null, word: s.cta.word || null, text: s.cta.text },
    },
    caption: {
      text: s.caption,
      hashtags: s.hashtags,
      ad: s.ad,
      cta_line: i.ctaLine || null,
      // What to paste: "Ad:" first on an ad, then the caption, the CTA line
      // and the hashtags.
      as_posted: s.postCaption,
      file: i.files.caption,
    },
    plan: planJson(i.plan),
    results: resultsJson(i.results),
    slides: i.slides.map(x => ({
      number: x.index + 1,
      text: x.text,
      shot: x.shot || null,
      picture: x.picture,
      still_id: x.stillId,
      special: specialJson(x.special),
      text_position: x.position,
      files: x.files,
    })),
    files: { tiktok: i.files.tiktok, instagram: i.files.instagram, caption: i.files.caption },
    sizes: i.sizes,
    ai_label: i.aiLabel,
  }
}

// A video post's post.json (section 28): the post, the words on the video,
// the caption to post with its hashtags and CTA line, and the plan.
export interface VideoExportInput {
  post: PostExportInput['post']
  video: { file: string; assetId: string; durationSec: number | null; onScreenText: string; captionOff: boolean }
  caption: { text: string; hashtags: string[]; ctaLine: string; ad: boolean; asPosted: string }
  plan: PlanMeta | null
  aiLabel: string
  exportedAt: string
  results?: PostResults | null
  // A sound to add in the app (a faceless post's music and voiceover words).
  sound?: { music: string; voiceover: string; type?: string } | null
}
export function videoPostExportJson(i: VideoExportInput): Record<string, unknown> {
  return {
    format: 'character-studio.post',
    version: POST_EXPORT_VERSION,
    exported_at: i.exportedAt,
    post: {
      id: i.post.id, kind: i.post.kind, title: i.post.title, idea: i.post.idea, account: i.post.accountTag || null,
      character: i.post.characterId ? { id: i.post.characterId, name: i.post.characterName } : null,
      variation_of: i.post.variationOf, batch_of: i.post.batchOf, created_at: i.post.createdAt, updated_at: i.post.updatedAt,
    },
    video: { file: i.video.file, asset_id: i.video.assetId, duration_sec: i.video.durationSec, on_screen_text: i.video.captionOff ? null : i.video.onScreenText || null },
    caption: { text: i.caption.text, hashtags: i.caption.hashtags, ad: i.caption.ad, cta_line: i.caption.ctaLine || null, as_posted: i.caption.asPosted },
    plan: planJson(i.plan),
    results: resultsJson(i.results),
    ...(i.sound ? { sound_to_add: { music: i.sound.music || null, sound_type: i.sound.type || null, voiceover_search: i.sound.voiceover || null, note: 'Add this sound in the app.' } } : {}),
    ai_label: i.aiLabel,
  }
}
