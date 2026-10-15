import sharp from 'sharp'

// The face pass check (owner, 2026-10-15): outside the face, a face pass
// must still be its still: the place, the outfit, the pose, the framing.
// Both images are made small and gray, the face (with room around it) is
// blanked in both, and what is left is compared by correlation. A face pass
// that kept the scene correlates near 1; one that made a new picture (a
// studio portrait in place of the kitchen) falls far below.

export interface SceneMatch { score: number; ok: boolean }

// Correlation at or above this keeps the scene.
export const SCENE_MIN = 0.6
const W = 48

async function small(image: Buffer, h: number): Promise<Float64Array> {
  const { data } = await sharp(image).removeAlpha().resize(W, h, { fit: 'fill' }).greyscale().blur(0.8).raw().toBuffer({ resolveWithObject: true })
  return Float64Array.from(data)
}

// `face` is the still's face box in its own pixels (from the face matcher).
export async function sceneOutsideFace(still: Buffer, result: Buffer, face?: { x: number; y: number; w: number; h: number } | null): Promise<SceneMatch> {
  const meta = await sharp(still).metadata()
  const sw = meta.width ?? W
  const sh = meta.height ?? W
  const H = Math.max(8, Math.round((W * sh) / sw))
  const a = await small(still, H)
  const b = await small(result, H)
  const keep = new Uint8Array(W * H).fill(1)
  if (face) {
    // The face and its hair line: the box grown by half its size each way.
    const fx0 = Math.floor(((face.x - face.w * 0.5) / sw) * W), fx1 = Math.ceil(((face.x + face.w * 1.5) / sw) * W)
    const fy0 = Math.floor(((face.y - face.h * 0.5) / sh) * H), fy1 = Math.ceil(((face.y + face.h * 1.5) / sh) * H)
    for (let y = Math.max(0, fy0); y < Math.min(H, fy1); y++) for (let x = Math.max(0, fx0); x < Math.min(W, fx1); x++) keep[y * W + x] = 0
  }
  let n = 0, sa = 0, sb = 0
  for (let i = 0; i < keep.length; i++) if (keep[i]) { n++; sa += a[i]!; sb += b[i]! }
  if (n < 20) return { score: 1, ok: true }
  const ma = sa / n, mb = sb / n
  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < keep.length; i++) if (keep[i]) {
    const da = a[i]! - ma, db = b[i]! - mb
    cov += da * db; va += da * da; vb += db * db
  }
  // A flat picture (no structure) matches only another flat one.
  const score = va < 1e-6 || vb < 1e-6 ? (Math.abs(ma - mb) < 8 ? 1 : 0) : cov / Math.sqrt(va * vb)
  const rounded = Math.round(score * 1000) / 1000
  return { score: rounded, ok: rounded >= SCENE_MIN }
}
