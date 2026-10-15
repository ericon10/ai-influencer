import { describe, expect, it } from 'vitest'
import { median, takeGateFor, takeGateLine } from './takeGate.js'

const g = { face_min: 0.45, margin: 0.12, source_max: 0.45 }

// The owner's first real Recreate (kitchen clip, Callie, Wan 3.0): the face
// every half second from its review. The old check rejected it (likeness
// 0.39 on three frames against a 0.36 cap); the video rule keeps it.
const kitchen = [
  [0.77, 0.28], [0.74, 0.27], [0.72, 0.24], [0.74, 0.23], [0.62, 0.26], [0.69, 0.24],
  [0.54, 0.17], [0.41, 0.32], [0.65, 0.22], [0.63, 0.22], [0.61, 0.23], [0.64, 0.21],
].map(([face, likeness], i) => ({ t: i * 0.5, face: face!, likeness: likeness! }))

describe('the video rule for a take', () => {
  it('keeps the kitchen take: one low frame does not sink it', () => {
    const r = takeGateFor(g, kitchen)
    expect(r).toMatchObject({ ok: true, face: 0.645, likeness: 0.32, margin: 0.43, frames: 12, reasons: [] })
    expect(takeGateLine(r)).toBe('face 0.65, margin 0.43, likeness 0.32')
  })

  it('names what misses: a weak face, a thin margin, a high likeness', () => {
    const r = takeGateFor(g, [{ t: 0, face: 0.4, likeness: 0.46 }, { t: 0.5, face: 0.42, likeness: 0.35 }])
    expect(r.ok).toBe(false)
    expect(r.reasons).toEqual([
      'Face match 0.41, needs 0.45 or more.',
      "Beats the clip's person by 0.01, needs 0.12 or more.",
      "Likeness to the clip's person 0.46, must stay under 0.45.",
    ])
  })

  it('needs a face; a clip with no face to compare skips the margin with a note', () => {
    expect(takeGateFor(g, [{ t: 0, face: null, likeness: null }]).reasons).toEqual(['No face to match with REF-00 was found in the take.'])
    const r = takeGateFor(g, [{ t: 0, face: 0.7, likeness: null }])
    expect(r.ok).toBe(true)
    expect(r.note).toMatch(/margin was not checked/)
  })

  it('passes demo takes with a note', () => {
    expect(takeGateFor(g, [], { demo: true })).toMatchObject({ ok: true, note: expect.stringMatching(/Demo mode/) })
  })

  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})
