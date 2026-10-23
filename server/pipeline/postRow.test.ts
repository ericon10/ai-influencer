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

// Who and what first (UX-PLAN.md section 45): lines are scoped to the post's
// product and the character's voice; the slot's 3 best fits; an honest empty
// bank; changing the product clears the line; a Weeks row with no product is
// flagged and skipped by Fill.
describe('who and what first', () => {
  let callie: string, sideStep: string
  beforeAll(async () => {
    const { importCharacter } = await import('./files.js')
    const { renderPlaceholderPortrait } = await import('../providers/mock.js')
    const { importKit, starterKit } = await import('./scaleKit.js')
    const { setStance } = await import('./lineBank.js')
    const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
    const images: Record<string, { data: Buffer }> = {}
    for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
    callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
    sideStep = (await importKit(h.deps, h.ctx, starterKit(), 'SideStep')).product.id
    await setStance(h.deps, h.ctx, callie, 'secondhand')
    const line = (id: string, text: string, fits: 'first' | 'secondhand' | 'both', likes: number, productId: string | null) => ({ id, accountId: h.ctx.accountId, importId: 'bim_who', productId, comment: text, likes, state: 'written', passed: true, line: text, source: 'comment', lifeOrJob: 'job', tags: { emotion: 'sad', topic: '', pain: 'ghosted', fits, format: 'finished damage', fight: false, fightReason: '' } })
    await h.deps.db.insert(bankLines).values([
      line('bl_ss_first', 'they ghosted me after round four', 'first', 700, sideStep),
      line('bl_ss_2nd_a', 'my roommate got ghosted after four rounds', 'secondhand', 690, sideStep),
      line('bl_ss_2nd_b', 'my sister heard nothing for six weeks', 'secondhand', 680, sideStep),
      line('bl_ss_both', 'the recruiter said soon in march', 'both', 670, sideStep),
      line('bl_ss_2nd_c', 'my friend redid the same test three times', 'secondhand', 660, sideStep),
    ])
  }, 180_000)

  it('Callie and No product: no SideStep lines, an honest empty bank', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'callie_who_01', spec: { picks: { character: true, product: true } } })).id
    const p = await linePicks(h.deps, h.ctx, post, {})
    expect(p.product).toBeNull()
    expect(p.lines.filter(l => l.id.startsWith('bl_ss_'))).toEqual([])
    expect(p.best.filter(l => l.id.startsWith('bl_ss_'))).toEqual([])
    await expect(setPostLine(h.deps, h.ctx, post, { lineId: 'bl_ss_2nd_a' })).rejects.toThrow(/tagged for another product/)
  })

  it('Callie and SideStep: only secondhand (or both) lines, the 3 best in the slot, exact voice first', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'callie_who_01', productId: sideStep })).id
    const p = await linePicks(h.deps, h.ctx, post, {})
    expect(p.product?.name).toBe('SideStep')
    expect(p.stance).toBe('secondhand')
    expect(p.lines.map(l => l.id)).toEqual(['bl_ss_2nd_a', 'bl_ss_2nd_b', 'bl_ss_both', 'bl_ss_2nd_c'])
    expect(p.best.map(l => l.id)).toEqual(['bl_ss_2nd_a', 'bl_ss_2nd_b', 'bl_ss_2nd_c'])
    expect((await linePicks(h.deps, h.ctx, post, { q: 'sister' })).lines.map(l => l.id)).toEqual(['bl_ss_2nd_b'])
  })

  it('changing the product clears the line and frees the bank line', async () => {
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'callie_who_01', productId: sideStep })).id
    await setPostLine(h.deps, h.ctx, post, { lineId: 'bl_ss_2nd_c' })
    const { updateContent } = await import('./content.js')
    await updateContent(h.deps, h.ctx, post, { productId: null })
    const after = await getContent(h.deps, h.ctx, post)
    expect((after.spec as { caption: string }).caption).toBe('')
    expect((await postRow(h.deps, h.ctx, post)).line).toMatchObject({ mode: null, text: '', id: null })
    const [l] = await h.deps.db.select().from(bankLines).where(eq(bankLines.id, 'bl_ss_2nd_c'))
    expect(l!.usedPostId).toBeNull()
  })

  it('a Weeks row with no product is flagged at import and skipped by Fill; "none" is No product', async () => {
    const { previewWeek, importWeek, drawWeek, NO_PRODUCT } = await import('./weeks.js')
    await saveSocialAccount(h.deps, h.ctx, 'callie_who_wk', { characterId: callie })
    const csv = 'row_id,account,date,slot,post_type,product,outfit,scene\nNP1,callie_who_wk,2027-05-03,1,clip,,gray hoodie,her kitchen\nNP2,callie_who_wk,2027-05-04,1,clip,none,gray hoodie,her kitchen\nNP3,callie_who_wk,2027-05-05,1,clip,SideStep,gray hoodie,her kitchen\n'
    const pv = await previewWeek(h.deps, h.ctx, csv)
    expect(pv.rows.find(r => r.rowId === 'NP1')!.warnings).toContain(NO_PRODUCT)
    expect(pv.rows.find(r => r.rowId === 'NP2')!.warnings).not.toContain(NO_PRODUCT)
    const r = await importWeek(h.deps, h.ctx, csv, { rows: ['NP1', 'NP2', 'NP3'] })
    const id = (row: string) => r.posts.find(x => x.rowId === row)!.id
    expect((await getContent(h.deps, h.ctx, id('NP1'))).productId).toBeNull()
    expect((await getContent(h.deps, h.ctx, id('NP3'))).productId).toBe(sideStep)
    const v = await weekView(h.deps, h.ctx, '2027-05-03')
    expect(v.cells.find(c => c.rowId === 'NP1')!.fillFlag).toBe(NO_PRODUCT)
    const draw = await drawWeek(h.deps, h.ctx, '2027-05-03', { seed: 3, redraw: 'empty' })
    expect(draw.rows.map(x => x.rowId).sort()).toEqual(['NP2', 'NP3'])
    // NP3 draws only SideStep lines in Callie's voice.
    const np3 = draw.rows.find(x => x.rowId === 'NP3')!
    if (np3.lineId) expect(['bl_ss_2nd_a', 'bl_ss_2nd_b', 'bl_ss_both']).toContain(np3.lineId)
  })
})
