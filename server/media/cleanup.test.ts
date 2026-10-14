import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { captionPng } from '../core/overlay.js'
import { cleanClip, detectEndCard, detectOverlays, mergeBoxes } from './cleanup.js'
import { ffmpeg, probeFile } from './ffmpeg.js'

// Clone source cleanup (overnight item 3) on a clip made like a saved
// TikTok: a moving picture, a burned-in caption box in the upper third, a
// handle watermark that jumps from the top left to the bottom right
// halfway, and 2 s of end card (black, a small logo line in the middle).

let dir: string, clip: string
const cfg = loadConfig().pipeline.content

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cleanup-'))
  const caption = join(dir, 'caption.png'), handle = join(dir, 'handle.png'), card = join(dir, 'card.png')
  await writeFile(caption, (await captionPng('when the drop finally hits and you cannot stop', cfg)).png)
  await writeFile(handle, (await captionPng('@callie.jobs', { ...cfg, caption: { ...cfg.caption, style: 'outline', size: 40 } })).png)
  await writeFile(card, (await captionPng('TikTok @callie.jobs', { ...cfg, caption: { ...cfg.caption, style: 'outline', size: 44, position: 'middle' } })).png)
  const body = join(dir, 'body.mp4'), end = join(dir, 'end.mp4')
  // A moving picture, like a phone in a hand: a slow pan over a busy test
  // pattern with drifting noise.
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x960:rate=30:duration=6', '-i', caption, '-i', handle,
    '-filter_complex', "[0:v]crop=540:960:x='t*80':y=0,noise=alls=40:allf=t,hue=H=t*1.5[bg];[1:v]scale=540:960[cap];[2:v]scale=540:960,crop=540:300:0:200[h];[bg][cap]overlay=0:0[a];[a][h]overlay=x='if(lt(t,3),150,-150)':y='if(lt(t,3),-20,560)'[v]",
    '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', body])
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=black:s=540x960:r=30:d=2', '-i', card, '-filter_complex', '[1:v]scale=540:960[c];[0:v][c]overlay=0:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', end])
  clip = join(dir, 'tiktok.mp4')
  await ffmpeg(['-y', '-i', body, '-i', end, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
}, 120_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('cleaning a clip before cloning', () => {
  it('finds the end card', async () => {
    const at = await detectEndCard(clip)
    expect(at).not.toBeNull()
    expect(Math.abs(at! - 6)).toBeLessThan(0.3)
  })

  it('finds the burned-in caption for the whole clip, and the handle where it sits', async () => {
    const boxes = await detectOverlays(clip, { until: await detectEndCard(clip) })
    const caption = boxes.find(b => b.y > 960 * 0.15 && b.y < 960 * 0.45 && b.w > 540 * 0.4 && b.h < 960 * 0.2 && b.start < 0.5 && b.end > 5.5)
    expect(caption, JSON.stringify(boxes)).toBeTruthy()
    // The handle: top right in the first half, bottom left in the second.
    expect(boxes.some(b => b.x > 200 && b.y < 960 * 0.15 && b.start < 1 && b.end <= 4), JSON.stringify(boxes)).toBe(true)
    expect(boxes.some(b => b.x < 250 && b.y > 960 * 0.5 && b.start >= 2 && b.end > 5), JSON.stringify(boxes)).toBe(true)
    expect(boxes.length).toBeLessThan(12)
  }, 60_000)

  it('cuts the end card and fills the text in from around it', async () => {
    const boxes = await detectOverlays(clip, { until: await detectEndCard(clip) })
    const out = join(dir, 'clean.mp4')
    await cleanClip(clip, out, { endAt: await detectEndCard(clip), boxes })
    const p = await probeFile(out)
    expect(p.durationSec!).toBeGreaterThan(5.6)
    expect(p.durationSec!).toBeLessThan(6.4)
    // Inside the caption box, the sharp text edges are gone.
    const edges = async (file: string) => {
      const raw = join(dir, `${file.split('/').pop()}.gray`)
      const b = boxes.find(x => x.y < 960 * 0.45 && x.w > 200)!
      await ffmpeg(['-y', '-ss', '2', '-i', file, '-frames:v', '1', '-vf', `crop=${b.w}:${b.h}:${b.x}:${b.y},format=gray`, '-f', 'rawvideo', raw])
      const g = new Uint8Array(await readFile(raw))
      let e = 0
      for (let i = 1; i < g.length; i++) e += Math.abs(g[i]! - g[i - 1]!)
      return e / g.length
    }
    expect(await edges(out)).toBeLessThan((await edges(clip)) * 0.6)
  }, 120_000)

  it('joins a box seen in back-to-back windows', () => {
    expect(mergeBoxes([{ x: 10, y: 10, w: 100, h: 20, start: 0, end: 2 }, { x: 12, y: 11, w: 100, h: 20, start: 1, end: 3 }, { x: 300, y: 500, w: 50, h: 10, start: 0, end: 2 }]))
      .toEqual([{ x: 10, y: 10, w: 102, h: 21, start: 0, end: 3 }, { x: 300, y: 500, w: 50, h: 10, start: 0, end: 2 }])
  })
})
