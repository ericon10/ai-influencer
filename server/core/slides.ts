// The slideshow power-up (owner, 2026-10-16; UX-PLAN.md section 27): hook
// patterns, the free hooks from the vault, the slide list a post renders,
// CTA lines, special slides and their generic names, and the list reorder
// for variations. Pure: no config, no imports, so the browser uses the same
// file as the worker.

// ── Hook patterns ─────────────────────────────────────────────────────

export const HOOK_PATTERNS = [
  { id: 'doubt', label: 'Someone doubts or reacts' },
  { id: 'pov', label: 'POV' },
  { id: 'nobody_tells', label: 'Things nobody tells you' },
  { id: 'red_flags', label: 'Red flags' },
  { id: 'listicle', label: 'Listicle' },
  { id: 'storytime', label: 'Storytime' },
  { id: 'myth_fact', label: 'Myth vs fact' },
  { id: 'tier_list', label: 'Tier list' },
] as const
export type HookPattern = (typeof HOOK_PATTERNS)[number]['id']
export const PATTERN_IDS = HOOK_PATTERNS.map(p => p.id) as unknown as readonly [HookPattern, ...HookPattern[]]
export const patternLabel = (id: string) => HOOK_PATTERNS.find(p => p.id === id)?.label ?? id

// A hook offered in the Idea step. A vault hook has its pattern; a Claude
// hook (section 28) also has its moment, structure or lens code, effects,
// alt hook, the writer's rank and the reviewer's score and note.
export interface HookIdea {
  text: string; pattern: HookPattern; source: 'vault' | 'claude' | 'typed'
  code?: string | null; effectOpen?: string | null; effectPayoff?: string | null
  moment?: string; alt?: string; selfScore?: number | null; score?: number | null; note?: string; reviewed?: boolean
  // The reviewer's stop test (THE STANDARD): pain 1 to 10, and whether it
  // passed (stops a stranger, clear on one read, pain 7 or more).
  pain?: number | null; stops?: boolean | null; fails?: string[]
}

// The pattern a hook reads as, from its words (free). Listicles and tier
// lists are the ones whose middle slides can be reordered.
export function guessPattern(text: string): HookPattern {
  const t = ` ${text.toLowerCase()} `
  if (/\bpov\b/.test(t)) return 'pov'
  if (/\btier\b|\branking\b|\branked\b/.test(t)) return 'tier_list'
  if (/\bmyths?\b|\bvs\.? fact\b|\bfact\b.*\bfiction\b/.test(t)) return 'myth_fact'
  if (/red flags?/.test(t)) return 'red_flags'
  if (/nobody (?:tells|told|talks)|no one (?:tells|told|talks)|wish (?:i|someone) (?:knew|told)/.test(t)) return 'nobody_tells'
  if (/\b(?:said|told me|laughed|thought i|doubted|didn't believe|did not believe|reacts?|reaction)\b/.test(t)) return 'doubt'
  if (/\bstorytime\b|\bstory time\b|^ ?(?:so )?i (?:got|was|quit|left|almost|finally)\b/.test(t)) return 'storytime'
  if (/^\s*(?:\d+|three|four|five|six|seven|eight|nine|ten)\b/.test(t) || /\b\d+ (?:things|ways|apps|tips|signs|mistakes|habits|tools)\b/.test(t)) return 'listicle'
  return 'storytime'
}

export const isListPattern = (p: string | null | undefined) => p === 'listicle' || p === 'tier_list' || p === 'red_flags'

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
export const wordCount = (s: string) => words(s).length

// "Write 10 hooks" for free: the vault's own hooks first (rotated by the
// offset so another press shows others), then each pattern recast with the
// buyer's own words or the topic. Deterministic for the same inputs.
export function vaultHooks(input: { vault: Array<{ text: string; kind?: string }>; phrases: string[]; topic: string; n?: number; offset?: number; patterns?: HookPattern[] }): HookIdea[] {
  const n = input.n ?? 10
  const off = Math.max(0, input.offset ?? 0)
  const allow = new Set<HookPattern>(input.patterns?.length ? input.patterns : PATTERN_IDS)
  const topic = cleanTopic(input.topic) || 'this'
  const phrases = input.phrases.map(p => p.trim().replace(/^["“]+|["”.]+$/g, '')).filter(p => p.length >= 3 && wordCount(p) <= 8)
  const phrase = (i: number) => phrases.length ? phrases[(i + off) % phrases.length]!.toLowerCase() : topic
  const out: HookIdea[] = []
  const seen = new Set<string>()
  const push = (text: string, pattern: HookPattern) => {
    const clean = trimWords(text.replace(/\s+/g, ' ').trim(), 12)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key) || !allow.has(pattern)) return
    seen.add(key)
    out.push({ text: clean, pattern, source: 'vault' })
  }
  const vault = input.vault.filter(h => h.text.trim().length >= 3)
  const fromVault = Math.min(vault.length, Math.ceil(n / 2))
  for (let i = 0; i < vault.length && out.length < fromVault; i++) {
    const h = vault[(i + off) % vault.length]!
    push(h.text, guessPattern(h.text))
  }
  const recast: Record<HookPattern, (i: number) => string> = {
    doubt: i => `My friend laughed when I said ${phrase(i)}`,
    pov: i => `POV: you finally figured out ${phrase(i)}`,
    nobody_tells: () => `Things nobody tells you about ${topic}`,
    red_flags: () => `Red flags about ${topic} I ignored`,
    listicle: () => `5 ${topic} things I wish I knew sooner`,
    storytime: i => `Storytime: how ${phrase(i)} changed everything`,
    myth_fact: () => `Myth vs fact: ${topic}`,
    tier_list: () => `Ranking every ${topic} tip I tried`,
  }
  const order = PATTERN_IDS.filter(p => allow.has(p))
  for (let round = 0; out.length < n && round < 4; round++) {
    for (const [i, p] of order.entries()) {
      if (out.length >= n) break
      push(recast[p](i + round * order.length), p)
    }
  }
  return out.slice(0, n)
}

