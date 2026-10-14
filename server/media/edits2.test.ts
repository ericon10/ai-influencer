import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { ffmpeg, probeFile } from './ffmpeg.js'
import { sharpness } from './frames.js'
import { applyEdit, mapTime, overlayBehind, type EditInput } from './edits.js'
import { personMaskVideo, segmentAvailable } from './segment.js'
import { applySoundBed, makeScratch, measureLoudness } from './sound.js'
import { renderTimeline } from './timeline.js'
import { makeClip, makeFigureClip } from './testClips.js'

// Edit pack 2 (overnight run): each new edit checked on real frames.

let dir: string
const p = (name: string) => join(dir, name)
const canvas = { width: 270, height: 480, fps: 24 }
const MODELS = '.data/models'
let twoShot: string
let oneShot: string
let figure: string
let figureMask: string | null = null

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
async function pixel(f: string, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i]!, data[i + 1]!, data[i + 2]!]
}
async function saturation(f: string) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true })
  let s = 0
  for (let i = 0; i < data.length; i += info.channels) s += Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!)
  return s / (data.length / info.channels)
}
const edit = (style: EditInput['style'], video: string, out: string, params: Record<string, number> = {}, extra: Partial<EditInput> = {}) =>
  applyEdit({ style, video, out: p(out), workDir: dir, canvas, params, cuts: [], payoff: 1.5, ...extra })

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edits2-test-'))
  await makeClip(p('a.mp4'), { width: 270, height: 480, fps: 24, durationSec: 2, source: 'testsrc2' })
  await makeClip(p('b.mp4'), { width: 270, height: 480, fps: 24, durationSec: 2, source: 'smptebars' })
  twoShot = p('two.mp4')
  await renderTimeline({ shots: [{ path: p('a.mp4'), in: 0, out: null }, { path: p('b.mp4'), in: 0, out: null }], captions: [], canvas, out: twoShot, keepSound: false })
  oneShot = p('one.mp4')
  await makeClip(oneShot, { width: 270, height: 480, fps: 24, durationSec: 3, source: 'testsrc2' })
  figure = p('figure.mp4')
  await makeFigureClip(figure, { width: 270, height: 480, fps: 24, durationSec: 3 })
  if (segmentAvailable(MODELS)) {
    figureMask = p('figure-mask.mp4')
    await personMaskVideo(figure, figureMask, { modelsDir: MODELS, fps: 24 })
  }
}, 180_000)
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('time edits', () => {
  it('velocity: fast between hits, slow on them; the time map runs forward and matches the file', async () => {
    const r = await edit('velocity', oneShot, 'velocity.mp4', { fast: 2, slow: 0.4, window: 0.5, every: 1 })
    expect(r.note).toMatch(/slow-motion hits/)
    expect((await probeFile(p('velocity.mp4'))).durationSec).toBeCloseTo(r.durationSec, 0)
    for (let i = 1; i < r.timeMap.length; i++) expect(r.timeMap[i]![1]).toBeGreaterThanOrEqual(r.timeMap[i - 1]![1])
    expect(mapTime(r.timeMap, 3)).toBeCloseTo(r.durationSec, 1)
  }, 120_000)

  it('record scratch: the frame holds, drains of color, and asks for a scratch', async () => {
    const r = await edit('record_scratch', oneShot, 'scratch.mp4', { seconds: 1.5, color: 0, zoom: 1.08 }, { payoff: 1 })
    expect(r.durationSec).toBeCloseTo(4.5, 1)
    expect(r.accents).toEqual([{ kind: 'scratch', at: 1 }])
    const during = await frame(p('scratch.mp4'), 1.6, 'rs1.png'), before = await frame(p('scratch.mp4'), 0.5, 'rs0.png')
    expect(await saturation(during)).toBeLessThan((await saturation(before)) * 0.3)
  }, 60_000)
})

