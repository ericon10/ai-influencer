import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { sceneOutsideFace } from './sceneMatch.js'

// A kitchen-like still (counters, a window, a figure) and the face pass
// results the check must tell apart.
async function scene(opts: { face?: string; studio?: boolean } = {}): Promise<Buffer> {
  const svg = opts.studio
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="360" height="640" fill="#e8e8e8"/><ellipse cx="180" cy="230" rx="70" ry="90" fill="#c8a080"/><rect x="90" y="330" width="180" height="310" fill="#ffffff"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640">
        <rect width="360" height="640" fill="#7a6a50"/>
        <rect x="0" y="420" width="360" height="220" fill="#3b3b3b"/>
        <rect x="20" y="60" width="120" height="160" fill="#cfe3f0"/>
        <rect x="250" y="300" width="90" height="110" fill="#a33"/>
        <ellipse cx="200" cy="200" rx="45" ry="60" fill="${opts.face ?? '#d9a98a'}"/>
        <rect x="140" y="270" width="120" height="260" fill="#1f5f3a"/>
      </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const faceBox = { x: 155, y: 140, w: 90, h: 120 }

describe('the face pass scene check', () => {
  it('keeps a face pass that changed only the face', async () => {
    const r = await sceneOutsideFace(await scene(), await scene({ face: '#b07a60' }), faceBox)
    expect(r.ok).toBe(true)
    expect(r.score).toBeGreaterThan(0.9)
  })

  it('flags a studio portrait in place of the scene', async () => {
    const r = await sceneOutsideFace(await scene(), await scene({ studio: true }), faceBox)
    expect(r.ok).toBe(false)
  })

  it('works without a face box, and on a result of another size', async () => {
    const big = await sharp(await scene({ face: '#b07a60' })).resize(720, 1280).png().toBuffer()
    expect((await sceneOutsideFace(await scene(), big, null)).ok).toBe(true)
  })
})
