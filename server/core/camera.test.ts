import { describe, expect, it } from 'vitest'
import { blockFrameAt, cameraAt, ease, isIdentity, shakeOffset, STRENGTH_SCALE, type CameraKey } from './camera.js'

// Parity with the editor (the OpenReel fork's presets.test.ts): the same
// keys give the same frame here and in the browser.

const snap: CameraKey[] = [{ t: 0, scale: 1 }, { t: 0.1, scale: 1.4, ease: 'outExpo' }, { t: 1, scale: 1.4, ease: 'hold' }]
const crash: CameraKey[] = [
  { t: 0, scale: 1, motionBlur: 0 }, { t: 0.45, scale: 1.55, motionBlur: 0.8, ease: 'inExpo' },
  { t: 0.5, scale: 1.25, motionBlur: 0.3, ease: 'linear' }, { t: 1, scale: 1, motionBlur: 0, ease: 'outExpo' },
]

describe('camera math on the worker (same as the editor)', () => {
  it('holds before the first key and after the last, and eases between', () => {
    expect(cameraAt(snap, 0).scale).toBe(1)
    expect(cameraAt(snap, 1).scale).toBeCloseTo(1.4)
    const mid = cameraAt(snap, 0.05).scale
    expect(mid - 1).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(1.4)
  })

  it('strength scales the distance from as-shot', () => {
    expect(cameraAt(snap, 1, 'subtle').scale).toBeCloseTo(1 + 0.4 * STRENGTH_SCALE.subtle)
    expect(cameraAt(snap, 1, 'strong').scale).toBeCloseTo(1 + 0.4 * STRENGTH_SCALE.strong)
    expect(cameraAt(snap, 0, 'strong').scale).toBe(1)
  })

  it('matches the editor at sampled points (vectors from the fork)', () => {
    // Values computed by the fork's cameraAt for the same keys.
    expect(cameraAt(snap, 0.05).scale).toBeCloseTo(1 + 0.4 * (1 - Math.pow(2, -5)), 10)
    expect(cameraAt(crash, 0.225).scale).toBeCloseTo(1 + 0.55 * Math.pow(2, 10 * 0.5 - 10), 10)
    expect(cameraAt(crash, 0.75).motionBlur).toBeCloseTo(0.3 * (1 - (1 - Math.pow(2, -5))), 10)
  })

  it('easings start at 0 and end at 1; hold waits for the key', () => {
    for (const e of ['linear', 'in', 'out', 'inOut', 'inExpo', 'outExpo', 'outBack'] as const) {
      expect(ease(e, 0)).toBeCloseTo(0)
      expect(ease(e, 1)).toBeCloseTo(1)
    }
    expect(ease('hold', 0.99)).toBe(0)
  })

  it('the shake is deterministic and zero when off', () => {
    expect(shakeOffset(1.234, 0.03)).toEqual(shakeOffset(1.234, 0.03))
    expect(shakeOffset(1.234, 0)).toEqual({ dx: 0, dy: 0, rot: 0 })
  })

  it('a block gives a frame only inside it', () => {
    const b = { start: 4, duration: 1.2, strength: 'strong' as const, keys: snap, preset: 'snap_zoom' }
    expect(blockFrameAt(b, 3.99)).toBeNull()
    expect(blockFrameAt(b, 5.2)).toBeNull()
    expect(isIdentity(blockFrameAt(b, 4)!)).toBe(true)
    expect(blockFrameAt(b, 5)!.scale).toBeCloseTo(1.64)
  })
})
