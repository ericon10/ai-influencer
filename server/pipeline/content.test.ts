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
import { addBroll, batchSources, contentView, createContent, duplicateContent, getContent, postScene, startRender, updateContent, type BatchSpec, type ContentOutputs } from './content.js'
import { createCharacter } from './characters.js'
import { addClip, libraryView } from './clips.js'
import { approveSceneCandidate, getScene } from './scenes.js'
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
let clipId2: string
let sceneId: string
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
  sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie laughs at her laptop in a cafe' })).id
  await updateScene(sceneId)
  await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 2, withQa: false })
  stillIds = (await sceneCandidates(h.deps, h.ctx, [sceneId])).filter(c => c.op === 'generate' && c.assetId).map(c => c.id)
  await run({ type: 'scene_video', characterId, candidateId: stillIds[0]!, motion: 'Callie laughs at the screen', directions: 'No talking.', durationSec: 5, aspect: '9:16', audio: false, takes: 1, test: false })
  clipId = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video' && c.assetId)!.id
  await run({ type: 'scene_video', characterId, candidateId: stillIds[1]!, motion: 'Callie looks up and smiles', directions: 'No talking.', durationSec: 5, aspect: '9:16', audio: false, takes: 1, test: false })
  clipId2 = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video' && c.assetId && c.id !== clipId)!.id
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

  it('meme video: the kept clip, a hard cut to B-roll, the caption on top; 9:16, Room tone under it', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId } })
    await updateContent(h.deps, h.ctx, item.id, { spec: { brollId, brollSeconds: 2, caption: 'me when the AI finally fixes my code 💀' } })
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 20)
    const done = await getContent(h.deps, h.ctx, item.id)
    expect(done.status).toBe('ready')
    const out = done.outputs as ContentOutputs
    const p = await probeAsset(out.videoAssetId!)
    // The default sound bed: Room tone only, kept quiet (Phase 3).
    expect(p).toMatchObject({ width: 1080, height: 1920, fps: 30, hasAudio: true })
    expect(out.sound).toEqual({ layers: ['ambience'], targetLufs: -28, ducked: false })
    expect(p.durationSec).toBeCloseTo(7, 0)
    expect(out.durationSec).toBeCloseTo(7, 0)
    expect(out.dropped).toEqual([])
    // Sound off: a silent post, as before.
    await updateContent(h.deps, h.ctx, item.id, { spec: { sound: { ambience: 'none' } } })
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 20)
    const silent = (await getContent(h.deps, h.ctx, item.id)).outputs as ContentOutputs
    expect((await probeAsset(silent.videoAssetId!)).hasAudio).toBe(false)
    expect(silent.sound?.layers).toEqual([])
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
    // TikTok only (THE STANDARD v1.2): 1080 x 1920, numbered, with
    // caption.txt and post.json; the Instagram set is an option, off.
    const names = [1, 2, 3, 4, 5, 6].map(i => `0${i}-slideshow.jpg`)
    expect(Object.keys(zip).sort()).toEqual([...names.map(n => `tiktok/${n}`), 'caption.txt', 'post.json'].sort())
    const caption = Buffer.from(zip['caption.txt']!).toString()
    expect(caption).toContain('#fyp')
    expect(caption).toContain('AI-generated content label')
  })

  it('slideshow with no words: each still goes out as it is (words are optional)', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, spec: { stillIds: stillIds.slice(0, 2) } })
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 20)
    const done = await getContent(h.deps, h.ctx, item.id)
    expect(done.status).toBe('ready')
    expect((done.outputs as ContentOutputs).imageAssetIds).toHaveLength(2)
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

