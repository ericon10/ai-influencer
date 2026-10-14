import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { createContent, duplicateContent, getContent, updateContent, type ContentOutputs, type MemeSpec } from './content.js'
import { addSound } from './sounds.js'
import { addClip } from './clips.js'
import { deleteStyle, editorManifest, listStyles, saveFromEditor, saveStyle } from './openreel.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { ffmpeg, probeFile } from '../media/ffmpeg.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// The OpenReel editor (DECISIONS G29): the Studio hands the editor a post
// (its shots in order, its captions, its saved project) and Done hands back
// the browser's export and the project. The export can be WebM with VP9
// (a browser without an H.264 encoder); the worker makes it the same plain
// MP4 as every input (G27). Mock adapter only; nothing paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string
let clipId: string
let postId: string
let dir: string
let upl = 0

async function put(file: string, mime: string): Promise<string> {
  const uploadId = 'upl_' + String(upl++).padStart(20, 'e')
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(file), mime)
  return uploadId
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'openreel-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  const src = join(dir, 'clip.mp4')
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: 4, audio: true })
  clipId = (await addClip(h.deps, h.ctx, { characterId, uploadId: await put(src, 'video/mp4'), name: 'dance.mp4' })).id
  await drain(h, 20)
  postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'when the drop finally hits' } })).id
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('the editor manifest', () => {
  it('lays the post out: its shot from the Studio, the caption over the whole video, the canvas, no project yet', async () => {
    const m = await editorManifest(h.deps, h.ctx, postId)
    expect(m.canvas).toEqual({ width: 1080, height: 1920, fps: 30 })
    expect(m.media).toHaveLength(1)
    expect(m.media[0]).toMatchObject({ kind: 'video', role: 'clip', start: 0, in: 0, out: null })
    expect(m.media[0]!.url).toMatch(/^\/api\/v1\/assets\/ast_[a-z0-9]+\/content$/)
    expect(m.duration).toBeGreaterThan(3.5)
    expect(m.captions).toEqual([{ text: 'when the drop finally hits', start: 0, end: null }])
    expect(m.project).toBeNull()
  })

  it('suggests the payoff as a spot, and places the Idea step\'s Format once, as an editor preset', async () => {
    const plain = await editorManifest(h.deps, h.ctx, postId)
    expect(plain.suggestions).toHaveLength(1)
    expect(plain.suggestions[0]!.label).toBe('Payoff')
    expect(plain.suggestions[0]!.time).toBeCloseTo(plain.duration - h.deps.config.pipeline.edits.payoff_from_end, 1)
    expect(plain.format).toBeNull()
    const styled = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'zoom', edit: { style: 'zoom_reveal', strength: 'strong', payoff: 1.5 } } })).id
    const m = await editorManifest(h.deps, h.ctx, styled)
    expect(m.format).toEqual({ preset: 'pull_out', strength: 'strong' })
    expect(m.suggestions[0]!.time).toBe(1.5)
    // A style with no matching preset places nothing.
    await updateContent(h.deps, h.ctx, styled, { spec: { clipId, caption: 'zoom', edit: { style: 'seamless_loop' } } })
    expect((await editorManifest(h.deps, h.ctx, styled)).format).toBeNull()
    // Every preset the yaml names is one the editor has (the fork's list).
    const known = ['crash_zoom', 'whip_pan', 'zoom_through', 'spin', 'glitch', 'flash_cut', 'hand_lens', 'match_cut', 'speed_ramp', 'velocity', 'snap_zoom', 'punch_in', 'shake', 'freeze_pop', 'record_scratch', 'dolly_zoom', 'push_in', 'pull_out', 'rewind', 'karaoke', 'word_pop', 'caption_slam', 'text_behind', 'look_box', 'look_outline', 'split_screen', 'pip', 'green_screen']
    for (const st of h.deps.config.pipeline.edits.styles) if (st.preset) expect(known, st.id).toContain(st.preset)
  })

  it('opens video posts only, and says so', async () => {
    const show = (await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId })).id
    await expect(editorManifest(h.deps, h.ctx, show)).rejects.toThrow(/video posts/)
    const empty = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId })).id
    await expect(editorManifest(h.deps, h.ctx, empty)).rejects.toThrow(/Pick a clip/)
  })
})

