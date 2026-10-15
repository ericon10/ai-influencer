import { z } from 'zod'
import { wordCount } from './text.js'
import type { VoiceCard } from './voiceCard.js'

// The character record shared by the pipeline, the character file and QA.

export const markSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  side: z.enum(['LEFT', 'RIGHT']),
  region: z.enum(['brow', 'eye', 'cheek', 'ear', 'lip', 'jaw', 'neck', 'nose', 'temple', 'forehead', 'chin']),
  kind: z.enum(['skin', 'jewelry']),
  subtle: z.boolean().default(true),
})

export const pronounsSchema = z.object({
  subj: z.string().default('she'),
  obj: z.string().default('her'),
  poss: z.string().default('her'),
  noun: z.string().default('woman'),
})

export type Pronouns = z.infer<typeof pronounsSchema>
export type CharacterMark = z.infer<typeof markSchema>

// A saved identity on a provider, for example a Higgsfield Element (instant,
// no training, referenced from prompts) or a trained Soul character.
export interface CharacterIdentity {
  provider: string
  kind: 'element' | 'trained'
  name: string
  externalId: string
  status: 'ready' | 'queued' | 'failed'
  // The model this identity is used with (a Soul character runs on Soul).
  model?: string
  // Text that goes into every prompt that uses this identity.
  promptBlock?: string
  // A follow-up pass after every result made with this identity, for
  // example a face-only edit that locks the face to REF-00.
  followUp?: { name: string; model?: string; text: string }
  notes?: string
}

// A section of the character file kept as written.
export interface FileSection { title: string; body: string }

export interface CharacterData {
  name: string
  age: number | null
  card: string
  eyes: string
  marks: CharacterMark[]
  body: string
  // Style is optional suggestions only. It is never put into a prompt; every
  // scene names its own outfit. The only constants are the marks.
  style: {
    ideas?: string[]
    hair_options?: string[]
    notes?: string
    // From older files; read the same way, as suggestions.
    palette?: string[]
    pieces?: string[]
    accessories?: string[]
  }
  makeup: { default: string; glam_when: string[]; glam?: string }
  // `never` and `defaults` are suggestions for the planner, never limits.
  // `voice`: the voice card and the ElevenLabs voice (voice lines, the
  // caption and hook writers); every field optional.
  persona: { vibe?: string; settings?: string[]; never?: string[]; defaults?: string; voice?: VoiceCard }
  pronouns: Pronouns
  avoidModels: string[]
  preferredModels: Record<string, string>
  disclosure: string
  notes: string
  identities: CharacterIdentity[]
  sections: FileSection[]
  // Realism principle: the REALISM block goes into every image prompt and
  // the AVOID block after it. Empty means the Studio defaults. Notes are the
  // character file's Realism section, kept for people to read.
  realism: CharacterRealism
}

export interface CharacterRealism { block?: string; avoid?: string; notes?: string[] }

// Fixed rule adult-21: every character is 21 or older (owner ruling G1).
export const MIN_AGE = 21
export const DEFAULT_MIN_AGE = 21
export const CARD_MAX_WORDS = 40

// The age in a card ("24 years old.", "a 24-year-old"), taken out of edit
// prompts that carry a real person's photo (Recreate): the provider's filter
// blocked every still that had age words next to that photo (2026-10-15).
// The age itself stays enforced on the record and before each run.
const YEARS = String.raw`\d{1,3}\s*-?\s*(?:years?|yrs?)(?:\s*-?\s*old)?`
const AGE_WORDS = [
  new RegExp(String.raw`\b(?:who\s+is|is|was)\s+${YEARS}(?:\s*,?\s*and\b)?`, 'gi'),
  /\baged?\s+\d{1,3}\b/gi,
  new RegExp(String.raw`\b${YEARS}\b`, 'gi'),
]
export function cardWithoutAge(card: string): string {
  return card.split(/(?<=[.!?])\s+/)
    .map(s => AGE_WORDS.reduce((acc, re) => acc.replace(re, ''), s)
      .replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,;:]+/, '').replace(/[\s,;:]+([.!?]?)$/, '$1').trim())
    .filter(s => s.replace(/\b(?:a|an|the)\b/gi, '').split(/\s+/).filter(w => /[a-z]{2,}/i.test(w)).length >= 2)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

