import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { compareTexture, laplacianVariance } from './texture.js'
import { FACE_MODELS, createFaceMatcher } from './faces.js'

// Realism principle: an upscale or edit that smooths the face is flagged.

// A skin-like test image: grain about two pixels across, like pores and
// fine texture at 1k to 2k (single-pixel noise is finer than any skin).
async function grain(w = 400, h = 520, seed = 7): Promise<Buffer> {
  const gw = Math.ceil(w / 2), gh = Math.ceil(h / 2)
  const px = Buffer.alloc(gw * gh * 3)
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const v = Math.max(0, Math.min(255, 150 + 40 * (y / gh) + (rnd() - 0.5) * 60))
      const i = (y * gw + x) * 3
      px[i] = v; px[i + 1] = v * 0.85; px[i + 2] = v * 0.75
    }
  }
  return sharp(px, { raw: { width: gw, height: gh, channels: 3 } }).resize(w, h, { kernel: 'cubic' }).png().toBuffer()
}

describe('texture check', () => {
  it('measures fine detail as Laplacian variance', () => {
    const flat = new Uint8Array(16 * 16).fill(128)
    expect(laplacianVariance(flat, 16, 16)).toBe(0)
    const checker = Uint8Array.from({ length: 16 * 16 }, (_, i) => ((i % 16) + Math.floor(i / 16)) % 2 ? 255 : 0)
    expect(laplacianVariance(checker, 16, 16)).toBeGreaterThan(1000)
  })

  it('flags an upscale that smoothed the skin, and suggests a rerun', async () => {
    const src = await grain()
    const smoothed = await sharp(src).resize(800, 1040).blur(3).png().toBuffer()
    const r = await compareTexture(src, smoothed, { sameFraming: true })
    expect(r.smoothed).toBe(true)
    expect(r.ratio).toBeLessThan(0.6)
    expect(r.message).toMatch(/Skin smoothed.*Rerun/)
  })

  it('passes a clean 2x upscale: it is compared at the same scale, not rewarded for size', async () => {
    const src = await grain()
    const up = await sharp(src).resize(800, 1040, { kernel: 'lanczos3' }).png().toBuffer()
    const r = await compareTexture(src, up, { sameFraming: true })
    expect(r.smoothed).toBe(false)
    expect(r.ratio).toBeGreaterThan(0.6)
  })

  it('passes an edit that keeps the grain, and flags one that blurs it', async () => {
    const src = await grain()
    const kept = await sharp(await grain(400, 520, 99)).jpeg({ quality: 92 }).toBuffer()
    expect((await compareTexture(src, kept)).smoothed).toBe(false)
    const waxy = await sharp(src).blur(2.5).png().toBuffer()
    expect((await compareTexture(src, waxy)).smoothed).toBe(true)
  })

  const MODELS_DIR = process.env.STUDIO_MODELS_DIR ?? '.data/models'
  const haveModels = Object.values(FACE_MODELS).every(f => existsSync(join(MODELS_DIR, f)))
  it.skipIf(!haveModels)('uses the face crop on a real face photo', async () => {
    const faces = createFaceMatcher({ modelsDir: MODELS_DIR })
    const photo = readFileSync(join(process.cwd(), 'fixtures/faces/person-a-1.jpg'))
    const meta = await sharp(photo).metadata()
    const airbrushed = await sharp(photo).resize((meta.width ?? 400) * 2).blur(4).jpeg({ quality: 95 }).toBuffer()
    const r = await compareTexture(photo, airbrushed, { faces, sameFraming: true })
    expect(r.region).toBe('face')
    expect(r.smoothed).toBe(true)
    const clean = await sharp(photo).resize((meta.width ?? 400) * 2, undefined, { kernel: 'lanczos3' }).jpeg({ quality: 95 }).toBuffer()
    expect((await compareTexture(photo, clean, { faces, sameFraming: true })).smoothed).toBe(false)
  }, 60_000)

  it.skipIf(!haveModels)('does not judge a face too small to show skin detail (full-body framing)', async () => {
    const faces = createFaceMatcher({ modelsDir: MODELS_DIR })
    const photo = readFileSync(join(process.cwd(), 'fixtures/faces/person-a-1.jpg'))
    const meta = await sharp(photo).metadata()
    // The same face, far smaller in the frame, as in a full-body shot.
    const small = await sharp(photo).resize(Math.round((meta.width ?? 400) / 4)).extend({ top: 300, bottom: 300, left: 150, right: 150, background: '#d8d4cc' }).jpeg({ quality: 95 }).toBuffer()
    const r = await compareTexture(photo, small, { faces })
    expect(r.judged).toBe(false)
    expect(r.smoothed).toBe(false)
    expect(r.message).toMatch(/too small here to judge skin texture/)
  }, 60_000)
})
