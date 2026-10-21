import { describe, expect, it } from 'vitest'
import { coversFace, placeText } from './facePlace.js'
import type { Draw } from './slideSvg.js'

// R1 on slide stills (item 8): words in the largest clear band that misses
// every face box plus 4%; above, then below, then smaller, then under the chin.
const draw: Draw = { measure: (t, size) => t.length * size * 0.55, text: () => '' }
const frame = { width: 1080, height: 1920 }
const words = 'my manager took credit for my work again'

describe('captions never on a face (stills)', () => {
  it('keeps the place when it misses every face, and when there is no face', () => {
    expect(placeText('classic', words, frame, [], draw, null).how).toBe('kept')
    expect(placeText('classic', words, frame, [{ x: 0.4, y: 0.6, w: 0.2, h: 0.12 }], draw, null).how).toBe('kept')
  })

  it('moves the words above a face they covered, clear of it by 4%', () => {
    const face = { x: 0.35, y: 0.24, w: 0.3, h: 0.16 }
    expect(coversFace('classic', words, frame, null, draw, [face])).toBe(true)
    const p = placeText('classic', words, frame, [face], draw, null)
    expect(p.how).toBe('above')
    expect(coversFace('classic', words, frame, p.pos, draw, [face])).toBe(false)
    expect(p.pos.by).toBe('auto')
    const low = { x: 0.35, y: 0.5, w: 0.3, h: 0.16 }
    const q = placeText('classic', words, frame, [low], draw, { x: 0.5, y: 0.55 })
    expect(q.how).toBe('above')
    expect(q.pos.y).toBeLessThan(0.5)
  })

  it('shrinks one step, and last puts a box under the chin', () => {
    const big = { x: 0.1, y: 0.1, w: 0.8, h: 0.62 }
    const p = placeText('box', words, frame, [big], draw, null)
    expect(['smaller', 'chin', 'below']).toContain(p.how)
    expect(coversFace('box', words, frame, p.pos, draw, [{ ...big, y: big.y, h: big.h }]) && p.how !== 'chin').toBe(false)
    const whole = { x: 0.05, y: 0.08, w: 0.9, h: 0.8 }
    const c = placeText('classic', words, frame, [whole], draw, null)
    expect(c.how).toBe('chin')
    expect(c.pos.scale).toBe(0.85)
  })
})
