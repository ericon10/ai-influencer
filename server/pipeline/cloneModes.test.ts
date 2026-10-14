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
import { approvedAssets } from './characters.js'
import { createContent, getContent, updateContent, type MemeSpec } from './content.js'
import { addCloneSource, cloneOptions, cloneStills, setCloneTarget, useCloneStill } from './clone.js'
import { jobs } from '../db/schema.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { uploadKey } from '../storage/uploads.js'
import { pickPerson, targetWords } from '../core/cloneTarget.js'
import type { FaceMatcher } from '../qa/faces.js'
import type { GenRequest } from '../providers/types.js'

// The rave clip (owner, 2026-10-14, G28). A clone of a rave TikTok ran a
// motion model with seven sheet images: it came back in a gray studio, in
// the sheet's white tee and jeans, and a background dancer became a second
// Callie. Now "Replace the person (keep the scene)" is the default: only
// the main person changes, with REF-00 and one three-quarter view; the
// clip's place, light, crowd and outfit stay. "Copy the moves" never gets a
// bare sheet image: it starts from a scene still of her in the clip's place.
// Mock adapter only; nothing paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let callie: string
let postId: string
let dir: string
let faceFinder = false

// Two dancers on the first frame (360x640): the main one in the center,
// close to the camera, and a smaller one further back on the left.
const MAIN = { x: 130, y: 150, w: 100, h: 120 }
const BACK = { x: 24, y: 210, w: 40, h: 48 }
const faces: FaceMatcher = {
  async status() { return faceFinder ? { available: true } : { available: false, reason: 'off until the clip arrives' } },
  async detect() { return [BACK, MAIN].map(box => ({ box, landmarks: [], score: 0.92 })) },
  async analyze() { return null },
}

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  const res = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { preview, jobs: res.jobs }
}

const cloneOf = async () => ((await getContent(h.deps, h.ctx, postId)).spec as MemeSpec).clone!
const requests = async (prefix: string) => (await h.deps.db.select().from(jobs).where(and(eq(jobs.accountId, h.ctx.accountId), like(jobs.purpose, `${prefix}%`)))).map(j => j.request as GenRequest)

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness({ faces })
  dir = await mkdtemp(join(tmpdir(), 'clone-modes-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, idea: 'Callie at the rave' })).id
  faceFinder = true
  const src = join(dir, 'rave.mp4')
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: 8, audio: true })
  const uploadId = 'upl_' + 'r'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  await addCloneSource(h.deps, h.ctx, { contentId: postId, uploadId, name: 'rave.mp4' })
  await drain(h, 30)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('Clone: which person changes', () => {
  it('finds the people on the first frame, largest first, and words the pick for the prompt', async () => {
    const c = await cloneOf()
    expect(c.status).toBe('ready')
    expect(c.firstFrameId).toBeTruthy()
    expect(c.people).toHaveLength(2)
    expect(c.people[0]!.w).toBeGreaterThan(c.people[1]!.w)
    const t = h.deps.config.pipeline.templates.clone
    expect(targetWords(t, c.people, null)).toBe('the main person (the largest person, closest to the camera)')
    expect(pickPerson(c.people, { x: 0.12, y: 0.36 })).toBe(1)
    expect(targetWords(t, c.people, { x: 0.12, y: 0.36 })).toBe('the person on the left side of the frame, further back')
  })
})

describe('Clone: "Replace the person (keep the scene)" is the default', () => {
  it('sends REF-00 and one three-quarter view only, the clip as the video, and keeps the scene and outfit', async () => {
    const approved = await approvedAssets(h.deps, h.ctx, callie)
    const action: StudioAction = { type: 'clone', contentId: postId, characterIds: [callie], looks: {}, keepSound: true }
    const { preview } = await run(action)
    expect(preview.title).toBe('Replace the person in "rave" for Callie')
    // Two people in the clip and no tap: the largest one, with a note.
    expect(preview.warnings.map(w => w.ruleId)).toContain('clone-target')
    const text = preview.prompts[0]!.text
    expect(text).toMatch(/Replace only the main person \(the largest person, closest to the camera\)/)
    expect(text).toMatch(/Every other person in the video stays exactly as they are/)
    expect(text).toMatch(/Keep the place, the lighting, the crowd/)
    expect(text).toMatch(/Keep the clothes, shoes and accessories/)
    expect(text).toMatch(/REALISM/)
    const [req] = await requests(`clone:${postId}:`)
    expect(req!.refs!.map(r => r.assetId)).toEqual([approved.get('REF-00'), approved.get('REF-01')])
    // Never the rest of the sheet (the full-body shots taught the gray
    // studio and the tee and jeans).
    for (const id of ['REF-06', 'REF-07', 'REF-08', 'REF-09', 'REF-10', 'REF-11']) expect(req!.refs!.map(r => r.assetId)).not.toContain(approved.get(id))
    expect(req!.sourceVideo!.assetId).toBe((await cloneOf()).assetId)
    expect(req!.cloneBackground).toBe('video')
  }, 120_000)

  it('a tap on the dancer in the back replaces that one instead, and the note goes away', async () => {
    await setCloneTarget(h.deps, h.ctx, postId, { x: 0.12, y: 0.36 })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'clone', contentId: postId, characterIds: [callie], looks: {}, keepSound: false })
    expect(preview.prompts[0]!.text).toMatch(/Replace only the person on the left side of the frame, further back/)
    expect(preview.warnings.map(w => w.ruleId)).not.toContain('clone-target')
    expect((await cloneOptions(h.deps, h.ctx, postId)).target).toBe('the person on the left side of the frame, further back')
    await setCloneTarget(h.deps, h.ctx, postId, null)
  })

  it('a motion model is refused under "Replace the person", with the way forward', async () => {
    await expect(estimateAction(h.deps, h.ctx, { type: 'clone', contentId: postId, characterIds: [callie], mode: 'replace', model: 'higgsfield/genjutsu-motion-transfer', looks: {}, keepSound: false }))
      .rejects.toThrow(/does not keep the clip's scene/)
  })
})

