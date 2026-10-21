import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { createContent, duplicateContent, getContent, updateContent } from './content.js'
import { importPlan, planView } from './planImport.js'
import { applyResultsCsv, previewResultsCsv, resultsView, setPostResults } from './results.js'
import { PLAN_COLUMNS } from '../core/planImport.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { contentItems } from '../db/schema.js'
import type { PostResults } from '../core/results.js'

// Results (UX-PLAN.md section 32) on the server: typed on a post (never
// moving it up Posts home, never undone by an edit, never copied), pasted
// from a CSV by row_id (a free preview with matched, unmatched and
// ambiguous rows, then Apply), and the Results view with its hints.

let h: Harness
let callie: string
const results = async (id: string) => ((await getContent(h.deps, h.ctx, id)).spec as { results: PostResults | null }).results

// A small plan: two accounts (a topic account and Callie's), four rows.
function planCsv(rows: Array<Partial<Record<(typeof PLAN_COLUMNS)[number], string>>>): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [PLAN_COLUMNS.join(','), ...rows.map(r => PLAN_COLUMNS.map(c => q(r[c] ?? '')).join(','))].join('\n')
}
const row = (row_id: string, account: string, date: string, slot: string, o: Record<string, string> = {}) => ({
  row_id, date, slot, account, format: account === 'CALLIE' ? 'character slideshow' : 'slideshow story', hook: `${row_id} hook: the recruiter said friday`,
  slide_2: 'two', slide_3: 'three', slide_4: 'four', slide_5: 'five', slide_6: 'six', scene: 'A kitchen at night. Slide 1: phone on the counter. Slides 2 to 6: the sink and a kettle. Outfit: a gray hoodie', caption: `${row_id} caption`, hashtags: 'jobtok', ...o,
})

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  const csv = planCsv([
    row('R1', 'F2', '2026-10-19', 'AM', { structure: 'S3', moment_id: 'F2-M01' }),
    row('R2', 'F2', '2026-10-19', 'PM', { structure: 'S11', moment_id: 'F2-M02' }),
    row('R3', 'CALLIE', '2026-10-19', 'AM', { structure: 'S3', moment_id: 'C-M01' }),
    row('R4', 'CALLIE', '2026-10-20', 'Daily', { moment_id: 'C-M02' }),
  ])
  const r = await importPlan(h.deps, h.ctx, csv, { productId: null, rows: ['R1', 'R2', 'R3', 'R4'] })
  expect(r.created).toBe(4)
}, 180_000)

const byRow = async (id: string, account?: string) => (await planView(h.deps, h.ctx)).posts.find(p => p.rowId === id && (!account || p.account === account))!.id

describe('results on a post', () => {
  it('saves as typed without moving the post up Posts home; an edit in the workspace keeps them; Make another like this starts with none', async () => {
    const id = await byRow('R1')
    const before = await getContent(h.deps, h.ctx, id)
    h.clock.advance(60_000)
    await setPostResults(h.deps, h.ctx, id, { views72h: 12400, postedAt: '10/19/2026 9:14 PM' })
    await setPostResults(h.deps, h.ctx, id, { follows72h: 31, decision: 'keep', notes: 'strong open' })
    const after = await getContent(h.deps, h.ctx, id)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
    expect(await results(id)).toMatchObject({ views72h: 12400, follows72h: 31, postedAt: '2026-10-19T21:14', decision: 'keep', notes: 'strong open' })
    await updateContent(h.deps, h.ctx, id, { spec: { caption: 'edited in the workspace' } })
    expect((await results(id))?.views72h).toBe(12400)
    const copy = await duplicateContent(h.deps, h.ctx, id)
    expect((copy.spec as { results: unknown }).results).toBeNull()
    await h.deps.db.update(contentItems).set({ archivedAt: new Date() }).where(eq(contentItems.id, copy.id))
    await expect(setPostResults(h.deps, h.ctx, id, { postedAt: 'someday' })).rejects.toThrow(/not a date/)
    // Cleared by choosing none.
    await setPostResults(h.deps, h.ctx, id, { decision: null })
    expect((await results(id))?.decision).toBeNull()
  })
})

