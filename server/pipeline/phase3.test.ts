import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { candidates } from '../db/schema.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { approveSceneCandidate, createScene, sceneCandidates, updateScene } from './scenes.js'
import { addBroll, createContent, getContent, startRender, updateContent, type ContentOutputs, type MemeSpec } from './content.js'
import { cancelContinue, continueShot, keepTwoShots, useChainTake } from './chain.js'
import { postCutView } from './cutView.js'
import { addSound, listSounds } from './sounds.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { ffmpeg, probeFile } from '../media/ffmpeg.js'
import { measureLoudness } from '../media/sound.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// Phase 3 in demo mode: "Continue this shot" (the last frame starts the
// next take on the same model; the takes join into one clip, seams scored,
// never crossfaded), a failed seam kept as two shots, the sound bed with an
// uploaded music track, and an edited rough cut. Rendering is real; nothing
// paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string
let sceneId: string
let stillId: string
let clipId: string
let dir: string

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs }
}

async function fileOf(assetId: string, name: string) {
  const p = join(dir, name)
  await writeFile(p, (await readAsset(h.deps, h.ctx, assetId)).data)
  return p
}

const spec = async (id: string) => (await getContent(h.deps, h.ctx, id)).spec as MemeSpec
const takeAction = (candidateId: string, extra: Partial<Extract<StudioAction, { type: 'scene_video' }>> = {}): StudioAction => ({
  type: 'scene_video', characterId, candidateId, model: 'higgsfield/kling-3.0-pro', motion: 'Callie laughs at the screen', directions: 'No talking.', durationSec: 5, aspect: '9:16', audio: false, takes: 1, test: false, ...extra,
})

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'phase3-test-'))
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie laughs at her laptop in a cafe' })).id
  await updateScene(h.deps, h.ctx, sceneId, { prompts: { still: 'Callie laughs at her laptop in a sunny cafe, caught mid-laugh by a friend across the table.', video: 'Callie laughs at the screen and shakes her head.' } })
  await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: false })
  stillId = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'generate' && c.assetId)!.id
  await run(takeAction(stillId))
  clipId = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video' && c.assetId)!.id
  await approveSceneCandidate(h.deps, h.ctx, clipId, { acknowledge: true })
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('chaining: Continue this shot', () => {
  let postId: string
  let frameId: string

  it('takes the last frame at full size as a still of the post scene, remembering the model', async () => {
    const take = (await h.deps.db.select().from(candidates).where(eq(candidates.id, clipId)))[0]!
    expect((take.meta as { model?: string }).model).toBe('higgsfield/kling-3.0-pro')
    postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, sceneId, spec: { clipId, caption: 'two beats, one take' } })).id
    await continueShot(h.deps, h.ctx, postId)
    expect((await spec(postId)).continueFrom).toMatchObject({ clipId, status: 'preparing', model: 'higgsfield/kling-3.0-pro' })
    await expect(continueShot(h.deps, h.ctx, postId)).rejects.toThrow(/already continuing/)
    await drain(h, 20)
    const s = await spec(postId)
    expect(s.continueFrom).toMatchObject({ status: 'ready', clipId })
    frameId = s.continueFrom!.frameId!
    expect(s.stillId).toBe(frameId)
    const frame = (await h.deps.db.select().from(candidates).where(eq(candidates.id, frameId)))[0]!
    expect(frame).toMatchObject({ op: 'last_frame', parentId: clipId, sceneId, status: 'approved' })
    const png = await fileOf(frame.assetId!, 'frame.png')
    const clip = await probeFile(await fileOf(take.assetId!, 'take.mp4'))
    const pf = await probeFile(png)
    expect([pf.width, pf.height]).toEqual([clip.width, clip.height])
    expect((frame.meta as { handoffSec: number }).handoffSec).toBeGreaterThan(4)
  })

  it('the next take carries "same place, same light, same wardrobe", and so does the writer', async () => {
    const { preview } = await run(takeAction(frameId, { motion: 'Callie looks up from the laptop and smiles at the lens' }))
    expect(preview.prompts[0]!.text).toContain('Continues the previous shot from this exact frame')
    expect(preview.prompts[0]!.text).toContain('same wardrobe and hair')
    const write = await estimateAction(h.deps, h.ctx, { type: 'scene_prompt', characterId, sceneId, target: 'video', motion: 'She looks up and smiles', startCandidateId: frameId })
    expect(write.preview.prompts[0]!.text).toContain('continues the previous one from its last frame')
    expect(write.preview.prompts[0]!.text).toContain('Callie laughs at the screen')
  })

  it('Use this take joins the takes into one clip: handoff frame dropped, seam scored, never blended', async () => {
    const next = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video' && c.parentId === frameId && c.assetId)!
    await expect(useChainTake(h.deps, h.ctx, postId, next.id)).rejects.toThrow(/Keep the take first/)
    await expect(useChainTake(h.deps, h.ctx, postId, clipId)).rejects.toThrow(/starts from the last frame/)
    await approveSceneCandidate(h.deps, h.ctx, next.id, { acknowledge: true })
    await useChainTake(h.deps, h.ctx, postId, next.id)
    expect((await spec(postId)).continueFrom?.status).toBe('joining')
    await drain(h, 20)
    const s = await spec(postId)
    expect(s.continueFrom).toBeNull()
    expect(s.clipId).not.toBe(clipId)
    const chain = (await h.deps.db.select().from(candidates).where(eq(candidates.id, s.clipId!)))[0]!
    const meta = chain.meta as { parts: string[]; seams: Array<{ passed: boolean; action: string }>; model: string }
    expect(chain).toMatchObject({ op: 'chain', status: 'approved', parentId: clipId, label: '2 takes, chained' })
    expect(meta.parts).toEqual([clipId, next.id])
    expect(meta.seams).toHaveLength(1)
    expect(meta.seams[0]).toMatchObject({ passed: true, action: 'cut' })
    expect(meta.model).toBe('higgsfield/kling-3.0-pro')
    // Two 5 s takes minus the duplicated handoff frame.
    const p = await probeFile(await fileOf(chain.assetId!, 'chain.mp4'))
    expect(p.durationSec).toBeGreaterThan(9.5)
    expect(p.durationSec).toBeLessThan(10.1)
    // The rough cut and the export use the joined clip.
    const view = await postCutView(h.deps, h.ctx, postId)
    expect(view.shots).toHaveLength(1)
    expect(view.shots[0]).toMatchObject({ kind: 'clip', ref: chain.id, takes: 2, ready: true })
    expect(view.totalSec).toBeCloseTo(p.durationSec!, 0)
    await startRender(h.deps, h.ctx, postId)
    await drain(h, 20)
    const out = (await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs
    expect(out.durationSec).toBeCloseTo(p.durationSec!, 0)
  })

  it('a seam that fails is never exported; it can become two shots with a real cut', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, sceneId, spec: { clipId, caption: 'outfit check' } })).id
    await continueShot(h.deps, h.ctx, post)
    await drain(h, 20)
    const frame = (await spec(post)).continueFrom!.frameId!
    await run(takeAction(frame))
    const take = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video' && c.parentId === frame && c.assetId)!
    await approveSceneCandidate(h.deps, h.ctx, take.id, { acknowledge: true })
    // A strict seam limit nothing can meet.
    const cfg = h.deps.config.pipeline.content.chain
    const limit = cfg.max_seam_diff
    cfg.max_seam_diff = 0.000001
    try {
      await useChainTake(h.deps, h.ctx, post, take.id)
      await drain(h, 20)
    } finally { cfg.max_seam_diff = limit }
    const s = await spec(post)
    expect(s.clipId).toBe(clipId)
    expect(s.continueFrom).toMatchObject({ status: 'failed', takeId: take.id })
    expect(s.continueFrom!.error).toMatch(/seam did not pass.*two shots/)
    await keepTwoShots(h.deps, h.ctx, post)
    const after = await spec(post)
    expect(after.continueFrom).toBeNull()
    expect(after.cut).toMatchObject({ auto: false, shots: [{ kind: 'clip', ref: clipId }, { kind: 'clip', ref: take.id }] })
    await startRender(h.deps, h.ctx, post)
    await drain(h, 20)
    const out = (await getContent(h.deps, h.ctx, post)).outputs as ContentOutputs
    expect(out.durationSec).toBeCloseTo(10, 0)
  })

  it('Cancel drops the continuation and keeps the clip', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, sceneId, spec: { clipId, caption: 'x' } })).id
    await continueShot(h.deps, h.ctx, post)
    await cancelContinue(h.deps, h.ctx, post)
    expect(await spec(post)).toMatchObject({ clipId, continueFrom: null })
  })
})

