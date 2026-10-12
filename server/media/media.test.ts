import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ffmpeg, probeFile } from './ffmpeg'
import { extractLastFrame, sharpness } from './frames'
import { clipFrames, encodeArgs, normalizeClip, stripAudio, trimClip } from './edit'
import { joinClips } from './join'
import { mixOntoVideo } from './mix'
import { makeClip, makeTone } from './testClips'

let dir: string
const p = (name: string) => join(dir, name)

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'media-test-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('probe, strip audio, normalize', () => {
  it('strips every audio track', async () => {
    await makeClip(p('a.mp4'), { width: 240, height: 426, fps: 24, durationSec: 1, audio: true })
    expect((await probeFile(p('a.mp4'))).hasAudio).toBe(true)
    await stripAudio(p('a.mp4'), p('a_silent.mp4'))
    const after = await probeFile(p('a_silent.mp4'))
    expect(after.hasAudio).toBe(false)
    expect(after.hasVideo).toBe(true)
  })

  it('normalizes mixed sizes and frame rates to one format', async () => {
    await makeClip(p('n1.mp4'), { width: 480, height: 854, fps: 24, durationSec: 1, audio: true })
    await makeClip(p('n2.mp4'), { width: 716, height: 1280, fps: 30, durationSec: 1 })
    const target = { width: 360, height: 640, fps: 30 }
    await normalizeClip(p('n1.mp4'), p('n1_norm.mp4'), target)
    await normalizeClip(p('n2.mp4'), p('n2_norm.mp4'), target)
    for (const f of ['n1_norm.mp4', 'n2_norm.mp4']) {
      const pr = await probeFile(p(f))
      expect(pr).toMatchObject({ width: 360, height: 640, pixFmt: 'yuv420p', colorRange: 'tv', hasAudio: false })
      expect(pr.fps).toBeCloseTo(30, 3)
    }
  })
})

describe('last frame', () => {
  it('extracts the final frame at full video resolution', async () => {
    await makeClip(p('lf.mp4'), { width: 360, height: 640, fps: 24, durationSec: 2 })
    const r = await extractLastFrame(p('lf.mp4'), p('lf.png'), await mkdtemp(join(dir, 'lf-')))
    expect(r).toMatchObject({ width: 360, height: 640, steppedBackSec: 0 })
  })

  it('steps back about half a second when the last frame is blurry', async () => {
    await makeClip(p('blur.mp4'), { width: 360, height: 640, fps: 24, durationSec: 2, vf: "boxblur=12:enable='gte(t,1.7)'" })
    const r = await extractLastFrame(p('blur.mp4'), p('blur.png'), await mkdtemp(join(dir, 'blur-')))
    expect(r.steppedBackSec).toBeGreaterThan(0.3)
    expect(r.steppedBackSec).toBeLessThan(0.7)
    expect(r.sharpness).toBeGreaterThan(r.lastFrameSharpness * 2)
    expect(await sharpness(p('blur.png'))).toBeCloseTo(r.sharpness, 0)
  })
})

describe('join with seam scoring', () => {
  const W = 360, H = 640, FPS = 24
  beforeAll(async () => {
    await makeClip(p('full.mp4'), { width: W, height: H, fps: FPS, durationSec: 4 })
    // Clip A: frames 0..47. Clip B starts on A's last frame (the handoff
    // frame), exactly like an image-to-video clip chained from a last frame.
    await trimClip(p('full.mp4'), p('A.mp4'), { endSec: 2 })
    await trimClip(p('full.mp4'), p('B.mp4'), { dropFirstFrames: 47 })
  })

  it('cuts cleanly when the seam matches, dropping the duplicated frame', async () => {
    const r = await joinClips([p('A.mp4'), p('B.mp4')], p('AB.mp4'), await mkdtemp(join(dir, 'j1-')))
    expect(r.passed).toBe(true)
    expect(r.seams[0]).toMatchObject({ action: 'cut', passed: true })
    const a = await clipFrames(p('A.mp4')), b = await clipFrames(p('B.mp4')), ab = await clipFrames(p('AB.mp4'))
    expect(ab.frames).toBe(a.frames + b.frames - 1)
  })

  it('color-matches and crossfades a brightness jump, then passes', async () => {
    await ffmpeg(['-i', p('B.mp4'), '-vf', 'eq=brightness=0.18:contrast=0.85', ...encodeArgs(FPS), p('B_bright.mp4')])
    const r = await joinClips([p('A.mp4'), p('B_bright.mp4')], p('AB_bright.mp4'), await mkdtemp(join(dir, 'j2-')))
    expect(r.seams[0]!.action).toBe('blend')
    expect(r.seams[0]!.colorMatched).toBe(true)
    expect(r.seams[0]!.diffAfter).toBeLessThan(r.seams[0]!.diffBefore)
    expect(r.passed).toBe(true)
    expect(r.outputPath).toBe(p('AB_bright.mp4'))
  })

  it('fails the seam and produces no output when clips do not belong together', async () => {
    await makeClip(p('other.mp4'), { width: W, height: H, fps: FPS, durationSec: 2, source: 'smptehdbars' })
    await ffmpeg(['-i', p('other.mp4'), ...encodeArgs(FPS), p('other_enc.mp4')])
    const r = await joinClips([p('A.mp4'), p('other_enc.mp4')], p('bad.mp4'), await mkdtemp(join(dir, 'j3-')))
    expect(r.passed).toBe(false)
    expect(r.outputPath).toBeNull()
    expect(r.seams[0]).toMatchObject({ action: 'blend', passed: false })
  })

  it('refuses clips that were not normalized to the same format', async () => {
    await makeClip(p('wrongsize.mp4'), { width: 240, height: 426, fps: FPS, durationSec: 1 })
    await expect(joinClips([p('A.mp4'), p('wrongsize.mp4')], p('x.mp4'), dir)).rejects.toThrow(/Normalize/)
  })
})

describe('mix', () => {
  it('lays a continuous multi-layer sound bed under the video', async () => {
    await makeClip(p('mixv.mp4'), { width: 240, height: 426, fps: 24, durationSec: 3 })
    await makeTone(p('crowd.wav'), 220, 1)
    await makeTone(p('room.wav'), 880, 5)
    await mixOntoVideo(p('mixv.mp4'), [
      { path: p('crowd.wav'), gainDb: -18, loop: true },
      { path: p('room.wav'), gainDb: -24, fadeOutSec: 0.5 },
    ], p('mixed.mp4'))
    const pr = await probeFile(p('mixed.mp4'))
    expect(pr.hasAudio).toBe(true)
    expect(pr.audioCodec).toBe('aac')
    expect(pr.durationSec!).toBeGreaterThan(2.9)
    expect(pr.durationSec!).toBeLessThan(3.2)
  })
})
