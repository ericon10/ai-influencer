import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { ffmpeg, probeFile } from './ffmpeg.js'
import { applySoundBed, makeRoomTone, measureLoudness, transcodeSound, type SoundLevels } from './sound.js'
import { planShots, renderTimeline } from './timeline.js'
import { makeClip } from './testClips.js'

// Phase 3: the sound bed (levels, ducking, social loudness) and the rough
// cut renderer (hard cuts, trims, captions by time).

let dir: string
const p = (name: string) => join(dir, name)
const levels: SoundLevels = { target: -14, truePeak: -1, ambienceAlone: -28, ambience: -30, music: -20, duck: { threshold: 0.03, ratio: 8, attackMs: 20, releaseMs: 400 } }

// Loudness of one band of a file in a time window (the music's tone when
// another tone sits on top of it).
async function bandLoudness(file: string, from: number, to: number, hz: number) {
  return (await measureLoudness(file, `atrim=${from}:${to},bandpass=f=${hz}:width_type=q:w=12`)).i
}

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'sound-test-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('sound bed', () => {
  it('Room tone alone stays quiet: about -28 LUFS, never a soundtrack', async () => {
    await makeClip(p('pic.mp4'), { width: 240, height: 426, fps: 24, durationSec: 4 })
    const r = await applySoundBed({ video: p('pic.mp4'), out: p('room.mp4'), workDir: dir, clipSound: true, ambience: { builtin: 'room' }, levels })
    expect(r).toMatchObject({ hasSound: true, layers: ['ambience'], targetLufs: -28, ducked: false })
    const l = await measureLoudness(p('room.mp4'))
    expect(l.i).toBeGreaterThan(-30)
    expect(l.i).toBeLessThan(-26)
    const pr = await probeFile(p('room.mp4'))
    expect(pr.hasAudio).toBe(true)
    expect(pr.durationSec).toBeCloseTo(4, 0)
  })

  it('music with the clip sound is normalized to -14 LUFS with a -1 dBTP ceiling', async () => {
    await makeClip(p('voiced.mp4'), { width: 240, height: 426, fps: 24, durationSec: 4, audio: true })
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', '-c:a', 'aac', p('music.m4a')])
    const r = await applySoundBed({ video: p('voiced.mp4'), out: p('mixed.mp4'), workDir: dir, clipSound: true, ambience: { builtin: 'room' }, music: { path: p('music.m4a') }, levels })
    expect(r.layers).toEqual(['clip', 'ambience', 'music'])
    expect(r.targetLufs).toBe(-14)
    const l = await measureLoudness(p('mixed.mp4'))
    expect(l.i).toBeGreaterThan(-15.5)
    expect(l.i).toBeLessThan(-12.5)
    expect(l.tp).toBeLessThanOrEqual(-0.5)
  })

  it('ducks the music while the clip has sound, and only then', async () => {
    // The clip speaks (880 Hz) for the first 3 s, then is silent for 3 s.
    await makeClip(p('half.mp4'), { width: 240, height: 426, fps: 24, durationSec: 6 })
    await ffmpeg(['-i', p('half.mp4'), '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-af', 'apad=whole_dur=6', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', p('half_voiced.mp4')])
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-c:a', 'aac', p('bed.m4a')])
    const ducked = await applySoundBed({ video: p('half_voiced.mp4'), out: p('ducked.mp4'), workDir: dir, clipSound: true, music: { path: p('bed.m4a') }, duck: true, levels })
    expect(ducked.ducked).toBe(true)
    const flat = await applySoundBed({ video: p('half_voiced.mp4'), out: p('flat.mp4'), workDir: dir, clipSound: true, music: { path: p('bed.m4a') }, duck: false, levels })
    expect(flat.ducked).toBe(false)
    // The music's tone during the speech, against after it.
    const dip = (await bandLoudness(p('ducked.mp4'), 4, 5.5, 220)) - (await bandLoudness(p('ducked.mp4'), 1, 2.5, 220))
    const noDip = (await bandLoudness(p('flat.mp4'), 4, 5.5, 220)) - (await bandLoudness(p('flat.mp4'), 1, 2.5, 220))
    expect(dip).toBeGreaterThan(4)
    expect(Math.abs(noDip)).toBeLessThan(1.5)
  })

  it('no layers at all: a silent post', async () => {
    const r = await applySoundBed({ video: p('pic.mp4'), out: p('silent.mp4'), workDir: dir, clipSound: true, ambience: null, music: null, levels })
    expect(r.hasSound).toBe(false)
    expect((await probeFile(p('silent.mp4'))).hasAudio).toBe(false)
  })

  it('an uploaded track becomes lean AAC, measured; a file with no sound is refused', async () => {
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-ac', '1', '-ar', '22050', p('upload.wav')])
    const t = await transcodeSound(p('upload.wav'), p('upload.m4a'), { maxSeconds: 2 })
    expect(t.durationSec).toBeCloseTo(2, 0)
    expect(t.loudness).toBeGreaterThan(-30)
    const pr = await probeFile(p('upload.m4a'))
    expect(pr.audioCodec).toBe('aac')
    await expect(transcodeSound(p('pic.mp4'), p('nope.m4a'), { maxSeconds: 2 })).rejects.toThrow(/no sound/)
  })

  it('Room tone is deterministic', async () => {
    await makeRoomTone(p('r1.wav'), 1)
    await makeRoomTone(p('r2.wav'), 1)
    const { readFile } = await import('node:fs/promises')
    expect((await readFile(p('r1.wav'))).equals(await readFile(p('r2.wav')))).toBe(true)
  })
})

