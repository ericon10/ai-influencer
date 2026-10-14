import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { ffmpeg, probeFile } from './ffmpeg.js'
import { sharpness } from './frames.js'
import { applyEdit, atempoChain, detectBeats, mapTime, type EditInput } from './edits.js'
import { renderTimeline } from './timeline.js'
import { makeClip } from './testClips.js'

// Phase 5: the code-rendered edits, each checked on real frames.

let dir: string
const p = (name: string) => join(dir, name)
const canvas = { width: 270, height: 480, fps: 24 }
let twoShot: string
let oneShot: string

async function frame(video: string, t: number, name: string) {
  await ffmpeg(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', p(name)])
  return p(name)
}
async function diff(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map(f => sharp(f).resize(72, 128, { fit: 'fill' }).greyscale().raw().toBuffer()))
  let s = 0
  for (let i = 0; i < x!.length; i++) s += Math.abs(x![i]! - y![i]!)
  return s / x!.length / 255
}
async function luma(f: string) {
  const s = await sharp(f).greyscale().stats()
  return s.channels[0]!.mean
}
const edit = (style: EditInput['style'], video: string, out: string, params: Record<string, number> = {}, extra: Partial<EditInput> = {}) =>
  applyEdit({ style, video, out: p(out), workDir: dir, canvas, params, cuts: [], payoff: 1.5, ...extra })

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edits-test-'))
  await makeClip(p('a.mp4'), { width: 270, height: 480, fps: 24, durationSec: 2, source: 'testsrc2' })
  await makeClip(p('b.mp4'), { width: 270, height: 480, fps: 24, durationSec: 2, source: 'smptebars' })
  twoShot = p('two.mp4')
  await renderTimeline({ shots: [{ path: p('a.mp4'), in: 0, out: null }, { path: p('b.mp4'), in: 0, out: null }], captions: [], canvas, out: twoShot, keepSound: false })
  oneShot = p('one.mp4')
  await makeClip(oneShot, { width: 270, height: 480, fps: 24, durationSec: 3, source: 'testsrc2' })
}, 120_000)
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('two-shot edits', () => {
  it('crash zoom: the end of shot A rushes in, then a hard cut to B', async () => {
    const r = await edit('crash_zoom', twoShot, 'crash.mp4', { seconds: 0.6, zoom: 3 }, { cuts: [2] })
    expect(r.durationSec).toBeCloseTo(4, 1)
    expect((await probeFile(p('crash.mp4'))).durationSec).toBeCloseTo(4, 1)
    // Before the zoom: untouched. At the end of A: zoomed far in. After the cut: B as it was.
    expect(await diff(await frame(twoShot, 1.2, 's1.png'), await frame(p('crash.mp4'), 1.2, 'e1.png'))).toBeLessThan(0.03)
    expect(await diff(await frame(twoShot, 1.95, 's2.png'), await frame(p('crash.mp4'), 1.95, 'e2.png'))).toBeGreaterThan(0.08)
    expect(await diff(await frame(twoShot, 2.5, 's3.png'), await frame(p('crash.mp4'), 2.5, 'e3.png'))).toBeLessThan(0.03)
  }, 60_000)

  it('whip pan: blur peaks at the cut on both sides', async () => {
    await edit('whip_pan', twoShot, 'whip.mp4', { seconds: 0.16, shift: 0.3, blur: 40 }, { cuts: [2] })
    const near = await sharpness(await frame(p('whip.mp4'), 1.97, 'w1.png'))
    const far = await sharpness(await frame(p('whip.mp4'), 1.3, 'w2.png'))
    const after = await sharpness(await frame(p('whip.mp4'), 2.01, 'w3.png'))
    const later = await sharpness(await frame(p('whip.mp4'), 2.8, 'w4.png'))
    expect(near).toBeLessThan(far * 0.7)
    expect(after).toBeLessThan(later * 0.7)
    expect((await probeFile(p('whip.mp4'))).durationSec).toBeCloseTo(4, 1)
  }, 60_000)

  it('hand over the lens: cuts between the darkest frames when the lens is covered', async () => {
    await makeClip(p('ha.mp4'), { width: 270, height: 480, fps: 24, durationSec: 2, source: 'testsrc2', vf: 'fade=t=out:st=1.5:d=0.12' })
    await makeClip(p('hb.mp4'), { width: 270, height: 480, fps: 24, durationSec: 2, source: 'smptebars', vf: 'fade=t=in:st=0.3:d=0.12' })
    await renderTimeline({ shots: [{ path: p('ha.mp4'), in: 0, out: null }, { path: p('hb.mp4'), in: 0, out: null }], captions: [], canvas, out: p('hand-src.mp4'), keepSound: false })
    const r = await edit('hand_lens', p('hand-src.mp4'), 'hand.mp4', { search: 1 }, { cuts: [2] })
    expect(r.note).toMatch(/dark frame/)
    // The black tail of A and black head of B are mostly cut out.
    expect(r.durationSec).toBeLessThan(3.5)
    expect((await probeFile(p('hand.mp4'))).durationSec).toBeCloseTo(r.durationSec, 1)
    // No dark frames (the lens never covered): a short dip to black instead.
    const dip = await edit('hand_lens', twoShot, 'hand-dip.mp4', { search: 1, dip: 0.2 }, { cuts: [2] })
    expect(dip.note).toMatch(/dip to black/)
    expect(dip.durationSec).toBeCloseTo(4, 1)
    expect(await luma(await frame(p('hand-dip.mp4'), 1.99, 'hd.png'))).toBeLessThan(40)
  }, 60_000)

  it('refuses a two-shot edit on one shot, in plain words', async () => {
    await expect(edit('crash_zoom', oneShot, 'x.mp4')).rejects.toThrow(/needs two shots/)
  })
})

