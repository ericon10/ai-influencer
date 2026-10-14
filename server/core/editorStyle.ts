import { z } from 'zod'

// Saved styles in the editor (overnight run, editor phase C): a stack of
// presets with places relative to the video, not seconds. "At the payoff",
// "on cut 2", "on beat 8", "1.5 s from the end". "Save as a style" turns a
// timeline into a stack; "Make another like this" and a saved style place
// the same stack on another post's timeline, where the payoff, cuts and
// beats fall elsewhere. Pure; the editor (the OpenReel fork's
// packages/core/src/studio/style.ts) and the worker use the same rules.

const r3 = (n: number) => Math.round(n * 1000) / 1000

export const anchorSchema = z.object({
  on: z.enum(['payoff', 'cut', 'beat', 'start', 'end']),
  index: z.number().int().min(0).max(999).default(0),
  offset: z.number().min(-60).max(600).default(0),
  // Share of the video, used when the cut or beat is missing on the new post.
  ratio: z.number().min(0).max(1),
})
export type Anchor = z.infer<typeof anchorSchema>

export const styleItemSchema = z.object({
  preset: z.string().regex(/^[a-z_]{2,40}$/),
  strength: z.enum(['subtle', 'normal', 'strong']).default('normal'),
  at: anchorSchema,
  // Camera presets: the block's length and edited keys (null: the preset's own).
  duration: z.number().min(0.05).max(60).nullable().default(null),
  keys: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).max(40).nullable().default(null),
})
export type StyleItem = z.infer<typeof styleItemSchema>

export const stackSchema = z.array(styleItemSchema).max(40)

export const editorStyleSchema = z.object({
  id: z.string().regex(/^sty_[a-z0-9]{6,40}$/),
  name: z.string().trim().min(1).max(60),
  items: stackSchema.min(1),
  createdAt: z.string().max(40),
})
export type EditorStyle = z.infer<typeof editorStyleSchema>

export interface Places {
  duration: number
  payoff: number | null
  // Cuts between shots (not 0 or the end), and beats, in seconds.
  cuts: number[]
  beats: number[]
}

const NEAR = 0.06

function nearest(list: number[], t: number): number {
  let best = -1, dist = NEAR
  for (const [i, x] of list.entries()) {
    const d = Math.abs(x - t)
    if (d <= dist) { dist = d; best = i }
  }
  return best
}

// Where a preset at time t sits, in words the next post understands.
export function anchorFor(t: number, p: Places): Anchor {
  const ratio = p.duration > 0 ? Math.max(0, Math.min(1, t / p.duration)) : 0
  if (p.payoff != null && Math.abs(t - p.payoff) <= NEAR) return { on: 'payoff', index: 0, offset: 0, ratio }
  const cut = nearest(p.cuts, t)
  if (cut >= 0) return { on: 'cut', index: cut, offset: r3(t - p.cuts[cut]!), ratio }
  const beat = nearest(p.beats, t)
  if (beat >= 0) return { on: 'beat', index: beat, offset: r3(t - p.beats[beat]!), ratio }
  if (p.payoff != null && Math.abs(t - p.payoff) <= 1.5) return { on: 'payoff', index: 0, offset: r3(t - p.payoff), ratio }
  if (t > p.duration / 2) return { on: 'end', index: 0, offset: r3(Math.max(0, p.duration - t)), ratio }
  return { on: 'start', index: 0, offset: r3(Math.max(0, t)), ratio }
}

// The time an anchor lands on in another video (clamped inside it).
export function timeFor(a: Anchor, p: Places): number {
  const fallback = a.ratio * p.duration
  let t: number
  if (a.on === 'payoff') t = (p.payoff ?? fallback) + a.offset
  else if (a.on === 'cut') t = p.cuts[a.index] != null ? p.cuts[a.index]! + a.offset : fallback
  else if (a.on === 'beat') t = p.beats[a.index] != null ? p.beats[a.index]! + a.offset : fallback
  else if (a.on === 'end') t = p.duration - a.offset
  else t = a.offset
  return r3(Math.max(0, Math.min(Math.max(0, p.duration - 0.1), t)))
}

export interface PlacedItem { preset: string; strength: StyleItem['strength']; time: number; duration: number | null; keys: StyleItem['keys'] }

export function placeStack(items: StyleItem[], p: Places): PlacedItem[] {
  return items.map(it => ({ preset: it.preset, strength: it.strength, time: timeFor(it.at, p), duration: it.duration, keys: it.keys }))
}

// A short line for the style's card: "Snap zoom at the payoff, Glitch on cut 1".
export function anchorWords(a: Anchor): string {
  const off = a.offset ? ` ${a.offset > 0 ? '+' : ''}${a.offset.toFixed(1)} s` : ''
  if (a.on === 'payoff') return `at the payoff${off}`
  if (a.on === 'cut') return `on cut ${a.index + 1}${off}`
  if (a.on === 'beat') return `on beat ${a.index + 1}${off}`
  if (a.on === 'end') return `${a.offset.toFixed(1)} s from the end`
  return `at ${a.offset.toFixed(1)} s`
}
