// REALISM PRINCIPLE (CLAUDE.md and SPEC.md, rule zero): characters look real
// because they are not perfect. Flaws, imperfections, real skin texture and a
// no-makeup baseline are the product, and the system never smooths them away.
//
// These are code, not config, on purpose: an account, a template edit or a
// character file can add to them but never switch them off.

// Every hero and sheet prompt (REF-00 to REF-11) carries this line.
export const BARE_FACE_LINE = 'Bare face, no makeup, no retouching.'

// Used when a character has no REALISM block of its own.
// The Studio default for every character without its own block: the
// owner's tested text (2026-10-13, Nano Banana 2.1 and GPT Image 2.5 Flare,
// clearly more realistic than the earlier block).
export const DEFAULT_REALISM_BLOCK =
  'REALISM: Candid iPhone photo, neutral natural light. Real skin texture: visible pores, soft peach fuzz catching the light on the cheeks and jaw, a few stray brow hairs and baby hairs at the hairline, subtle color variation with slight redness around the nose and cheeks, faint natural shine. No makeup or light makeup only, no beauty retouching, no beauty filter, no skin smoothing. Ordinary background, not a professional shoot.'

export const DEFAULT_AVOID_BLOCK =
  'AVOID: airbrushed or plastic skin, skin smoothing, beauty filters, studio lighting, perfect symmetry, text, watermarks.'

// Words that ask a model to smooth or beautify. Stripped from prompts by the
// builder (with a warning) and refused outright if one still reaches a run.
export const BANNED_REALISM_TERMS = [
  'flawless', 'perfect skin', 'smooth skin', 'airbrushed', 'retouched', 'porcelain',
  'beautify', 'glamour retouch', 'skin smoothing', 'beauty filter', 'enhance face',
] as const

// The imperfection dose is a real person on a good day. Heavier flaw words
// are never added on our side, and are removed from a prompt unless the
// character's own card, marks or realism notes ask for them.
const HEAVY_FLAWS = /\b(?:blemish(?:es|ed)?|acne|pimples?|zits?|scars?|scarr(?:ed|ing)|rough skin|pockmark\w*|breakouts?|enlarged pores|deep wrinkles|blotchy(?: skin)?|skin lesions?|rosacea|eczema|sun ?damage)\b/i

// Makeup words that do not belong in a bare-faced hero or sheet shot.
const MAKEUP_TERMS = /\b(?:glam(?:orous|our)?(?: makeup)?|soft glam|full glam|full makeup|heavy makeup|makeup look|wearing makeup|with makeup|red lip(?:stick)?s?|bold lips?|lipstick|lip gloss|winged (?:eye)?liner|eyeliner|mascara|eyeshadow|eye shadow|contour(?:ing|ed)?|bronzer|false lashes|lash extensions|smok(?:e|ey|y) eyes?)\b/i

// Flaws that must survive every step. QA reports them as expected, never as
// defects, and never suggests fixing them.
export const REQUIRED_FLAWS = /\b(?:pores?|freckl\w*|redness|red patch\w*|flush\w*|uneven (?:skin )?tone|uneven skin|blotch\w*|shine|shiny|oily|flyaways?|stray hairs?|smile lines?|laugh lines?|fine lines?|wrinkles?|asymmetr\w*|moles?|beauty marks?|blemish\w*|skin texture|imperfections?|under-?eye|dark circles?|spots?)\b/i

// A suggestion to remove one of them.
const FIX_FLAW = /\b(?:remove|fix|smooth(?:ed|ing)?|even(?:ed)? out|clear(?:ed)? up|clean(?:ed)? up|correct(?:ed)?|retouch\w*|erase|hide|conceal|reduce|soften)\b/i

const NEGATION = /\b(?:no|not|never|without|avoid|zero|nothing|free of|instead of|rather than)\b(?:\W+\w+){0,2}\W*$/i

