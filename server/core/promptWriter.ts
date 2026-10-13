import type { TemplatesConfig } from '../config/pipeline.js'
import { realismBlock, realismForFraming, stripBannedTerms, type SkinDetail } from './realism.js'
import { cleanWritten } from './scenes.js'
import { normalizePrompt, wordCount } from './text.js'

// The prompt writer (owner, 2026-10-13; default rule scene-prompt-writer).
// Claude turns the scene details into the final prompt as natural sentences;
// the owner can edit or rewrite it. What must not depend on the writing (the
// reference line, the mark sides, the REALISM block) is added by code, in
// assembleStillPrompt (core/scenes.ts) and assembleVideoPrompt below.

export type PromptTarget = 'still' | 'video'

// A prompt on a scene: written by Claude, typed by the owner, or the
// template's text put in the box. `basis` is what it was written from, so a
// later change to the details can be pointed out.
export interface WrittenPrompt {
  text: string
  source: 'claude' | 'owner' | 'template'
  at: string
  model?: string
  basis?: string
  words: number
  // Video only: what the writer was given.
  motion?: string
  directions?: string
  // The director's pass (default rule scene-directors-pass): the choices
  // that make the shot memorable, one short line, and who set them.
  notes?: string
  notesBy?: 'claude' | 'owner'
}

export interface ScenePrompts { still?: WrittenPrompt; video?: WrittenPrompt }

export function scenePrompts(raw: unknown): ScenePrompts {
  const r = (raw ?? {}) as Record<string, unknown>
  const one = (v: unknown): WrittenPrompt | undefined => {
    const w = v as Partial<WrittenPrompt> | undefined
    return w && typeof w.text === 'string' && w.text.trim() ? { ...w, text: w.text, words: wordCount(w.text) } as WrittenPrompt : undefined
  }
  return { still: one(r.still), video: one(r.video) }
}

// The writer's answer: the prompt, and with the director's pass on, the
// notes line before it.
export function promptWriterSchema(withNotes: boolean): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ...(withNotes ? { notes: { type: 'string', description: "The director's notes: one short line of the choices that make the shot memorable." } } : {}),
      prompt: { type: 'string', description: 'The prompt, in the asked format, present tense.' },
    },
    required: withNotes ? ['notes', 'prompt'] : ['prompt'],
    additionalProperties: false,
  }
}

// A video prompt in the guide's labeled lines (FORMAT to CONSTRAINTS).
const LABEL = /^(FORMAT|SUBJECT(?:\s*\/\s*REFERENCES)?|SETTING\s*\/\s*LIGHT|CAMERA|ACTION|(?:PHYSICAL\s+)?CONTINUITY|AUDIO(?:\s*\/\s*DIALOGUE)?|CONSTRAINTS):/i
export const isLabeled = (text: string): boolean => text.split('\n').filter(l => LABEL.test(l.trim())).length >= 3

// Labeled text kept one line per label: each line tidied on its own, a
// line without a label joined to the one before (a wrapped answer).
function labeledLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = normalizePrompt(raw)
    if (!line || /^(?:REALISM|AVOID):/i.test(line)) continue
    if (LABEL.test(line) || !out.length) out.push(line)
    else out[out.length - 1] = `${out[out.length - 1]} ${line}`
  }
  return out
}

