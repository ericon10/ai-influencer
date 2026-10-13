import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { createScene, sceneCandidates } from './scenes.js'
import { addBroll, contentView, createContent, getContent, startRender, updateContent, type ContentOutputs } from './content.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { probeFile } from '../media/ffmpeg.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// The text-overlay content builder in demo mode: B-roll uploads, a meme
// video, a slideshow written by (mock) Claude, and a batch. Rendering is
// real (ffmpeg and sharp); nothing paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string
let clipId: string
let stillIds: string[]
let brollId: string
let dir: string

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs }
}

async function probeAsset(id: string) {
  const p = join(dir, `${id}.mp4`)
  await writeFile(p, (await readAsset(h.deps, h.ctx, id)).data)
  return probeFile(p)
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'content-test-'))
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  const sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie laughs at her laptop in a cafe' })).id
  await updateScene(sceneId)
  await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 2, withQa: false })
  stillIds = (await sceneCandidates(h.deps, h.ctx, [sceneId])).filter(c => c.op === 'generate' && c.assetId).map(c => c.id)
  await run({ type: 'scene_video', characterId, candidateId: stillIds[0]!, motion: 'Callie laughs at the screen', directions: 'No talking.', durationSec: 5, aspect: '9:16', audio: false, takes: 1, test: false })
  clipId = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video' && c.assetId)!.id
}, 240_000)

// The prompt writer is on by default; a typed prompt keeps these runs quick.
async function updateScene(sceneId: string) {
  const { updateScene: save } = await import('./scenes.js')
  await save(h.deps, h.ctx, sceneId, { prompts: { still: 'Callie laughs at her laptop in a sunny cafe, caught mid-laugh by a friend across the table.', video: 'Callie laughs at the screen and shakes her head.' } })
}

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('content builder (demo mode)', () => {
  it('B-roll: a phone or screen recording becomes a lean clip, tagged by product', async () => {
    const src = join(dir, 'screen.mp4')
    await makeClip(src, { width: 1280, height: 720, fps: 60, durationSec: 3, audio: true, source: 'smptebars' })
    const uploadId = 'upl_' + 'a'.repeat(20)
    await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
    const row = await addBroll(h.deps, h.ctx, { uploadId, name: 'Screen Recording 2026-10-13.mov', product: '  Notion  ' })
    expect(row).toMatchObject({ status: 'processing', title: 'Screen Recording 2026-10-13', product: 'Notion' })
    await drain(h, 20)
    const view = await contentView(h.deps, h.ctx)
    const clip = view.broll.find(b => b.id === row.id)!
    expect(clip.status).toBe('ready')
    expect(clip.durationSec).toBeCloseTo(3, 0)
    expect(view.products).toContain('Notion')
    const p = await probeAsset(clip.assetId!)
    expect(p).toMatchObject({ hasAudio: false, width: 1280, height: 720, fps: 30 })
    // The upload itself is removed once the copy is kept.
    expect(await h.deps.store.exists(uploadKey(h.ctx.accountId, uploadId))).toBe(false)
    brollId = row.id
  })

  it('meme video: the kept clip, a hard cut to B-roll, the caption on top; 9:16, no sound', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId } })
    await expect(startRender(h.deps, h.ctx, item.id)).rejects.toThrow(/Write the caption/)
    await updateContent(h.deps, h.ctx, item.id, { spec: { brollId, brollSeconds: 2, caption: 'me when the AI finally fixes my code 💀' } })
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 20)
    const done = await getContent(h.deps, h.ctx, item.id)
    expect(done.status).toBe('ready')
    const out = done.outputs as ContentOutputs
    const p = await probeAsset(out.videoAssetId!)
    expect(p).toMatchObject({ width: 1080, height: 1920, fps: 30, hasAudio: false })
    expect(p.durationSec).toBeGreaterThan(2.5)
    expect(out.dropped).toEqual([])
  })

  it('slideshow: Claude writes the hook, the slides, the caption and hashtags (priced), then the images export in order', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, spec: { stillIds, topic: '5 apps that saved my semester' } })
    const { quote, preview } = await run({ type: 'content_slides', characterId, contentId: item.id })
    expect(quote.models).toEqual(['Demo mock, free'])
    expect(preview.prompts[0]!.text).toContain('exactly 5 more slide texts')
    const written = await getContent(h.deps, h.ctx, item.id)
    const spec = written.spec as { hook: string; slides: string[]; hashtags: string[] }
    expect(spec.hook).toBe('5 apps that saved my semester')
    expect(spec.slides).toHaveLength(5)
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 20)
    const done = await getContent(h.deps, h.ctx, item.id)
    expect(done.status).toBe('ready')
    const out = done.outputs as ContentOutputs
    expect(out.imageAssetIds).toHaveLength(6)
    const first = await sharp((await readAsset(h.deps, h.ctx, out.imageAssetIds![0]!)).data).metadata()
    expect(first).toMatchObject({ width: 1080, height: 1920, format: 'jpeg' })
    const zip = unzipSync(new Uint8Array((await readAsset(h.deps, h.ctx, out.zipAssetId!)).data))
    expect(Object.keys(zip).sort()).toEqual(['01-content.jpg', '02-content.jpg', '03-content.jpg', '04-content.jpg', '05-content.jpg', '06-content.jpg', 'caption.txt'].map(n => n.replace('content', 'slideshow')).sort())
    const caption = Buffer.from(zip['caption.txt']!).toString()
    expect(caption).toContain('#fyp')
    expect(caption).toContain('AI-generated content label')
  })

  it('batch: captions from a topic (priced), then one video per caption and a zip of all', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'batch', characterId, spec: { clipId, brollId, brollSeconds: 1, topic: 'studying with AI', count: 3 } })
    await run({ type: 'content_captions', characterId, contentId: item.id })
    const spec = (await getContent(h.deps, h.ctx, item.id)).spec as { captions: string[] }
    expect(spec.captions).toHaveLength(3)
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 30)
    const done = await getContent(h.deps, h.ctx, item.id)
    expect(done.status).toBe('ready')
    const out = done.outputs as ContentOutputs
    expect(out).toMatchObject({ done: 3, total: 3 })
    expect(out.videos!.map(v => v?.caption)).toEqual(spec.captions)
    expect(out.failed).toBe(0)
    const zip = unzipSync(new Uint8Array((await readAsset(h.deps, h.ctx, out.zipAssetId!)).data))
    expect(Object.keys(zip).filter(n => n.endsWith('.mp4'))).toHaveLength(3)
    expect(Buffer.from(zip['captions.txt']!).toString()).toContain('01. POV: studying with AI (1)')
  }, 180_000)
})
