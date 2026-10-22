import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { Logger } from '../lib/logger.js'

// Face identity for QA (SPEC 6): detect the face, align it on five
// landmarks, embed it, and compare embeddings with cosine similarity.
// Models are from the OpenCV Zoo and allow commercial use: YuNet (MIT) for
// detection and SFace (Apache-2.0) for recognition. They run in-process on
// onnxruntime-web (WebAssembly), so there is no native build and no network
// call. `npm run models` downloads them into STUDIO_MODELS_DIR.

export const FACE_MODELS = {
  detector: 'face_detection_yunet_2023mar.onnx',
  recognizer: 'face_recognition_sface_2021dec.onnx',
} as const

export type Point = [number, number]

export interface DetectedFace {
  box: { x: number; y: number; w: number; h: number }
  // Right eye, left eye, nose tip, right and left mouth corner, in that order
  // (the order the SFace alignment template expects).
  landmarks: Point[]
  score: number
}

export interface FaceAnalysis {
  face: DetectedFace
  faces: number
  embedding: Float32Array
}

export interface FaceMatcher {
  status(): Promise<{ available: boolean; reason?: string }>
  detect(image: Buffer): Promise<DetectedFace[]>
  // The main (largest) face and its embedding, or null when there is none.
  // `cacheKey` (for example an asset checksum) skips repeat work.
  analyze(image: Buffer, cacheKey?: string): Promise<FaceAnalysis | null>
  // Every face with its embedding, left to right (two-person recreates,
  // item 24). Optional: test fakes may leave it out.
  analyzeAll?(image: Buffer): Promise<Array<{ face: DetectedFace; embedding: Float32Array }>>
}

export function unavailableFaceMatcher(reason: string): FaceMatcher {
  const refuse = async (): Promise<never> => { throw new Error(reason) }
  return { status: async () => ({ available: false, reason }), detect: refuse, analyze: refuse }
}

// ── Pure math (unit tested without the models) ──────────────────────────

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) throw new Error('Embeddings must have the same, non-zero length.')
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!
    dot += x * y; na += x * x; nb += y * y
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export interface Similarity { a: number; b: number; tx: number; ty: number }

// Least-squares similarity transform (rotation, uniform scale, translation;
// no reflection) taking `src` points onto `dst`. In 2D this is the Umeyama
// solution: x' = a*x - b*y + tx, y' = b*x + a*y + ty.
export function similarityTransform(src: Point[], dst: Point[]): Similarity {
  if (src.length !== dst.length || src.length < 2) throw new Error('Need at least two matching points.')
  const n = src.length
  let msx = 0, msy = 0, mdx = 0, mdy = 0
  for (let i = 0; i < n; i++) { msx += src[i]![0]; msy += src[i]![1]; mdx += dst[i]![0]; mdy += dst[i]![1] }
  msx /= n; msy /= n; mdx /= n; mdy /= n
  let num1 = 0, num2 = 0, den = 0
  for (let i = 0; i < n; i++) {
    const px = src[i]![0] - msx, py = src[i]![1] - msy
    const qx = dst[i]![0] - mdx, qy = dst[i]![1] - mdy
    num1 += px * qx + py * qy
    num2 += px * qy - py * qx
    den += px * px + py * py
  }
  if (den === 0) throw new Error('Points are all the same.')
  const a = num1 / den, b = num2 / den
  return { a, b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) }
}

export function applySimilarity(t: Similarity, [x, y]: Point): Point {
  return [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty]
}

// The 112x112 template SFace was trained on (ArcFace five-point layout).
export const SFACE_TEMPLATE: Point[] = [
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041],
]

export interface RgbImage { data: Uint8Array; width: number; height: number }