describe('posts (UX-PLAN.md)', () => {
  it('keeps the idea, the account tag and the step it was left on; tags are suggested back', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'meme', characterId, idea: 'Callie reacts to her code finally running', accountTag: '  Callie   TikTok ' })
    expect(item).toMatchObject({ idea: 'Callie reacts to her code finally running', accountTag: 'Callie TikTok', step: 'idea', sceneId: null })
    await updateContent(h.deps, h.ctx, item.id, { step: 'video' })
    expect((await getContent(h.deps, h.ctx, item.id)).step).toBe('video')
    const view = await contentView(h.deps, h.ctx)
    expect(view.accountTags).toContain('Callie TikTok')
    expect(view.items.find(i => i.id === item.id)).toMatchObject({ accountTag: 'Callie TikTok', step: 'video' })
  })

  it('makes its scene from the idea the first time stills are asked for, once', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'meme', characterId, idea: 'Callie picks peaches at the market' })
    const first = await postScene(h.deps, h.ctx, item.id)
    expect(first.sceneId).toBeTruthy()
    expect(first.step).toBe('idea')
    expect((await getScene(h.deps, h.ctx, first.sceneId!)).brief).toBe('Callie picks peaches at the market')
    expect((await postScene(h.deps, h.ctx, item.id)).sceneId).toBe(first.sceneId)
    // The scene's words follow the idea while they still match it.
    await updateContent(h.deps, h.ctx, item.id, { idea: 'Callie picks ripe peaches at the farmers market' })
    expect((await getScene(h.deps, h.ctx, first.sceneId!)).brief).toBe('Callie picks ripe peaches at the farmers market')
    // A picked scene keeps its own words.
    await updateContent(h.deps, h.ctx, item.id, { sceneId })
    await updateContent(h.deps, h.ctx, item.id, { idea: 'Something else' })
    expect((await getScene(h.deps, h.ctx, sceneId)).brief).toBe('Callie laughs at her laptop in a cafe')
  })

  it('switching the character drops its scene, clips and stills, and keeps the idea and B-roll', async () => {
    const other = await createCharacter(h.deps, h.ctx, { name: 'Maya' })
    const item = await createContent(h.deps, h.ctx, { kind: 'meme', characterId, idea: 'A laugh', sceneId, spec: { clipId, stillId: stillIds[0], brollId, caption: 'hi' } })
    await expect(updateContent(h.deps, h.ctx, item.id, { sceneId: (await createScene(h.deps, h.ctx, other.id, { brief: 'x' })).id })).rejects.toThrow(/another character/)
    const moved = await updateContent(h.deps, h.ctx, item.id, { characterId: other.id })
    expect(moved).toMatchObject({ characterId: other.id, sceneId: null, idea: 'A laugh' })
    expect(moved.spec).toMatchObject({ clipId: null, stillId: null, brollId, caption: 'hi' })
  })

  it('"Make another like this" copies everything but the render, and opens at the Text step', async () => {
    const item = await createContent(h.deps, h.ctx, { kind: 'meme', characterId, idea: 'Code works', accountTag: 'Callie TikTok', sceneId, spec: { clipId, caption: 'first one' } })
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 20)
    expect((await getContent(h.deps, h.ctx, item.id)).status).toBe('ready')
    const copy = await duplicateContent(h.deps, h.ctx, item.id)
    expect(copy.id).not.toBe(item.id)
    expect(copy).toMatchObject({ kind: 'meme', characterId, idea: 'Code works', accountTag: 'Callie TikTok', sceneId, step: 'text', status: 'draft', outputs: {} })
    expect(copy.spec).toMatchObject({ clipId, caption: 'first one' })
  })

  it('a batch rotates its clips and B-roll across the captions', async () => {
    const spec = { clipIds: ['a', 'b'], brollIds: ['x', 'y', 'z'] } as BatchSpec
    expect([0, 1, 2, 3].map(i => batchSources(spec, i))).toEqual([
      { clipId: 'a', brollId: 'x' }, { clipId: 'b', brollId: 'y' }, { clipId: 'a', brollId: 'z' }, { clipId: 'b', brollId: 'x' },
    ])
    expect(batchSources({ ...spec, brollIds: [] }, 1)).toEqual({ clipId: 'b', brollId: null })
    const item = await createContent(h.deps, h.ctx, { kind: 'batch', characterId, spec: { clipIds: [clipId, clipId2], brollSeconds: 1, captions: ['one', 'two', 'three'] } })
    await startRender(h.deps, h.ctx, item.id)
    await drain(h, 30)
    const out = (await getContent(h.deps, h.ctx, item.id)).outputs as ContentOutputs
    expect(out).toMatchObject({ done: 3, failed: 0, total: 3 })
    expect(out.videos!.map(v => v?.clipId)).toEqual([clipId, clipId2, clipId])
  }, 180_000)
})

describe('uploaded clips and the Library', () => {
  it('an uploaded video becomes a kept clip, picked in the post it came from, and shows in the Library', async () => {
    const src = join(dir, 'phone.mp4')
    await makeClip(src, { width: 720, height: 1280, fps: 30, durationSec: 2, audio: true, source: 'testsrc' })
    const uploadId = 'upl_' + 'c'.repeat(20)
    await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
    const post = await createContent(h.deps, h.ctx, { kind: 'meme', characterId })
    const { id } = await addClip(h.deps, h.ctx, { characterId, uploadId, name: 'IMG_0042.MOV', contentId: post.id })
    expect(((await getContent(h.deps, h.ctx, post.id)).spec as { clipId: string }).clipId).toBe(id)
    let lib = await libraryView(h.deps, h.ctx)
    expect(lib.clips.find(c => c.id === id)).toMatchObject({ status: 'generating', title: 'IMG_0042', op: 'upload' })
    await drain(h, 20)
    lib = await libraryView(h.deps, h.ctx, { characterId })
    const clip = lib.clips.find(c => c.id === id)!
    expect(clip).toMatchObject({ status: 'approved', characterName: 'Callie', title: 'IMG_0042', error: null })
    expect(clip.durationSec).toBeCloseTo(2, 0)
    expect(await probeAsset(clip.assetId)).toMatchObject({ hasAudio: false, width: 720, height: 1280 })
    // Kept takes show with the still they started from; stills show by scene.
    expect(lib.clips.some(c => c.id === clipId)).toBe(false)
    await approveSceneCandidate(h.deps, h.ctx, clipId, { acknowledge: true })
    lib = await libraryView(h.deps, h.ctx, { characterId })
    const take = lib.clips.find(c => c.id === clipId)!
    expect(take.posterId).toBeTruthy()
    expect(take.sceneTitle).toContain('Callie laughs')
    expect(lib.stills.some(s => s.id === stillIds[0])).toBe(true)
    expect(lib.stills.every(s => s.characterId === characterId)).toBe(true)
    // It renders into the post like any kept take.
    await updateContent(h.deps, h.ctx, post.id, { spec: { caption: 'phone clip' } })
    await startRender(h.deps, h.ctx, post.id)
    await drain(h, 20)
    expect((await getContent(h.deps, h.ctx, post.id)).status).toBe('ready')
  }, 120_000)

  it('a file that is not a video fails with a reason and shows as failed', async () => {
    const uploadId = 'upl_' + 'd'.repeat(20)
    await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), Buffer.from('not a video'), 'video/mp4')
    const { id } = await addClip(h.deps, h.ctx, { characterId, uploadId, name: 'broken.mp4' })
    await drain(h, 10)
    const clip = (await libraryView(h.deps, h.ctx)).clips.find(c => c.id === id)!
    expect(clip.status).toBe('failed')
    expect(clip.error).toMatch(/could not be read as a video/)
  })
})
