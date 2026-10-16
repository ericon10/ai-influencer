// The viral writing playbook's codes (docs/content/viral-writing-playbook.md,
// owner 2026-10-16; UX-PLAN.md section 28): structures S1 to S12, lenses L13
// to L25, effects E1 to E8 and the 1 to 5 ladder. Ids and names only (the
// hook cards' tags, the writer's JSON schema, the plan import); what each
// one means goes to the writers from config/templates.yaml. Pure, so the
// browser shows the same tags.

export const STRUCTURES = [
  { code: 'S1', name: 'Levels' },
  { code: 'S2', name: 'Two Characters' },
  { code: 'S3', name: 'Untold Story' },
  { code: 'S4', name: 'Is It Worth It?' },
  { code: 'S5', name: 'Testing Viral Hacks' },
  { code: 'S6', name: 'Teaser' },
  { code: 'S7', name: 'Jenga carousel' },
  { code: 'S8', name: 'Visual Metaphor' },
  { code: 'S9', name: 'Man on the Street' },
  { code: 'S10', name: 'Challenge series' },
  { code: 'S11', name: 'Contrast pair' },
  { code: 'S12', name: 'Countdown' },
  { code: 'L13', name: 'Nature documentary' },
  { code: 'L14', name: 'Museum exhibit' },
  { code: 'L15', name: 'Review and rating' },
  { code: 'L16', name: 'Dating parallel' },
  { code: 'L17', name: 'Delivery tracker' },
  { code: 'L18', name: 'Fine print' },
  { code: 'L19', name: 'Breakup text' },
  { code: 'L20', name: 'Personification' },
  { code: 'L21', name: 'Invoice' },
  { code: 'L22', name: 'Previously on' },
  { code: 'L23', name: 'Subtitles' },
  { code: 'L24', name: 'Forecast' },
  { code: 'L25', name: 'Group chat' },
] as const
export type StructureCode = (typeof STRUCTURES)[number]['code']
export const STRUCTURE_CODES = STRUCTURES.map(s => s.code) as unknown as readonly [StructureCode, ...StructureCode[]]

export const EFFECTS = [
  { code: 'E1', name: "That's literally me" },
  { code: 'E2', name: 'Wait, what?' },
  { code: 'E3', name: 'I need to know how this ends' },
  { code: 'E4', name: 'LMAO' },
  { code: 'E5', name: 'Sending this to someone' },
  { code: 'E6', name: "So it's not me" },
  { code: 'E7', name: 'I never saw it that way' },
  { code: 'E8', name: 'Screenshotting this' },
] as const
export type EffectCode = (typeof EFFECTS)[number]['code']
export const EFFECT_CODES = EFFECTS.map(e => e.code) as unknown as readonly [EffectCode, ...EffectCode[]]

// The ladder (playbook section 8): 1 is a moment, a tell and a lens with a
// clear payoff; 5 is a topic or a restated pain. Only a 1 or 2 ships.
export const LADDER = [
  { score: 1, line: 'A moment, a tell and a lens, with a clear payoff' },
  { score: 2, line: 'A moment plus a tell' },
  { score: 3, line: 'A real moment, no frame' },
  { score: 4, line: 'A sourced stat with nothing around it' },
  { score: 5, line: 'A topic or a restated pain' },
] as const
export const SHIPS = (score: number | null | undefined) => score === 1 || score === 2

export const structureName = (code: string | null | undefined) => STRUCTURES.find(s => s.code === code)?.name ?? ''
export const effectName = (code: string | null | undefined) => EFFECTS.find(e => e.code === code)?.name ?? ''
export const codeLabel = (code: string | null | undefined) => (code ? `${code} ${structureName(code)}`.trim() : '')
export const effectLabel = (code: string | null | undefined) => (code ? `${code} ${effectName(code)}`.trim() : '')

// "S11 Contrast pair", "s11", "L14 Museum exhibit" and "Museum exhibit" all
// read as their code; anything else is null.
export function readCode(text: string | null | undefined): StructureCode | null {
  const t = (text ?? '').trim()
  const m = t.match(/^\s*([SL])\s*(\d{1,2})\b/i)
  if (m) {
    const code = `${m[1]!.toUpperCase()}${Number(m[2])}`
    return (STRUCTURE_CODES as readonly string[]).includes(code) ? code as StructureCode : null
  }
  const byName = STRUCTURES.find(s => s.name.toLowerCase() === t.toLowerCase().replace(/[?.]+$/, '') || `${s.name.toLowerCase()}?` === t.toLowerCase())
  return byName?.code ?? null
}
export function readEffect(text: string | null | undefined): EffectCode | null {
  const m = (text ?? '').trim().match(/^\s*E\s*(\d)\b/i)
  const code = m ? `E${m[1]}` : null
  return code && (EFFECT_CODES as readonly string[]).includes(code) ? code as EffectCode : null
}