describe('one-shot edits', () => {
  it('zoom-out reveal: tight at the start, the full frame after', async () => {
    await edit('zoom_reveal', oneShot, 'reveal.mp4', { seconds: 1.2, zoom: 2.4 })
    expect(await diff(await frame(oneShot, 0.05, 'r0.png'), await frame(p('reveal.mp4'), 0.05, 'r1.png'))).toBeGreaterThan(0.08)
    expect(await diff(await frame(oneShot, 1.8, 'r2.png'), await frame(p('reveal.mp4'), 1.8, 'r3.png'))).toBeLessThan(0.03)
  }, 60_000)

  it('punch-in: zoomed inside a beat window, normal between', async () => {
    const r = await edit('punch_in', oneShot, 'punch.mp4', { zoom: 1.2, every: 1 })
    expect(r.note).toMatch(/punch-ins/)
    expect(await diff(await frame(oneShot, 0.8, 'pu0.png'), await frame(p('punch.mp4'), 0.8, 'pu1.png'))).toBeGreaterThan(0.04)
    expect(await diff(await frame(oneShot, 1.8, 'pu2.png'), await frame(p('punch.mp4'), 1.8, 'pu3.png'))).toBeLessThan(0.03)
  }, 60_000)

  it('speed ramp: the payoff plays slower, so the video gets longer by the right amount', async () => {
    const r = await edit('speed_ramp', oneShot, 'ramp.mp4', { seconds: 1, speed: 0.4 }, { payoff: 1 })
    const pr = await probeFile(p('ramp.mp4'))
    expect(r.durationSec).toBeGreaterThan(4)
    expect(pr.durationSec).toBeCloseTo(r.durationSec, 0)
    // Captions after the payoff move later by the same amount.
    expect(mapTime(r.timeMap, 2.5)).toBeCloseTo(2.5 + (r.durationSec - 3), 1)
  }, 120_000)

  it('freeze: the payoff holds still for the set time', async () => {
    const r = await edit('freeze_pop', oneShot, 'freeze.mp4', { seconds: 1 }, { payoff: 1.5 })
    expect(r.durationSec).toBeCloseTo(4, 1)
    expect((await probeFile(p('freeze.mp4'))).durationSec).toBeCloseTo(4, 1)
    expect(await diff(await frame(p('freeze.mp4'), 1.7, 'f1.png'), await frame(p('freeze.mp4'), 2.3, 'f2.png'))).toBeLessThan(0.005)
    expect(mapTime(r.timeMap, 2)).toBeCloseTo(3, 1)
    expect(mapTime(r.timeMap, 1)).toBeCloseTo(1, 2)
  }, 60_000)

  it('flash and shake: a white flash right on the cut', async () => {
    await edit('flash_shake', twoShot, 'flash.mp4', { flash: 0.14, shake: 18, seconds: 0.4 }, { cuts: [2] })
    expect(await luma(await frame(p('flash.mp4'), 2.02, 'fl1.png'))).toBeGreaterThan(200)
    expect(await luma(await frame(p('flash.mp4'), 2.6, 'fl2.png'))).toBeLessThan(200)
  }, 60_000)

  it('seamless loop: ends on the frame most like the first', async () => {
    // A picture that comes back to its first frame every 1.5 s.
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=1:duration=1', '-frames:v', '1', p('still.png')])
    await ffmpeg(['-loop', '1', '-i', p('still.png'), '-vf', "zoompan=z='1+0.5*pow(sin(PI*it/1.5),2)':d=1:s=270x480:fps=24", '-t', '3.3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', p('periodic.mp4')])
    const r = await edit('seamless_loop', p('periodic.mp4'), 'loop.mp4', { min_share: 0.6 })
    expect(r.durationSec).toBeGreaterThan(2.8)
    expect(r.durationSec).toBeLessThan(3.2)
    expect(r.note).toMatch(/Loops at/)
  }, 60_000)

  it('word pop leaves the picture alone (the captions pop)', async () => {
    const r = await edit('word_pop', oneShot, 'words.mp4')
    expect(r.durationSec).toBeCloseTo(3, 1)
  })

  it('keeps the clip\'s own sound, slowed with the picture', async () => {
    await makeClip(p('voiced.mp4'), { width: 270, height: 480, fps: 24, durationSec: 3, audio: true })
    const r = await edit('speed_ramp', p('voiced.mp4'), 'voiced-ramp.mp4', { seconds: 1, speed: 0.5 }, { payoff: 1 })
    const pr = await probeFile(p('voiced-ramp.mp4'))
    expect(pr.hasAudio).toBe(true)
    expect(pr.durationSec).toBeCloseTo(r.durationSec, 0)
  }, 120_000)
})

describe('helpers', () => {
  it('finds the beat of a click track', async () => {
    await ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t\\,0.5)\\,0.02)\\,sin(2*PI*1000*t)\\,0)':s=44100:d=6", p('clicks.wav')])
    const beats = await detectBeats(p('clicks.wav'), 6)
    expect(beats.length).toBeGreaterThan(8)
    const gaps = beats.slice(1).map((b, i) => b - beats[i]!)
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
  })

  it('chains atempo for slow speeds, and maps times through an edit', () => {
    expect(atempoChain(0.4)).toBe('atempo=0.5,atempo=0.8000')
    expect(atempoChain(1)).toBe('atempo=1.0000')
    const map: Array<[number, number]> = [[0, 0], [1, 1], [2, 3], [4, 5]]
    expect(mapTime(map, 0.5)).toBe(0.5)
    expect(mapTime(map, 1.5)).toBe(2)
    expect(mapTime(map, 3)).toBe(4)
    expect(mapTime(map, 5)).toBe(6)
  })
})
