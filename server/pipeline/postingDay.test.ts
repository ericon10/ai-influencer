import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { importCharacter } from './files.js'
import { createContent, getContent } from './content.js'
import { importPlan, planView } from './planImport.js'
import { setPostResults } from './results.js'
import { dayView, saveSlotTimes, setPosting, startPack } from './postingDay.js'
import { PLAN_COLUMNS } from '../core/planImport.js'
import { readPosting } from '../core/postingDay.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { readAsset } from '../storage/assets.js'
import { jobs } from '../db/schema.js'

// Download day (UX-PLAN.md section 33) in demo mode: a small plan with two
// accounts and two slots, the stills made with the mock, two posts
// approved; the free preview in posting order with each reason; the zip
// made on the worker (folders, numbered slides, caption.txt, post.json,
// checklist.txt, left-out.txt), the approved posts exported first; packed
// posts left out of the next zip unless asked for.

let h: Harness
let callie: string
const DAY = '2031-05-04'
const TZ = 'UTC'

function planCsv(rows: Array<Partial<Record<(typeof PLAN_COLUMNS)[number], string>>>): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [PLAN_COLUMNS.join(','), ...rows.map(r => PLAN_COLUMNS.map(c => q(r[c] ?? '')).join(','))].join('\n')
}
const row = (row_id: string, account: string, date: string, slot: string, o: Record<string, string> = {}) => ({
  row_id, date, slot, account, format: 'slideshow story', hook: `${row_id} the recruiter said friday`,
  slide_2: 'two', slide_3: 'three', slide_4: 'four', slide_5: 'five', slide_6: 'six', scene: 'An office at night. Slide 1: a laptop. Slides 2 to 6: the desk lamp and a mug', caption: `${row_id} caption`, hashtags: 'jobtok', ...o,
})
const byRow = async (id: string) => (await planView(h.deps, h.ctx)).posts.find(p => p.rowId === id)!.id
async function pack(o: { includePacked?: boolean } = {}) {
  const { jobId } = await startPack(h.deps, h.ctx, { date: DAY, tz: TZ, ...o })
  await drain(h, 120)
  const [job] = await h.deps.db.select().from(jobs).where(eq(jobs.id, jobId))
  expect(job!.status, JSON.stringify(job!.error)).toBe('completed')
  const data = (job!.resultMeta as { data: { assetId: string } }).data
  const files = unzipSync(new Uint8Array((await readAsset(h.deps, h.ctx, data.assetId)).data))
  return { jobId, assetId: data.assetId, files, text: (p: string) => Buffer.from(files[p]!).toString('utf8') }
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  const csv = planCsv([
    row('D1', 'DA', DAY, 'AM'), row('D2', 'DA', DAY, 'PM'), row('D3', 'DB', DAY, 'AM', { ad: 'yes' }), row('D4', 'DB', DAY, 'PM', { ad: 'yes' }),
    row('D5', 'DA', '2031-05-05', 'AM'),
  ])
  expect((await importPlan(h.deps, h.ctx, csv, { productId: null, rows: ['D1', 'D2', 'D3', 'D4', 'D5'] })).created).toBe(5)
  // The stills for D1, D2 and D4 (the mock); D3 keeps none.
  const action = { type: 'plan_generate' as const, postIds: [await byRow('D1'), await byRow('D2'), await byRow('D4')] }
  const { quote } = await estimateAction(h.deps, h.ctx, action)
  await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 200)
  expect((await planView(h.deps, h.ctx)).posts.filter(p => ['D1', 'D2', 'D4'].includes(p.rowId)).every(p => p.have === p.need)).toBe(true)
}, 300_000)

