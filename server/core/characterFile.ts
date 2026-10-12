import { parse as parseYaml, stringify as toYaml } from 'yaml'
import { z } from 'zod'
import { markSchema, pronounsSchema, type CharacterData } from './character'
import { capitalize, hardWrap } from './text'

// character-[name].md is the human-readable source of truth (SPEC 8). It
// round-trips with the Character record: structured fields live in a YAML
// block at the top; Card, Body and Notes are plain sections people can edit
// directly, and on import those sections win over the YAML copies.

const FORMAT = 1

const frontSchema = z.object({
  studio: z.literal('character-studio').optional(),
  format: z.number().optional(),
  name: z.string(),
  age: z.number().nullable().default(null),
  eyes: z.string().default(''),
  card: z.string().default(''),
  body: z.string().default(''),
  marks: z.array(markSchema).default([]),
  pronouns: pronounsSchema.default({ subj: 'she', obj: 'her', poss: 'her', noun: 'woman' }),
  makeup: z.object({ default: z.string().default('natural'), glam_when: z.array(z.string()).default([]) }).default({ default: 'natural', glam_when: [] }),
  style: z.record(z.string(), z.unknown()).default({}),
  persona: z.record(z.string(), z.unknown()).default({}),
  avoid_models: z.array(z.string()).default([]),
  preferred_models: z.record(z.string(), z.string()).default({}),
  disclosure: z.string().default('Label all posts as AI-generated'),
  notes: z.string().default(''),
  sheet: z.array(z.object({ id: z.string(), label: z.string(), status: z.string(), checksum: z.string().nullable() })).optional(),
})

export interface SheetEntry { id: string; label: string; status: string; checksum: string | null }

function markLine(m: CharacterData['marks'][number], poss: string): string {
  const rel = { brow: 'above', eye: 'below', lip: 'above', jaw: 'along', nose: 'beside' }[m.region as string] ?? 'on'
  return `- ${capitalize(m.description)} ${rel} ${poss} ${m.side} ${m.region}${m.subtle ? ' (subtle)' : ''}`
}

export function exportCharacterFile(ch: CharacterData, sheet: SheetEntry[] = []): string {
  const front = {
    studio: 'character-studio', format: FORMAT,
    name: ch.name, age: ch.age, eyes: ch.eyes, card: ch.card, body: ch.body,
    marks: ch.marks, pronouns: ch.pronouns, makeup: ch.makeup, style: ch.style, persona: ch.persona,
    avoid_models: ch.avoidModels, preferred_models: ch.preferredModels, disclosure: ch.disclosure, notes: ch.notes,
    ...(sheet.length ? { sheet } : {}),
  }
  const p = ch.pronouns.poss
  const parts = [
    '---', toYaml(front, { lineWidth: 0 }).trimEnd(), '---', '',
    `# ${ch.name}`, '',
    `> ${ch.disclosure}`, '',
    '## Card', '', hardWrap(ch.card), '',
    '## Distinguishing marks', '', ...ch.marks.map(m => markLine(m, p)), '',
    'Sides are always the character\'s own LEFT and RIGHT.', '',
    '## Body', '', hardWrap(ch.body), '',
    '## Makeup', '', `Default: ${ch.makeup.default}.${ch.makeup.glam_when.length ? ` Glam only for: ${ch.makeup.glam_when.join(', ').replace(/_/g, ' ')}.` : ''}`, '',
  ]
  if (sheet.length) {
    parts.push('## Reference sheet', '', '| ID | Shot | Status |', '| --- | --- | --- |', ...sheet.map(s => `| ${s.id} | ${s.label} | ${s.status} |`), '')
  }
  parts.push('## Notes', '', ch.notes ? hardWrap(ch.notes) : '(none)', '')
  return parts.join('\n')
}

function section(md: string, title: string): string | null {
  const re = new RegExp(`^## ${title}\\s*\\n([\\s\\S]*?)(?=^## |\\Z)`, 'm')
  const m = md.match(re)
  if (!m) return null
  return m[1]!.trim()
}

const unwrap = (s: string) => s.split('\n').map(l => l.trim()).join(' ').replace(/\s+/g, ' ').trim()

