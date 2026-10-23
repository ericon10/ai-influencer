import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { createFacelessCharacter, importPlaces } from './faceless.js'
import { saveSocialAccount } from './scaleKit.js'
import { createContent, getContent } from './content.js'
import { addToWeek, linePicks, placeSuggestions, postRow, setPostLine, usePlace } from './postRow.js'
import { checkWeek, weekView } from './weeks.js'
import { bankLines } from '../db/schema.js'

// Line first, both doors (UX-PLAN.md section 43) in demo mode: a New post
// for Doug picks a money line from the bank, gets the gas station first,
// reuses the place's still for $0, joins a week as a row, and its row shows
// the line, the place and the still. A No line post is never flagged.

let h: Harness
let doug: string
const TAG = 'doug_np_01'

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  doug = (await createFacelessCharacter(h.deps, h.ctx, { name: '', template: 'doug' })).id
  await importPlaces(h.deps, h.ctx, doug, readFileSync(join(process.cwd(), 'docs', 'content', 'doug-places.csv'), 'utf8'))
  await saveSocialAccount(h.deps, h.ctx, TAG, { characterId: doug })
  await h.deps.db.insert(bankLines).values([
    { id: 'bl_money', accountId: h.ctx.accountId, importId: 'bim_t', comment: 'rent went up 400 and my checking says 12', likes: 900, state: 'written', passed: true, line: 'rent went up $400 and i have $12', source: 'comment', lifeOrJob: 'job', tags: { emotion: 'sad', topic: '', pain: 'rent', fits: 'first', format: 'finished damage', fight: false, fightReason: '' } },
    { id: 'bl_second', accountId: h.ctx.accountId, importId: 'bim_t', comment: 'my sister got ghosted', likes: 800, state: 'written', passed: true, line: 'my sister got ghosted after 4 rounds', source: 'comment', lifeOrJob: 'job', tags: { emotion: 'angry', topic: '', pain: 'ghosted', fits: 'secondhand', format: 'meme setup', fight: false, fightReason: '' } },
    { id: 'bl_used', accountId: h.ctx.accountId, importId: 'bim_t', comment: 'x', likes: 950, state: 'written', passed: true, line: 'they paid me in exposure', source: 'comment', lifeOrJob: 'job', usedAccountTag: 'someone_else', usedPostId: 'ci_somewhere_else', tags: { emotion: 'angry', topic: '', pain: 'lowball pay', fits: 'both', format: 'meme setup', fight: false, fightReason: '' } },
  ])
}, 180_000)

describe('a New post for Doug, line first', () => {
  let post: string
  it('the line pick: only lines in his voice, none used on another account', async () => {
    post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: doug, accountTag: TAG, spec: { faceless: { posted: false } } })).id
    const p = await linePicks(h.deps, h.ctx, post, {})
    expect(p.stance).toBe('first')
    expect(p.lines.map(l => l.id)).toEqual(['bl_money'])
    expect(p.hidden).toBe(1)
    expect(p.otherVoice).toBe(1)
  })
  it('picking it: on screen, the caption filled, the bank line used on this account; the row shows pain and source', async () => {
    const r = await setPostLine(h.deps, h.ctx, post, { lineId: 'bl_money' })
    expect(r.line).toMatchObject({ id: 'bl_money', text: 'rent went up $400 and i have $12', mode: 'bank', pain: 'rent', emotion: 'sad', source: 'comment' })
    expect(r.caption).toBe('rent went up $400 and i have $12')
    const [l] = await h.deps.db.select().from(bankLines).where(eq(bankLines.id, 'bl_money'))
    expect(l!.usedPostId).toBe(post)
    expect(l!.usedAccountTag).toBe(TAG)
  })
  it('the visual: a gas station place first for a money line, its still on Higgsfield', async () => {
    const s = await placeSuggestions(h.deps, h.ctx, post)
    expect(s.faceless).toBe(true)
    expect(s.places[0]!.scene).toMatch(/gas station/i)
    expect(s.places[0]!.why).toMatch(/money/)
    expect(s.places[0]!.still).toEqual({ assetId: null, from: 'higgsfield' })
  })
  it('Reuse this still: pulled free, kept as the place\'s, so the next post reuses it at once ($0)', async () => {
    const first = (await placeSuggestions(h.deps, h.ctx, post)).places[0]!
    const r = await usePlace(h.deps, h.ctx, post, { placeId: first.id, reuse: true })
    expect(r.still).toBe('pulling')
    await drain(h)
    const row = await postRow(h.deps, h.ctx, post)
    expect(row.place?.id).toBe(first.id)
    expect(row.stillAssetId).toBeTruthy()
    expect(row.stillFrom).toBe('place')
    const spec = (await getContent(h.deps, h.ctx, post)).spec as { faceless: { videoPrompt: string } }
    expect(spec.faceless.videoPrompt).toBe(first.motion)
    // A second post on the same place: the Studio's still, attached at once.
    const next = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: doug, accountTag: TAG, spec: { caption: 'gas is $4.10 again', faceless: { posted: false } } })).id
    const s2 = await placeSuggestions(h.deps, h.ctx, next)
    expect(s2.places.find(p => p.id === first.id)!.still).toEqual({ assetId: row.stillAssetId, from: 'studio' })
    expect((await usePlace(h.deps, h.ctx, next, { placeId: first.id, reuse: true })).still).toBe('attached')
    expect((await postRow(h.deps, h.ctx, next)).stillAssetId).toBe(row.stillAssetId)
  })
  it('Add to a week: the same record as a Weeks row', async () => {
    const r = await addToWeek(h.deps, h.ctx, post, { accountTag: TAG, date: '2027-02-02', slot: 2 })
    expect(r.week).toBe('2027-02-01')
    expect(r.rowId).toMatch(/^NP/)
    const v = await weekView(h.deps, h.ctx, '2027-02-01')
    const cell = v.cells.find(c => c.postId === post)!
    expect(cell).toMatchObject({ rowId: r.rowId, account: TAG, slot: 2, postType: 'faceless', lineId: 'bl_money', stillFrom: 'place', have: 1 })
    expect(cell.placeId).toBe(r.row.place!.id)
  })
  it('No line: a visual post, never flagged No line by Check', async () => {
    const id = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: doug, accountTag: TAG, spec: { faceless: { posted: false, placeId: 'IS015' } } })).id
    const r = await setPostLine(h.deps, h.ctx, id, { none: true })
    expect(r.line.mode).toBe('none')
    await addToWeek(h.deps, h.ctx, id, { accountTag: TAG, date: '2027-02-03', slot: 1 })
    await checkWeek(h.deps, h.ctx, '2027-02-01')
    const cell = (await weekView(h.deps, h.ctx, '2027-02-01')).cells.find(c => c.postId === id)!
    expect(cell.lineNone).toBe(true)
    expect(cell.flags).not.toContain('No line')
  })
})
