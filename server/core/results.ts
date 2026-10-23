import { z } from 'zod'
import { parseCsv } from './csvImport.js'
import { codeLabel } from './playbook.js'

// Results (owner, 2026-10-17; UX-PLAN.md section 32): what a post did once
// it was posted, typed on its card or pasted from a CSV by row_id. Free; no
// platform APIs yet. Pure, so the browser reads numbers and dates the same
// way the server does. The decision is the owner's; the hints only suggest
// one (the playbook's tiers, section 11: decide by follows per post first,
// then saves and shares).

export const DECISIONS = ['variations', 'keep', 'retry', 'drop'] as const
export type Decision = (typeof DECISIONS)[number]
export const DECISION_LABEL: Record<Decision, string> = { variations: 'Make 3 variations', keep: 'Keep', retry: 'One more try', drop: 'Drop' }
// The chip's color on the card (studio.css badge tones).
export const DECISION_TONE: Record<Decision, 'ok' | 'info' | 'warn' | 'bad'> = { variations: 'ok', keep: 'info', retry: 'warn', drop: 'bad' }

const count = z.number().int().min(0).max(100_000_000_000).nullable().default(null)
export const resultsSchema = z.object({
  postUrl: z.string().max(500).default(''),
  // As written: "YYYY-MM-DDTHH:MM", or "YYYY-MM-DD" when only the day is known.
  postedAt: z.string().max(16).default(''),
  views72h: count, follows72h: count, saves72h: count, shares72h: count,
  decision: z.enum(DECISIONS).nullable().default(null),
  notes: z.string().max(2000).default(''),
  // When the results were last typed or pasted.
  updatedAt: z.string().max(40).nullable().default(null),
})
export type PostResults = z.infer<typeof resultsSchema>
export const emptyResults = (): PostResults => resultsSchema.parse({})
export type ResultField = 'postUrl' | 'postedAt' | 'views72h' | 'follows72h' | 'saves72h' | 'shares72h' | 'decision' | 'notes'
export const RESULT_FIELDS: ResultField[] = ['postUrl', 'postedAt', 'views72h', 'follows72h', 'saves72h', 'shares72h', 'decision', 'notes']
export const NUMBER_FIELDS = ['views72h', 'follows72h', 'saves72h', 'shares72h'] as const
export type NumberField = (typeof NUMBER_FIELDS)[number]
// The CSV's names for the fields.
export const FIELD_COLUMN: Record<ResultField, string> = { postUrl: 'post_url', postedAt: 'posted_at', views72h: 'views_72h', follows72h: 'follows_72h', saves72h: 'saves_72h', shares72h: 'shares_72h', decision: 'decision', notes: 'notes' }
export const FIELD_LABEL: Record<ResultField, string> = { postUrl: 'Post URL', postedAt: 'Posted at', views72h: 'Views (72h)', follows72h: 'Follows (72h)', saves72h: 'Saves (72h)', shares72h: 'Shares (72h)', decision: 'Decision', notes: 'Notes' }

// A post has results once any of its four numbers is in.
export const hasResults = (r: Partial<PostResults> | null | undefined): boolean => !!r && NUMBER_FIELDS.some(k => typeof r[k] === 'number')

// ── Reading what was typed ───────────────────────────────────────────

// "12.4K", "1,203", "1.2M", "980", " 3 400 ". Blank is undefined (nothing
// typed); anything else that is not a count is an error.
export function readCount(raw: string): { value: number | undefined } | { error: string } {
  const t = raw.trim().replace(/^\+/, '').replace(/[\s ]/g, '')
  if (!t) return { value: undefined }
  let body = t
  // Commas only as thousands separators (1,203 and 12,400,000).
  if (body.includes(',')) {
    if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?[kmb]?$/i.test(body)) return { error: `"${raw.trim()}" is not a number` }
    body = body.replace(/,/g, '')
  }
  const m = body.match(/^(\d+(?:\.\d+)?|\.\d+)([kmb])?$/i)
  if (!m) return { error: `"${raw.trim()}" is not a number` }
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1
  return { value: Math.round(Number(m[1]) * mult) }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// The time part: "9:14", "21:14:05", "9:14 PM", "9pm", "9 pm".
function readTime(t: string): { h: number; m: number } | null {
  const s = t.trim().toLowerCase()
  if (!s) return { h: -1, m: -1 }
  const x = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2})(?:\.\d+)?)?\s*(am|pm|a\.m\.|p\.m\.)?$/)
  if (!x || (!x[2] && !x[4])) return null
  let h = Number(x[1]); const m = Number(x[2] ?? 0)
  const ap = x[4]?.replace(/\./g, '')
  if (ap) { if (h < 1 || h > 12) return null; h = (h % 12) + (ap === 'pm' ? 12 : 0) }
  if (h > 23 || m > 59) return null
  return { h, m }
}

