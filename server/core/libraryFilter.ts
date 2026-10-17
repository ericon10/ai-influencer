// Library filters (UX-PLAN.md section 34): the Stills and Clips tabs'
// filters as the page's address keeps them (each tab its own, as
// `stills.model=...`), the API query the browser sends, and the same query
// read back and checked on the server. Shared by the browser and the server;
// no imports, so both can use it.

export type LibraryTab = 'stills' | 'clips'
export type DatePreset = 'today' | '7d' | '30d' | 'range'
export type UsedFilter = 'used' | 'unused'

export interface LibraryFilter {
  // A model ref (for example "higgsfield/nano-banana-2"), or one of the two
  // kinds that ran no model: "upload" (uploaded) or "studio" (made on the
  // Studio for free: a crop, a mirror, a last frame, a joined clip).
  model: string | null
  date: DatePreset | null
  // A custom range, as YYYY-MM-DD days (both ends included).
  from: string | null
  to: string | null
  used: UsedFilter | null
  // A product's id (section 29): made in or used by a post of that product.
  product: string | null
  // A collection's id.
  set: string | null
}

export const EMPTY_FILTER: LibraryFilter = { model: null, date: null, from: null, to: null, used: null, product: null, set: null }
export const FILTER_KEYS = ['model', 'date', 'from', 'to', 'used', 'product', 'set'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

export const MODEL_UPLOAD = 'upload'
export const MODEL_STUDIO = 'studio'
export const DATE_LABEL: Record<Exclude<DatePreset, 'range'>, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' }
export const USED_LABEL: Record<UsedFilter, string> = { used: 'Used in a post', unused: 'Not used' }

const MODEL_RE = /^[a-z0-9][a-z0-9_.:/-]{0,79}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const SET_RE = /^col_[0-9a-z]{8,40}$/
export const PRODUCT_RE = /^prd_[0-9a-z]{8,40}$/

const day = (v: string | null | undefined): string | null => (v && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null)

// The address: each tab keeps its own filters under its own prefix. A value
// that does not read is dropped, never an error.
export function filterFromParams(params: { get(key: string): string | null }, tab: LibraryTab): LibraryFilter {
  const get = (k: FilterKey) => params.get(`${tab}.${k}`)
  const model = get('model')
  const date = get('date')
  const used = get('used')
  const product = get('product')
  const set = get('set')
  const preset = (['today', '7d', '30d', 'range'] as const).find(d => d === date) ?? null
  const from = preset === 'range' ? day(get('from')) : null
  const to = preset === 'range' ? day(get('to')) : null
  return {
    model: model && MODEL_RE.test(model) ? model : null,
    date: preset === 'range' && !from && !to ? null : preset,
    from, to,
    used: used === 'used' || used === 'unused' ? used : null,
    product: product && PRODUCT_RE.test(product) ? product : null,
    set: set && SET_RE.test(set) ? set : null,
  }
}

// The address keys to change for a filter change (null removes a key).
export function filterParams(tab: LibraryTab, patch: Partial<LibraryFilter>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const k of FILTER_KEYS) if (k in patch) out[`${tab}.${k}`] = patch[k] ?? null
  // Leaving the custom range clears its days.
  if ('date' in patch && patch.date !== 'range') { out[`${tab}.from`] = null; out[`${tab}.to`] = null }
  return out
}

export const isFiltered = (f: LibraryFilter) => FILTER_KEYS.some(k => f[k] != null)

// The dates as moments, in the browser's own day: Today starts at local
// midnight; a custom range runs from the start of its first day to the end
// of its last.
export function rangeOf(f: LibraryFilter, now: Date): { from: Date | null; to: Date | null } {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const localDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!) }
  if (f.date === 'today') return { from: midnight(now), to: null }
  if (f.date === '7d') return { from: new Date(now.getTime() - 7 * 86_400_000), to: null }
  if (f.date === '30d') return { from: new Date(now.getTime() - 30 * 86_400_000), to: null }
  if (f.date === 'range') {
    const end = f.to ? localDay(f.to) : null
    return { from: f.from ? localDay(f.from) : null, to: end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : null }
  }
  return { from: null, to: null }
}

