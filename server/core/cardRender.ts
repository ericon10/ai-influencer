// Text-only and photo-dump posts (UX-PLAN.md section 42 A, B): what each
// frame shows and for how long. Pure; the worker draws and encodes it
// (server/pipeline/weekRender.ts). Made free: no generation.

export type CardStyle = 'centered' | 'two_beat' | 'dialogue'
export type CardKind = 'text_only' | 'photo_dump'

export interface CardSpec {
  type: CardKind
  bgColor: string
  textStyle: CardStyle
  motion: 'none' | 'zoom'
  placeId: string | null
  stillIds: string[]
}

export const readCardStyle = (raw: string): CardStyle => (['centered', 'two_beat', 'dialogue'].includes(raw.trim().toLowerCase()) ? raw.trim().toLowerCase() as CardStyle : 'centered')
export const readBgColor = (raw: string): string => { const m = /^#?([0-9a-f]{6})$/i.exec(raw.trim()); return m ? `#${m[1]!.toLowerCase()}` : '#000000' }
export const readStillIds = (raw: string): string[] => raw.split(/[\s,;]+/).map(s => s.trim()).filter(s => /^cand_[a-z0-9]+$/i.test(s)).slice(0, 6)

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)

// The line's two beats: split on " / ", else after the first sentence.
export function twoBeats(line: string): [string, string] {
  const t = line.trim()
  const slash = t.split(/\s+\/\s+/)
  if (slash.length >= 2) return [slash[0]!.trim(), slash.slice(1).join(' ').trim()]
  const m = /^(.+?[.!?])\s+(.+)$/.exec(t)
  return m ? [m[1]!.trim(), m[2]!.trim()] : [t, '']
}

// "Her: x / Me: y": each speaker's line on its own.
export function dialogueLines(line: string): string[] {
  const parts = line.split(/\s+\/\s+|\n+/).map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts : twoBeats(line).filter(Boolean)
}

export interface CardFrame { text: string; seconds: number }

// A text-only post: 6 to 8 s by length. Two beats: the setup alone for 2 s,
// then the setup with the punch line under it.
export function textFrames(line: string, style: CardStyle): CardFrame[] {
  const total = Math.round(Math.min(8, Math.max(6, 5 + words(line) * 0.2)) * 10) / 10
  if (style === 'two_beat') {
    const [setup, punch] = twoBeats(line)
    if (punch) return [{ text: setup, seconds: 2 }, { text: `${setup}\n\n${punch}`, seconds: Math.round((total - 2) * 10) / 10 }]
  }
  if (style === 'dialogue') return [{ text: dialogueLines(line).join('\n\n'), seconds: total }]
  return [{ text: line.trim(), seconds: total }]
}

// A photo dump: 5 or 6 stills over 6 s (6 at 1 s each, 5 at 1.2 s), the
// one line on each.
export function dumpFrames(stills: number): number[] {
  const n = Math.max(1, Math.min(6, stills))
  return Array.from({ length: n }, () => Math.round((6 / n) * 100) / 100)
}
