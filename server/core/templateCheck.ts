import { importCharacterFile, splitSections } from './characterFile.js'
import type { FileSection } from './character.js'

// The character file checked against character template v1.6
// (docs/character-template.md, Part B), for free, before an import and on
// the character page (owner, 2026-10-15, long run part 3). What the
// template needs is named; optional sections that are missing are listed;
// nothing here ever blocks an import.

export const TEMPLATE_VERSION = '1.6'

export interface TemplateItem {
  id: string
  label: string
  ok: boolean
  // What was found, or what to add.
  detail: string
}

export interface TemplateReport {
  version: string
  // Needed by the template: every UNIVERSAL section, the 21+ age, one
  // distinguishing mark, REF-00 to REF-11 labeled, the Element ID when an
  // Element is named.
  needed: TemplateItem[]
  // Optional sections the file does not have, in template order.
  missingOptional: string[]
  // Sections still holding template [brackets] to fill.
  brackets: string[]
  // Every needed item is there.
  complete: boolean
}

const norm = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9: ]+/g, ' ').replace(/\s+/g, ' ').trim()

// The UNIVERSAL sections, matched by title words so "Scene rules learned"
// and "Proven recipe: the candid caught you shot" count.
const UNIVERSAL: Array<{ id: string; label: string; re: RegExp }> = [
  { id: 'realism', label: 'Realism principle', re: /^realism\b/ },
  { id: 'models', label: 'Models', re: /^models?\b/ },
  { id: 'scene-rules', label: 'Scene rules', re: /^scene rules\b/ },
  { id: 'video-rules', label: 'Video rules', re: /^video rules\b/ },
  { id: 'recipe-candid', label: 'Recipe: candid "caught you" shot', re: /\brecipe\b.*\b(?:candid|caught you)\b/ },
  { id: 'recipe-recreate', label: 'Recipe: recreate from a real clip', re: /\brecipe\b.*\brecreate\b/ },
]

// The other Part B sections, in template order. Card, the mark and the
// reference sheet are checked as needed items above.
const OPTIONAL: Array<{ label: string; re: RegExp }> = [
  { label: 'Brand', re: /^brand\b/ },
  { label: 'Why people watch', re: /^why people watch\b/ },
  { label: 'Style', re: /^(?:signature )?style\b/ },
  { label: 'Voice', re: /^voice$/ },
  { label: 'Persona', re: /^persona\b/ },
  { label: 'Voice card', re: /^voice card\b/ },
  { label: 'Fixed blocks', re: /^(?:fixed|prompt) blocks?\b/ },
  { label: 'Build notes', re: /^build notes\b/ },
  { label: 'Stress test', re: /^stress test\b/ },
  { label: 'Identity fixes', re: /^identity fixes\b/ },
  { label: 'Saved identity', re: /^saved identity\b/ },
  { label: 'Competitors', re: /^competitors?\b/ },
  { label: 'Accounts', re: /^accounts?\b/ },
  { label: 'Monetization', re: /^monetization\b/ },
  { label: 'Winning stack', re: /^winning stack\b/ },
  { label: 'Growth log', re: /^growth log\b/ },
  { label: 'Disclosure', re: /^disclosure\b/ },
  { label: 'Combo log', re: /^combo log\b/ },
]

const REFS = Array.from({ length: 12 }, (_, i) => `REF-${String(i).padStart(2, '0')}`)
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
// Template placeholders like "[Name]" or "[3 to 4 stylings]"; not links,
// not checkboxes.
const BRACKET = /\[(?![ xX]\])[^\]]{2,120}\](?!\()/

const has = (sections: FileSection[], re: RegExp) => sections.find(s => re.test(norm(s.title)))

// The label of each REF in the Reference sheet: a table row
// ("| REF-03 | Left profile, chest-up | ... |") or a bullet ("- REF-03: ...").
function refLabels(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of body.split('\n')) {
    const row = line.match(/^\s*\|\s*(REF[- ]?\d{2})\s*\|\s*([^|]*)\|/i)
    const bullet = line.match(/^\s*[-*]\s*(REF[- ]?\d{2})\s*[:.-]\s*(.+)$/i)
    const m = row ?? bullet
    if (!m) continue
    const id = m[1]!.toUpperCase().replace(/^REF[- ]?/, 'REF-')
    const label = m[2]!.trim()
    if (!out.has(id) && label && !/^\[.*\]$/.test(label) && !/^(?:link|-+)$/i.test(label)) out.set(id, label)
  }
  return out
}

