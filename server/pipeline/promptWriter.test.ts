import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { setRuleSwitch } from './rules.js'
import { createScene, sceneCandidates, updateScene } from './scenes.js'
import { scenesView } from '../api/views.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { getJob } from '../jobs/runner.js'
import { jobs as jobsTable } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { loadConfig } from '../config/load.js'
import { assembleStillPrompt, cleanWritten, sceneFieldsSchema } from '../core/scenes.js'
import { assembleVideoPrompt, cleanWriterOutput, enforceVideoLines, isLabeled, mockWrittenPrompt } from '../core/promptWriter.js'
import { wordCount } from '../core/text.js'
import type { LlmRequest } from '../providers/types.js'

// The prompt writer (owner, 2026-10-13), in demo mode: Claude turns the
// scene details into the final prompt as natural sentences, the owner can
// edit or rewrite it, and the Studio still adds the reference line, the
// mark sides and the REALISM block. Switched off, the template runs.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness
let characterId: string

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs }
}

const view = async (sceneId: string) => (await scenesView(h.deps, h.ctx, characterId)).scenes.find(s => s.id === sceneId)!
const generate = (sceneId: string): StudioAction => ({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1, withQa: false })

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
}, 120_000)

describe('the prompt writer (default on)', () => {
  let sceneId: string

  it('writes the still prompt from the details: natural sentences, 120 to 170 words, the guide\'s method and the director\'s notes, priced with its model', async () => {
    sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie buys peaches at a busy farmers market', fields: { outfit: 'a faded denim jacket over a white tank', footwear: 'worn white sneakers' } })).id
    const before = await view(sceneId)
    expect(before.prompts.still).toBeNull()
    expect(before.templateText).toMatch(/^Callie buys peaches at a busy farmers market\./)
    const { quote, preview, jobs } = await run({ type: 'scene_prompt', characterId, sceneId, target: 'still' })
    expect(quote.models).toEqual(['Demo mock, free'])
    expect(preview.prompts[0]!.text).toMatch(/120 to 170 words/)
    // The ultra-realism guide's method and the director's pass (defaults).
    expect(preview.prompts[0]!.text).toMatch(/Camera ownership: who takes the photo, the front or rear camera/)
    expect(preview.prompts[0]!.text).toMatch(/cause-and-effect camera imperfection/)
    expect(preview.prompts[0]!.text).toMatch(/think like a film director and DP/)
    // Item 6: light with a direction that shapes the face; dim scenes ask
    // for less micro detail so faces never go crunchy.
    expect(preview.prompts[0]!.text).toMatch(/direction\s+that shapes the face/)
    expect(preview.prompts[0]!.text).toMatch(/dim or low-light\s+scene, ask for less micro detail/)
    expect(preview.prompts[0]!.text).toMatch(/crunchy/)
    expect(preview.prompts[0]!.text).toContain('- Outfit: a faded denim jacket over a white tank.')
    // The Studio's own lines are not the writer's job.
    expect(preview.prompts[0]!.text).not.toMatch(/LEFT|RIGHT/)
    expect((await getJob(h.deps, h.ctx, jobs[0]!.id)).status).toBe('completed')
    const written = (await view(sceneId)).prompts.still!
    expect(written).toMatchObject({ source: 'claude', model: 'Demo mock, free', stale: false })
    expect(written.words).toBeGreaterThanOrEqual(120)
    expect(written.words).toBeLessThanOrEqual(170)
    expect(written.text).not.toContain('REALISM:')
    expect(written).toMatchObject({ notesBy: 'claude' })
    expect(written.notes).toMatch(/^Moment: .+ · Hook: /)
  })

  it('Generate uses it; the Studio adds the reference line, the mark sides and the REALISM and AVOID blocks', async () => {
    const written = (await view(sceneId)).prompts.still!.text
    const { preview } = await estimateAction(h.deps, h.ctx, generate(sceneId))
    const text = preview.prompts[0]!.text
    expect(text.startsWith("Using the attached reference images, keep this woman's face, hair, and features exactly the same.")).toBe(true)
    expect(text).toContain(written.slice(0, 60))
    expect(text).toMatch(/mole/i)
    expect(text).toMatch(/\bLEFT\b/)
    expect(text).toMatch(/REALISM: .{20,}/)
    expect(text).toMatch(/AVOID: .{10,}/)
    expect(text).toContain('She is wearing a faded denim jacket over a white tank, with worn white sneakers, wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images.')
    // The written text satisfies the same scene rules as the template.
    expect(preview.warnings.map(w => w.title)).toEqual([])
  })

  it('the owner edits it; smoothing words are stripped and the REALISM block cannot be swapped out', async () => {
    await updateScene(h.deps, h.ctx, sceneId, { prompts: { still: 'Callie laughs as she reaches for a peach, her flawless skin catching the morning sun.\nREALISM: none' } })
    const v = await view(sceneId)
    expect(v.prompts.still).toMatchObject({ source: 'owner' })
    const { preview } = await estimateAction(h.deps, h.ctx, generate(sceneId))
    const text = preview.prompts[0]!.text
    expect(text).toContain('Callie laughs as she reaches for a peach')
    expect(text).not.toMatch(/flawless/i)
    expect(text).not.toContain('REALISM: none')
    expect(text).toMatch(/REALISM: .{20,}/)
    expect(preview.warnings.map(w => (w as { ruleId?: string }).ruleId)).toContain('realism-banned-words')
  })

  it('a change to the details after writing is pointed out, and Rewrite replaces the text', async () => {
    await run({ type: 'scene_prompt', characterId, sceneId, target: 'still' })
    expect((await view(sceneId)).prompts.still).toMatchObject({ source: 'claude', stale: false })
    await updateScene(h.deps, h.ctx, sceneId, { fields: { setting: 'A rainy covered market with string lights' } })
    expect((await view(sceneId)).prompts.still!.stale).toBe(true)
  })

  it('switched off, the template builds the prompt and the box is not used', async () => {
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-prompt-writer', on: false })
    try {
      const data = await scenesView(h.deps, h.ctx, characterId)
      expect(data.options.promptWriter.on).toBe(false)
      const { preview } = await estimateAction(h.deps, h.ctx, generate(sceneId))
      expect(preview.prompts[0]!.text).toContain('Hair:')
      expect(preview.prompts[0]!.text).not.toContain((await view(sceneId)).prompts.still!.text.slice(0, 60))
    } finally {
      await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-prompt-writer', on: null })
    }
  })

  it('with nothing written yet, a run still works on the template, with a note', async () => {
    const fresh = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie ties her shoes on a park bench' })).id
    const { preview } = await estimateAction(h.deps, h.ctx, generate(fresh))
    expect(preview.warnings.map(w => w.title)).toContain('No written prompt yet')
    expect(preview.prompts[0]!.text).toMatch(/REALISM: .{20,}/)
  })

  it('writes the video prompt in the guide\'s labeled lines, looking at the start frame; FORMAT and AUDIO are the Studio\'s; the take adds the directions, silence and REALISM', async () => {
    await run(generate(sceneId))
    const still = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'generate' && c.assetId)!
    const action: StudioAction = { type: 'scene_prompt', characterId, sceneId, target: 'video', motion: 'Callie bites into a peach and laughs', directions: 'No talking, no winking, steady eye contact.', startCandidateId: still.id }
    const { quote, jobs } = await run(action)
    expect(quote.models).toEqual(['Demo mock, free'])
    const seen = (await getJob(h.deps, h.ctx, jobs[0]!.id)).request as LlmRequest & { imageAssetIds?: string[] }
    expect(seen.imageAssetIds).toEqual([still.assetId])
    expect(seen.system).toMatch(/110 to 180 words/)
    expect(seen.system).toContain('No talking, no winking, steady eye contact.')
    expect(seen.system).toMatch(/Write exactly these labeled lines/)
    expect(seen.system).toMatch(/direction that shapes the face/)
    expect(seen.system).toMatch(/crunchy or over-sharpened/)
    expect(seen.system).toMatch(/the payoff in the last 2 seconds/)
    // The start frame shows the place: the setting is not handed over.
    expect(seen.prompt).not.toContain('farmers market')
    const written = (await view(sceneId)).prompts.video!
    expect(written).toMatchObject({ source: 'claude', motion: 'Callie bites into a peach and laughs', notesBy: 'claude' })
    const lines = written.text.split('\n')
    expect(lines.map(l => l.split(':')[0])).toEqual(['FORMAT', 'SUBJECT', 'SETTING/LIGHT', 'CAMERA', 'ACTION', 'CONTINUITY', 'AUDIO', 'CONSTRAINTS'])
    // 9:16 and sound off unless the owner turns it on.
    expect(lines[0]).toBe('FORMAT: 5 s, 9:16, live-action personal phone video, one continuous take, no cuts.')
    expect(lines[6]).toBe('AUDIO: Sound off: silent, no dialogue, no music.')
    expect(written.words).toBeGreaterThanOrEqual(110)
    expect(written.words).toBeLessThanOrEqual(180)
    // The box holds the written motion; the take sends exactly that.
    const take = await estimateAction(h.deps, h.ctx, {
      type: 'scene_video', characterId, candidateId: still.id, motion: written.text,
      directions: 'No talking, no winking, steady eye contact.', durationSec: 5, aspect: '9:16', audio: false, takes: 1, test: false,
    })
    const text = take.preview.prompts[0]!.text
    // The labeled lines go as written, one per line, then the directions.
    expect(text.startsWith(written.text)).toBe(true)
    expect(text).toContain('\nNo talking, no winking, steady eye contact. Silent, no audio, no dialogue.\n')
    expect(text).toMatch(/\nREALISM: .{20,}/)
  })

  it('Rewrite follows the director\'s notes you set; sound on writes the sound line', async () => {
    const still = (await sceneCandidates(h.deps, h.ctx, [sceneId])).find(c => c.op === 'generate' && c.assetId)!
    await updateScene(h.deps, h.ctx, sceneId, { notes: { video: 'Moment: the first bite · Hook: juice on the chin · Payoff: a laugh to the lens · Camera: slow push in' } })
    expect((await view(sceneId)).prompts.video).toMatchObject({ notesBy: 'owner' })
    const notes = (await view(sceneId)).prompts.video!.notes!
    const { jobs } = await run({ type: 'scene_prompt', characterId, sceneId, target: 'video', motion: 'Callie bites into a peach and laughs', startCandidateId: still.id, notes, audio: true, durationSec: 10 })
    const seen = (await getJob(h.deps, h.ctx, jobs[0]!.id)).request as LlmRequest
    expect(seen.system).toContain(`The owner set these director's notes. Follow them, and return them\nunchanged as "notes": ${notes}`)
    const written = (await view(sceneId)).prompts.video!
    expect(written).toMatchObject({ notes, notesBy: 'owner' })
    expect(written.text.split('\n')[0]).toBe('FORMAT: 10 s, 9:16, live-action personal phone video, one continuous take, no cuts.')
    expect(written.text).toContain('AUDIO: Phone-microphone sound')
  })

  it('the director\'s pass is a default the owner can switch off', async () => {
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-directors-pass', on: false })
    try {
      const { preview } = await estimateAction(h.deps, h.ctx, { type: 'scene_prompt', characterId, sceneId, target: 'still' })
      expect(preview.prompts[0]!.text).not.toMatch(/film director/)
    } finally {
      await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-directors-pass', on: null })
    }
  })
})

