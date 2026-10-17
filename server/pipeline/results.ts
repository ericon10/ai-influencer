import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { contentItems, products } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import {
  aggregateResults, emptyResults, hasResults, readPostedAt, readResultsCsv, resultChanges, resultHints, resultsSchema,
  type PostResults, type ResultHint, type ResultPost, type ResultThresholds,
} from '../core/results.js'
import { listCharacters } from './characters.js'
import { getContent } from './content.js'

// Results (owner, 2026-10-17; UX-PLAN.md section 32): each post's results,
// typed on its card (or in its Finish step) or pasted from a CSV by row_id;
// the Results view on Posts home (totals and breakdowns, follows per post
// first) and the decision hints. Free. Results are not an edit of the post:
// saving them never moves it up Posts home (updated_at stays).

const MAX_CSV = 400_000
const MAX_ROWS = 3000
const KIND: Record<string, string> = { meme: 'video post', slideshow: 'slideshow', batch: 'batch' }

export const thresholds = (deps: Deps): ResultThresholds => {
  const r = deps.config.pipeline.content.results
  return { variationsViews: r.variations_views, variationsCount: r.variations_count, dropViews: r.drop_views, dropPosts: r.drop_posts }
}

const readResults = (raw: unknown): PostResults | null => {
  const r = resultsSchema.nullable().safeParse(raw ?? null)
  return r.success ? r.data : null
}

// One post's results, merged with what was typed. Written straight into the
// spec (jsonb_set), so an edit in the post's workspace is never undone and
// the post keeps its place on Posts home.
export async function setPostResults(deps: Deps, ctx: Ctx, itemId: string, patch: Partial<PostResults>): Promise<PostResults> {
  const row = await getContent(deps, ctx, itemId)
  if (patch.postedAt) {
    const v = readPostedAt(patch.postedAt)
    if (!v) throw new AppError('invalid_request', `"${patch.postedAt}" is not a date and time (try 2026-10-19 21:14).`)
    patch = { ...patch, postedAt: v }
  }
  const before = readResults((row.spec as { results?: unknown } | null)?.results) ?? emptyResults()
  const parsed = resultsSchema.safeParse({ ...before, ...patch, updatedAt: deps.clock.now().toISOString() })
  if (!parsed.success) throw new AppError('invalid_request', `Those results are not valid: ${parsed.error.issues.map(i => `${i.path.join('.')} ${i.message.toLowerCase()}`).join('; ')}.`)
  const next = parsed.data
  await deps.db.update(contentItems)
    .set({ spec: sql`jsonb_set(coalesce(${contentItems.spec}, '{}'::jsonb), '{results}', ${JSON.stringify(next)}::jsonb, true)` })
    .where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, row.id)))
  return next
}

// Every live post's results and what the breakdowns group by.
interface Loaded extends ResultPost { rowId: string }
async function loadPosts(deps: Deps, ctx: Ctx): Promise<Loaded[]> {
  const rows = await deps.db.select({
    id: contentItems.id, kind: contentItems.kind, title: contentItems.title, idea: contentItems.idea, accountTag: contentItems.accountTag,
    productId: contentItems.productId, characterId: contentItems.characterId, variationOf: contentItems.variationOf,
    results: sql<unknown>`${contentItems.spec}->'results'`,
    plan: sql<{ rowId?: string; structure?: string | null; momentId?: string } | null>`${contentItems.spec}->'plan'`,
    mode: sql<string | null>`${contentItems.spec}->>'mode'`,
    hook: sql<string | null>`${contentItems.spec}->>'hook'`,
    caption: sql<string | null>`${contentItems.spec}->>'caption'`,
  }).from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt))).orderBy(asc(contentItems.createdAt))
  const [chars, prods] = await Promise.all([
    listCharacters(deps, ctx),
    deps.db.select({ id: products.id, name: products.name }).from(products).where(eq(products.accountId, ctx.accountId)),
  ])
  return rows.map(r => {
    const plan = r.plan ?? {}
    const words = r.kind === 'slideshow' ? r.hook : r.kind === 'meme' ? r.caption : ''
    return {
      id: r.id, kind: r.kind,
      name: r.title.trim() || (words ?? '').trim().slice(0, 80) || r.idea.trim().slice(0, 60) || `Untitled ${KIND[r.kind] ?? 'post'}`,
      accountTag: r.accountTag, productId: r.productId, productName: prods.find(p => p.id === r.productId)?.name ?? '',
      characterId: r.characterId, characterName: chars.find(c => c.id === r.characterId)?.name ?? '', topic: r.kind === 'slideshow' && r.mode === 'topic',
      structure: plan.structure ?? null, variationOf: r.variationOf, momentId: String(plan.momentId ?? ''), rowId: String(plan.rowId ?? ''),
      results: readResults(r.results),
    }
  })
}

export interface ResultsQuery { from?: string | null; to?: string | null; accountTag?: string | null; characterId?: string | null; productId?: string | null }

// Posts home > Results: totals, the breakdowns by account, product,
// character and hook structure (follows per post first), and the hints.
// The hints read every post (a hook family crosses accounts); the totals
// and the hinted list follow the Posts home filters and the date range.
export async function resultsView(deps: Deps, ctx: Ctx, q: ResultsQuery = {}) {
  const all = await loadPosts(deps, ctx)
  const t = thresholds(deps)
  const hints = resultHints(all, t)
  const shown = all.filter(p => (!q.accountTag || p.accountTag === q.accountTag) && (!q.characterId || p.characterId === q.characterId)
    && (!q.productId || (q.productId === 'none' ? !p.productId : p.productId === q.productId)))
  const agg = aggregateResults(shown, { from: q.from, to: q.to })
  const hinted = shown.filter(p => hints[p.id] && hasResults(p.results)).map(p => ({ id: p.id, name: p.name, kind: p.kind, accountTag: p.accountTag, views: p.results?.views72h ?? null, follows: p.results?.follows72h ?? null, hints: hints[p.id]! }))
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  return {
    thresholds: t, ...agg, hints, hinted,
    withResults: shown.filter(p => hasResults(p.results)).length, posts: shown.length,
  }
}
export type ResultsView = Awaited<ReturnType<typeof resultsView>>

