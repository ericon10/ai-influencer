import { and, asc, eq, gt, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { candidates, contentItems, jobs, products } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import type { JobSpec } from '../jobs/runner.js'
import { hardWrap } from '../core/text.js'
import type { RuleViolation } from '../core/rules.js'
import { lintPost } from '../core/copyLint.js'
import type { PlanMeta } from '../core/planMeta.js'
import { checkRow, hashtagsOf, isCharacterKind, namesProduct, planYes, readPlan, repeatedCodes, rowScene, scheduleOrder, screenFor, type CheckedRow, type PlanKind, type PlanRow } from '../core/planImport.js'
import { emptySpecial } from '../core/slides.js'
import { isThin } from '../core/punchUp.js'
import { slideList, type SpecialSlide } from '../core/slides.js'
import { slideshowSpecSchema, type SlideshowSpec } from '../core/slideshowSpec.js'
import { listCharacters, toData, type CharacterRow } from './characters.js'
import { createContent, getContent, updateContent, type ContentRow } from './content.js'
import { lintFor } from './copyLint.js'
import { checkProduct, defaultProductFor, postWriting, type WritingStandard } from './products.js'
import { createScene, updateScene } from './scenes.js'
import { buildSceneRun } from './sceneActions.js'
import { getCharacter } from './characters.js'
import { buildSlideshowStills, slideModel, slidePrice, slideStillPaths, stillPathFor } from './slideshow.js'
import { shotShowsCharacter } from '../core/slides.js'
import { PATH_LABELS, type StillPath } from '../core/stillModels.js'
import { trash, type TrashRef } from './trash.js'
import { buildFacelessStill } from './faceless.js'
import { formatCredits } from '../costs/quotes.js'
import { formatUsd } from '../costs/money.js'

// The launch plan import (owner, 2026-10-16; UX-PLAN.md section 28): a CSV
// of the plan's columns becomes drafts in the flows that exist, with every
// word as written. The preview is free; importing the ticked rows is free;
// nothing paid runs here. "Generate N posts" is one priced action whose
// stills run ten posts at a time (the job runner's queue).
// Products (section 29): a row names its own product (the product column,
// by name; one not in Products is an error in the preview), and the plan's
// pick fills the rows that name none. Each draft is written for its
// product (its rules, its language notes). Whether a row is an ad is the
// row's own ad column (#ad and the honest endings), never the product. An
// older file's product column of yes or no is the ad column.

const MAX_BYTES = 400_000
const MAX_ROWS = 300
const QUEUE = 10

// productId: the plan's product (null: none; left out: not picked yet).
// rows: the row_ids to import (the preview always reads every row).
// path: the stills path for the preview's prices (section 30; stillModel is
// a model ref from a page from before, read as its path).
// existing: what an import does with ticked rows whose row_id matches posts
// already made (owner, 2026-10-22: never update silently): replace them
// (the old posts and their pictures go to the Trash) or add new posts.
// lines: image lines the owner OK'd after Punch up (row_id, then the slide
// number 1 to 6), used as that slide's slide_N_image.
interface Opts { lines?: Record<string, Record<string, string>>; drawSpecials?: boolean; store?: Record<string, string>; stillModel?: string | null; path?: StillPath | null; productId?: string | null; rows?: string[]; existing?: 'replace' | 'add' }

export interface PlanAccountView { tag: string; kind: 'character' | 'topic'; characterId: string | null; characterName: string; rows: number; problem: string | null }
export interface PlanPreviewRow {
  line: number; rowId: string; date: string; slot: string; account: string; format: string; kind: PlanKind | null
  // The stills' price on the picked path (section 30): plan credits on the
  // plan, dollars on the API (priceUsd is the dollar part), and as shown.
  hook: string; photos: number; specials: Array<{ slide: number; type: string }>; priceUsd: number; credits: number; price: string
  // Slides whose line names a product (item 15): the owner's screenshot,
  // never generated or priced.
  screenshots: Array<{ slide: number; product: string }>
  // Each photo slide's image line, and whether it is thin (Punch up, item 14).
  lines: Array<{ slide: number; text: string; thin: boolean }>
  // The row's product: its own (row) or the plan's pick (plan), by name ('' : none); and the ad switch.
  product: string; productFrom: 'row' | 'plan'; ad: boolean
  errors: string[]; warnings: string[]; lint: string[]
  postId: string | null; state: 'new' | 'update' | 'kept' | 'problem'
}
export interface PlanPreview {
  rows: PlanPreviewRow[]; accounts: PlanAccountView[]; days: string[]; problems: string[]
  // matches: good rows whose row_id matches posts already made (kept: of
  // those, the ones with pictures).
  totals: { rows: number; ok: number; problem: number; kept: number; matches: number; slideshows: number; photos: number; clips: number; stills: number; usd: number; credits: number; price: string }
  // Section 30: the picked path, the two paths, and the model each kind of
  // slide uses on it (each character's own default, the cheapest for no one).
  still: { path: StillPath; pathLabel: string; problem: string | null; paths: Array<{ path: StillPath; label: string; problem: string | null }>; models: Array<{ who: string; label: string; perStill: string; from: 'file' | 'studio' | 'cheapest' }> }
  planId: string
  // The plan's product as previewed (null: none or not picked), and the one
  // its accounts agree on (Posts home > Accounts), to pre-fill the pick.
  product: { id: string; name: string; writingLabel: string; notes: boolean } | null
  suggestedProductId: string | null
  // How many good rows name no product of their own (the plan's pick fills them).
  blankProductRows: number
}

const norm = (s: string) => s.trim().toLowerCase()
const charByName = (chars: CharacterRow[], tag: string) => chars.find(c => norm(c.name) === norm(tag.replace(/^@+/, '')))

// Plan posts already made, by row and account (an import again asks what
// to do with them: Replace or Add as new; owner, 2026-10-22). After an Add
// a row can have more than one post.
async function existing(deps: Deps, ctx: Ctx): Promise<Map<string, ContentRow[]>> {
  const rows = await deps.db.select().from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`))
  const out = new Map<string, ContentRow[]>()
  for (const r of rows) {
    const k = `${norm(r.accountTag)}|${String((r.spec as { plan?: { rowId?: string } }).plan?.rowId ?? '')}`
    out.set(k, [...(out.get(k) ?? []), r])
  }
  return out
}

// The pictures a post has made: a slideshow's stills, a clip post's stills
// and takes (its own scene). They go to the Trash with a Replace or a
// remake, restorable for 7 days.
export async function postPictures(deps: Deps, ctx: Ctx, row: ContentRow): Promise<TrashRef[]> {
  if (row.kind === 'slideshow') return [...new Set(((row.spec as { stillIds?: string[] }).stillIds ?? []).filter(Boolean))].map(id => ({ kind: 'candidate' as const, id }))
  if (!row.sceneId) return []
  const list = await deps.db.select({ id: candidates.id }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.sceneId, row.sceneId), sql`${candidates.status} not in ('trashed', 'purged')`))
  return list.map(c => ({ kind: 'candidate' as const, id: c.id }))
}

// The posts among these that have pictures: their own (generated) or, for
// a clip post, a still or take made in its scene and not picked yet.
async function withPictures(deps: Deps, ctx: Ctx, rows: ContentRow[]): Promise<Set<string>> {
  const out = new Set(rows.filter(generated).map(r => r.id))
  const scenes = rows.filter(r => !out.has(r.id) && r.kind !== 'slideshow' && r.sceneId).map(r => r.sceneId!)
  if (scenes.length) {
    const hit = await deps.db.select({ sceneId: candidates.sceneId }).from(candidates)
      .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.sceneId, scenes), sql`${candidates.assetId} is not null`, sql`${candidates.status} not in ('trashed', 'purged')`))
    const has = new Set(hit.map(h => h.sceneId))
    for (const r of rows) if (r.sceneId && has.has(r.sceneId)) out.add(r.id)
  }
  return out
}

// A post that already has pictures (or a clip) of its own.
function generated(row: ContentRow): boolean {
  const s = (row.spec ?? {}) as { stillIds?: string[]; stillId?: string | null; clipId?: string | null }
  if (row.kind === 'slideshow') return (s.stillIds ?? []).some(Boolean) || !!(row.outputs as { imageAssetIds?: string[] } | null)?.imageAssetIds?.length
  return !!(s.stillId || s.clipId)
}

function accountsFor(rows: CheckedRow[], chars: CharacterRow[], store: Record<string, string>): PlanAccountView[] {
  const tags = [...new Set(rows.map(r => r.account).filter(Boolean))]
  return tags.map(tag => {
    const mine = rows.filter(r => r.account === tag)
    const character = mine.some(r => r.kind && isCharacterKind(r.kind))
    const named = charByName(chars, tag)
    if (character) return { tag, kind: 'character' as const, characterId: named?.id ?? null, characterName: named?.name ?? '', rows: mine.length, problem: named ? null : `No character named "${tag}". Import the character first.` }
    const oldest = [...chars].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
    const pick = chars.find(c => c.id === store[tag]) ?? named ?? oldest
    return { tag, kind: 'topic' as const, characterId: pick?.id ?? null, characterName: pick?.name ?? '', rows: mine.length, problem: pick ? null : 'Make or import a character first: pictures are filed under one.' }
  })
}

async function plan(deps: Deps, ctx: Ctx, csv: string, opts: Opts, std: WritingStandard | null = null) {
  if (csv.length > MAX_BYTES) throw new AppError('bad_request', 'That file is too big for one import (400 KB). Split it.')
  const read = readPlan(csv)
  const problems: string[] = []
  if (read.missing.length) problems.push(`Missing column${read.missing.length === 1 ? '' : 's'}: ${read.missing.join(', ')}.`)
  if (read.unknown.length) problems.push(`Columns not used: ${read.unknown.join(', ')}.`)
  if (read.rows.length > MAX_ROWS) problems.push(`Only the first ${MAX_ROWS} rows are read.`)
  const raw = read.rows.slice(0, MAX_ROWS)
  for (const r of raw) {
    const own = opts.lines?.[r.cells.row_id]
    if (own) for (const [n, text] of Object.entries(own)) if (/^[1-6]$/.test(n) && text.trim()) (r.cells as Record<string, string>)[`slide_${n}_image`] = text.trim().slice(0, 800)
  }
  const checked = raw.map(checkRow)
  const repeats = repeatedCodes(checked)
  const ids = new Map<string, number>()
  for (const r of checked) ids.set(r.rowId, (ids.get(r.rowId) ?? 0) + 1)
  for (const r of checked) {
    if (r.rowId && (ids.get(r.rowId) ?? 0) > 1) r.errors.push(`row_id ${r.rowId} is used more than once`)
    // The playbook's structures belong to a product that adds them (SideStep).
    if (std?.structures && repeats.has(r.line)) r.warnings.push('The same structure as this account\'s post before it (never twice in a row)')
  }
  const chars = await listCharacters(deps, ctx)
  const accounts = accountsFor(checked, chars, opts.store ?? {})
  for (const r of checked) {
    const a = accounts.find(x => x.tag === r.account)
    if (a?.problem) r.errors.push(a.problem)
  }
  // A row's own product, by name (section 29).
  const list = await deps.db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.accountId, ctx.accountId), isNull(products.archivedAt))).orderBy(asc(products.createdAt))
  const rowProduct = new Map<number, { id: string; name: string }>()
  for (const r of checked) {
    if (!r.productName) continue
    const hit = list.find(x => norm(x.name) === norm(r.productName))
    if (hit) rowProduct.set(r.line, hit)
    else r.errors.push(`Product "${r.productName}" is not in Products (Library > Hooks): add it there, or fix the row`)
  }
  return { raw, checked, accounts, problems, chars, rowProduct, productNames: list.map(x => x.name) }
}

// What a slideshow row's slides become (2026-10-22, items 10, 11, 15): a
// photo from the slide's image line (its own column, else "Slide N:" in the
// scene), a screen drawn by code when the line is mostly on-screen text
// (generic names; the switch, on by default, turns it off), or the owner's
// own screenshot when the line names one of the account's products (never
// generated or priced).
function slidesOf(deps: Deps, raw: PlanRow, kind: PlanKind, drawSpecials: boolean, productNames: string[]) {
  const c = raw.cells
  const scene = rowScene(c, kind)
  const texts = kind === 'photo' ? [c.hook] : [c.hook, c.slide_2, c.slide_3, c.slide_4, c.slide_5, c.slide_6]
  while (texts.length > 1 && !texts[texts.length - 1]!.trim()) texts.pop()
  const n = texts.length
  const cfg = deps.config.pipeline.content.slideshow
  const shots = Array.from({ length: n }, (_, i) => (scene.lines[i + 1] ?? '').slice(0, 800))
  const asWritten = Array.from({ length: n }, (_, i) => !!scene.own[i + 1] && kind !== 'topic_slideshow')
  const screenshots: Array<{ slide: number; product: string }> = []
  const specials = Array.from({ length: n }, (_, i): SpecialSlide | null => {
    const line = scene.lines[i + 1] ?? ''
    if (!line) return null
    const product = namesProduct(line, productNames)
    if (product) { screenshots.push({ slide: i + 1, product }); return { ...emptySpecial('product_shot'), title: product } }
    return drawSpecials ? screenFor(line, { brands: cfg.brand_names, generic: cfg.generic_names }) : null
  })
  return { scene, texts, shots, specials, asWritten, screenshots }
}

// A plan's light words: a light preset when they name one, else words kept
// with the place (the lock's light is a preset id).
function lightOf(deps: Deps, words: string): { id: string; words: string } {
  const w = words.trim().toLowerCase()
  if (!w) return { id: '', words: '' }
  const hit = deps.config.pipeline.scenes.lights.find(l => l.id === w.replace(/\s+/g, '_') || l.label.toLowerCase() === w)
  return hit ? { id: hit.id, words: '' } : { id: '', words: words.trim() }
}

function metaOf(raw: PlanRow, r: CheckedRow, planId: string): PlanMeta {
  const c = raw.cells
  return {
    rowId: r.rowId, planId, date: r.date, slot: r.slot, format: r.format.slice(0, 40),
    tension: c.tension.slice(0, 12), pillar: c.pillar.slice(0, 12), audience: c.audience.slice(0, 12),
    // (The plan row's product field is its ad switch, as before.)
    product: r.ad, mentionMother: planYes(c.mention_mother),
    structure: r.code, effectOpen: r.effectOpen, effectPayoff: r.effectPayoff, hookScore: r.score,
    momentId: c.moment_id.slice(0, 30), moment: c.moment.slice(0, 800), altHook: c.alt_hook.slice(0, 200),
    scene: c.scene.slice(0, 4000), clipAction: c.clip_action.slice(0, 2000), cta: c.cta.slice(0, 300), statSource: c.stat_source.slice(0, 200), notes: c.notes.slice(0, 1500),
    caption: r.kind === 'clip' ? c.caption.slice(0, 2200) : '', hashtags: r.kind === 'clip' ? hashtagsOf(c.hashtags).slice(0, 15) : [],
  }
}

export async function previewPlan(deps: Deps, ctx: Ctx, csv: string, opts: Opts = {}): Promise<PlanPreview> {
  const { product, std } = await postWriting(deps, ctx, opts.productId)
  const { raw, checked, accounts, problems, rowProduct, chars, productNames } = await plan(deps, ctx, csv, opts, std)
  const made = await existing(deps, ctx)
  const pictured = await withPictures(deps, ctx, [...made.values()].flat())
  // Section 30: each still priced by its own model on the picked path.
  const { paths } = await slideStillPaths(deps, ctx)
  const path = await stillPathFor(deps, ctx, null, { path: opts.path, stillModel: opts.stillModel }).catch(() => paths.find(p => !p.problem)?.path ?? 'account')
  const perStill = new Map<string, { label: string; who: string; from: 'file' | 'studio' | 'cheapest'; credits: number | null; micros: number; display: string }>()
  const stillFor = (characterId: string | null, who: 'character' | 'none') => {
    const key = `${who === 'none' ? '' : characterId ?? ''}|${who}`
    const hit = perStill.get(key)
    if (hit) return hit
    const row = who === 'character' ? chars.find(c => c.id === characterId) : null
    const m = slideModel(deps, who, row ? toData(row) : null, path)
    const price = m ? slidePrice(deps, m.ref, path) : { credits: null, micros: 0, display: 'no model' }
    const out = { label: m?.label ?? 'No model on this path', who: who === 'none' ? 'Slides with no one' : `${row?.name ?? 'The character'}'s slides`, from: m?.from ?? 'studio' as const, ...price }
    perStill.set(key, out)
    return out
  }
  const lint = await lintFor(deps, ctx)
  // The language notes follow each row's product: SideStep's all of them,
  // any other product (or none) the dash check only.
  const stds = new Map<string, boolean>()
  for (const p of rowProduct.values()) if (!stds.has(p.id)) stds.set(p.id, !!(await postWriting(deps, ctx, p.id)).std?.lint)
  const rows: PlanPreviewRow[] = checked.map((r, i) => {
    const rawRow = raw[i]!
    const own = rowProduct.get(r.line) ?? null
    const name = own?.name ?? product?.name ?? ''
    const standard = own ? !!stds.get(own.id) : !!std?.lint
    const lists = { ...lint.lists, products: name ? [name] : [] }
    let photos = 0
    const specials: PlanPreviewRow['specials'] = []
    let lintHits: string[] = []
    let screenshots: PlanPreviewRow['screenshots'] = []
    let lines: PlanPreviewRow['lines'] = []
    // Each photo's price by who is in it (section 30): a topic row's are
    // the cheapest model, a character's slides their file's default.
    const acct = accounts.find(a => a.tag === r.account)
    const chRow = chars.find(c => c.id === acct?.characterId)
    const pronouns = chRow ? toData(chRow).pronouns : undefined
    let credits = 0, micros = 0
    const add = (who: 'character' | 'none') => { const p = stillFor(acct?.characterId ?? null, who); credits += p.credits ?? 0; micros += p.credits == null ? p.micros : 0 }
    if (r.kind && r.kind !== 'clip') {
      const s = slidesOf(deps, rawRow, r.kind, opts.drawSpecials !== false, productNames)
      screenshots = s.screenshots
      lines = s.shots.map((text, k) => ({ slide: k + 1, text, thin: !s.specials[k] && isThin(text) })).filter((l, k) => !s.specials[k] && l.text)
      s.specials.forEach((sp, k) => {
        if (sp) { specials.push({ slide: k + 1, type: sp.type }); return }
        photos++
        add(r.kind === 'topic_slideshow' ? 'none' : r.kind === 'photo' || shotShowsCharacter(s.shots[k] ?? '', { name: chRow?.name ?? '', pronouns }) ? 'character' : 'none')
      })
      lintHits = lintPost({ texts: s.texts, caption: rawRow.cells.caption, hashtags: hashtagsOf(rawRow.cells.hashtags), product: r.ad, standard }, { lists, off: lint.off }).map(h => `${h.slide == null ? 'Caption' : h.slide === 0 ? 'Hook' : `Slide ${h.slide + 1}`}: ${h.message}`)
    } else if (r.kind === 'clip') {
      photos = 1
      add('character')
      lintHits = lintPost({ texts: [rawRow.cells.hook], caption: rawRow.cells.caption, hashtags: hashtagsOf(rawRow.cells.hashtags), product: r.ad, standard }, { lists, off: lint.off }).map(h => `${h.slide == null ? 'Caption' : 'On-screen text'}: ${h.message}`)
    }
    const posts = made.get(`${norm(r.account)}|${r.rowId}`) ?? []
    const post = posts[0] ?? null
    // update: it matches drafts with no pictures; kept: one of them has pictures.
    const state: PlanPreviewRow['state'] = r.errors.length ? 'problem' : posts.length ? (posts.some(p => pictured.has(p.id)) ? 'kept' : 'update') : 'new'
    const free = state === 'problem'
    return {
      line: r.line, rowId: r.rowId, date: r.date, slot: r.slot, account: r.account, format: r.format, kind: r.kind,
      product: name, productFrom: own ? 'row' as const : 'plan' as const, ad: r.ad,
      hook: r.hook, photos, specials, screenshots, lines, priceUsd: free ? 0 : micros / 1e6, credits: free ? 0 : credits, price: free ? 'Free' : priceText(credits, micros),
      errors: r.errors, warnings: r.warnings, lint: lintHits, postId: post?.id ?? null, state,
    }
  })
  const ok = rows.filter(r => r.state !== 'problem')
  const usd = ok.reduce((a, r) => a + r.priceUsd, 0)
  const credits = Math.round(ok.reduce((a, r) => a + r.credits, 0) * 100) / 100
  // The product the plan's accounts agree on (each account's product on the
  // Accounts card), to pre-fill "This plan is for".
  const linked = new Set<string>()
  for (const a of accounts) { const id = await defaultProductFor(deps, ctx, a.tag); if (id) linked.add(id) }
  return {
    rows: scheduleOrder(rows), accounts, problems,
    days: [...new Set(scheduleOrder(rows).map(r => r.date))],
    totals: {
      rows: rows.length, ok: ok.length, problem: rows.filter(r => r.state === 'problem').length, kept: rows.filter(r => r.state === 'kept').length,
      matches: rows.filter(r => r.state === 'update' || r.state === 'kept').length,
      slideshows: ok.filter(r => r.kind === 'topic_slideshow' || r.kind === 'character_slideshow').length, photos: ok.filter(r => r.kind === 'photo').length, clips: ok.filter(r => r.kind === 'clip').length,
      stills: ok.reduce((a, r) => a + r.photos, 0), usd: Math.round(usd * 100) / 100, credits, price: priceText(credits, Math.round(usd * 1e6)),
    },
    still: {
      path, pathLabel: PATH_LABELS[path], problem: paths.find(p => p.path === path)?.problem ?? null, paths,
      models: [...perStill.values()].sort((a, b) => (a.who === 'Slides with no one' ? 1 : 0) - (b.who === 'Slides with no one' ? 1 : 0)).map(m => ({ who: m.who, label: m.label, perStill: m.display, from: m.from })),
    },
    planId: planIdOf(checked),
    product: product ? { id: product.id, name: product.name, writingLabel: std?.label ?? 'General standard', notes: !!std?.lint } : null,
    suggestedProductId: linked.size === 1 ? [...linked][0]! : null,
    blankProductRows: rows.filter(r => r.productFrom === 'plan' && r.state !== 'problem').length,
  }
}