// Negated within the same clause: "no airbrushed look" is fine, but in "no
// retouching, flawless glow" the "no" belongs to the clause before.
export function negated(prompt: string, index: number): boolean {
  const before = prompt.slice(Math.max(0, index - 60), index)
  const clause = before.split(/[,.;:!?\n]/).pop() ?? ''
  return NEGATION.test(clause)
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const TERM_RE = new RegExp(`\\b(?:${BANNED_REALISM_TERMS.map(t => escape(t).replace(/\\? /g, '[\\s-]+')).join('|')})\\b`, 'gi')

// An AVOID line lists what the model must not do, so banned words there are
// on our side. It runs from "AVOID:" (or "Avoid:") to the end of its line.
export function avoidRanges(prompt: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /\bavoid\s*:/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(prompt))) {
    const end = prompt.indexOf('\n', m.index)
    out.push([m.index, end === -1 ? prompt.length : end])
  }
  return out
}

interface Hit { term: string; index: number; length: number }

// Banned words that ask for smoothing: not inside an AVOID line and not
// negated just before ("no airbrushed look" is fine).
export function findBannedTerms(prompt: string): Hit[] {
  const avoid = avoidRanges(prompt)
  const hits: Hit[] = []
  for (const m of prompt.matchAll(TERM_RE)) {
    const index = m.index ?? 0
    if (avoid.some(([a, b]) => index >= a && index < b)) continue
    if (negated(prompt, index)) continue
    hits.push({ term: m[0].toLowerCase().replace(/[\s-]+/g, ' '), index, length: m[0].length })
  }
  return hits
}

// Removes banned words and tidies the punctuation they leave behind.
export function stripBannedTerms(prompt: string): { prompt: string; removed: string[] } {
  return stripHits(prompt, findBannedTerms(prompt))
}

function stripHits(prompt: string, hits: Hit[]): { prompt: string; removed: string[] } {
  if (!hits.length) return { prompt, removed: [] }
  let out = prompt
  for (const h of [...hits].sort((a, b) => b.index - a.index)) out = out.slice(0, h.index) + out.slice(h.index + h.length)
  out = out
    // A noun left on its own ("flawless porcelain skin," leaves "skin,").
    .replace(/(^|[,;:]|\b(?:with|and|has|have)\b)[ \t]+(?:skin|look|finish|complexion|face)[ \t]*(?=[,.;:]|$)/gim, '$1')
    .replace(/[ \t]+([,.;:])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/(^|[.!?]\s+|\n)[,;:]\s*/g, '$1')
    .replace(/\b(a|an|and|with|of|the)\s+([,.;:])/gi, '$2')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return { prompt: out, removed: [...new Set(hits.map(h => h.term))] }
}

function makeupHits(prompt: string): Hit[] {
  const avoid = avoidRanges(prompt)
  const out: Hit[] = []
  const re = new RegExp(MAKEUP_TERMS.source, 'gi')
  for (const m of prompt.matchAll(re)) {
    const index = m.index ?? 0
    if (avoid.some(([a, b]) => index >= a && index < b)) continue
    if (negated(prompt, index)) continue
    out.push({ term: m[0].toLowerCase(), index, length: m[0].length })
  }
  return out
}

function heavyFlawHits(prompt: string, allowed: string): Hit[] {
  const avoid = avoidRanges(prompt)
  const ok = allowed.toLowerCase()
  const out: Hit[] = []
  for (const m of prompt.matchAll(new RegExp(HEAVY_FLAWS.source, 'gi'))) {
    const index = m.index ?? 0
    if (avoid.some(([a, b]) => index >= a && index < b)) continue
    if (negated(prompt, index)) continue
    const word = m[0].toLowerCase()
    // Asked for: the card or a mark names it (a "small scar on her chin").
    if (ok.includes(word) || ok.includes(word.replace(/s$/, ''))) continue
    out.push({ term: word, index, length: m[0].length })
  }
  return out
}

export function findHeavyFlaws(prompt: string, allowed = ''): string[] {
  return [...new Set(heavyFlawHits(prompt, allowed).map(h => h.term))]
}