export interface ImportResult {
  character: CharacterData
  sheet: SheetEntry[]
  warnings: string[]
}

export function importCharacterFile(md: string): ImportResult {
  const warnings: string[] = []
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!fm) return importFreeform(md)
  const front = frontSchema.parse(parseYaml(fm[1]!))
  const body = md.slice(fm[0].length)
  const card = section(body, 'Card')
  const bodyText = section(body, 'Body')
  const notes = section(body, 'Notes')
  return {
    character: {
      name: front.name,
      age: front.age,
      eyes: front.eyes,
      card: card != null ? unwrap(card) : front.card,
      body: bodyText != null ? unwrap(bodyText) : front.body,
      marks: front.marks,
      pronouns: front.pronouns,
      makeup: front.makeup,
      style: front.style as CharacterData['style'],
      persona: front.persona as CharacterData['persona'],
      avoidModels: front.avoid_models,
      preferredModels: front.preferred_models,
      disclosure: front.disclosure,
      notes: notes != null && notes !== '(none)' ? unwrap(notes) : notes === '(none)' ? '' : front.notes,
    },
    sheet: front.sheet ?? [],
    warnings,
  }
}

// Files written outside the Studio (for example in a chat project): pull
// out what can be read reliably and say what could not.
const REGIONS = ['brow', 'eyebrow', 'eye', 'cheek', 'ear', 'lip', 'jaw', 'neck', 'nose', 'temple', 'forehead', 'chin']

export function importFreeform(md: string): ImportResult {
  const warnings: string[] = ['No Studio header found; imported by reading the text. Check every field.']
  const name = md.match(/^#\s+(?:character[:\s-]*)?(.+)$/im)?.[1]?.trim() ?? 'Imported character'
  const cardLine = md.match(/^\s*(?:[-*]\s*)?\**card\**\s*[:\-]\s*(.+)$/im)?.[1]?.trim() ?? section(md, 'Card') ?? ''
  const age = Number(cardLine.match(/\b(\d{2})\b/)?.[1] ?? md.match(/\bage\b\s*[:\-]?\s*(\d{2})/i)?.[1] ?? NaN)
  const eyes = md.match(/([a-z-]+(?:\s+[a-z-]+)?)\s+eyes/i)?.[1] ?? ''
  const marks: CharacterData['marks'] = []
  for (const line of md.split('\n')) {
    const side = line.match(/\b(LEFT|RIGHT)\b/)?.[1] as 'LEFT' | 'RIGHT' | undefined
    if (!side) continue
    const region = REGIONS.find(r => new RegExp(`\\b${r}s?\\b`, 'i').test(line))
    if (!region) continue
    const desc = line.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').split(/[:;]/).pop()!
      .replace(new RegExp(`\\b(?:above|below|on|along|beside)\\b.*$`, 'i'), '').trim()
    const isJewelry = /cuff|stud|hoop|ring|earring|piercing|chain|jewel/i.test(line)
    marks.push({
      name: isJewelry ? (line.match(/ear cuff|stud|hoop|earring|ring|piercing/i)?.[0]?.toLowerCase() ?? 'jewelry') : (line.match(/mole|freckle|scar|beauty mark|birthmark/i)?.[0]?.toLowerCase() ?? 'mark'),
      description: desc || line.trim(),
      side,
      region: (region === 'eyebrow' ? 'brow' : region) as CharacterData['marks'][number]['region'],
      kind: isJewelry ? 'jewelry' : 'skin',
      subtle: /subtle|small|faint/i.test(line) || !isJewelry,
    })
  }
  if (!cardLine) warnings.push('Could not find the card.')
  if (marks.length < 2) warnings.push(`Found ${marks.length} side-specific mark(s); expected 2.`)
  return {
    character: {
      name, age: Number.isFinite(age) ? age : null, eyes, card: unwrap(cardLine), marks,
      body: unwrap(section(md, 'Body') ?? ''),
      pronouns: { subj: 'she', obj: 'her', poss: 'her', noun: 'woman' },
      makeup: { default: 'natural', glam_when: [] }, style: {}, persona: {},
      avoidModels: [], preferredModels: {}, disclosure: 'Label all posts as AI-generated', notes: '',
    },
    sheet: [],
    warnings,
  }
}
