import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { createCharacter, getCharacter, toData } from './characters.js'
import { importCharacter } from './files.js'
import { mirrorCandidate, rejectCandidate } from './review.js'
import { setSetting } from './settings.js'
import { setRuleSwitch } from './rules.js'
import { approveSceneCandidate, copyScene, createScene, cropCandidate, getScene, sceneCandidates, updateScene } from './scenes.js'
import { scenesView } from '../api/views.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { candidates } from '../db/schema.js'
import { getJob } from '../jobs/runner.js'
import { parseComboLog } from '../core/scenes.js'
import type { LlmRequest } from '../providers/types.js'
import type { Observation } from '../core/qa/perception.js'

// Phase 2 in demo mode (mock providers, no spend): plan a scene from plain
// words, generate stills on two models with QA, the drift lock after a
// trained character, the human pick writing the combo log, and the
// one-change edit loop (edit, crop, upscale, free mirror).

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string
let cuffOnWrongEar = false

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs }
}

const stills = async (sceneId: string) => sceneCandidates(h.deps, h.ctx, [sceneId])

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness({
    mockLlmResponders: {
      qa_perception: (req: LlmRequest) => {
        const meta = req.meta as { pass: string; mockObservation: Observation; sceneId?: string }
        if (!cuffOnWrongEar || !meta.sceneId) return meta.mockObservation
        // The cuff on her RIGHT ear (image left when she faces the camera).
        const o: Observation = { ...meta.mockObservation, pose: 'frontal', nose: 'toward_camera', ears: [{ image_side: 'image_left', jewelry: true, jewelry_description: 'gold double-band ear cuff' }, { image_side: 'image_right', jewelry: false, jewelry_description: '' }] }
        return meta.pass === 'orig' ? o : { ...o, ears: o.ears.map(e => ({ ...e, image_side: e.image_side === 'image_left' ? 'image_right' : 'image_left' })) }
      },
    },
  })
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) {
    const id = `REF-${String(i).padStart(2, '0')}`
    images[id] = { data: await renderPlaceholderPortrait(`Callie ${id}`) }
  }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
}, 120_000)

