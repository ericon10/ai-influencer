import { parseCsv } from './csvImport.js'
import { readCode, readEffect } from './playbook.js'
import { emptySpecial, fullSpecial, genericNames, type SpecialSlide, type SpecialType } from './slides.js'

// The launch plan import (owner, 2026-10-16; UX-PLAN.md section 28): a CSV
// with the columns of docs/content/launch-plan-v2-posts.csv, one row per
// post. Pure: reading the file, what each row becomes, the scene split into
// each slide's shot, and the checks the free preview shows. Prices, the
// characters and the posts are the caller's (server/pipeline/planImport.ts).

// product: the product's name (blank: the plan's pick); ad: yes or no
// (UX-PLAN.md section 29). An older file's product column of yes or no is
// read as the ad column, and the plan's pick sets the product.
export const PLAN_COLUMNS = [
  'row_id', 'date', 'slot', 'account', 'format', 'tension', 'pillar', 'audience', 'product', 'ad', 'mention_mother',
  'structure', 'effect_open', 'effect_payoff', 'hook_score', 'moment_id', 'moment', 'hook', 'alt_hook',
  'slide_2', 'slide_3', 'slide_4', 'slide_5', 'slide_6', 'scene', 'clip_action', 'caption', 'hashtags', 'cta', 'stat_source', 'notes',
  // The scene in its own columns (owner, 2026-10-22; UX-PLAN.md section 35,
  // item 6), over what the scene cell says, and each slide's own image line
  // (item 11). All optional.
  'place', 'light', 'outfit', 'detail_1', 'detail_2',
  'slide_1_image', 'slide_2_image', 'slide_3_image', 'slide_4_image', 'slide_5_image', 'slide_6_image',
] as const
export type PlanColumn = (typeof PLAN_COLUMNS)[number]
const REQUIRED: PlanColumn[] = ['row_id', 'date', 'account', 'format', 'hook']

// What a row becomes, by its format: a feeder's slideshow (topic: no one
// in the photos), a character's slideshow, a character's photo (a
// one-slide character slideshow) or a character's clip (a video post).
export type PlanKind = 'topic_slideshow' | 'character_slideshow' | 'photo' | 'clip'
export function planKind(format: string): PlanKind | null {
  const f = format.trim().toLowerCase()
  if (f === 'character slideshow') return 'character_slideshow'
  if (f === 'character photo') return 'photo'
  if (f === 'character clip') return 'clip'
  if (/slideshow/.test(f)) return 'topic_slideshow'
  return null
}
export const isCharacterKind = (k: PlanKind) => k !== 'topic_slideshow'

export interface PlanRow { line: number; cells: Record<PlanColumn, string> }

export function readPlan(text: string): { rows: PlanRow[]; missing: string[]; unknown: string[] } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], missing: [...REQUIRED], unknown: [] }
  const header = table[0]!.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const at = new Map<string, number>()
  header.forEach((h, i) => { if (!at.has(h)) at.set(h, i) })
  const missing = REQUIRED.filter(c => !at.has(c))
  const unknown = header.filter(h => h && !(PLAN_COLUMNS as readonly string[]).includes(h))
  const rows = table.slice(1).map((r, i) => ({
    line: i + 2,
    cells: Object.fromEntries(PLAN_COLUMNS.map(c => [c, (at.has(c) ? r[at.get(c)!] ?? '' : '').trim()])) as Record<PlanColumn, string>,
  })).filter(r => Object.values(r.cells).some(Boolean))
  return { rows, missing, unknown }
}

// ── The scene, split ──────────────────────────────────────────────────

export interface SceneParts { common: string; slides: Record<number, string>; outfit: string; hair: string }

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,;:.]+|[\s,;]+$/g, '').trim()

