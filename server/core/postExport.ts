import { patternLabel, type HookPattern } from './slides.js'

// post.json (UX-PLAN.md section 27): every field of an exported slideshow,
// one file per post in its zip. The posting engine's format is coming
// later; this module is the only place that maps the Studio's fields to
// the file's, so changing the format means changing this file only.

export const POST_EXPORT_VERSION = 1

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
    stillId: string | null; special: { type: string; from: string; title: string; body: string; lines: string[]; time: string } | null
    position: { x: number; y: number } | null
    files: { tiktok: string; instagram: string }
  }>
  files: { caption: string; tiktok: string[]; instagram: string[] }
  sizes: { tiktok: { width: number; height: number }; instagram: { width: number; height: number } }
  aiLabel: string
  exportedAt: string
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
      // What to paste: #ad first on an ad, then the caption and hashtags.
      as_posted: s.postCaption,
      file: i.files.caption,
    },
    slides: i.slides.map(x => ({
      number: x.index + 1,
      text: x.text,
      shot: x.shot || null,
      picture: x.picture,
      still_id: x.stillId,
      special: x.special,
      text_position: x.position,
      files: x.files,
    })),
    files: { tiktok: i.files.tiktok, instagram: i.files.instagram, caption: i.files.caption },
    sizes: i.sizes,
    ai_label: i.aiLabel,
  }
}
