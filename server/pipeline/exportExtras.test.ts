import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { createContent, getContent, startCover, startRender, startVariants, updateContent, type ContentOutputs } from './content.js'
import { addClip } from './clips.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { ffmpeg, probeFile } from '../media/ffmpeg.js'
import { capBitrate } from '../media/bitrate.js'
import { measureLoudness, normalizeLoudness } from '../media/sound.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// Long run part 4 on the worker (free): Export for (length, bitrate,
// loudness), hook variants from one timeline, and the cover.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness, characterId: string, clipId: string, dir: string

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'export-extras-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  const src = join(dir, 'clip.mp4')
  await makeClip(src, { width: 540, height: 960, fps: 30, durationSec: 5, source: 'testsrc2' })
  const uploadId = 'upl_' + 'e'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  clipId = (await addClip(h.deps, h.ctx, { characterId, uploadId, name: 'clip.mp4' })).id
  await drain(h, 20)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

async function probe(assetId: string) {
  const p = join(dir, `${assetId}.mp4`)
  await writeFile(p, (await readAsset(h.deps, h.ctx, assetId)).data)
  return { ...(await probeFile(p)), path: p }
}

describe('the media steps', () => {
  it('the bitrate cap encodes a file over it again and copies one under it', async () => {
    const big = join(dir, 'big.mp4'), out = join(dir, 'big-capped.mp4'), out2 = join(dir, 'big-copy.mp4')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=2', '-vf', 'noise=alls=60:allf=t', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', big])
    const r = await capBitrate(big, out, 4000)
    expect(r.capped).toBe(true)
    const kbps = ((await readFile(out)).length * 8) / 2 / 1000
    expect(kbps).toBeLessThan(4000 * 1.6)
    expect((await capBitrate(out, out2, 400_000)).capped).toBe(false)
  }, 120_000)
  it('the loudness pass brings the sound to the preset', async () => {
    const quiet = join(dir, 'quiet.mp4'), out = join(dir, 'loud.mp4')
    await ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=320x568:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-af', 'volume=-30dB', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', quiet])
    expect((await normalizeLoudness(quiet, out, -14, -1)).lufs).toBe(-14)
    expect((await measureLoudness(out)).i).toBeCloseTo(-14, 0)
  }, 60_000)
})

