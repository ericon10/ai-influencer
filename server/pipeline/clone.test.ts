import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { createScene, sceneCandidates } from './scenes.js'
import { addBroll, getContent, createContent, startRender, updateContent, type ContentOutputs, type MemeSpec } from './content.js'
import { addCloneSource, cloneModel, cloneOptions, keepClone, postClones, postFromClone } from './clone.js'
import { libraryView } from './clips.js'
import { candidates } from '../db/schema.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { mapInput } from '../providers/higgsfield.js'
import { makeClip } from '../media/testClips.js'
import { probeFile } from '../media/ffmpeg.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import type { GenRequest } from '../providers/types.js'

// Clone Video (SPEC 13.1 R1) in demo mode: a saved TikTok becomes the post's
// source clip (kept with its sound), one run clones it for two characters
// on one quote, each result is checked and kept in Library > Clips, and
// "Keep original sound" carries the source's sound into the post's MP4.
// Everything runs on the mock adapter; nothing paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let callie: string
let second: string
let postId: string
let dir: string
let n = 0

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs }
}

async function source(post: string, o: { seconds: number; audio?: boolean; name?: string }) {
  const src = join(dir, `src-${++n}.mp4`)
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: o.seconds, audio: o.audio ?? true })
  const uploadId = 'upl_' + String(n).padStart(20, 'x')
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  await addCloneSource(h.deps, h.ctx, { contentId: post, uploadId, name: o.name ?? 'dance trend.mp4' })
  return uploadId
}

const cloneOf = async (id: string) => ((await getContent(h.deps, h.ctx, id)).spec as MemeSpec).clone

async function probeAsset(id: string) {
  const p = join(dir, `${id}.mp4`)
  await writeFile(p, (await readAsset(h.deps, h.ctx, id)).data)
  return probeFile(p)
}

async function importAs(name: string) {
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8').replace(/^# Character: Callie/m, `# Character: ${name}`)
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`${name} REF-${i}`) }
  return (await importCharacter(h.deps, h.ctx, md, { images })).characterId
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'clone-test-'))
  callie = await importAs('Callie')
  second = await importAs('Mara')
  postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, idea: 'Callie does the trend', accountTag: 'Callie TikTok' })).id
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('Clone Video: the source clip', () => {
  it('keeps a lean copy of the saved TikTok with its sound, and removes the upload', async () => {
    const uploadId = await source(postId, { seconds: 6 })
    expect(await cloneOf(postId)).toMatchObject({ status: 'preparing', name: 'dance trend', uploadId })
    await drain(h, 20)
    const c = (await cloneOf(postId))!
    expect(c).toMatchObject({ status: 'ready', hasAudio: true, trimmed: false, error: null })
    expect(c.durationSec).toBeGreaterThan(5.5)
    const p = await probeAsset(c.assetId!)
    expect(p.hasAudio).toBe(true)
    expect(Math.max(p.width ?? 0, p.height ?? 0)).toBeLessThanOrEqual(1920)
    expect(await h.deps.store.exists(uploadKey(h.ctx.accountId, uploadId))).toBe(false)
  }, 60_000)

  it('cuts a clip longer than 30 s and says so; refuses one under 3 s', async () => {
    const long = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie })).id
    await source(long, { seconds: 32, audio: false })
    await drain(h, 20)
    expect(await cloneOf(long)).toMatchObject({ status: 'ready', trimmed: true, hasAudio: false })
    expect((await cloneOf(long))!.durationSec).toBeLessThanOrEqual(30.1)

    const short = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie })).id
    await source(short, { seconds: 2 })
    await drain(h, 20)
    expect(await cloneOf(short)).toMatchObject({ status: 'failed' })
    expect((await cloneOf(short))!.error).toMatch(/at least 3 s/)
    await expect(estimateAction(h.deps, h.ctx, { type: 'clone', contentId: short, characterIds: [callie], looks: {}, keepSound: false })).rejects.toThrow(/Add the TikTok or Reel/)
  }, 90_000)

  it('a newer upload wins over an older one still being prepared', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie })).id
    await source(post, { seconds: 4, name: 'first.mp4' })
    await source(post, { seconds: 5, name: 'second.mp4' })
    await drain(h, 20)
    expect(await cloneOf(post)).toMatchObject({ status: 'ready', name: 'second' })
  }, 60_000)
})