// A price as shown: plan credits, dollars, or both.
export function priceText(credits: number, micros: number): string {
  const parts = [credits > 0 ? formatCredits(credits) : '', micros > 0 || credits <= 0 ? formatUsd(micros) : ''].filter(Boolean)
  return parts.join(' + ')
}

const planIdOf = (rows: CheckedRow[]) => {
  const dates = rows.map(r => r.date).filter(Boolean).sort()
  return dates.length ? `plan-${dates[0]}` : 'plan'
}

// "Import N rows" (free): each ticked good row becomes a draft in its flow,
// with its words as written and the plan's product. A ticked row whose
// row_id matches posts already made needs the owner's choice (2026-10-22):
// Replace (the old posts and their pictures go to the Trash, restorable) or
// Add as new posts. Nothing is updated silently. Rows not ticked are left out.
export interface PlanImportResult { created: number; replaced: number; trashedPictures: number; skipped: number; posts: Array<{ rowId: string; id: string; state: 'new' | 'replaced' }>; next: { postIds: string[]; stills: number } }
export async function importPlan(deps: Deps, ctx: Ctx, csv: string, opts: Opts = {}): Promise<PlanImportResult> {
  const picked = new Set((opts.rows ?? []).map(x => x.trim()).filter(Boolean))
  if (!picked.size) throw new AppError('invalid_request', 'Tick the rows to import first.')
  const planProduct = opts.productId === undefined ? undefined : await checkProduct(deps, ctx, opts.productId)
  const { std } = await postWriting(deps, ctx, planProduct)
  const { raw, checked, accounts, rowProduct, productNames } = await plan(deps, ctx, csv, opts, std)
  // The plan's pick is needed only for ticked rows that name no product.
  if (planProduct === undefined && checked.some(r => picked.has(r.rowId) && !r.errors.length && !rowProduct.has(r.line))) throw new AppError('invalid_request', 'Pick the plan\'s product first (or No product): some ticked rows name no product of their own.')
  const made = await existing(deps, ctx)
  const matching = checked.filter(r => picked.has(r.rowId) && !r.errors.length && (made.get(`${norm(r.account)}|${r.rowId}`) ?? []).length)
  if (matching.length && !opts.existing) throw new AppError('invalid_request', `${matching.length} row${matching.length === 1 ? ' matches posts' : 's match posts'} you already have. Pick Replace them (their pictures go to Trash) or Add as new posts.`)
  const planId = planIdOf(checked)
  const out: PlanImportResult = { created: 0, replaced: 0, trashedPictures: 0, skipped: 0, posts: [], next: { postIds: [], stills: 0 } }
  const order = scheduleOrder(checked.map((r, i) => ({ ...r, i })))
  for (const r of order) {
    const rawRow = raw[r.i]!
    if (!picked.has(r.rowId)) continue
    if (r.errors.length || !r.kind) { out.skipped++; continue }
    const productId = rowProduct.get(r.line)?.id ?? planProduct ?? null
    const account = accounts.find(a => a.tag === r.account)!
    const old = made.get(`${norm(r.account)}|${r.rowId}`) ?? []
    let state: 'new' | 'replaced' = 'new'
    if (old.length && opts.existing === 'replace') {
      for (const p of old) {
        const pics = await postPictures(deps, ctx, p)
        out.trashedPictures += (await trash(deps, ctx, pics)).moved
        await trash(deps, ctx, [{ kind: 'post', id: p.id }])
      }
      state = 'replaced'
    }
    const meta = metaOf(rawRow, r, planId)
    const title = `${r.rowId}: ${r.hook}`.slice(0, 120)
    const c = rawRow.cells
    let id: string
    if (r.kind === 'clip') {
      const sc = rowScene(c, r.kind)
      const light = lightOf(deps, sc.light)
      const firstBeat = c.clip_action.split(/(?<=[.!?])\s+/)[0] ?? ''
      const setting = [sc.place, light.words, sc.details.length ? `Also in the place: ${sc.details.join(', ')}` : ''].filter(Boolean).join('. ')
      const fields = { setting: setting.slice(0, 400), outfit: sc.outfit.slice(0, 300), hair: sc.hair.slice(0, 160), moment: (firstBeat || c.moment).slice(0, 400), ...(light.id ? { light: light.id } : {}) }
      const spec = { caption: r.hook.slice(0, 400), plan: meta }
      const scene = await createScene(deps, ctx, account.characterId!, { brief: c.scene, title: r.rowId, fields })
      if (c.clip_action) await updateScene(deps, ctx, scene.id, { prompts: { video: c.clip_action } })
      id = (await createContent(deps, ctx, { kind: 'meme', characterId: account.characterId!, title, idea: c.moment, accountTag: r.account, sceneId: scene.id, step: 'stills', spec, productId })).id
      out.next.stills += 1
    } else {
      const s = slidesOf(deps, rawRow, r.kind, opts.drawSpecials !== false, productNames)
      const light = lightOf(deps, s.scene.light)
      const topic = r.kind === 'topic_slideshow'
      const spec: Partial<SlideshowSpec> = {
        hook: s.texts[0]!.slice(0, 200), slides: s.texts.slice(1).map(t => t.slice(0, 300)),
        slideCount: Math.max(3, Math.min(10, s.texts.length)),
        mode: r.kind === 'topic_slideshow' ? 'topic' : 'character',
        shots: s.shots, specials: s.specials, asWritten: s.asWritten, stillIds: [], textPos: [],
        // The "Stills on" pick of the preview, kept on every post (item 7).
        stillPath: opts.path ?? null,
        // A photo row is the character's photo, whatever its moment says.
        people: r.kind === 'photo' ? ['character'] : [],
        // The scene columns over the scene cell (item 6).
        lock: slideshowSpecSchema.shape.lock.parse({ place: [s.scene.place, light.words].filter(Boolean).join('. ').slice(0, 1000), light: light.id, details: s.scene.details.map(d => d.slice(0, 160)), outfit: topic ? '' : s.scene.outfit.slice(0, 300), hair: topic ? '' : s.scene.hair.slice(0, 200), ownerSet: ['place', 'outfit', 'hair', 'light', 'camera', 'details'] }),
        caption: c.caption.slice(0, 2200), hashtags: hashtagsOf(c.hashtags).slice(0, 15), ctaLine: c.cta.slice(0, 300), ad: r.ad,
        cta: { kind: 'own', handle: '', word: '' }, pattern: null, hookIdeas: [], hookReview: null, plan: meta,
      }
      id = (await createContent(deps, ctx, { kind: 'slideshow', characterId: account.characterId!, title, idea: c.moment, accountTag: r.account, step: 'stills', spec, productId })).id
      out.next.stills += s.specials.filter(x => !x).length
    }
    if (state === 'replaced') out.replaced++
    else out.created++
    out.posts.push({ rowId: r.rowId, id, state })
    out.next.postIds.push(id)
  }
  return out
}

