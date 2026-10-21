import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { drain } from '../testing/harness.js'
import { jobs } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { isThin, thinParts } from '../core/punchUp.js'
import { importCharacter } from './files.js'
import { getContent } from './content.js'
import { importPlan, previewPlan } from './planImport.js'
import { importKit, starterKit } from './scaleKit.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import type { SlideshowSpec } from '../core/slideshowSpec.js'

// Tier 2 of the Oct 22 build (UX-PLAN.md section 35), on every product and
// account: the scene columns (item 6), the Stills on pick kept (7), drawn
// screens from text lines (10), slide image columns (11), mixed framing
// (12), the slide's image line wins (13), product lines need the owner's
// screenshot (15) and the free pre-check (16). In demo mode; nothing runs.

let h: Harness
let sideStep: string
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const HEAD = ['row_id', 'date', 'slot', 'account', 'format', 'hook', 'slide_2', 'slide_3', 'scene', 'place', 'light', 'outfit', 'detail_1', 'detail_2', 'slide_1_image', 'slide_2_image', 'slide_3_image', 'moment']
const row = (o: Record<string, string>) => HEAD.map(k => q(o[k] ?? '')).join(',')
const CSV = [HEAD.join(','),
  row({ row_id: 'T1', date: '2026-11-02', slot: 'AM', account: 'CALLIE', format: 'character slideshow', hook: 'my manager took credit again', slide_2: 'in the meeting', slide_3: 'and then this', place: 'a small open-plan office', light: 'golden hour', outfit: 'a gray hoodie and straight jeans, same outfit as the place changes', detail_1: 'a half-empty iced coffee', detail_2: 'a sticky note wall', slide_1_image: 'Callie at her desk mid-sigh, a laptop open, a coworker walking past behind her', slide_2_image: 'Callie in the glass meeting room, arms crossed, her manager pointing at a screen', slide_3_image: 'the SideStep app open on her phone on the desk' }),
  row({ row_id: 'T2', date: '2026-11-02', slot: 'PM', account: 'F2', format: 'mock UI slideshow', hook: 'entry level, 5 years required', slide_2: 'the company is 3', slide_3: 'math', scene: 'a city bus in soft morning light', slide_1_image: "mock job posting card 'Junior Analyst' 'Entry level' '5+ years required'", slide_2_image: 'a bus window with rain on it', slide_3_image: 'a coffee cup on a bus seat' }),
  row({ row_id: 'T3', date: '2026-11-03', slot: 'AM', account: 'CALLIE', format: 'character photo', hook: 'the face I made', moment: 'Callie staring at her laptop' }),
  row({ row_id: 'T4', date: '2026-11-03', slot: 'PM', account: 'CALLIE', format: 'character slideshow', hook: 'no shots here', slide_2: 'two', slide_3: 'three', outfit: 'a black tee', slide_1_image: 'Callie on the couch' }),
].join('\n')

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  await importCharacter(h.deps, h.ctx, md, { images })
  sideStep = (await importKit(h.deps, h.ctx, starterKit(), 'SideStep')).product.id
}, 180_000)

