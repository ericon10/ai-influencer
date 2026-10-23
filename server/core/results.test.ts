import { describe, expect, it } from 'vitest'
import {
  aggregateResults, dropHint, emptyResults, hookFamilies, readCount, readDecision, readPostedAt, readResultsCsv, resultChanges, resultHints,
  shortCount, variationsHint, type PostResults, type ResultPost,
} from './results.js'
import { resultsJson, videoPostExportJson } from './postExport.js'

describe('post.json', () => {
  it('carries the results under "results", named as the CSV names them; null until any is typed', () => {
    expect(resultsJson(null)).toBeNull()
    expect(resultsJson(emptyResults())).toBeNull()
    const j = videoPostExportJson({
      post: { id: 'cnt_1', kind: 'meme', title: '', idea: '', accountTag: 'F2', characterId: null, characterName: null, variationOf: null, batchOf: null, createdAt: 'a', updatedAt: 'b' },
      video: { file: 'v.mp4', assetId: 'ast_1', durationSec: 8, onScreenText: 'x', captionOff: false },
      caption: { text: '', hashtags: [], ctaLine: '', ad: false, asPosted: '' },
      plan: null, aiLabel: 'Label all posts as AI-generated', exportedAt: 'now',
      results: { ...emptyResults(), postUrl: 'https://t/1', postedAt: '2026-10-19T21:14', views72h: 12400, follows72h: 31, decision: 'variations', updatedAt: 'then' },
    }) as Record<string, any>
    expect(j.results).toEqual({ post_url: 'https://t/1', posted_at: '2026-10-19T21:14', views_72h: 12400, follows_72h: 31, saves_72h: null, shares_72h: null, decision: 'variations', notes: null, updated_at: 'then' })
  })
})

// Results (UX-PLAN.md section 32): the readers for typed and pasted
// numbers and dates, the CSV by row_id, the totals and breakdowns (follows
// per post first), and the decision hints. Pure.

const r = (o: Partial<PostResults>): PostResults => ({ ...emptyResults(), ...o })
const T = { variationsViews: 50000, variationsCount: 3, dropViews: 1000, dropPosts: 2 }

describe('reading numbers', () => {
  it('reads K and M, thousands commas, spaces and plain numbers', () => {
    expect(readCount('12.4K')).toEqual({ value: 12400 })
    expect(readCount('12.4k')).toEqual({ value: 12400 })
    expect(readCount('1,203')).toEqual({ value: 1203 })
    expect(readCount('12,400,000')).toEqual({ value: 12400000 })
    expect(readCount('1.2M')).toEqual({ value: 1200000 })
    expect(readCount('3 400')).toEqual({ value: 3400 })
    expect(readCount(' 980 ')).toEqual({ value: 980 })
    expect(readCount('+31')).toEqual({ value: 31 })
    expect(readCount('2.5')).toEqual({ value: 3 })
    expect(readCount('')).toEqual({ value: undefined })
  })
  it('refuses what is not a count', () => {
    expect(readCount('abc')).toHaveProperty('error')
    expect(readCount('12,4K')).toHaveProperty('error')
    expect(readCount('-5')).toHaveProperty('error')
    expect(readCount('1.2.3')).toHaveProperty('error')
  })
})

describe('reading posted_at', () => {
  it('reads ISO and common forms, keeping the time as written', () => {
    expect(readPostedAt('2026-10-19T21:14')).toBe('2026-10-19T21:14')
    expect(readPostedAt('2026-10-19 21:14:05')).toBe('2026-10-19T21:14')
    expect(readPostedAt('2026-10-19T21:14:00Z')).toBe('2026-10-19T21:14')
    expect(readPostedAt('2026-10-19T21:14:00.000-04:00')).toBe('2026-10-19T21:14')
    expect(readPostedAt('2026-10-19')).toBe('2026-10-19')
    expect(readPostedAt('10/19/2026 9:14 PM')).toBe('2026-10-19T21:14')
    expect(readPostedAt('10/19/26 9:14pm')).toBe('2026-10-19T21:14')
    expect(readPostedAt('19/10/2026 21:14')).toBe('2026-10-19T21:14')
    expect(readPostedAt('19.10.2026 21:14')).toBe('2026-10-19T21:14')
    expect(readPostedAt('Oct 19, 2026 9:14 PM')).toBe('2026-10-19T21:14')
    expect(readPostedAt('October 19 2026')).toBe('2026-10-19')
    expect(readPostedAt('19 Oct 2026 21:14')).toBe('2026-10-19T21:14')
    expect(readPostedAt('Mon, Oct 19, 2026 at 9am')).toBe('2026-10-19T09:00')
    expect(readPostedAt('12:30 AM'.replace(/^/, '2026-10-19 '))).toBe('2026-10-19T00:30')
  })
  it('refuses what is not a date', () => {
    expect(readPostedAt('yesterday')).toBeNull()
    expect(readPostedAt('2026-02-30')).toBeNull()
    expect(readPostedAt('13/13/2026')).toBeNull()
    expect(readPostedAt('2026-10-19 25:00')).toBeNull()
    expect(readPostedAt('')).toBeNull()
  })
})