// Warps the face into the template with bilinear sampling. Pixels outside
// the source are black, as in OpenCV's warpAffine.
export function alignFace(img: RgbImage, landmarks: Point[], size = 112): RgbImage {
  const t = similarityTransform(landmarks, SFACE_TEMPLATE)
  const det = t.a * t.a + t.b * t.b
  const ia = t.a / det, ib = t.b / det
  const out = new Uint8Array(size * size * 3)
  const { data, width: W, height: H } = img
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const dx = u - t.tx, dy = v - t.ty
      const sx = ia * dx + ib * dy
      const sy = -ib * dx + ia * dy
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const fx = sx - x0, fy = sy - y0
      const o = (v * size + u) * 3
      for (let c = 0; c < 3; c++) {
        const px = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 3 + c]!)
        const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx
        const bottom = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx
        out[o + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return { data: out, width: size, height: size }
}

export function iou(a: DetectedFace['box'], b: DetectedFace['box']): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

export function nms(faces: DetectedFace[], threshold: number): DetectedFace[] {
  const sorted = [...faces].sort((p, q) => q.score - p.score)
  const kept: DetectedFace[] = []
  for (const f of sorted) if (kept.every(k => iou(k.box, f.box) <= threshold)) kept.push(f)
  return kept
}

type Outputs = Record<string, { data: ArrayLike<number> }>

// Decodes YuNet's per-stride outputs (cls, obj, bbox, kps at strides 8, 16
// and 32) into faces in input-tensor pixels, as OpenCV's FaceDetectorYN does.
export function decodeYunet(outputs: Outputs, inputW: number, inputH: number, scoreThreshold: number, nmsThreshold: number): DetectedFace[] {
  const found: DetectedFace[] = []
  for (const stride of [8, 16, 32]) {
    const cls = outputs[`cls_${stride}`]?.data, obj = outputs[`obj_${stride}`]?.data
    const bbox = outputs[`bbox_${stride}`]?.data, kps = outputs[`kps_${stride}`]?.data
    if (!cls || !obj || !bbox || !kps) throw new Error(`Face detector output for stride ${stride} is missing.`)
    const cols = Math.floor(inputW / stride), rows = Math.floor(inputH / stride)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const clamp = (x: number) => Math.min(1, Math.max(0, x))
        const score = Math.sqrt(clamp(cls[i]!) * clamp(obj[i]!))
        if (score < scoreThreshold) continue
        const cx = (c + bbox[i * 4]!) * stride, cy = (r + bbox[i * 4 + 1]!) * stride
        const w = Math.exp(bbox[i * 4 + 2]!) * stride, h = Math.exp(bbox[i * 4 + 3]!) * stride
        const landmarks: Point[] = []
        for (let k = 0; k < 5; k++) landmarks.push([(kps[i * 10 + 2 * k]! + c) * stride, (kps[i * 10 + 2 * k + 1]! + r) * stride])
        found.push({ box: { x: cx - w / 2, y: cy - h / 2, w, h }, landmarks, score })
      }
    }
  }
  return nms(found, nmsThreshold)
}

// ── Model runtime ───────────────────────────────────────────────────────

const INPUT = 640
const MAX_EDGE = 1280

export interface FaceMatcherOptions {
  modelsDir: string
  log?: Logger
  scoreThreshold?: number
  nmsThreshold?: number
  // Faces smaller than this share of the image's short edge are ignored.
  minFaceRatio?: number
}

type Ort = typeof import('onnxruntime-web')
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>