describe('prompt writer pieces', () => {
  const cfg = loadConfig()
  const { templates: t, scenes: sc, views } = cfg.pipeline
  const f = sceneFieldsSchema.parse({
    title: 'x', momentType: 'caught_mid_action', moment: 'Callie laughs on a rooftop', setting: '', location: '', outfit: 'a linen sundress', footwear: '',
    jewelry: 'gold double-band ear cuff (LEFT ear)', makeup: 'natural', hair: '', pose: '', view: 'front', expression: 'soft_smile', camera: 'friend_phone',
    foreground: '', height: 'eye_level', framing: 'waist_up', light: 'golden_hour', destination: 'vertical', brands: false, refs: [],
  })
  const ch = {
    name: 'Callie', card: '24, long honey-blonde hair', pronouns: { subj: 'she', obj: 'her', poss: 'her', noun: 'woman' },
    marks: [{ name: 'mole', description: 'small brown mole', side: 'LEFT' as const, region: 'brow', kind: 'skin' as const, subtle: true }],
    makeup: { default: 'light mascara', glam_when: [] }, realism: { block: 'REALISM: visible pores, fine peach fuzz, slight redness around the nose.', avoid: '', notes: [] },
  }

  it('starts each model with its own reference line and adds the exact outfit sentence, jewelry side word for word', () => {
    const refs = assembleStillPrompt(t, sc, views, f, ch as never, 'refs', 'Callie laughs on a rooftop at golden hour.')
    expect(refs).toMatch(/^Using the attached reference images/)
    expect(refs).toContain('She is wearing a linen sundress, gold double-band ear cuff (LEFT ear), wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images.')
    const trained = assembleStillPrompt(t, sc, views, f, ch as never, 'trained', 'Callie laughs on a rooftop at golden hour.')
    expect(trained).toMatch(/^Callie, the saved character\./)
    expect(trained).toContain('She is wearing a linen sundress, gold double-band ear cuff (LEFT ear).')
    expect(trained).not.toContain('instead of')
  })

  it('drops a REALISM or AVOID block from written text; the Studio adds its own', () => {
    expect(cleanWritten('"Callie laughs."\nREALISM: none\nAVOID: x')).toBe('Callie laughs.')
    expect(assembleVideoPrompt(t, 'Callie laughs.\nREALISM: none', { directions: 'No winking.', audio: false, realism: ch.realism.block }))
      .toBe('Callie laughs. No winking. Silent, no audio, no dialogue.\nREALISM: visible pores, fine peach fuzz, slight redness around the nose. No beauty smoothing, no retouching.')
    expect(assembleVideoPrompt(t, 'Callie laughs, her smooth skin glowing.', { directions: '', audio: true })).not.toMatch(/smooth skin/)
  })

  it('labeled video answers keep one line per label; FORMAT and AUDIO are always the Studio\'s', () => {
    const answer = '"FORMAT: 15 s, 16:9, cinematic.\nSUBJECT: Callie as in the start frame.\nSETTING/LIGHT: A cafe; window light from camera-left,\nfalling across the table.\nCAMERA: A friend on the rear camera, about 1 metre away.\nACTION: She stirs her coffee, hears her name, smiles, and stirs again.\nCONTINUITY: The spoon stays in her right hand.\nCONSTRAINTS: No posed smile, flawless skin.\nREALISM: none"'
    const { text, removed } = cleanWriterOutput(answer)
    expect(text.split('\n')[2]).toBe('SETTING/LIGHT: A cafe; window light from camera-left, falling across the table.')
    expect(text).not.toMatch(/REALISM|flawless/)
    expect(removed).toContain('flawless')
    const fixed = enforceVideoLines(text, { format: 'FORMAT: 5 s, 9:16, live-action personal phone video, one continuous take, no cuts.', audio: 'AUDIO: Sound off: silent, no dialogue, no music.' })
    expect(fixed.split('\n').map(l => l.split(':')[0])).toEqual(['FORMAT', 'SUBJECT', 'SETTING/LIGHT', 'CAMERA', 'ACTION', 'CONTINUITY', 'AUDIO', 'CONSTRAINTS'])
    expect(fixed).not.toMatch(/16:9|cinematic/)
  })

  it('demo answers stay inside the word ranges', () => {
    const still = mockWrittenPrompt('still', { facts: '- The moment: Callie laughs.' }, [110, 150])
    expect(wordCount(still)).toBeGreaterThanOrEqual(110)
    expect(wordCount(still)).toBeLessThanOrEqual(150)
    const video = mockWrittenPrompt('video', { motion: 'Callie turns' }, [110, 180])
    expect(wordCount(video)).toBeGreaterThanOrEqual(110)
    expect(wordCount(video)).toBeLessThanOrEqual(180)
    expect(isLabeled(video)).toBe(true)
  })
})