describe('Export for, hook variants and the cover (a video post)', () => {
  let postId: string
  it('Shorts caps the length at 60 s and the post says what it was made for', async () => {
    postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId } })).id
    await updateContent(h.deps, h.ctx, postId, { spec: { caption: 'the payoff line', exportPreset: 'shorts' } })
    await startRender(h.deps, h.ctx, postId)
    await drain(h, 20)
    const out = (await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs
    expect(out.preset).toBe('shorts')
    const p = await probe(out.videoAssetId!)
    expect(p).toMatchObject({ width: 1080, height: 1920 })
    expect(p.durationSec!).toBeLessThanOrEqual(60.1)
  }, 180_000)
  it('three hooks make three versions of the same timeline, each with its own first 2 seconds', async () => {
    await updateContent(h.deps, h.ctx, postId, { spec: { hookVariants: ['nobody warned me', 'day 1 of this', ''] } })
    await expect(startVariants(h.deps, h.ctx, postId)).resolves.toMatchObject({ jobId: expect.stringMatching(/^job_/) })
    expect(((await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs).variantsRunning).toBe(true)
    await drain(h, 30)
    const out = (await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs
    expect(out.variantsRunning).toBe(false)
    expect(out.variants!.map(v => v.hook)).toEqual(['nobody warned me', 'day 1 of this'])
    // The post's own export is left as it was.
    expect(out.videoAssetId).toBeTruthy()
    // Same length; different first frames (the hook), the same later frames.
    const [a, b] = await Promise.all(out.variants!.map(v => probe(v.assetId)))
    expect(Math.abs(a!.durationSec! - b!.durationSec!)).toBeLessThan(0.1)
    const frame = async (path: string, t: number) => { const f = `${path}.${t}.png`; await ffmpeg(['-ss', String(t), '-i', path, '-frames:v', '1', f]); return sharp(f).raw().toBuffer() }
    const diff = (x: Buffer, y: Buffer) => { let d = 0; for (let i = 0; i < x.length; i += 97) d += Math.abs(x[i]! - y[i]!); return d / (x.length / 97) }
    expect(diff(await frame(a!.path, 1), await frame(b!.path, 1))).toBeGreaterThan(1)
    expect(diff(await frame(a!.path, 3.5), await frame(b!.path, 3.5))).toBeLessThan(1)
    // Nothing to export without a hook.
    await updateContent(h.deps, h.ctx, postId, { spec: { hookVariants: [] } })
    await expect(startVariants(h.deps, h.ctx, postId)).rejects.toThrow(/Write a hook, or pick a first shot or a first edit/)
  }, 240_000)
  it('a version can open on another shot (a still here) or with a camera preset, the rest unchanged', async () => {
    const still = await saveAsset(h.deps, h.ctx, { data: await renderPlaceholderPortrait('another shot'), mime: 'image/png', origin: 'derived', label: 'Another shot' })
    await updateContent(h.deps, h.ctx, postId, { spec: { hookVariants: ['', ''], hookShots: [still.id, null], hookEdits: [null, 'crash_zoom'] } })
    await startVariants(h.deps, h.ctx, postId)
    await drain(h, 30)
    const out = (await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs
    expect(out.variants!.map(v => [v.letter, v.shot, v.edit])).toEqual([['A', still.id, null], ['B', null, 'crash_zoom']])
    const [own, a, b] = await Promise.all([probe(out.videoAssetId!), ...out.variants!.map(v => probe(v.assetId))])
    expect(Math.abs(a!.durationSec! - own.durationSec!)).toBeLessThan(0.15)
    expect(Math.abs(b!.durationSec! - own.durationSec!)).toBeLessThan(0.15)
    const frame = async (path: string, t: number) => { const f = `${path}.h${t}.png`; await ffmpeg(['-ss', String(t), '-i', path, '-frames:v', '1', f]); return sharp(f).raw().toBuffer() }
    const diff = (x: Buffer, y: Buffer) => { let d = 0; for (let i = 0; i < x.length; i += 97) d += Math.abs(x[i]! - y[i]!); return d / (x.length / 97) }
    // A: the still for the first 2 seconds, then the same video.
    expect(diff(await frame(a!.path, 1), await frame(own.path, 1))).toBeGreaterThan(5)
    expect(diff(await frame(a!.path, 3.5), await frame(own.path, 3.5))).toBeLessThan(1.5)
    // B: the crash zoom at the start, then the same video. A camera preset
    // sends the whole picture through the camera pass (one more encode), so
    // the later frames are compared with that small loss as the baseline.
    const early = diff(await frame(b!.path, 0.3), await frame(own.path, 0.3))
    const later = diff(await frame(b!.path, 3.5), await frame(own.path, 3.5))
    expect(later).toBeLessThan(10)
    expect(early).toBeGreaterThan(later * 2)
    // Another account's asset is refused.
    await updateContent(h.deps, h.ctx, postId, { spec: { hookShots: ['ast_' + 'x'.repeat(22)], hookEdits: [] } })
    await expect(startVariants(h.deps, h.ctx, postId)).rejects.toThrow(/not found/i)
  }, 300_000)
  it('the cover is a 1080 x 1920 JPEG of the chosen frame with its text', async () => {
    await startCover(h.deps, h.ctx, postId, { at: 1.2, text: 'day 1 of trying' })
    await drain(h, 10)
    const out = (await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs
    expect(out.cover).toMatchObject({ at: 1.2, text: 'day 1 of trying' })
    const img = (await readAsset(h.deps, h.ctx, out.cover!.assetId)).data
    expect(await sharp(img).metadata()).toMatchObject({ format: 'jpeg', width: 1080, height: 1920 })
    expect(((await getContent(h.deps, h.ctx, postId)).spec as { cover?: unknown }).cover).toEqual({ at: 1.2, text: 'day 1 of trying' })
  }, 120_000)
  it('no cover before the video is exported', async () => {
    const fresh = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId } })).id
    await expect(startCover(h.deps, h.ctx, fresh, { at: 0, text: '' })).rejects.toThrow(/Export the video first/)
  })
})