export function findMakeupTerms(prompt: string): string[] {
  return [...new Set(makeupHits(prompt).map(h => h.term))]
}

// A REALISM block: the label and real content after it.
export function hasRealismBlock(prompt: string): boolean {
  const m = prompt.match(/\bREALISM:\s*(.+)/)
  return !!m && m[1]!.trim().length >= 20
}

export function realismBlock(text?: string | null): string {
  const t = (text ?? '').trim()
  if (!t) return DEFAULT_REALISM_BLOCK
  return /^REALISM:/i.test(t) ? t.replace(/^realism:/i, 'REALISM:') : `REALISM: ${t}`
}

export function avoidBlock(text?: string | null): string {
  const t = (text ?? '').trim()
  if (!t) return DEFAULT_AVOID_BLOCK
  return /^AVOID:/i.test(t) ? t.replace(/^avoid:/i, 'AVOID:') : `AVOID: ${t}`
}

export const BARE_FACE_STAGES = ['hero', 'sheet'] as const
export const isBareFaceStage = (stage?: string) => !!stage && (BARE_FACE_STAGES as readonly string[]).includes(stage)

// Every reference image (hero and sheet) keeps its plain light gray
// background (owner, 2026-10-13). A character's REALISM block is written for
// scenes, so a clause about the background ("ordinary background clutter")
// is left out of hero and sheet prompts; scenes keep the block as written.
const BACKGROUND_CLAUSE = /\b(?:background|backdrop|clutter|surroundings|bystanders|passers-?by)\b/i
// "No makeup or light makeup only": the allowance after "no makeup". Hero and
// sheet shots never wear makeup, so it goes there.
const MAKEUP_ALLOWANCE = /\s+or\s+(?:light|minimal|natural|subtle|soft)\s+makeup(?:\s+only)?\b/i
// A clause that limits makeup, left out when a scene asks for soft glam.
const MAKEUP_LIMIT = /^(?:no makeup(?:\s+or\s+\w+\s+makeup(?:\s+only)?)?|(?:light|minimal|natural|subtle|soft)\s+makeup\s+only)$/i

