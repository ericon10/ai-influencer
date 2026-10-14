import { describe, expect, it } from 'vitest'
import { beatGrid, beatsFromSamples, snapTo, tapTempo } from './beats.js'

// The beat: shared by the worker and the browser.

function clicks(bpm: number, seconds: number, rate = 11025, offset = 0.1): Float32Array {
  const s = new Float32Array(Math.round(seconds * rate))
  const period = 60 / bpm
  for (let t = offset; t < seconds; t += period) {
    const i0 = Math.round(t * rate)
    for (let j = 0; j < 200 && i0 + j < s.length; j++) s[i0 + j] = Math.sin(2 * Math.PI * 1000 * j / rate) * Math.exp(-j / 60)
  }
  return s
}

describe('the beat', () => {
  it('finds the tempo and the beats of a click track', () => {
    const r = beatsFromSamples(clicks(120, 8), 11025)
    expect(r.bpm).toBeGreaterThan(115)
    expect(r.bpm).toBeLessThan(125)
    expect(r.beats.length).toBeGreaterThan(12)
    expect(r.beats[0]! % 0.5).toBeLessThan(0.15)
  })
  it('makes a steady grid from a tempo and an offset', () => {
    expect(beatGrid(120, 0.25, 2)).toEqual([0.25, 0.75, 1.25, 1.75])
    expect(beatGrid(0, 0, 2)).toEqual([])
  })
  it('reads a tapped tempo, ignoring one stray tap', () => {
    const taps = [1, 1.5, 2, 2.5, 2.9, 3.5, 4]
    const t = tapTempo(taps)!
    expect(t.bpm).toBeCloseTo(120, 0)
    // The offset is the phase on the 0.5 s period (0.49 is the same as 0).
    expect(Math.min(t.offset, 0.5 - t.offset)).toBeLessThan(0.05)
    expect(tapTempo([1, 2])).toBeNull()
  })
  it('snaps to the nearest beat within the tolerance only', () => {
    expect(snapTo(1.06, [0.5, 1, 1.5], 0.1)).toBe(1)
    expect(snapTo(1.3, [0.5, 1, 1.5], 0.1)).toBe(1.3)
  })
})
