import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { contentPage, createContent, duplicateContent, getContent, updateContent } from './content.js'
import { addHook, importKit, productSummaries, productView, saveSocialAccount, starterKit, updateProduct } from './scaleKit.js'
import { painsFor } from './lineBank.js'
import { products } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { checkProduct, defaultProductFor, postWriting } from './products.js'
import { importPlan, previewPlan } from './planImport.js'
import { PLAN_COLUMNS, readPlan } from '../core/planImport.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import type { SlideshowSpec } from '../core/slideshowSpec.js'

// Products (owner, 2026-10-17; UX-PLAN.md section 29): every post belongs
// to one product, or none. Every post is written to the general standard;
// a product's own rules (SideStep: the job word, pain 7+, the honest
// endings, the reviewer, the language notes) reach its posts only. Written
// for a product and an ad for it are separate. Nothing picks "the first
// product".

let h: Harness
let callie: string
let sideStep: string
let glow: string
const CSV = readFileSync(join(process.cwd(), 'docs', 'content', 'launch-plan-v2-posts.csv'), 'utf8')
const spec = async (id: string) => (await getContent(h.deps, h.ctx, id)).spec as SlideshowSpec

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 120)
  return { preview, jobs }
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  await importCharacter(h.deps, h.ctx, md.replace(/Callie/g, 'Solei'), { images })
  sideStep = (await importKit(h.deps, h.ctx, starterKit(), 'SideStep')).product.id
  glow = (await importKit(h.deps, h.ctx, '# Glow script kit\n\n## Hook vault\n\n### Relatable\n1. my skin at 7am vs my skin at 7pm\n2. the serum i bought in a panic at 2am\n', 'Glow')).product.id
}, 180_000)