// "Slide 1: ...", "Slides 2 to 5: ...", "slide 2 a kitchen ...; slide 3
// ...", and a character set's numbered stills ("Six stills, same framing:
// 1 sitting up in bed; 2 ..."). What comes before the first marker (and
// after the last slide's own words, when it is a closing note) is the part
// every photo shares. "Outfit:" and "Hair:" are taken out for the scene.
export function sceneParts(scene: string): SceneParts {
  let text = scene.replace(/\s+/g, ' ').trim()
  let outfit = '', hair = ''
  const o = text.match(/\bOutfit:\s*(.+?)(?=\s*\bHair:|$)/i)
  if (o) { outfit = tidy(o[1]!); text = text.replace(o[0], ' ') }
  const h = text.match(/\bHair:\s*(.+?)(?=\s*\bOutfit:|$)/i)
  if (h) { hair = tidy(h[1]!); text = text.replace(h[0], ' ') }
  text = text.replace(/^character (?:slideshow|photo|clip),?\s*(?:\d+:\d+,?\s*)?(?:locked scene:)?/i, '').trim()
  const slides: Record<number, string> = {}
  const markers = [...text.matchAll(/\b[Ss]lides?\s+(\d{1,2})(?:\s*(?:to|-|and)\s*(\d{1,2}))?\s*:?/g)]
  if (markers.length) {
    const common = tidy(text.slice(0, markers[0]!.index))
    markers.forEach((m, i) => {
      const end = i + 1 < markers.length ? markers[i + 1]!.index! : text.length
      const body = tidy(text.slice(m.index! + m[0].length, end))
      const from = Number(m[1]), to = m[2] ? Number(m[2]) : from
      for (let k = from; k <= Math.min(to, from + 11); k++) slides[k] = body
    })
    return { common, slides, outfit, hair }
  }
  // A character set: "Six stills, same framing: 1 ...; 2 ...;"
  const set = text.match(/\b(?:\w+\s+)?stills?,?[^:]*:\s*(1\s.+)$/i)
  if (set) {
    const common = tidy(text.slice(0, set.index))
    for (const part of set[1]!.split(/;\s*/)) {
      const m = part.match(/^\s*(\d{1,2})\s+(.+)$/)
      if (m) slides[Number(m[1])] = tidy(m[2]!)
    }
    return { common, slides, outfit, hair }
  }
  return { common: tidy(text), slides, outfit, hair }
}

// The scene of a row: the scene cell split, with the place, light, outfit
// and detail columns over it (item 6), and each slide's image line, its own
// column first (slide_N_image, item 11), else "Slide N:" in the scene cell.
// A photo row's one slide is its moment.
export interface RowScene { place: string; light: string; outfit: string; hair: string; details: string[]; lines: Record<number, string>; own: Record<number, boolean> }
export function rowScene(c: Record<PlanColumn, string>, kind: PlanKind | null): RowScene {
  const parts = sceneParts(c.scene)
  const lines: Record<number, string> = {}, own: Record<number, boolean> = {}
  for (let i = 1; i <= 6; i++) {
    const col = tidy(c[`slide_${i}_image` as PlanColumn] ?? '')
    const line = col || parts.slides[i] || ''
    if (line) { lines[i] = line; own[i] = true }
  }
  if (kind === 'photo' && !lines[1] && c.moment.trim()) lines[1] = tidy(c.moment)
  return {
    place: tidy(c.place) || parts.common, light: tidy(c.light), outfit: tidy(c.outfit) || parts.outfit, hair: parts.hair,
    details: [c.detail_1, c.detail_2].map(tidy).filter(Boolean), lines, own,
  }
}

// ── Mock screens the Studio draws ─────────────────────────────────────

// A slide's words that describe one of the screens the Studio draws (a
// switch in the preview, off by default): the type, and the quoted words
// placed in its fields. Anything the words do not say stays empty.
const SPECIAL_WORDS: Array<[SpecialType, RegExp]> = [
  ['museum_placard', /\b(?:placard|museum label|label card|wall label)\b/i],
  ['lock_screen', /\block ?screen\b/i],
  ['calendar_invite', /\bcalendar (?:invite|notification)s?\b|\binvite card\b|\bmeeting invite\b/i],
  ['receipt', /\b(?:invoice|receipt)\b/i],
  ['bank_app', /\b(?:bank|savings) app\b|\bbank statement\b/i],
  ['survey', /\bsurvey\b|\b0 to 10\b/i],
  ['portal_status', /\b(?:package tracker|status timeline|status page)\b|\btimeline\b.*\b(?:portal|application|candidate)\b/i],
  ['application_form', /\bmock (?:application|form)\b|\bapplication form\b|\bpage \d+ of \d+\b/i],
  ['profile_card', /\bprofile (?:card|banner|update)\b/i],
  ['text_thread', /\b(?:text thread|group chat|text bubbles?|message thread)\b/i],
  ['notification', /\bnotification\b/i],
  ['job_posting', /\b(?:job (?:posting|listing|card)|mock posting|posting card|listing card)\b/i],
  ['rejection_email', /\bmock (?:dark mode )?(?:e-?mail|inbox)\b|\bopened (?:mock )?e-?mail\b/i],
]
const quoted = (s: string) => [...s.matchAll(/(?:^|[\s(:,])['"‘“]([^'"’”]{2,160}?)['"’”](?=$|[\s.,;:)!?])/g)].map(m => m[1]!.trim())
const timeIn = (s: string) => s.match(/\b\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)?\b/)?.[0] ?? ''

