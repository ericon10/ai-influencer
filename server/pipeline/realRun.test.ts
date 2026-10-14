import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { createScene, effectiveFields, getScene, sceneCandidates, updateScene, wordFields } from './scenes.js'
import { whatWasSent } from './sent.js'
import { scenesView } from '../api/views.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { flourishesIn, looksLikePrompt, readShot, stripFlourishes } from '../core/shotParse.js'
import { compareCost, matchCharge } from '../core/costCheck.js'

// The owner's first real run (2026-10-14): "a front-camera selfie in a
// black tank" came back as a friend's photo in the sheet outfit with glossy
// lips. The camera, outfit and framing stayed at their defaults, a
// full-body sheet ref came along on a waist-up shot, and nothing said not
// to copy the sheet clothes. Demo mode only: mock providers, no spend.

const FIX = join(process.cwd(), 'fixtures', 'callie')
const RAVE = "Taking a front-camera selfie in the middle of a packed rave, phone at arm's length slightly above her, glowing with sweat, damp strands of hair stuck to her forehead, relaxed confident half-smile at the lens."
let h: Harness
let characterId: string

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview }
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
}, 120_000)

describe('the owner\'s words are read, free, and never overruled by a default', () => {
  it('reads the camera, the outfit, the framing, the makeup, the place and the light', () => {
    expect(readShot(`${RAVE} In a black tank.`)).toMatchObject({ camera: 'selfie', phone: 'front', framing: 'chest_up', outfit: 'a black tank', place: 'a packed rave' })
    expect(readShot('Mirror selfie in the gym mirror wearing a gray sports bra and black leggings, full body')).toMatchObject({ camera: 'mirror_selfie', framing: 'full_body', outfit: 'a gray sports bra and black leggings' })
    expect(readShot('over the shoulder at a cafe, no makeup, waist up, window light')).toMatchObject({ camera: 'over_shoulder', framing: 'waist_up', makeup: 'bare', place: 'a cafe', ownLight: true })
    expect(readShot('Callie laughs at her laptop when her code finally runs')).toEqual({})
  })

  it('a selfie stays a selfie: front camera, chest up, face refs only, no sheet outfit, no gloss, 21+', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: `${RAVE.replace('selfie in the middle', 'selfie in a black tank in the middle')}` })
    const f = effectiveFields(h.deps, scene)
    expect(f).toMatchObject({ camera: 'selfie', momentType: 'selfie', phone: 'front', framing: 'chest_up', outfit: 'a black tank', location: 'a packed rave' })
    const view = (await scenesView(h.deps, h.ctx, characterId)).scenes.find(s => s.id === scene.id)!
    expect(view.refs.map(r => r.refId)).toEqual(['REF-00'])
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1 })
    const p = preview.prompts[0]!.text
    expect(p).toContain("Selfie at arm's length")
    expect(p).toContain('on the front camera')
    expect(p).not.toMatch(/taken by a friend/)
    expect(p).toContain('She is wearing a black tank, wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images.')
    expect(p).toContain('lips natural and matte, no gloss')
    expect(p).toContain('She is an adult, 21 or older.')
  })

  it('with no outfit named, the sheet clothes still stay out', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: 'Callie picks peaches at a market stall' })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1 })
    expect(preview.prompts[0]!.text).toContain('She is dressed for this moment instead of the white t-shirt, jeans and sneakers in the reference images.')
  })

  it('what the owner sets wins over what was read; editing the words later still counts', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: 'A front-camera selfie in a black tank at a rooftop bar' })
    await updateScene(h.deps, h.ctx, scene.id, { fields: { outfit: 'a red slip dress' } })
    let row = await getScene(h.deps, h.ctx, scene.id)
    expect(effectiveFields(h.deps, row)).toMatchObject({ camera: 'selfie', outfit: 'a red slip dress' })
    expect(wordFields(h.deps, row)).toMatchObject({ read: { camera: 'selfie', outfit: 'a black tank' }, ownerSet: ['outfit'] })
    await run({ type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1 })
    await updateScene(h.deps, h.ctx, scene.id, { brief: 'A friend takes a photo of her at a rooftop bar' })
    row = await getScene(h.deps, h.ctx, scene.id)
    expect(effectiveFields(h.deps, row)).toMatchObject({ camera: 'friend_phone', outfit: 'a red slip dress' })
    // The run kept what it used.
    expect(row.ranFields).toMatchObject({ camera: 'selfie' })
  })

  it('Punch it up keeps the camera the idea already names', async () => {
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'scene_ideas', characterId, idea: 'front-camera selfie at a rave' })
    expect(preview.prompts[0]!.text).toMatch(/a\s+selfie or front-camera shot stays one the character takes/)
  })
})