describe('scenes (Stage 7, demo mode)', () => {
  let sceneId: string

  it('plans a scene from the owner\'s words: Claude fills the fields, code builds the prompt', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: 'Picking out peaches at the farmers market' })
    sceneId = scene.id
    const { quote, preview } = await run({ type: 'scene_plan', characterId, sceneId })
    expect(quote.items.map(i => i.model)).toEqual(['mock/llm'])
    expect(preview.prompts[0]!.text).toContain('Picking out peaches at the farmers market')
    // Repeats are fine (owner, 2026-10-13): the combo log is a history, and
    // the planner only sees it when the variety note is switched on.
    expect(preview.prompts[0]!.text).not.toContain('Caught mid-action / Friend shot / Golden hour / Rooftop')
    const view = (await scenesView(h.deps, h.ctx, characterId)).scenes.find(s => s.id === sceneId)!
    expect(view.complete).toBe(true)
    expect(view.fields.footwear).toBeTruthy()
    expect(view.comboProblem).toBeNull()
    expect(view.title).toBe('Picking out peaches at')
  })

  it('"Punch it up" turns a rough idea into three specific moments, priced first', async () => {
    const { quote, preview, jobs } = await run({ type: 'scene_ideas', characterId, idea: 'coffee run downtown' })
    expect(quote.items.map(i => i.model)).toEqual(['mock/llm'])
    const text = preview.prompts[0]!.text
    expect(text).toContain('coffee run downtown')
    expect(text).toMatch(/one action caught mid-motion/)
    expect(text).toMatch(/hair color and cut, different from Callie's/)
    expect(text).toMatch(/pushed up on her\s+head, in her hand, or lowered down her nose/)
    const job = await getJob(h.deps, h.ctx, jobs[0]!.id)
    expect(job.status).toBe('completed')
    const options = ((job.resultMeta as { data?: { options?: Array<{ moment: string }> } }).data?.options) ?? []
    expect(options).toHaveLength(3)
    for (const o of options) expect(o.moment).toMatch(/^Callie coffee run downtown/)
  })

  it('a scene can be reused for other characters: name swapped, their own refs and jewelry', async () => {
    const ava = await createCharacter(h.deps, h.ctx, { name: 'Ava', data: { age: 26, card: '26, short dark curly hair' } })
    const bea = await createCharacter(h.deps, h.ctx, { name: 'Bea', data: { age: 29, card: '29, long red hair', marks: [{ name: 'cuff', description: 'thin silver ear cuff', side: 'RIGHT', region: 'ear', kind: 'jewelry', subtle: true }] } })
    const src = await createScene(h.deps, h.ctx, bea.id, {
      brief: 'Bea on a coffee run downtown', title: 'Bea coffee run',
      fields: { moment: 'Bea laughs mid-step with a coffee', jewelry: 'a thin gold chain, thin silver ear cuff (RIGHT ear)', refs: ['REF-00', 'REF-03'], brands: true, camera: 'friend_phone' },
    })
    const [copy] = await copyScene(h.deps, h.ctx, src.id, [ava.id, bea.id])
    expect(copy).toMatchObject({ characterId: ava.id, name: 'Ava' })
    const row = await getScene(h.deps, h.ctx, copy!.sceneId)
    expect(row.characterId).toBe(ava.id)
    expect(row.brief).toBe('Ava on a coffee run downtown')
    expect(row.title).toBe('Ava coffee run')
    expect(row.fields).toMatchObject({ moment: 'Ava laughs mid-step with a coffee', jewelry: 'a thin gold chain', brands: true, camera: 'friend_phone' })
    expect((row.fields as { refs?: string[] }).refs).toBeUndefined()
  })

  it('only the moment is required: the owner\'s words count as the moment, and the rest starts pre-filled', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, { brief: 'Callie reading on a sunny park bench' })
    const view = (await scenesView(h.deps, h.ctx, characterId)).scenes.find(s => s.id === scene.id)!
    expect(view.missing).toEqual([])
    expect(view.complete).toBe(true)
    expect(view.planned).toBe(false)
    expect(view.fields).toMatchObject({ moment: 'Callie reading on a sunny park bench', camera: 'friend_phone', light: 'natural' })
    // A repeat of a logged pair is fine: no note, nothing to press.
    expect(view.comboProblem).toBeNull()
    const { quote, preview } = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: false })
    expect(quote.items.length).toBeGreaterThan(0)
    expect(preview.warnings.map(w => w.title).join(' ')).not.toMatch(/combo/i)
    // Without words, the moment is the one thing left.
    const empty = await createScene(h.deps, h.ctx, characterId, { title: 'Blank' })
    expect((await scenesView(h.deps, h.ctx, characterId)).scenes.find(s => s.id === empty.id)!.missing).toEqual(['moment'])
  })

  it('a repeated moment and camera pair runs as is; the variety note only shows when switched on (rule 21)', async () => {
    const repeat = await createScene(h.deps, h.ctx, characterId, {
      fields: { momentType: 'caught_mid_action', camera: 'friend_phone', moment: 'Callie laughs on a rooftop', outfit: 'a linen sundress', footwear: 'white sandals', light: 'golden_hour' },
    })
    const action = { type: 'scene' as const, characterId, sceneId: repeat.id, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: true }
    const plain = await estimateAction(h.deps, h.ctx, action)
    expect(plain.quote.status).toBe('open')
    expect(plain.preview.warnings.some(x => (x as { ruleId?: string }).ruleId === 'scene-combo-log')).toBe(false)
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-combo-log', on: true })
    try {
      const noted = await estimateAction(h.deps, h.ctx, action)
      expect(noted.quote.status).toBe('open')
      expect(noted.preview.warnings.find(x => (x as { ruleId?: string }).ruleId === 'scene-combo-log')!.message).toMatch(/was used on 2026-10-12/)
    } finally {
      await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-combo-log', on: null })
    }
  })

  it('runs Nano Banana 2.1 and GPT Image 2.5 Flare side by side, refs chosen by angle, QA on each', async () => {
    await updateScene(h.deps, h.ctx, sceneId, { fields: { view: 'three_quarter_left', framing: 'waist_up', expression: 'laughing' } })
    const { quote, preview } = await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1', 'higgsfield/gpt-image-2.5-flare'], variations: 1, withQa: true })
    // Demo mode runs the mock in place of each model; QA is in the price.
    expect(quote.items.map(i => i.model)).toEqual(['mock/image', 'mock/llm', 'mock/llm', 'mock/image', 'mock/llm', 'mock/llm'])
    const p = preview.prompts[0]!.text
    expect(p.startsWith("Using the attached reference images, keep this woman's face, hair, and features exactly the same.")).toBe(true)
    expect(p).toContain('instead of the white t-shirt, jeans and sneakers in the reference images')
    expect(p).toContain('Ordinary background, not a professional shoot.')
    const view = (await scenesView(h.deps, h.ctx, characterId)).scenes.find(s => s.id === sceneId)!
    expect(view.refs.map(r => r.refId)).toEqual(['REF-00', 'REF-01', 'REF-07', 'REF-10'])
    const made = (await stills(sceneId)).filter(c => c.op === 'generate')
    expect(made).toHaveLength(2)
    for (const c of made) {
      expect(c.status).toBe('in_review')
      expect(c.qaVerdict).toBe('post')
    }
    expect(view.status).toBe('in_review')
  })

  it('by default no Claude check: the price is the image only, the free checks run, and Check this is priced on its own', async () => {
    const { quote } = await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1 })
    expect(quote.items.map(i => i.model)).toEqual(['mock/image'])
    const still = (await stills(sceneId)).filter(c => c.op === 'generate').sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]!
    expect(still.status).toBe('in_review')
    const report = still.qaReport as { summary: string; findings: Array<{ message: string }>; identity: unknown }
    expect(report.findings.map(f => f.message)).toContain('Not checked by Claude. Press Check this for a full check of the marks, logos and skin.')
    expect(report.summary).toMatch(/^Free checks passed \(face match, skin\)/)
    // On demand, with Sonnet (owner, 2026-10-13).
    const check = await estimateAction(h.deps, h.ctx, { type: 'scene_qa', characterId, candidateId: still.id })
    expect(check.quote.items.map(i => i.model)).toEqual(['mock/llm', 'mock/llm'])
    expect(h.deps.config.routing.tasks.qa_perception!.model).toBe('anthropic/claude-sonnet-5-5')
  })

  it('a trained character: the saved character, no attachments, then the drift lock and its QA', async () => {
    const { quote, preview } = await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/soul-2'], variations: 1, withQa: true })
    expect(quote.items.map(i => i.label)).toEqual([
      expect.stringMatching(/Soul 2.0$/), expect.stringMatching(/^Drift lock/), expect.stringMatching(/^QA check/), expect.stringMatching(/^QA mirror check/),
    ])
    expect(preview.prompts[0]!.text.startsWith('Callie, the saved character.')).toBe(true)
    expect(preview.prompts[0]!.text).toContain('Honey-blonde hair, light brown brows')
    expect(preview.prompts[1]!.text).toMatch(/^Make her face and hair match the person in the other attached images exactly/)
    const all = await stills(sceneId)
    const lock = all.find(c => c.op === 'drift_lock')!
    expect(lock.status).toBe('in_review')
    expect(all.find(c => c.id === lock.parentId)!.status).toBe('superseded')
  })

  it('the pick writes the combo log once; a rerun of the same scene is allowed', async () => {
    const pick = (await stills(sceneId)).find(c => c.op === 'generate' && c.status === 'in_review')!
    expect((await approveSceneCandidate(h.deps, h.ctx, pick.id)).comboLogged).toBe(true)
    const ch = toData(await getCharacter(h.deps, h.ctx, characterId))
    const log = parseComboLog(ch.sections.find(s => s.title.startsWith('Combo log'))!.body)
    expect(log).toHaveLength(5)
    expect(log.at(-1)!.date).toBe('2026-10-12')
    expect((await getScene(h.deps, h.ctx, sceneId)).status).toBe('approved')
    const second = (await stills(sceneId)).find(c => c.op === 'generate' && c.status === 'in_review')!
    expect((await approveSceneCandidate(h.deps, h.ctx, second.id)).comboLogged).toBe(false)
    const again = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: true })
    expect(again.quote.status).toBe('open')
  })
})