export function specialFor(desc: string, names: { brands: string[]; generic: string[] }): SpecialSlide | null {
  const type = SPECIAL_WORDS.find(([, re]) => re.test(desc))?.[0]
  if (!type) return null
  const q = quoted(desc).map(t => genericNames(t, names.brands, names.generic))
  const base = { ...fullSpecial({ type }), variant: emptySpecial(type).variant, count: type === 'survey' ? -1 : 0 }
  const first = q[0] ?? '', rest = q.slice(1)
  switch (type) {
    case 'notification': return { ...base, from: '', title: rest.length ? first : '', body: rest.length ? rest.join(' ') : first, time: timeIn(desc) }
    case 'lock_screen': return { ...base, time: timeIn(desc), lines: q }
    case 'text_thread': return { ...base, lines: q }
    case 'calendar_invite': return { ...base, title: first, time: timeIn(desc), lines: [], body: rest.join(' ') }
    case 'receipt': return { ...base, variant: /receipt/i.test(desc) ? 'receipt' : 'invoice', title: first, lines: rest }
    case 'museum_placard': return { ...base, title: first, body: rest.join(' ') }
    case 'survey': return { ...base, title: first }
    case 'portal_status': return { ...base, title: first, lines: rest }
    case 'application_form': return { ...base, title: first, lines: rest, variant: /filled|typed|autofill/i.test(desc) ? 'filled' : 'empty' }
    case 'profile_card': return { ...base, from: first, body: rest.join(' ') }
    case 'bank_app': return { ...base, title: first, lines: rest, blur: /blur/i.test(desc) }
    case 'job_posting': return { ...base, title: first, lines: rest }
    default: return { ...base, title: first, body: rest.join(' ') }
  }
}

// A shot line that is mostly on-screen text (item 10): a screen the words
// name (a job posting, an email, a text thread, a bank app...) and either
// "mock", or quoted words making up a good share of the line, or the screen
// named in its first words. A person doing something with a screen in the
// background stays a photo.
export function screenFor(line: string, names: { brands: string[]; generic: string[] }): SpecialSlide | null {
  const sp = specialFor(line, names)
  if (!sp) return null
  const quotedChars = quoted(line).join('').length
  const head = line.split(/\s+/).slice(0, 8).join(' ')
  const mostly = /\bmock\b/i.test(line) || quotedChars / Math.max(1, line.length) >= 0.2 || SPECIAL_WORDS.some(([t, re]) => t === sp.type && re.test(head))
  return mostly ? sp : null
}

