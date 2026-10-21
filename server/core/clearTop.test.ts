import { describe, expect, it } from 'vitest'
import { clearTop } from './overlay.js'

// R1 on video (item 9): the caption's top clear of every face box across
// the clip (grown by 4%), inside the safe zone; else under the lowest chin.
const frame = { width: 1080, height: 1920 }
const area = { top: 160, bottom: 1520 }

describe('captions never on a face (video)', () => {
  it('stays where it was when clear, and with no faces', () => {
    expect(clearTop(500, 120, area, frame, [])).toEqual({ top: 500, how: 'kept' })
    expect(clearTop(500, 120, area, frame, [{ x: 0.3, y: 0.5, w: 0.4, h: 0.2 }]).how).toBe('kept')
  })
  it('moves above the faces when there is room, else below', () => {
    const above = clearTop(500, 120, area, frame, [{ x: 0.3, y: 0.24, w: 0.4, h: 0.2 }, { x: 0.35, y: 0.3, w: 0.3, h: 0.15 }])
    expect(above.how).toBe('above')
    expect(above.top + 120).toBeLessThanOrEqual(0.2 * 1920)
    const below = clearTop(300, 120, area, frame, [{ x: 0.3, y: 0.09, w: 0.4, h: 0.25 }])
    expect(below.how).toBe('below')
    expect(below.top).toBeGreaterThanOrEqual((0.34 + 0.04) * 1920)
  })
  it('under the chin, above the buttons zone, when no band fits', () => {
    const r = clearTop(300, 400, area, frame, [{ x: 0.1, y: 0.05, w: 0.8, h: 0.6 }])
    expect(r.how).toBe('chin')
    expect(r.top + 400).toBeLessThanOrEqual(area.bottom)
  })
})
