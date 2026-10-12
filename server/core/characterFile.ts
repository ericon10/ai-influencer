import { parse as parseYaml, stringify as toYaml } from 'yaml'
import { z } from 'zod'
import { markSchema, pronounsSchema, type CharacterData, type CharacterIdentity, type CharacterMark, type FileSection, type Pronouns } from './character'
import { capitalize, hardWrap, wordCount } from './text'

// character-[name].md is the human-readable source of truth (SPEC 8). It
// round-trips with the Character record: structured fields live in a YAML
// block at the top; Card, Body and Notes are plain sections people can edit
// directly, and on import those sections win over the YAML copies. Any other
// section (scene rules, recipes, a combo log) is kept word for word.
//
// Files written by hand, without the YAML block, are read section by
// section (importFreeform).

const FORMAT = 1
const GENERATED = '<!-- studio:generated -->'

const identitySchema = z.object({
  provider: z.string(),
  kind: z.enum(['element', 'trained']),
  name: z.string(),
  externalId: z.string(),
  status: z.enum(['ready', 'queued', 'failed']),
  notes: z.string().optional(),
})

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
  makeup: z.object({ default: z.string().default('natural'), glam_when: z.array(z.string()).default([]), glam: z.string().optional() }).default({ default: 'natural', glam_when: [] }),
  style: z.record(z.string(), z.unknown()).default({}),
  persona: z.record(z.string(), z.unknown()).default({}),
  avoid_models: z.array(z.string()).default([]),
  preferred_models: z.record(z.string(), z.string()).default({}),
  identity: identitySchema.nullable().default(null),
  disclosure: z.string().default('Label all posts as AI-generated'),
  notes: z.string().default(''),
  sheet: z.array(z.object({ id: z.string(), label: z.string(), status: z.string(), checksum: z.string().nullable() })).optional(),
})

export interface SheetEntry { id: string; label: string; status: string; checksum: string | null }

// For mapping model names written in a file ("Nano Banana 2.1") to refs.
export interface ModelAlias { ref: string; label: string; aliases?: string[] }

export interface ImportOptions { models?: ModelAlias[] }

export interface ImportResult {
  character: CharacterData
  sheet: SheetEntry[]
  warnings: string[]
}

// ── Sections ────────────────────────────────────────────────────────────

export interface ParsedFile { title: string | null; preamble: string; sections: FileSection[] }