// The card for an edit of a real person's photo (Recreate): the face and the
// hair only. Age, body, style and mood words are left out: the provider's filter blocked
// every Recreate still that described her age and body next to the photo of
// the person she replaces (2026-10-15). The photo already gives the pose and
// the frame; the element and REF-00 carry her face.
const FACE_HAIR_WORDS = /\b(?:hair|bangs|fringe|bob|curls?|waves?|braids?|ponytail|eyes?|brows?|eyebrows?|lashes|lips?|mouth|smile|teeth|nose|cheeks?|cheekbones?|chin|jaw(?:line)?|face|forehead|freckles?|moles?|dimples?|scars?|birthmarks?|skin|complexion|ears?|piercings?)\b/i
const BODY_WORDS = /\b(?:fit|build|body|figure|physique|legs?|thighs?|waist|hips?|curv\w*|bust|chest|breasts?|butt|glutes?|abs|toned|athletic|slim|slender|petite|tall|height|weight|muscular|hourglass)\b/i
export function cardForPhotoEdit(card: string): string {
  return cardWithoutAge(card).split(/(?<=[.!?])\s+/)
    // Face and hair only (owner, 2026-10-15): style, mood and body go.
    .filter(s => FACE_HAIR_WORDS.test(s))
    .map(s => {
      const end = /[.!?]$/.test(s) ? s.slice(-1) : '.'
      const parts = s.replace(/[.!?]$/, '').split(/\s*,\s*/).filter(p => !BODY_WORDS.test(p))
      if (!parts.length) return ''
      const out = parts.join(', ')
      return `${out.charAt(0).toUpperCase()}${out.slice(1)}${end}`
    })
    .filter(Boolean)
    .join(' ')
}

// An outfit read from a real person's photo, said plainly for a Recreate
// prompt: the color and the garment, no sleeve, fit, length or cut details
// ("dark green sleeveless fitted top" becomes "dark green top"). The owner's
// own words are never changed (owner, 2026-10-15).
const OUTFIT_DETAIL = /\b(?:sleeveless|strapless|backless|halter(?:-?neck)?|(?:short|long|cap|puff|three-quarter)[- ]sleeved?|spaghetti[- ]straps?|thin[- ]straps?|one[- ]shoulder|off[- ]the[- ]shoulders?|off[- ]shoulder|fitted|form[- ]fitting|figure[- ]hugging|skin[- ]?tight|tight|snug|bodycon|clingy|low[- ]cut|plunging|deep[- ]v|cropped|crop|mini|micro|sheer|see[- ]through|revealing)\b/gi
export function plainOutfit(text: string): string {
  return text.replace(OUTFIT_DETAIL, '').replace(/\s*,\s*(?=,|$)/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim()
}

// Fixed rule adult-21 before a run, instead of age words in the prompt.
export function adultProblem(age: number | null | undefined, minAge = DEFAULT_MIN_AGE): string | null {
  if (age == null) return 'Set an age first. Characters must be adults, 21 or older.'
  if (age < Math.max(MIN_AGE, minAge)) return 'Characters are 21 or older.'
  return null
}

// Body terms the models exaggerate (SPEC 5.1 rule 9).
const SIZE_TERMS = /\b(?:[A-H]|AA|DD|DDD)[- ]?cups?\b|cup size|bust size|measurements|\b\d{2}-\d{2}-\d{2}\b/i

export interface ValidationIssue { field: string; message: string; severity: 'error' | 'warning' }

export function validateCharacter(c: Pick<CharacterData, 'age' | 'card' | 'marks' | 'body'>, minAge = DEFAULT_MIN_AGE): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (c.age == null) issues.push({ field: 'age', message: 'Set an age. Characters must be adults.', severity: 'error' })
  else if (c.age < Math.max(MIN_AGE, minAge)) issues.push({ field: 'age', message: 'Characters are 21 or older.', severity: 'error' })
  if (!c.card.trim()) issues.push({ field: 'card', message: 'The card is empty.', severity: 'error' })
  if (wordCount(c.card) > CARD_MAX_WORDS) issues.push({ field: 'card', message: `Keep the card to ${CARD_MAX_WORDS} words or fewer (now ${wordCount(c.card)}).`, severity: 'warning' })
  for (const m of c.marks) {
    if (m.side !== 'LEFT' && m.side !== 'RIGHT') issues.push({ field: 'marks', message: `Mark "${m.name}" needs a side: LEFT or RIGHT.`, severity: 'error' })
  }
  if (SIZE_TERMS.test(c.body) || SIZE_TERMS.test(c.card)) {
    // A default (neutral-body-cups), so a warning at most.
    issues.push({ field: 'body', message: 'Neutral body terms usually work better than cup sizes or measurements; models exaggerate them.', severity: 'warning' })
  }
  return issues
}
