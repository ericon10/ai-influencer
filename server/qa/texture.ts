import sharp from 'sharp'
import type { DetectedFace, FaceMatcher } from './faces'

// Texture check (Realism principle): after an upscale or an edit, the face
// must keep its fine skin detail. Detail is the variance of a Laplacian
// filter on the face crop, measured on both images at the same scale, so a
// bigger output is not mistaken for a sharper one. Free and local.

export interface TextureResult {
  // Output detail as a share of the input's (1 = the same).
  ratio: number
  inputDetail: number
  outputDetail: number
  smoothed: boolean
  region: 'face' | 'center'
  message: string
}

export interface TextureOptions {
  faces?: FaceMatcher
  // Output detail below this share of the input's counts as smoothed.
  minRatio?: number
  // The output keeps the input's framing (an upscale): the input's face box
  // is used on both, scaled. Otherwise each image is searched on its own.
  sameFraming?: boolean
}

type Box = { x: number; y: number; w: number; h: number }

const MAX_SIDE = 256

// The 4-neighbour Laplacian's variance over a grayscale image.
export function laplacianVariance(px: Uint8Array | Buffer, w: number, h: number): number {
  let n = 0, sum = 0, sq = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = px[i - w]! + px[i + w]! + px[i - 1]! + px[i + 1]! - 4 * px[i]!
      n += 1; sum += v; sq += v * v
    }
  }
  if (!n) return 0
  const mean = sum / n
  return sq / n - mean * mean
}

async function size(img: Buffer): Promise<{ w: number; h: number }> {
  const { info } = await sharp(img).rotate().toBuffer({ resolveWithObject: true })
  return { w: info.width, h: info.height }
}

// Where portrait faces sit when no face is found: the upper middle.
function centerBox(w: number, h: number): Box {
  return { x: Math.round(w * 0.25), y: Math.round(h * 0.12), w: Math.round(w * 0.5), h: Math.round(h * 0.5) }
}

function grow(b: Box, w: number, h: number, by = 0.1): Box {
  const dx = b.w * by, dy = b.h * by
  const x = Math.max(0, Math.floor(b.x - dx)), y = Math.max(0, Math.floor(b.y - dy))
  return { x, y, w: Math.min(w - x, Math.ceil(b.w + 2 * dx)), h: Math.min(h - y, Math.ceil(b.h + 2 * dy)) }
}

async function faceBox(faces: FaceMatcher | undefined, img: Buffer): Promise<DetectedFace['box'] | null> {
  if (!faces) return null
  try {
    if (!(await faces.status()).available) return null
    const found = await faces.detect(img)
    const main = [...found].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0]
    return main?.box ?? null
  } catch {
    return null
  }
}

async function detail(img: Buffer, box: Box, side: number): Promise<number> {
  const { data, info } = await sharp(img).rotate()
    .extract({ left: box.x, top: box.y, width: Math.max(3, box.w), height: Math.max(3, box.h) })
    .greyscale().resize(side, side, { fit: 'fill', kernel: 'lanczos3' })
    .raw().toBuffer({ resolveWithObject: true })
  return laplacianVariance(data, info.width, info.height)
}

export async function compareTexture(input: Buffer, output: Buffer, o: TextureOptions = {}): Promise<TextureResult> {
  const minRatio = o.minRatio ?? 0.6
  const [si, so] = await Promise.all([size(input), size(output)])
  const fi = await faceBox(o.faces, input)
  let inBox: Box, outBox: Box, region: TextureResult['region']
  if (fi) {
    region = 'face'
    inBox = grow(fi, si.w, si.h)
    if (o.sameFraming) {
      const sx = so.w / si.w, sy = so.h / si.h
      outBox = grow({ x: fi.x * sx, y: fi.y * sy, w: fi.w * sx, h: fi.h * sy }, so.w, so.h)
    } else {
      const fo = await faceBox(o.faces, output)
      outBox = fo ? grow(fo, so.w, so.h) : centerBox(so.w, so.h)
      if (!fo) region = 'center'
    }
  } else {
    region = 'center'
    inBox = centerBox(si.w, si.h)
    outBox = centerBox(so.w, so.h)
  }
  // Never upsample either crop: compare at the smaller one's scale.
  const side = Math.max(16, Math.min(MAX_SIDE, inBox.w, inBox.h, outBox.w, outBox.h))
  const [inputDetail, outputDetail] = await Promise.all([detail(input, inBox, side), detail(output, outBox, side)])
  const ratio = inputDetail > 0 ? Math.round((outputDetail / inputDetail) * 1000) / 1000 : 1
  const smoothed = ratio < minRatio
  const pct = Math.round(ratio * 100)
  const where = region === 'face' ? 'face' : 'center of the frame'
  return {
    ratio, inputDetail, outputDetail, smoothed, region,
    message: smoothed
      ? `Skin smoothed: the ${where} kept only ${pct}% of the fine detail it had before. Rerun it; real skin texture is the product.`
      : `Skin texture kept (${pct}% of the fine detail before).`,
  }
}
