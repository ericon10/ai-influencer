import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { headBox, headMaskPng } from './mask.js'

describe('head mask for the end frame helper', () => {
  it('covers the head with room for hair, inside the image', () => {
    const box = headBox({ x: 400, y: 300, w: 200, h: 240 }, 1080, 1920)
    expect(box).toEqual({ x: 310, y: 120, w: 380, h: 480 })
    expect(headBox({ x: 0, y: 10, w: 200, h: 240 }, 300, 400)).toMatchObject({ x: 0, y: 0 })
  })

  it('is white over the head and black elsewhere, at the image size', async () => {
    const png = await headMaskPng({ x: 310, y: 120, w: 380, h: 480 }, 1080, 1920)
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([1080, 1920])
    const at = (x: number, y: number) => data[y * info.width + x]!
    expect(at(500, 360)).toBeGreaterThan(200)
    expect(at(50, 1800)).toBeLessThan(30)
    expect(at(500, 1000)).toBeLessThan(30)
  })
})