describe('Write and generate (one price)', () => {
  const writeAndGenerate = (sceneId: string): StudioAction => ({ type: 'scene', characterId, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 2, withQa: false, write: true })

  it('writes the prompt first, then each still runs on it with the Studio lines and REALISM; one quote for both', async () => {
    const sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie reads on a park bench at golden hour' })).id
    const { quote, preview } = await estimateAction(h.deps, h.ctx, writeAndGenerate(sceneId))
    expect(quote.items.map(i => i.label)).toEqual([expect.stringMatching(/^Write the prompt/), expect.stringMatching(/still 1/), expect.stringMatching(/still 2/)])
    expect(preview.title).toMatch(/write the prompt, then 2 stills/)
    expect(preview.prompts[0]!.label).toBe('Prompt writer')
    const { jobs } = await runAction(h.deps, h.ctx, writeAndGenerate(sceneId), quote.id, true)
    expect(jobs).toHaveLength(3)
    // The stills wait for the writer.
    expect((await getJob(h.deps, h.ctx, jobs[1]!.id)).status).toBe('waiting')
    await drain(h, 60)
    const v = await view(sceneId)
    expect(v.prompts.still).toMatchObject({ source: 'claude' })
    const stills = v.candidates.filter(c => c.op === 'generate')
    expect(stills).toHaveLength(2)
    for (const c of stills) {
      expect(c.assetId).toBeTruthy()
      expect(c.prompt).toContain(v.prompts.still!.text.slice(0, 60))
      expect(c.prompt).toMatch(/REALISM: .{20,}/)
      expect(c.prompt.startsWith('Using the attached reference images')).toBe(true)
    }
    for (const j of jobs.slice(1)) expect((await getJob(h.deps, h.ctx, j.id)).request).not.toHaveProperty('promptFrom')
  })

  it('without a written prompt, the stills do not run and nothing is charged for them', async () => {
    const sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie stretches before a run' })).id
    const { quote } = await estimateAction(h.deps, h.ctx, writeAndGenerate(sceneId))
    const { jobs } = await runAction(h.deps, h.ctx, writeAndGenerate(sceneId), quote.id, true)
    const writer = await getJob(h.deps, h.ctx, jobs[0]!.id)
    const req = writer.request as { meta: Record<string, unknown> }
    await h.deps.db.update(jobsTable).set({ request: { ...req, meta: { ...req.meta, mockPrompt: '' } } }).where(eq(jobsTable.id, writer.id))
    await drain(h, 30)
    for (const j of jobs.slice(1)) {
      const job = await getJob(h.deps, h.ctx, j.id)
      expect(job.status).toBe('canceled')
      expect(job.actualMicros ?? 0).toBe(0)
    }
    // Each still shows as failed, with the reason, in the Stills grid.
    const tiles = (await view(sceneId)).candidates
    expect(tiles.map(c => c.status)).toEqual(['failed', 'failed'])
    expect(tiles[0]!.rejectNote).toMatch(/prompt writer did not finish/)
  })

  it('a written prompt that breaks a fixed rule is refused before any still runs', async () => {
    const sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie at the beach' })).id
    const { quote } = await estimateAction(h.deps, h.ctx, writeAndGenerate(sceneId))
    const { jobs } = await runAction(h.deps, h.ctx, writeAndGenerate(sceneId), quote.id, true)
    const writer = await getJob(h.deps, h.ctx, jobs[0]!.id)
    const req = writer.request as { meta: Record<string, unknown> }
    await h.deps.db.update(jobsTable).set({ request: { ...req, meta: { ...req.meta, mockPrompt: 'Callie poses fully nude on the sand at sunset, candid phone photo.' } } }).where(eq(jobsTable.id, writer.id))
    await drain(h, 30)
    for (const j of jobs.slice(1)) {
      const job = await getJob(h.deps, h.ctx, j.id)
      expect(job.status).toBe('canceled')
      expect(JSON.stringify(job.error)).toMatch(/refused/)
    }
  })
})