// Clear on the Launch plan card (owner, 2026-10-22): the plan's drafts to
// the Trash (restorable), by scope: every post of one import (planId), only
// the ones with no pictures yet, or the ticked ones. dryRun counts them and
// how many have pictures that were paid for, for the one confirm.
export async function clearPlan(deps: Deps, ctx: Ctx, input: { scope: 'all' | 'empty' | 'ids'; planId?: string | null; ids?: string[]; dryRun?: boolean }): Promise<{ posts: number; withPictures: number; trashed: number }> {
  const rows = await deps.db.select().from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`))
  const planOf = (r: ContentRow) => String((r.spec as { plan?: PlanMeta }).plan?.planId ?? '')
  const ids = new Set(input.ids ?? [])
  const pictured = await withPictures(deps, ctx, rows)
  const pick = rows.filter(r => input.scope === 'ids' ? ids.has(r.id) : (!input.planId || planOf(r) === input.planId) && (input.scope === 'all' || !pictured.has(r.id)))
  if (input.scope === 'ids' && !pick.length) throw new AppError('invalid_request', 'Tick the posts to clear first.')
  const paid = pick.filter(r => pictured.has(r.id)).length
  if (input.dryRun) return { posts: pick.length, withPictures: paid, trashed: 0 }
  const moved = await trash(deps, ctx, pick.map(r => ({ kind: 'post' as const, id: r.id })))
  return { posts: pick.length, withPictures: paid, trashed: moved.moved }
}

// The plan's posts after import, in schedule order, with what each still
// needs (the Launch plan card's list), and how many of their stills are
// still on their way. The card reads the plan again while any are (G63):
// it never depends on the jobs list, which shows at most 100 jobs, so a
// big run or a busy account could hide the stills still running and the
// card stopped at "0 of 6".
export interface PlanPostView { id: string; rowId: string; planId: string; date: string; slot: string; account: string; format: string; kind: string; hook: string; status: string; need: number; have: number; exported: boolean; mode: 'character' | 'topic' | null }
const ACTIVE_JOBS = ['waiting', 'queued', 'submitting', 'running', 'ingesting']
export async function planView(deps: Deps, ctx: Ctx): Promise<{ posts: PlanPostView[]; running: number }> {
  // The stills on their way are read first, then the posts: when none are
  // running, every still is already in its slide. A finished still counts
  // until its hook has put it in place (phase "checking"); one stuck there
  // for 10 minutes no longer does.
  const since = new Date(deps.clock.now().getTime() - 10 * 60_000)
  const active = await deps.db.select({ purpose: jobs.purpose }).from(jobs).where(and(
    eq(jobs.accountId, ctx.accountId),
    or(like(jobs.purpose, 'slide_still:%'), like(jobs.purpose, 'scene:%'), like(jobs.purpose, 'faceless_still:%')),
    or(inArray(jobs.status, ACTIVE_JOBS), and(eq(jobs.status, 'completed'), eq(jobs.phase, 'checking'), gt(jobs.completedAt, since))),
  ))
  const rows = await deps.db.select().from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`))
  const sceneIds = rows.filter(r => r.kind === 'meme' && r.sceneId).map(r => r.sceneId!)
  const stills = sceneIds.length ? await deps.db.select({ sceneId: candidates.sceneId, n: sql<number>`count(*)` }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.sceneId, sceneIds), sql`${candidates.assetId} is not null`, sql`${candidates.op} in ('generate', 'upload_image')`))
    .groupBy(candidates.sceneId) : []
  const byScene = new Map(stills.map(s => [s.sceneId, Number(s.n)]))
  const posts = rows.map(r => {
    const p = ((r.spec ?? {}) as { plan?: PlanMeta }).plan!
    const out = r.outputs as { imageAssetIds?: string[]; videoAssetId?: string } | null
    let need = 0, have = 0, mode: PlanPostView['mode'] = null
    if (r.kind === 'slideshow') {
      const spec = slideshowSpecSchema.parse(r.spec ?? {})
      mode = spec.mode
      for (const s of slideList(spec)) { if (s.special) continue; need++; if (s.stillId) have++ }
    } else { need = 1; have = (r.spec as { stillId?: string | null }).stillId ? 1 : Math.min(1, byScene.get(r.sceneId ?? '') ?? 0); mode = 'character' }
    return { id: r.id, rowId: p.rowId, planId: p.planId, date: p.date, slot: p.slot, account: r.accountTag, format: p.format, kind: r.kind, hook: r.kind === 'slideshow' ? String((r.spec as { hook?: string }).hook ?? '') : String((r.spec as { caption?: string }).caption ?? ''), status: r.status, need, have, exported: !!(out?.imageAssetIds?.length || out?.videoAssetId), mode, line: 0 }
  })
  const mine = new Set(rows.flatMap(r => (r.kind === 'slideshow' ? [`slide_still:${r.id}`] : [`scene:${r.sceneId ?? ''}`, `faceless_still:${r.id}`])))
  return { posts: scheduleOrder(posts.map((p, i) => ({ ...p, line: i }))).map(({ line: _line, ...p }) => p), running: active.filter(j => mine.has(j.purpose)).length }
}