describe('sound bed and rough cut', () => {
  let musicId: string
  let brollId: string

  it('an uploaded music track is converted and measured; no AI music anywhere', async () => {
    const src = join(dir, 'song.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=262:duration=12', '-ar', '44100', src])
    const uploadId = 'upl_' + 'm'.repeat(20)
    await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'audio/wav')
    const row = await addSound(h.deps, h.ctx, { uploadId, name: 'my track.wav', kind: 'music', tag: 'chill' })
    expect(row).toMatchObject({ status: 'processing', title: 'my track', kind: 'music', tag: 'chill' })
    await drain(h, 20)
    const [ready] = await listSounds(h.deps, h.ctx)
    expect(ready).toMatchObject({ status: 'ready', kind: 'music' })
    expect(ready!.loudness).toBeGreaterThan(-30)
    expect(ready!.durationMs).toBeGreaterThan(11_000)
    musicId = ready!.id
    expect(await h.deps.store.exists(uploadKey(h.ctx.accountId, uploadId))).toBe(false)
  })

  it('music under the post is mixed and normalized to -14 LUFS', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'with my song', sound: { music: musicId, musicLevel: 'normal' } } })).id
    await startRender(h.deps, h.ctx, post)
    await drain(h, 20)
    const row = await getContent(h.deps, h.ctx, post)
    expect(row.status).toBe('ready')
    const out = row.outputs as ContentOutputs
    expect(out.sound).toEqual({ layers: ['ambience', 'music'], targetLufs: -14, ducked: false })
    const l = await measureLoudness(await fileOf(out.videoAssetId!, 'music.mp4'))
    expect(l.i).toBeGreaterThan(-15.5)
    expect(l.i).toBeLessThan(-12.5)
  })

  it('an edited cut: trims, a B-roll shot first, two timed captions; the view and the render agree', async () => {
    const src = join(dir, 'screen.mp4')
    await makeClip(src, { width: 1280, height: 720, fps: 30, durationSec: 6, source: 'smptebars' })
    const uploadId = 'upl_' + 'b'.repeat(20)
    await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
    brollId = (await addBroll(h.deps, h.ctx, { uploadId, name: 'screen.mp4' })).id
    await drain(h, 20)
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'the main caption' } })).id
    // The automatic cut first: the clip and the caption over everything.
    const auto = await postCutView(h.deps, h.ctx, post)
    expect(auto.auto).toBe(true)
    expect(auto.captions).toEqual([expect.objectContaining({ id: 'main', linked: true, shown: 'the main caption', start: 0, end: null })])
    await updateContent(h.deps, h.ctx, post, { spec: { sound: { ambience: 'none' }, cut: {
      auto: false,
      shots: [{ id: 'b', kind: 'broll', ref: brollId, in: 1, out: 3 }, { id: 'c', kind: 'clip', ref: clipId, in: 0.5, out: 3.5 }],
      captions: [{ id: 'main', text: null, start: 0, end: 2 }, { id: 'pop', text: 'wait for it', start: 2, end: null }],
    } } })
    const view = await postCutView(h.deps, h.ctx, post)
    expect(view.auto).toBe(false)
    expect(view.shots.map(s => [s.kind, s.start, s.durationSec])).toEqual([['broll', 0, 2], ['clip', 2, 3]])
    expect(view.totalSec).toBe(5)
    expect(view.captions.map(c => c.shown)).toEqual(['the main caption', 'wait for it'])
    expect(view.sound.spec.ambience).toBe('none')
    await startRender(h.deps, h.ctx, post)
    await drain(h, 20)
    const out = (await getContent(h.deps, h.ctx, post)).outputs as ContentOutputs
    const p = await probeFile(await fileOf(out.videoAssetId!, 'edited.mp4'))
    expect(p.durationSec).toBeCloseTo(5, 0)
    expect(p.hasAudio).toBe(false)
  })

  it('a cut with problems is refused before it is queued, in plain words', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: '' } })).id
    await updateContent(h.deps, h.ctx, post, { spec: { cut: { auto: false, shots: [{ id: 'c', kind: 'clip', ref: clipId, in: 2, out: 2.1 }], captions: [{ id: 'x', text: null, start: 3, end: 1 }] } } })
    await expect(startRender(h.deps, h.ctx, post)).rejects.toThrow(/Shot 1 is shorter than 0.2 s; Caption 1 ends before it starts; Write the caption/)
  })

  it('a batch gets the sound bed too', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId, spec: { clipIds: [clipId], captions: ['one', 'two'], sound: { ambience: 'room' } } })).id
    await startRender(h.deps, h.ctx, post)
    await drain(h, 30)
    const out = (await getContent(h.deps, h.ctx, post)).outputs as ContentOutputs
    expect(out.done).toBe(2)
    const p = await probeFile(await fileOf(out.videos![0]!.assetId, 'b1.mp4'))
    expect(p.hasAudio).toBe(true)
  })
})