describe('still edits (Stage 8, demo mode)', () => {
  let sceneId: string
  let stillId: string

  beforeAll(async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, {
      fields: { momentType: 'quiet_moment', camera: 'timer', moment: 'Callie reads on her apartment sofa', setting: 'Her small, lived-in apartment', outfit: 'an oversized gray sweatshirt and soft lounge shorts', footwear: 'thick white socks', light: 'window', view: 'front', framing: 'knees_up', destination: 'feed' },
    })
    sceneId = scene.id
    cuffOnWrongEar = true
    try { await run({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: true }) } finally { cuffOnWrongEar = false }
    stillId = (await stills(sceneId))[0]!.id
  })

  it('jewelry the scene did not ask for is a note, never a fail; any still can be mirrored by hand', async () => {
    const [c] = await stills(sceneId)
    const report = c!.qaReport as { verdict: string; edits: Array<{ change: string }>; findings: Array<{ code: string; severity: string }> }
    expect(report.verdict).toBe('post')
    expect(report.findings.find(f => f.code === 'extra_jewelry')?.severity).toBe('info')
    expect(report.edits[0]!.change).toMatch(/^Remove the gold double-band ear cuff from her RIGHT ear/)
    const { candidateId } = await mirrorCandidate(h.deps, h.ctx, stillId)
    const mirrored = (await stills(sceneId)).find(x => x.id === candidateId)!
    expect(mirrored.op).toBe('mirror')
    expect(mirrored.parentId).toBe(stillId)
    expect((mirrored.qaReport as { summary: string }).summary).toMatch(/Mirrored by hand/)
  })

  it('a reason chip for a logo now offers the one-change edit', async () => {
    const fixes = await rejectCandidate(h.deps, h.ctx, stillId, ['logo'])
    expect(fixes[0]).toMatchObject({ action: 'edit_one_detail', available: true })
  })

  it('two changes or face drift are warnings on an edit, never a block (rules 24 and 25)', async () => {
    const two = await estimateAction(h.deps, h.ctx, { type: 'scene_edit', characterId, candidateId: stillId, change: 'Remove the logo on the mug. Then close her mouth.', face: false, withQa: true })
    expect(two.quote.status).toBe('open')
    expect(two.preview.warnings.map(w => (w as { ruleId?: string }).ruleId)).toContain('edit-one-change')
    const drift = { verdict: 'regenerate', summary: '', reasons: [], detectedView: null, findings: [{ code: 'face_drift', severity: 'fail', message: 'The face does not match.' }] }
    await h.deps.db.update(candidates).set({ qaReport: drift }).where(eq(candidates.id, stillId))
    const onDrift = await estimateAction(h.deps, h.ctx, { type: 'scene_edit', characterId, candidateId: stillId, change: 'Remove the logo on the mug', face: false, withQa: true })
    expect(onDrift.quote.status).toBe('open')
    expect(onDrift.preview.warnings.map(w => (w as { ruleId?: string }).ruleId)).toContain('qa-face-drift')
    // A pick on face drift is a strong warning: it asks first, then it is yours.
    await expect(approveSceneCandidate(h.deps, h.ctx, stillId)).rejects.toMatchObject({ code: 'confirm_required' })
    await expect(approveSceneCandidate(h.deps, h.ctx, stillId, { acknowledge: true })).resolves.toBeDefined()
    await h.deps.db.update(candidates).set({ qaReport: null, status: 'in_review' }).where(eq(candidates.id, stillId))
  })

  it('runs a one-change edit on the still, with REF-00 only for a face change, and checks it', async () => {
    const { quote, preview } = await run({ type: 'scene_edit', characterId, candidateId: stillId, change: 'Turn her head slightly so she looks straight into the lens', face: true, withQa: true })
    expect(quote.items.map(i => i.model)).toEqual(['mock/image', 'mock/llm', 'mock/llm'])
    expect(preview.prompts[0]!.text).toMatch(/^Turn her head slightly so she looks straight into the lens\. Keep everything else in the image exactly the same\. Use the attached reference image only for her face\./)
    const edit = (await stills(sceneId)).find(c => c.op === 'edit')!
    expect(edit.parentId).toBe(stillId)
    expect(edit.status).toBe('in_review')
  })

  it('a closer shot is a free crop, then a 2x upscale that keeps the skin texture', async () => {
    const crop = await cropCandidate(h.deps, h.ctx, stillId, { x: 0.25, y: 0.1, w: 0.5, h: 0.5 })
    const c = (await stills(sceneId)).find(x => x.id === crop.candidateId)!
    expect(c.op).toBe('crop')
    expect(c.status).toBe('in_review')
    const { quote } = await run({ type: 'scene_upscale', characterId, candidateId: crop.candidateId })
    expect(quote.items.map(i => i.model)).toEqual(['mock/image'])
    const up = (await stills(sceneId)).find(x => x.op === 'upscale')!
    expect(up.parentId).toBe(crop.candidateId)
    expect(['in_review', 'qa_failed']).toContain(up.status)
  })
})

