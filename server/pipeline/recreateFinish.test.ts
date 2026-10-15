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
import { addCloneSource, buildCloneFace, buildCloneStill, checkCloneCap, cloneOptions, recreateGate, saveRecreateStillModel, setRecreateGate, cloneStills, gateFor, postClones, setCloneChoices } from './clone.js'
import { addRecreateRow, recreateBatch, recreateFor, setRecreateRows, startRecreate, useCloneTake } from './recreate.js'
import { createScene } from './scenes.js'
import { candidates, jobs } from '../db/schema.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { revokeCredential, saveCredential, storeSecret } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { saveBilling } from '../providers/billing.js'
import { mapInput, createHiggsfieldAdapter } from '../providers/higgsfield.js'
import { classifyText } from '../qa/ocr.js'
import { answerGateCheck, gateCheck, suggestGate } from './gateCheck.js'
import { setSetting } from './settings.js'
import { makeClip } from '../media/testClips.js'
import { uploadKey } from '../storage/uploads.js'
import type { GenRequest } from '../providers/types.js'
import { adultProblem, cardForPhotoEdit, plainOutfit } from '../core/character.js'
import { whatWasSentForJob } from './sent.js'

// Recreate, finished (owner, 2026-10-14; UX-PLAN.md 16): the motion model
// picker on the plan or the API, the gates before any video spend, step 2's
// chips and the motion prompt, the post's credit cap, the ways in, the
// review of a take, the batch, and the Flare stills default. Mock adapter
// only; nothing paid runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let callie: string
let mara: string
let postId: string
let dir: string

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  const res = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 80)
  return { quote, preview, jobs: res.jobs }
}
const spec = async (id: string) => (await getContent(h.deps, h.ctx, id)).spec as MemeSpec
const requests = async (prefix: string) => (await h.deps.db.select().from(jobs).where(and(eq(jobs.accountId, h.ctx.accountId), like(jobs.purpose, `${prefix}%`)))).map(j => j.request as GenRequest)

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'recreate-finish-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  const file = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  callie = (await importCharacter(h.deps, h.ctx, file, { images })).characterId
  mara = (await importCharacter(h.deps, h.ctx, file.replace(/^# Character: Callie$/m, '# Character: Mara'), { images })).characterId
  postId = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, idea: 'The kitchen clip' })).id
  const src = join(dir, 'kitchen.mp4')
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: 6, audio: true })
  const uploadId = 'upl_' + 'k'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  await addCloneSource(h.deps, h.ctx, { contentId: postId, uploadId, name: 'kitchen.mp4' })
  await drain(h, 30)
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('the motion model picker', () => {
  it('offers Genjutsu, Wan 3.0, Wan 3.0 Prime and Kling 3.0 Motion Control, each priced with its path', async () => {
    const o = await cloneOptions(h.deps, h.ctx, postId)
    const motion = o.models.filter(m => m.mode === 'motion')
    expect(motion.map(m => m.label)).toEqual(['Genjutsu', 'Wan 3.0', 'Wan 3.0 Prime', 'Kling 3.0 Motion Control'])
    expect(motion.every(m => m.problem === null && m.display && (m.path === 'api' || m.path === 'account'))).toBe(true)
    expect(o.model === 'higgsfield/wan-3.0-motion' || o.mode === 'replace').toBe(true)
  })

  it('live with no plan and no key: every model is grey with one line why; a key brings them all back on the API', async () => {
    await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
    try {
      const off = (await cloneOptions(h.deps, h.ctx, postId)).models.filter(m => m.mode === 'motion')
      expect(off.every(m => m.problem === 'Needs your Higgsfield API key or plan: Settings > Connected accounts.')).toBe(true)
      await saveCredential(h.deps, h.ctx, 'higgsfield', 'kid_test:secret_test')
      const on = (await cloneOptions(h.deps, h.ctx, postId)).models.filter(m => m.mode === 'motion')
      // Every model the API offers works on the API alone (the plan may lapse).
      expect(on.map(m => [m.label, m.path, m.pathLabel])).toEqual([
        ['Genjutsu', 'api', 'Higgsfield API'], ['Wan 3.0', 'api', 'Higgsfield API'], ['Wan 3.0 Prime', 'api', 'Higgsfield API'], ['Kling 3.0 Motion Control', 'api', 'Higgsfield API'],
      ])
      expect(on.every(m => !m.problem || !/Needs your/.test(m.problem))).toBe(true)
    } finally {
      await setSetting(h.deps, h.ctx, 'provider_mode', 'demo')
    }
  })

  it('the API request for Wan: the still as the image, the cleaned clip as the video, 720p, 9:16, audio off', () => {
    const entry = h.deps.config.models.models.find(m => m.ref === 'higgsfield/wan-3.0-motion')!
    const body = mapInput(entry, { kind: 'video_clone', model: entry.ref, prompt: 'p', refs: [{ assetId: 'a', url: 'https://x/still.png' }], sourceVideo: { assetId: 'b', url: 'https://x/clip.mp4' }, durationSec: 6, resolution: '720p', aspect: '9:16', audio: false })
    expect(body).toEqual({ prompt: 'p', image_urls: ['https://x/still.png'], video_urls: ['https://x/clip.mp4'], duration: 6, resolution: '720p', aspect_ratio: '9:16', generate_audio: false, enable_thinking: false })
    expect(entry.endpoint).toBe('alibaba/wan-3.0/reference-to-video')
  })

  it('on the API, Higgsfield\'s own price for the exact request is read from its free estimate endpoint', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url} ${init?.body}`)
      return new Response(JSON.stringify({ credits: '10.500', usd: '0.656' }), { status: 200 })
    }) as unknown as typeof fetch
    const a = createHiggsfieldAdapter({ credentials: 'kid:secret', config: h.deps.config, fetchImpl })
    const price = await a.exactPrice!({ kind: 'video_clone', model: 'higgsfield/wan-3.0-motion', prompt: 'p', refs: [{ assetId: 'a', url: 'https://x/s.png' }], sourceVideo: { assetId: 'b', url: 'https://x/c.mp4' }, durationSec: 6, resolution: '720p', aspect: '9:16', audio: false })
    expect(price).toEqual({ credits: 10.5, micros: 656000 })
    expect(calls[0]).toMatch(/^POST https:\/\/api\.higgsfield\.ai\/estimate\/alibaba\/wan-3\.0\/reference-to-video /)
  })
})

describe('step 2, the stills and the gates', () => {
  it('Read them for me fills both chip lists, the outfit and the motion line; the stills prompt keeps them', async () => {
    await run({ type: 'clone_traits', contentId: postId, characterId: callie })
    const c = (await spec(postId)).clone!
    expect(c.keep).toEqual(['a marble kitchen counter with flowers', 'warm ceiling light', 'handheld phone at chest height', 'one hand on the counter'])
    expect(c.notLike).toBe('dark brown hair, brown eyes, a nose ring, winged liner')
    expect(c.outfit.text).toBe('dark green sleeveless dress')
    expect(c.motion).toMatch(/skeptical squint/)
    await setCloneChoices(h.deps, h.ctx, postId, { keep: [...c.keep.slice(0, 3)] })
    const { preview } = await run({ type: 'clone_still', contentId: postId, characterId: callie })
    const text = preview.prompts[0]!.text
    expect(text).toContain('Keep from it: a marble kitchen counter with flowers, warm ceiling light, handheld phone at chest height.')
    expect(text).toContain("She must not have that person's dark brown hair, brown eyes, a nose ring, winged liner.")
    // Owner, 2026-10-15 (the provider's filter blocked every still that
    // stacked these next to a real person's photo): face and hair only, no
    // age line, a plain outfit from Claude's words, the short REALISM line.
    expect(text).toContain('Long honey-blonde hair, loose beachy waves, deep side part. Warm hazel-brown eyes, soft oval face, full light-brown brows, full lips.')
    expect(text).not.toMatch(/years old|21 or older|\badult\b/i)
    expect(text).not.toMatch(/\b(?:toned|curvy|waist|hips|legs|athletic|build)\b/i)
    expect(text).toContain('Dark green dress, same as in the photo.')
    expect(text).not.toMatch(/sleeveless|fitted/i)
    expect(text.trim().endsWith('REALISM: Natural skin texture, not retouched.')).toBe(true)
    expect(text).not.toContain('AVOID:')
    // The owner's own words go as typed, sleeves and all.
    await setCloneChoices(h.deps, h.ctx, postId, { outfit: { text: 'dark green sleeveless slip dress' }, keep: [...c.keep.slice(0, 2), 'thin straps'] })
    const typed = (await run({ type: 'clone_still', contentId: postId, characterId: callie })).preview.prompts[0]!.text
    expect(typed).toContain('Dark green sleeveless slip dress, same as in the photo.')
    expect(typed).toContain('Keep from it: a marble kitchen counter with flowers, warm ceiling light, thin straps.')
    // The face pass follows the same rules.
    const still = (await cloneStills(h.deps, h.ctx, postId)).find(x => x.assetId && x.pass === 'still')
    if (still) {
      const face = (await buildCloneFace(h.deps, h.ctx, { contentId: postId, characterId: callie, candidateId: still.id })).preview.prompts[0]!.text
      expect(face).not.toMatch(/years old|21 or older|toned|curvy/i)
      expect(face.trim().endsWith('REALISM: Natural skin texture, not retouched.')).toBe(true)
    }
    await setCloneChoices(h.deps, h.ctx, postId, { outfit: { text: '' }, keep: c.keep.slice(0, 3) })
  }, 120_000)

  it('What was sent shows on a failed run too: the prompt, the frame, the element, the model and why it failed', async () => {
    const [job] = await h.deps.db.select().from(jobs).where(like(jobs.purpose, `clone_still:${postId}:%`)).limit(1)
    await h.deps.db.update(jobs).set({ status: 'failed', error: { message: 'The provider content filter blocked this result.' } }).where(eq(jobs.id, job!.id))
    try {
      const sent = await whatWasSentForJob(h.deps, h.ctx, job!.id)
      expect(sent).toMatchObject({ jobId: job!.id, candidateId: null, status: 'failed', error: 'The provider content filter blocked this result.' })
      expect(sent.prompt).toContain('Replace the main person')
      expect(sent.images.length).toBeGreaterThan(0)
      expect(sent.model).toBeTruthy()
      expect(sent.costNote).toBeNull()
    } finally {
      await h.deps.db.update(jobs).set({ status: job!.status, error: job!.error }).where(eq(jobs.id, job!.id))
    }
  })

  it('21 or older is a check before the run, not words in the prompt', () => {
    expect(adultProblem(24)).toBeNull()
    expect(adultProblem(20)).toBe('Characters are 21 or older.')
    expect(adultProblem(null)).toMatch(/Set an age/)
    expect(cardForPhotoEdit('Callie, 24 years old. Long red hair. Fit, athletic build, toned legs, defined waist, naturally curvy hips. Green eyes, freckles.')).toBe('Long red hair. Green eyes, freckles.')
    expect(cardForPhotoEdit('Distinguishing mark: small mole above her left brow. Style: a regular girl whose style evolves; natural glow.')).toBe('Distinguishing mark: small mole above her left brow.')
    expect(plainOutfit('dark green sleeveless fitted top')).toBe('dark green top')
    expect(plainOutfit('black off-the-shoulder mini dress')).toBe('black dress')
  })

  it('the stills stay on Nano Banana 2.1 on the plan whenever it is connected, even with the API as the billing default', async () => {
    await saveBilling(h.deps, h.ctx, { default: 'api', creditUsd: 0 })
    const off = await buildCloneStill(h.deps, h.ctx, { contentId: postId, characterId: callie })
    expect((off.specs[0]!.request as GenRequest).modelRef).toBe('higgsfield/gpt-image-2.5')
    // Without the plan the stills say they are untested for a recreate.
    expect(off.preview.warnings.find(w => w.ruleId === 'clone-still-untested')).toMatchObject({ title: 'GPT Image 2.5, untested for recreates' })
    expect((await cloneOptions(h.deps, h.ctx, postId)).stillModel).toEqual({ ref: 'higgsfield/gpt-image-2.5', label: 'GPT Image 2.5', onPlan: false, note: 'untested for recreates' })
    await storeSecret(h.deps, h.ctx, ACCOUNT_PROVIDER, JSON.stringify({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() + 3600_000, clientId: 'client-1' }), 'Higgsfield account', '')
    try {
      const on = await buildCloneStill(h.deps, h.ctx, { contentId: postId, characterId: callie })
      expect((on.specs[0]!.request as GenRequest).modelRef).toBe('higgsfield/nano-banana-2.1')
      expect(on.preview.warnings.some(w => w.ruleId === 'clone-still-untested')).toBe(false)
      expect((await cloneOptions(h.deps, h.ctx, postId)).stillModel).toMatchObject({ label: 'Nano Banana 2.1', onPlan: true, note: null })
    } finally {
      await revokeCredential(h.deps, h.ctx, ACCOUNT_PROVIDER)
    }
  })

  it('the gates: face 0.45 or more, a clear margin over the likeness (0.12), likeness under 0.45; calibrated on the proven stills', () => {
    const g = h.deps.config.pipeline.content.clone.recreate.gate
    expect(g).toEqual({ face_min: 0.45, margin: 0.12, source_max: 0.45 })
    const gate = (faceScore: number | null, sourceScore: number | null, status = 'approved') => gateFor(g, { status, faceScore, sourceScore, demo: false })
    // The owner's two proven stills against REF-00 and their source frames
    // (scored with the Studio's matcher, round 17): both pass.
    expect(gate(0.711, 0.263)).toMatchObject({ ok: true, margin: 0.448 })
    expect(gate(0.537, 0.37)).toMatchObject({ ok: true, margin: 0.167 })
    // The rave still before its face pass looks more like the clip's person.
    expect(gate(0.454, 0.568)).toMatchObject({ ok: false, reasons: ["Beats the clip's person by -0.11 (face 0.45, likeness 0.57), needs 0.12 or more.", "Likeness to the clip's person 0.57, must stay under 0.45."] })
    // Close numbers no longer pass: 0.50 against 0.40 is only 0.10 apart.
    expect(gate(0.5, 0.4)).toMatchObject({ ok: false, reasons: ["Beats the clip's person by 0.10 (face 0.50, likeness 0.40), needs 0.12 or more."] })
    expect(gate(0.41, 0.1)).toMatchObject({ ok: false, reasons: ['Face match 0.41, needs 0.45 or more.'] })
    expect(gate(null, null).ok).toBe(false)
    expect(gate(0.6, 0.2, 'qa_failed').ok).toBe(false)
    expect(gate(0.6, null)).toMatchObject({ ok: true, margin: null, note: "No face showed in the clip's frame to compare with, so the margin was not checked." })
  })

  it('no video spend past a failing gate: the estimate is refused with the reason and the way on', async () => {
    const still = (await cloneStills(h.deps, h.ctx, postId)).find(x => x.pass === 'still' && !x.error)!
    // A still as if it ran live, with its scores from the free checks.
    const [cand] = await h.deps.db.select().from(candidates).where(eq(candidates.id, still.id))
    await h.deps.db.update(jobs).set({ provider: 'higgsfield' }).where(eq(jobs.id, cand!.jobId!))
    await h.deps.db.update(candidates).set({ meta: { pass: 'still', faceScore: 0.4, sourceScore: 0.2 } }).where(eq(candidates.id, still.id))
    const action: StudioAction = { type: 'clone', contentId: postId, characterIds: [callie], mode: 'motion', model: 'higgsfield/genjutsu-motion-control', looks: {}, keepSound: false, stills: { [callie]: still.id } }
    await expect(estimateAction(h.deps, h.ctx, action)).rejects.toThrow(/Face match 0\.40, needs 0\.45 or more\. Fix the face again or make new stills\./)
    expect((await cloneStills(h.deps, h.ctx, postId)).find(x => x.id === still.id)!.gate.ok).toBe(false)
    await h.deps.db.update(candidates).set({ meta: { pass: 'still', faceScore: 0.52, sourceScore: 0.18 } }).where(eq(candidates.id, still.id))
    const { preview } = await estimateAction(h.deps, h.ctx, action)
    // The owner's motion prompt template and the outfit line, for every model.
    const text = preview.prompts[0]!.text
    expect(text).toMatch(/^Motion transfer\. @Image1 defines everything you see: this exact woman, her face, long honey-blonde hair, a marble kitchen counter with flowers, warm ceiling light, handheld phone at chest height, exactly as in @Image1 for the whole clip\./)
    expect(text).toContain('@Video1 is used ONLY for motion')
    expect(text).toContain('The motion: she looks into the lens with a skeptical squint')
    expect(text).toContain('Her outfit stays exactly as in @Image1 for the whole clip, same cut, length and fit.')
    expect(text).toMatch(/REALISM/)
  }, 60_000)

  it('Make the video picks the still and sends the cleaned clip, 720p, 9:16, audio off; the take is reviewed for free', async () => {
    const still = (await cloneStills(h.deps, h.ctx, postId)).find(x => x.pass === 'still' && !x.error)!
    await run({ type: 'clone', contentId: postId, characterIds: [callie], mode: 'motion', model: 'higgsfield/genjutsu-motion-control', looks: {}, keepSound: false, stills: { [callie]: still.id } })
    const c = (await spec(postId)).clone!
    expect(c.stills[callie]).toBe(still.id)
    const [req] = await requests(`clone:${postId}:`)
    expect(req).toMatchObject({ sourceVideo: { assetId: c.assetId }, resolution: '720p', aspect: '9:16', audio: false, modelRef: 'higgsfield/genjutsu-motion-control' })
    const [take] = await postClones(h.deps, h.ctx, postId)
    expect(take!.sourceAssetId).toBe(c.assetId)
    expect(take!.review).toMatchObject({ step: 0.5, faceMin: 0.363 })
    expect(take!.review!.samples.length).toBeGreaterThanOrEqual(10)
    expect(Array.isArray(take!.review!.cuts) && Array.isArray(take!.review!.text)).toBe(true)
    expect(take!.review!.notes.join(' ')).toMatch(/Demo mode/)
    // Until the videos load, the pair shows the clip's first frame and the
    // still the take started from.
    expect(take!.posters).toEqual({ source: c.firstFrameId, take: (await cloneStills(h.deps, h.ctx, postId)).find(x => x.id === still.id)!.assetId })
  }, 180_000)

  it('Use this take puts it in the post, no music, and opens the Text step', async () => {
    const [take] = await postClones(h.deps, h.ctx, postId)
    await useCloneTake(h.deps, h.ctx, postId, take!.id, true)
    const post = await getContent(h.deps, h.ctx, postId)
    expect(post.step).toBe('text')
    expect((post.spec as MemeSpec).clipId).toBe(take!.id)
    expect((post.spec as MemeSpec).sound.music).toBeNull()
  })

  it('the stills model is a choice even on the plan: GPT Image 2.5 on the API, with the same face pass and gates', async () => {
    await storeSecret(h.deps, h.ctx, ACCOUNT_PROVIDER, JSON.stringify({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() + 3600_000, clientId: 'client-1' }), 'Higgsfield account', '')
    try {
      const o = await cloneOptions(h.deps, h.ctx, postId)
      expect(o.stillModels.map(c => [c.label, c.path, c.problem])).toEqual([['Nano Banana 2.1', 'account', null], ['GPT Image 2.5', 'api', null]])
      expect(o.stillModel.ref).toBe('higgsfield/nano-banana-2.1')
      const api = await buildCloneStill(h.deps, h.ctx, { contentId: postId, characterId: callie, stillModel: 'higgsfield/gpt-image-2.5' })
      // The stills and the face pass that follows both run on GPT Image 2.5.
      expect(api.specs.map(sp => (sp.request as GenRequest).modelRef)).toEqual(Array(6).fill('higgsfield/gpt-image-2.5'))
      expect(api.preview.warnings.some(w => w.ruleId === 'clone-still-untested')).toBe(true)
      // The pick is remembered.
      await saveRecreateStillModel(h.deps, h.ctx, 'higgsfield/gpt-image-2.5')
      expect((await cloneOptions(h.deps, h.ctx, postId)).stillModel).toMatchObject({ ref: 'higgsfield/gpt-image-2.5', onPlan: false, note: 'untested for recreates' })
      await expect(saveRecreateStillModel(h.deps, h.ctx, 'higgsfield/seedance-2.5')).rejects.toThrow(/not one of the Recreate stills models/)
      await saveRecreateStillModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1')
    } finally {
      await revokeCredential(h.deps, h.ctx, ACCOUNT_PROVIDER)
    }
  })
})

describe('the gate check every 10 real recreates', () => {
  it('suggests numbers just under the lowest picked face and margin, never below the standard face match', () => {
    const g = { face_min: 0.45, margin: 0.12, source_max: 0.45 }
    const at = new Date(0).toISOString()
    const s = (face: number, likeness: number) => ({ postId: 'p', candidateId: `${face}-${likeness}`, assetId: null, pass: 'still' as const, face, likeness, margin: Math.round((face - likeness) * 1000) / 1000, model: null, at })
    expect(suggestGate(g, [s(0.711, 0.263), s(0.537, 0.37)]).numbers).toEqual({ face_min: 0.5, margin: 0.13, source_max: 0.4 })
    expect(suggestGate(g, [s(0.38, 0.1)]).numbers!.face_min).toBe(0.363)
    expect(suggestGate(g, []).numbers).toBeNull()
  })

  it('after 10 real recreates: picked vs passed over, suggested numbers, and nothing changes until approved', async () => {
    const [take] = await postClones(h.deps, h.ctx, postId)
    const [motion] = await h.deps.db.select().from(jobs).where(and(eq(jobs.accountId, h.ctx.accountId), like(jobs.purpose, `clone:${postId}:%`)))
    const stills = await cloneStills(h.deps, h.ctx, postId)
    const pick = stills.find(x => x.assetId === (motion!.request as GenRequest).refs![0]!.assetId)!
    expect(take).toBeTruthy()
    // As if live: the scores the free checks keep, on a real model.
    for (const x of stills) await h.deps.db.update(candidates).set({ meta: { pass: x.pass, faceScore: x.id === pick.id ? 0.61 : 0.42, sourceScore: x.id === pick.id ? 0.3 : 0.35 } }).where(eq(candidates.id, x.id))
    await h.deps.db.update(jobs).set({ provider: 'higgsfield' }).where(eq(jobs.id, motion!.id))
    let v = await gateCheck(h.deps, h.ctx)
    expect(v).toMatchObject({ count: 1, due: false, nextAt: 10 })
    expect(v.picked.map(p => [p.face, p.margin])).toEqual([[0.61, 0.31]])
    expect(v.passedOver.length).toBeGreaterThan(0)
    expect(v.passedOver.every(p => p.face === 0.42)).toBe(true)
    // Nine more real recreates.
    for (let i = 1; i <= 9; i++) await h.deps.db.insert(jobs).values({ ...motion!, id: `job_gatecheck${String(i).padStart(14, '0')}`, idempotencyKey: `${motion!.idempotencyKey}:gc${i}`, provider: 'higgsfield' })
    v = await gateCheck(h.deps, h.ctx)
    expect(v).toMatchObject({ count: 10, due: true, current: { face_min: 0.45, margin: 0.12, source_max: 0.45 }, suggested: { face_min: 0.58, margin: 0.28, source_max: 0.33 } })
    expect(v.effect).toEqual({ current: { pickedPass: 1, passedOverHeld: v.passedOver.length }, suggested: { pickedPass: 1, passedOverHeld: v.passedOver.length } })
    // Suggest only: the gate is unchanged until the owner approves.
    expect(await recreateGate(h.deps, h.ctx)).toEqual({ face_min: 0.45, margin: 0.12, source_max: 0.45 })
    v = await answerGateCheck(h.deps, h.ctx, true)
    expect(await recreateGate(h.deps, h.ctx)).toEqual({ face_min: 0.58, margin: 0.28, source_max: 0.33 })
    expect(v).toMatchObject({ due: false, nextAt: 20, suggested: null })
    // Back to the calibrated numbers for the rest of the file.
    await setRecreateGate(h.deps, h.ctx, { face_min: 0.45, margin: 0.12, source_max: 0.45 })
    await h.deps.db.delete(jobs).where(like(jobs.id, 'job_gatecheck%'))
    await h.deps.db.update(jobs).set({ provider: 'mock' }).where(eq(jobs.id, motion!.id))
  })
})

describe('the credit cap, the ways in and scale', () => {
  it('a step that would pass the post\'s cap is refused with what it costs and what is left', async () => {
    // What this post's priced steps started so far counts against the cap.
    const spent = (await spec(postId)).clone!.spentCredits
    expect(spent).toBeGreaterThan(0)
    await setCloneChoices(h.deps, h.ctx, postId, { capCredits: spent + 50 })
    await expect(checkCloneCap(h.deps, h.ctx, { type: 'clone', contentId: postId }, [{ credits: 42, amountMicros: 0 }])).resolves.toBeUndefined()
    await expect(checkCloneCap(h.deps, h.ctx, { type: 'clone', contentId: postId }, [{ credits: 51, amountMicros: 0 }])).rejects.toThrow(/This step costs 51 credits and 50 of this post's [0-9.]+-credit cap are left/)
    // API dollars count at the API's credit rate ($0.0625): $3.25 = 52 credits.
    await expect(checkCloneCap(h.deps, h.ctx, { type: 'clone', contentId: postId }, [{ credits: null, amountMicros: 3_250_000 }])).rejects.toThrow(/costs 52 credits/)
    // A step the cap refuses never starts: the estimate itself says so.
    await setCloneChoices(h.deps, h.ctx, postId, { capCredits: spent + 0.01 })
    await expect(estimateAction(h.deps, h.ctx, { type: 'clone_still', contentId: postId, characterId: callie })).rejects.toThrow(/cap are left/)
    await setCloneChoices(h.deps, h.ctx, postId, { capCredits: null })
  })

  it('a link with a character name starts a post at Recreate; a saved clip works the same; another character gets the same clip and chips', async () => {
    const c = (await spec(postId)).clone!
    await expect(startRecreate(h.deps, h.ctx, { character: 'Nobody', assetId: c.originalAssetId! })).rejects.toThrow(/No character named "Nobody"/)
    await expect(startRecreate(h.deps, h.ctx, { character: 'Callie', link: 'https://www.tiktok.com/@someone/video/1' })).rejects.toThrow(/not read \(no scraping\)/)
    const { id } = await startRecreate(h.deps, h.ctx, { character: 'callie', assetId: c.originalAssetId!, model: 'Genjutsu', cap: 50 })
    await drain(h, 30)
    const post = await getContent(h.deps, h.ctx, id)
    expect(post.step).toBe('video')
    expect((post.spec as MemeSpec).start).toBe('clip')
    expect((post.spec as MemeSpec).clone).toMatchObject({ status: 'ready', capCredits: 50, from: 'library' })
    expect((await cloneOptions(h.deps, h.ctx, id)).defaults.motion).toBe('higgsfield/genjutsu-motion-control')
    const other = await recreateFor(h.deps, h.ctx, { contentId: postId, characterId: mara })
    const o = (await spec(other.id)).clone!
    expect((await getContent(h.deps, h.ctx, other.id)).characterId).toBe(mara)
    expect(o).toMatchObject({ status: 'ready', assetId: c.assetId, keep: c.keep, notLike: c.notLike, stills: {} })
  }, 120_000)

  it('a batch: rows of clips and characters, a model per row and Set all, prices per row and one run for the step', async () => {
    const c = (await spec(postId)).clone!
    const batch = await createContent(h.deps, h.ctx, { kind: 'batch', characterId: callie, idea: 'Recreate batch' })
    await addRecreateRow(h.deps, h.ctx, batch.id, { character: 'Callie', assetId: c.originalAssetId! })
    await addRecreateRow(h.deps, h.ctx, batch.id, { character: 'Mara', assetId: c.originalAssetId! })
    await drain(h, 40)
    let view = await recreateBatch(h.deps, h.ctx, batch.id)
    expect(view.rows.map(r => [r.characterName, r.next])).toEqual([['Callie', 'stills'], ['Mara', 'stills']])
    expect(Object.values(view.prices).every(p => p?.step === 'stills')).toBe(true)
    await setRecreateRows(h.deps, h.ctx, batch.id, { all: 'higgsfield/wan-3.0-prime-motion' })
    await setRecreateRows(h.deps, h.ctx, batch.id, { row: { postId: view.rows[1]!.postId, model: 'higgsfield/kling-3.0-motion-control' } })
    view = await recreateBatch(h.deps, h.ctx, batch.id)
    expect(view.rows.map(r => r.modelLabel)).toEqual(['Wan 3.0 Prime', 'Kling 3.0 Motion Control'])
    const { quote, preview } = await run({ type: 'recreate_batch', contentId: batch.id, step: 'stills' })
    // 4 stills and the face pass (2 takes) per row.
    expect(quote.items).toHaveLength(12)
    expect(preview.title).toBe('Stills for 2 of 2 rows')
    view = await recreateBatch(h.deps, h.ctx, batch.id)
    expect(view.rows.map(r => r.next)).toEqual(['video', 'video'])
    expect(view.rows.every(r => r.faces === 2)).toBe(true)
    await expect(setRecreateRows(h.deps, h.ctx, batch.id, { all: 'higgsfield/genjutsu-replace' })).rejects.toThrow(/not one of the motion models/)
    // A row that cannot be priced (no face yet) waits and says why; the
    // other rows still run.
    const faceless = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8').replace(/^# Character: Callie$/m, '# Character: Noor'), { images: {} })).characterId
    await addRecreateRow(h.deps, h.ctx, batch.id, { character: faceless, assetId: c.originalAssetId! })
    await drain(h, 40)
    view = await recreateBatch(h.deps, h.ctx, batch.id)
    expect(view.rows[2]).toMatchObject({ characterName: 'Noor', next: 'waiting' })
    expect(view.rows[2]!.why).toMatch(/no face yet/)
    expect(view.prices[view.rows[2]!.postId]).toBeNull()
  }, 240_000)
})

describe('Flare is the stills default, with bare natural lips', () => {
  it('a new run starts at Flare, Standard is medium at 2k, and every Flare prompt says "Bare natural lips, no gloss."', async () => {
    const sceneId = (await createScene(h.deps, h.ctx, callie, { brief: 'Callie laughing at her phone on a bus' })).id
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId: callie, sceneId, models: ['higgsfield/gpt-image-2.5-flare'], variations: 1 })
    const text = preview.prompts[0]!.text
    expect(text).toContain('Bare natural lips, no gloss.')
    expect(text.indexOf('Bare natural lips, no gloss.')).toBeLessThan(text.indexOf('REALISM'))
    const res = await runAction(h.deps, h.ctx, { type: 'scene', characterId: callie, sceneId, models: ['higgsfield/gpt-image-2.5-flare'], variations: 1 }, (await estimateAction(h.deps, h.ctx, { type: 'scene', characterId: callie, sceneId, models: ['higgsfield/gpt-image-2.5-flare'], variations: 1 })).quote.id, true)
    const [job] = await h.deps.db.select().from(jobs).where(eq(jobs.id, res.jobs[0]!.id))
    expect(job!.request).toMatchObject({ quality: 'medium', resolution: '2k' })
    expect(h.deps.config.pipeline.scenes.settings.default_still_model).toBe('higgsfield/gpt-image-2.5-flare')
  }, 60_000)
})

describe('the text check', () => {
  it('sorts what it reads into @handles, logos and captions, and drops noise', () => {
    expect(classifyText({ text: '@kitchen.girl22', confidence: 91 })).toEqual({ kind: 'handle', text: '@kitchen.girl22' })
    expect(classifyText({ text: 'TikTok', confidence: 93 })).toEqual({ kind: 'logo', text: 'TikTok' })
    expect(classifyText({ text: 'when he says he is fine', confidence: 85 })).toEqual({ kind: 'caption', text: 'when he says he is fine' })
    expect(classifyText({ text: 'x.', confidence: 90 })).toBeNull()
    expect(classifyText({ text: 'blurry words', confidence: 30 })).toBeNull()
  })
})