describe('reading the decision', () => {
  it('reads the four decisions and none', () => {
    expect(readDecision('Make 3 variations')).toEqual({ value: 'variations' })
    expect(readDecision('variations')).toEqual({ value: 'variations' })
    expect(readDecision('KEEP')).toEqual({ value: 'keep' })
    expect(readDecision('One more try')).toEqual({ value: 'retry' })
    expect(readDecision('try again')).toEqual({ value: 'retry' })
    expect(readDecision('Drop')).toEqual({ value: 'drop' })
    expect(readDecision('none')).toEqual({ value: null })
    expect(readDecision('')).toEqual({ value: undefined })
    expect(readDecision('boost it')).toHaveProperty('error')
  })
})

describe('the results CSV', () => {
  it('reads by header name in any order, with K numbers, dates, unknown columns named and ignored', () => {
    const csv = [
      'Views,row_id,Follows_72h,posted_at,decision,notes,Watch time,saves_72h,shares_72h,post_url',
      '12.4K,P001,31,10/19/2026 9:14 PM,Make 3 variations,"strong, keep going",0:07,1203,88,https://www.tiktok.com/@x/photo/1',
      '980,P002,,,,,,,,',
      ',,,,,,,,,',
      'lots,P003,1,someday,boost,,,,,',
    ].join('\n')
    const out = readResultsCsv(csv)
    expect(out.missing).toEqual([])
    expect(out.unknown).toEqual(['Watch time'])
    expect(out.rows).toHaveLength(3)
    expect(out.rows[0]).toMatchObject({ line: 2, rowId: 'P001', postId: '', errors: [], patch: { views72h: 12400, follows72h: 31, saves72h: 1203, shares72h: 88, postedAt: '2026-10-19T21:14', decision: 'variations', notes: 'strong, keep going', postUrl: 'https://www.tiktok.com/@x/photo/1' } })
    // A blank cell leaves the field as it is.
    expect(out.rows[1]!.patch).toEqual({ views72h: 980 })
    expect(out.rows[2]!.rowId).toBe('P003')
    expect(out.rows[2]!.errors.join(' ')).toMatch(/views_72h "lots" is not a number/)
    expect(out.rows[2]!.errors.join(' ')).toMatch(/posted_at "someday" is not a date/)
    expect(out.rows[2]!.errors.join(' ')).toMatch(/decision "boost"/)
  })
  it('takes post_id for posts with no plan row, an account column, tabs from a spreadsheet; names a missing key column', () => {
    const tsv = 'post_id\taccount\tviews_72h\ncnt_abc12345\t@F2\t1,000\n'
    const out = readResultsCsv(tsv)
    expect(out.rows[0]).toMatchObject({ postId: 'cnt_abc12345', account: 'F2', patch: { views72h: 1000 } })
    expect(readResultsCsv('views_72h,follows_72h\n100,2\n').missing).toEqual(['row_id (or post_id)'])
    expect(readResultsCsv('views_72h,row_id\n100,\n').rows[0]!.errors).toContain('No row_id or post_id')
  })
  it('lists what a row changes', () => {
    const before = r({ views72h: 900, decision: 'keep', notes: 'x' })
    expect(resultChanges(before, { views72h: 900, follows72h: 3, decision: 'drop', notes: 'x' })).toEqual([
      { field: 'follows72h', from: '', to: '3' },
      { field: 'decision', from: 'Keep', to: 'Drop' },
    ])
    expect(resultChanges(null, {})).toEqual([])
  })
})

const post = (id: string, o: Partial<ResultPost> & { results?: PostResults | null } = {}): ResultPost => ({
  id, name: id, kind: 'slideshow', accountTag: 'F2', productId: null, productName: '', characterId: 'chr_1', characterName: 'Callie', topic: false,
  structure: null, variationOf: null, momentId: '', results: null, ...o,
})

