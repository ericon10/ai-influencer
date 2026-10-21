import { DEFAULT_POS, SAFE, textLayout, type Draw, type Frame } from './slideSvg.js'
import type { SlidePos, TextStyleId } from './slides.js'

// R1, nothing covers a face (owner, 2026-10-22; UX-PLAN.md section 35, item
// 8). A slide's words go in the largest clear band of the safe zone that
// misses every face box grown by 4% of the frame: above the faces first,
// then below, then one size smaller, and last a box under the chin. Pure:
// the face boxes come in as shares of the frame.

export interface FaceBox { x: number; y: number; w: number; h: number }
export interface Placed { pos: SlidePos; how: 'kept' | 'above' | 'below' | 'smaller' | 'chin' }

const GROW = 0.04
export const SMALLER = 0.85

function grown(f: FaceBox): FaceBox {
  return { x: f.x - GROW, y: f.y - GROW, w: f.w + 2 * GROW, h: f.h + 2 * GROW }
}
const hits = (a: { x: number; y: number; w: number; h: number }, b: FaceBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// Does the text block at this place touch any grown face box?
export function coversFace(style: TextStyleId, text: string, frame: Frame, pos: SlidePos | null, draw: Draw, faces: FaceBox[], fallback: SlidePos = DEFAULT_POS): boolean {
  const l = textLayout(style, text, frame, pos, draw, fallback)
  if (!l) return false
  const b = { x: l.block.x / frame.width, y: l.block.y / frame.height, w: l.block.w / frame.width, h: l.block.h / frame.height }
  return faces.map(grown).some(f => hits(b, f))
}

// The clear vertical bands of the safe zone (shares of the height), with
// the faces' grown boxes taken out.
function bands(faces: FaceBox[], frame: Frame): Array<{ top: number; bottom: number }> {
  const top = SAFE.top, bottom = 1 - SAFE.bottom
  const blocked = faces.map(grown).map(f => [Math.max(top, f.y), Math.min(bottom, f.y + f.h)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  const out: Array<{ top: number; bottom: number }> = []
  let at: number = top
  for (const [a, b] of blocked) { if (a > at) out.push({ top: at, bottom: a }); at = Math.max(at, b) }
  if (bottom > at) out.push({ top: at, bottom })
  void frame
  return out
}

export function placeText(style: TextStyleId, text: string, frame: Frame, faces: FaceBox[], draw: Draw, current: SlidePos | null, fallback: SlidePos = DEFAULT_POS): Placed {
  const x = current?.x ?? fallback.x
  if (!faces.length || !coversFace(style, text, frame, current, draw, faces, fallback)) return { pos: current ?? { ...fallback }, how: 'kept' }
  const firstFace = Math.min(...faces.map(f => f.y)), lastFace = Math.max(...faces.map(f => f.y + f.h))
  const free = bands(faces, frame)
  for (const scale of [1, SMALLER]) {
    const probe = textLayout(style, text, frame, { x, y: 0.5, scale }, draw, fallback)
    if (!probe) break
    const need = probe.block.h / frame.height
    const fits = (b: { top: number; bottom: number }) => b.bottom - b.top >= need
    const largest = (list: typeof free) => list.filter(fits).sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top))[0]
    const above = largest(free.filter(b => b.bottom <= firstFace))
    const below = largest(free.filter(b => b.top >= lastFace - GROW * 2 && b.top > firstFace))
    for (const [band, how] of [[above, 'above'], [below, 'below']] as const) {
      if (!band) continue
      const pos: SlidePos = { x, y: Math.round(((band.top + band.bottom) / 2) * 1000) / 1000, by: 'auto', ...(scale < 1 ? { scale } : {}) }
      if (!coversFace(style, text, frame, pos, draw, faces, fallback)) return { pos, how: scale < 1 ? 'smaller' : how }
    }
  }
  // Last resort: a box just under the chin of the face highest in the frame.
  const face = [...faces].sort((a, b) => a.y - b.y)[0]!
  const small = textLayout(style, text, frame, { x, y: 0.5, scale: SMALLER }, draw, fallback)
  const half = small ? small.block.h / frame.height / 2 : 0.04
  return { pos: { x, y: Math.min(1, Math.round((face.y + face.h + 0.01 + half) * 1000) / 1000), by: 'auto', scale: SMALLER }, how: 'chin' }
}