// What the writer sent, cleaned for the prompt box: no REALISM or AVOID
// block (the Studio adds its own) and no smoothing words, with what was
// removed so the owner is told. Labeled video lines keep their breaks.
export function cleanWriterOutput(text: string): { text: string; removed: string[] } {
  if (isLabeled(text)) {
    const stripped = stripBannedTerms(labeledLines(text.replace(/^["\u201c]+|["\u201d]+$/g, '')).join('\n'))
    return { text: stripped.prompt.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n'), removed: stripped.removed }
  }
  const stripped = stripBannedTerms(cleanWritten(text))
  return { text: normalizePrompt(stripped.prompt), removed: stripped.removed }
}

// The FORMAT and AUDIO lines are the Studio's (9:16 and sound off unless
// the owner turns it on): written over whatever the writer put there.
export function enforceVideoLines(text: string, o: { format: string; audio: string }): string {
  const lines = labeledLines(text)
  const kept = lines.filter(l => !/^(?:FORMAT|AUDIO(?:\s*\/\s*DIALOGUE)?):/i.test(l))
  const at = kept.findIndex(l => /^CONSTRAINTS:/i.test(l))
  const body = at >= 0 ? [...kept.slice(0, at), o.audio, ...kept.slice(at)] : [...kept, o.audio]
  return [o.format, ...body].join('\n')
}

// The final video prompt: the text, the owner's directions, the silent line
// when audio is off, and the REALISM block (always). Labeled lines stay one
// per line; the directions go on a line of their own after them.
export function assembleVideoPrompt(t: TemplatesConfig, body: string, o: { directions: string; audio: boolean; realism?: string | null; skin?: SkinDetail }): string {
  const realism = realismForFraming(realismBlock(o.realism), o.skin)
  const tail = normalizePrompt([o.directions.trim(), o.audio ? '' : t.video.silent].filter(Boolean).join(' '))
  if (isLabeled(body)) {
    const lines = stripBannedTerms(labeledLines(body).join('\n')).prompt.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    return [...lines, tail, realism].filter(Boolean).join('\n')
  }
  const text = normalizePrompt([cleanWritten(body), tail].filter(Boolean).join(' '))
  return `${stripBannedTerms(text).prompt}\n${realism}`
}

// ── Demo mode: a written prompt without calling Claude ────────────────

const STILL_FILL = [
  'The moment feels unplanned, caught between one movement and the next.',
  'A few people pass in the background, slightly out of focus.',
  'Small everyday details sit around the frame, a little untidy and real.',
  'Nothing is styled or posed; it looks like a photo a friend took without warning.',
  'The colors are true to life, with soft shadows and natural contrast.',
]
const VIDEO_FILL = [
  'The movement is small and natural, and the camera stays steady.',
  'Everything happens in one smooth, continuous moment.',
  'Background details shift gently as the moment unfolds.',
]

function fitWords(base: string, fill: string[], [min, max]: readonly [number, number]): string {
  let out = base.trim()
  for (let i = 0; wordCount(out) < min && i < 40; i++) out = `${out} ${fill[i % fill.length]}`
  const words = out.split(/\s+/)
  return words.length > max ? `${words.slice(0, max).join(' ').replace(/[,;:.]+$/, '')}.` : out
}

// A believable stand-in for Claude's answer, from the facts the writer got.
// A video answer is the guide's labeled lines.
export function mockWrittenPrompt(target: PromptTarget, input: { facts?: string; motion?: string; name?: string; subj?: string; poss?: string; format?: string; audio?: string }, range: readonly [number, number]): string {
  if (target === 'video') {
    const idea = (input.motion ?? '').trim().replace(/[.\s]+$/, '')
    const name = input.name ?? 'The character'
    const subj = input.subj ?? 'they', poss = input.poss ?? 'their'
    const Subj = `${subj.charAt(0).toUpperCase()}${subj.slice(1)}`, Poss = `${poss.charAt(0).toUpperCase()}${poss.slice(1)}`
    const lines = [
      input.format ?? 'FORMAT: 5 s, 9:16, live-action personal phone video, one continuous take, no cuts.',
      `SUBJECT: ${name} exactly as in the start frame: the same face, hair and outfit.`,
      'SETTING/LIGHT: The place as in the start frame. Soft daylight from a window at camera-left.',
      `CAMERA: A friend records on the rear camera at chest height, about one metre away, with small breathing movements; when ${subj} leans in, the friend follows a fraction late and settles.`,
      `ACTION: ${fitWords(`${idea}.`, VIDEO_FILL, [Math.max(10, range[0] - 70), Math.max(20, range[1] - 70)])} ${Subj} notices something just off camera, a small half-smile, then goes back to the task.`,
      `CONTINUITY: ${Poss} hands keep the same grip on what ${subj} holds; anything set down stays where it lands.`,
      input.audio ?? 'AUDIO: Sound off: silent, no dialogue, no music.',
      'CONSTRAINTS: No posed smile, no morphing fingers, no camera teleportation, no duplicated people.',
    ]
    return lines.join('\n')
  }
  const values = (input.facts ?? '').split('\n')
    .map(l => l.replace(/^-\s*[^:]+:\s*/, '').trim())
    .filter(v => v && !/^(?:brands and logos may show|everything is plain and unbranded)\.?$/i.test(v))
  return fitWords(values.join(' '), STILL_FILL, range)
}

// Demo notes for the director's pass.
export function mockDirectorNotes(target: PromptTarget): string {
  return target === 'video'
    ? 'Moment: the small half-smile · Hook: a quick glance up in the first second · Payoff: a look to the lens in the last 2 seconds · Camera: slow push in · Depth: a blurred shoulder in front, people passing behind · Light: window light from camera-left · Contrast: stillness against the busy room'
    : 'Moment: the laugh breaking mid-task · Hook: a slightly low angle on the face · Depth: a cup in the foreground, life in the background · Light: low sun from camera-left · Contrast: a calm subject against a busy background'
}