describe('rough cut renderer', () => {
  it('plans trims and places from the sources (open ends, caps, the total limit)', () => {
    const src = [{ durationSec: 5, hasAudio: true, width: 480, height: 854 }, { durationSec: 10, hasAudio: false, width: 1280, height: 720 }, { durationSec: 3, hasAudio: false, width: 480, height: 854 }]
    const plan = planShots([{ in: 1, out: null }, { in: 2, out: 4 }, { in: 0, out: null, maxSeconds: 1.5 }], src)
    expect(plan.map(x => [x.start, x.in, x.out, x.durationSec])).toEqual([[0, 1, 5, 4], [4, 2, 4, 2], [6, 0, 1.5, 1.5]])
    expect(plan[1]!.landscape).toBe(true)
    // The total limit cuts the last shot short.
    expect(planShots([{ in: 0, out: null }, { in: 0, out: null }], src.slice(0, 2), 7).map(x => x.durationSec)).toEqual([5, 2])
    // A trim past the end is pulled back inside the clip.
    expect(planShots([{ in: 9, out: 2 }], [src[0]!])[0]).toMatchObject({ in: 4.8, out: 5 })
  })

  it('joins trimmed shots with hard cuts and lays captions by time', async () => {
    await makeClip(p('s1.mp4'), { width: 480, height: 854, fps: 24, durationSec: 3, audio: true, source: 'testsrc2' })
    await makeClip(p('s2.mp4'), { width: 1280, height: 720, fps: 30, durationSec: 4, source: 'smptebars' })
    const canvas = { width: 360, height: 640, fps: 30 }
    // A red caption for the first second, a blue one from 3 s to the end.
    const cap = async (name: string, rgb: [number, number, number]) => {
      const png = await sharp({ create: { width: 360, height: 640, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp({ create: { width: 360, height: 80, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer(), top: 0, left: 0 }]).png().toBuffer()
      await writeFile(p(name), png)
      return p(name)
    }
    const r = await renderTimeline({
      shots: [{ path: p('s1.mp4'), in: 0.5, out: 2.5 }, { path: p('s2.mp4'), in: 1, out: 3 }],
      captions: [{ png: await cap('red.png', [255, 0, 0]), start: 0, end: 1 }, { png: await cap('blue.png', [0, 0, 255]), start: 3, end: null }],
      canvas, out: p('cut.mp4'), keepSound: true,
    })
    expect(r.durationSec).toBeCloseTo(4, 1)
    expect(r.hasSound).toBe(true)
    expect(r.shots.map(s => s.start)).toEqual([0, 2])
    const pr = await probeFile(p('cut.mp4'))
    expect(pr).toMatchObject({ width: 360, height: 640, hasAudio: true })
    // Sample the caption band at three times.
    const top = async (t: number) => {
      await ffmpeg(['-ss', String(t), '-i', p('cut.mp4'), '-frames:v', '1', p(`f${t}.png`)])
      const { data } = await sharp(p(`f${t}.png`)).extract({ left: 150, top: 20, width: 60, height: 30 }).raw().toBuffer({ resolveWithObject: true })
      let rr = 0, b = 0
      for (let i = 0; i < data.length; i += 3) { rr += data[i]!; b += data[i + 2]! }
      return { r: rr / (data.length / 3), b: b / (data.length / 3) }
    }
    const a = await top(0.5), mid = await top(2), end = await top(3.5)
    expect(a.r).toBeGreaterThan(200)
    expect(a.b).toBeLessThan(60)
    expect(end.b).toBeGreaterThan(200)
    expect(end.r).toBeLessThan(60)
    // Between them, the picture itself shows (neither caption).
    expect(mid.r > 200 && mid.b < 60).toBe(false)
    expect(mid.b > 200 && mid.r < 60).toBe(false)
  })

  it('silent shots give a silent cut unless one has sound', async () => {
    await makeClip(p('q1.mp4'), { width: 240, height: 426, fps: 24, durationSec: 1 })
    const r = await renderTimeline({ shots: [{ path: p('q1.mp4'), in: 0, out: null }], captions: [], canvas: { width: 240, height: 426, fps: 24 }, out: p('q.mp4'), keepSound: true })
    expect(r.hasSound).toBe(false)
    expect((await probeFile(p('q.mp4'))).hasAudio).toBe(false)
  })
})
