import { describe, expect, it } from 'vitest'
import { autoCut, cutProblems, effectiveCut, type CutSource } from './cut.js'

// No caption, and a caption that is never required (owner, 2026-10-15).

const src: CutSource = { clipId: 'cand_a', brollId: null, order: 'clip_first', brollStart: 0, brollSeconds: 2 }
const limits = { maxShots: 8, maxCaptions: 6 }

describe('captions are optional', () => {
  it('a cut with no caption words has no problem: the video simply has no caption', () => {
    expect(cutProblems(autoCut(src), limits)).toEqual([])
    expect(cutProblems({ auto: false, shots: [], captions: [] }, limits)).toEqual(['Pick a clip'])
  })

  it('No caption takes every caption out of the cut, the edited one and a voiceover\'s too', () => {
    expect(effectiveCut(src).captions).toHaveLength(1)
    expect(effectiveCut({ ...src, captionOff: true }).captions).toEqual([])
    const edited = { auto: false, shots: [{ id: 'c', kind: 'clip' as const, ref: 'cand_a', in: 1, out: 4 }], captions: [{ id: 'x', text: 'hi', start: 0, end: 2 }] }
    expect(effectiveCut({ ...src, cut: edited, captionOff: true })).toEqual({ ...edited, captions: [] })
    const voice = { at: 0, captions: true, words: [{ text: 'hello', start: 0, end: 0.4 }] }
    expect(effectiveCut({ ...src, sound: { voice } }).captions.length).toBeGreaterThan(0)
    expect(effectiveCut({ ...src, sound: { voice }, captionOff: true }).captions).toEqual([])
    // Switched back on: the captions return.
    expect(effectiveCut({ ...src, cut: edited, captionOff: false }).captions).toEqual(edited.captions)
  })
})
