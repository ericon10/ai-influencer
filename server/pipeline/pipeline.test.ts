import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { createCharacter, linkInspiration, listConcepts, getCharacter, candidatesFor, sheetState, toData, updateCharacter } from './characters.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { chooseConcept } from './concepts.js'
import { approveCandidate, keepStale, mirrorCandidate, pickHero, rejectCandidate } from './review.js'
import { exportCharacter, importCharacter } from './files.js'
import { characterCosts } from './costs.js'
import { setSetting } from './settings.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import sharp from 'sharp'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { parseObservation } from '../core/qa/perception.js'
import { mirrorObservation, type QaReport } from '../core/qa/marks.js'
import type { LlmRequest } from '../providers/types.js'
import { eq } from 'drizzle-orm'
import { jobs as jobsTable } from '../db/schema.js'

// The whole of Phase 1 in demo mode (mock providers, no spend), including
// the acceptance scenario: a REF-04 that comes back with the ear cuff on the
// wrong ear is caught by QA, its dependents go stale, and the fix lands.

const FIX = join(process.cwd(), 'fixtures', 'callie')
const callie = JSON.parse(readFileSync(join(FIX, 'appendix-a.json'), 'utf8'))
const mirroredRef04 = parseObservation(JSON.parse(readFileSync(join(FIX, 'perceptions', 'REF-04-mirrored.json'), 'utf8')))
const flippedRef04 = parseObservation(JSON.parse(readFileSync(join(FIX, 'perceptions', 'REF-04-flipped.json'), 'utf8')))

let h: Harness
let characterId: string
let mirrorNextRef04 = false
let flippedNextRef04 = false

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
  return { quote, preview, jobs }
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness({
    mockLlmResponders: {
      qa_perception: (req: LlmRequest) => {
        const meta = req.meta as { refId: string; pass: string; mockObservation: unknown }
        if (flippedNextRef04 && meta.refId === 'REF-04') return meta.pass === 'orig' ? flippedRef04 : mirrorObservation(flippedRef04)
        if (mirrorNextRef04 && meta.refId === 'REF-04') {
          return meta.pass === 'orig' ? mirroredRef04 : { ...mirroredRef04, nose: 'image_left', ears: [{ ...mirroredRef04.ears[0]!, image_side: 'image_right' }] }
        }
        return meta.mockObservation
      },
    },
  })
  const row = await createCharacter(h.deps, h.ctx, { name: 'New character' })
  characterId = row.id
}, 120_000)

