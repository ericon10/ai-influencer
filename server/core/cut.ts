import { z } from 'zod'
import { voiceCaptions, type PhraseOptions, type Word } from './voiceLines.js'

// The rough cut (Phase 3): a video post as one timeline. Shots are clips
// and B-roll, each trimmed, joined with hard cuts in order; captions are
// text laid over the picture for a time. Built automatically from the
// post's steps (its clip, its B-roll before or after, its caption over the
// whole video) until the owner edits it in the Finish step; then the
// owner's cut is kept, and Rebuild returns to the automatic one. Export
// renders exactly this, and Fine-tune (Phase 4) opens the same layers.

const id = z.string().max(60)

export const cutShotSchema = z.object({
  id: z.string().max(40),
  kind: z.enum(['clip', 'broll']),
  ref: id,
  in: z.number().min(0).max(600).default(0),
  out: z.number().min(0).max(600).nullable().default(null),
})

// A caption with no text of its own shows the post's caption (the Caption
// step), so typing there still changes an edited cut.
export const cutCaptionSchema = z.object({
  id: z.string().max(40),
  text: z.string().max(400).nullable().default(null),
  start: z.number().min(0).max(600).default(0),
  end: z.number().min(0).max(600).nullable().default(null),
  // A caption made from a voice line knows when each word is said (the
  // karaoke edit lights them in time).
  words: z.array(z.object({ text: z.string().max(80), start: z.number().min(0).max(700), end: z.number().min(0).max(700) })).max(200).optional(),
})

export const cutSchema = z.object({
  auto: z.boolean().default(false),
  shots: z.array(cutShotSchema).max(24).default([]),
  captions: z.array(cutCaptionSchema).max(16).default([]),
})

export type CutShot = z.infer<typeof cutShotSchema>
export type CutCaption = z.infer<typeof cutCaptionSchema>
export type Cut = z.infer<typeof cutSchema>

export interface CutSource {
  clipId: string | null
  // Shot B of a two-shot edit (Phase 5), right after the clip.
  clipB?: string | null
  brollId: string | null
  order: 'clip_first' | 'broll_first'
  brollStart: number
  brollSeconds: number
  cut?: Cut | null
  // A voiceover (a converted voice line) with "Captions from the voice
  // line" on: its phrases are the captions, timed by its words.
  sound?: { voice?: { at: number; captions: boolean; words: Word[] } | null }
  // No caption on this post (owner, 2026-10-15): no caption in the cut, the
  // editor or any export. The typed words are kept for switching back.
  captionOff?: boolean
}

// The automatic cut: the clip (in full), the B-roll cut in hard before or
// after it, and the caption over the whole video.
export function autoCut(s: Omit<CutSource, 'cut'>, maxBrollSeconds = 20): Cut {
  const clip: CutShot | null = s.clipId ? { id: 'clip', kind: 'clip', ref: s.clipId, in: 0, out: null } : null
  const broll: CutShot | null = s.brollId
    ? { id: 'broll', kind: 'broll', ref: s.brollId, in: s.brollStart, out: s.brollStart + Math.min(s.brollSeconds, maxBrollSeconds) }
    : null
  const clipB: CutShot | null = s.clipId && s.clipB ? { id: 'clipB', kind: 'clip', ref: s.clipB, in: 0, out: null } : null
  const shots = (s.order === 'broll_first' ? [broll, clip, clipB] : [clip, clipB, broll]).filter((x): x is CutShot => !!x)
  return { auto: true, shots, captions: [{ id: 'main', text: null, start: 0, end: null }] }
}

// The cut a render uses: the owner's when edited, else the automatic one;
// with a voiceover's captions in place of the text captions when asked.
export function effectiveCut(s: CutSource, maxBrollSeconds = 20, phrases?: PhraseOptions & { holdSec?: number }): Cut {
  const base = s.cut && !s.cut.auto && s.cut.shots.length ? s.cut : autoCut(s, maxBrollSeconds)
  if (s.captionOff) return { ...base, captions: [] }
  const v = s.sound?.voice
  if (!v?.captions || !v.words.length) return base
  return { ...base, captions: voiceCaptions(v.words, v.at, phrases) }
}

// Two shots instead of one chained clip (a seam that failed): a real cut
// between them, with the post's B-roll where it was.
export function twoShotCut(s: Omit<CutSource, 'cut'>, first: string, second: string, maxBrollSeconds = 20): Cut {
  const base = autoCut({ ...s, clipId: first }, maxBrollSeconds)
  const at = base.shots.findIndex(x => x.kind === 'clip')
  base.shots.splice(at + 1, 0, { id: 'clip2', kind: 'clip', ref: second, in: 0, out: null })
  return { ...base, auto: false }
}

// The clips a cut uses (for checks and for "is anything still preparing").
export const cutClipIds = (c: Cut): string[] => c.shots.filter(x => x.kind === 'clip').map(x => x.ref)
export const cutBrollIds = (c: Cut): string[] => c.shots.filter(x => x.kind === 'broll').map(x => x.ref)

// What is wrong with a cut before it is rendered, in plain words.
// A caption is never required (owner, 2026-10-15): with no words the video
// has no caption, and the owner can add text in the editor.
export function cutProblems(c: Cut, limits: { maxShots: number; maxCaptions: number }): string[] {
  const out: string[] = []
  if (!c.shots.length) out.push('Pick a clip')
  if (c.shots.length > limits.maxShots) out.push(`Use at most ${limits.maxShots} shots`)
  if (c.captions.length > limits.maxCaptions) out.push(`Use at most ${limits.maxCaptions} captions`)
  for (const [i, s] of c.shots.entries()) if (s.out != null && s.out - s.in < 0.2) out.push(`Shot ${i + 1} is shorter than 0.2 s`)
  for (const [i, x] of c.captions.entries()) if (x.end != null && x.end <= x.start) out.push(`Caption ${i + 1} ends before it starts`)
  return out
}
