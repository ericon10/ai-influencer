// The language lint (owner, 2026-10-16; UX-PLAN.md section 28): free checks
// on every hook, slide and caption, from the playbook's Communication
// Algorithm and the post writer brief. Warnings only, never a block (rule
// one): each check is a default in Settings > Rules and the word lists are
// data (config/content.yaml, copy_lint). Pure, so the browser runs the same
// checks as you type.

export const LINT_RULES = [
  { id: 'lint-dashes', title: 'No em or en dashes' },
  { id: 'lint-values', title: 'No should, need to, must, ought' },
  { id: 'lint-just', title: 'No "just" before an instruction' },
  { id: 'lint-hype', title: 'No hustle words (dream job, unlock, level up, game-changer, supercharge)' },
  { id: 'lint-you-start', title: 'No sentence starts with "You"' },
  { id: 'lint-hashtags', title: 'At most 5 hashtags' },
  { id: 'lint-product-hook', title: 'The product is never in the hook' },
  { id: 'lint-ad-caption', title: 'A product post\'s caption starts with "Ad:"' },
] as const
export type LintRuleId = (typeof LINT_RULES)[number]['id']
export const LINT_RULE_IDS = LINT_RULES.map(r => r.id) as unknown as readonly [LintRuleId, ...LintRuleId[]]

export interface LintLists {
  values: string[]
  hype: string[]
  products: string[]
  maxHashtags: number
}
export const DEFAULT_LINT_LISTS: LintLists = {
  values: ['should', 'need to', 'needs to', 'must', 'ought'],
  hype: ['dream job', 'unlock', 'level up', 'game-changer', 'game changer', 'supercharge'],
  products: ['SideStep'],
  maxHashtags: 5,
}

// hook: slide 1 or a video's on-screen hook; slide: any other slide;
// caption: the post's caption (with its hashtags).
export type LintKind = 'hook' | 'slide' | 'caption'
export interface LintHit { rule: LintRuleId; message: string; match: string }
export interface LintOptions {
  kind: LintKind
  lists?: Partial<LintLists>
  off?: Iterable<string>
  // A product post (product = yes, or #ad on).
  product?: boolean
  hashtags?: string[]
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phrase = (w: string) => new RegExp(`(^|[^A-Za-z0-9])(${esc(w).replace(/\\?[\s-]+/g, '[\\s-]+')})(?=$|[^A-Za-z0-9])`, 'i')
const LONG_DASH = /[–—]/

// "just" opening a clause and followed by a verb reads as an order ("Just
// apply early", "you can just ask"); "I just applied" and "just because"
// do not.
const JUST = /(?:^|[.!?:;,"“(]\s*|\b(?:and|so|then|can|could|gotta|simply)\s+)(just\s+(?!because\b|kidding\b|like\b|in\b|now\b|a\b|an\b|the\b|my\b|me\b|one\b|two\b|that\b|this\b|for\b|to\b|as\b|not\b|about\b|enough\b|another\b|some\b|got\b|had\b|was\b|did\b|said\b)[a-z]+)/i

// The sentences of a text: split at . ! ? and line breaks.
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)
const YOU_START = /^["'“‘(*\s]*(you\b[a-z']*)/i

export function hashtagCount(caption: string, hashtags: string[] = []): number {
  const inText = caption.match(/(^|\s)#[A-Za-z0-9_]+/g)?.length ?? 0
  return inText + hashtags.filter(h => h.replace(/^#+/, '').trim()).length
}

export function lintCopy(text: string, o: LintOptions): LintHit[] {
  const lists: LintLists = { ...DEFAULT_LINT_LISTS, ...(o.lists ?? {}) }
  const off = new Set(o.off ?? [])
  const on = (id: LintRuleId) => !off.has(id)
  const t = (text ?? '').trim()
  const out: LintHit[] = []
  const hit = (rule: LintRuleId, match: string, message: string) => { if (on(rule)) out.push({ rule, match, message }) }
  if (!t && o.kind !== 'caption') return out
  if (LONG_DASH.test(t)) hit('lint-dashes', t.match(LONG_DASH)![0], 'A long dash (em or en). Use a comma, a period or "to".')
  for (const w of lists.values) {
    const m = t.match(phrase(w))
    if (m) { hit('lint-values', m[2]!, `"${m[2]!}" is values language. Turn it into a feeling, a fact or a joke.`); break }
  }
  const j = t.match(JUST)
  if (j) hit('lint-just', j[1]!, `"${j[1]!}" reads as an order. Drop "just", or ask it as a question.`)
  for (const w of lists.hype) {
    const m = t.match(phrase(w))
    if (m) { hit('lint-hype', m[2]!, `"${m[2]!}" is a hustle word. Say what actually happens instead.`); break }
  }
  const you = sentences(t).map(s => s.match(YOU_START)).find(Boolean)
  if (you) hit('lint-you-start', you[1]!, `A sentence starts with "${you[1]!}". Move "you" to the middle or the end ("POV:" is fine).`)
  if (o.kind === 'hook') {
    for (const p of lists.products) {
      const m = p.trim() && t.match(phrase(p))
      if (m) { hit('lint-product-hook', m[2]!, `${m[2]!} is in the hook. Name it on slide 5 or 6, or late in the caption.`); break }
    }
  }
  if (o.kind === 'caption') {
    const n = hashtagCount(t, o.hashtags)
    if (n > lists.maxHashtags) hit('lint-hashtags', `${n} hashtags`, `${n} hashtags. At most ${lists.maxHashtags}.`)
    if (o.product && !/^\s*ad:/i.test(t)) hit('lint-ad-caption', t.slice(0, 12), 'A product post: start the caption with "Ad:".')
  }
  return out
}

// Every slide and the caption of a slideshow at once (the Finish step and
// the plan import): each hit with the slide it is on (0 is the hook, null
// is the caption).
export function lintPost(p: { texts: string[]; caption: string; hashtags: string[]; product: boolean }, o: { lists?: Partial<LintLists>; off?: Iterable<string> } = {}): Array<LintHit & { slide: number | null }> {
  const off = [...(o.off ?? [])]
  return [
    ...p.texts.flatMap((t, i) => lintCopy(t, { kind: i === 0 ? 'hook' : 'slide', lists: o.lists, off }).map(h => ({ ...h, slide: i }))),
    ...lintCopy(p.caption, { kind: 'caption', lists: o.lists, off, product: p.product, hashtags: p.hashtags }).map(h => ({ ...h, slide: null })),
  ]
}
