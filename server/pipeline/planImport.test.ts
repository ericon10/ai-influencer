import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { importCharacter } from './files.js'
import { getContent, startRender, type ContentOutputs } from './content.js'
import { clearPlan, importPlan, planView, previewPlan } from './planImport.js'
import { listTrash, restore } from './trash.js'
import { importKit, starterKit } from './scaleKit.js'
import { getScene } from './scenes.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { readAsset } from '../storage/assets.js'
import { contentItems, jobs } from '../db/schema.js'
import { planKind, readPlan, rowScene } from '../core/planImport.js'
import { parseCsv } from '../core/csvImport.js'
import { slideList } from '../core/slides.js'
import type { SlideshowSpec } from '../core/slideshowSpec.js'

// The launch plan import (UX-PLAN.md section 28) in demo mode, with the
// real plan file: the free preview, every row a draft as written, an
// import again that updates instead of doubling, and Generate N posts that
// runs ten at a time. Nothing real runs.

let h: Harness
let callie: string
let solei: string
// The plan's product (section 29) and every row ticked.
let sideStep: string
let allRows: string[]
const RAW = readFileSync(join(process.cwd(), 'docs', 'content', 'launch-plan-v2-posts.csv'), 'utf8')
// The file as written has 56 rows whose slides share one place with no
// shot line of their own; the free pre-check (item 16) blocks them. The
// tests give those slides a shot line in slide_N_image (item 11).
const CSV = withShotLines(RAW)
function withShotLines(text: string): string {
  const table = parseCsv(text)
  const header = table[0]!
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const cols = [1, 2, 3, 4, 5, 6].map(i => `slide_${i}_image`)
  const rows = readPlan(text).rows
  const out = [[...header, ...cols]]
  table.slice(1).filter(r => r.some(Boolean)).forEach((r, k) => {
    const row = rows[k]!
    const sc = rowScene(row.cells, planKind(row.cells.format))
    out.push([...r, ...cols.map((_, i) => (sc.lines[i + 1] ? '' : `the same place, a different corner, photo ${i + 1}`))])
  })
  return out.map(r => r.map(q).join(',')).join('\n')
}
const byRow = (posts: Awaited<ReturnType<typeof planView>>['posts'], id: string) => posts.find(p => p.rowId === id)!

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  solei = (await importCharacter(h.deps, h.ctx, md.replace(/Callie/g, 'Solei'), { images })).characterId
  sideStep = (await importKit(h.deps, h.ctx, starterKit(), 'SideStep')).product.id
  allRows = readPlan(CSV).rows.map(r => r.cells.row_id)
}, 180_000)