describe('the results CSV', () => {
  it('previews for free by row_id: matched posts, what changes, unmatched row_ids, unknown columns; Apply writes only the changes', async () => {
    const csv = 'row_id,views_72h,follows_72h,saves_72h,shares_72h,decision,posted_at,Watch time\nR1,12.4K,31,,,keep,,0:07\nR2,980,1,4,0,drop,2026-10-19 18:02,\nR9,5K,3,,,,,\nR3,"1,203",12,8,2,,2026-10-19T09:10,\n'
    const p = await previewResultsCsv(h.deps, h.ctx, csv)
    expect(p.problems).toEqual(['Columns not used: Watch time.'])
    expect(p.unmatched).toEqual(['R9'])
    const by = Object.fromEntries(p.rows.map(r => [r.key, r]))
    // R1 already has these numbers (typed above): only the decision changes.
    expect(by.R1).toMatchObject({ state: 'change', changes: [{ field: 'decision', from: '', to: 'Keep' }] })
    expect(by.R2).toMatchObject({ state: 'change', account: 'F2' })
    expect(by.R2!.changes.map(c => c.field)).toEqual(['postedAt', 'views72h', 'follows72h', 'saves72h', 'shares72h', 'decision'])
    expect(by.R3!.changes.find(c => c.field === 'views72h')).toEqual({ field: 'views72h', from: '', to: '1203' })
    expect(p.totals).toMatchObject({ rows: 4, matched: 3, change: 3, unmatched: 1 })
    // Nothing was written by the preview.
    expect(await results(await byRow('R2'))).toBeNull()
    const done = await applyResultsCsv(h.deps, h.ctx, csv)
    expect(done.updated).toBe(3)
    expect(await results(await byRow('R2'))).toMatchObject({ views72h: 980, follows72h: 1, saves72h: 4, shares72h: 0, decision: 'drop', postedAt: '2026-10-19T18:02' })
    const again = await previewResultsCsv(h.deps, h.ctx, csv)
    expect(again.rows.filter(r => r.state === 'same').map(r => r.key).sort()).toEqual(['R1', 'R2', 'R3'])
    await expect(applyResultsCsv(h.deps, h.ctx, 'row_id,views_72h\nR9,1\n')).rejects.toThrow(/Nothing to apply/)
  })

  it('a row_id two posts share is ambiguous until an account column picks one; post_id reaches a post with no plan row; a bad cell stops only its row', async () => {
    // The same row_id on another account (a second plan file).
    const other = planCsv([row('R1', 'CALLIE', '2026-10-21', 'AM')])
    await importPlan(h.deps, h.ctx, other, { productId: null, rows: ['R1'] })
    const p = await previewResultsCsv(h.deps, h.ctx, 'row_id,views_72h\nR1,1\n')
    expect(p.rows[0]).toMatchObject({ state: 'ambiguous' })
    expect(p.rows[0]!.accounts.sort()).toEqual(['CALLIE', 'F2'])
    const picked = await previewResultsCsv(h.deps, h.ctx, 'row_id,account,views_72h\nR1,CALLIE,77\n')
    expect(picked.rows[0]).toMatchObject({ state: 'change', account: 'CALLIE' })
    await h.deps.db.update(contentItems).set({ archivedAt: new Date() }).where(eq(contentItems.id, await byRow('R1', 'CALLIE')))
    const loose = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'callie.tiktok', spec: { hook: 'no plan row' } })
    const csv = `post_id,row_id,views_72h,follows_72h\n${loose.id},,2.5K,9\n,R4,lots,2\n`
    const byId = await previewResultsCsv(h.deps, h.ctx, csv)
    expect(byId.rows[0]).toMatchObject({ state: 'change', postId: loose.id })
    expect(byId.rows[1]).toMatchObject({ state: 'error' })
    expect(byId.rows[1]!.errors.join(' ')).toMatch(/"lots" is not a number/)
    await applyResultsCsv(h.deps, h.ctx, csv)
    expect(await results(loose.id)).toMatchObject({ views72h: 2500, follows72h: 9 })
    expect(await results(await byRow('R4'))).toBeNull()
  })
})

describe('the Results view', () => {
  it('totals and breakdowns by account, product, character and hook structure, follows per post first; a date range; the hints', async () => {
    const v = await resultsView(h.deps, h.ctx)
    // R1 (12.4K, 31), R2 (980, 1), R3 (1,203, 12), the loose post (2.5K, 9).
    expect(v.totals).toMatchObject({ posts: 4, views: 12400 + 980 + 1203 + 2500, follows: 53 })
    expect(v.totals.followsPerPost).toBe(13.3)
    expect(v.by.account.map(r => r.label)).toEqual(['F2', 'CALLIE', 'callie.tiktok'])
    expect(v.by.structure.map(r => [r.label, r.posts])).toEqual([['S3 Untold Story', 2], ['No structure', 1], ['S11 Contrast pair', 1]])
    expect(v.by.character.map(r => r.label)).toEqual(['No one (topic posts)', 'Callie'])
    expect(v.by.product.map(r => r.label)).toEqual(['No product'])
    const day = await resultsView(h.deps, h.ctx, { from: '2026-10-19', to: '2026-10-19' })
    expect(day.totals.posts).toBe(3)
    expect(day.undated).toBe(1)
    const f2 = await resultsView(h.deps, h.ctx, { accountTag: 'F2' })
    expect(f2.totals.posts).toBe(2)

    // A 50K post, and a hook family under 1K twice (R2 and a copy that shares its moment).
    const r2 = await byRow('R2')
    const copy = await duplicateContent(h.deps, h.ctx, r2)
    await setPostResults(h.deps, h.ctx, copy.id, { views72h: 450 })
    await setPostResults(h.deps, h.ctx, await byRow('R3'), { views72h: 51000 })
    const hv = await resultsView(h.deps, h.ctx)
    expect(hv.hints[await byRow('R3')]).toEqual([{ kind: 'variations', text: '50K+ views: make 3 variations' }])
    expect(hv.hints[r2]?.[0]).toMatchObject({ kind: 'drop', text: 'Under 1K twice: drop the hook family' })
    expect(hv.hints[copy.id]?.[0]?.kind).toBe('drop')
    expect(hv.hinted.map(x => x.id)).toContain(await byRow('R3'))
    // Archived posts are out.
    await h.deps.db.update(contentItems).set({ archivedAt: new Date() }).where(eq(contentItems.id, copy.id))
    expect((await resultsView(h.deps, h.ctx)).hints[r2]).toBeUndefined()
  })
})