// Splits on "## " headings (not "###"), ignoring headings inside code fences.
export function splitSections(md: string): ParsedFile {
  let title: string | null = null
  const preamble: string[] = []
  const sections: Array<{ title: string; lines: string[] }> = []
  let fence = false
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence
    const h2: RegExpMatchArray | null = !fence ? line.match(/^##(?!#)\s+(.+?)\s*#*\s*$/) : null
    const h1: RegExpMatchArray | null = !fence && !sections.length && title === null ? line.match(/^#(?!#)\s+(.+?)\s*#*\s*$/) : null
    if (h2) sections.push({ title: h2[1]!, lines: [] })
    else if (h1) title = h1[1]!
    else (sections.length ? sections[sections.length - 1]!.lines : preamble).push(line)
  }
  return {
    title,
    preamble: preamble.join('\n').trim(),
    sections: sections.map(s => ({ title: s.title, body: s.lines.join('\n').replace(/^\s*\n/, '').trimEnd() })),
  }
}

const unwrap = (s: string) => s.split('\n').map(l => l.trim()).join(' ').replace(/\s+/g, ' ').trim()
const norm = (t: string) => t.toLowerCase().replace(/[^a-z ]/g, '').trim()

function find(sections: FileSection[], ...patterns: RegExp[]): FileSection | undefined {
  return sections.find(s => patterns.some(p => p.test(norm(s.title))))
}

// ── Export ──────────────────────────────────────────────────────────────

function markLine(m: CharacterMark, poss: string): string {
  const rel = { brow: 'above', eye: 'below', lip: 'above', jaw: 'along', nose: 'beside' }[m.region as string] ?? 'on'
  return `- ${capitalize(m.description)} ${rel} ${poss} ${m.side} ${m.region}${m.subtle ? ' (subtle)' : ''}`
}

const OWNED = ['card', 'distinguishing marks', 'body', 'makeup', 'notes']

export function exportCharacterFile(ch: CharacterData, sheet: SheetEntry[] = []): string {
  const front = {
    studio: 'character-studio', format: FORMAT,
    name: ch.name, age: ch.age, eyes: ch.eyes, card: ch.card, body: ch.body,
    marks: ch.marks, pronouns: ch.pronouns, makeup: ch.makeup, style: ch.style, persona: ch.persona,
    avoid_models: ch.avoidModels, preferred_models: ch.preferredModels, identity: ch.identity, disclosure: ch.disclosure, notes: ch.notes,
    ...(sheet.length ? { sheet } : {}),
  }
  const p = ch.pronouns.poss
  const glam = ch.makeup.glam_when.length ? ` ${ch.makeup.glam ? capitalize(ch.makeup.glam) : 'Glam'} only for: ${ch.makeup.glam_when.join(', ').replace(/_/g, ' ')}.` : ''
  const parts = [
    '---', toYaml(front, { lineWidth: 0 }).trimEnd(), '---', '',
    `# ${ch.name}`, '',
    `> ${ch.disclosure}`, '',
    '## Card', '', hardWrap(ch.card), '',
    '## Distinguishing marks', '', ...ch.marks.map(m => markLine(m, p)), '',
    'Sides are always the character\'s own LEFT and RIGHT.', '',
    '## Body', '', hardWrap(ch.body), '',
    '## Makeup', '', `Default: ${ch.makeup.default}.${glam}`, '',
  ]
  for (const s of ch.sections) parts.push(`## ${s.title}`, '', s.body, '')
  if (sheet.length) {
    const title = ch.sections.some(s => norm(s.title) === 'reference sheet') ? 'Sheet status' : 'Reference sheet'
    parts.push(`## ${title}`, '', GENERATED, '', '| ID | Shot | Status |', '| --- | --- | --- |', ...sheet.map(s => `| ${s.id} | ${s.label} | ${s.status} |`), '')
  }
  parts.push('## Notes', '', ch.notes ? hardWrap(ch.notes) : '(none)', '')
  return parts.join('\n')
}

// ── Import ──────────────────────────────────────────────────────────────

export function importCharacterFile(md: string, opts: ImportOptions = {}): ImportResult {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!fm) return importFreeform(md, opts)
  const front = frontSchema.parse(parseYaml(fm[1]!))
  const { sections } = splitSections(md.slice(fm[0].length))
  const get = (t: string) => sections.find(s => norm(s.title) === t)?.body
  const card = get('card')
  const bodyText = get('body')
  const notes = get('notes')
  // Generated tables are rebuilt on export (older exports had no marker).
  const generated = (s: FileSection) => s.body.startsWith(GENERATED) || (norm(s.title) === 'reference sheet' && s.body.startsWith('| ID | Shot | Status |'))
  const kept = sections.filter(s => !OWNED.includes(norm(s.title)) && !generated(s))
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
      notes: notes != null ? (notes === '(none)' ? '' : unwrap(notes)) : front.notes,
      identity: front.identity,
      sections: kept,
    },
    sheet: front.sheet ?? [],
    warnings: [],
  }
}

// Files written outside the Studio (for example in a chat project). Each
// section is read for what the Studio models; sections it does not model
// are kept as written. Every guess is reported back as a warning.

const REGIONS = ['brow', 'eyebrow', 'eye', 'cheek', 'ear', 'lip', 'jaw', 'neck', 'nose', 'temple', 'forehead', 'chin']
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

interface Bullet { key: string | null; value: string }

function bullets(body: string): Bullet[] {
  const out: Bullet[] = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\*\*/g, '')
    const item = line.match(/^\s*[-*+]\s+(.*)$/)
    if (item) {
      const kv = item[1]!.match(/^([^:]{1,60}?)\s*:\s+(.+)$/)
      out.push(kv ? { key: kv[1]!.trim(), value: kv[2]!.trim() } : { key: null, value: item[1]!.trim() })
    } else if (out.length && /^\s{2,}\S/.test(line)) {
      out[out.length - 1]!.value += ` ${line.trim()}`
    }
  }
  return out
}

// Splits a list on a separator, ignoring separators inside parentheses.
function splitList(value: string, sep: ',' | ';'): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === sep && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim().replace(/\.$/, '').trim()).filter(Boolean)
}

function sentences(text: string): string[] {
  return unwrap(text).split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(s => s.trim()).filter(Boolean)
}

function parseMark(line: string): CharacterMark | null {
  const clean = line.replace(/^\s*[-*+]\s*/, '').replace(/\*\*/g, '')
  const sideWord = clean.match(/\b(left|right)\b/i)?.[1]
  if (!sideWord) return null
  const region = REGIONS.find(r => new RegExp(`\\b${r}s?\\b`, 'i').test(clean))
  if (!region) return null
  const isJewelry = /cuff|stud|hoop|ring|earring|piercing|chain|jewel/i.test(clean)
  const desc = clean.split(/[:;]/).pop()!
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+(?:just\s+|right\s+|slightly\s+|directly\s+)?(?:above|below|under|on|along|beside|near|by|over)\b.*$/i, '')
    .replace(/,\s*$/, '').trim()
  return {
    name: isJewelry ? (clean.match(/ear cuff|stud|hoop|earring|ring|piercing|chain/i)?.[0]?.toLowerCase() ?? 'jewelry') : (clean.match(/mole|freckle|scar|beauty mark|birthmark/i)?.[0]?.toLowerCase() ?? 'mark'),
    description: (desc || clean).replace(/^./, c => c.toLowerCase()),
    side: sideWord.toUpperCase() as 'LEFT' | 'RIGHT',
    region: (region === 'eyebrow' ? 'brow' : region) as CharacterMark['region'],
    kind: isJewelry ? 'jewelry' : 'skin',
    subtle: isJewelry ? /subtle|small|faint|tiny|delicate/i.test(clean) : true,
  }
}