describe('Download day', () => {
  it('the preview (free): the day\'s posts in posting order, each in or left out with the reason', async () => {
    await setPosting(h.deps, h.ctx, await byRow('D1'), { approved: true })
    await setPosting(h.deps, h.ctx, await byRow('D4'), { approved: true })
    await setPosting(h.deps, h.ctx, await byRow('D3'), { approved: true })
    const v = await dayView(h.deps, h.ctx, { date: DAY, tz: TZ })
    expect(v.slots).toEqual([{ slot: 'AM', time: '09:00' }, { slot: 'Daily', time: '12:00' }, { slot: 'PM', time: '18:00' }])
    expect(v.rows.map(r => [r.rowId, r.account, r.time, r.in])).toEqual([['D1', 'DA', '09:00', true], ['D3', 'DB', '09:00', false], ['D2', 'DA', '18:00', false], ['D4', 'DB', '18:00', true]])
    const by = Object.fromEntries(v.rows.map(r => [r.rowId, r]))
    expect(by.D3!.reason).toMatch(/^Missing pictures: Slides? 1.*need a picture/)
    expect(by.D2!.reason).toBe('Not approved for posting')
    expect(by.D1).toMatchObject({ folder: 'DA/1-AM-0900', exportFirst: true, ad: false })
    expect(by.D4).toMatchObject({ folder: 'DB/1-PM-1800', exportFirst: true, ad: true })
    expect(v.counts).toEqual({ in: 2, out: 2, exportFirst: 2 })
    // Another day's post is not on this day.
    expect(v.rows.some(r => r.rowId === 'D5')).toBe(false)
  })

  it('the zip: exported first, a folder per account and slot, numbered slides, caption.txt, post.json, checklist.txt, left-out.txt; each post marked packed', async () => {
    await setPostResults(h.deps, h.ctx, await byRow('D1'), { notes: 'kept with the post' })
    const z = await pack()
    const names = Object.keys(z.files).sort()
    expect(names).toEqual([
      `${DAY}/DA/1-AM-0900/01.jpg`, `${DAY}/DA/1-AM-0900/02.jpg`, `${DAY}/DA/1-AM-0900/03.jpg`, `${DAY}/DA/1-AM-0900/04.jpg`, `${DAY}/DA/1-AM-0900/05.jpg`, `${DAY}/DA/1-AM-0900/06.jpg`,
      `${DAY}/DA/1-AM-0900/caption.txt`, `${DAY}/DA/1-AM-0900/post.json`,
      `${DAY}/DB/1-PM-1800/01.jpg`, `${DAY}/DB/1-PM-1800/02.jpg`, `${DAY}/DB/1-PM-1800/03.jpg`, `${DAY}/DB/1-PM-1800/04.jpg`, `${DAY}/DB/1-PM-1800/05.jpg`, `${DAY}/DB/1-PM-1800/06.jpg`,
      `${DAY}/DB/1-PM-1800/caption.txt`, `${DAY}/DB/1-PM-1800/post.json`,
      `${DAY}/checklist.txt`, `${DAY}/left-out.txt`,
    ])
    // 1080 x 1920 JPEGs.
    expect(Buffer.from(z.files[`${DAY}/DA/1-AM-0900/01.jpg`]!).subarray(0, 2).toString('hex')).toBe('ffd8')
    const checklist = z.text(`${DAY}/checklist.txt`).trim().split('\n').filter(l => l.startsWith('[ ]'))
    expect(checklist).toEqual([
      '[ ] 1. DA | 09:00 (AM) | Hook: "D1 the recruiter said friday" | Ad: no | AI-generated label: on | DA/1-AM-0900/',
      '[ ] 2. DB | 18:00 (PM) | Hook: "D4 the recruiter said friday" | Ad: yes | AI-generated label: on | DB/1-PM-1800/',
    ])
    const left = z.text(`${DAY}/left-out.txt`)
    expect(left).toContain('Left out of Download day 2031-05-04: 2 posts.')
    expect(left).toMatch(/DB \| 09:00 \(AM\) \| Hook: "D3 the recruiter said friday" \| Missing pictures/)
    expect(left).toContain('DA | 18:00 (PM) | Hook: "D2 the recruiter said friday" | Not approved for posting')
    // caption.txt is the caption as posted ("Ad:" first on an ad); post.json the export's, with results and posting.
    expect(z.text(`${DAY}/DB/1-PM-1800/caption.txt`)).toMatch(/^Ad: D4 caption/)
    const json = JSON.parse(z.text(`${DAY}/DB/1-PM-1800/post.json`))
    expect(json.caption.as_posted).toBe(z.text(`${DAY}/DB/1-PM-1800/caption.txt`).trimEnd())
    expect(json.plan.row_id).toBe('D4')
    expect(json.posting).toMatchObject({ date: DAY, slot: 'PM', slot_time: '18:00', folder: 'DB/1-PM-1800', pack_id: z.jobId, ai_label: 'on' })
    expect(JSON.parse(z.text(`${DAY}/DA/1-AM-0900/post.json`)).results).toMatchObject({ notes: 'kept with the post' })
    // Exported first, and packed.
    for (const id of [await byRow('D1'), await byRow('D4')]) {
      const post = await getContent(h.deps, h.ctx, id)
      expect(post.status).toBe('ready')
      expect(readPosting((post.spec as { posting?: unknown }).posting).packed).toMatchObject({ packId: z.jobId, date: DAY, assetId: z.assetId })
    }
    const v = await dayView(h.deps, h.ctx, { date: DAY, tz: TZ })
    expect(v.packs[0]).toMatchObject({ id: z.jobId, date: DAY, assetId: z.assetId, posts: 2, leftOut: 2, status: 'completed' })
  })

  it('a second zip leaves the packed posts out ("Already packed") unless asked; it never packs twice by accident', async () => {
    const v = await dayView(h.deps, h.ctx, { date: DAY, tz: TZ })
    expect(v.rows.filter(r => r.reasonKind === 'packed').map(r => r.rowId).sort()).toEqual(['D1', 'D4'])
    expect(v.rows.find(r => r.rowId === 'D1')!.reason).toMatch(/^Already packed \(/)
    await expect(startPack(h.deps, h.ctx, { date: DAY, tz: TZ })).rejects.toThrow(/Nothing to pack/)
    await setPosting(h.deps, h.ctx, await byRow('D2'), { approved: true })
    const z = await pack()
    expect(Object.keys(z.files).filter(f => f.endsWith('post.json'))).toEqual([`${DAY}/DA/1-PM-1800/post.json`])
    expect(z.text(`${DAY}/left-out.txt`)).toMatch(/DA \| 09:00 \(AM\) \| Hook: "D1 the recruiter said friday" \| Already packed/)
    const again = await pack({ includePacked: true })
    expect(Object.keys(again.files).filter(f => f.endsWith('post.json')).sort()).toEqual([`${DAY}/DA/1-AM-0900/post.json`, `${DAY}/DA/2-PM-1800/post.json`, `${DAY}/DB/1-PM-1800/post.json`])
  })

  it('slot times are a setting (the folders follow them); a post\'s own day and slot; a video post with no clip is left out; a batch is not a day\'s post', async () => {
    await saveSlotTimes(h.deps, h.ctx, { AM: '08:30', PM: '17:45', Daily: '12:00' })
    const v = await dayView(h.deps, h.ctx, { date: DAY, includePacked: true, tz: TZ })
    expect(v.rows.find(r => r.rowId === 'D1')).toMatchObject({ time: '08:30', folder: 'DA/1-AM-0830' })
    await expect(saveSlotTimes(h.deps, h.ctx, { AM: '9am' })).rejects.toThrow(/not a time/)
    // Moved to this day by hand, at Daily.
    await setPosting(h.deps, h.ctx, await byRow('D5'), { date: DAY, slot: 'Daily', approved: true })
    const meme = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'DA', spec: { caption: 'a video with no clip yet' } })
    await setPosting(h.deps, h.ctx, meme.id, { date: DAY, slot: 'PM', approved: true })
    const w = await dayView(h.deps, h.ctx, { date: DAY, includePacked: true, tz: TZ })
    // On this day now, at Daily's time (left out: its stills were never made).
    expect(w.rows.find(r => r.rowId === 'D5')).toMatchObject({ slot: 'Daily', time: '12:00', in: false, reasonKind: 'missing' })
    expect(w.rows.find(r => r.id === meme.id)).toMatchObject({ in: false, reasonKind: 'missing', reason: 'Missing pictures: the clip (Video step)' })
    const batch = await createContent(h.deps, h.ctx, { kind: 'batch', characterId: callie, accountTag: 'DA' })
    await expect(setPosting(h.deps, h.ctx, batch.id, { approved: true })).rejects.toThrow(/A batch is many videos/)
    await expect(setPosting(h.deps, h.ctx, meme.id, { date: '05/04/2031' })).rejects.toThrow(/not a day/)
  })
})