describe('products', () => {
  it('a kit named SideStep starts on SideStep\'s rules; any other kit on the general standard alone; the owner changes it on the card', async () => {
    expect((await postWriting(h.deps, h.ctx, sideStep)).std?.key).toBe('sidestep')
    expect((await postWriting(h.deps, h.ctx, glow)).std).toBeNull()
    const v = await productView(h.deps, h.ctx, glow)
    expect(v).toMatchObject({ writing: '', writingLabel: 'General standard' })
    expect(v.writings.map(w => w.key)).toEqual(['', 'sidestep'])
    await expect(updateProduct(h.deps, h.ctx, glow, { writing: 'nope' })).rejects.toThrow(/general standard or one of the product rules/)
    await updateProduct(h.deps, h.ctx, glow, { writing: 'sidestep' })
    expect((await postWriting(h.deps, h.ctx, glow)).std?.key).toBe('sidestep')
    await updateProduct(h.deps, h.ctx, glow, { writing: '' })
    expect((await postWriting(h.deps, h.ctx, glow)).std).toBeNull()
  })

  it('SideStep\'s rules are the owner\'s only: a customer\'s product named SideStep starts on the general standard, cannot pick them, and reads them as none', async () => {
    const customer = await h.newAccount('Customer')
    // Their own kit, named SideStep in any case: the general standard.
    for (const name of ['SideStep', ' sidestep ']) {
      const { product } = await importKit(h.deps, customer, starterKit(), name)
      expect(product.writing).toBe('')
      expect((await postWriting(h.deps, customer, product.id)).std).toBeNull()
    }
    const [mine] = (await productSummaries(h.deps, customer))
    const v = await productView(h.deps, customer, mine!.id)
    expect(v.writings.map(w => w.key)).toEqual([''])
    await expect(updateProduct(h.deps, customer, mine!.id, { writing: 'sidestep' })).rejects.toThrow(/general standard or one of the product rules/)
    // A row that says sidestep anyway (written before the rule) reads as none.
    await h.deps.db.update(products).set({ writing: 'sidestep' }).where(eq(products.id, mine!.id))
    expect((await postWriting(h.deps, customer, mine!.id)).std).toBeNull()
    expect(await painsFor(h.deps, customer, mine!.id)).toEqual([])
    expect((await productView(h.deps, customer, mine!.id))).toMatchObject({ writing: '', writingLabel: 'General standard' })
    // The owner's own still are.
    expect((await postWriting(h.deps, h.ctx, sideStep)).std?.key).toBe('sidestep')
    expect((await painsFor(h.deps, h.ctx, sideStep)).length).toBeGreaterThan(0)
  })

  it('a post\'s product is only ever the owner\'s pick: never its account\'s, never the first product; copies keep it; Posts home filters by it', async () => {
    // No account has a product until the owner sets one.
    expect(await defaultProductFor(h.deps, h.ctx, 'F2')).toBeNull()
    const before = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie })
    expect(before.productId).toBeNull()
    expect((await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'F2' })).productId).toBeNull()
    // Section 45: the account's product is never taken for a post.
    await saveSocialAccount(h.deps, h.ctx, 'F2', { productId: sideStep })
    expect((await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'F2' })).productId).toBeNull()
    const f2 = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'F2', productId: sideStep })
    expect(f2.productId).toBe(sideStep)
    const mine = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'CALLIE' })
    expect(mine.productId).toBeNull()
    // Picked on purpose wins, None included.
    expect((await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'F2', productId: null })).productId).toBeNull()
    expect((await createContent(h.deps, h.ctx, { kind: 'batch', characterId: callie, accountTag: 'CALLIE', productId: glow })).productId).toBe(glow)
    await expect(checkProduct(h.deps, h.ctx, 'prd_nope000000000000000')).rejects.toThrow()
    // A post with none keeps none when its account changes (section 45).
    expect((await updateContent(h.deps, h.ctx, before.id, { accountTag: 'F2' })).productId).toBeNull()
    expect((await updateContent(h.deps, h.ctx, before.id, { productId: sideStep })).productId).toBe(sideStep)
    // The Idea step's pick.
    expect((await updateContent(h.deps, h.ctx, mine.id, { productId: glow })).productId).toBe(glow)
    expect((await updateContent(h.deps, h.ctx, mine.id, { productId: null })).productId).toBeNull()
    // Make another like this keeps it.
    expect((await duplicateContent(h.deps, h.ctx, f2.id)).productId).toBe(sideStep)
    // Posts home's filter, on the server: a product, or none.
    const last = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie })
    const ss = await contentPage(h.deps, h.ctx, { before: last.id, productId: sideStep, limit: 200 })
    expect(ss.items.length).toBeGreaterThanOrEqual(3)
    expect(ss.items.every(i => i.productId === sideStep)).toBe(true)
    const none = await contentPage(h.deps, h.ctx, { before: last.id, productId: 'none', limit: 200 })
    expect(none.items.some(i => i.id === mine.id)).toBe(true)
    expect(none.items.every(i => i.productId === null)).toBe(true)
  })

  it('the general standard: Write 10 with Claude on a post with no product is one call with no reviewer, no job words and nothing of SideStep; its hooks show with the writer\'s rank', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'CALLIE', idea: 'my first apartment', productId: null })
    const { preview, jobs } = await run({ type: 'slideshow_hooks', contentId: post.id })
    expect(jobs).toHaveLength(1)
    expect(preview.prompts.map(p => p.label)).toEqual(['Hook writer'])
    // (The writer's own words; the character's voice card is Callie's own.)
    const writer = preview.prompts[0]!.text.split('\nAccount: ')[0]!
    expect(writer).toContain('Would a stranger scrolling past stop on this line alone?')
    expect(writer).toContain('Is it clear on one read, with no image?')
    expect(writer).toContain('Does it say exactly what happened?')
    expect(writer).toContain('Does it sound like a person, not a brand?')
    expect(preview.prompts[0]!.text).toContain('my first apartment')
    for (const word of [/\bjob/i, /SideStep/, /THE STANDARD/, /\bpain\b/i, /recruiter/i, /resume/i]) expect(writer).not.toMatch(word)
    const s = await spec(post.id)
    expect(s.hookReview).toBeNull()
    expect(s.hookIdeas).toHaveLength(10)
    expect(s.hookIdeas.every(x => x.source === 'claude' && x.pattern && x.moment && x.alt && !x.reviewed && x.selfScore && x.pain == null && !x.code)).toBe(true)
    expect(s.hookIdeas.map(x => x.text).join(' ')).not.toMatch(/\bjob/i)
  })

  it('a product on the general standard: its vault and claims, never named in a hook; an ad ends on an honest tip about it; never SideStep\'s endings', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'CALLIE', idea: 'skincare at night', productId: glow, spec: { ad: true } })
    const { preview } = await run({ type: 'slideshow_hooks', contentId: post.id })
    const all = preview.prompts[0]!.text
    const writer = all.split('\nAccount: ')[0]!
    expect(all).toContain('my skin at 7am vs my skin at 7pm')
    expect(writer).toContain('an ad for Glow')
    expect(writer).toContain('Glow is never in the hook')
    expect(writer).not.toMatch(/SideStep|\bjob/i)
    const { preview: dp } = await run({ type: 'slideshow_draft', contentId: post.id, hook: 'the serum i bought in a panic at 2am', pattern: 'storytime' })
    const draft = dp.prompts[0]!.text.split('\nHook (slide 1): ')[0]!.replace(/\s+/g, ' ')
    expect(draft).toContain('The clarity test: every slide makes sense to a stranger')
    expect(draft).toContain('honest tip about Glow')
    expect(draft).toContain('product_ending: "none"')
    // (The drawn screens' menu names its screen types, job_posting among them.)
    expect(draft).not.toMatch(/SideStep|honest endings|\bjob\b|\bjobs\b|group chat, fr fr/i)
    const s = await spec(post.id)
    expect(s.productEnding).toBeNull()
    expect(s.ad).toBe(true)
    expect(s.slides.join(' ')).not.toMatch(/SideStep|resume/i)
    // Not an ad: it is never named.
    await updateContent(h.deps, h.ctx, post.id, { spec: { ad: false } })
    const { preview: np } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_draft', contentId: post.id, hook: 'the serum i bought in a panic at 2am', pattern: 'storytime' })
    expect(np.prompts[0]!.text.replace(/\s+/g, ' ')).toContain('This is not an ad: never name Glow')
    // No product: no product or brand at all.
    const bare = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'CALLIE', idea: 'skincare at night', productId: null, spec: { ad: true } })
    const { preview: bp } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_draft', contentId: bare.id, hook: 'the serum i bought in a panic at 2am', pattern: 'storytime' })
    expect(bp.prompts[0]!.text.replace(/\s+/g, ' ')).toContain('There is no product: name no product or brand')
  })

  it('a SideStep post keeps SideStep\'s rules: THE STANDARD, the reviewer, the structures', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'F2', idea: 'job hunting', spec: { mode: 'topic' }, productId: sideStep })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_hooks', contentId: post.id })
    expect(preview.prompts.map(p => p.label)).toEqual(['Hook writer', 'Reviewer'])
    expect(preview.prompts[0]!.text).toContain('Names the job situation, every time')
    expect(preview.prompts[0]!.text).toContain('the primary is L14 Museum exhibit')
  })

  it('variations and hook variants are written to the post\'s (or the hook\'s) product\'s standard', async () => {
    const general = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'CALLIE', productId: glow, spec: { hook: 'my skin at 7am vs 7pm', slides: ['one', 'two'], caption: 'night routine' } })
    const { preview: gv } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_variations', contentId: general.id, count: 1 })
    expect(gv.prompts[0]!.text).toContain('Would a stranger scrolling past stop')
    expect(gv.prompts[0]!.text).not.toContain('Names the job situation')
    const ss = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, accountTag: 'F2', productId: sideStep, spec: { hook: 'the job app wanted my resume AGAIN', slides: ['one', 'two'], caption: 'retyping' } })
    const { preview: sv } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_variations', contentId: ss.id, count: 1 })
    expect(sv.prompts[0]!.text).toContain('Names the job situation')
    const gh = await addHook(h.deps, h.ctx, glow, { text: 'the serum aisle at 2am is a trap' })
    const { preview: hv } = await estimateAction(h.deps, h.ctx, { type: 'hook_variants', hookId: gh.id, characterIds: [callie] })
    expect(hv.prompts[0]!.text).toContain('Would a stranger scrolling past stop')
    expect(hv.prompts[0]!.text).not.toMatch(/job situation|SideStep/)
  })

  it('the plan import: the plan\'s product on every ticked row, only the ticked rows, and the ad switch stays the row\'s own', async () => {
    await expect(importPlan(h.deps, h.ctx, CSV, { rows: ['P001'] })).rejects.toThrow(/Pick the plan's product/)
    await expect(importPlan(h.deps, h.ctx, CSV, { productId: sideStep, rows: [] })).rejects.toThrow(/Tick the rows/)
    // The plan's product is never pre-filled from the accounts (section 45).
    const p = await previewPlan(h.deps, h.ctx, CSV)
    expect(p.suggestedProductId).toBeNull()
    expect(p.product).toBeNull()
    // The language notes follow the plan's product: SideStep's all of them,
    // no product the dash check only.
    const ssPrev = await previewPlan(h.deps, h.ctx, CSV, { productId: sideStep })
    expect(ssPrev.product).toMatchObject({ id: sideStep, notes: true })
    expect(ssPrev.rows.find(r => r.rowId === 'P001')!.lint.join(' ')).toMatch(/No job word|Opens with "Exhibit/)
    const plain = await previewPlan(h.deps, h.ctx, CSV, { productId: null })
    // No product: the long dash check, plus the line lint every post gets (2026-10-22).
    expect(plain.rows.flatMap(r => r.lint).every(l => /long dash|Opens on the setup|No clear emotion/.test(l))).toBe(true)
    expect(plain.rows.flatMap(r => r.warnings).join(' ')).not.toMatch(/same structure/)
    // Only the ticked rows.
    const r = await importPlan(h.deps, h.ctx, CSV, { productId: sideStep, rows: ['P001', 'P005', 'P016'] })
    expect(r).toMatchObject({ created: 3, replaced: 0 })
    expect(r.posts.map(x => x.rowId).sort()).toEqual(['P001', 'P005', 'P016'])
    for (const x of r.posts) expect((await getContent(h.deps, h.ctx, x.id)).productId).toBe(sideStep)
    // P001 is a pure-pain row (product = no): written for SideStep, not an ad.
    const p1 = await spec(r.posts.find(x => x.rowId === 'P001')!.id)
    expect(p1.ad).toBe(false)
    expect(p1.plan.product).toBe(false)
    // P016 is a product row: the ad switch is on (its own column).
    const p16 = await getContent(h.deps, h.ctx, r.posts.find(x => x.rowId === 'P016')!.id)
    expect((p16.spec as { plan: { product: boolean } }).plan.product).toBe(true)
  })

  it('the CSV names each row\'s product and its ad switch: a row\'s own product wins, the plan\'s pick fills blank rows, a product not in Products is an error; an older yes or no product column is the ad switch', async () => {
    const pick = new Map(readPlan(CSV).rows.map(r => [r.cells.row_id, r.cells]))
    const row = (id: string, product: string, ad: string) => ({ ...pick.get(id)!, product, ad })
    const file = toCsv([row('P001', 'Glow', 'no'), row('P005', 'Nope', 'yes'), row('P016', '', 'yes'), row('P006', 'glow', 'yes')])
    const p = await previewPlan(h.deps, h.ctx, file, { productId: sideStep })
    const by = (id: string) => p.rows.find(r => r.rowId === id)!
    expect(by('P001')).toMatchObject({ product: 'Glow', productFrom: 'row', ad: false, state: 'update' })
    expect(by('P005').state).toBe('problem')
    expect(by('P005').errors.join(' ')).toContain('Product "Nope" is not in Products')
    expect(by('P016')).toMatchObject({ product: 'SideStep', productFrom: 'plan', ad: true })
    expect(by('P006')).toMatchObject({ product: 'Glow', productFrom: 'row', ad: true })
    expect(p.blankProductRows).toBe(1)
    // Glow adds no rules: its rows get the dash check only, never "No job word".
    expect(by('P001').lint.join(' ')).not.toMatch(/job word/)
    // Rows that all name their own product need no plan pick.
    const r1 = await importPlan(h.deps, h.ctx, file, { rows: ['P001', 'P006'], existing: 'replace' })
    expect(r1.created + r1.replaced).toBe(2)
    for (const x of r1.posts) expect((await getContent(h.deps, h.ctx, x.id)).productId).toBe(glow)
    expect((await spec(r1.posts.find(x => x.rowId === 'P001')!.id)).ad).toBe(false)
    expect((await spec(r1.posts.find(x => x.rowId === 'P006')!.id)).ad).toBe(true)
    // A blank row needs the plan's pick.
    await expect(importPlan(h.deps, h.ctx, file, { rows: ['P016'] })).rejects.toThrow(/some ticked rows name no product/)
    const r2 = await importPlan(h.deps, h.ctx, file, { rows: ['P016'], productId: null, existing: 'replace' })
    expect((await getContent(h.deps, h.ctx, r2.posts[0]!.id)).productId).toBeNull()
    // A row naming a product not in Products never imports.
    expect((await importPlan(h.deps, h.ctx, file, { rows: ['P005'], productId: sideStep })).skipped).toBe(1)
    // An older file: product yes or no is the ad switch, the pick sets the product.
    const older = await previewPlan(h.deps, h.ctx, toCsv([{ ...pick.get('P016')!, product: 'yes', ad: '' }, { ...pick.get('P001')!, product: 'no', ad: '' }]), { productId: sideStep })
    expect(older.rows.map(r => [r.rowId, r.product, r.productFrom, r.ad])).toEqual([['P001', 'SideStep', 'plan', false], ['P016', 'SideStep', 'plan', true]])
  })
})

// A plan file with every column, the ad column included.
function toCsv(rows: Array<Record<string, string>>): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [PLAN_COLUMNS.join(','), ...rows.map(r => PLAN_COLUMNS.map(c => q(r[c] ?? '')).join(','))].join('\n')
}