// posted_at as written, kept as "YYYY-MM-DDTHH:MM" (or "YYYY-MM-DD" with no
// time). Accepts ISO ("2026-10-19T21:14", "2026-10-19 21:14:00Z", a time
// zone is dropped and the time stays as written), "10/19/2026 9:14 PM"
// (month first; day first when the first number is over 12), "19.10.2026
// 21:14" (day first), "Oct 19, 2026 9:14 PM", "19 Oct 2026 21:14", with an
// optional weekday in front. null when it is not a date.
export function readPostedAt(raw: string): string | null {
  let s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return null
  s = s.replace(/^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+/i, '')
  let y = 0, mo = 0, d = 0, rest = ''
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s,]+(.*))?$/i)
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; rest = m[4] ?? '' }
  else if ((m = s.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})(?:[T\s,]+(.*))?$/))) {
    const a = +m[1]!, b = +m[3]!
    y = m[4]!.length === 2 ? 2000 + +m[4]! : +m[4]!
    // Dots are day first (19.10.2026); slashes and dashes month first, unless the first number cannot be a month.
    if (m[2] === '.' || a > 12) { d = a; mo = b } else { mo = a; d = b }
    rest = m[5] ?? ''
  } else if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[\s,]+(?:at\s+)?(.*))?$/i))) {
    mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1; d = +m[2]!; y = +m[3]!; rest = m[4] ?? ''
  } else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})(?:[\s,]+(?:at\s+)?(.*))?$/i))) {
    d = +m[1]!; mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1; y = +m[3]!; rest = m[4] ?? ''
  } else return null
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null
  // A time zone (Z, +02:00, -0500, UTC, EST) is dropped: the time stays as written.
  rest = rest.replace(/\s*(?:z|utc|gmt|[a-z]{2,4}t|[+-]\d{2}(?::?\d{2})?)$/i, '').trim()
  const time = readTime(rest)
  if (!time) return null
  const day = `${y}-${pad(mo)}-${pad(d)}`
  return time.h < 0 ? day : `${day}T${pad(time.h)}:${pad(time.m)}`
}

// "Make 3 variations", "variations", "keep", "one more try", "retry",
// "drop"; "none" clears it; blank is undefined (nothing typed).
export function readDecision(raw: string): { value: Decision | null | undefined } | { error: string } {
  const t = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!t) return { value: undefined }
  if (/^(?:none|no decision|no|n a|na|clear)$/.test(t)) return { value: null }
  if (/^(?:make )?(?:3 |three )?variations?$/.test(t)) return { value: 'variations' }
  if (/^keep(?: it)?$/.test(t)) return { value: 'keep' }
  if (/^(?:one more try|1 more try|one more|retry|try again|another try)$/.test(t)) return { value: 'retry' }
  if (/^(?:drop(?: it)?|kill)$/.test(t)) return { value: 'drop' }
  return { error: `decision "${raw.trim()}" is not Make 3 variations, Keep, One more try, Drop or none` }
}

// A post URL: kept as typed (trimmed), never fetched.
export const readUrl = (raw: string): string => raw.trim().slice(0, 500)

// ── The CSV, by row_id (or the Studio's post id) ─────────────────────

export const RESULT_COLUMNS = ['row_id', 'post_id', 'account', 'post_url', 'posted_at', 'views_72h', 'follows_72h', 'saves_72h', 'shares_72h', 'decision', 'notes'] as const
export type ResultColumn = (typeof RESULT_COLUMNS)[number]
// Names a spreadsheet often uses for the same column.
const ALIASES: Record<string, ResultColumn> = {
  url: 'post_url', link: 'post_url', post_link: 'post_url', tiktok_url: 'post_url',
  posted: 'posted_at', posted_on: 'posted_at', date_posted: 'posted_at', post_date: 'posted_at',
  views: 'views_72h', follows: 'follows_72h', followers: 'follows_72h', new_followers: 'follows_72h', saves: 'saves_72h', shares: 'shares_72h',
  note: 'notes', account_tag: 'account', studio_id: 'post_id',
}
const header = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')

export interface ResultsCsvRow {
  line: number
  rowId: string; postId: string; account: string
  // Only what the row says: a blank cell leaves the field as it is.
  patch: Partial<PostResults>
  errors: string[]
}