describe('a pasted prompt goes as written, plus only the fixed blocks', () => {
  const PASTED = 'Candid iPhone photo of her mid-laugh at a crowded dive bar, shot on the rear camera from across the booth, harsh on-camera flash, red neon behind her, a sticky table and two half-empty glasses in the foreground, slight motion blur on her hand, film grain, shallow depth of field. She wears an oversized vintage band tee and silver hoops.'

  it('is recognized as a prompt, and its text is sent unchanged with the reference line, 21+ and REALISM', async () => {
    expect(looksLikePrompt(PASTED)).toBe(true)
    expect(looksLikePrompt('Callie laughs at her laptop when her code finally runs')).toBe(false)
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: PASTED })
    expect(effectiveFields(h.deps, scene).asWritten).toBe(true)
    const { quote, preview } = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1, write: true })
    // No prompt writer: only the still is priced.
    expect(quote.items.map(i => i.model)).toEqual(['mock/image'])
    const p = preview.prompts[0]!.text
    expect(p.startsWith("Using the attached reference images only for this woman's face, hair and features")).toBe(true)
    expect(p).toContain('She is an adult, 21 or older.')
    expect(p).toContain(PASTED)
    expect(p).toMatch(/\nREALISM:/)
    for (const added of ['Candid phone photo taken by a friend', 'Natural available light', 'Makeup:', 'is wearing', 'plain and unbranded']) expect(p).not.toContain(added)
  })

  it('switched off, the same words go through the writer like any idea', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: PASTED })
    await updateScene(h.deps, h.ctx, scene.id, { fields: { asWritten: false } as never })
    const { quote } = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1, write: true })
    expect(quote.items.map(i => i.model)).toEqual(['mock/llm', 'mock/image'])
  })
})

describe('no mood words the owner did not use', () => {
  it('takes glowing, cinematic, soft light and beautiful out, and keeps the sentence', () => {
    expect(stripFlourishes('A candid photo, her face glowing with sweat, beautiful, soft light from the left, cinematic grain.', 'a rave')).toEqual({
      text: 'A candid photo, her face damp with sweat, light from the left, grain.', removed: ['glowing', 'soft light', 'beautiful', 'cinematic'],
    })
    expect(stripFlourishes('An ethereal, stunning shot of her.', '').text).toBe('A shot of her.')
    // A word the owner used stays.
    expect(flourishesIn('Her face glowing with sweat under red lights.', 'glowing with sweat')).toEqual([])
  })
})

describe('What was sent, Standard and High', () => {
  it('shows the final prompt, the refs by REF id, the model, the path and the settings; Standard is 1k, High is 2k', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: 'Callie at a farmers market, knees up, a friend takes it' })
    await run({ type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1 })
    const [still] = (await sceneCandidates(h.deps, h.ctx, [scene.id])).filter(c => c.op === 'generate')
    const sent = await whatWasSent(h.deps, h.ctx, still!.id)
    expect(sent.prompt).toBe(still!.prompt)
    expect(sent.wrapped.split('\n').every(l => l.length <= 80)).toBe(true)
    expect(sent.images.map(i => i.refId)).toEqual(['REF-00', 'REF-06'])
    expect(sent).toMatchObject({ model: 'Nano Banana 2.1', path: 'demo', quoted: 'Free (demo)' })
    expect(sent.settings).toEqual(expect.arrayContaining([{ label: 'Aspect', value: '9:16' }, { label: 'Resolution', value: '1k' }, { label: 'Quality', value: 'medium' }]))
    await run({ type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1, level: 'high' })
    const high = (await sceneCandidates(h.deps, h.ctx, [scene.id])).filter(c => c.op === 'generate' && c.id !== still!.id)[0]!
    expect((await whatWasSent(h.deps, h.ctx, high.id)).settings).toEqual(expect.arrayContaining([{ label: 'Resolution', value: '2k' }, { label: 'Quality', value: 'high' }]))
  })
})

describe('the real cost next to the quote', () => {
  const at = new Date('2026-10-14T16:13:23Z')
  const charges = [
    { name: 'Higgsfield Genjutsu - Motion Transfer', credits: 42, at: '2026-10-14T16:18:18Z' },
    { name: 'Nano Banana 2.1', credits: 1.5, at: '2026-10-14T16:13:24Z' },
    { name: 'Nano Banana 2.1', credits: 1.5, at: '2026-10-14T16:13:23Z' },
  ]

  it('matches each run to its own charge, nearest first, never twice', () => {
    const first = matchCharge(charges, { names: ['Nano Banana 2.1'], submittedAt: at, claimed: new Set() })!
    expect(first.charge.at).toBe('2026-10-14T16:13:23Z')
    const second = matchCharge(charges, { names: ['Nano Banana 2.1'], submittedAt: at, claimed: new Set([first.key]) })!
    expect(second.charge.at).toBe('2026-10-14T16:13:24Z')
    expect(matchCharge(charges, { names: ['Nano Banana 2'], submittedAt: new Date('2026-10-14T18:00:00Z'), claimed: new Set() })).toBeNull()
    expect(matchCharge(charges, { names: ['Genjutsu motion control', 'Higgsfield Genjutsu - Motion Transfer'], submittedAt: new Date('2026-10-14T16:18:10Z'), claimed: new Set() })!.charge.credits).toBe(42)
  })

  it('flags more than 20% off, either way', () => {
    expect(compareCost({ credits: 70, micros: 0 }, { credits: 70, source: 'transactions' }, at)).toMatchObject({ offPct: 0, flagged: false })
    expect(compareCost({ credits: 3, micros: 0 }, { credits: 6, source: 'transactions' }, at)).toMatchObject({ offPct: 100, flagged: true })
    expect(compareCost({ credits: 50, micros: 0 }, { credits: 42, source: 'transactions' }, at)).toMatchObject({ offPct: -16, flagged: false })
    expect(compareCost({ micros: 10_000 }, { micros: 13_000, source: 'tokens' }, at)).toMatchObject({ offPct: 30, flagged: true })
  })
})