describe('Done from the editor', () => {
  it('keeps the project and makes the WebM export the post\'s plain MP4', async () => {
    const webm = join(dir, 'export.webm')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus', '-shortest', webm])
    const uploadId = await put(webm, 'video/webm')
    const project = { id: 'p1', name: 'Edit', settings: { width: 1080, height: 1920, frameRate: 30 }, studioMedia: { m1: (await editorManifest(h.deps, h.ctx, postId)).media[0]!.id }, timeline: { tracks: [] }, mediaLibrary: { items: [] } }
    await saveFromEditor(h.deps, h.ctx, postId, { uploadId, project })
    let post = await getContent(h.deps, h.ctx, postId)
    expect(post.status).toBe('rendering')
    expect((post.spec as MemeSpec).editor?.projectAssetId).toBeTruthy()
    await drain(h, 30)
    post = await getContent(h.deps, h.ctx, postId)
    expect(post.status).toBe('ready')
    const o = post.outputs as ContentOutputs
    expect(o.fromEditor).toBe(true)
    const out = join(dir, 'out.mp4')
    await writeFile(out, (await readAsset(h.deps, h.ctx, o.videoAssetId!)).data)
    const p = await probeFile(out)
    expect(p).toMatchObject({ width: 1080, height: 1920, hasAudio: true })
    expect(p.durationSec!).toBeGreaterThan(1.8)
    // The upload is gone; the project comes back on the next open.
    expect(await h.deps.store.exists(uploadKey(h.ctx.accountId, uploadId))).toBe(false)
    const again = await editorManifest(h.deps, h.ctx, postId)
    expect(again.project).toMatchObject({ id: 'p1', studioMedia: project.studioMedia })
  }, 120_000)

  it('keeps the stack, and Make another like this carries it (not the timeline) to the next post', async () => {
    const webm = join(dir, 'export2.webm')
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=1', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', webm])
    const stack = [{ preset: 'snap_zoom', strength: 'strong', at: { on: 'payoff', ratio: 0.7 }, duration: 1.2 }, { preset: 'glitch', at: { on: 'cut', index: 0, offset: 0, ratio: 0.4 } }]
    await saveFromEditor(h.deps, h.ctx, postId, { uploadId: await put(webm, 'video/webm'), project: { id: 'p2', timeline: { tracks: [] }, mediaLibrary: { items: [] } }, stack })
    await drain(h, 30)
    expect((await getContent(h.deps, h.ctx, postId)).spec).toMatchObject({ editor: { stack: [{ preset: 'snap_zoom', strength: 'strong' }, { preset: 'glitch', strength: 'normal' }] } })
    // The original reopens its own timeline; the copy starts fresh with the stack.
    expect((await editorManifest(h.deps, h.ctx, postId)).stack).toBeNull()
    const copy = await duplicateContent(h.deps, h.ctx, postId)
    const m = await editorManifest(h.deps, h.ctx, copy.id)
    expect(m.project).toBeNull()
    expect(m.format).toBeNull()
    expect(m.stack?.map(x => x.preset)).toEqual(['snap_zoom', 'glitch'])
  }, 120_000)

  it('refuses a save whose video never finished uploading', async () => {
    await expect(saveFromEditor(h.deps, h.ctx, postId, { uploadId: 'upl_' + 'z'.repeat(20), project: {} })).rejects.toThrow(/did not finish uploading/)
    await expect(saveFromEditor(h.deps, h.ctx, postId, { uploadId: 'nope', project: {} })).rejects.toThrow()
  })
})

describe('the sound bed in the editor', () => {
  it('puts the post\'s uploaded music on the timeline, where the editor finds its beat', async () => {
    const wav = join(dir, 'beat.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', wav])
    const sound = await addSound(h.deps, h.ctx, { uploadId: await put(wav, 'audio/wav'), name: 'beat.wav', kind: 'music' })
    await drain(h, 20)
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId, spec: { clipId, caption: 'music', sound: { music: sound.id } } })).id
    const m = await editorManifest(h.deps, h.ctx, post)
    const music = m.media.find(x => x.role === 'music')
    expect(music).toMatchObject({ kind: 'audio', start: 0 })
    expect(m.media.filter(x => x.role === 'clip')).toHaveLength(1)
  }, 120_000)
})

describe('saved styles', () => {
  it('saves, lists, replaces by name and deletes; the manifest lists them', async () => {
    const items = [{ preset: 'snap_zoom', at: { on: 'payoff', ratio: 0.7 } }]
    await expect(saveStyle(h.deps, h.ctx, { name: 'Payoff zoom', items: [] })).rejects.toThrow(/at least one preset/)
    await expect(saveStyle(h.deps, h.ctx, { name: '', items })).rejects.toThrow(/name/)
    const one = await saveStyle(h.deps, h.ctx, { name: 'Payoff zoom', items })
    expect(one.id).toMatch(/^sty_/)
    const two = await saveStyle(h.deps, h.ctx, { name: 'payoff zoom', items: [...items, { preset: 'shake', strength: 'subtle', at: { on: 'end', offset: 0.5, ratio: 0.9 } }] })
    const list = await listStyles(h.deps, h.ctx)
    expect(list.map(x => x.id)).toEqual([two.id])
    expect((await editorManifest(h.deps, h.ctx, postId)).styles.map(x => x.name)).toEqual(['payoff zoom'])
    await deleteStyle(h.deps, h.ctx, two.id)
    expect(await listStyles(h.deps, h.ctx)).toEqual([])
    await expect(deleteStyle(h.deps, h.ctx, two.id)).rejects.toThrow(/already gone/)
  })
})
