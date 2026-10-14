import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { candidates } from '../db/schema.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { contentView, createContent, getContent, startRender, type ContentOutputs, type MemeSpec } from './content.js'
import { addClip } from './clips.js'
import { closeupBox, makeCloseup } from './closeup.js'
import { postCutView } from './cutView.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { ffmpeg, probeFile } from '../media/ffmpeg.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// Phase 5 in a real post: the edit renders between the picture and the
// captions; two-shot edits use shot B; word pop and freeze pop make their
// own captions; batches take one-shot edits; Make the close-up crops shot
// A's last frame for free.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string
let dir: string
let clipA: string
let clipB: string
let upl = 0

async function upload(name: string, source: string, seconds = 2, slot?: { post: string; slot: 'a' | 'b' }) {
  const src = join(dir, `${name}.mp4`)
  await makeClip(src, { width: 270, height: 480, fps: 24, durationSec: seconds, source })
  const uploadId = 'upl_' + String(upl++).padStart(20, 'e')
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  return (await addClip(h.deps, h.ctx, { characterId, uploadId, name: `${name}.mp4`, ...(slot ? { contentId: slot.post, slot: slot.slot } : {}) })).id
}
async function fileOf(assetId: string, name: string) {
  const p = join(dir, name)
  await writeFile(p, (await readAsset(h.deps, h.ctx, assetId)).data)
  return p
}
async function render(spec: Record<string, unknown>, kind: 'meme' | 'batch' = 'meme') {
  const id = (await createContent(h.deps, h.ctx, { kind, characterId, spec: { sound: { ambience: 'none' }, ...spec } })).id
  await startRender(h.deps, h.ctx, id)
  await drain(h, 40)
  return getContent(h.deps, h.ctx, id)
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'phase5-test-'))
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  clipA = await upload('a', 'testsrc2')
  clipB = await upload('b', 'smptebars')
  await drain(h, 20)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('edits in a post', () => {
  it('a crash zoom cut needs shot B, says so, and renders A then B with the zoom', async () => {
    const refused = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId: clipA, caption: 'wait', edit: { style: 'crash_zoom' } } })).id
    await expect(startRender(h.deps, h.ctx, refused)).rejects.toThrow(/Add shot B for the crash zoom cut/)
    const row = await render({ clipId: clipA, clipB, caption: 'wait for it', edit: { style: 'crash_zoom', strength: 'normal' } })
    expect(row.status).toBe('ready')
    const out = row.outputs as ContentOutputs
    expect(out.durationSec).toBeCloseTo(4, 0)
    expect(out.editNote).toMatch(/Zoom to 3x over the last 0.6 s of shot A, hard cut at 2 s/)
  }, 180_000)

  it('the automatic cut puts shot B right after the clip, before the B-roll', async () => {
    const id = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId: clipA, clipB, caption: 'x' } })).id
    const v = await postCutView(h.deps, h.ctx, id)
    expect(v.shots.map(s => s.ref)).toEqual([clipA, clipB])
  })

  it('a speed ramp makes the video longer and moves the captions with it', async () => {
    const row = await render({ clipId: clipA, caption: 'slow it down', edit: { style: 'speed_ramp', payoff: 0.8 } })
    const out = row.outputs as ContentOutputs
    expect(row.status).toBe('ready')
    expect(out.durationSec!).toBeGreaterThan(3)
    expect((await probeFile(await fileOf(out.videoAssetId!, 'ramp.mp4'))).durationSec).toBeCloseTo(out.durationSec!, 0)
  }, 180_000)

  it('word pop: the caption builds up word by word', async () => {
    const row = await render({ clipId: clipA, caption: 'one two three four five six', edit: { style: 'word_pop', strength: 'normal' } })
    const out = row.outputs as ContentOutputs
    const video = await fileOf(out.videoAssetId!, 'words.mp4')
    // White caption pixels in the top band: few early, more later.
    const white = async (t: number) => {
      const f = join(dir, `wp${t}.png`)
      await ffmpeg(['-ss', String(t), '-i', video, '-frames:v', '1', f])
      const { data } = await sharp(f).extract({ left: 0, top: 200, width: 1080, height: 500 }).greyscale().raw().toBuffer({ resolveWithObject: true })
      return data.reduce((n, v) => n + (v > 235 ? 1 : 0), 0)
    }
    const early = await white(0.15), late = await white(1.9)
    expect(late).toBeGreaterThan(early * 1.5)
  }, 180_000)

  it('freeze and pop: the frame holds and the pop text shows in the middle', async () => {
    const row = await render({ clipId: clipA, caption: 'top caption', edit: { style: 'freeze_pop', payoff: 1, text: 'NO WAY' } })
    const out = row.outputs as ContentOutputs
    expect(out.durationSec).toBeCloseTo(3.1, 0)
    const video = await fileOf(out.videoAssetId!, 'freeze.mp4')
    const f = join(dir, 'fz.png')
    await ffmpeg(['-ss', '1.6', '-i', video, '-frames:v', '1', f])
    const { data } = await sharp(f).extract({ left: 140, top: 860, width: 800, height: 200 }).greyscale().raw().toBuffer({ resolveWithObject: true })
    expect(data.reduce((n, v) => n + (v > 235 ? 1 : 0), 0)).toBeGreaterThan(5000)
  }, 180_000)

  it('flash and shake hits the cut, or the payoff once the owner places it', async () => {
    const atCut = await render({ clipId: clipA, clipB, caption: 'hit', edit: { style: 'flash_shake' } })
    expect((atCut.outputs as ContentOutputs).editNote).toMatch(/at 2 s \(the cut\)/)
    const placed = await render({ clipId: clipA, clipB, caption: 'hit', edit: { style: 'flash_shake', payoff: 0.8 } })
    expect((placed.outputs as ContentOutputs).editNote).toMatch(/at 0.8 s \(the payoff\)/)
  }, 180_000)

  it('the post view lists each edit with its numbers, for the Edit lane', async () => {
    const v = await contentView(h.deps, h.ctx)
    const crash = v.options.edits.styles.find(s => s.id === 'crash_zoom')
    expect(crash).toMatchObject({ shots: 2, anchor: 'cut', params: { normal: { seconds: 0.6, zoom: 3 } } })
    expect(v.options.edits.styles).toHaveLength(10)
  })

  it('a batch takes one-shot edits, and refuses two-shot ones', async () => {
    const ok = await render({ clipIds: [clipA], captions: ['one'], edit: { style: 'flash_shake' } }, 'batch')
    expect((ok.outputs as ContentOutputs).done).toBe(1)
    const id = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId, spec: { clipIds: [clipA], captions: ['one'], edit: { style: 'whip_pan' } } })).id
    await expect(startRender(h.deps, h.ctx, id)).rejects.toThrow(/one-shot edits only/)
  }, 180_000)
})

