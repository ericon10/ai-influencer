import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { ffmpeg } from './ffmpeg.js'
import { normalizeForRender } from './normalize.js'
import { renderTimeline } from './timeline.js'

// Every input made plain before a render (owner, 2026-10-14): a clone at
// 712x1294 broke a render with "Error reinitializing filters!". Odd sizes,
// a size change mid-stream, a variable frame rate and phone or TikTok
// files all come out at one size, rate, pixel format and sound layout.

let dir: string
const p = (n: string) => join(dir, n)
const canvas = { width: 1080, height: 1920, fps: 30 }
const FF = process.env.FFMPEG_PATH || 'ffmpeg'
const PROBE = process.env.FFPROBE_PATH || 'ffprobe'

function streams(file: string) {
  const r = spawnSync(PROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,sample_aspect_ratio,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8' })
  return (JSON.parse(r.stdout).streams as Array<Record<string, string | number>>)
}
function expectPlain(file: string, sound: boolean) {
  const s = streams(file)
  const v = s.find(x => x.codec_type === 'video')!
  expect(v).toMatchObject({ width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30/1', avg_frame_rate: '30/1' })
  expect(['1:1', undefined, 'N/A']).toContain(v.sample_aspect_ratio)
  const a = s.find(x => x.codec_type === 'audio')
  if (sound) expect(a).toMatchObject({ sample_rate: '48000', channels: 2 })
  else expect(a).toBeUndefined()
  expect(s.filter(x => x.codec_type === 'video')).toHaveLength(1)
}

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'normalize-test-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('plain inputs for every render', () => {
  it('a clone at 712x1294 with mono 44.1 kHz sound', async () => {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=712x1294:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=3', '-ac', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('clone.mp4')])
    const r = await normalizeForRender(p('clone.mp4'), p('clone-n.mp4'), { canvas, keepSound: true })
    expect(r.durationSec).toBeCloseTo(3, 0)
    expectPlain(p('clone-n.mp4'), true)
  }, 60_000)

  it('an odd size (711x1293) and full-range color', async () => {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=711x1293:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuvj444p', p('odd.mp4')])
    await normalizeForRender(p('odd.mp4'), p('odd-n.mp4'), { canvas, keepSound: true })
    expectPlain(p('odd-n.mp4'), false)
  }, 60_000)

  it('a size change mid-stream, and the sound layout changing with it', async () => {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=712x1294:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=2', '-ac', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('m1.ts')])
    await ffmpeg(['-f', 'lavfi', '-i', 'smptebars=size=720x1280:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=2', '-ac', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('m2.ts')])
    await ffmpeg(['-i', `concat:${p('m1.ts')}|${p('m2.ts')}`, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', p('mid.mp4')])
    const r = await normalizeForRender(p('mid.mp4'), p('mid-n.mp4'), { canvas, keepSound: true })
    expect(r.durationSec).toBeCloseTo(4, 0)
    expectPlain(p('mid-n.mp4'), true)
  }, 60_000)

  it('a variable frame rate', async () => {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=3', '-vf', "setpts='N/30/TB+0.03*sin(N)/TB'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('vfr.mp4')])
    await normalizeForRender(p('vfr.mp4'), p('vfr-n.mp4'), { canvas, keepSound: true })
    expectPlain(p('vfr-n.mp4'), false)
  }, 60_000)

  it('a TikTok-style download: rotation, a cover image stream, 44.1 kHz stereo', async () => {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-ac', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('tt0.mp4')])
    await sharp({ create: { width: 320, height: 568, channels: 3, background: '#ff0050' } }).jpeg().toFile(p('cover.jpg'))
    await ffmpeg(['-i', p('tt0.mp4'), '-i', p('cover.jpg'), '-map', '0', '-map', '1', '-c', 'copy', '-c:v:1', 'mjpeg', '-disposition:v:1', 'attached_pic', '-metadata:s:v:0', 'rotate=90', p('tiktok.mp4')])
    const r = await normalizeForRender(p('tiktok.mp4'), p('tiktok-n.mp4'), { canvas, keepSound: true })
    expect(r.hasAudio).toBe(true)
    expectPlain(p('tiktok-n.mp4'), true)
  }, 60_000)

  it('plain copies of all of them cut together with a caption', async () => {
    await sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(p('cap.png'))
    const shots = ['clone-n', 'odd-n', 'mid-n', 'vfr-n', 'tiktok-n'].map(n => ({ path: p(`${n}.mp4`), in: 0, out: null }))
    const t = await renderTimeline({ shots, captions: [{ png: p('cap.png'), start: 0, end: null }], canvas, out: p('all.mp4'), keepSound: true })
    expect(t.durationSec).toBeGreaterThan(12)
  }, 120_000)

  it('runs with the ffmpeg in PATH', () => {
    expect(spawnSync(FF, ['-version'], { encoding: 'utf8' }).status).toBe(0)
  })
})