describe('totals and breakdowns', () => {
  const posts = [
    post('a', { accountTag: 'F2', structure: 'S3', productId: 'prd_1', productName: 'SideStep', topic: true, results: r({ views72h: 10000, follows72h: 40, saves72h: 5, shares72h: 2, postedAt: '2026-10-19T09:00' }) }),
    post('b', { accountTag: 'F2', structure: 'S11', productId: 'prd_1', productName: 'SideStep', results: r({ views72h: 2000, follows72h: 10, postedAt: '2026-10-20T09:00' }) }),
    post('c', { accountTag: 'F3', structure: 'S3', results: r({ views72h: 500, follows72h: 30, saves72h: 1, postedAt: '2026-10-21' }) }),
    post('d', { accountTag: 'F3' }),
    post('e', { accountTag: '', results: r({ views72h: 100, postedAt: '' }) }),
  ]
  it('counts posts with results and puts follows per post first', () => {
    const a = aggregateResults(posts)
    expect(a.totals).toMatchObject({ posts: 4, views: 12600, follows: 80, saves: 6, shares: 2, followsPerPost: 20 })
    expect(a.by.account.map(x => [x.label, x.posts, x.followsPerPost])).toEqual([['F3', 1, 30], ['F2', 2, 25], ['No account', 1, 0]])
    expect(a.by.structure.map(x => [x.label, x.posts, x.follows])).toEqual([['S3 Untold Story', 2, 70], ['S11 Contrast pair', 1, 10], ['No structure', 1, 0]])
    expect(a.by.product.map(x => x.label)).toEqual(['SideStep', 'No product'])
    expect(a.by.character.map(x => x.label)).toEqual(['No one (topic posts)', 'Callie'])
  })
  it('a date range keeps the posts posted on those days and counts the undated apart', () => {
    const a = aggregateResults(posts, { from: '2026-10-20', to: '2026-10-21' })
    expect(a.totals).toMatchObject({ posts: 2, views: 2500, follows: 40 })
    expect(a.undated).toBe(1)
    expect(aggregateResults(posts, { from: '2026-10-21' }).totals.posts).toBe(1)
  })
})

describe('hook families and the hints', () => {
  it('a family is the post, its variations and the posts that share its plan moment', () => {
    const f = hookFamilies([
      { id: 'a', variationOf: null, momentId: 'F2-M01' },
      { id: 'b', variationOf: 'a', momentId: '' },
      { id: 'c', variationOf: null, momentId: 'f2-m01' },
      { id: 'd', variationOf: null, momentId: 'F2-M02' },
      { id: 'e', variationOf: 'd', momentId: 'F3-M09' },
      { id: 'g', variationOf: null, momentId: 'F3-M09' },
    ])
    expect(f.get('a')).toBe(f.get('b'))
    expect(f.get('a')).toBe(f.get('c'))
    expect(f.get('a')).not.toBe(f.get('d'))
    expect(f.get('d')).toBe(f.get('e'))
    expect(f.get('e')).toBe(f.get('g'))
  })
  it('50K+ views: make 3 variations; under 1K twice in one family: drop the hook family (on every post of it)', () => {
    const h = resultHints([
      { id: 'big', variationOf: null, momentId: '', results: r({ views72h: 50000 }) },
      { id: 'near', variationOf: null, momentId: '', results: r({ views72h: 49999 }) },
      { id: 'low1', variationOf: null, momentId: 'M1', results: r({ views72h: 400 }) },
      { id: 'low2', variationOf: 'low1', momentId: '', results: r({ views72h: 999 }) },
      { id: 'draft', variationOf: 'low1', momentId: '', results: null },
      { id: 'once', variationOf: null, momentId: 'M2', results: r({ views72h: 10 }) },
      { id: 'onceB', variationOf: 'once', momentId: '', results: r({ views72h: 1000 }) },
    ], T)
    expect(h.big).toEqual([{ kind: 'variations', text: '50K+ views: make 3 variations' }])
    expect(h.near).toBeUndefined()
    expect(h.low1).toEqual([{ kind: 'drop', text: 'Under 1K twice: drop the hook family', posts: ['low1', 'low2'] }])
    expect(h.low2?.[0]?.kind).toBe('drop')
    expect(h.draft?.[0]?.kind).toBe('drop')
    expect(h.once).toBeUndefined()
    expect(h.onceB).toBeUndefined()
  })
  it('the thresholds are data: the words follow them', () => {
    const t = { variationsViews: 100000, variationsCount: 5, dropViews: 1500, dropPosts: 3 }
    expect(variationsHint(t)).toBe('100K+ views: make 5 variations')
    expect(dropHint(t)).toBe('Under 1.5K 3 times: drop the hook family')
    expect(shortCount(1_250_000)).toBe('1.3M')
    expect(shortCount(980)).toBe('980')
  })
})

describe('Results by life or job (UX-PLAN.md section 42 D)', () => {
  it('splits follows per post by the plan row\'s life_or_job, untagged apart', () => {
    const post = (id: string, lifeOrJob: string | null, follows: number) => ({ id, name: id, kind: 'meme', accountTag: 'a', productId: null, productName: '', characterId: null, characterName: '', topic: false, structure: null, variationOf: null, momentId: '', lifeOrJob, results: { ...emptyResults(), follows72h: follows, views72h: 100 } })
    const agg = aggregateResults([post('1', 'life', 10), post('2', 'life', 20), post('3', 'job', 6), post('4', null, 1)])
    expect(agg.by.blend.map(r => [r.label, r.posts, r.followsPerPost])).toEqual([['Life', 2, 15], ['Job', 1, 6], ['Not tagged', 1, 1]])
  })
})
