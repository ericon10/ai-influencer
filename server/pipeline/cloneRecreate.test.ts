import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, like } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { createContent, getContent, type MemeSpec } from './content.js'
import { addCloneSource, cloneModel, cloneOptions, cloneStills, pickCloneStill, postClones, readLook, setCloneNotLike, trimClone } from './clone.js'
import { jobs } from '../db/schema.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { probeFile } from '../media/ffmpeg.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import type { GenRequest } from '../providers/types.js'

// Recreate from a real clip (owner, 2026-10-14), proven twice by hand: a
// rave clip and a kitchen hair-flip clip. The clip's frame about 0.2 s in,
// 4 stills of the character in it, pick one (or "You pick"), a face-only
// pass, the free checks, the motion from the clip as uploaded, then a trim.
// Mock adapter only; nothing paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let callie: string
let postId: string
let dir: string

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const res = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs: res.jobs }
}

const cloneOf = async () => ((await getContent(h.deps, h.ctx, postId)).spec as MemeSpec).clone!
const requests = async (prefix: string) => (await h.deps.db.select().from(jobs).where(and(eq(jobs.accountId, h.ctx.accountId), like(jobs.purpose, `${prefix}%`)))).map(j => j.request as GenRequest)

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'clone-recreate-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, idea: 'Callie at the rave' })).id
  // A dark clip full of movement, like a club.
  const src = join(dir, 'club.mp4')
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: 6, audio: true, vf: 'eq=brightness=-0.45' })
  const uploadId = 'upl_' + 'c'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  await addCloneSource(h.deps, h.ctx, { contentId: postId, uploadId, name: 'club.mp4' })
  await drain(h, 30)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('the free read of the clip suggests the route', () => {
  it('a dark clip with a lot of movement suggests Recreate, with why; a bright still one suggests Replace', async () => {
    const c = await cloneOf()
    expect(c.rawFrameId).toBeTruthy()
    expect(c.motionAssetId).toBeTruthy()
    expect(c.look).toMatchObject({ dark: true, suggest: 'motion' })
    const o = await cloneOptions(h.deps, h.ctx, postId)
    expect(o.mode).toBe('motion')
    expect(o.suggest!.why).toMatch(/dark clip/)
    expect(o.takes).toEqual({ still: 4, face: 2 })
    const bright = join(dir, 'bright.mp4')
    await makeClip(bright, { width: 180, height: 320, fps: 15, durationSec: 3, source: 'color', vf: 'eq=brightness=0.7' })
    expect(await readLook(bright, h.deps.config.pipeline.content.clone.recreate)).toMatchObject({ dark: false, motion: 0, suggest: 'replace', why: '' })
  }, 60_000)

  it('the motion step starts at Wan 3.0, then the last model used', async () => {
    expect(await cloneModel(h.deps, h.ctx, 'motion')).toBe('higgsfield/wan-3.0-motion')
    const o = await cloneOptions(h.deps, h.ctx, postId)
    const motion = o.models.filter(m => m.mode === 'motion').map(m => m.label)
    expect(motion).toEqual(['Genjutsu', 'Wan 3.0', 'Wan 3.0 Prime', 'Kling 3.0 Motion Control'])
  })
})

describe('the stills, the face pass and the pick', () => {
  it('Read them for me fills the traits she must not have; the stills prompt names them', async () => {
    await run({ type: 'clone_traits', contentId: postId, characterId: callie })
    expect((await cloneOf()).notLike).toBe('dark brown hair, brown eyes, a nose ring, winged liner')
    await setCloneNotLike(h.deps, h.ctx, postId, 'dark brown hair, brown eyes, a septum piercing, winged liner')
    const { preview, quote } = await run({ type: 'clone_still', contentId: postId, characterId: callie })
    expect(quote.items).toHaveLength(4)
    expect(preview.prompts[0]!.text).toContain("She must not have that person's dark brown hair, brown eyes, a septum piercing, winged liner.")
    const reqs = await requests(`clone_still:${postId}:`)
    expect(reqs[0]!.refs![0]!.assetId).toBe((await cloneOf()).rawFrameId)
    // Standard: 1k, like every still (1.5 plan credits for Nano Banana 2.1).
    expect(reqs.map(r => r.resolution)).toEqual(['1k', '1k', '1k', '1k'])
  }, 120_000)

  it('Fix the face: 2 takes on the chosen still, only the face changes', async () => {
    const stills = await cloneStills(h.deps, h.ctx, postId)
    const chosen = stills.find(x => x.pass === 'still' && !x.error)!
    const { preview } = await run({ type: 'clone_face', contentId: postId, characterId: callie, candidateId: chosen.id })
    expect(preview.prompts[0]!.text).toMatch(/^Change only her face to match Callie \(the person in the other reference images\)/)
    expect(preview.prompts[0]!.text).toMatch(/Keep everything else in the image exactly the same, pixel for pixel/)
    const face = (await cloneStills(h.deps, h.ctx, postId)).filter(x => x.pass === 'face')
    expect(face).toHaveLength(2)
    expect(face.every(x => x.parentId === chosen.id && !x.kept)).toBe(true)
    const reqs = await requests(`clone_face:${postId}:`)
    expect(reqs[0]!.refs![0]!.assetId).toBe(chosen.assetId)
  }, 120_000)

  it('You pick keeps one still for the run, never one that looks like the person in the clip', async () => {
    const { id } = await pickCloneStill(h.deps, h.ctx, postId, callie)
    expect((await cloneOf()).stills[callie]).toBe(id)
  })
})

describe('the motion and the trim', () => {
  it('the motion comes from the cleaned clip; Trim keeps a shorter copy and the original', async () => {
    const c = await cloneOf()
    await run({ type: 'clone', contentId: postId, characterIds: [callie], mode: 'motion', model: 'higgsfield/genjutsu-motion-control', looks: {}, keepSound: false })
    const [motion] = await requests(`clone:${postId}:`)
    expect(motion!.sourceVideo!.assetId).toBe(c.assetId)
    const [clone] = await postClones(h.deps, h.ctx, postId)
    expect(clone!.assetId).toBeTruthy()
    await expect(trimClone(h.deps, h.ctx, clone!.id, { start: 1, end: 1.2 })).rejects.toThrow(/half a second/)
    await trimClone(h.deps, h.ctx, clone!.id, { start: 1, end: 3 })
    await drain(h, 20)
    const list = await postClones(h.deps, h.ctx, postId)
    const trimmed = list.find(x => x.label.includes('trimmed'))!
    expect(trimmed).toBeTruthy()
    expect(list.some(x => x.id === clone!.id)).toBe(true)
    const info = await probeFile(await (async () => { const f = join(dir, 't.mp4'); await (await import('node:fs/promises')).writeFile(f, (await readAsset(h.deps, h.ctx, trimmed.assetId!)).data); return f })())
    expect(info.durationSec).toBeGreaterThan(1.8)
    expect(info.durationSec).toBeLessThan(2.3)
  }, 180_000)
})