describe('camera and hits', () => {
  it('snap zoom: two instant steps in, then back to the full frame', async () => {
    await edit('snap_zoom', oneShot, 'snap.mp4', { gap: 0.3, hold: 0.6, zoom1: 1.3, zoom2: 1.7 }, { payoff: 1 })
    const src1 = await frame(oneShot, 1.15, 'sn0.png'), out1 = await frame(p('snap.mp4'), 1.15, 'sn1.png')
    const src2 = await frame(oneShot, 1.5, 'sn2.png'), out2 = await frame(p('snap.mp4'), 1.5, 'sn3.png')
    expect(await diff(src1, out1)).toBeGreaterThan(0.04)
    expect(await diff(src2, out2)).toBeGreaterThan(await diff(src1, out1))
    expect(await diff(await frame(oneShot, 2.6, 'sn4.png'), await frame(p('snap.mp4'), 2.6, 'sn5.png'))).toBeLessThan(0.03)
  }, 60_000)

  it('glitch: frames around the hit are shifted and noisy, the rest untouched', async () => {
    await edit('glitch', twoShot, 'glitch.mp4', { seconds: 0.4, shift: 20 }, { cuts: [2] })
    expect(await diff(await frame(twoShot, 1.95, 'g0.png'), await frame(p('glitch.mp4'), 1.95, 'g1.png'))).toBeGreaterThan(0.03)
    expect(await diff(await frame(twoShot, 1, 'g2.png'), await frame(p('glitch.mp4'), 1, 'g3.png'))).toBeLessThan(0.03)
    expect((await probeFile(p('glitch.mp4'))).durationSec).toBeCloseTo(4, 1)
  }, 60_000)
})

describe('two-shot edits', () => {
  it('zoom-rotate spin: blurred and turned at the cut, never black in the corners', async () => {
    await edit('spin', twoShot, 'spin.mp4', { seconds: 0.3, angle: 90, zoom: 1.4 }, { cuts: [2] })
    const near = await frame(p('spin.mp4'), 1.96, 's0.png')
    expect(await sharpness(near)).toBeLessThan((await sharpness(await frame(p('spin.mp4'), 1.2, 's1.png'))) * 0.8)
    for (const [x, y] of [[2, 2], [267, 2], [2, 477], [267, 477]] as const) {
      const [r, g, b] = await pixel(near, x, y)
      expect(r + g + b).toBeGreaterThan(30)
    }
    expect((await probeFile(p('spin.mp4'))).durationSec).toBeCloseTo(4, 1)
  }, 60_000)

  it('split screen: shot A on top and shot B below at once (or side by side)', async () => {
    const r = await edit('split_screen', twoShot, 'split.mp4', { gap: 8 }, { cuts: [2] })
    expect(r.durationSec).toBeCloseTo(2, 1)
    const f = await frame(p('split.mp4'), 0.5, 'sp.png')
    const top = await sharp(f).extract({ left: 0, top: 0, width: 270, height: 230 }).png().toBuffer()
    const bottom = await sharp(f).extract({ left: 0, top: 250, width: 270, height: 230 }).png().toBuffer()
    const a = await sharp(await frame(twoShot, 0.5, 'spa.png')).resize(270, 230, { fit: 'cover' }).png().toBuffer()
    const b = await sharp(await frame(twoShot, 2.5, 'spb.png')).resize(270, 230, { fit: 'cover' }).png().toBuffer()
    const d = async (x: Buffer, y: Buffer) => { const [u, v] = await Promise.all([x, y].map(z => sharp(z).resize(54, 46, { fit: 'fill' }).greyscale().raw().toBuffer())); let s = 0; for (let i = 0; i < u!.length; i++) s += Math.abs(u![i]! - v![i]!); return s / u!.length / 255 }
    expect(await d(top, a)).toBeLessThan(await d(top, b))
    expect(await d(bottom, b)).toBeLessThan(await d(bottom, a))
    const side = await edit('split_screen', twoShot, 'side.mp4', { gap: 8 }, { cuts: [2], variant: 'side' })
    expect(side.note).toMatch(/side by side/)
  }, 60_000)
})

