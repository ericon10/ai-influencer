import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { createScene, sceneCandidates } from './scenes.js'
import { scenesView } from '../api/views.js'
import { videoPrices } from './sceneActions.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { getJob } from '../jobs/runner.js'
import { getAsset } from '../storage/assets.js'
import { eq } from 'drizzle-orm'
import { assets } from '../db/schema.js'
import type { FaceMatcher } from '../qa/faces.js'
import type { GenRequest } from '../providers/types.js'

// Stage 9 in demo mode (mock providers, nothing paid): a take straight from
// a picked still, the quick motion test, "Upscale this take", and the end
// frame helper that inpaints only the head.

const FIX = join(process.cwd(), 'fixtures', 'callie')
// A face where the placeholder portrait draws one (for the head mask).
const faces: FaceMatcher = {
  status: async () => ({ available: true }),
  detect: async () => [{ box: { x: 300, y: 260, w: 260, h: 300 }, landmarks: [], score: 0.99 }],
  analyze: async () => null,
}

let h: Harness
let characterId: string
let sceneId: string
let stillId: string

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs }
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness({ faces })
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie laughs on a sunny park bench' })).id
  await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: false })
  stillId = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'generate' && c.assetId)!.id
}, 180_000)

describe('video from a picked still (Stage 9, demo mode)', () => {
  const take = (over: Partial<Extract<StudioAction, { type: 'scene_video' }>> = {}): StudioAction => ({
    type: 'scene_video', characterId, candidateId: stillId, motion: 'Callie laughs and turns toward the camera',
    directions: 'No talking, no winking, steady eye contact. One continuous take, no cuts.', durationSec: 5, aspect: '9:16', audio: false, takes: 1, test: false, ...over,
  })

  it('goes straight to the picked model (Kling 3.0 Pro by default): 9:16, audio off, the directions, REALISM, and the upscale price shown too', async () => {
    const { preview, jobs, quote } = await run(take())
    const text = preview.prompts[0]!.text
    expect(text).toContain('Callie laughs and turns toward the camera.')
    expect(text).toContain('No talking, no winking, steady eye contact.')
    expect(text).toContain('Silent, no audio, no dialogue.')
    expect(text).toMatch(/\nREALISM: .{20,}/)
    expect(quote.items[0]!.label).toBe('Video take')
    expect(preview.followUp?.label).toMatch(/Upscale this take/)
    expect(preview.followUp?.display).toBeTruthy()
    const job = await getJob(h.deps, h.ctx, jobs[0]!.id)
    expect(job.request as GenRequest).toMatchObject({ kind: 'video', aspect: '9:16', durationSec: 5, audio: false })
    expect((job.request as GenRequest).resolution).toBeUndefined()
    const clip = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video')!
    expect(clip.status).toBe('in_review')
    expect((await getAsset(h.deps, h.ctx, clip.assetId!)).kind).toBe('video')
    const view = (await scenesView(h.deps, h.ctx, characterId)).scenes.find(s => s.id === sceneId)!
    expect(view.candidates.find(c => c.id === clip.id)!.media).toBe('video')
  })

  it('the quick motion test is optional: 5 s on the cheap model, labeled faces not representative, no upscale price', async () => {
    const { preview, jobs } = await run(take({ test: true, durationSec: 10 }))
    expect(preview.title).toBe('Quick motion test')
    expect(preview.followUp).toBeUndefined()
    expect((await getJob(h.deps, h.ctx, jobs[0]!.id)).request).toMatchObject({ durationSec: 5 })
    const test = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.jobId === jobs[0]!.id)!
    expect(JSON.stringify(test.qaReport)).toMatch(/faces not representative/)
  })

  it('"Upscale this take" keeps the exact take and checks the skin', async () => {
    const clip = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video')!
    const { quote } = await run({ type: 'scene_video_upscale', characterId, candidateId: clip.id })
    expect(quote.items[0]!.label).toBe('Upscale this take')
    const up = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'video_upscale')!
    expect(up.parentId).toBe(clip.id)
    expect(up.status).toBe('in_review')
    expect((await getAsset(h.deps, h.ctx, up.assetId!)).kind).toBe('video')
  })

  it('the end frame helper inpaints only the head: a mask, REF-00 for the face, and QA', async () => {
    const { preview, jobs } = await run({ type: 'scene_end_frame', characterId, candidateId: stillId, change: 'she turns her head toward the camera and looks into the lens', withQa: true })
    expect(preview.prompts[0]!.text).toMatch(/Edit only the masked area, her head and face/)
    const req = (await getJob(h.deps, h.ctx, jobs[0]!.id)).request as GenRequest
    const stillAsset = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.id === stillId)!.assetId!
    // The quote names the still to mask; the worker made the mask at submit.
    expect(req.maskFor).toEqual({ assetId: stillAsset, region: 'head' })
    expect(req.refs).toHaveLength(2)
    const [mask] = await h.deps.db.select().from(assets).where(eq(assets.label, `head mask for ${stillAsset}`))
    expect(mask?.kind).toBe('image')
    const end = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'end_frame')!
    expect(end.parentId).toBe(stillId)
    // The same mask is reused, so a second estimate matches the first.
    const again = await estimateAction(h.deps, h.ctx, { type: 'scene_end_frame', characterId, candidateId: stillId, change: 'a soft laugh', withQa: false })
    expect(again.quote.status).toBe('open')
    // Start and end frame together in one take.
    const both = await estimateAction(h.deps, h.ctx, take({ endCandidateId: end.id }))
    expect(both.quote.status).toBe('open')
  })
  it('picks any of the five video models, each priced; the last pick is the next default', async () => {
    const before = (await scenesView(h.deps, h.ctx, characterId)).options.video
    expect(before.models.map(m => m.label)).toEqual(['Kling 3.0 Pro', 'Kling 3.0 Standard', 'Seedance 2.0', 'Seedance 2.5', 'Wan 3.0 Prime'])
    expect(before.model.ref).toBe('higgsfield/kling-3.0-pro')
    const prices = await videoPrices(h.deps, h.ctx, { durationSec: 5, aspect: '9:16' })
    expect(prices.map(p => p.label)).toEqual(before.models.map(m => m.label))
    for (const p of prices) expect(p.display).toBeTruthy()
    const { jobs } = await run(take({ model: 'higgsfield/seedance-2.5' }))
    expect((await getJob(h.deps, h.ctx, jobs[0]!.id)).request).toMatchObject({ resolution: '720p' })
    expect((await scenesView(h.deps, h.ctx, characterId)).options.video.model.ref).toBe('higgsfield/seedance-2.5')
    // With no model named, the next take uses the last pick.
    const next = await estimateAction(h.deps, h.ctx, take())
    expect(next.quote.status).toBe('open')
    await expect(estimateAction(h.deps, h.ctx, take({ model: 'higgsfield/soul-2' }))).rejects.toThrow(/not offered for video/)
  })
})
