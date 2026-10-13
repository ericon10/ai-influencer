import type { TemplatesConfig } from '../config/pipeline.js'
import { realismBlock, stripBannedTerms } from './realism.js'
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

export const promptWriterJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: { prompt: { type: 'string', description: 'The prompt: one paragraph of natural sentences, present tense.' } },
  required: ['prompt'],
  additionalProperties: false,
}

// What the writer sent, cleaned for the prompt box: no REALISM or AVOID
// block (the Studio adds its own) and no smoothing words, with what was
// removed so the owner is told.
export function cleanWriterOutput(text: string): { text: string; removed: string[] } {
  const stripped = stripBannedTerms(cleanWritten(text))
  return { text: normalizePrompt(stripped.prompt), removed: stripped.removed }
}

// The final video prompt: the text, the owner's directions, the silent line
// when audio is off, and the REALISM block (always).
export function assembleVideoPrompt(t: TemplatesConfig, body: string, o: { directions: string; audio: boolean; realism?: string | null }): string {
  const text = normalizePrompt([cleanWritten(body), o.directions.trim(), o.audio ? '' : t.video.silent].filter(Boolean).join(' '))
  return `${stripBannedTerms(text).prompt}\n${realismBlock(o.realism)}`
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
export function mockWrittenPrompt(target: PromptTarget, input: { facts?: string; motion?: string }, range: readonly [number, number]): string {
  if (target === 'video') return fitWords(`${(input.motion ?? '').trim().replace(/[.\s]+$/, '')}.`, VIDEO_FILL, range)
  const values = (input.facts ?? '').split('\n')
    .map(l => l.replace(/^-\s*[^:]+:\s*/, '').trim())
    .filter(v => v && !/^(?:brands and logos may show|everything is plain and unbranded)\.?$/i.test(v))
  return fitWords(values.join(' '), STILL_FILL, range)
}