// An Element named in the file, with or without its ID.
function elementOf(sections: FileSection[]): { named: boolean; id: string | null; where: string | null } {
  for (const s of [has(sections, /^saved identity\b/), has(sections, /^models?\b/), ...sections].filter((x): x is FileSection => !!x)) {
    for (const line of s.body.split('\n')) {
      if (!/\belements?\b/i.test(line)) continue
      if (!/higgsfield|element\s*"|elements?\s*"|element:/i.test(line)) continue
      const id = line.match(UUID)?.[0] ?? null
      return { named: true, id, where: `"${s.title}"` }
    }
  }
  return { named: false, id: null, where: null }
}

export function checkTemplate(md: string): TemplateReport {
  const { sections } = splitSections(md.replace(/^---\n[\s\S]*?\n---\n?/, ''))
  const needed: TemplateItem[] = []
  for (const u of UNIVERSAL) {
    const s = has(sections, u.re)
    needed.push({ id: u.id, label: `${u.label} (UNIVERSAL)`, ok: !!s, detail: s ? `Found: "${s.title}".` : `Missing. Copy the "${u.label}" section from the template unchanged.` })
  }
  // The record the Studio reads: the age (fixed: 21 or older) and the marks.
  let parsed: ReturnType<typeof importCharacterFile> | null = null
  try { parsed = importCharacterFile(md) } catch { parsed = null }
  const age = parsed?.character.age ?? null
  needed.push({
    id: 'age', label: 'Age, 21 or older (fixed)', ok: age != null && age >= 21,
    detail: age == null ? 'Missing. Put the age in the Card ("[Name], 24 years old.").' : age >= 21 ? `${age} years old.` : `${age} is under 21. Characters are 21 or older.`,
  })
  const marks = (parsed?.character.marks ?? []).filter(m => m.kind !== 'jewelry')
  const markSec = has(sections, /^distinguishing marks?\b/)
  needed.push({
    id: 'mark', label: 'One distinguishing mark', ok: marks.length === 1,
    detail: marks.length === 1 ? `${marks[0]!.description}, ${marks[0]!.side} ${marks[0]!.region}.`
      : marks.length === 0 ? `Missing. ${markSec ? 'The section names no mark the Studio can place' : 'Add a "Distinguishing mark" section'} (one subtle mark, with its side: "small mole above her left brow").`
        : `${marks.length} marks found; the template has one (${marks.map(m => m.description).join(', ')}). Keep the one that is part of the face.`,
  })
  const sheet = has(sections, /^reference sheet\b/)
  const labels = refLabels(sheet?.body ?? '')
  const unlabeled = REFS.filter(r => !labels.has(r))
  needed.push({
    id: 'refs', label: 'REF-00 to REF-11 labeled', ok: !!sheet && unlabeled.length === 0,
    detail: !sheet ? 'Missing. Add the "Reference sheet" table: each REF with what it shows.'
      : unlabeled.length ? `Not labeled: ${unlabeled.join(', ')}.` : 'All 12 labeled.',
  })
  // A Studio export keeps the saved identity in its header.
  const savedEl = parsed?.character.identities.find(i => i.kind === 'element' && i.externalId)
  const el = savedEl ? { named: true, id: savedEl.externalId, where: 'the saved identity' } : elementOf(sections)
  if (el.named) {
    needed.push({ id: 'element', label: 'Element ID', ok: !!el.id, detail: el.id ? `${el.id} (in ${el.where}).` : `An Element is named in ${el.where} without its ID. Add the ID from Higgsfield.` })
  }
  const missingOptional = OPTIONAL.filter(o => !has(sections, o.re)).map(o => o.label)
  if (!has(sections, /^card\b/)) missingOptional.unshift('Card')
  const brackets = sections.filter(s => BRACKET.test(s.body) || BRACKET.test(s.title)).map(s => s.title)
  return { version: TEMPLATE_VERSION, needed, missingOptional, brackets, complete: needed.every(n => n.ok) }
}