describe('Clone: "Copy the moves into a new scene" never gets a bare sheet image', () => {
  it('refuses the motion run until there is a scene still (the rave bug path)', async () => {
    await expect(estimateAction(h.deps, h.ctx, { type: 'clone', contentId: postId, characterIds: [callie], model: 'higgsfield/genjutsu-motion-transfer', looks: {}, keepSound: false }))
      .rejects.toThrow(/scene still first/)
  })

  it('the scene still edits the first frame with her face images; the first good one is kept; the run uses only it', async () => {
    const approved = await approvedAssets(h.deps, h.ctx, callie)
    // Recreate from a real clip (owner, 2026-10-14): 4 stills from the frame
    // as uploaded, used only for place, light, angle, framing, pose and
    // outfit; the person replaced completely; text and logos removed.
    const { preview } = await run({ type: 'clone_still', contentId: postId, characterId: callie })
    const text = preview.prompts[0]!.text
    expect(text).toMatch(/^Use the first image only for the place, the light, the camera angle, the framing, the pose and the outfit\. Replace the main person \(the largest person, closest to the camera\) in it completely with Callie \(the person in the other reference images\)/)
    expect(text).toMatch(/Her hair is long honey-blonde\./)
    expect(text).toMatch(/Keep the head angle and the gaze of the first image\. Remove all caption text, the TikTok logo and the username/)
    expect(text).toContain('She is an adult, 21 or older.')
    expect(text).toMatch(/REALISM/)
    const c = await cloneOf()
    const stillReqs = await requests(`clone_still:${postId}:`)
    expect(stillReqs).toHaveLength(4)
    expect(stillReqs.map(r => r.aspect)).toEqual(['9:16', '9:16', '9:16', '9:16'])
    expect(stillReqs[0]!.refs!.map(r => r.assetId)).toEqual([c.rawFrameId, approved.get('REF-00'), approved.get('REF-01')])
    const stills = await cloneStills(h.deps, h.ctx, postId)
    expect(stills).toHaveLength(4)
    expect(stills.filter(x => x.kept)).toHaveLength(1)
    expect(stills.every(x => x.pass === 'still' && x.characterName === 'Callie')).toBe(true)
    const keptId = stills.find(x => x.kept)!.id
    expect(c.stills[callie]).toBe(keptId)

    await run({ type: 'clone', contentId: postId, characterIds: [callie], model: 'higgsfield/genjutsu-motion-transfer', looks: {}, keepSound: false })
    const motion = (await requests(`clone:${postId}:`)).find(r => r.cloneBackground === 'image')!
    const { candidates } = await import('../db/schema.js')
    const [still] = await h.deps.db.select().from(candidates).where(eq(candidates.id, keptId))
    expect(motion.refs!.map(r => r.assetId)).toEqual([still!.assetId])
    // The motion comes from the clip as uploaded, never the filled-in copy.
    expect(motion.sourceVideo!.assetId).toBe(c.motionAssetId ?? c.originalAssetId)
    expect(motion.cloneBackground).toBe('image')
    for (const id of ['REF-00', 'REF-01', 'REF-06']) expect(motion.refs!.map(r => r.assetId)).not.toContain(approved.get(id))
    // "Use this still" checks the still belongs to this post.
    await expect(useCloneStill(h.deps, h.ctx, postId, keptId)).resolves.toEqual({ ok: true })
  }, 120_000)

  it('a new tap drops the kept scene stills, since they show the old pick', async () => {
    await setCloneTarget(h.deps, h.ctx, postId, { x: 0.5, y: 0.3 })
    expect((await cloneOf()).stills).toEqual({})
  })
})

describe('Clone: a clip prepared before first frames existed', () => {
  it('gets its first frame when the panel opens (free, on the worker)', async () => {
    const c = await cloneOf()
    await updateContent(h.deps, h.ctx, postId, { spec: { clone: { ...c, firstFrameId: null, people: [] } } })
    await cloneOptions(h.deps, h.ctx, postId)
    await drain(h, 20)
    const after = await cloneOf()
    expect(after.firstFrameId).toBeTruthy()
    expect(after.people).toHaveLength(2)
  }, 60_000)
})