// ── Generate N posts (priced): ten at a time ──────────────────────────

// A remake has started: each post's old pictures go to the Trash, and a
// slideshow's slides are emptied so the new stills fill them.
export async function remakeStarted(deps: Deps, ctx: Ctx, postIds: string[]): Promise<number> {
  let moved = 0
  for (const id of postIds) {
    const post = await getContent(deps, ctx, id).catch(() => null)
    if (!post) continue
    moved += (await trash(deps, ctx, await postPictures(deps, ctx, post))).moved
    if (post.kind === 'slideshow') await updateContent(deps, ctx, post.id, { spec: { stillIds: [] } as Partial<SlideshowSpec> })
  }
  return moved
}

type Built = { purpose: string; characterId: string | null; specs: JobSpec[]; preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: RuleViolation[]; invalidates: string[] } }

// remake (owner, 2026-10-22): posts that already have pictures are made
// again, every photo slide; the old pictures go to the Trash when the run
// starts (remakeStarted), never at the price.
export async function buildPlanGenerate(deps: Deps, ctx: Ctx, input: { postIds: string[]; path?: StillPath | null; stillModel?: string | null; remake?: boolean }): Promise<Built> {
  const ids = [...new Set(input.postIds)].slice(0, 100)
  if (!ids.length) throw new AppError('invalid_request', 'Tick the posts to generate first.')
  const posts: ContentRow[] = []
  for (const id of ids) posts.push(await getContent(deps, ctx, id))
  const ordered = scheduleOrder(posts.map((p, i) => ({ p, line: i, date: String((p.spec as { plan?: PlanMeta }).plan?.date ?? ''), slot: String((p.spec as { plan?: PlanMeta }).plan?.slot ?? '') }))).map(x => x.p)
  const specs: JobSpec[] = []
  const prompts: Built['preview']['prompts'] = []
  const warnings: Built['preview']['warnings'] = []
  const skipped: string[] = []
  // Section 30: the path picked on the card; every still's model follows
  // who is in it, a clip's opening still the character's default.
  const path = await stillPathFor(deps, ctx, null, { path: input.path, stillModel: input.stillModel })
  let group = 0, inGroup = 0
  for (const post of ordered) {
    const rowId = String((post.spec as { plan?: PlanMeta }).plan?.rowId ?? post.id)
    let built: { specs: JobSpec[]; preview: Built['preview'] } | null = null
    try {
      if (post.kind === 'slideshow') {
        const all = input.remake ? slideList(slideshowSpecSchema.parse(post.spec ?? {})).filter(x => !x.special).map(x => x.index) : undefined
        built = await buildSlideshowStills(deps, ctx, { contentId: post.id, path, ...(all?.length ? { slides: all } : {}) })
      }
      else if (post.kind === 'meme' && (post.spec as { faceless?: unknown }).faceless && !post.sceneId) {
        // A faceless post: its still from its place or line (section 35).
        built = await buildFacelessStill(deps, ctx, { contentId: post.id, path })
      } else if (post.kind === 'meme' && post.sceneId && post.characterId) {
        const character = await getCharacter(deps, ctx, post.characterId)
        const model = slideModel(deps, 'character', toData(character), path)
        if (!model) throw new AppError('bad_request', `No stills model runs on ${PATH_LABELS[path]}.`)
        built = await buildSceneRun(deps, ctx, character, { sceneId: post.sceneId, models: [model.ref], variations: 1, withQa: false, billing: path })
      }
    } catch (e) { skipped.push(`${rowId}: ${(e as Error).message}`); continue }
    if (!built || !built.specs.length) { skipped.push(`${rowId}: nothing to make`); continue }
    const offset = specs.length
    for (const s of built.specs) specs.push({ ...s, characterId: s.characterId ?? post.characterId ?? undefined, ...(s.parentIndex != null ? { parentIndex: s.parentIndex + offset } : {}), queue: { group } } as JobSpec)
    if (prompts.length < 2) prompts.push(...built.preview.prompts.slice(0, 2 - prompts.length).map(p => ({ ...p, label: `${rowId}: ${p.label}` })))
    for (const w of built.preview.warnings) if (warnings.length < 12 && !warnings.some(x => x.ruleId === w.ruleId && x.message === w.message)) warnings.push(w)
    if (++inGroup >= QUEUE) { group++; inGroup = 0 }
  }
  if (!specs.length) throw new AppError('bad_request', skipped.length ? `Nothing to generate. ${skipped.slice(0, 3).join(' ')}` : 'Nothing to generate: every ticked post has its pictures.')
  const posts_ = ordered.length - skipped.length
  if (skipped.length) warnings.push({ ruleId: 'plan-skipped', title: `${skipped.length} not generated`, message: skipped.slice(0, 5).join(' '), severity: 'warning', spec: '28' } as RuleViolation)
  if (group > 1 || (group === 1 && inGroup > 0)) warnings.push({ ruleId: 'plan-queue', title: 'Ten at a time', message: `${posts_} posts run ten at a time: the next ten start when the ten before them are done.`, severity: 'warning', spec: '28' } as RuleViolation)
  return {
    purpose: `plan_generate:${ids.length}`, characterId: null,
    preview: { title: input.remake ? `Remake ${specs.length} picture${specs.length === 1 ? '' : 's'} (${posts_} post${posts_ === 1 ? '' : 's'}; the old pictures go to Trash)` : `Generate ${posts_} post${posts_ === 1 ? '' : 's'}: ${specs.length} still${specs.length === 1 ? '' : 's'}`, prompts: prompts.map(p => ({ ...p, wrapped: p.wrapped || hardWrap(p.text) })), warnings, invalidates: [] },
    specs,
  }
}
