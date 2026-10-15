import type { WordingConfig } from '../config/pipeline.js'

// Catalog wording (owner, 2026-10-15; UX-PLAN section 20, DECISIONS G46).
// Outfits are said the way a shop catalog says them and nothing in a prompt
// describes her body or makes her pose: fit words come out where they
// stand, the phrase naming a body word goes, "boy shorts" becomes "bike
// shorts" (every other garment name stays, "sports bra" included: owner,
// 2026-10-15), and "posing in" becomes "wearing". Only the words change,
// never what she wears. The lists are data (config/wording.yaml).
//
// Claude's words and the Studio's own lines are cleaned; a word the owner
// typed (`own`) is never touched. "Retry with safer wording" cleans every
// word that was sent, the owner's too, because the owner asked for it.

export interface WordingResult { text: string; changed: string[] }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// "low-cut" also finds "low cut" and "lowcut".
const termSource = (term: string) => term.trim().split(/[\s-]+/).map(esc).join('[\\s-]?')
const longestFirst = (list: string[]) => [...list].sort((a, b) => b.length - a.length)

// Framing, camera height and hair length ("waist-up", "waist height",
// "waist-length") and furniture
// ("the table legs") are not about her body.
const BODY_NOT_BEFORE = '(?<!\\b(?:table|chair|stool|bench|desk|tripod|piano|bed|sofa|couch|trouser|pant)[\\s-])'
const BODY_NOT_AFTER = '(?![\\s-]+(?:up|height|level|high|deep|length)\\b)'
// What leads into a body word: a verb or a preposition, then her and up to
// two words, or one word on its own ("showing off her toned legs", "fitted
// at the waist", "bare legs"). A verb of movement stays ("sways her hips"
// becomes "sways").
const BODY_LEAD = '(?:\\b(?:at|around|on|over|across|along|above|below|to|from|with|showing(?:\\s+off)?|shows(?:\\s+off)?|baring|bares|hugging|hugs|accentuating|accentuates|highlighting|highlights|flattering|flatters|emphasi[sz]ing|emphasi[sz]es|revealing|reveals|exposing|exposes|skims|skimming)\\s+)?'
const BODY_DET = '\\b(?:the|her|his|their|a|an)\\s+'

function bodyRe(term: string, flags = 'gi'): RegExp {
  return new RegExp(`${BODY_LEAD}(?:${BODY_DET}(?:\\b[\\w-]+\\s+){0,2}?|(?:\\b[\\w-]+\\s+)?)${BODY_NOT_BEFORE}\\b${termSource(term)}\\b${BODY_NOT_AFTER}`, flags)
}
function bodyWordRe(term: string, flags = 'gi'): RegExp {
  return new RegExp(`${BODY_NOT_BEFORE}\\b${termSource(term)}\\b${BODY_NOT_AFTER}`, flags)
}
const wordRe = (term: string, flags = 'gi') => new RegExp(`\\b${termSource(term)}\\b`, flags)

// The Studio's AVOID block (and anything after it) is never reworded:
// negated uses there are fine.
function splitAvoid(text: string): [string, string] {
  const at = text.search(/\bAVOID:/)
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at)]
}

// Same case as the word it replaces ("Bralette" becomes "Crop top").
const matchCase = (found: string, to: string) => (/^[A-Z]/.test(found) && to ? to.charAt(0).toUpperCase() + to.slice(1) : to)

// Where words came out: tidied around these marks only, so the rest of
// the text keeps every word ("turns the light on" stays).
const M = '\u0001'
const GAP = `(?:\\s*${M})+\\s*`
const END = '(?=[,.;:!?]|$)'