describe('Clone Video: the run', () => {
  it('lists every clone model with its price for this clip; on the API the default keeps the clip\'s place', async () => {
    const o = await cloneOptions(h.deps, h.ctx, postId)
    expect(o.model).toBe('higgsfield/seedance-2.5-video-edit')
    expect(o.models.map(m => m.ref)).toContain('higgsfield/kling-3.0-motion-control')
    expect(o.models.every(m => m.display)).toBe(true)
    // A motion model runs on the account's billing default (the API here).
    expect(o.models.find(m => m.ref === 'higgsfield/kling-3.0-motion-control')!.path).toBe('api')
    expect(o.models.find(m => m.ref === 'higgsfield/seedance-2.5-video-edit')!.background).toEqual(['video'])
    expect(o.keepSound).toBe(false)
    // Two modes: "Replace the person" is the default (G28).
    expect(o.mode).toBe('replace')
    expect(o.defaults.motion).toBe('higgsfield/wan-3.0-motion')
    expect(o.models.find(m => m.ref === 'higgsfield/genjutsu-replace')).toMatchObject({ mode: 'replace', path: 'account' })
    expect(o.models.find(m => m.ref === 'higgsfield/genjutsu-motion-control')!.mode).toBe('motion')
  })

  it('one quote with a line per character; both clones are checked and kept in Library > Clips', async () => {
    const action: StudioAction = { type: 'clone', contentId: postId, characterIds: [callie, second], model: 'higgsfield/kling-o3-video-edit', looks: {}, keepSound: false }
    const { quote, preview, jobs } = await run(action)
    expect(quote.items).toHaveLength(2)
    expect(preview.title).toBe('Replace the person in "dance trend" for Callie, Mara')
    // The REALISM block rides along on a model that takes a prompt, and the
    // source's sound is never asked of the provider. Only one person
    // changes; the clip's outfit stays by default.
    expect(preview.prompts[0]!.text).toMatch(/REALISM/)
    expect(preview.prompts[0]!.text).toMatch(/Every other person in the video stays exactly as they are/)
    expect(preview.prompts[0]!.text).toMatch(/Keep the clothes, shoes and accessories that person wears in the source/)
    expect(new Set(jobs.map(j => j.characterId))).toEqual(new Set([callie, second]))
    const clones = await postClones(h.deps, h.ctx, postId)
    expect(clones).toHaveLength(2)
    expect(clones.every(c => c.status === 'approved' && c.assetId)).toBe(true)
    expect(new Set(clones.map(c => c.characterName))).toEqual(new Set(['Callie', 'Mara']))
    // Silent: the clone has no sound unless asked.
    expect((await probeAsset(clones[0]!.assetId!)).hasAudio).toBe(false)
    const lib = await libraryView(h.deps, h.ctx, { characterId: callie })
    expect(lib.clips.find(c => c.id === clones.find(x => x.characterId === callie)!.id)).toMatchObject({ op: 'clone', title: 'Clone: dance trend', status: 'approved' })
    // The picked model is the next clone's default for its mode.
    expect(await cloneModel(h.deps, h.ctx, 'replace')).toBe('higgsfield/kling-o3-video-edit')
    expect(await cloneModel(h.deps, h.ctx, 'motion')).toBe('higgsfield/wan-3.0-motion')
  }, 120_000)

  it('"Keep original sound" puts the source sound back, and the post MP4 keeps it, B-roll and all', async () => {
    await run({ type: 'clone', contentId: postId, characterIds: [callie], model: 'higgsfield/seedance-2.5-video-edit', looks: {}, keepSound: true })
    const clone = (await postClones(h.deps, h.ctx, postId)).find(c => c.characterId === callie && c.findings.some(f => /original sound/.test(f.message)))!
    expect(clone).toBeTruthy()
    expect((await probeAsset(clone.assetId!)).hasAudio).toBe(true)
    await keepClone(h.deps, h.ctx, clone.id)
    // A silent B-roll cut in after the clip: the sound stays in sync, with
    // silence under the B-roll.
    const b = join(dir, 'broll.mp4')
    await makeClip(b, { width: 640, height: 360, fps: 30, durationSec: 3, audio: false })
    const brollUpload = 'upl_' + 'b'.repeat(20)
    await h.deps.store.put(uploadKey(h.ctx.accountId, brollUpload), await readFile(b), 'video/mp4')
    const broll = await addBroll(h.deps, h.ctx, { uploadId: brollUpload, name: 'screen.mp4' })
    await drain(h, 20)
    await updateContent(h.deps, h.ctx, postId, { spec: { clipId: clone.id, caption: 'me trying the trend', brollId: broll.id, brollSeconds: 2, order: 'clip_first' } })
    await startRender(h.deps, h.ctx, postId)
    await drain(h, 30)
    const out = (await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs
    const p = await probeAsset(out.videoAssetId!)
    const clip = await probeAsset(clone.assetId!)
    expect(p.hasAudio).toBe(true)
    expect(p.durationSec!).toBeGreaterThan((clip.durationSec ?? 0) + 1.5)
    expect(p.durationSec!).toBeLessThan((clip.durationSec ?? 0) + 2.5)
  }, 120_000)

  it('"Use one of hers" dresses her in a still\'s outfit; with no still the clip\'s outfit stays, with a note', async () => {
    const sceneId = (await createScene(h.deps, h.ctx, callie, { brief: 'Callie on a rooftop at sunset' })).id
    const { updateScene } = await import('./scenes.js')
    await updateScene(h.deps, h.ctx, sceneId, { prompts: { still: 'Callie on a rooftop at sunset, laughing, caught by a friend.' } })
    await run({ type: 'scene', characterId: callie, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: false })
    const still = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'generate' && c.assetId)!
    const plain = await estimateAction(h.deps, h.ctx, { type: 'clone', contentId: postId, characterIds: [callie], outfit: 'hers', looks: {}, keepSound: false })
    expect(plain.preview.warnings.map(w => w.ruleId)).toContain('clone-outfit')
    const hers = await estimateAction(h.deps, h.ctx, { type: 'clone', contentId: postId, characterIds: [callie], outfit: 'hers', looks: { [callie]: still.id }, keepSound: false })
    expect(hers.preview.warnings.map(w => w.ruleId)).not.toContain('clone-outfit')
    expect(hers.preview.prompts[0]!.text).toMatch(/Dress her in the outfit from the outfit reference image/)
    // A still of another character cannot be the outfit.
    await expect(estimateAction(h.deps, h.ctx, { type: 'clone', contentId: postId, characterIds: [second], outfit: 'hers', looks: { [second]: still.id }, keepSound: false })).rejects.toThrow(/Pick a still of Mara/)
  }, 120_000)

  it('a clip outside what a model takes is refused before any price (Kling O3 takes up to 15.5 s)', async () => {
    const long = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie })).id
    await source(long, { seconds: 20, audio: false })
    await drain(h, 20)
    await expect(estimateAction(h.deps, h.ctx, { type: 'clone', contentId: long, characterIds: [callie], model: 'higgsfield/kling-o3-video-edit', looks: {}, keepSound: false })).rejects.toThrow(/3 to 15.5 s/)
  }, 60_000)

  it('a paid take is never rejected: the old check\'s rejection can be kept; one that misses the video rule asks first', async () => {
    const [c] = await postClones(h.deps, h.ctx, postId)
    // The old check's "Not kept" shows again for the owner's call.
    await h.deps.db.update(candidates).set({ status: 'qa_failed', rejectNote: 'Looks like the performer.', qaReport: { verdict: 'regenerate', summary: '', findings: [{ code: 'too_similar', severity: 'fail', message: 'Looks like the performer.' }] } }).where(eq(candidates.id, c!.id))
    const shown = (await postClones(h.deps, h.ctx, postId)).find(x => x.id === c!.id)!
    expect(shown).toMatchObject({ status: 'in_review', error: null, oldReject: 'Looks like the performer.' })
    await keepClone(h.deps, h.ctx, c!.id)
    let [row] = await h.deps.db.select().from(candidates).where(eq(candidates.id, c!.id))
    expect(row!.status).toBe('approved')
    expect((row!.qaReport as { findings: Array<{ code: string; severity: string }> }).findings.find(f => f.code === 'too_similar')!.severity).toBe('warn')
    // A take that misses the video rule asks once, then is kept.
    const missing = { ok: false, face: 0.4, likeness: 0.5, margin: -0.1, frames: 3, reasons: ['Face match 0.40, needs 0.45 or more.'], note: null }
    await h.deps.db.update(candidates).set({ status: 'in_review', meta: { gate: missing } }).where(eq(candidates.id, c!.id))
    await expect(keepClone(h.deps, h.ctx, c!.id)).rejects.toMatchObject({ code: 'confirm_required' })
    await keepClone(h.deps, h.ctx, c!.id, true);
    [row] = await h.deps.db.select().from(candidates).where(eq(candidates.id, c!.id))
    expect(row!.status).toBe('approved')
    expect((row!.meta as { decision: { kind: string } }).decision.kind).toBe('kept')
  })

  it('"Make a video post" with another character\'s clone opens a new post at the Text step', async () => {
    const mara = (await postClones(h.deps, h.ctx, postId)).find(c => c.characterId === second)!
    const { id } = await postFromClone(h.deps, h.ctx, postId, mara.id)
    const post = await getContent(h.deps, h.ctx, id)
    expect(post).toMatchObject({ characterId: second, step: 'text', idea: 'Callie does the trend', accountTag: 'Callie TikTok' })
    expect((post.spec as MemeSpec).clipId).toBe(mara.id)
  })
})