function detectPronouns(md: string): Pronouns {
  const count = (re: RegExp) => (md.match(re) ?? []).length
  const she = count(/\b(?:she|her|hers)\b/gi), he = count(/\b(?:he|him|his)\b/gi), they = count(/\b(?:they|them|their)\b/gi)
  if (he > she && he > they) return { subj: 'he', obj: 'him', poss: 'his', noun: 'man' }
  if (they > she && they > he) return { subj: 'they', obj: 'them', poss: 'their', noun: 'person' }
  return { subj: 'she', obj: 'her', poss: 'her', noun: 'woman' }
}

// The first model named in a line, longest name first at each position.
function modelIn(line: string, models: ModelAlias[]): string | null {
  const names = models.flatMap(m => [m.label, ...(m.aliases ?? [])].map(n => ({ n, ref: m.ref })))
    .sort((a, b) => b.n.length - a.n.length)
  let best: { at: number; len: number; ref: string } | null = null
  const lower = line.toLowerCase()
  for (const { n, ref } of names) {
    const at = lower.search(new RegExp(`(?<![a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9]|\\.\\d)`))
    if (at >= 0 && (!best || at < best.at || (at === best.at && n.length > best.len))) best = { at, len: n.length, ref }
  }
  return best?.ref ?? null
}