// Catalog wording (owner, 2026-10-15; G46): the planner's and the writer's
// words in catalog terms, no fit or body words, a moment and not a pose.
// What she wears never changes, and the owner's own words go as typed.
describe('catalog wording in the planner and the writer', () => {
  async function started(action: StudioAction) {
    const { quote } = await estimateAction(h.deps, h.ctx, action)
    const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
    return getJob(h.deps, h.ctx, jobs[0]!.id)
  }
  async function answer(jobId: string, meta: Record<string, unknown>) {
    const job = await getJob(h.deps, h.ctx, jobId)
    const req = job.request as { meta: Record<string, unknown> }
    await h.deps.db.update(jobsTable).set({ request: { ...req, meta: { ...req.meta, ...meta } } }).where(eq(jobsTable.id, jobId))
    await drain(h, 60)
  }

  it('the writer\'s words are reworded; the owner\'s typed outfit word stays and is warned about on the price', async () => {
    const sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie refills her water bottle at the gym', fields: { outfit: 'a tight black tank top and grey joggers' } })).id
    const writer = await started({ type: 'scene_prompt', characterId, sceneId, target: 'still' })
    await answer(writer.id, { mockPrompt: 'Callie posing in a fitted grey sports bra and boy shorts, showing off her toned legs, refilling her water bottle at the fountain. Her tight black tank top hangs on the bench.' })
    const written = (await view(sceneId)).prompts.still!
    // The garment stays a sports bra (owner, 2026-10-15); only boy shorts is swapped.
    expect(written.text).toBe('Callie wearing a grey sports bra and bike shorts, refilling her water bottle at the fountain. Her tight black tank top hangs on the bench.')
    expect([...(written.removed ?? [])].sort()).toEqual(['boy shorts', 'fitted', 'legs', 'posing in'])
    // The owner's "tight" goes as typed, with a warning that never blocks.
    const { preview } = await estimateAction(h.deps, h.ctx, generate(sceneId))
    expect(preview.prompts[0]!.text).toContain('She is wearing a tight black tank top and grey joggers')
    expect(preview.warnings.find(w => (w as { ruleId?: string }).ruleId === 'wording-risky')).toMatchObject({ severity: 'warning', message: 'tight. Your words go as typed.' })
  })

  it('the planner\'s outfit and position come back in catalog terms; switched off, they come back as written', async () => {
    const plan = (outfit: string, pose: string) => ({ title: 'Gym refill', momentType: 'caught_mid_action', moment: 'Callie refills her water bottle between sets.', outfit, pose, camera: 'friend_phone', light: 'natural', framing: 'waist_up' })
    const sceneId = (await createScene(h.deps, h.ctx, characterId, { brief: 'Callie at the gym' })).id
    const job = await started({ type: 'scene_plan', characterId, sceneId })
    await answer(job.id, { mockPlan: plan('dark green fitted ribbed tank top with thin straps, black boy shorts', 'posing by the fountain, eyes on the bottle') })
    const fields = (await view(sceneId)).fields
    expect(fields.outfit).toBe('dark green ribbed tank top with thin straps, black bike shorts')
    expect(fields.pose).toBe('standing by the fountain, eyes on the bottle')
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'prompt-catalog-wording', on: false })
    try {
      const again = await started({ type: 'scene_plan', characterId, sceneId })
      await answer(again.id, { mockPlan: plan('dark green fitted ribbed tank top', 'posing by the fountain') })
      expect((await view(sceneId)).fields.outfit).toBe('dark green fitted ribbed tank top')
    } finally {
      await setRuleSwitch(h.deps, h.ctx, { ruleId: 'prompt-catalog-wording', on: null })
    }
  })
})
