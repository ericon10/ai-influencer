import type { FileSection } from './character.js'

// The brand layer of a character file (character template v1.6, Part B:
// Brand, Why people watch, Accounts, Winning stack, Growth log). It lives
// in the file's own sections, so the file stays the source of truth: the
// character page reads it from there and writes each change back into the
// same bullet, keeping every other line as written (owner, 2026-10-15,
// long run part 3).

export interface BrandLayer {
  // Brand
  interest: string
  subInterest: string
  arc: string
  statement: string
  // Why people watch
  series: string[]
  runningBits: string[]
  cast: string[]
  payoff: string
  howTheyFilm: string
  // Accounts, as written (main, interest account, bio, link note).
  accounts: string
  // Every post carries it for the next 30 days.
  winningStack: string[]
  // One line per monthly review, oldest first as in the file.
  growthLog: string[]
}

export type BrandPatch = Partial<BrandLayer>

// Each field: its section, the template's title for a new one, and the
// bullet key ("Brand statement: ...").
const KEYED: Array<{ field: keyof BrandLayer; section: 'brand' | 'watch'; key: string; re: RegExp; list?: boolean }> = [
  { field: 'interest', section: 'brand', key: 'Interest', re: /^interest$/ },
  { field: 'subInterest', section: 'brand', key: 'Sub-interest', re: /^sub[- ]?interest\b/ },
  { field: 'arc', section: 'brand', key: 'Arc', re: /^arc$/ },
  { field: 'statement', section: 'brand', key: 'Brand statement', re: /^brand statement$/ },
  { field: 'series', section: 'watch', key: 'Series', re: /^series$/, list: true },
  { field: 'runningBits', section: 'watch', key: 'Running bits', re: /^running bits?$/, list: true },
  { field: 'cast', section: 'watch', key: 'Cast', re: /^cast$/, list: true },
  { field: 'payoff', section: 'watch', key: 'Payoff style', re: /^payoff\b/ },
  { field: 'howTheyFilm', section: 'watch', key: 'How they film', re: /^how (?:they|she|he) films?$/ },
]

const SECTIONS = {
  brand: { title: 'Brand', re: /^brand\b/ },
  watch: { title: 'Why people watch', re: /^why people watch\b/ },
  accounts: { title: 'Accounts', re: /^accounts?\b/ },
  stack: { title: 'Winning stack (from the last growth review)', re: /^winning stack\b/ },
  growth: { title: 'Growth log', re: /^growth log\b/ },
} as const

const normTitle = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
const keyOf = (k: string) => k.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\*\*/g, '').trim()
const find = (sections: FileSection[], re: RegExp) => sections.find(s => re.test(normTitle(s.title)))
// A value still holding a template placeholder ("[Name]", "[2 to 3
// recurring formats]") is not filled in yet.
const PLACEHOLDER = /\[(?![ xX]\])[^\]]{1,80}\](?!\()/
const real = (v: string) => (PLACEHOLDER.test(v) ? '' : v.trim())

interface Bullet { start: number; end: number; key: string | null; value: string }

// Bullets with their continuation lines (the template wraps at about 50
// characters with a two-space indent).
function bullets(body: string): Bullet[] {
  const lines = body.split('\n')
  const out: Bullet[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^\s*[-*+]\s+(.*)$/)
    if (!m) continue
    let text = m[1]!
    let j = i + 1
    while (j < lines.length && /^\s{2,}\S/.test(lines[j]!) && !/^\s*[-*+]\s/.test(lines[j]!)) { text += ` ${lines[j]!.trim()}`; j++ }
    const kv = text.replace(/\*\*/g, '').match(/^([^:]{1,40}):\s*(.*)$/)
    out.push({ start: i, end: j, key: kv ? kv[1]!.trim() : null, value: (kv ? kv[2]! : text).trim() })
    i = j - 1
  }
  return out
}

const splitList = (v: string) => real(v) ? v.split(v.includes(';') ? ';' : ',').map(x => x.trim().replace(/[.]$/, '')).filter(Boolean) : []

