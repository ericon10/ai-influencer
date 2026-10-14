import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { createContent, getContent, type ContentOutputs, type MemeSpec } from './content.js'
import { addClip } from './clips.js'
import { editorManifest, saveFromEditor } from './openreel.js'
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

  it('refuses a save whose video never finished uploading', async () => {
    await expect(saveFromEditor(h.deps, h.ctx, postId, { uploadId: 'upl_' + 'z'.repeat(20), project: {} })).rejects.toThrow(/did not finish uploading/)
    await expect(saveFromEditor(h.deps, h.ctx, postId, { uploadId: 'nope', project: {} })).rejects.toThrow()
  })
})
