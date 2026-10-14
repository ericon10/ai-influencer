import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { createContent, duplicateContent, getContent, startRender, updateContent, type ContentOutputs } from './content.js'
import { addClip } from './clips.js'
import { editorManifest } from './openreel.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { ffmpeg, probeFile } from '../media/ffmpeg.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// The worker renders the post's timeline (editor phase D, G32): a timeline
// saved by the editor, a stack carried by Make another like this, and a
// batch's style, each with the camera presets drawn by the editor's own
// math under still captions. Mock adapter only; nothing paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness, characterId: string, clipId: string, dir: string

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'timeline-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  const src = join(dir, 'clip.mp4')
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: 4, audio: true })
  const uploadId = 'upl_' + 't'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  clipId = (await addClip(h.deps, h.ctx, { characterId, uploadId, name: 'dance.mp4' })).id
  await drain(h, 20)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

// A frame of the bottom half (the captions sit in the upper third).
async function bottomHalf(assetId: string, at: number, name: string): Promise<Uint8Array> {
  const file = join(dir, `${name}.mp4`), raw = join(dir, `${name}.rgb`)
  await writeFile(file, (await readAsset(h.deps, h.ctx, assetId)).data)
  await ffmpeg(['-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'crop=1080:960:0:960,scale=270:240', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
  return new Uint8Array(await readFile(raw))
}
function psnr(a: Uint8Array, b: Uint8Array): number {
  let se = 0
  for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2
  return 10 * Math.log10((255 * 255) / Math.max(1e-9, se / a.length))
}

async function render(id: string): Promise<ContentOutputs> {
  await startRender(h.deps, h.ctx, id)
  await drain(h, 60)
  const post = await getContent(h.deps, h.ctx, id)
  expect(post.error).toBeNull()
  expect(post.status).toBe('ready')
  return post.outputs as ContentOutputs
}

describe('the worker renders the timeline', () => {
  let plainId: string, editedId: string

  it('a timeline saved by the editor: the zoom where the block is, nothing else moved', async () => {
    plainId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'zoom test' } })).id
    const plain = await render(plainId)
    expect(plain.fromTimeline).toBeUndefined()
    editedId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'zoom test' } })).id
    const assetId = (await editorManifest(h.deps, h.ctx, editedId)).media[0]!.id
    const project = {
      timeline: { tracks: [
        { id: 'cap', type: 'text', name: 'Captions', clips: [] },
        { id: 'pre', type: 'graphics', name: 'Presets', role: 'effects', clips: [] },
        { id: 'v1', type: 'video', name: 'Track 1', clips: [{ id: 'a', mediaId: 'm1', startTime: 0, duration: 4, inPoint: 0, outPoint: 4 }] },
      ] },
      textClips: [{ id: 't', trackId: 'cap', startTime: 0, duration: 4, text: 'zoom test', style: { backgroundColor: 'rgba(0,0,0,0)' }, transform: { position: { x: 0.5, y: 0.26 } } }],
      adjustmentLayers: [{ trackId: 'pre', startTime: 1.5, duration: 1.5, enabled: true, studio: { version: 1, preset: 'snap_zoom', strength: 'strong', keys: [{ t: 0, scale: 1 }, { t: 0.1, scale: 1.4, ease: 'outExpo' }, { t: 1, scale: 1.4, ease: 'hold' }] } }],
      studioMedia: { m1: assetId },
      studioMusicInExport: true,
    }
    const saved = await saveAsset(h.deps, h.ctx, { data: Buffer.from(JSON.stringify(project)), mime: 'application/json', origin: 'derived', label: 'Editor project' })
    await updateContent(h.deps, h.ctx, editedId, { spec: { editor: { projectAssetId: saved.id, savedAt: null, stack: [{ preset: 'snap_zoom', strength: 'strong', at: { on: 'start', offset: 1.5, ratio: 0.375 } }] } } })
    const out = await render(editedId)
    expect(out.fromTimeline).toBe(true)
    expect(out.editorOnly).toBeUndefined()
    expect(out.durationSec).toBeGreaterThan(3.8)
    // Before the block the picture is the plain render's; inside it, zoomed.
    expect(psnr(await bottomHalf(out.videoAssetId!, 0.8, 'e1'), await bottomHalf(plain.videoAssetId!, 0.8, 'p1'))).toBeGreaterThan(24)
    const zoomed = psnr(await bottomHalf(out.videoAssetId!, 2.5, 'e2'), await bottomHalf(plain.videoAssetId!, 2.5, 'p2'))
    console.log('PSNR zoomed vs plain', zoomed.toFixed(1))
    expect(zoomed).toBeLessThan(18)
  }, 240_000)

  it('Make another like this: the copy renders the carried stack on its own cut', async () => {
    const copy = await duplicateContent(h.deps, h.ctx, editedId)
    const out = await render(copy.id)
    expect(out.fromTimeline).toBe(true)
    expect(psnr(await bottomHalf(out.videoAssetId!, 2.5, 'c2'), await bottomHalf(((await getContent(h.deps, h.ctx, plainId)).outputs as ContentOutputs).videoAssetId!, 2.5, 'p3'))).toBeLessThan(22)
  }, 240_000)

  it('a batch with a style: every video gets it at its own payoff', async () => {
    const id = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId, spec: { clipIds: [clipId], captions: ['one', 'two'], stack: [{ preset: 'snap_zoom', strength: 'strong', at: { on: 'payoff', ratio: 0.5 } }], styleName: 'Payoff zoom' } })).id
    const out = await render(id)
    expect(out.done).toBe(2)
    expect(out.failed).toBe(0)
    // The payoff is 2 s before the end of a 4 s video: zoomed at 2.5 s.
    const plain = ((await getContent(h.deps, h.ctx, plainId)).outputs as ContentOutputs).videoAssetId!
    expect(psnr(await bottomHalf(out.videos![0]!.assetId, 2.5, 'b2'), await bottomHalf(plain, 2.5, 'p4'))).toBeLessThan(22)
    expect(psnr(await bottomHalf(out.videos![1]!.assetId, 1.0, 'b1'), await bottomHalf(plain, 1.0, 'p5'))).toBeGreaterThan(24)
  }, 300_000)
})
