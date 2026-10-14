// Which person a clone replaces (owner, 2026-10-14, G28): only the main
// subject changes. The worker finds the faces on the clip's first frame
// (boxes from 0 to 1, the largest first); the owner may tap another one.
// Models take no boxes, so the pick goes into the prompt in words. Pure; the
// worker, the API and the browser all use it.

export interface Box { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

// The face a tap means: the smallest box under the point, else the nearest
// one. With no tap, the largest. Null when no face was found.
export function pickPerson(people: Box[], at: Point | null): number | null {
  if (!people.length) return null
  if (!at) return 0
  const inside = people.map((b, i) => ({ b, i })).filter(({ b }) => at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h)
  if (inside.length) return inside.sort((p, q) => p.b.w * p.b.h - q.b.w * q.b.h)[0]!.i
  let best = 0
  let bestD = Infinity
  people.forEach((b, i) => {
    const d = Math.hypot(at.x - (b.x + b.w / 2), at.y - (b.y + b.h / 2))
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

// Where a person is, for the prompt: "on the left side" and how near.
export function placeOf(people: Box[], index: number): { where: string; depth: string } {
  const b = people[index]!
  const cx = b.x + b.w / 2
  const where = cx < 0.36 ? 'on the left side' : cx > 0.64 ? 'on the right side' : 'in the center'
  if (people.length < 2) return { where, depth: '' }
  const area = (x: Box) => x.w * x.h
  const largest = Math.max(...people.map(area))
  const depth = area(b) >= largest * 0.999 ? ', closest to the camera' : area(b) < largest * 0.5 ? ', further back' : ''
  return { where, depth }
}

// The words for the person to replace: the main person when nothing was
// tapped; else where the tapped person is (by the tap itself when no face
// was found on the frame).
export function targetWords(t: { target_main: string; target_at: string }, people: Box[], at: Point | null): string {
  if (!at) return t.target_main
  const i = pickPerson(people, at)
  const p = i == null ? placeOf([{ x: at.x, y: at.y, w: 0, h: 0 }], 0) : placeOf(people, i)
  return t.target_at.replace('{where}', p.where).replace('{depth}', p.depth)
}
