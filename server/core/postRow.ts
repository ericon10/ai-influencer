import { plain } from './lineBank.js'

// Line first, both doors (owner, 2026-10-23; UX-PLAN.md rule 2 and section
// 43): a New post and a Weeks row are the same record (line_id, place_id,
// still, video, sound, caption). Pure: a post's line and place read from
// its spec, the same way for both doors, and the place fit (which places
// of a bank suit a line: its words and the bank's themes). Storage is the
// caller's (server/pipeline/postRow.ts).

// How a post got its line: from the bank (picked or drawn), written by the
// owner, deliberately none (a pure visual post), or not yet.
export type LineMode = 'bank' | 'own' | 'none' | null

export interface PostLine { text: string; lineId: string | null; mode: LineMode }

type Spec = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

// The on-screen line: a slideshow's slide 1 (its hook), a video post's
// caption (the on-screen line).
export function postLine(kind: string, spec: Spec | null | undefined): PostLine {
  const s = (spec ?? {}) as { hook?: unknown; caption?: unknown; lineMode?: unknown; week?: { lineId?: unknown } | null; plan?: { lineId?: unknown } | null }
  const text = str(kind === 'slideshow' ? s.hook : s.caption).trim()
  const lineId = str(s.week?.lineId) || str(s.plan?.lineId) || null
  const mode: LineMode = lineId && text ? 'bank' : text ? 'own' : s.lineMode === 'none' ? 'none' : null
  return { text, lineId: text ? lineId : null, mode }
}

// The post's place: a faceless post's place, a text post's dimmed place,
// or the plan row's place_id.
export function postPlace(spec: Spec | null | undefined): string | null {
  const s = (spec ?? {}) as { faceless?: { placeId?: unknown } | null; card?: { placeId?: unknown } | null; plan?: { placeId?: unknown } | null }
  return str(s.faceless?.placeId) || str(s.card?.placeId) || str(s.plan?.placeId) || null
}

// ── The place fit ─────────────────────────────────────────────────────

// A theme ties a kind of line to a kind of place (config/content.yaml,
// weeks.place_themes): a money line (rent, broke, $40) suits the gas
// station, the register, the roller grill. Words are matched whole, on the
// plain text; a word ending in * matches its start ("pay*" is pay, paycheck).
export interface PlaceTheme { id: string; line: string[]; place: string[] }
export interface FitPlace { id: string; name: string; line: string }
export interface PlaceScore { id: string; score: number; words: string[]; themes: string[] }

const STOP = new Set(['that', 'this', 'with', 'from', 'they', 'them', 'have', 'just', 'what', 'when', 'your', 'into', 'over', 'were', 'been', 'there', 'their', 'then', 'than', 'about', 'still', 'only', 'even', 'like', 'some', 'very', 'iphone', 'photo', 'vertical', 'upright', 'portrait', 'level', 'unedited', 'sharp', 'real', 'phone', 'grain', 'muted', 'color', 'people', 'natural', 'little', 'underexposed'])
const wordsOf = (s: string) => new Set(plain(s).split(' ').filter(w => w.length > 3 && !STOP.has(w)))

function hits(text: string, list: string[]): boolean {
  const p = ` ${plain(text)} `
  return list.some(w => {
    const k = plain(w.replace(/\*$/, ''))
    if (!k) return false
    return w.endsWith('*') ? p.includes(` ${k}`) : p.includes(` ${k} `)
  })
}

// A line that names an amount of money ($40, 400 dollars) is a money line
// even with none of the theme's words.
const MONEY = /\$\s?\d|\b\d+\s?(?:dollars|bucks)\b/i

export function themesOf(text: string, themes: PlaceTheme[], side: 'line' | 'place'): string[] {
  return themes.filter(t => hits(text, side === 'line' ? t.line : t.place) || (side === 'line' && t.id === 'money' && MONEY.test(text))).map(t => t.id)
}

// Every place scored for a line: 3 per theme the line and the place share,
// 1 per word they share; ties keep the bank's order (the caller breaks them
// by use). A post with no line scores every place 0.
export function placeFit(line: string, places: FitPlace[], themes: PlaceTheme[]): PlaceScore[] {
  const text = line.trim()
  if (!text) return places.map(p => ({ id: p.id, score: 0, words: [], themes: [] }))
  const lw = wordsOf(text)
  const lt = new Set(themesOf(text, themes, 'line'))
  return places.map(p => {
    const where = `${p.name} ${p.line}`
    const pw = wordsOf(where)
    const words = [...lw].filter(w => pw.has(w))
    const shared = themesOf(where, themes, 'place').filter(t => lt.has(t))
    return { id: p.id, score: shared.length * 3 + words.length, words, themes: shared }
  })
}

// The places in the order to suggest them: the best fit first, then the
// least used, then the bank's order.
export function rankPlaces(line: string, places: FitPlace[], themes: PlaceTheme[], use: Map<string, number> = new Map()): PlaceScore[] {
  const order = new Map(places.map((p, i) => [p.id, i]))
  return placeFit(line, places, themes).sort((a, b) => b.score - a.score || (use.get(a.id) ?? 0) - (use.get(b.id) ?? 0) || order.get(a.id)! - order.get(b.id)!)
}

// Why a place is suggested, in a few words for its card.
export function fitWhy(s: PlaceScore): string {
  if (!s.score) return ''
  return [s.themes.length ? `fits a ${s.themes.join(' and ')} line` : '', s.words.length ? `shares "${s.words.slice(0, 3).join('", "')}"` : ''].filter(Boolean).join('; ')
}

// Who and what first (UX-PLAN.md section 45): the owner's two picks. An
// older post (no picks recorded) counts as picked.
export interface Picks { character: boolean; product: boolean }
export function picksOf(spec: Spec | null | undefined): Picks {
  const p = ((spec ?? {}) as { picks?: Partial<Picks> | null }).picks
  return p ? { character: p.character !== false, product: p.product !== false } : { character: true, product: true }
}
export const picksDone = (spec: Spec | null | undefined) => { const p = picksOf(spec); return p.character && p.product }

// A plan row's product cell: a name, "none" / "No product" (a real choice of
// no product), or blank (not named: flagged, never filled in for it).
export function readProductCell(raw: string): { kind: 'name'; name: string } | { kind: 'none' } | { kind: 'blank' } {
  const v = raw.trim()
  if (!v) return { kind: 'blank' }
  if (/^(?:none|no product|no_product|-)$/i.test(v)) return { kind: 'none' }
  return { kind: 'name', name: v }
}

// A New post's row id when it joins a week: NP plus four characters.
export function newPostRowId(postId: string): string {
  const tail = postId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()
  return `NP${tail.padStart(4, '0')}`
}