const cleanTopic = (s: string) => trimWords(s.trim().replace(/^(?:a |an |the )/i, '').replace(/[.!?]+$/, ''), 6).toLowerCase()
export function trimWords(s: string, max: number): string {
  const w = words(s)
  return w.length <= max ? w.join(' ') : w.slice(0, max).join(' ')
}

// ── Text styles ───────────────────────────────────────────────────────

export const TEXT_STYLES = [
  { id: 'classic', label: 'Classic', line: 'Bold white, black outline' },
  { id: 'box', label: 'Text box', line: "TikTok's white box" },
  { id: 'minimal', label: 'Minimal', line: 'Smaller, plain white' },
  { id: 'note', label: 'Note', line: 'A notes-app card' },
] as const
export type TextStyleId = (typeof TEXT_STYLES)[number]['id']
export const TEXT_STYLE_IDS = TEXT_STYLES.map(s => s.id) as unknown as readonly [TextStyleId, ...TextStyleId[]]

// ── CTA (the last slide) ──────────────────────────────────────────────

export const CTA_KINDS = [
  { id: 'part2', label: 'Follow for part 2' },
  { id: 'save', label: 'Save this' },
  { id: 'handle', label: 'Follow @handle' },
  { id: 'comment', label: 'Comment a word' },
  { id: 'page', label: 'More on my page' },
  { id: 'own', label: 'As written' },
  { id: 'none', label: 'No CTA slide' },
] as const
export type CtaKind = (typeof CTA_KINDS)[number]['id']
export const CTA_IDS = CTA_KINDS.map(c => c.id) as unknown as readonly [CtaKind, ...CtaKind[]]