describe.skipIf(!segmentAvailable(MODELS))('edits behind her (the person mask)', () => {
  it('finds the drawn figure: white on her, black on the room', async () => {
    const m = await frame(figureMask!, 1, 'm.png')
    const { data, info } = await sharp(m).greyscale().raw().toBuffer({ resolveWithObject: true })
    expect(data[Math.round(info.height * 0.47) * info.width + 135]).toBeGreaterThan(200)
    expect(data[10 * info.width + 10]).toBeLessThan(40)
  })

  it('dolly zoom: the room pushes in, she stays the same size', async () => {
    await edit('dolly_zoom', figure, 'dolly.mp4', { seconds: 1.5, zoom: 1.5 }, { payoff: 1, mask: figureMask! })
    const src = await frame(figure, 2.4, 'd0.png'), out = await frame(p('dolly.mp4'), 2.4, 'd1.png')
    const crop = (f: string, top: number) => sharp(f).extract({ left: 0, top, width: 270, height: 60 }).greyscale().resize(54, 12, { fit: 'fill' }).raw().toBuffer()
    const roomA = await crop(src, 0), roomB = await crop(out, 0)
    let room = 0
    for (let i = 0; i < roomA.length; i++) room += Math.abs(roomA[i]! - roomB[i]!)
    expect(room / roomA.length).toBeGreaterThan(4)
    const [fr, fg, fb] = await pixel(out, 135, Math.round(480 * 0.47))
    const [sr, sg, sb] = await pixel(src, 135, Math.round(480 * 0.47))
    expect(Math.abs(fr - sr) + Math.abs(fg - sg) + Math.abs(fb - sb)).toBeLessThan(40)
  }, 120_000)

  it('green screen: the background behind her, her at the bottom', async () => {
    await sharp({ create: { width: 540, height: 960, channels: 3, background: '#20a040' } }).png().toFile(p('shot.png'))
    const r = await edit('green_screen', figure, 'green.mp4', { scale: 0.7 }, { mask: figureMask!, background: p('shot.png') })
    expect(r.durationSec).toBeCloseTo(3, 1)
    const f = await frame(p('green.mp4'), 1, 'gs.png')
    const [r1, g1, b1] = await pixel(f, 135, 20)
    expect(g1).toBeGreaterThan(r1 + 40)
    expect(g1).toBeGreaterThan(b1 + 40)
    // Her face is lower and smaller than in the clip.
    const [fr] = await pixel(f, 135, Math.round(480 - 480 * 0.7 * (1 - 0.47)))
    expect(fr).toBeGreaterThan(180)
  }, 60_000)

  it('text behind subject: the words show over the room and hide behind her', async () => {
    const caption = p('cap.png')
    // A full-width white bar across her face.
    await sharp({ create: { width: 270, height: 480, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 270, height: 30, channels: 4, background: '#ffffff' } }).png().toBuffer(), left: 0, top: Math.round(480 * 0.47) - 15 }]).png().toFile(caption)
    await overlayBehind({ video: figure, mask: figureMask!, out: p('behind.mp4'), canvas, captions: [{ png: caption, start: 0, end: null }] })
    const f = await frame(p('behind.mp4'), 1, 'tb.png')
    const [rr, gg, bb] = await pixel(f, 10, Math.round(480 * 0.47))
    expect(rr + gg + bb).toBeGreaterThan(740)
    const [fr, fg, fb] = await pixel(f, 135, Math.round(480 * 0.47))
    expect(fr + fg + fb).toBeLessThan(700)
  }, 60_000)
})

describe('sound accents', () => {
  it('a record scratch is mixed in at its time', async () => {
    await makeScratch(p('scratch.wav'))
    expect((await measureLoudness(p('scratch.wav'))).i).toBeGreaterThan(-35)
    await makeClip(p('silent.mp4'), { width: 270, height: 480, fps: 24, durationSec: 3 })
    const r = await applySoundBed({
      video: p('silent.mp4'), out: p('bed.mp4'), workDir: dir, clipSound: false, ambience: null, music: null,
      levels: { target: -14, truePeak: -1, ambienceAlone: -28, ambience: -30, music: -20, duck: { threshold: 0.05, ratio: 6, attackMs: 20, releaseMs: 300 } },
      accents: [{ path: p('scratch.wav'), at: 1.5 }],
    })
    expect(r.layers).toContain('accent')
    const quiet = p('q.wav'), loud = p('l.wav')
    await ffmpeg(['-ss', '0.2', '-t', '1', '-i', p('bed.mp4'), quiet])
    await ffmpeg(['-ss', '1.5', '-t', '0.5', '-i', p('bed.mp4'), loud])
    expect((await measureLoudness(loud)).i).toBeGreaterThan((await measureLoudness(quiet)).i + 20)
  }, 60_000)
})