describe('shot B helpers', () => {
  it('an upload can go straight into shot B', async () => {
    const id = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId: clipA } })).id
    const b = await upload('slotb', 'rgbtestsrc', 2, { post: id, slot: 'b' })
    const spec = (await getContent(h.deps, h.ctx, id)).spec as MemeSpec
    expect(spec).toMatchObject({ clipId: clipA, clipB: b })
  }, 60_000)

  it('the close-up box is 9:16 around the face and stays inside the frame', () => {
    expect(closeupBox(1080, 1920, { x: 0.5, y: 0.4 }, 0.42)).toEqual({ left: 314, top: 365, width: 453, height: 806 })
    const edge = closeupBox(1080, 1920, { x: 0.98, y: 0.02 }, 0.42)
    expect(edge.left + edge.width).toBeLessThanOrEqual(1080)
    expect(edge.top).toBe(0)
  })

  it('Make the close-up crops shot A\'s last frame (free) into a still for shot B', async () => {
    const id = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId: clipA, edit: { style: 'crash_zoom' } } })).id
    await makeCloseup(h.deps, h.ctx, id)
    await drain(h, 20)
    const spec = (await getContent(h.deps, h.ctx, id)).spec as MemeSpec
    expect(spec.stillB).toBeTruthy()
    const [still] = await h.deps.db.select().from(candidates).where(eq(candidates.id, spec.stillB!))
    expect(still).toMatchObject({ op: 'crop', status: 'approved', parentId: clipA, label: 'Close-up for shot B' })
    const meta = await sharp((await readAsset(h.deps, h.ctx, still!.assetId!)).data).metadata()
    expect(meta.height! / meta.width!).toBeCloseTo(16 / 9, 1)
    expect(meta.height).toBe(Math.round(480 * 0.42))
  }, 60_000)
})