export function ctaText(kind: CtaKind, o: { handle?: string; word?: string } = {}): string | null {
  const handle = (o.handle ?? '').trim().replace(/^@+/, '').replace(/\s+/g, '')
  const word = (o.word ?? '').trim().replace(/^["']+|["']+$/g, '') || 'more'
  switch (kind) {
    case 'part2': return 'Follow for part 2'
    case 'save': return 'Save this for later'
    case 'handle': return handle ? `Follow @${handle} for more` : 'Follow for more'
    case 'comment': return `Comment "${word}" and I'll send it`
    case 'page': return 'More like this on my page'
    default: return null
  }
}

// ── Special slides: mock UI drawn by code ─────────────────────────────

export const SPECIAL_TYPES = [
  { id: 'notification', label: 'Phone notification' },
  { id: 'text_thread', label: 'Text thread' },
  { id: 'rejection_email', label: 'Rejection email' },
  { id: 'job_posting', label: 'Job posting' },
  // Section 28 (the launch plan's mock screens).
  { id: 'application_form', label: 'Application form' },
  { id: 'portal_status', label: 'Portal status timeline' },
  { id: 'calendar_invite', label: 'Calendar invite' },
  { id: 'receipt', label: 'Invoice or receipt' },
  { id: 'bank_app', label: 'Bank or savings app' },
  { id: 'museum_placard', label: 'Museum placard' },
  { id: 'survey', label: '0 to 10 survey' },
  { id: 'lock_screen', label: 'Lock screen' },
  { id: 'profile_card', label: 'Profile card' },
  // The owner's own screenshot of the product, placed as uploaded. The
  // Studio never draws a product screen.
  { id: 'product_shot', label: 'Product screenshot' },
] as const
export type SpecialType = (typeof SPECIAL_TYPES)[number]['id']
export const SPECIAL_IDS = SPECIAL_TYPES.map(s => s.id) as unknown as readonly [SpecialType, ...SpecialType[]]
// The ones a writer may suggest (a screenshot is only ever uploaded).
export const DRAWN_SPECIAL_IDS = SPECIAL_IDS.filter(id => id !== 'product_shot') as unknown as readonly [SpecialType, ...SpecialType[]]
export const specialLabel = (id: string) => SPECIAL_TYPES.find(t => t.id === id)?.label ?? id

// One shape for every type (what the writer returns and the form edits):
// notification: from = app, title, body, time; text thread: title = the
// contact, lines = messages, "me: " marks yours; rejection email: from,
// title = subject, body; job posting: title, from = company, body = the
// place and pay line, lines = requirements. Section 28: application form:
// from = the portal, title = the page, lines = fields ("Label" empty, or
// "Label: value" filled), variant empty or filled, count = fields in all;
// portal status: from = the portal, title = the role, body = the status,
// lines = "Step · timestamp" (the last is the current one); calendar
// invite: title = event, from = organizer, time = when, body = where,
// lines = attendees; invoice or receipt: variant invoice or receipt,
// title = its number, from = billed to, lines = "Item · amount", body =
// the total line, time = the due line; bank or savings app: from = the
// bank, title = the account, body = the balance, lines = "Label · amount",
// time = a label above the balance, blur hides the amounts; museum
// placard: title, from = artist, time = medium and year, body = the text;
// survey: title = the question, from = the survey's name, count = the
// picked score (-1 none); lock screen: time = the clock, from = the date,
// lines = "App · Sender · message"; profile card: title = the name, from =
// the headline, body = the about line, lines = "Label · value", variant =
// the banner color; product screenshot: assetId = the upload, scale = its
// width on the slide, ratio = its width over its height, variant = top
// or middle (where it sits).
export interface SpecialSlide {
  type: SpecialType; from: string; title: string; body: string; lines: string[]; time: string
  variant: string; count: number; blur: boolean; assetId: string | null; scale: number; ratio: number
}

const base = { from: '', title: '', body: '', lines: [] as string[], time: '', variant: '', count: 0, blur: false, assetId: null as string | null, scale: 0.72, ratio: 0.5 }
export function emptySpecial(type: SpecialType): SpecialSlide {
  switch (type) {
    case 'notification': return { ...base, type, from: 'Messages', title: 'Jordan', body: 'did you see the email??', time: 'now' }
    case 'text_thread': return { ...base, type, title: 'Mom', lines: ['how did the interview go', 'me: they said they will let me know', 'thats good right?'], time: '9:41' }
    case 'rejection_email': return { ...base, type, from: 'Recruiting Team', title: 'Update on your application', body: 'Thank you for your interest. After careful consideration, we have decided to move forward with other candidates.', time: '8:02 AM' }
    case 'job_posting': return { ...base, type, from: 'Northwind Studio', title: 'Junior Product Designer', body: 'Remote · $68k to $80k', lines: ['2+ years of experience', 'A portfolio of shipped work', 'Comfortable presenting ideas'], time: '2 days ago' }
    case 'application_form': return { ...base, type, from: 'Careers portal', title: 'Work history, page 4 of 6', lines: ['Job title', 'Company', 'Start date (MM/YYYY)', 'End date (MM/YYYY)', 'Describe your responsibilities'], variant: 'empty', count: 40 }
    case 'portal_status': return { ...base, type, from: 'Candidate portal', title: 'Junior Coordinator', body: 'In review', lines: ['Submitted · Oct 2, 11:52 PM', 'Received · Oct 2, 11:52 PM', 'In review · Oct 3, 9:00 AM', 'Still in review · day 41'] }
    case 'calendar_invite': return { ...base, type, title: 'Quick chat', from: 'Talent Team', time: 'Tue, Oct 20 · 2:00 to 2:30 PM', body: 'Video call', lines: ['JR', 'MK', 'You'] }
    case 'receipt': return { ...base, type, variant: 'invoice', title: 'INVOICE No. 047', from: 'Bill to: The Talent Team', lines: ['Round 4 deck · $640.00', 'Retyping my resume · $45.00', 'Emotional damages · TBD'], body: 'Total due · $685.00', time: 'Due on receipt' }
    case 'bank_app': return { ...base, type, from: 'Everyday Bank', title: 'Savings', time: 'Available balance', body: '$1,204.18', lines: ['Rent · -$1,450.00', 'Groceries · -$62.40', 'Transfer in · +$200.00'] }
    case 'museum_placard': return { ...base, type, title: "'Warm Regards.'", from: 'Autoresponder', time: 'Email, 2026', body: 'Received at 2:14 AM. The only warm thing in the building at 2am.' }
    case 'survey': return { ...base, type, from: 'Candidate experience survey', title: 'How likely are you to recommend our hiring process to a friend?', count: -1 }
    case 'lock_screen': return { ...base, type, time: '2:14', from: 'Wednesday, October 21', lines: ['Mail · Talent Team · Thank you for your interest in the...', 'Messages · Mom · did you hear back??', 'Calendar · Rent due in 9 days'] }
    case 'profile_card': return { ...base, type, title: 'Jordan Lee', from: 'Open to work · Class of 2026', body: 'Recent grad. 147 applications and counting.', lines: ['Connections · 212', 'Profile views this week · 3'], variant: 'blue' }
    case 'product_shot': return { ...base, type }
  }
}

// An older special slide (before section 28) read with the new fields.
export const fullSpecial = (s: Partial<SpecialSlide> & { type: SpecialType }): SpecialSlide => ({ ...base, ...s, lines: s.lines ?? [] })

// A thread line: whose message it is, and the words.
export function threadLine(line: string): { me: boolean; text: string } {
  const m = line.match(/^\s*(me|you)\s*:\s*/i)
  return m ? { me: true, text: line.slice(m[0].length).trim() } : { me: false, text: line.replace(/^\s*(?:them|they|[a-z]{1,20})\s*:\s*/i, '').trim() || line.trim() }
}

// Real brand names never appear on a mock screen: each becomes a generic
// name (the lists are data, config/content.yaml). Whole words, as the
// brand writes itself or in capitals, so "target" or "indeed" in a
// sentence stays.
export function genericNames(text: string, brands: string[], generic: string[]): string {
  if (!brands.length || !text) return text
  let out = text
  brands.forEach((b, i) => {
    const name = b.trim()
    if (!name) return
    const quoted = [name, name.toUpperCase()].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const re = new RegExp(`(^|[^A-Za-z0-9])(?:${quoted})(?=$|[^A-Za-z0-9])`, 'g')
    out = out.replace(re, (_m, pre: string) => `${pre}${generic.length ? generic[i % generic.length]! : 'the company'}`)
  })
  return out
}

export function cleanSpecial(s: SpecialSlide, brands: string[], generic: string[]): SpecialSlide {
  const g = (t: string) => genericNames(t, brands, generic)
  return { ...fullSpecial(s), from: g(s.from), title: g(s.title), body: g(s.body), lines: s.lines.map(g), time: g(s.time) }
}

// ── The slides of a post ──────────────────────────────────────────────

export interface SlidePos { x: number; y: number }
export interface SlideshowSlides {
  hook: string
  slides: string[]
  stillIds: string[]
  shots?: string[]
  specials?: Array<SpecialSlide | null>
  textPos?: Array<SlidePos | null>
}
export interface Slide { index: number; text: string; stillId: string | null; special: SpecialSlide | null; shot: string; pos: SlidePos | null }

// How many slides a post has: the hook and its slides when there are words,
// else one per picked still (the words are optional).
export function slideCountOf(s: SlideshowSlides): number {
  const words = s.hook.trim() || s.slides.length ? 1 + s.slides.length : 0
  const lastSpecial = (s.specials ?? []).reduce((m, x, i) => (x ? i + 1 : m), 0)
  return Math.max(words, s.stillIds.length, lastSpecial)
}

// Each slide's picture: its own still, or its special slide. An older post
// with fewer stills than slides (and no empty slots) repeats them in order.
export function slideList(s: SlideshowSlides): Slide[] {
  const n = slideCountOf(s)
  const filled = s.stillIds.filter(Boolean)
  const legacy = filled.length > 0 && filled.length === s.stillIds.length && s.stillIds.length < n
  const texts = [s.hook, ...s.slides]
  return Array.from({ length: n }, (_, i) => {
    const special = s.specials?.[i] ?? null
    const own = s.stillIds[i] || null
    const stillId = special ? null : own ?? (legacy ? filled[i % filled.length]! : null)
    return { index: i, text: (texts[i] ?? '').trim(), stillId, special, shot: (s.shots?.[i] ?? '').trim(), pos: s.textPos?.[i] ?? null }
  })
}

// The photo behind a special slide that has none of its own: the nearest
// slide's picture, earlier first, blurred under the mock screen, so the
// set still reads as one camera roll.
export function backdropFor(list: Slide[], i: number): string | null {
  if (list[i]?.stillId) return list[i]!.stillId
  for (let d = 1; d < list.length; d++) {
    const before = list[i - d]?.special ? null : list[i - d]?.stillId
    if (before) return before
    const after = list[i + d]?.special ? null : list[i + d]?.stillId
    if (after) return after
  }
  return null
}

// A slot array set at one index, padded with empty slots.
export function setAt<T>(list: T[], i: number, value: T, empty: T): T[] {
  const out = [...list]
  while (out.length <= i) out.push(empty)
  out[i] = value
  return out
}

// Variations of a list post: the middle slides (between the hook and the
// payoff and CTA) in another order, by a seeded shuffle that never returns
// the same order when another exists.
export function reorderMiddle<T>(items: T[], seed: number, keepEnd = 1): T[] {
  if (items.length < 4) return [...items]
  const head = items.slice(0, 1), tail = items.slice(items.length - keepEnd), mid = items.slice(1, items.length - keepEnd)
  if (mid.length < 2) return [...items]
  const shuffled = [...mid]
  let x = (seed * 2654435761) >>> 0 || 1
  for (let i = shuffled.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) >>> 0
    const j = x % (i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  if (shuffled.every((v, i) => v === mid[i])) shuffled.push(shuffled.shift()!)
  return [...head, ...shuffled, ...tail]
}

// A product post (an ad): #ad on, or a plan row with product = yes whose
// draft found an honest SideStep ending (THE STANDARD v1.2: when the hook's
// pain is not one SideStep fixes, the draft says "none" and there is no
// product mention, so no Ad label).
export const isProductPost = (s: { ad?: boolean; plan?: { product?: boolean } | null; productEnding?: string | null }) =>
  !!(s.ad || (s.plan?.product && s.productEnding !== 'none'))

// The caption as posted: "Ad:" first when the post is an ad (the post
// writer brief; a caption that already opens with "Ad:" or "#ad" stays as
// it is), then the caption, the CTA line when it is not already in the
// caption, and at most `max` hashtags (without an "ad" tag).
export function postCaption(caption: string, hashtags: string[], o: { ad: boolean; max: number; cta?: string }): string {
  const tags = hashtags.map(h => h.replace(/^#+/, '').replace(/\s+/g, '')).filter(h => h && h.toLowerCase() !== 'ad').slice(0, o.max).map(h => `#${h}`)
  let body = caption.trim()
  if (o.ad && !/^(?:ad:|#ad\b)/i.test(body)) body = `Ad: ${body}`.trim()
  const cta = (o.cta ?? '').trim()
  const withCta = cta && !body.toLowerCase().includes(cta.toLowerCase()) ? [body, cta] : [body]
  return [...withCta, tags.join(' ')].filter(Boolean).join('\n\n')
}

// Editing the slides keeps their parallel lists together: the words, the
// picture, the shot, the special slide and the dragged place of a slide
// move, go or arrive as one. A repeated picture of an older post becomes
// its own slot first.
export type SlideEdit = { move: [number, number] } | { remove: number } | { add: number }
export function editSlides(s: SlideshowSlides, op: SlideEdit): { hook: string; slides: string[]; stillIds: string[]; shots: string[]; specials: Array<SpecialSlide | null>; textPos: Array<SlidePos | null> } {
  const list = slideList(s)
  let rows = list.map(x => ({ text: [s.hook, ...s.slides][x.index] ?? '', still: x.stillId ?? '', shot: s.shots?.[x.index] ?? '', special: s.specials?.[x.index] ?? null, pos: s.textPos?.[x.index] ?? null }))
  if ('move' in op) {
    const [from, to] = op.move
    if (from >= 0 && from < rows.length && to >= 0 && to < rows.length && from !== to) { const [r] = rows.splice(from, 1); rows.splice(to, 0, r!) }
  } else if ('remove' in op) rows = rows.filter((_, i) => i !== op.remove)
  else rows.splice(Math.min(Math.max(0, op.add), rows.length), 0, { text: '', still: '', shot: '', special: null, pos: null })
  return {
    hook: rows[0]?.text ?? '', slides: rows.slice(1).map(r => r.text),
    stillIds: rows.map(r => r.still), shots: rows.map(r => r.shot), specials: rows.map(r => r.special), textPos: rows.map(r => r.pos),
  }
}
