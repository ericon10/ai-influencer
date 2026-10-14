import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { createContent, getContent, type MemeSpec } from './content.js'
import { addCloneSource, setCloneCleanup } from './clone.js'
import { estimateAction, runAction } from './actions.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { captionPng } from '../core/overlay.js'
import { ffmpeg } from '../media/ffmpeg.js'
import { getAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// Clone source cleanup and "Read its caption" (overnight item 3), through
// the clone source job. Mock adapter only: the caption reader is the mock
// Claude, run with a quote like every paid step.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness, characterId: string, postId: string, dir: string

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'clonecleanup-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  // A saved TikTok: a moving picture, a burned-in caption, then the end card.
  const cfg = h.deps.config.pipeline.content
  const cap = join(dir, 'cap.png'), body = join(dir, 'body.mp4'), end = join(dir, 'end.mp4'), clip = join(dir, 'tiktok.mp4')
  await writeFile(cap, (await captionPng('pov: the recruiter said they would be in touch', cfg)).png)
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x960:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=7', '-i', cap,
    '-filter_complex', "[0:v]crop=540:960:x='t*80':y=0,noise=alls=40:allf=t[bg];[2:v]scale=540:960[c];[bg][c]overlay=0:0[v]", '-map', '[v]', '-map', '1:a', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', body])
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=black:s=540x960:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', end])
  await ffmpeg(['-y', '-i', body, '-i', end, '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip])
  postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId })).id
  const uploadId = 'upl_' + 'k'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(clip), 'video/mp4')
  await addCloneSource(h.deps, h.ctx, { contentId: postId, uploadId, name: 'saved-tiktok.mp4' })
  await drain(h, 20)
}, 300_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const source = async () => (await getContent(h.deps, h.ctx, postId)).spec as MemeSpec

describe('the clip to clone is cleaned first', () => {
  it('trims the end card and fills in the burned-in caption; the clean copy is the one used', async () => {
    const c = (await source()).clone!
    expect(c.status).toBe('ready')
    expect(c.cleanup).toMatchObject({ on: true })
    expect(c.cleanup!.endCardSec).toBeGreaterThan(1.5)
    expect(c.cleanup!.spots).toBeGreaterThanOrEqual(1)
    expect(c.assetId).toBe(c.cleanAssetId)
    expect(c.durationSec!).toBeLessThan(5.4)
    expect(((await getAsset(h.deps, h.ctx, c.originalAssetId!)).durationMs ?? 0) / 1000).toBeGreaterThan(6.5)
    expect(c.textFrameId).toBeTruthy()
  })

  it('Undo the cleanup uses the clip as uploaded, and back', async () => {
    let c = await setCloneCleanup(h.deps, h.ctx, postId, false)
    expect(c.assetId).toBe(c.originalAssetId)
    expect(c.durationSec!).toBeGreaterThan(6.5)
    c = await setCloneCleanup(h.deps, h.ctx, postId, true)
    expect(c.assetId).toBe(c.cleanAssetId)
  })

  it('Read its caption: priced first, then the post\'s caption takes what was read', async () => {
    const action = { type: 'clone_caption' as const, characterId, contentId: postId }
    const { quote } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.items.length).toBe(1)
    await runAction(h.deps, h.ctx, action, quote.id, true)
    await drain(h, 10)
    const s = await source()
    expect(s.clone!.sourceCaption).toBe('when the drop finally hits')
    expect(s.caption).toBe('when the drop finally hits')
  })
})