// One line tidied after words came out: no doubled commas or spaces, no
// connector left hanging before a comma or the end, "a" and "an" right.
function tidyLine(line: string, capital: boolean): string {
  let out = line
  for (let i = 0; i < 3; i++) {
    out = out
      // "a tight, low-cut black top": the list of adjectives went.
      .replace(new RegExp(`\\b(a|an|the)${GAP}(?:,|and\\b|or\\b)(?=\\s*${M})`, 'gi'), `$1 ${M}`)
      .replace(new RegExp(`\\b(?:with|and|or|in|at|that|which|showing|to|of|on)\\s+(?:(?:a|an|the|her|his|their)\\s+)?${GAP}${END}`, 'gi'), M)
      .replace(new RegExp(`\\b(?:a|an|the|her|his|their)${GAP}${END}`, 'gi'), M)
      .replace(new RegExp(`(^|[.;:!?]\\s*)${GAP},?\\s*`, 'g'), '$1')
      .replace(new RegExp(`,${GAP}(?=[,.;:!?]|$)`, 'g'), M)
  }
  // "a" and "an" right, and a capital again, only where words came out.
  out = out
    .replace(new RegExp(`\\b([Aa])n${GAP}(?=[bcdfghjklmnpqrstvwxyz])`, 'g'), '$1 ')
    .replace(new RegExp(`\\b([Aa])${GAP}(?=[aeiou])`, 'g'), '$1n ')
    .replace(new RegExp(`(^|[.!?]\\s+)${GAP}([a-z])`, 'g'), (m, p: string, c: string) => (p || capital ? `${p}${c.toUpperCase()}` : m))
  return out.split(M).join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,(?=[,.;:!?])/g, '')
    .replace(/(^|[.;:!?]\s*),\s*/g, '$1')
    .trim()
}

// Each line keeps its first letter's case ("dark green tank top" stays
// lower case; a sentence keeps its capital).
function tidy(text: string, before: string): string {
  const was = before.split('\n')
  return text.split('\n').map((l, i) => tidyLine(l, /^\s*[A-Z]/.test(was[i] ?? ''))).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// Claude's or the Studio's words in catalog terms. Terms found in `own`
// (the owner's typed words) are left as they are.
export function catalogWording(text: string, w: WordingConfig, own = ''): WordingResult {
  const [head, avoid] = splitAvoid(text)
  const changed = new Set<string>()
  const ownHas = (re: RegExp) => !!own && re.test(own)
  let out = head
  const swap = (pairs: Array<{ from: string; to: string }>) => {
    for (const p of [...pairs].sort((a, b) => b.from.length - a.from.length)) {
      if (ownHas(wordRe(p.from, 'i'))) continue
      out = out.replace(wordRe(p.from), m => { changed.add(p.from); return matchCase(m, p.to) })
    }
  }
  swap(w.swaps)
  swap(w.pose)
  for (const term of longestFirst(w.body)) {
    if (ownHas(bodyWordRe(term, 'i'))) continue
    out = out.replace(bodyRe(term), () => { changed.add(term); return M })
  }
  for (const term of longestFirst(w.fit)) {
    if (ownHas(wordRe(term, 'i'))) continue
    out = out.replace(wordRe(term), () => { changed.add(term); return M })
  }
  // Cup sizes ("a D cup", "36DD"): case-sensitive patterns, out like a fit word.
  for (const p of w.patterns ?? []) {
    if (ownHas(new RegExp(p))) continue
    out = out.replace(new RegExp(p, 'g'), m => { changed.add(m.trim()); return M })
  }
  if (!changed.size) return { text, changed: [] }
  const cleaned = tidy(out, head)
  return { text: avoid ? `${cleaned}${/\n\s*$/.test(head) ? '\n' : ' '}${avoid}` : cleaned, changed: [...changed] }
}

// Words in a prompt that the provider's filter often blocks (fit, body, cup
// sizes and "boy shorts"), outside the AVOID block, each named once.
export function findRiskyWords(text: string, w: WordingConfig): string[] {
  const [head] = splitAvoid(text)
  const found: string[] = []
  const seen = (term: string) => found.some(f => f.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(f.toLowerCase()))
  for (const s of [...w.swaps].sort((a, b) => b.from.length - a.from.length)) if (wordRe(s.from, 'i').test(head) && !seen(s.from)) found.push(s.from)
  for (const term of longestFirst(w.fit)) if (wordRe(term, 'i').test(head) && !seen(term)) found.push(term)
  for (const term of longestFirst(w.body)) if (bodyWordRe(term, 'i').test(head) && !seen(term)) found.push(term)
  for (const p of w.patterns ?? []) for (const m of head.match(new RegExp(p, 'g')) ?? []) if (!seen(m.trim())) found.push(m.trim())
  return found
}

// "Retry with safer wording": the prompt that was sent, every risky word
// reworded (the owner's too; the owner asked). Free: code only.
export function saferPrompt(prompt: string, w: WordingConfig): WordingResult {
  return catalogWording(prompt, w)
}
