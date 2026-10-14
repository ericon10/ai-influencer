import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IDENTITY } from '../core/camera.js'
import { applyCameraBlocks, moveFrame } from './camera.js'
import { ffmpeg, probeFile } from './ffmpeg.js'

// The worker's camera pass (editor phase D). The frame math mirrors the
// editor's canvas; the end-to-end check compares a zoomed frame with
// ffmpeg's own scale and crop of the same frame (the same picture an
// as-shot zoom gives), within tolerance.

let dir: string
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'camera-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const W = 8, H = 8
const ramp = () => { const a = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) a.set([(i % W) * 30, Math.floor(i / W) * 30, 100], i * 3); return a }

function psnr(a: Uint8Array, b: Uint8Array): number {
  let se = 0
  for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2
  const mse = se / a.length
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse)
}

describe('moving one frame', () => {
  it('leaves an as-shot frame as it is', () => {
    const src = ramp()
    expect(psnr(moveFrame(src, W, H, { ...IDENTITY }, 0), src)).toBeGreaterThan(50)
  })

  it('zooms around the centre', () => {
    const out = moveFrame(ramp(), W, H, { ...IDENTITY, scale: 2 }, 0)
    // The left edge now shows what was a quarter of the way in.
    expect(out[(4 * W + 0) * 3]).toBeGreaterThan(40)
    expect(out[(4 * W + 0) * 3]).toBeLessThan(75)
  })

  it('flash goes white, dark goes black, a shift fills with black', () => {
    expect(Math.min(...moveFrame(ramp(), W, H, { ...IDENTITY, flash: 1 }, 0))).toBe(255)
    expect(Math.max(...moveFrame(ramp(), W, H, { ...IDENTITY, dark: 1 }, 0))).toBe(0)
    const moved = moveFrame(ramp(), W, H, { ...IDENTITY, x: 0.5 }, 0)
    expect(moved[(2 * W + 1) * 3 + 2]).toBe(0)
  })

  it('no colour is no colour', () => {
    const grey = moveFrame(ramp(), W, H, { ...IDENTITY, saturation: 0 }, 0)
    for (let i = 0; i < grey.length; i += 3) expect(Math.abs(grey[i]! - grey[i + 1]!)).toBeLessThanOrEqual(1)
  })
})

describe('the camera pass on a video', () => {
  it('moves only the frames inside the block, keeps the sound, and matches a plain zoom', async () => {
    const src = join(dir, 'src.mp4'), out = join(dir, 'out.mp4')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src])
    const block = { start: 0.5, duration: 1.2, strength: 'strong' as const, preset: 'snap_zoom', keys: [{ t: 0, scale: 1 }, { t: 0.1, scale: 1.4, ease: 'outExpo' as const }, { t: 1, scale: 1.4, ease: 'hold' as const }] }
    const r = await applyCameraBlocks(src, out, [block], { width: 180, height: 320, fps: 30 })
    expect(r.frames).toBe(60)
    // Frames 16 to 50 move (the block's first frame is as shot).
    expect(r.moved).toBeGreaterThan(30)
    expect(r.moved).toBeLessThan(37)
    const p = await probeFile(out)
    expect(p).toMatchObject({ width: 180, height: 320, hasAudio: true })
    // At 1.5 s the zoom holds at 1.64: compare with ffmpeg's scale and crop.
    const got = join(dir, 'got.rgb'), want = join(dir, 'want.rgb')
    await ffmpeg(['-ss', '1.5', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', got])
    await ffmpeg(['-ss', '1.5', '-i', src, '-frames:v', '1', '-vf', 'scale=iw*1.64:ih*1.64:flags=bilinear,crop=180:320', '-f', 'rawvideo', '-pix_fmt', 'rgb24', want])
    const db = psnr(new Uint8Array(await readFile(got)), new Uint8Array(await readFile(want)))
    expect(db).toBeGreaterThan(24)
    // Before the block, the frame is the source's.
    const a = join(dir, 'a.rgb'), b = join(dir, 'b.rgb')
    await ffmpeg(['-ss', '0.2', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', a])
    await ffmpeg(['-ss', '0.2', '-i', src, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', b])
    expect(psnr(new Uint8Array(await readFile(a)), new Uint8Array(await readFile(b)))).toBeGreaterThan(30)
  }, 120_000)
})
