// The language lint (owner, 2026-10-16; UX-PLAN.md section 28): free checks
// on hooks, slides and captions, from the playbook's Communication
// Algorithm and the post writer brief. Warnings only, never a block (rule
// one): each check is a default in Settings > Rules and the word lists are
// data (config/content.yaml, copy_lint). The em and en dash check runs on
// every post; the rest are SideStep's and run only on posts whose product's
// rules have lint on (`standard`; UX-PLAN.md section 29). Pure, so the
// browser runs the same checks as you type.

export const LINT_RULES = [
  { id: 'lint-dashes', title: 'No em or en dashes' },
  { id: 'lint-values', title: 'No should, need to, must, ought' },
  { id: 'lint-just', title: 'No "just" before an instruction' },
  { id: 'lint-hype', title: 'No hustle words (dream job, unlock, level up, game-changer, supercharge)' },
  { id: 'lint-you-start', title: 'No sentence starts with "You"' },
  { id: 'lint-hashtags', title: 'At most 5 hashtags' },
  { id: 'lint-product-hook', title: 'The product is never in the hook' },
  { id: 'lint-ad-caption', title: 'A product post\'s caption starts with "Ad:"' },
  // THE STANDARD (post writer brief v1.1): slide 1 reads in one go.
  { id: 'lint-hook-long', title: 'A hook reads in one go (22 words at most)' },
  { id: 'lint-hook-label', title: 'A hook never opens with a label or stage direction' },
  { id: 'lint-hook-quotes', title: 'One quoted phrase at most in a hook' },
  // THE STANDARD v1.2: the hook names the job situation; a product post's
  // last slide is an honest ending.
  { id: 'lint-hook-nojob', title: 'A hook names the job situation' },
  { id: 'lint-product-ending', title: 'A product post\'s last slide never promises replies or applying' },
] as const
export type LintRuleId = (typeof LINT_RULES)[number]['id']
export const LINT_RULE_IDS = LINT_RULES.map(r => r.id) as unknown as readonly [LintRuleId, ...LintRuleId[]]

export interface LintLists {
  values: string[]
  hype: string[]
  products: string[]
  maxHashtags: number
  // THE STANDARD: the longest hook, and the labels and stage directions a
  // hook never opens with (a timestamp is found by code).
  hookMaxWords: number
  hookLabels: string[]
  // THE STANDARD v1.2: one of these words (or a word starting with one) in
  // every hook; and what a product post's last slide never says.
  jobWords: string[]
  endingNever: string[]
}
export const DEFAULT_LINT_LISTS: LintLists = {
  values: ['should', 'need to', 'needs to', 'must', 'ought'],
  hype: ['dream job', 'unlock', 'level up', 'game-changer', 'game changer', 'supercharge'],
  products: [],
  maxHashtags: 5,
  hookMaxWords: 22,
  hookLabels: ['Exhibit', 'Levels of', 'Previously on', 'Calendar invite'],
  jobWords: ['job', 'interview', 'recruiter', 'offer', 'salary', 'salaries', 'resume', 'résumé', 'hiring', 'application'],
  endingNever: ['ghosted', 'ghosting', 'passed over', 'applies for you', 'apply for you', 'applies for me', 'applying for you', 'auto-apply', 'auto apply'],
}