// ── The CSV paste: a free preview, then Apply ─────────────────────────

export interface ResultsCsvPreviewRow {
  line: number; key: string; postId: string | null; postName: string; account: string
  state: 'change' | 'same' | 'unmatched' | 'ambiguous' | 'error'
  changes: Array<{ field: string; from: string; to: string }>
  errors: string[]
  // Ambiguous: the accounts of the posts that share this row_id.
  accounts: string[]
}

async function matchCsv(deps: Deps, ctx: Ctx, csv: string) {
  if (csv.length > MAX_CSV) throw new AppError('bad_request', 'That file is too big (400 KB). Split it.')
  const read = readResultsCsv(csv)
  const problems: string[] = []
  if (read.missing.length) problems.push(`Missing column: ${read.missing.join(', ')}. Each row is matched by its row_id (the plan's) or post_id (the Studio's).`)
  if (read.unknown.length) problems.push(`Columns not used: ${read.unknown.join(', ')}.`)
  if (read.rows.length > MAX_ROWS) problems.push(`Only the first ${MAX_ROWS} rows are read.`)
  const posts = await loadPosts(deps, ctx)
  const byId = new Map(posts.map(p => [p.id, p]))
  const byRow = new Map<string, Loaded[]>()
  for (const p of posts) if (p.rowId) byRow.set(p.rowId.toLowerCase(), [...(byRow.get(p.rowId.toLowerCase()) ?? []), p])
  const seen = new Map<string, number>()
  const rows: Array<ResultsCsvPreviewRow & { patch: Partial<PostResults> }> = read.rows.slice(0, MAX_ROWS).map(r => {
    const key = r.postId || r.rowId
    const base = { line: r.line, key, postId: null as string | null, postName: '', account: r.account, changes: [] as ResultsCsvPreviewRow['changes'], errors: [...r.errors], accounts: [] as string[], patch: r.patch }
    let found: Loaded[] = []
    if (r.postId) found = byId.has(r.postId) ? [byId.get(r.postId)!] : []
    else if (r.rowId) found = (byRow.get(r.rowId.toLowerCase()) ?? []).filter(p => !r.account || p.accountTag.toLowerCase() === r.account.toLowerCase())
    if (!found.length) return { ...base, state: (r.rowId || r.postId) ? 'unmatched' as const : 'error' as const }
    // On one account, the plan's own post is the first made: a copy made
    // with Make another like this keeps the row_id but is not the row.
    if (found.length > 1 && new Set(found.map(p => p.accountTag.toLowerCase())).size === 1) found = found.slice(0, 1)
    if (found.length > 1) return { ...base, state: 'ambiguous' as const, accounts: found.map(p => p.accountTag || 'no account'), errors: [...base.errors, `${found.length} posts have row_id ${r.rowId}: add an account column (or use post_id)`] }
    const post = found[0]!
    const out = { ...base, postId: post.id, postName: post.name, account: post.accountTag }
    const earlier = seen.get(post.id)
    if (earlier) return { ...out, state: 'error' as const, errors: [...out.errors, `The same post as line ${earlier}`] }
    seen.set(post.id, r.line)
    if (out.errors.length) return { ...out, state: 'error' as const }
    const changes = resultChanges(post.results, r.patch)
    return { ...out, state: changes.length ? 'change' as const : 'same' as const, changes }
  })
  return { rows, problems, columns: read.columns }
}

export async function previewResultsCsv(deps: Deps, ctx: Ctx, csv: string) {
  const m = await matchCsv(deps, ctx, csv)
  const rows = m.rows.map(({ patch: _patch, ...r }) => r)
  return {
    rows, problems: m.problems, columns: m.columns,
    totals: {
      rows: rows.length, matched: rows.filter(r => r.postId).length, change: rows.filter(r => r.state === 'change').length,
      same: rows.filter(r => r.state === 'same').length, unmatched: rows.filter(r => r.state === 'unmatched').length,
      ambiguous: rows.filter(r => r.state === 'ambiguous').length, error: rows.filter(r => r.state === 'error').length,
    },
    unmatched: rows.filter(r => r.state === 'unmatched').map(r => r.key),
  }
}
export type ResultsCsvPreview = Awaited<ReturnType<typeof previewResultsCsv>>

// Apply: only the rows that change something and have no problem.
export async function applyResultsCsv(deps: Deps, ctx: Ctx, csv: string): Promise<{ updated: number; same: number; skipped: number; posts: string[] }> {
  const m = await matchCsv(deps, ctx, csv)
  const go = m.rows.filter(r => r.state === 'change' && r.postId)
  if (!go.length) throw new AppError('invalid_request', 'Nothing to apply: no row changes a post\'s results.')
  for (const r of go) await setPostResults(deps, ctx, r.postId!, r.patch)
  return { updated: go.length, same: m.rows.filter(r => r.state === 'same').length, skipped: m.rows.length - go.length - m.rows.filter(r => r.state === 'same').length, posts: go.map(r => r.postId!) }
}

export type { ResultHint }