describe('defaults, not locks (ruling G1)', () => {
  it('a scene with no outfit or footwear, a low angle, a landscape shape and brands on still runs, with warnings', async () => {
    const scene = await createScene(h.deps, h.ctx, characterId, {
      fields: { momentType: 'caught_mid_action', camera: 'friend_phone', moment: 'Callie holds up a can of sparkling water for the brand', outfit: '', footwear: '', height: 'low', destination: 'landscape', light: 'golden_hour', pose: 'shot from a low angle, looking up at her' },
    })
    await updateScene(h.deps, h.ctx, scene.id, { fields: { brands: true } as never })
    const { quote, preview } = await estimateAction(h.deps, h.ctx, { type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: true })
    expect(quote.status).toBe('open')
    const ids = preview.warnings.map(w => (w as { ruleId?: string }).ruleId)
    expect(ids).toEqual(expect.arrayContaining(['scene-names-footwear', 'scene-everyday-angles', 'scene-aspect']))
    expect(ids).not.toContain('scene-combo-log')
    expect(ids).not.toContain('scene-brand-free')
    expect(preview.prompts[0]!.text).not.toMatch(/unbranded/)
    expect(preview.prompts[0]!.text).toContain('from a low angle')
  })
})

describe('live mode', () => {
  it('a model the API does not offer needs the Higgsfield account connected', async () => {
    const ctx = h.ctx
    await setSetting(h.deps, ctx, 'provider_mode', 'live')
    try {
      const scene = await createScene(h.deps, ctx, characterId, { fields: { momentType: 'walking', camera: 'pov', moment: 'Callie walks to the car', outfit: 'a light denim jacket over a white tank and black leggings', footwear: 'clean white sneakers', light: 'overcast' } })
      await expect(estimateAction(h.deps, ctx, { type: 'scene', characterId, sceneId: scene.id, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: false }))
        .rejects.toThrow(/runs only through your Higgsfield account/)
    } finally {
      await setSetting(h.deps, ctx, 'provider_mode', 'demo')
    }
  })
})