// hook: slide 1 or a video's on-screen hook; slide: any other slide;
// caption: the post's caption (with its hashtags).
export type LintKind = 'hook' | 'slide' | 'caption'
export interface LintHit { rule: LintRuleId; message: string; match: string }
export interface LintOptions {
  kind: LintKind
  lists?: Partial<LintLists>
  off?: Iterable<string>
  // The post's product's rules have lint on (SideStep's): every check runs.
  // Off (any other post): the em and en dash check only.
  standard?: boolean
  // A product post (product = yes, or #ad on).
  product?: boolean
  // The post's last slide (slide 6 of a product post: its SideStep ending).
  last?: boolean
  hashtags?: string[]
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phrase = (w: string) => new RegExp(`(^|[^A-Za-z0-9])(${esc(w).replace(/\\?[\s-]+/g, '[\\s-]+')})(?=$|[^A-Za-z0-9])`, 'i')
const LONG_DASH = /[\u2013\u2014]/

// "just" opening a clause and followed by a verb reads as an order ("Just
// apply early", "you can just ask", "you should just unlock"); "I just applied" and "just because"
// do not.
const JUST = /(?:^|[.!?:;,"“(]\s*|\b(?:and|so|then|can|could|gotta|simply|should|must|will|need\s+to|have\s+to|has\s+to|ought\s+to)\s+|\w'll\s+)(just\s+(?!because\b|kidding\b|like\b|in\b|now\b|a\b|an\b|the\b|my\b|me\b|one\b|two\b|that\b|this\b|for\b|to\b|as\b|not\b|about\b|enough\b|another\b|some\b|got\b|had\b|was\b|did\b|said\b)[a-z]+)/i

// The sentences of a text: split at . ! ? and line breaks.
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)
const YOU_START = /^["'“‘(*\s]*(you\b[a-z']*)/i

// A timestamp or date a hook opens with: "2:14am", "11:52 PM", "Sunday
// 9:40pm", "Tue, 4pm", "Oct 19", "10/19".
const DAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+'
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b'
const TIME = '\\d{1,2}(?::\\d{2}\\s*(?:[ap]\\.?m\\.?)?|\\s*[ap]\\.?m\\.?)(?![a-z])'
const STAMP = new RegExp(`^(?:${DAY})?(?:${TIME}|${MONTH}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b)`, 'i')
const LEAD = /^["'\u201c\u2018(*\s]*/
// Quoted phrases: "...", \u201c...\u201d, and '...' that is not an apostrophe.
const QUOTED = /"[^"\n]+"|\u201c[^\u201d\n]+\u201d|\u2018[^\u2019\n]+\u2019|(?<![A-Za-z0-9])'[^'\n]*[^\s'][^'\n]*'(?![A-Za-z0-9])/g
export const wordsIn = (t: string) => t.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length

export function hashtagCount(caption: string, hashtags: string[] = []): number {
  const inText = caption.match(/(^|\s)#[A-Za-z0-9_]+/g)?.length ?? 0
  return inText + hashtags.filter(h => h.replace(/^#+/, '').trim()).length
}

export function lintCopy(text: string, o: LintOptions): LintHit[] {
  const lists: LintLists = { ...DEFAULT_LINT_LISTS, ...(o.lists ?? {}) }
  const off = new Set(o.off ?? [])
  const on = (id: LintRuleId) => !off.has(id) && (id === 'lint-dashes' || !!o.standard)
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
    const n = wordsIn(t)
    if (n > lists.hookMaxWords) hit('lint-hook-long', `${n} words`, `${n} words. Slide 1 reads in one go at ${lists.hookMaxWords} or fewer.`)
    const lead = t.replace(LEAD, '')
    const label = lists.hookLabels.map(l => l.trim()).filter(Boolean).find(l => phrase(l).exec(lead)?.index === 0)
    const stamp = lead.match(STAMP)
    if (label || stamp) {
      const m = label ? lead.slice(0, label.length) : stamp![0].trim()
      hit('lint-hook-label', m, `Opens with "${m}", a ${label ? 'label or stage direction' : 'timestamp'}. Say the pain plainly first; the frame can wait for slide 2.`)
    }
    const quotes = t.match(QUOTED) ?? []
    if (quotes.length > 1) hit('lint-hook-quotes', `${quotes.length} quotes`, `${quotes.length} quoted phrases. One at most, so it is clear on one read.`)
    const job = lists.jobWords.map(w => w.trim()).filter(Boolean)
    if (job.length && !job.some(w => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}`, 'iu').test(t))) hit('lint-hook-nojob', 'no job word', `No job word. Name the job situation (${job.slice(0, 8).join(', ')}): a stranger can't tell it's about the job hunt.`)
    for (const p of lists.products) {
      const m = p.trim() && t.match(phrase(p))
      if (m) { hit('lint-product-hook', m[2]!, `${m[2]!} is in the hook. Name it on slide 5 or 6, or late in the caption.`); break }
    }
  }
  if (o.kind === 'slide' && o.product && o.last) {
    for (const w of lists.endingNever) {
      const m = w.trim() && t.match(phrase(w))
      if (m) { hit('lint-product-ending', m[2]!, `"${m[2]!}" on the product ending. ${lists.products[0] || 'The product'} can't promise replies and never applies for anyone: use one of its honest endings.`); break }
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
export function lintPost(p: { texts: string[]; caption: string; hashtags: string[]; product: boolean; standard?: boolean }, o: { lists?: Partial<LintLists>; off?: Iterable<string> } = {}): Array<LintHit & { slide: number | null }> {
  const off = [...(o.off ?? [])]
  return [
    ...p.texts.flatMap((t, i) => lintCopy(t, { kind: i === 0 ? 'hook' : 'slide', lists: o.lists, off, product: p.product, standard: p.standard, last: i > 0 && i === p.texts.length - 1 }).map(h => ({ ...h, slide: i }))),
    ...lintCopy(p.caption, { kind: 'caption', lists: o.lists, off, product: p.product, standard: p.standard, hashtags: p.hashtags }).map(h => ({ ...h, slide: null })),
  ]
}
