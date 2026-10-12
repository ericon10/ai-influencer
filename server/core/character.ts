import { z } from 'zod'
import { wordCount } from './text'

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
  style: { palette?: string[]; pieces?: string[]; accessories?: string[]; hair_options?: string[]; notes?: string }
  makeup: { default: string; glam_when: string[]; glam?: string }
  persona: { vibe?: string; settings?: string[]; never?: string[] }
  pronouns: Pronouns
  avoidModels: string[]
  preferredModels: Record<string, string>
  disclosure: string
  notes: string
  identities: CharacterIdentity[]
  sections: FileSection[]
}

export const MIN_AGE = 18
export const DEFAULT_MIN_AGE = 21
export const CARD_MAX_WORDS = 40

// Body terms the models exaggerate (SPEC 5.1 rule 9).
const SIZE_TERMS = /\b(?:[A-H]|AA|DD|DDD)[- ]?cups?\b|cup size|bust size|measurements|\b\d{2}-\d{2}-\d{2}\b/i

export interface ValidationIssue { field: string; message: string; severity: 'error' | 'warning' }

export function validateCharacter(c: Pick<CharacterData, 'age' | 'card' | 'marks' | 'body'>, minAge = DEFAULT_MIN_AGE): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (c.age == null) issues.push({ field: 'age', message: 'Set an age. Characters must be adults.', severity: 'error' })
  else if (c.age < MIN_AGE) issues.push({ field: 'age', message: 'Characters must be adults (18 or older).', severity: 'error' })
  else if (c.age < minAge) issues.push({ field: 'age', message: `The studio default is ${minAge} or older.`, severity: 'error' })
  if (!c.card.trim()) issues.push({ field: 'card', message: 'The card is empty.', severity: 'error' })
  if (wordCount(c.card) > CARD_MAX_WORDS) issues.push({ field: 'card', message: `Keep the card to ${CARD_MAX_WORDS} words or fewer (now ${wordCount(c.card)}).`, severity: 'warning' })
  if (c.marks.length !== 2) issues.push({ field: 'marks', message: 'Give the character exactly 2 distinguishing marks.', severity: 'warning' })
  for (const m of c.marks) {
    if (m.side !== 'LEFT' && m.side !== 'RIGHT') issues.push({ field: 'marks', message: `Mark "${m.name}" needs a side: LEFT or RIGHT.`, severity: 'error' })
  }
  if (SIZE_TERMS.test(c.body) || SIZE_TERMS.test(c.card)) {
    issues.push({ field: 'body', message: 'Describe the body in neutral brand terms, never cup sizes or measurements.', severity: 'error' })
  }
  return issues
}
