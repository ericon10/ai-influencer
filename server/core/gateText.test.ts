import { describe, expect, it } from 'vitest'
import { gateFor } from '../pipeline/clone.js'
import { takeGateFor } from './takeGate.js'
import { scoreAgainst, vs } from './gateText.js'

// Item 21: a fail is visible in the numbers, never "0.45, needs 0.45".
describe('gate text decimals', () => {
  it('adds decimals until the score and the limit differ', () => {
    expect(vs(0.448, 0.45)).toEqual(['0.448', '0.450'])
    expect(vs(0.4496, 0.45)).toEqual(['0.4496', '0.4500'])
    expect(vs(0.31, 0.45)).toEqual(['0.31', '0.45'])
    expect(scoreAgainst(0.4502, 0.45)).toBe('0.4502')
    expect(scoreAgainst(0.62, 0.45)).toBe('0.62')
    expect(scoreAgainst(null, 0.45)).toBe('?')
  })
  it('the still gate and the video rule show a near miss with its decimals', () => {
    const g = { face_min: 0.45, margin: 0.12, source_max: 0.45 }
    const still = gateFor(g, { status: 'approved', faceScore: 0.448, sourceScore: 0.3305, demo: false })
    expect(still.ok).toBe(false)
    expect(still.reasons).toEqual(['Face match 0.448, needs 0.450 or more.', "Beats the clip's person by 0.118 (face 0.448, likeness 0.331), needs 0.120 or more."])
    const take = takeGateFor(g, [{ t: 0.5, face: 0.449, likeness: 0.1 }])
    expect(take.reasons).toEqual(['Face match 0.449, needs 0.450 or more.'])
  })
})