// The API's query for one tab.
export function libraryQueryString(tab: LibraryTab, characterId: string | null, f: LibraryFilter, now: Date): string {
  const q = new URLSearchParams()
  q.set('type', tab === 'stills' ? 'still' : 'clip')
  if (characterId) q.set('characterId', characterId)
  if (f.model) q.set('model', f.model)
  const r = rangeOf(f, now)
  if (r.from) q.set('from', r.from.toISOString())
  if (r.to) q.set('to', r.to.toISOString())
  if (f.used) q.set('used', f.used)
  if (f.product) q.set('product', f.product)
  if (f.set) q.set('set', f.set)
  return q.toString()
}

// ── The server's side ─────────────────────────────────────────────────

export interface LibraryQuery {
  type: 'still' | 'clip' | null
  characterId: string | null
  model: string | null
  from: Date | null
  to: Date | null
  used: UsedFilter | null
  product: string | null
  set: string | null
}

export class FilterError extends Error {}

// Reads the API's query. A value that is there but does not read is an
// error with a plain message (the page only sends what it can read).
export function parseLibraryQuery(q: Record<string, string | undefined>): LibraryQuery {
  const v = (k: string) => { const x = q[k]; return x == null || x === '' ? null : x }
  const type = v('type')
  if (type && type !== 'still' && type !== 'clip') throw new FilterError('The type is a still or a clip.')
  const characterId = v('characterId')
  if (characterId && !/^chr_[0-9a-z]{8,40}$/.test(characterId)) throw new FilterError('That character is not one of yours.')
  const model = v('model')
  if (model && !MODEL_RE.test(model)) throw new FilterError('That model name does not read.')
  const when = (k: 'from' | 'to') => {
    const x = v(k)
    if (!x) return null
    const t = Date.parse(x)
    if (Number.isNaN(t)) throw new FilterError(`The ${k === 'from' ? 'start' : 'end'} date does not read.`)
    return new Date(t)
  }
  const from = when('from'), to = when('to')
  if (from && to && from >= to) throw new FilterError('The start date is after the end date.')
  const used = v('used')
  if (used && used !== 'used' && used !== 'unused') throw new FilterError('Used is "used" or "unused".')
  const product = v('product')
  if (product && !PRODUCT_RE.test(product)) throw new FilterError('That product does not exist.')
  const set = v('set')
  if (set && !SET_RE.test(set)) throw new FilterError('That collection does not exist.')
  return { type: type as LibraryQuery['type'], characterId, model, from, to, used: used as UsedFilter | null, product, set }
}

export const hasFilter = (q: LibraryQuery) => !!(q.type || q.model || q.from || q.to || q.used || q.product || q.set)

// ── Chips ─────────────────────────────────────────────────────────────

const shortDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// One chip for each active filter, in a fixed order; the key is what its x
// clears (the date chip clears the range with it).
export type ChipKey = 'model' | 'date' | 'used' | 'product' | 'set'
export function filterChips(f: LibraryFilter, names: { model: (id: string) => string; product: (id: string) => string; set: (id: string) => string }): Array<{ key: ChipKey; label: string }> {
  const out: Array<{ key: ChipKey; label: string }> = []
  if (f.model) out.push({ key: 'model', label: `Model: ${names.model(f.model)}` })
  if (f.date === 'range') out.push({ key: 'date', label: f.from && f.to ? `${shortDay(f.from)} to ${shortDay(f.to)}` : f.from ? `From ${shortDay(f.from)}` : `To ${shortDay(f.to!)}` })
  else if (f.date) out.push({ key: 'date', label: DATE_LABEL[f.date] })
  if (f.used) out.push({ key: 'used', label: USED_LABEL[f.used] })
  if (f.product) out.push({ key: 'product', label: `Product: ${names.product(f.product)}` })
  if (f.set) out.push({ key: 'set', label: `Collection: ${names.set(f.set)}` })
  return out
}