export function readResultsCsv(text: string): { rows: ResultsCsvRow[]; unknown: string[]; missing: string[]; columns: ResultColumn[] } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], unknown: [], missing: ['row_id (or post_id)'], columns: [] }
  const head = table[0]!.map(header)
  const at = new Map<ResultColumn, number>()
  const unknown: string[] = []
  head.forEach((h, i) => {
    const col = ((RESULT_COLUMNS as readonly string[]).includes(h) ? h : ALIASES[h]) as ResultColumn | undefined
    if (col && !at.has(col)) at.set(col, i)
    else if (h && !col) unknown.push(table[0]![i]!.trim())
  })
  const missing = at.has('row_id') || at.has('post_id') ? [] : ['row_id (or post_id)']
  const cell = (r: string[], c: ResultColumn) => (at.has(c) ? (r[at.get(c)!] ?? '') : '').trim()
  const rows: ResultsCsvRow[] = []
  table.slice(1).forEach((r, i) => {
    if (!r.some(c => c.trim())) return
    const errors: string[] = []
    const patch: Partial<PostResults> = {}
    const url = cell(r, 'post_url')
    if (url) patch.postUrl = readUrl(url)
    const posted = cell(r, 'posted_at')
    if (posted) {
      const v = readPostedAt(posted)
      if (v) patch.postedAt = v
      else errors.push(`posted_at "${posted}" is not a date (try 2026-10-19 21:14 or 10/19/2026 9:14 PM)`)
    }
    for (const f of NUMBER_FIELDS) {
      const raw = cell(r, FIELD_COLUMN[f] as ResultColumn)
      const v = readCount(raw)
      if ('error' in v) errors.push(`${FIELD_COLUMN[f]} ${v.error}`)
      else if (v.value !== undefined) patch[f] = v.value
    }
    const dec = readDecision(cell(r, 'decision'))
    if ('error' in dec) errors.push(dec.error)
    else if (dec.value !== undefined) patch.decision = dec.value
    const notes = cell(r, 'notes')
    if (notes) patch.notes = notes.slice(0, 2000)
    const rowId = cell(r, 'row_id'), postId = cell(r, 'post_id')
    if (!rowId && !postId) errors.push('No row_id or post_id')
    rows.push({ line: i + 2, rowId, postId, account: cell(r, 'account').replace(/^@+/, ''), patch, errors })
  })
  return { rows, unknown, missing, columns: [...at.keys()] }
}

// What a patch changes on a post's results: each field whose value differs.
export function resultChanges(before: PostResults | null | undefined, patch: Partial<PostResults>): Array<{ field: ResultField; from: string; to: string }> {
  const b = before ?? emptyResults()
  const norm = (v: unknown) => (v === undefined || v === '' ? null : v)
  const show = (f: ResultField, v: unknown) => (norm(v) === null ? '' : f === 'decision' ? DECISION_LABEL[v as Decision] : f === 'postedAt' ? String(v).replace('T', ' ') : String(v))
  return RESULT_FIELDS.filter(f => f in patch && norm(patch[f]) !== norm(b[f]))
    .map(f => ({ field: f, from: show(f, b[f]), to: show(f, patch[f]) }))
}

// ── Totals and breakdowns ────────────────────────────────────────────

export interface ResultPost {
  id: string; name: string; kind: string
  accountTag: string; productId: string | null; productName: string
  characterId: string | null; characterName: string; topic: boolean
  structure: string | null
  // The bank line the post's words came from (UX-PLAN section 36, 29g):
  // the source comment, so Results shows which truths perform.
  truth?: { id: string; label: string } | null
  variationOf: string | null; momentId: string
  // The plan row's life or job (Weeks, the blend test; section 42 D).
  lifeOrJob?: string | null
  results: PostResults | null
}
export interface ResultRow { key: string; label: string; posts: number; views: number; follows: number; saves: number; shares: number; followsPerPost: number | null }
export type Dimension = 'account' | 'product' | 'character' | 'structure' | 'truth' | 'blend'
export const DIMENSION_LABEL: Record<Dimension, string> = { account: 'Account', product: 'Product', character: 'Character', structure: 'Hook structure', truth: 'Source truth', blend: 'Life or job' }

const keyOf = (p: ResultPost, d: Dimension): [string, string] => {
  if (d === 'account') return p.accountTag ? [p.accountTag, p.accountTag] : ['', 'No account']
  if (d === 'product') return p.productId ? [p.productId, p.productName || 'Product'] : ['', 'No product']
  if (d === 'character') return p.topic ? ['topic', 'No one (topic posts)'] : p.characterId ? [p.characterId, p.characterName || 'Character'] : ['', 'No character']
  if (d === 'blend') return p.lifeOrJob === 'life' ? ['life', 'Life'] : p.lifeOrJob === 'job' ? ['job', 'Job'] : ['', 'Not tagged']
  if (d === 'truth') return p.truth ? [p.truth.id, p.truth.label] : ['', 'Not from the line bank']
  return p.structure ? [p.structure, codeLabel(p.structure)] : ['', 'No structure']
}
const per = (follows: number, posts: number) => (posts ? Math.round((follows / posts) * 10) / 10 : null)

