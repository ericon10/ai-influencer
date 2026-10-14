import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { brollClips } from '../db/schema.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { addBroll, createContent, getContent, retryFailedBatch, startRender, type ContentOutputs } from './content.js'
import { addClip } from './clips.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// Phase 4, batch at scale: 25 videos with three clips and two B-roll clips
// rotated, each its own job; a job that runs twice never counts twice; a
// failure is retried on its own; the download comes in zip parts.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string
let dir: string
const clips: string[] = []
const brolls: string[] = []
let upl = 0

async function upload(kind: 'clip' | 'broll', name: string, source: string, w: number, hgt: number) {
  const src = join(dir, `${name}.mp4`)
  await makeClip(src, { width: w, height: hgt, fps: 24, durationSec: 1, source })
  const uploadId = 'upl_' + String(upl++).padStart(20, 'q')
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  return kind === 'clip' ? (await addClip(h.deps, h.ctx, { characterId, uploadId, name: `${name}.mp4` })).id : (await addBroll(h.deps, h.ctx, { uploadId, name: `${name}.mp4` })).id
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'batch-scale-'))
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  for (const [i, src] of ['testsrc2', 'smptebars', 'rgbtestsrc'].entries()) clips.push(await upload('clip', `clip${i}`, src, 270, 480))
  for (const [i, src] of ['testsrc', 'smptehdbars'].entries()) brolls.push(await upload('broll', `broll${i}`, src, 640, 360))
  await drain(h, 20)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('batch at scale', () => {
  let postId: string

  it('25 videos, clips and B-roll rotated, in zip parts that hold them all', async () => {
    const captions = Array.from({ length: 25 }, (_, i) => `caption number ${i + 1}`)
    postId = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId, spec: { clipIds: clips, brollIds: brolls, brollSeconds: 0.5, captions, sound: { ambience: 'none' } } })).id
    // Small parts, so this batch needs several.
    h.deps.config.pipeline.content.batch.zip_part_mb = 0.4
    await startRender(h.deps, h.ctx, postId)
    await drain(h, 80)
    const row = await getContent(h.deps, h.ctx, postId)
    const out = row.outputs as ContentOutputs
    expect(row.status).toBe('ready')
    expect(out).toMatchObject({ done: 25, failed: 0, total: 25 })
    for (let i = 0; i < 25; i++) {
      expect(out.videos![i]).toMatchObject({ caption: captions[i], clipId: clips[i % 3], brollId: brolls[i % 2] })
    }
    expect(out.zipParts!.length).toBeGreaterThan(1)
    expect(out.zipAssetId).toBe(out.zipParts![0]!.assetId)
    const names = new Set<string>()
    for (const part of out.zipParts!) {
      const zip = unzipSync(new Uint8Array((await readAsset(h.deps, h.ctx, part.assetId)).data))
      expect(Object.keys(zip)).toContain('captions.txt')
      for (const n of Object.keys(zip)) if (n.endsWith('.mp4')) names.add(n)
      expect(part.to).toBeGreaterThanOrEqual(part.from)
    }
    expect(names.size).toBe(25)
  }, 300_000)

  it('a video job that runs again (a crash, a deploy) overwrites its own slot, never counts twice', async () => {
    await enqueueLocalJob(h.deps, h.ctx, { stage: 'content', purpose: `content_render:${postId}`, label: 'Render batch video 4 of 25', characterId, request: { index: 3 } })
    await drain(h, 20)
    const out = (await getContent(h.deps, h.ctx, postId)).outputs as ContentOutputs
    expect(out).toMatchObject({ done: 25, failed: 0, total: 25 })
    expect(out.videos!.filter(Boolean)).toHaveLength(25)
  }, 120_000)

  it('failures are kept by video; Retry the failed ones renders only those', async () => {
    // The second B-roll is not ready: every video that rotates onto it fails.
    await h.deps.db.update(brollClips).set({ status: 'processing' }).where(eq(brollClips.id, brolls[1]!))
    const captions = Array.from({ length: 6 }, (_, i) => `retry ${i + 1}`)
    const post = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId, spec: { clipIds: clips, brollIds: brolls, brollSeconds: 0.5, captions, sound: { ambience: 'none' } } })).id
    await startRender(h.deps, h.ctx, post)
    await drain(h, 40)
    let row = await getContent(h.deps, h.ctx, post)
    let out = row.outputs as ContentOutputs
    expect(row.status).toBe('failed')
    expect(out).toMatchObject({ done: 3, failed: 3, total: 6 })
    expect(Object.keys(out.errors!).sort()).toEqual(['1', '3', '5'])
    expect(out.errors!['1']).toMatch(/not ready yet/)
    expect(row.error).toMatch(/3 of 6 videos failed; the rest are ready/)
    await h.deps.db.update(brollClips).set({ status: 'ready' }).where(eq(brollClips.id, brolls[1]!))
    await retryFailedBatch(h.deps, h.ctx, post)
    await drain(h, 40)
    row = await getContent(h.deps, h.ctx, post)
    out = row.outputs as ContentOutputs
    expect(row.status).toBe('ready')
    expect(row.error).toBeNull()
    expect(out).toMatchObject({ done: 6, failed: 0 })
    expect(out.errors).toEqual({})
    await expect(retryFailedBatch(h.deps, h.ctx, post)).rejects.toThrow(/No video in this batch failed/)
  }, 300_000)
})