describe('Clone Video: request shapes (official Model API Reference)', () => {
  const entry = (ref: string) => h.deps.config.models.models.find(m => m.ref === ref)!
  const req = (model: string, over: Partial<GenRequest> = {}): GenRequest => ({
    kind: 'video_clone', model, prompt: 'Swap the person.', durationSec: 10, resolution: '720p', audio: false,
    refs: [{ assetId: 'a', url: 'https://cdn.example/a.png' }, { assetId: 'b', url: 'https://cdn.example/b.png' }], sourceVideo: { assetId: 's', url: 'https://cdn.example/s.mp4' }, ...over,
  })

  it('Kling 3.0 Motion Control: one image, the clip, its own sound off, no duration', () => {
    expect(mapInput(entry('higgsfield/kling-3.0-motion-control-pro'), req('higgsfield/kling-3.0-motion-control-pro')))
      .toEqual({ prompt: 'Swap the person.', image_url: 'https://cdn.example/a.png', video_url: 'https://cdn.example/s.mp4', keep_original_sound: 'no', character_orientation: 'video' })
  })

  it('Genjutsu motion transfer: up to 8 images', () => {
    expect(mapInput(entry('higgsfield/genjutsu-motion-transfer'), req('higgsfield/genjutsu-motion-transfer')))
      .toEqual({ prompt: 'Swap the person.', video_url: 'https://cdn.example/s.mp4', image_urls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'], resolution: '720p' })
  })

  it('Seedance 2.5 video edit: generate_audio false', () => {
    expect(mapInput(entry('higgsfield/seedance-2.5-video-edit'), req('higgsfield/seedance-2.5-video-edit')))
      .toEqual({ prompt: 'Swap the person.', video_url: 'https://cdn.example/s.mp4', image_urls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'], resolution: '720p', generate_audio: false })
  })

  it('Kling O3 video edit: one clip in video_urls, up to 4 images', () => {
    expect(mapInput(entry('higgsfield/kling-o3-video-edit'), req('higgsfield/kling-o3-video-edit')))
      .toEqual({ prompt: 'Swap the person.', video_urls: ['https://cdn.example/s.mp4'], image_urls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'], mode: 'pro' })
  })
})