describe('character creation, stages 1 to 5 (demo mode)', () => {
  it('stage 1: breaks down the inspiration image', async () => {
    const insp = await saveAsset(h.deps, h.ctx, { data: await renderPlaceholderPortrait('inspiration'), origin: 'upload' })
    await linkInspiration(h.deps, h.ctx, characterId, insp.id)
    const { quote } = await run({ type: 'breakdown', characterId })
    expect(quote.items[0]!.model).toBe('mock/llm')
    const ch = await getCharacter(h.deps, h.ctx, characterId)
    expect((ch.breakdown as { keep: unknown[] }).keep.length).toBeGreaterThan(0)
  })

  it('stage 2: proposes 3 concepts and the chosen one becomes the card', async () => {
    await run({ type: 'concepts', characterId })
    const cs = (await listConcepts(h.deps, h.ctx, characterId)).filter(c => c.status === 'proposed')
    expect(cs).toHaveLength(3)
    expect(cs.map(c => c.position)).toEqual([0, 1, 2])
    await chooseConcept(h.deps, h.ctx, cs[0]!.id)
    const ch = toData(await getCharacter(h.deps, h.ctx, characterId))
    expect(ch.name).toBe((cs[0]!.data as { name: string }).name)
    expect(ch.marks).toHaveLength(2)
    expect(ch.age).toBeGreaterThanOrEqual(21)
    // The acceptance scenario is Callie's: from here on the character uses
    // her card and side-specific marks (fixture data, not app logic).
    await updateCharacter(h.deps, h.ctx, characterId, { name: callie.name, age: callie.age, card: callie.card, eyes: callie.eyes, marks: callie.marks, body: callie.body, pronouns: callie.pronouns }, 'use Callie fixture')
  })

  it('stage 3: runs 3 text-only hero prompts, 4 to 8 candidates each, and one hero becomes REF-00', async () => {
    await expect(estimateAction(h.deps, h.ctx, { type: 'hero', characterId, runsPerPrompt: 3 })).rejects.toThrow()
    const { preview, jobs } = await run({ type: 'hero', characterId, runsPerPrompt: 4 })
    expect(preview.prompts).toHaveLength(3)
    // How Callie's REF-00 was made: neutral, gray background, white tee, bare face.
    for (const p of preview.prompts) {
      expect(p.text).toMatch(/Chest-up portrait of .*Facing the camera, relaxed neutral expression/)
      expect(p.text).toMatch(/Plain light gray background, soft even daylight, plain white crew-neck tee, hair in its usual style/)
      expect(p.text).toContain('Bare face, no makeup, no retouching.')
      expect(p.text).toContain('natural skin with visible pores and small believable imperfections')
      expect(p.text).not.toMatch(/\b(acne|blemish|scar|rough skin)/i)
    }
    expect(jobs).toHaveLength(12)
    for (const j of jobs) expect((j.request as { refs?: unknown[] }).refs).toBeUndefined()
    const heroes = await candidatesFor(h.deps, h.ctx, characterId, { target: 'hero', statuses: ['in_review'] })
    expect(heroes).toHaveLength(12)
    const pick = await pickHero(h.deps, h.ctx, heroes[0]!.id)
    expect(pick.needsUpscale).toBe(false)
    const ch = await getCharacter(h.deps, h.ctx, characterId)
    expect(ch.stage).toBe(4)
    // The lock names the real sheet model, so going live keeps the sheet on
    // it; demo mode substitutes the mock only at run time.
    expect((ch.sheetLock as { model: string }).model).toBe('higgsfield/gpt-image-2.5')
    expect(await candidatesFor(h.deps, h.ctx, characterId, { target: 'hero', statuses: ['in_review'] })).toHaveLength(0)
  })

  it('stage 4: builds the sheet one next-up shot at a time, with QA quoted in', async () => {
    for (let guard = 0; guard < 20; guard++) {
      const state = await sheetState(h.deps, h.ctx, characterId)
      if (!state.next) break
      expect(state.next.action).toBe('generate')
      const refId = state.next.shot.id
      const { quote } = await run({ type: 'sheet', characterId, refId, variations: 1, refsMode: 'graph', withQa: true })
      // One render plus two QA passes (original and mirrored) per variation.
      expect(quote.items.map(i => i.model)).toEqual(['mock/image', 'mock/llm', 'mock/llm'])
      const [cand] = await candidatesFor(h.deps, h.ctx, characterId, { refId, statuses: ['in_review'] })
      expect(cand, refId).toBeDefined()
      expect(cand!.qaVerdict, refId).toBe('post')
      await approveCandidate(h.deps, h.ctx, cand!.id)
    }
    const state = await sheetState(h.deps, h.ctx, characterId)
    expect(state.progress).toMatchObject({ approved: 12, complete: true })
    expect((await getCharacter(h.deps, h.ctx, characterId)).stage).toBe(5)
  })

  it('acceptance: QA catches a REF-04 with the cuff on the wrong ear; dependents go stale', async () => {
    mirrorNextRef04 = true
    const { preview } = await run({ type: 'sheet', characterId, refId: 'REF-04', variations: 1, refsMode: 'graph', withQa: true })
    expect(preview.invalidates).toEqual(['REF-05', 'REF-08'])
    const [failed] = await candidatesFor(h.deps, h.ctx, characterId, { refId: 'REF-04', statuses: ['qa_failed'] })
    expect(failed).toBeDefined()
    expect(failed!.qaVerdict).toBe('regenerate')
    const report = failed!.qaReport as { reasons: string[]; summary: string }
    expect(report.reasons).toContain('mark_wrong_side')
    expect(report.summary).toMatch(/RIGHT ear/)
    const state = await sheetState(h.deps, h.ctx, characterId)
    const status = (id: string) => state.states.find(s => s.refId === id)!.status
    expect(status('REF-04')).toBe('pending')
    expect(status('REF-05')).toBe('stale')
    expect(status('REF-08')).toBe('stale')
    expect(state.next).toMatchObject({ shot: { id: 'REF-04' }, action: 'generate' })
  })

  it('the fix: regenerate with marks stressed, approve, then re-check the stale shots', async () => {
    mirrorNextRef04 = false
    const { preview } = await run({ type: 'sheet', characterId, refId: 'REF-04', variations: 1, reason: 'mark_wrong_side', refsMode: 'graph', withQa: true })
    expect(preview.prompts[0]!.text).toMatch(/Do not mirror the image or move any mark to the other side/)
    const [fixed] = await candidatesFor(h.deps, h.ctx, characterId, { refId: 'REF-04', statuses: ['in_review'] })
    await approveCandidate(h.deps, h.ctx, fixed!.id)

    let state = await sheetState(h.deps, h.ctx, characterId)
    expect(state.next).toMatchObject({ shot: { id: 'REF-05' }, action: 'recheck' })
    const ref05 = state.refs.find(r => r.refId === 'REF-05')!
    await run({ type: 'qa', characterId, candidateId: ref05.approvedCandidateId! })
    const [rechecked] = await candidatesFor(h.deps, h.ctx, characterId, { refId: 'REF-05', statuses: ['approved'] })
    expect(rechecked!.qaVerdict).toBe('post')
    await keepStale(h.deps, h.ctx, characterId, 'REF-05')

    state = await sheetState(h.deps, h.ctx, characterId)
    expect(state.next).toMatchObject({ shot: { id: 'REF-08' }, action: 'recheck' })
    await keepStale(h.deps, h.ctx, characterId, 'REF-08')
    expect((await sheetState(h.deps, h.ctx, characterId)).progress.complete).toBe(true)
  })

  it('a rejected result is archived with its reasons and suggests the matching fix', async () => {
    await run({ type: 'sheet', characterId, refId: 'REF-09', variations: 1, refsMode: 'graph', withQa: true })
    const [cand] = await candidatesFor(h.deps, h.ctx, characterId, { refId: 'REF-09', statuses: ['in_review'] })
    const fixes = await rejectCandidate(h.deps, h.ctx, cand!.id, ['face_drift', 'logo'], 'eyes too blue')
    expect(fixes.map(f => f.action)).toEqual(['regenerate_closer_refs', 'regenerate'])
    expect(fixes[1]!.label).toMatch(/phase 2/)
    const [archived] = await candidatesFor(h.deps, h.ctx, characterId, { refId: 'REF-09', statuses: ['rejected'] })
    expect(archived!.rejectReasons).toEqual(['face_drift', 'logo'])
  })

  it('refuses a run whose inputs changed after the estimate', async () => {
    const action: StudioAction = { type: 'sheet', characterId, refId: 'REF-09', variations: 1, refsMode: 'graph', withQa: true }
    const { quote } = await estimateAction(h.deps, h.ctx, action)
    const ch = toData(await getCharacter(h.deps, h.ctx, characterId))
    const marks = ch.marks.map(m => (m.kind === 'jewelry' ? { ...m, description: 'thin gold ear cuff' } : m))
    await updateCharacter(h.deps, h.ctx, characterId, { marks }, 'test edit')
    await expect(runAction(h.deps, h.ctx, action, quote.id, true)).rejects.toMatchObject({ code: 'quote_expired' })
    await updateCharacter(h.deps, h.ctx, characterId, { marks: ch.marks }, 'undo test edit')
  })

  it('stage 5: exports the character file and imports it with its sheet', async () => {
    const { filename, markdown } = await exportCharacter(h.deps, h.ctx, characterId)
    expect(filename).toMatch(/^character-[a-z0-9-]+\.md$/)
    expect(markdown).toMatch(/\| REF-04 \| Right side, profile \| approved \|/)
    const images: Record<string, { data: Buffer }> = {}
    for (const id of ['REF-00', 'REF-01', 'REF-02']) images[id] = { data: await renderPlaceholderPortrait(id) }
    const imported = await importCharacter(h.deps, h.ctx, markdown, { images })
    expect(imported.importedShots).toEqual(['REF-00', 'REF-01', 'REF-02'])
    const state = await sheetState(h.deps, h.ctx, imported.characterId)
    expect(state.progress.approved).toBe(3)
    expect(toData(await getCharacter(h.deps, h.ctx, imported.characterId)).marks).toEqual(toData(await getCharacter(h.deps, h.ctx, characterId)).marks)
  })

  it("acceptance: loads Callie from her real file and regenerates a sheet shot from REF-00", async () => {
    const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
    const images: Record<string, { data: Buffer }> = {}
    for (const id of ['REF-00', 'REF-01', 'REF-02']) images[id] = { data: await renderPlaceholderPortrait(`Callie ${id}`) }
    const imported = await importCharacter(h.deps, h.ctx, md, { images })
    const row = await getCharacter(h.deps, h.ctx, imported.characterId)
    const data = toData(row)
    expect(data.name).toBe('Callie')
    expect(data.identities.map(i => [i.kind, i.name])).toEqual([['trained', 'Callie'], ['element', 'Callie-1']])
    expect(data.sections.map(s => s.title)).toContain('Video rules')
    // Her sheet stays on the model it was built with, even in demo mode.
    expect((row.sheetLock as { model: string }).model).toBe('higgsfield/gpt-image-2.5')

    const { quote, preview } = await run({ type: 'sheet', characterId: row.id, refId: 'REF-01', variations: 1, refsMode: 'ref00_only', withQa: true })
    // Demo mode runs the mock in place of the locked model; nothing is spent on a provider.
    expect(quote.items.map(i => i.model)).toEqual(['mock/image', 'mock/llm', 'mock/llm'])
    expect(preview.prompts[0]!.text).toMatch(/gold double-band ear cuff/)
    expect(preview.prompts[0]!.text).toMatch(/LEFT ear/)
    const [cand] = await candidatesFor(h.deps, h.ctx, row.id, { refId: 'REF-01', statuses: ['in_review'] })
    expect(cand).toBeDefined()
    expect(cand!.qaVerdict).toBe('post')
    const job = (await h.deps.db.select().from(jobsTable).where(eq(jobsTable.id, cand!.jobId!)))[0]!
    const ref00 = (await candidatesFor(h.deps, h.ctx, row.id, { refId: 'REF-00', statuses: ['approved'] }))[0]!
    expect((job.request as { refs: Array<{ assetId: string }> }).refs).toEqual([{ assetId: ref00.assetId }])

    // A run on Soul uses her trained character and always carries its
    // SOUL IDENTITY block (demo mode still runs the mock).
    await setSetting(h.deps, h.ctx, 'routing_overrides', { hero: { model: 'higgsfield/soul-2' } })
    try {
      const soulRun = await run({ type: 'hero', characterId: row.id, runsPerPrompt: 4 })
      expect(soulRun.preview.prompts.every(p => p.text.includes('If hair is wet or slicked back, add "but still clearly blonde."'))).toBe(true)
      expect(soulRun.jobs.map(j => (j.request as { identityId?: string }).identityId)).toEqual(Array(12).fill('0fdc33c0-7a1a-40a9-9b12-0dc35f44e29e'))
    } finally {
      await setSetting(h.deps, h.ctx, 'routing_overrides', {})
    }
  })

  it('acceptance: a mirrored REF-04 imported to check is flagged by QA, then fixed for free by mirroring', async () => {
    const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8')
    const images: Record<string, { data: Buffer }> = {}
    for (const id of ['REF-00', 'REF-01', 'REF-02', 'REF-03', 'REF-04']) images[id] = { data: await renderPlaceholderPortrait(`Callie ${id}`) }
    const negative = await renderPlaceholderPortrait('Callie REF-04 mirrored')
    const imported = await importCharacter(h.deps, h.ctx, md, { images, checks: [{ refId: 'REF-04', name: 'REF-04-mirrored.png', data: negative }] })
    expect(imported.checkShots).toEqual(['REF-04-mirrored.png'])
    const id = imported.characterId
    const [check] = await candidatesFor(h.deps, h.ctx, id, { refId: 'REF-04', statuses: ['check'] })
    expect(check).toBeDefined()
    // The negative never joins the sheet or the review queue.
    const before = await sheetState(h.deps, h.ctx, id)
    expect(before.states.find(s => s.refId === 'REF-04')!.status).toBe('approved')

    flippedNextRef04 = true
    try { await run({ type: 'qa', characterId: id, candidateId: check!.id }) } finally { flippedNextRef04 = false }
    const [checked] = await candidatesFor(h.deps, h.ctx, id, { refId: 'REF-04', statuses: ['check'] })
    const report = checked!.qaReport as QaReport
    expect(checked!.qaVerdict).toBe('regenerate')
    expect(report.findings.find(f => f.code === 'wrong_view')!.message).toMatch(/mirrored/)
    expect(report.mirrorFix).toMatchObject({ available: true })

    const jobsBefore = (await h.deps.db.select().from(jobsTable)).length
    const { candidateId } = await mirrorCandidate(h.deps, h.ctx, check!.id)
    expect((await h.deps.db.select().from(jobsTable)).length).toBe(jobsBefore) // no provider call
    const fixed = (await candidatesFor(h.deps, h.ctx, id, { refId: 'REF-04' })).find(c => c.id === candidateId)!
    expect(fixed.status).toBe('check')
    expect(fixed.qaVerdict).toBe('post')
    // The fix is exactly the horizontal flip of the uploaded image.
    const raw = async (assetId: string, flop = false) => (await (flop ? sharp((await readAsset(h.deps, h.ctx, assetId)).data).flop() : sharp((await readAsset(h.deps, h.ctx, assetId)).data)).raw().toBuffer())
    expect((await raw(fixed.assetId!)).equals(await raw(checked!.assetId!, true))).toBe(true)
    expect((await sheetState(h.deps, h.ctx, id)).states.find(s => s.refId === 'REF-04')!.status).toBe('approved')
  })

  it('reports cost per approved asset', async () => {
    const c = await characterCosts(h.deps, h.ctx, characterId)
    expect(c.spentMicros).toBeGreaterThan(0)
    expect(c.heldMicros).toBe(0)
    expect(c.approvedAssets).toBeGreaterThanOrEqual(12)
    expect(c.costPerApproved).toMatch(/^\$/)
    expect(c.byStage.map(s => s.stage).sort()).toEqual(expect.arrayContaining(['breakdown', 'concepts', 'hero', 'qa', 'sheet']))
  })
})