describe('the plan\'s scene, image lines and pre-check', () => {
  it('blocks rows that would make bad pictures, free: a character post with no outfit, a slide with no shot line', async () => {
    const p = await previewPlan(h.deps, h.ctx, CSV, { productId: sideStep })
    const byId = Object.fromEntries(p.rows.map(r => [r.rowId, r]))
    expect(byId.T1!.state).not.toBe('problem')
    expect(byId.T2!.state).not.toBe('problem')
    expect(byId.T3!.errors.join(' ')).toMatch(/needs an outfit/)
    expect(byId.T4!.errors.join(' ')).toMatch(/Slides 2, 3 have no shot line/)
    // Item 15: the product line is the owner's screenshot, never priced; item 10: the posting is drawn.
    expect(byId.T1!.screenshots).toEqual([{ slide: 3, product: 'SideStep' }])
    expect(byId.T1!.photos).toBe(2)
    expect(byId.T2!.specials).toEqual([{ slide: 1, type: 'job_posting' }])
  })

  it('imports the scene columns into the lock, the image lines as written, the Stills on pick, and prices the slide as written', async () => {
    const r = await importPlan(h.deps, h.ctx, CSV, { productId: sideStep, rows: ['T1', 'T2'], path: 'api' })
    expect(r.created).toBe(2)
    const t1 = r.posts.find(x => x.rowId === 'T1')!.id
    const s = (await getContent(h.deps, h.ctx, t1)).spec as SlideshowSpec
    expect(s.stillPath).toBe('api')
    expect(s.lock).toMatchObject({ place: 'a small open-plan office', light: 'golden_hour', details: ['a half-empty iced coffee', 'a sticky note wall'], outfit: 'a gray hoodie and straight jeans, same outfit as the place changes' })
    expect(s.asWritten).toEqual([true, true, true])
    expect(s.specials[2]).toMatchObject({ type: 'product_shot', assetId: null })
    const t2 = (await getContent(h.deps, h.ctx, r.posts.find(x => x.rowId === 'T2')!.id)).spec as SlideshowSpec
    expect(t2.specials[0]).toMatchObject({ type: 'job_posting', title: 'Junior Analyst' })

    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: t1, slides: [0, 1] })
    const first = preview.prompts[0]!.text
    // Only the fixed lines around the line as written (item 13).
    expect(first).toContain('Callie at her desk mid-sigh, a laptop open, a coworker walking past behind her.')
    expect(first).toContain('instead of copying the clothes, the place or the light')
    expect(first).toContain('21 or older')
    expect(first).toContain('gray hoodie and straight jeans')
    expect(first).toContain('REALISM')
    expect(first).toContain('Leave clear space in the top third of the frame for a caption.')
    expect(first).toContain('the same outfit in every photo of the set')
    expect(first).not.toContain('same place, light, phone and outfit')
    expect(first).not.toContain('Ordinary background')
    expect(first).not.toContain('Hair: as usual')
    expect(first).not.toMatch(/Candid phone photo taken by a friend|framing,|eye level/)
  })

  it('a character slideshow\'s own shots mix framing slide by slide: close-up, mid, wide', async () => {
    const r = await importPlan(h.deps, h.ctx, CSV.replace(/,a gray hoodie/, ',a gray hoodie').replace('T1,', 'T5,'), { productId: sideStep, rows: ['T5'] })
    const id = r.posts[0]!.id
    const { updateContent } = await import('./content.js')
    await updateContent(h.deps, h.ctx, id, { spec: { asWritten: [], specials: [] } as never })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: id, slides: [0, 1] })
    expect(preview.prompts[0]!.text).toContain('chest-up framing')
    expect(preview.prompts[1]!.text).toContain('waist-up framing')
  })

  it('Punch up: thin lines only, priced, the answer as before and after on the job; nothing changes until Use these', async () => {
    expect(thinParts('Callie on the couch')).toEqual(expect.arrayContaining(['a named camera', 'mixed real light']))
    expect(isThin('Shot on her phone propped on the shelf: Callie mid-laugh at the desk, a mug, a charger, a notebook and keys, a coworker walking past behind, window daylight and a warm desk lamp')).toBe(false)
    const action = { type: 'punch_up_lines' as const, lines: [{ id: 'T9|1', text: 'Callie on the couch' }, { id: 'T9|2', text: 'Shot on her phone propped on the shelf: Callie mid-laugh at the desk, a mug, a charger, a notebook and keys, a coworker walking past behind, window daylight and a warm desk lamp' }] }
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(preview.prompts[0]!.label).toBe('1 thin line to rewrite')
    const { jobs: started } = await runAction(h.deps, h.ctx, action, quote.id, true)
    await drain(h, 20)
    const [job] = await h.deps.db.select().from(jobs).where(eq(jobs.id, started[0]!.id))
    const data = (job!.resultMeta as { data?: { lines?: Array<{ id: string; text: string }> } }).data
    expect(data?.lines?.map(l => l.id)).toEqual(['T9|1'])
    expect(data!.lines![0]!.text).toMatch(/^Callie on the couch, shot on a phone/)
    // The plan takes the OK'd line as that slide's image line.
    const p = await previewPlan(h.deps, h.ctx, CSV, { productId: sideStep, lines: { T4: { 2: 'Callie at the sink', 3: 'Callie by the window' } } })
    expect(p.rows.find(r => r.rowId === 'T4')!.errors).toEqual([])
  })
})
