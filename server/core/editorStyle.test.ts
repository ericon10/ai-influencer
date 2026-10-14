import { describe, expect, it } from 'vitest'
import { anchorFor, anchorWords, editorStyleSchema, placeStack, stackSchema, timeFor, type Places } from './editorStyle.js'

// Saved styles keep places relative to the video (payoff, cuts, beats,
// start, end), so a style lands sensibly on a post of another length.
// The same vectors run in the OpenReel fork's style.test.ts.

const a: Places = { duration: 8, payoff: 6, cuts: [3.2], beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] }
const b: Places = { duration: 12, payoff: 9.5, cuts: [4, 8], beats: [0.6, 1.2, 1.8, 2.4] }

describe('editor style anchors', () => {
  it('names the payoff, a cut, a beat, then the start or the end', () => {
    expect(anchorFor(6, a)).toMatchObject({ on: 'payoff', offset: 0 })
    expect(anchorFor(3.22, a)).toMatchObject({ on: 'cut', index: 0, offset: 0.02 })
    expect(anchorFor(2.5, a)).toMatchObject({ on: 'beat', index: 4, offset: 0 })
    expect(anchorFor(5.2, a)).toMatchObject({ on: 'payoff', offset: -0.8 })
    expect(anchorFor(7.6, a)).toMatchObject({ on: 'end', offset: 0.4 })
    expect(anchorFor(0.2, a)).toMatchObject({ on: 'start', offset: 0.2 })
  })

  it('lands on the same kind of place in another video', () => {
    expect(timeFor(anchorFor(6, a), b)).toBe(9.5)
    expect(timeFor(anchorFor(3.22, a), b)).toBe(4.02)
    // Beat 5 is missing there: it falls back to its share of the video.
    expect(timeFor(anchorFor(2.5, a), b)).toBe(3.75)
    expect(timeFor(anchorFor(1, a), b)).toBe(1.2)
    expect(timeFor(anchorFor(7.6, a), b)).toBe(11.6)
  })

  it('stays inside the video', () => {
    expect(timeFor({ on: 'payoff', index: 0, offset: 5, ratio: 0.9 }, b)).toBe(11.9)
    expect(timeFor({ on: 'start', index: 0, offset: 0, ratio: 0 }, { duration: 0, payoff: null, cuts: [], beats: [] })).toBe(0)
  })

  it('places a whole stack and describes each place', () => {
    const items = stackSchema.parse([
      { preset: 'snap_zoom', strength: 'strong', at: anchorFor(6, a), duration: 1.2 },
      { preset: 'glitch', at: anchorFor(3.2, a) },
    ])
    expect(placeStack(items, b)).toEqual([
      { preset: 'snap_zoom', strength: 'strong', time: 9.5, duration: 1.2, keys: null },
      { preset: 'glitch', strength: 'normal', time: 4, duration: null, keys: null },
    ])
    expect(items.map(i => anchorWords(i.at))).toEqual(['at the payoff', 'on cut 1'])
  })

  it('a saved style needs a name and at least one preset', () => {
    expect(() => editorStyleSchema.parse({ id: 'sty_abcdef', name: ' ', items: [], createdAt: 'x' })).toThrow()
    expect(editorStyleSchema.parse({ id: 'sty_abcdef', name: 'Payoff zoom', items: [{ preset: 'snap_zoom', at: { on: 'payoff', ratio: 0.7 } }], createdAt: 'x' }).items[0]!.strength).toBe('normal')
  })
})