// A line naming one of the account's products (item 15): that picture is
// the owner's own screenshot, never generated or priced.
export function namesProduct(line: string, products: string[]): string | null {
  return products.find(p => p.trim().length >= 3 && new RegExp(`\\b${p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line)) ?? null
}

// ── A row checked ─────────────────────────────────────────────────────

const yes = (s: string) => /^(?:y|yes|true|1)$/i.test(s.trim())
export const planYes = yes
const YES_NO = /^(?:y|yes|true|1|n|no|false|0)$/i
const SLOTS = ['am', 'pm', 'daily']

export interface CheckedRow {
  line: number; rowId: string; date: string; slot: string; account: string; format: string; kind: PlanKind | null
  hook: string; slides: string[]
  // An ad for its product (#ad, the honest endings), and the product the
  // row names ('' : the plan's pick). Separate (section 29).
  ad: boolean; productName: string
  code: ReturnType<typeof readCode>; effectOpen: ReturnType<typeof readEffect>; effectPayoff: ReturnType<typeof readEffect>; score: number | null
  errors: string[]; warnings: string[]
}

export function checkRow(r: PlanRow): CheckedRow {
  const c = r.cells
  const errors: string[] = [], warnings: string[] = []
  const kind = planKind(c.format)
  if (!c.row_id) errors.push('No row_id')
  if (!c.account) errors.push('No account')
  if (!c.hook) errors.push('No hook')
  if (!kind) errors.push(c.format ? `Format "${c.format}" is not one the Studio makes (slideshow list, slideshow story, mock UI slideshow, stat slideshow, character slideshow, character photo, character clip)` : 'No format')
  if (c.date && !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) errors.push(`Date "${c.date}" is not YYYY-MM-DD`)
  if (!c.date) warnings.push('No date: it goes at the end of the plan')
  if (c.slot && !SLOTS.includes(c.slot.toLowerCase())) warnings.push(`Slot "${c.slot}" is not AM, PM or Daily`)
  const slides = (['slide_2', 'slide_3', 'slide_4', 'slide_5', 'slide_6'] as const).map(k => c[k])
  if (kind === 'topic_slideshow' || kind === 'character_slideshow') {
    if (slides.every(s => !s)) errors.push('A slideshow row has no slides 2 to 6')
    else if (slides.some(s => !s)) warnings.push(`Slide${slides.filter(s => !s).length === 1 ? '' : 's'} ${slides.map((s, i) => (s ? null : i + 2)).filter(Boolean).join(', ')} empty`)
  }
  // The free pre-check (item 16): rows that would make bad pictures are
  // blocked, with the fix. A character post needs its outfit (feeder rows
  // may leave the scene blank); every photo slide needs its shot line.
  const sc = rowScene(c, kind)
  if (kind && kind !== 'topic_slideshow' && !sc.outfit) errors.push('A character post needs an outfit: fill the outfit column (or "Outfit:" in the scene)')
  if (kind === 'topic_slideshow' || kind === 'character_slideshow') {
    const texts = [c.hook, ...slides]
    while (texts.length > 1 && !texts[texts.length - 1]!.trim()) texts.pop()
    const bare = texts.map((t, i) => (!sc.lines[i + 1] ? i + 1 : null)).filter((n): n is number => n !== null)
    if (bare.length) errors.push(`Slide${bare.length === 1 ? '' : 's'} ${bare.join(', ')} ${bare.length === 1 ? 'has' : 'have'} no shot line: fill slide_N_image (or "Slide N:" in the scene)`)
  }
  if (kind === 'photo' && !sc.lines[1]) errors.push('A photo row has no shot line: fill slide_1_image or the moment')
  if (kind === 'clip' && !c.clip_action) warnings.push('A clip row with no clip_action: write the motion in the post')
  const code = readCode(c.structure)
  if (c.structure && !code) warnings.push(`Structure "${c.structure}" is not a code S1 to S12 or L13 to L25`)
  const effectOpen = readEffect(c.effect_open), effectPayoff = readEffect(c.effect_payoff)
  if (c.effect_open && !effectOpen) warnings.push(`effect_open "${c.effect_open}" is not E1 to E8`)
  if (c.effect_payoff && !effectPayoff) warnings.push(`effect_payoff "${c.effect_payoff}" is not E1 to E8`)
  const n = Number(c.hook_score)
  const score = c.hook_score && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
  if (c.hook_score && score === null) warnings.push(`hook_score "${c.hook_score}" is not 1 to 5`)
  if (score && score > 2) warnings.push(`hook_score ${score}: only a 1 or 2 ships (playbook)`)
  // The product and the ad switch (section 29). An older file's product
  // column of yes or no is the ad switch, with the plan's pick as the product.
  const older = YES_NO.test(c.product)
  if (c.ad && !YES_NO.test(c.ad)) warnings.push(`ad "${c.ad}" is not yes or no: read as no`)
  const ad = c.ad ? yes(c.ad) : older ? yes(c.product) : false
  const productName = older ? '' : c.product.trim()
  return { line: r.line, rowId: c.row_id, date: c.date, slot: c.slot, account: c.account.replace(/^@+/, ''), format: c.format, kind, hook: c.hook, slides, ad, productName, code, effectOpen, effectPayoff, score, errors, warnings }
}

// Schedule order (day, then AM, Daily, PM, then the file's order), and the
// rows whose account used the same structure on its post before.
const SLOT_RANK: Record<string, number> = { am: 0, daily: 1, pm: 2 }
export function scheduleOrder<T extends { date: string; slot: string; line: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (SLOT_RANK[a.slot.toLowerCase()] ?? 1) - (SLOT_RANK[b.slot.toLowerCase()] ?? 1) || a.line - b.line)
}
export function repeatedCodes(rows: CheckedRow[]): Set<number> {
  const out = new Set<number>()
  const last = new Map<string, string | null>()
  for (const r of scheduleOrder(rows)) {
    const key = r.account.toLowerCase()
    if (r.code && last.get(key) === r.code) out.add(r.line)
    if (r.code) last.set(key, r.code)
  }
  return out
}

export const hashtagsOf = (s: string) => s.split(/[\s,]+/).map(h => h.replace(/^#+/, '').trim()).filter(Boolean)