describe('the launch plan', () => {
  it('Preview (free): 140 rows by day and account, the feeders as topic accounts, a price for everything', async () => {
    const p = await previewPlan(h.deps, h.ctx, CSV)
    expect(p.problems).toEqual([])
    expect(p.totals).toMatchObject({ rows: 140, ok: 140, problem: 0 })
    expect(p.totals.clips).toBe(10)
    expect(p.totals.photos).toBe(8)
    // Section 30: priced on the picked path (the plan in demo mode, in
    // credits): topic rows at the cheapest model, character slides at their
    // file's default.
    expect(p.still.path).toBe('account')
    expect(p.totals.credits).toBeGreaterThan(0)
    expect(p.totals.price).toMatch(/credits$/)
    expect(p.still.models).toContainEqual({ who: 'Slides with no one', label: 'GPT Image 2.5 Flare', perStill: '1 credit', from: 'cheapest' })
    expect(p.still.models).toContainEqual({ who: "Callie's slides", label: 'Nano Banana 2.1', perStill: '1.5 credits', from: 'file' })
    const api = await previewPlan(h.deps, h.ctx, CSV, { path: 'api' })
    expect(api.still.path).toBe('api')
    expect(api.totals.credits).toBe(0)
    expect(api.totals.usd).toBeGreaterThan(0)
    expect(api.still.models).toContainEqual({ who: "Callie's slides", label: 'GPT Image 2.5 Flare', perStill: '$0.06', from: 'file' })
    expect(p.days[0]).toBe('2026-10-19')
    expect(p.rows[0]).toMatchObject({ date: '2026-10-19', slot: 'AM' })
    const accounts = Object.fromEntries(p.accounts.map(a => [a.tag, a]))
    expect(accounts.F2).toMatchObject({ kind: 'topic', characterId: callie })
    expect(accounts.CALLIE).toMatchObject({ kind: 'character', characterId: callie })
    expect(accounts.SOLEI).toMatchObject({ kind: 'character', characterId: solei })
    // A line that is mostly on-screen text becomes a drawn screen (item 10,
    // on by default); the switch off keeps every slide a photo.
    expect(p.rows.find(r => r.rowId === 'P001')!.specials.map(s => s.type)).toContain('museum_placard')
    const photos = await previewPlan(h.deps, h.ctx, CSV, { drawSpecials: false })
    expect(photos.rows.find(r => r.rowId === 'P001')!.specials).toEqual([])
  })

  it('a row with a problem is named and skipped; a character with no match is an error', async () => {
    const lines = CSV.split('\n')
    const bad = [lines[0], lines[1]!.replace(',F2,', ',NOBODY,').replace('mock UI slideshow', 'character slideshow'), lines[2]!.replace(',2026-10-19,', ',19/10/2026,')].join('\n')
    const p = await previewPlan(h.deps, h.ctx, bad)
    expect(p.totals.problem).toBe(2)
    expect(p.rows.flatMap(r => r.errors).join(' ')).toMatch(/No character named "NOBODY"/)
    expect(p.rows.flatMap(r => r.errors).join(' ')).toMatch(/is not YYYY-MM-DD/)
  })

  it('Import every row for SideStep (free): every word as written, the plan fields kept, the plan\'s product on each; an import again asks Replace or Add, never updates silently; Clear goes to the Trash', async () => {
    const r = await importPlan(h.deps, h.ctx, CSV, { productId: sideStep, rows: allRows })
    expect(r).toMatchObject({ created: 140, replaced: 0, skipped: 0 })
    expect(r.next.postIds).toHaveLength(140)
    expect(r.next.stills).toBeGreaterThan(140)
    const { posts } = await planView(h.deps, h.ctx)
    expect(posts).toHaveLength(140)
    expect(posts[0]!.date).toBe('2026-10-19')
    // Written for SideStep, every row; an ad only where the row's own
    // product column says yes (section 29): pure-pain rows stay plain posts.
    const made = await h.deps.db.select().from(contentItems).where(sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`)
    expect(made.every(m => m.productId === sideStep)).toBe(true)
    const yes = new Set(readPlan(CSV).rows.filter(x => /^(yes|y|true|1)$/i.test(x.cells.product.trim())).map(x => x.cells.row_id))
    expect(yes.size).toBeGreaterThan(0)
    expect(yes.size).toBeLessThan(140)
    for (const m of made) {
      const sp = m.spec as { ad?: boolean; plan: { rowId: string; product: boolean } }
      expect(sp.plan.product, sp.plan.rowId).toBe(yes.has(sp.plan.rowId))
      if (m.kind === 'slideshow') expect(sp.ad, sp.plan.rowId).toBe(yes.has(sp.plan.rowId))
    }

    // A feeder's mock UI slideshow: topic, as written.
    const p1 = await getContent(h.deps, h.ctx, byRow(posts, 'P001').id)
    const s1 = p1.spec as SlideshowSpec
    expect(p1).toMatchObject({ kind: 'slideshow', accountTag: 'F2', characterId: callie })
    expect(s1.mode).toBe('topic')
    expect(s1.hook).toBe('Exhibit 1: a rejection received at 2:14am. Artist unknown.')
    expect(s1.slides).toHaveLength(5)
    expect(s1.slides[4]).toContain('Placard: \'Warm Regards.\'')
    expect(s1.shots[1]).toContain('laptop on a couch pillow')
    expect(s1.caption).toBe('Our first acquisition. The donor was the only person awake for it.')
    expect(s1.hashtags).toEqual(['jobsearch', 'rejectionemail', 'recruitinghell', 'jobtok'])
    expect(s1.ctaLine).toBe('What time did yours arrive? The archive is collecting timestamps.')
    expect(s1.ad).toBe(false)
    expect(s1.plan).toMatchObject({ rowId: 'P001', date: '2026-10-19', slot: 'AM', structure: 'L14', effectOpen: 'E1', effectPayoff: 'E4', hookScore: 2, momentId: 'F2-M01', tension: 'T3', pillar: 'P1', audience: 'A5', product: false, mentionMother: false })
    expect(s1.plan.altHook).toBe('Applied 11:52pm. Rejected 2:14am. The museum has questions.')

    // A character slideshow: the locked scene, the outfit and hair, a shot each.
    const s5 = (await getContent(h.deps, h.ctx, byRow(posts, 'P005').id)).spec as SlideshowSpec
    expect(s5.mode).toBe('character')
    expect(s5.lock.outfit).toContain('pajama shirt')
    expect(s5.lock.hair).toContain('messy low bun')
    expect(s5.shots[0]).toContain('sitting up in bed')

    // A character photo: one slide.
    const s26 = (await getContent(h.deps, h.ctx, byRow(posts, 'P026').id)).spec as SlideshowSpec
    expect(slideList(s26)).toHaveLength(1)

    // A product clip: a video post with the hook on screen, the motion and the caption to post.
    const p16 = await getContent(h.deps, h.ctx, byRow(posts, 'P016').id)
    expect(p16).toMatchObject({ kind: 'meme', characterId: solei, step: 'stills' })
    const m16 = p16.spec as { caption: string; plan: { caption: string; product: boolean; hashtags: string[] } }
    expect(m16.caption).toBe('7-day bar rule for my job hunt: no posting gets my free hours until it\'s carded.')
    expect(m16.plan.caption.startsWith('Ad:')).toBe(true)
    expect(m16.plan.product).toBe(true)
    const scene = await getScene(h.deps, h.ctx, p16.sceneId!)
    expect((scene.prompts as { video?: { text: string } }).video?.text).toContain('bar penlight')
    expect((scene.fields as { outfit?: string }).outfit).toContain('linen button-up')

    // An import again (owner, 2026-10-22): the preview names the matches,
    // the import waits for Replace or Add as new, never updates silently.
    const pv = await previewPlan(h.deps, h.ctx, CSV, { productId: sideStep })
    expect(pv.totals.matches).toBe(140)
    await expect(importPlan(h.deps, h.ctx, CSV, { productId: sideStep, rows: allRows })).rejects.toThrow(/140 rows match posts you already have/)
    const oldP1 = byRow(posts, 'P001').id
    const again = await importPlan(h.deps, h.ctx, CSV, { productId: sideStep, rows: allRows, existing: 'replace' })
    expect(again).toMatchObject({ created: 0, replaced: 140 })
    const after = (await planView(h.deps, h.ctx)).posts
    expect(after).toHaveLength(140)
    expect(byRow(after, 'P001').id).not.toBe(oldP1)
    // The old post is in the Trash and comes back with Restore.
    const tr = (await listTrash(h.deps, h.ctx)).find(t => t.kind === 'post' && t.refId === oldP1)!
    expect(tr.label).toMatch(/^Post: /)
    await restore(h.deps, h.ctx, [tr.id])
    expect((await planView(h.deps, h.ctx)).posts).toHaveLength(141)
    // Add as new: one more post for the row.
    const add = await importPlan(h.deps, h.ctx, CSV, { productId: sideStep, rows: ['P002'], existing: 'add' })
    expect(add).toMatchObject({ created: 1, replaced: 0 })
    expect((await planView(h.deps, h.ctx)).posts.filter(p => p.rowId === 'P002')).toHaveLength(2)
    // Clear: a dry run counts, then the drafts go to the Trash.
    const ids = [oldP1, add.posts[0]!.id]
    expect(await clearPlan(h.deps, h.ctx, { scope: 'ids', ids, dryRun: true })).toMatchObject({ posts: 2, withPictures: 0, trashed: 0 })
    expect(await clearPlan(h.deps, h.ctx, { scope: 'ids', ids })).toMatchObject({ posts: 2, trashed: 2 })
    expect((await planView(h.deps, h.ctx)).posts).toHaveLength(140)
    expect((await clearPlan(h.deps, h.ctx, { scope: 'empty', dryRun: true })).posts).toBe(140)
  })

  it('Generate N posts: one price, ten posts at a time, each still into its slide; then the export carries the plan in post.json', async () => {
    const { posts } = await planView(h.deps, h.ctx)
    const picked = posts.filter(p => p.account === 'F2' && p.need > 0).slice(0, 12)
    expect(picked).toHaveLength(12)
    const action = { type: 'plan_generate' as const, postIds: picked.map(p => p.id) }
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.totalMicros).toBeGreaterThan(0)
    expect(preview.warnings.map(w => w.ruleId)).toContain('plan-queue')
    const ran = await runAction(h.deps, h.ctx, action, quote.id, true)
    const rows = await h.deps.db.select({ status: jobs.status, request: jobs.request }).from(jobs).where(inArray(jobs.id, ran.jobs.map(j => j.id)))
    const groupOf = (r: { request: unknown }) => (r.request as { queue: { group: number } }).queue.group
    expect(new Set(rows.map(groupOf))).toEqual(new Set([0, 1]))
    expect(rows.filter(r => groupOf(r) === 1).every(r => r.status === 'waiting')).toBe(true)
    expect(rows.filter(r => groupOf(r) === 0).every(r => r.status === 'queued')).toBe(true)
    // The plan says how many of its stills are on their way (the card reads
    // it again while any are, G63): all of them, the waiting ten too.
    expect((await planView(h.deps, h.ctx)).running).toBe(ran.jobs.length)
    await drain(h, 200)
    const done = await h.deps.db.select({ status: jobs.status }).from(jobs).where(inArray(jobs.id, ran.jobs.map(j => j.id)))
    expect(done.every(r => r.status === 'completed')).toBe(true)
    const view = await planView(h.deps, h.ctx)
    expect(view.running).toBe(0)
    const after = view.posts.filter(p => picked.some(x => x.id === p.id))
    expect(after.every(p => p.have === p.need)).toBe(true)

    // A finished still counts until its hook has put it in its slide
    // (phase "checking"), and a still of another post never counts.
    const one = ran.jobs[0]!.id
    await h.deps.db.update(jobs).set({ phase: 'checking' }).where(eq(jobs.id, one))
    expect((await planView(h.deps, h.ctx)).running).toBe(1)
    await h.deps.db.update(jobs).set({ phase: 'done' }).where(eq(jobs.id, one))
    expect((await planView(h.deps, h.ctx)).running).toBe(0)

    // The export: post.json has the plan's fields.
    const first = after[0]!
    await startRender(h.deps, h.ctx, first.id)
    await drain(h, 60)
    const out = (await getContent(h.deps, h.ctx, first.id)).outputs as ContentOutputs
    const zip = unzipSync(new Uint8Array((await readAsset(h.deps, h.ctx, out.zipAssetId!)).data))
    const json = JSON.parse(Buffer.from(zip['post.json']!).toString())
    expect(json.version).toBe(2)
    expect(json.plan).toMatchObject({ row_id: first.rowId, structure: { code: expect.any(String) }, hook_score: expect.any(Number), moment_id: expect.stringMatching(/^F2-M/) })
    expect(json.caption.cta_line).toBeTruthy()
    expect(Buffer.from(zip['caption.txt']!).toString()).toContain(json.caption.cta_line)

    // Remake (owner, 2026-10-22): a post with pictures can be made again;
    // the price never moves anything, the run sends the old pictures to the
    // Trash and fills every photo slide anew.
    const second = after[1]!
    const oldStills = ((await getContent(h.deps, h.ctx, second.id)).spec as SlideshowSpec).stillIds.filter(Boolean)
    expect(oldStills.length).toBe(second.need)
    const remake = { type: 'plan_generate' as const, postIds: [second.id], remake: true }
    const est = await estimateAction(h.deps, h.ctx, remake)
    expect(est.preview.title).toMatch(new RegExp(`^Remake ${second.need} pictures`))
    expect(((await getContent(h.deps, h.ctx, second.id)).spec as SlideshowSpec).stillIds.filter(Boolean)).toEqual(oldStills)
    await runAction(h.deps, h.ctx, remake, est.quote.id, true)
    const trashed = (await listTrash(h.deps, h.ctx)).filter(t => t.kind === 'candidate').map(t => t.refId)
    for (const id of oldStills) expect(trashed).toContain(id)
    await drain(h, 60)
    const fresh = ((await getContent(h.deps, h.ctx, second.id)).spec as SlideshowSpec).stillIds.filter(Boolean)
    expect(fresh).toHaveLength(second.need)
    expect(fresh.some(id => oldStills.includes(id))).toBe(false)
  }, 240_000)

  it('a product slideshow is an ad: "Ad:" first in the caption as posted', async () => {
    const { posts } = await planView(h.deps, h.ctx)
    const rows = await h.deps.db.select({ id: sql<string>`id` }).from(sql`content_items`).where(and(sql`spec->'plan'->>'product' = 'true'`, sql`archived_at is null`, eq(sql`kind`, 'slideshow')))
    expect(rows.length).toBeGreaterThan(0)
    const s = (await getContent(h.deps, h.ctx, rows[0]!.id)).spec as SlideshowSpec
    expect(s.ad).toBe(true)
    expect(posts.length).toBe(140)
  })
})
