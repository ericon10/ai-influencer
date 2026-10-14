import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { addBroll, createContent, getContent, startRender, wordStarts, type ContentOutputs } from './content.js'
import { addClip } from './clips.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip, makeFigureClip } from '../media/testClips.js'
import { ffmpeg, probeFile } from '../media/ffmpeg.js'
import { segmentAvailable } from '../media/segment.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// Edit pack 2 in real posts: the green screen over a screenshot uploaded as
// B-roll, karaoke captions, the record scratch with its sound, split
// screen, text behind subject, and the Outline caption style.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string
let dir: string
let clipA: string
let clipB: string
let figure: string
let upl = 0

async function put(src: string, mime: string) {
  const uploadId = 'upl_' + String(upl++).padStart(20, 'f')
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), mime)
  return uploadId
}
async function upload(name: string, make: (path: string) => Promise<void>) {
  const src = join(dir, `${name}.mp4`)
  await make(src)
  return (await addClip(h.deps, h.ctx, { characterId, uploadId: await put(src, 'video/mp4'), name: `${name}.mp4` })).id
}
async function fileOf(assetId: string, name: string) {
  const p = join(dir, name)
  await writeFile(p, (await readAsset(h.deps, h.ctx, assetId)).data)
  return p
}
async function frameAt(video: string, t: number, name: string) {
  const f = join(dir, name)
  await ffmpeg(['-ss', String(t), '-i', video, '-frames:v', '1', f])
  return f
}
async function render(spec: Record<string, unknown>) {
  const id = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { sound: { ambience: 'none' }, ...spec } })).id
  await startRender(h.deps, h.ctx, id)
  await drain(h, 40)
  return getContent(h.deps, h.ctx, id)
}
// Pixels in a band that pass a test.
async function count(f: string, box: { left: number; top: number; width: number; height: number }, test: (r: number, g: number, b: number) => boolean) {
  const { data, info } = await sharp(f).extract(box).raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let i = 0; i < data.length; i += info.channels) if (test(data[i]!, data[i + 1]!, data[i + 2]!)) n++
  return n
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'editpack2-test-'))
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  clipA = await upload('a', p => makeClip(p, { width: 270, height: 480, fps: 24, durationSec: 2, source: 'testsrc2' }))
  clipB = await upload('b', p => makeClip(p, { width: 270, height: 480, fps: 24, durationSec: 3, source: 'smptebars' }))
  figure = await upload('figure', p => makeFigureClip(p, { width: 270, height: 480, fps: 24, durationSec: 3 }))
  await drain(h, 20)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('edit pack 2 in a post', () => {
  it('split screen plays shot A and shot B at once, as long as the longer one', async () => {
    const row = await render({ clipId: clipA, clipB, caption: 'before and after', edit: { style: 'split_screen' } })
    expect(row.status).toBe('ready')
    expect((row.outputs as ContentOutputs).durationSec).toBeCloseTo(3, 0)
  }, 180_000)

  it('the record scratch freezes, says its line, and the scratch is heard even with no other sound', async () => {
    const row = await render({ clipId: clipA, caption: 'my plan', edit: { style: 'record_scratch', payoff: 1 } })
    const out = row.outputs as ContentOutputs
    expect(out.durationSec).toBeCloseTo(4.2, 0)
    expect(out.sound?.layers).toContain('accent')
    const video = await fileOf(out.videoAssetId!, 'scratch.mp4')
    expect((await probeFile(video)).hasAudio).toBe(true)
    // The line shows in the upper third during the freeze.
    const f = await frameAt(video, 2, 'rs.png')
    expect(await count(f, { left: 100, top: 300, width: 880, height: 400 }, (r, g, b) => r > 235 && g > 235 && b > 235)).toBeGreaterThan(3000)
  }, 180_000)

  it('karaoke lights a different word as the caption plays', async () => {
    const row = await render({ clipId: clipB, caption: 'one two three four five six seven eight', edit: { style: 'karaoke' } })
    const video = await fileOf((row.outputs as ContentOutputs).videoAssetId!, 'karaoke.mp4')
    const yellowAt = async (t: number) => {
      const f = await frameAt(video, t, `k${t}.png`)
      const { data, info } = await sharp(f).extract({ left: 0, top: 250, width: 1080, height: 500 }).raw().toBuffer({ resolveWithObject: true })
      let sx = 0, n = 0
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i]! > 220 && data[i + 1]! > 180 && data[i + 2]! < 80) { sx += (i / info.channels) % info.width; n++ }
      }
      return n ? sx / n : -1
    }
    const early = await yellowAt(0.2), late = await yellowAt(2.6)
    expect(early).toBeGreaterThan(0)
    expect(late).toBeGreaterThan(0)
    expect(Math.abs(late - early)).toBeGreaterThan(60)
  }, 180_000)

  it('spreads word times by word length', () => {
    expect(wordStarts(['a', 'longer', 'b'], 0, 3)).toEqual([0, 0.545, 2.455])
  })

  it('the Outline caption style draws a black stroke instead of a white box', async () => {
    const box = await render({ clipId: clipB, caption: 'outline me please' })
    const outline = await render({ clipId: clipB, caption: 'outline me please', captionStyle: 'outline' })
    const band = { left: 200, top: 400, width: 680, height: 200 }
    const black = (r: number, g: number, b: number) => r < 30 && g < 30 && b < 30
    const fb = await frameAt(await fileOf((box.outputs as ContentOutputs).videoAssetId!, 'box.mp4'), 1, 'box.png')
    const fo = await frameAt(await fileOf((outline.outputs as ContentOutputs).videoAssetId!, 'outline.mp4'), 1, 'outline.png')
    const white = (r: number, g: number, b: number) => r > 240 && g > 240 && b > 240
    expect(await count(fo, band, white)).toBeLessThan(await count(fb, band, white))
    expect(await count(fo, band, black)).toBeGreaterThan(500)
  }, 180_000)

  it('the green screen says it needs a background, then puts her over a screenshot uploaded as B-roll', async () => {
    const id = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId: figure, caption: 'look at this', edit: { style: 'green_screen' } } })).id
    await expect(startRender(h.deps, h.ctx, id)).rejects.toThrow(/Pick B-roll or a screenshot/)
    if (!segmentAvailable(h.deps.env.STUDIO_MODELS_DIR)) return
    const shot = join(dir, 'screenshot.png')
    await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#2050d0' } }).png().toFile(shot)
    const broll = await addBroll(h.deps, h.ctx, { uploadId: await put(shot, 'image/png'), name: 'screenshot.png' })
    await drain(h, 10)
    const row = await render({ clipId: figure, brollId: broll.id, caption: 'look at this', edit: { style: 'green_screen' } })
    expect(row.status).toBe('ready')
    const out = row.outputs as ContentOutputs
    // The B-roll is behind her, not cut in: the video is as long as the clip.
    expect(out.durationSec).toBeCloseTo(3, 0)
    const f = await frameAt(await fileOf(out.videoAssetId!, 'green.mp4'), 1, 'g.png')
    expect(await count(f, { left: 0, top: 1000, width: 120, height: 200 }, (r, g, b) => b > r + 60 && b > g + 40)).toBeGreaterThan(15000)
  }, 180_000)

  it.skipIf(!segmentAvailable('.data/models'))('text behind subject renders with her outline', async () => {
    const row = await render({ clipId: figure, caption: 'wait for it', edit: { style: 'text_behind' } })
    expect(row.status).toBe('ready')
    expect((row.outputs as ContentOutputs).editNote ?? '').not.toMatch(/No person/)
  }, 180_000)
})