// A block edited clause by clause (sentences, then commas), so leaving one
// clause out never takes its neighbors with it.
function editClauses(block: string, keep: (clause: string) => boolean, map: (clause: string) => string = c => c): string {
  const body = block.replace(/^REALISM:\s*/i, '').trim()
  const sentences = body.split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/[.!?]+$/, '').split(/,\s*/).map(c => map(c).trim()).filter(c => c && keep(c)).join(', '))
    .filter(Boolean)
  return `REALISM: ${sentences.map(s => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`).join(' ')}`
}

const forReference = (block: string) => editClauses(block, c => !BACKGROUND_CLAUSE.test(c), c => c.replace(MAKEUP_ALLOWANCE, ''))
// The default block as hero and sheet prompts use it.
export const DEFAULT_REFERENCE_REALISM = forReference(DEFAULT_REALISM_BLOCK)

export function realismForReference(block: string): string {
  const out = forReference(block)
  return hasRealismBlock(out) ? out : DEFAULT_REFERENCE_REALISM
}

// Framing-aware skin detail (owner, 2026-10-13, from the ultra-realism
// guide): the full block close and chest-up; waist-up its skin details
// become "natural skin texture"; full-body and wide name no skin detail at
// all (pore-level words on a small face read wrong). "No beauty smoothing"
// and "no retouching" are never dropped: added when the block lacks them.
export type SkinDetail = 'full' | 'natural' | 'none'
const SKIN_DETAIL = /\b(?:pores?|peach fuzz|stray|baby hairs?|brow hairs?|flyaways?|redness|colou?r variation|shine|sheen|freckles?|skin texture|imperfections?|under-eye|creases|expression lines|fine lines|blemish(?:es)?)\b/i
const NO_SMOOTHING = /\bno (?:beauty |skin )?smoothing\b/i
const NO_RETOUCHING = /\bno (?:beauty )?retouch(?:ing|ed)?\b/i

export function realismForFraming(block: string, skin: SkinDetail = 'full'): string {
  let out = block
  if (skin !== 'full' && SKIN_DETAIL.test(block)) {
    let first = true
    const edited = editClauses(block, c => c !== '', c => {
      if (!SKIN_DETAIL.test(c) || NO_SMOOTHING.test(c) || NO_RETOUCHING.test(c)) return c
      if (skin === 'natural' && first) { first = false; return 'natural skin texture' }
      return ''
    })
    out = hasRealismBlock(edited) ? edited : out
  }
  const missing = [NO_SMOOTHING.test(out) ? '' : 'no beauty smoothing', NO_RETOUCHING.test(out) ? '' : 'no retouching'].filter(Boolean)
  if (!missing.length) return out
  const body = out.trim().replace(/[.\s]+$/, '')
  const add = missing.join(', ')
  return `${body}. ${add.charAt(0).toUpperCase()}${add.slice(1)}.`
}

// Hero and sheet with the background switch off: bare-faced still, the
// background clause kept.
const bareFaceRealism = (block: string) => (MAKEUP_ALLOWANCE.test(block) ? editClauses(block, () => true, c => c.replace(MAKEUP_ALLOWANCE, '')) : block)

// A scene's makeup choice (a default) wins over the block's makeup line:
// soft glam leaves out "no makeup", bare leaves out the light-makeup
// allowance. Every other clause stays, "no skin smoothing" included.
export function realismForMakeup(block: string, makeup?: string): string {
  if (makeup === 'soft_glam') {
    const out = editClauses(block, c => !MAKEUP_LIMIT.test(c))
    return hasRealismBlock(out) ? out : block
  }
  if (makeup === 'bare') return bareFaceRealism(block)
  return block
}

export interface RealismWarning {
  ruleId: 'realism-banned-words' | 'realism-makeup' | 'realism-flaw-dose'
  spec: string
  title: string
  severity: 'warning'
  message: string
  match?: string
}

export interface FinalPrompt {
  prompt: string
  warnings: RealismWarning[]
}

// The last step of every image prompt the Studio builds: strip smoothing
// words (and say why), keep hero and sheet shots bare-faced, and add the
// REALISM and AVOID blocks. The REALISM block cannot be left out.
// `flawDose` (default rule realism-flaw-dose, on unless switched off) leaves
// out heavier flaw words the character does not have. `plainBackground`
// (default rule sheet-background) drops a REALISM background clause from
// hero and sheet prompts, which use their own background.
export function finalizeImagePrompt(prompt: string, opts: { stage?: string; realism?: string | null; avoid?: string | null; allowedFlaws?: string; flawDose?: boolean; plainBackground?: boolean; makeup?: string; skin?: SkinDetail; realismLine?: string } = {}): FinalPrompt {
  const warnings: RealismWarning[] = []
  const stripped = stripBannedTerms(prompt)
  let out = stripped.prompt
  const heavy = opts.flawDose === false ? { prompt: out, removed: [] as string[] } : stripHits(out, heavyFlawHits(out, opts.allowedFlaws ?? ''))
  out = heavy.prompt
  if (heavy.removed.length) {
    warnings.push({
      ruleId: 'realism-flaw-dose', spec: '0', title: 'Imperfections stay light', severity: 'warning',
      message: `Removed ${heavy.removed.map(t => `"${t}"`).join(', ')}. The imperfection dose is a real person on a good day; extra flaw words read heavy. Add them to the card if the character really has them.`,
      match: heavy.removed.join(', '),
    })
  }
  if (stripped.removed.length) {
    warnings.push({
      ruleId: 'realism-banned-words', spec: '0', title: 'Removed smoothing words', severity: 'warning',
      message: `Removed ${stripped.removed.map(t => `"${t}"`).join(', ')}. Words like these make models smooth skin away; real skin and visible flaws are what make the character believable.`,
      match: stripped.removed.join(', '),
    })
  }
  if (isBareFaceStage(opts.stage)) {
    const makeup = stripHits(out, makeupHits(out))
    out = makeup.prompt
    if (makeup.removed.length) {
      warnings.push({
        ruleId: 'realism-makeup', spec: '0', title: 'Hero and sheet shots are bare-faced', severity: 'warning',
        message: `Removed ${makeup.removed.map(t => `"${t}"`).join(', ')}. Hero and sheet shots never wear makeup; makeup belongs in scenes.`,
        match: makeup.removed.join(', '),
      })
    }
    if (!out.includes(BARE_FACE_LINE)) out = `${out} ${BARE_FACE_LINE}`
  }
  // The short form (Recreate): one REALISM line, no AVOID block.
  const line = opts.realismLine?.trim()
  if (line && !isBareFaceStage(opts.stage)) {
    const short = realismBlock(line)
    if (!hasRealismBlock(out)) out = `${out}\n${hasRealismBlock(short) ? short : DEFAULT_REALISM_BLOCK}`
    return { prompt: out.trim(), warnings }
  }
  const block = realismBlock(opts.realism)
  const realism = realismForFraming(!isBareFaceStage(opts.stage) ? realismForMakeup(block, opts.makeup)
    : opts.plainBackground !== false ? realismForReference(block) : bareFaceRealism(block), opts.skin)
  if (!hasRealismBlock(out)) out = `${out}\n${realism}`
  if (!/\bAVOID:/.test(out)) out = `${out}\n${avoidBlock(opts.avoid)}`
  return { prompt: out.trim(), warnings }
}

// Problems that stop a run outright. The builder never produces these; this
// is the guard for any path that skipped it.
export function realismBlockers(prompt: string, opts: { kind: string; stage?: string }): string[] {
  const out: string[] = []
  const image = opts.kind === 'image' || opts.kind === 'image_edit'
  if (image && !hasRealismBlock(prompt)) out.push('Every image prompt must include the REALISM block (real skin texture, no retouching).')
  const banned = findBannedTerms(prompt)
  if (banned.length) out.push(`The prompt asks for smoothing (${[...new Set(banned.map(b => b.term))].join(', ')}). Real skin and visible flaws are the product.`)
  if (image && isBareFaceStage(opts.stage) && !prompt.includes(BARE_FACE_LINE)) out.push(`Hero and sheet prompts must include "${BARE_FACE_LINE}"`)
  return out
}

// QA text that treats a natural flaw as a defect, or suggests fixing one.
export function treatsFlawAsDefect(text: string): boolean {
  return REQUIRED_FLAWS.test(text)
}

export function suggestsFixingFlaw(text: string): boolean {
  return REQUIRED_FLAWS.test(text) && FIX_FLAW.test(text)
}

// The flaw itself, without any suggestion to change it ("remove the small
// mole" becomes "the small mole").
export function describeFlaw(text: string): string {
  return text.replace(new RegExp(FIX_FLAW.source, 'gi'), '').replace(/\s{2,}/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '')
}

// Provider options that beautify, smooth or rewrite prompts toward "perfect"
// faces. Whatever a request or config says, adapters send them off.
const BEAUTIFY_KEY = /beaut|face_?enhanc|enhance_?face|skin_?smooth|smooth_?skin|retouch|face_?restor|restore_?face|portrait_?enhanc|face_?refin|enhance_?prompt|prompt_?enhanc|magic_?prompt/i

export function isBeautifyOption(key: string): boolean {
  return BEAUTIFY_KEY.test(key)
}

function offValue(v: unknown): unknown {
  if (typeof v === 'number') return 0
  if (typeof v === 'string') return /^(on|true|yes|auto|enabled?|high|medium|low|strong|light)$/i.test(v) ? 'off' : v
  return false
}

export function forceBeautifyOff<T extends Record<string, unknown>>(params: T): T {
  const out: Record<string, unknown> = { ...params }
  for (const [k, v] of Object.entries(out)) {
    if (isBeautifyOption(k)) out[k] = offValue(v)
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = forceBeautifyOff(v as Record<string, unknown>)
  }
  return out as T
}