export function createFaceMatcher(opts: FaceMatcherOptions): FaceMatcher {
  const dir = resolve(opts.modelsDir)
  const scoreThreshold = opts.scoreThreshold ?? 0.75
  const nmsThreshold = opts.nmsThreshold ?? 0.3
  const minFaceRatio = opts.minFaceRatio ?? 0.03
  const missing = Object.values(FACE_MODELS).filter(f => !existsSync(join(dir, f)))

  let loading: Promise<{ ort: Ort; detector: Session; recognizer: Session }> | null = null
  const load = () => (loading ??= (async () => {
    const ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = 'error'
    // SFace's export trips harmless initializer warnings; keep logs clean.
    const quiet = { logSeverityLevel: 3 as const }
    const detector = await ort.InferenceSession.create(readFileSync(join(dir, FACE_MODELS.detector)), quiet)
    const recognizer = await ort.InferenceSession.create(readFileSync(join(dir, FACE_MODELS.recognizer)), quiet)
    opts.log?.info({ dir }, 'face models loaded')
    return { ort, detector, recognizer }
  })())

  // WebAssembly sessions run one inference at a time.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => undefined)
    return next
  }

  const cache = new Map<string, FaceAnalysis | null>()
  const remember = (key: string, value: FaceAnalysis | null) => {
    cache.set(key, value)
    if (cache.size > 64) cache.delete(cache.keys().next().value!)
  }

  async function decode(image: Buffer): Promise<RgbImage> {
    const { data, info } = await sharp(image, { failOn: 'error' }).rotate().removeAlpha()
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .raw().toBuffer({ resolveWithObject: true })
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
  }

  async function detectIn(img: RgbImage): Promise<DetectedFace[]> {
    const { ort, detector } = await load()
    // Letterbox into the top-left of a black 640x640 square, BGR, 0-255.
    const scale = Math.min(INPUT / img.width, INPUT / img.height)
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
    const small = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 3 } })
      .resize(w, h, { fit: 'fill' }).raw().toBuffer()
    const plane = INPUT * INPUT
    const tensor = new Float32Array(3 * plane)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 3, d = y * INPUT + x
        tensor[d] = small[s + 2]!
        tensor[plane + d] = small[s + 1]!
        tensor[2 * plane + d] = small[s]!
      }
    }
    const out = await detector.run({ [detector.inputNames[0]!]: new ort.Tensor('float32', tensor, [1, 3, INPUT, INPUT]) }) as unknown as Outputs
    const minSide = Math.min(img.width, img.height) * minFaceRatio
    return decodeYunet(out, INPUT, INPUT, scoreThreshold, nmsThreshold)
      .map(f => ({
        score: f.score,
        box: { x: f.box.x / scale, y: f.box.y / scale, w: f.box.w / scale, h: f.box.h / scale },
        landmarks: f.landmarks.map(([x, y]) => [x / scale, y / scale] as Point),
      }))
      .filter(f => Math.min(f.box.w, f.box.h) >= minSide)
  }

  async function embed(img: RgbImage, face: DetectedFace): Promise<Float32Array> {
    const { ort, recognizer } = await load()
    const aligned = alignFace(img, face.landmarks)
    // SFace takes RGB, 0-255, channels first.
    const plane = 112 * 112
    const tensor = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      tensor[i] = aligned.data[i * 3]!
      tensor[plane + i] = aligned.data[i * 3 + 1]!
      tensor[2 * plane + i] = aligned.data[i * 3 + 2]!
    }
    const out = await recognizer.run({ [recognizer.inputNames[0]!]: new ort.Tensor('float32', tensor, [1, 3, 112, 112]) })
    const vec = Float32Array.from(out[recognizer.outputNames[0]!]!.data as Float32Array)
    let norm = 0
    for (const x of vec) norm += x * x
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm
    return vec
  }

  return {
    async status() {
      if (missing.length) return { available: false, reason: `Face models are not installed (${missing.join(', ')}). Run npm run models.` }
      try { await load(); return { available: true } } catch (e) {
        loading = null
        return { available: false, reason: `Face models could not load: ${(e as Error).message}` }
      }
    },
    detect: image => serial(async () => detectIn(await decode(image))),
    analyzeAll: image => serial(async () => {
      const img = await decode(image)
      const faces = (await detectIn(img)).sort((p, q) => p.box.x - q.box.x)
      const out: Array<{ face: DetectedFace; embedding: Float32Array }> = []
      for (const face of faces) out.push({ face, embedding: await embed(img, face) })
      return out
    }),
    analyze: (image, cacheKey) => serial(async () => {
      if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)!
      const img = await decode(image)
      const faces = await detectIn(img)
      const face = faces.sort((p, q) => q.box.w * q.box.h - p.box.w * p.box.h)[0]
      const result = face ? { face, faces: faces.length, embedding: await embed(img, face) } : null
      if (cacheKey) remember(cacheKey, result)
      return result
    }),
  }
}
