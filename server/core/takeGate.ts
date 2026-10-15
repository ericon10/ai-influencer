// The video rule for a Recreate take (owner, 2026-10-15): the still rule's
// numbers (face against REF-00, the margin over the clip's person, the
// likeness to that person), read over the whole take from the face every
// half second. A take never fails it into the bin: a take that misses is a
// warning, and the owner keeps it or tries again. Only the still gate blocks
// spend.

export interface TakeSample { t: number; face: number | null; likeness: number | null }
export interface GateNumbers { face_min: number; margin: number; source_max: number }

export interface TakeGate {
  ok: boolean
  // The middle face match, the highest likeness, the middle margin.
  face: number | null
  likeness: number | null
  margin: number | null
  // Frames with a face that the numbers came from.
  frames: number
  reasons: string[]
  note: string | null
}

const two = (n: number) => n.toFixed(2)
const r3 = (n: number) => Math.round(n * 1000) / 1000

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

// The middle face (a turned head or a blink in one frame does not sink a
// take), the highest likeness (the moment it looks most like the clip's
// person; she copies their expressions, so a take reads higher than a
// still) and the middle margin, frame by frame.
export function takeGateFor(g: GateNumbers, samples: TakeSample[], opts: { demo?: boolean } = {}): TakeGate {
  const faces = samples.map(s => s.face).filter((v): v is number => v != null)
  const likes = samples.map(s => s.likeness).filter((v): v is number => v != null)
  const margins = samples.filter(s => s.face != null && s.likeness != null).map(s => s.face! - s.likeness!)
  const face = faces.length ? r3(median(faces)!) : null
  const likeness = likes.length ? r3(Math.max(...likes)) : null
  const margin = margins.length ? r3(median(margins)!) : null
  if (opts.demo) return { ok: true, face, likeness, margin, frames: faces.length, reasons: [], note: 'Demo mode: the face is not checked on mock takes.' }
  const reasons: string[] = []
  if (face == null) reasons.push('No face to match with REF-00 was found in the take.')
  else if (face < g.face_min) reasons.push(`Face match ${two(face)}, needs ${two(g.face_min)} or more.`)
  if (margin != null && margin < g.margin) reasons.push(`Beats the clip's person by ${two(margin)}, needs ${two(g.margin)} or more.`)
  if (likeness != null && likeness >= g.source_max) reasons.push(`Likeness to the clip's person ${two(likeness)}, must stay under ${two(g.source_max)}.`)
  const note = face != null && likeness == null ? 'No face showed in the clip at the same moments, so the margin was not checked.' : null
  return { ok: !reasons.length, face, likeness, margin, frames: faces.length, reasons, note }
}

// One line for the take card.
export function takeGateLine(gate: TakeGate): string {
  const parts = [
    gate.face != null ? `face ${two(gate.face)}` : null,
    gate.margin != null ? `margin ${two(gate.margin)}` : null,
    gate.likeness != null ? `likeness ${two(gate.likeness)}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'no face scores'
}

// Stretches where the face drifts: under the face number (the video rule's,
// owner 2026-10-15, so the strip and the rule agree) or no face at all.
export function driftSpans(samples: TakeSample[], faceMin: number, step: number, duration: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  const end = (t: number) => Math.round(Math.min(duration, t + step) * 100) / 100
  for (const s of samples) {
    const bad = s.face == null || s.face < faceMin
    const last = out[out.length - 1]
    if (bad && last && Math.abs(last.end - s.t) < 1e-6) last.end = end(s.t)
    else if (bad) out.push({ start: s.t, end: end(s.t) })
  }
  return out
}