export function readBrand(sections: FileSection[]): BrandLayer {
  const out: BrandLayer = { interest: '', subInterest: '', arc: '', statement: '', series: [], runningBits: [], cast: [], payoff: '', howTheyFilm: '', accounts: '', winningStack: [], growthLog: [] }
  for (const which of ['brand', 'watch'] as const) {
    const s = find(sections, SECTIONS[which].re)
    if (!s) continue
    for (const b of bullets(s.body)) {
      const k = keyOf(b.key ?? '')
      const f = KEYED.find(x => x.section === which && x.re.test(k))
      if (!f) continue
      if (f.list) (out[f.field] as string[]) = splitList(b.value)
      else (out[f.field] as string) = real(b.value)
    }
  }
  const acc = find(sections, SECTIONS.accounts.re)
  if (acc) out.accounts = acc.body.split('\n').filter(l => !PLACEHOLDER.test(l)).join('\n').trim()
  const list = (re: RegExp) => bullets(find(sections, re)?.body ?? '').map(b => (b.key ? `${b.key}: ${b.value}` : b.value)).map(real).filter(Boolean)
  out.winningStack = list(SECTIONS.stack.re)
  out.growthLog = list(SECTIONS.growth.re)
  return out
}

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim()

// Sets one keyed bullet in a body: replaced in place (its wrapped lines
// too), or added at the end.
function setBullet(body: string, key: string, re: RegExp, value: string): string {
  const lines = body.split('\n')
  const hit = bullets(body).find(b => re.test(keyOf(b.key ?? '')))
  const line = `- ${key}: ${value}`
  if (hit) {
    // Keep the key as the file wrote it ("Sub-interest (optional)").
    const written = lines[hit.start]!.match(/^\s*[-*+]\s+(\*\*)?([^:]+?)(\*\*)?:/)
    lines.splice(hit.start, hit.end - hit.start, written ? `- ${written[1] ?? ''}${written[2]!.trim()}${written[3] ?? ''}: ${value}` : line)
    return lines.join('\n')
  }
  return [body.trimEnd(), line].filter(Boolean).join('\n')
}

// Where a new section goes: before Disclosure and the combo log when the
// file has them, so the file keeps the template's order.
function insert(sections: FileSection[], s: FileSection): FileSection[] {
  const at = sections.findIndex(x => /^(?:disclosure|combo log)\b/.test(normTitle(x.title)))
  return at < 0 ? [...sections, s] : [...sections.slice(0, at), s, ...sections.slice(at)]
}

function upsert(sections: FileSection[], which: keyof typeof SECTIONS, body: (old: string) => string): FileSection[] {
  const s = find(sections, SECTIONS[which].re)
  if (s) return sections.map(x => (x === s ? { title: x.title, body: body(x.body) } : x))
  return insert(sections, { title: SECTIONS[which].title, body: body('') })
}

export function writeBrand(sections: FileSection[], patch: BrandPatch): FileSection[] {
  let out = sections
  for (const f of KEYED) {
    const v = patch[f.field]
    if (v === undefined) continue
    const value = f.list ? (v as string[]).map(oneLine).filter(Boolean).join('; ') : oneLine(v as string)
    out = upsert(out, f.section, body => setBullet(body, f.key, f.re, value))
  }
  if (patch.accounts !== undefined) out = upsert(out, 'accounts', () => patch.accounts!.trim())
  if (patch.winningStack !== undefined) out = upsert(out, 'stack', () => patch.winningStack!.map(oneLine).filter(Boolean).map(x => `- ${x}`).join('\n'))
  if (patch.growthLog !== undefined) out = upsert(out, 'growth', () => patch.growthLog!.map(oneLine).filter(Boolean).map(x => `- ${x}`).join('\n'))
  return out
}

// The lines the writers get (default rules brand-winning-stack and
// brand-check). Empty when the file has nothing to say.
export function winningStackLine(b: BrandLayer): string {
  return b.winningStack.length ? `Winning stack from the last growth review: every post carries these for the next 30 days, where they fit this shot and inside the fixed rules: ${b.winningStack.join('; ')}.` : ''
}

export function brandCheckLine(b: BrandLayer): string {
  return b.statement ? `Brand statement: ${b.statement}. Check each option against it: say whether it fits, and if not, why in a few plain words.` : ''
}