function total(list: ResultPost[], key = '', label = ''): ResultRow {
  const sum = (f: NumberField) => list.reduce((a, p) => a + (p.results?.[f] ?? 0), 0)
  const follows = sum('follows72h')
  return { key, label, posts: list.length, views: sum('views72h'), follows, saves: sum('saves72h'), shares: sum('shares72h'), followsPerPost: per(follows, list.length) }
}

// Follows per post is the headline (the playbook: decide by follows per post
// first, then saves and shares). A range keeps the posts whose posted_at day
// is in it; a post with results but no posted_at is counted apart.
export function aggregateResults(posts: ResultPost[], range: { from?: string | null; to?: string | null } = {}) {
  const withResults = posts.filter(p => hasResults(p.results))
  const ranged = !!(range.from || range.to)
  const inRange = (p: ResultPost) => {
    const day = (p.results?.postedAt ?? '').slice(0, 10)
    if (!ranged) return true
    if (!day) return false
    return (!range.from || day >= range.from) && (!range.to || day <= range.to)
  }
  const list = withResults.filter(inRange)
  const by = (d: Dimension): ResultRow[] => {
    const groups = new Map<string, { label: string; posts: ResultPost[] }>()
    for (const p of list) {
      const [k, label] = keyOf(p, d)
      const g = groups.get(k) ?? { label, posts: [] }
      g.posts.push(p)
      groups.set(k, g)
    }
    return [...groups.entries()].map(([k, g]) => total(g.posts, k, g.label))
      .sort((a, b) => (b.followsPerPost ?? -1) - (a.followsPerPost ?? -1) || b.posts - a.posts || a.label.localeCompare(b.label))
  }
  return {
    totals: total(list),
    undated: ranged ? withResults.filter(p => !(p.results?.postedAt ?? '')).length : 0,
    by: { account: by('account'), product: by('product'), character: by('character'), structure: by('structure'), truth: by('truth'), blend: by('blend') },
  }
}

// ── Hook families and the decision hints ─────────────────────────────

// A hook family: a post and its variations (variation_of, the Studio's
// family), joined with every post that shares its plan moment (moment_id:
// a plan row, its variations and Make another like this keep it). The key
// of each post's family.
export function hookFamilies(posts: Array<{ id: string; variationOf: string | null; momentId: string }>): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  for (const p of posts) {
    parent.set(p.id, parent.get(p.id) ?? p.id)
    if (p.variationOf) join(p.id, `post:${p.variationOf}`)
    else join(p.id, `post:${p.id}`)
    if (p.momentId.trim()) join(p.id, `moment:${p.momentId.trim().toLowerCase()}`)
  }
  return new Map(posts.map(p => [p.id, find(p.id)]))
}

export interface ResultThresholds { variationsViews: number; variationsCount: number; dropViews: number; dropPosts: number }
export interface ResultHint { kind: 'variations' | 'drop'; text: string; posts?: string[] }

// "50K", "1K", "1.5M", "980".
export function shortCount(n: number): string {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`.replace('.0M', 'M')
  if (n >= 1e3) return `${Math.round(n / 1e2) / 10}K`.replace('.0K', 'K')
  return String(n)
}
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
export const variationsHint = (t: ResultThresholds) => `${shortCount(t.variationsViews)}+ views: make ${t.variationsCount} variations`
export const dropHint = (t: ResultThresholds) => `Under ${shortCount(t.dropViews)} ${times(t.dropPosts)}: drop the hook family`

// Hints, never automatic: a post at the variations line or over it, and
// every post of a hook family with dropPosts posts (or more) under the drop
// line. Keyed by post id.
export function resultHints(posts: Array<{ id: string; variationOf: string | null; momentId: string; results: PostResults | null }>, t: ResultThresholds): Record<string, ResultHint[]> {
  const fam = hookFamilies(posts)
  const low = new Map<string, string[]>()
  for (const p of posts) {
    const v = p.results?.views72h
    if (typeof v === 'number' && v < t.dropViews) { const k = fam.get(p.id)!; low.set(k, [...(low.get(k) ?? []), p.id]) }
  }
  const out: Record<string, ResultHint[]> = {}
  for (const p of posts) {
    const hints: ResultHint[] = []
    const v = p.results?.views72h
    if (typeof v === 'number' && v >= t.variationsViews) hints.push({ kind: 'variations', text: variationsHint(t) })
    const under = low.get(fam.get(p.id)!) ?? []
    if (under.length >= t.dropPosts) hints.push({ kind: 'drop', text: dropHint(t), posts: under })
    if (hints.length) out[p.id] = hints
  }
  return out
}
