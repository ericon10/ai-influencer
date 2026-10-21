import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { createFacelessCharacter } from './faceless.js'
import { saveSocialAccount } from './scaleKit.js'
import { importFacelessPlan, previewFacelessPlan } from './facelessImport.js'
import { getContent } from './content.js'
import { planView } from './planImport.js'
import { estimateAction } from './actions.js'
import { csvKind } from '../core/csvImport.js'

// A faceless account's plan CSV (owner, 2026-10-22; UX-PLAN.md section 35,
// item 4g), with a 3-row sample made for the test (never a real post file):
// the rows go to Doug through his account, a row with still_job_id lands
// with that Higgsfield still attached, an import again asks Replace or Add.

let h: Harness
let doug: string
let csv: string
beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  doug = (await createFacelessCharacter(h.deps, h.ctx, { name: '', template: 'doug' })).id
  await saveSocialAccount(h.deps, h.ctx, 'doug.tiktok', { characterId: doug })
  // A finished still in the (mock) Higgsfield account, to pull by its job id.
  const adapter = await h.deps.providers.gen(h.ctx.accountId, 'mock/image', { billing: 'api' })
  const { jobId } = await adapter.submit({ kind: 'image', model: 'mock/image', prompt: 'a gas station at dusk' }, { idempotencyKey: 'faceless-test' })
  csv = readFileSync(join(process.cwd(), 'fixtures', 'faceless', 'sample-3-rows.csv'), 'utf8').replace('JOB_FROM_TEST', jobId)
}, 60_000)

describe('faceless plan import', () => {
  it('is read as a faceless plan and routes to the account\'s faceless character (free preview)', async () => {
    expect(csvKind(csv)).toBe('faceless')
    const p = await previewFacelessPlan(h.deps, h.ctx, csv)
    expect(p.character).toEqual({ id: doug, name: 'Doug' })
    expect(p.accountTag).toBe('doug.tiktok')
    expect(p.rows.map(r => [r.rowId, r.state, r.still])).toEqual([['DG01', 'new', null], ['DG02', 'new', null], ['DG03', 'new', 'job']])
    // The line lint on the hook (DG02 has no clear emotion).
    expect(p.rows[1]!.lint.join(' ')).toMatch(/No clear emotion/)
  })

  it('imports drafts with the row\'s words; the still_job_id row has its still; Generate makes the others\' stills', async () => {
    const r = await importFacelessPlan(h.deps, h.ctx, csv, { rows: ['DG01', 'DG02', 'DG03'] })
    expect(r).toMatchObject({ created: 3, replaced: 0, stills: 1, stillProblems: [] })
    const dg1 = await getContent(h.deps, h.ctx, r.posts[0]!.id)
    expect(dg1).toMatchObject({ kind: 'meme', characterId: doug, accountTag: 'doug.tiktok' })
    const s1 = dg1.spec as { caption: string; faceless: { line: string; videoPrompt: string; postCaption: string; hashtags: string[]; voiceover: { search: string } } }
    expect(s1.caption).toBe('so angry they replaced me with a spreadsheet macro')
    expect(s1.faceless).toMatchObject({ videoPrompt: 'rain runs down the windshield, wipers off, the light barely changes', postCaption: 'four years of data entry. one macro.', hashtags: ['laidoff', 'peoria', 'jobhunt'], voiceover: { search: 'it is what it is' } })
    const dg3 = await getContent(h.deps, h.ctx, r.posts[2]!.id)
    expect((dg3.spec as { stillId: string | null; faceless: { stillAssetId?: string } }).faceless.stillAssetId).toMatch(/^ast_/)
    const plan = (await planView(h.deps, h.ctx)).posts.filter(p => p.account === 'doug.tiktok')
    expect(plan.map(p => [p.rowId, p.have, p.need])).toEqual([['DG01', 0, 1], ['DG02', 0, 1], ['DG03', 1, 1]])
    const gen = await estimateAction(h.deps, h.ctx, { type: 'plan_generate', postIds: plan.filter(p => p.have < p.need).map(p => p.id) })
    expect(gen.preview.title).toMatch(/^Generate 2 posts: 2 stills/)
    await drain(h, 5)
  })

  it('an import again asks Replace or Add as new', async () => {
    await expect(importFacelessPlan(h.deps, h.ctx, csv, { rows: ['DG01'] })).rejects.toThrow(/1 row matches posts you already have/)
    expect((await importFacelessPlan(h.deps, h.ctx, csv, { rows: ['DG01'], existing: 'replace' })).replaced).toBe(1)
  })
})