export function importFreeform(md: string, opts: ImportOptions = {}): ImportResult {
  const warnings: string[] = ['Read as a hand-written character file (no Studio header). Check the fields below.']
  const file = splitSections(md)
  const { sections } = file
  const models = opts.models ?? []
  const name = (file.title ?? '').replace(/^character\s*[:\-]\s*/i, '').trim() || 'Imported character'
  const parsedOnly = new Set<FileSection>()

  // Card: the face and body only. Marks and style move to their own fields.
  const cardSec = find(sections, /^card$/, /^character card$/)
  const cardRaw = cardSec?.body ?? md.match(/^\s*(?:[-*]\s*)?\**card\**\s*[:\-]\s*(.+)$/im)?.[1] ?? ''
  if (cardSec) parsedOnly.add(cardSec)
  const cardSentences = sentences(cardRaw)
  const moved = cardSentences.filter(s => /^(?:distinguishing marks|marks|signature style|style)\s*:/i.test(s))
  let card = cardSentences.filter(s => !moved.includes(s)).join(' ')
  const age = Number(card.match(/\b(\d{2})\s*(?:years?\s*old|y\/?o)\b/i)?.[1] ?? card.match(/\b(\d{2})\b/)?.[1] ?? md.match(/\bage\b\D{0,3}(\d{2})/i)?.[1] ?? NaN)
  const withName = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*`, 'i')
  if (withName.test(card)) { card = card.replace(withName, ''); card = card.replace(/^./, c => c.toUpperCase()) }
  if (moved.length) warnings.push(`Moved ${moved.map(s => `"${s.split(':')[0]}"`).join(' and ')} out of the card into their own fields; the card is now ${wordCount(card)} words.`)
  if (!card) warnings.push('Could not find the card.')
  const eyes = (card.match(/([a-z-]+(?:\s+[a-z-]+)?)\s+eyes\b/i)?.[1] ?? md.match(/([a-z-]+(?:\s+[a-z-]+)?)\s+eyes\b/i)?.[1] ?? '').toLowerCase()

  const bodySec = find(sections, /^body$/)
  if (bodySec) parsedOnly.add(bodySec)
  const body = bodySec ? unwrap(bodySec.body) : (cardSentences.find(s => /\b(?:build|figure|frame|physique)\b/i.test(s)) ?? '').replace(/\.$/, '')

  // Marks: from the marks section when there is one (other sections mention
  // sides for unrelated reasons, like hair tucked behind an ear).
  const marksSec = find(sections, /marks?$/)
  if (marksSec) parsedOnly.add(marksSec)
  const marks: CharacterMark[] = []
  for (const line of (marksSec?.body ?? md).split('\n')) {
    const m = parseMark(line)
    if (m && !marks.some(x => x.kind === m.kind && x.region === m.region && x.side === m.side)) marks.push(m)
  }
  if (marks.length !== 2) warnings.push(`Found ${marks.length} side-specific mark(s); expected 2.`)

  // Style and makeup.
  const style: CharacterData['style'] = {}
  const makeup: CharacterData['makeup'] = { default: 'natural', glam_when: [] }
  const styleSec = find(sections, /style$/)
  const styleNotes: string[] = []
  const summary = moved.find(s => /^(?:signature )?style\s*:/i.test(s))
  if (summary) styleNotes.push(`Signature look: ${summary.replace(/^[^:]+:\s*/, '')}`)
  for (const b of bullets(styleSec?.body ?? '')) {
    const k = (b.key ?? '').toLowerCase()
    if (/palette|colou?rs/.test(k)) style.palette = splitList(b.value, ',')
    else if (/pieces|staples|wardrobe/.test(k)) style.pieces = splitList(b.value, ',')
    else if (/accessor/.test(k)) style.accessories = splitList(b.value, ';')
    else if (/hair/.test(k)) style.hair_options = splitList(b.value, ';')
    else if (/makeup/.test(k)) {
      const def = b.value.match(/^([a-z][a-z ]*?)\s+by default(?:\s*\(([^)]*)\))?/i)
      if (def) makeup.default = def[2] ? `${def[1]!.toLowerCase()} (${def[2]})` : def[1]!.toLowerCase()
      const when = b.value.match(/\bonly for\s+([^.]+)/i)?.[1]
      if (when) makeup.glam_when = when.split(/,|\band\b/).map(w => w.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean)
      const glam = b.value.match(/\b((?:soft |full )?glam(?:\s*\([^)]*\))?)/i)?.[1]
      if (glam) makeup.glam = glam.toLowerCase()
    } else styleNotes.push(b.key ? `${b.key}: ${b.value}` : b.value)
  }
  if (styleNotes.length) style.notes = styleNotes.map(n => (/[.!?]$/.test(n) ? n : `${n}.`)).join(' ')

  // Persona.
  const persona: CharacterData['persona'] = {}
  for (const b of bullets(find(sections, /persona$/, /personality$/)?.body ?? '')) {
    const k = (b.key ?? '').toLowerCase()
    if (/vibe|personality/.test(k)) persona.vibe = b.value
    else if (/setting|places|locations/.test(k)) persona.settings = splitList(b.value, ',')
    else if (/never|avoid|don/.test(k)) persona.never = splitList(b.value, ',')
  }

  // Disclosure.
  const discSec = find(sections, /^disclosure$/)
  if (discSec) parsedOnly.add(discSec)
  const disclosure = discSec ? unwrap(discSec.body) : 'Label all posts as AI-generated'

  // Models: identity (a saved element), preferred and avoided models.
  let identity: CharacterIdentity | null = null
  const preferredModels: Record<string, string> = {}
  const avoidModels: string[] = []
  for (const b of bullets(find(sections, /^models?$/, /^model notes$/)?.body ?? '')) {
    const k = (b.key ?? '').toLowerCase()
    const line = `${b.key ?? ''}: ${b.value}`
    const id = b.value.match(UUID)?.[0]
    if (id && /element|identity|character/i.test(line)) {
      identity = {
        provider: /higgsfield/i.test(line) ? 'higgsfield' : 'unknown',
        kind: /element/i.test(line) ? 'element' : 'trained',
        name: b.value.match(/["“]([^"”]+)["”]/)?.[1] ?? name,
        externalId: id, status: 'ready', notes: b.value,
      }
      continue
    }
    const ref = modelIn(b.value, models)
    if (!ref) continue
    if (/avoid/.test(k)) { if (!avoidModels.includes(ref)) avoidModels.push(ref) }
    else if (/video/.test(k) && /final/.test(k)) preferredModels.video_final = ref
    else if (/video/.test(k) && /test|cheap|motion/.test(k)) preferredModels.video_test = ref
    else if (/still|scene|image/.test(k)) preferredModels.scene_still = ref
    else if (!b.key && /sheet/i.test(b.value)) preferredModels.sheet = ref
  }
  if (identity) warnings.push(`Identity: ${identity.provider === 'higgsfield' ? 'Higgsfield ' : ''}${identity.kind === 'element' ? 'Element' : 'trained model'} "${identity.name}".`)

  // Keep everything the Studio does not model, as written.
  const kept = sections.filter(s => !parsedOnly.has(s) && !/^notes?$/.test(norm(s.title)))
  if (kept.length) warnings.push(`Kept ${kept.length} section(s) as written: ${kept.map(s => s.title).join(', ')}.`)
  const notesSec = find(sections, /^notes?$/)

  return {
    character: {
      name, age: Number.isFinite(age) ? age : null, eyes, card, marks, body,
      pronouns: detectPronouns(md),
      makeup, style, persona, avoidModels, preferredModels, disclosure,
      notes: notesSec ? unwrap(notesSec.body) : '',
      identity, sections: kept,
    },
    sheet: [],
    warnings,
  }
}
