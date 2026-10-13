import { avoidRanges, negated } from './realism.js'

// Fixed rule no-explicit (owner ruling G1): no nudity or explicit content.
// Checked in code for every prompt, so no setting or template can switch it
// off. A negated use ("no nudity") and the AVOID block are fine; swimwear,
// lingerie as clothing, a kiss or a hug are not explicit.
// "Nude" as a color (nude-pink lip, nude heels) is fashion, not nudity.
const EXPLICIT = /\b(?:nude(?!-|\s+(?:pink|beige|tones?|colou?r\w*|lips?\w*|heels?|shades?|palette|polish|nails?|sandals?|pumps|bra|makeup|gloss|lipstick|blush|eyeshadow|manicure))|nudity|naked|topless|bottomless|unclothed|undressed|no clothes|without clothes|nipples?|areolas?|genitals?|genitalia|pubic|vulva|penis|vagina|explicit|sexual(?:ly)?|sex (?:scene|act)|having sex|intercourse|orgasm\w*|porn\w*|erotic\w*|nsfw|fetish\w*|bdsm|see-through (?:top|bra|shirt|dress)|exposed (?:breasts?|chest|buttocks))\b/gi

// The mock provider's scenario markers ("[mock:nsfw]") are test controls,
// not content.
const MOCK_MARKER = /\[mock:[a-z_]+\]/gi

export function findExplicitTerms(prompt: string): string[] {
  const text = prompt.replace(MOCK_MARKER, m => ' '.repeat(m.length))
  const avoid = avoidRanges(text)
  const out = new Set<string>()
  for (const m of text.matchAll(EXPLICIT)) {
    const index = m.index ?? 0
    if (avoid.some(([a, b]) => index >= a && index < b)) continue
    if (negated(text, index)) continue
    out.add(m[0].toLowerCase())
  }
  return [...out]
}

export const EXPLICIT_MESSAGE = 'No nudity or explicit content. This is a fixed rule and cannot be switched off.'
