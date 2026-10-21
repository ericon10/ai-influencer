// "Punch up" (owner, 2026-10-22; UX-PLAN.md section 35, item 14): a thin
// image line rewritten by Claude to the density rule, shown before and
// after, applied only on the owner's OK. Pure: what a thin line is, and the
// demo mode's stand-in rewrite. Every product and account: no product words.

// The density rule: a named camera, 3 to 5 specific objects, one person or
// motion in the background, mixed real light, the moment mid-action.
const CAMERA = /\b(?:phone|iphone|camera|selfie|lens|front cam|rear cam|webcam|polaroid|camcorder|propped|over (?:the|a|her|his|their) shoulder|pov)\b/i
const LIGHT = /\b(?:light|lamp|glow|sun|sunlight|daylight|window|neon|fluorescent|overhead|dusk|dawn|golden hour|shadow|backlit|screen glow)\b/i
const BACKGROUND = /\b(?:behind|background|walking past|in the back|passing|someone|coworker|stranger|barista|crowd|people)\b/i
const words = (s: string) => s.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length

// What a line lacks of the density rule ([] means it is not thin).
export function thinParts(line: string): string[] {
  const t = line.trim()
  if (!t) return []
  const out: string[] = []
  if (!CAMERA.test(t)) out.push('a named camera')
  if ((t.match(/,/g)?.length ?? 0) + (t.match(/\band\b/gi)?.length ?? 0) < 2) out.push('3 to 5 specific objects')
  if (!BACKGROUND.test(t)) out.push('one person or motion in the background')
  if (!LIGHT.test(t)) out.push('mixed real light')
  return words(t) < 18 || out.length >= 2 ? out : []
}
export const isThin = (line: string) => thinParts(line).length > 0

// Demo mode: the line with what it lacked added in plain words.
export function mockPunchUp(line: string): string {
  const parts = thinParts(line)
  const add = [
    parts.includes('a named camera') ? 'shot on a phone held at chest height' : '',
    parts.includes('3 to 5 specific objects') ? 'a chipped mug, a phone charger, a folded receipt on the table' : '',
    parts.includes('one person or motion in the background') ? 'someone walking past behind' : '',
    parts.includes('mixed real light') ? 'window daylight mixed with a warm lamp' : '',
  ].filter(Boolean)
  return [line.trim().replace(/[.\s]+$/, ''), ...add].join(', ') + ', caught mid-action.'
}
