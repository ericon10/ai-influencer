import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  FACE_MODELS, SFACE_TEMPLATE, alignFace, applySimilarity, cosineSimilarity, createFaceMatcher, decodeYunet, iou, nms,
  similarityTransform, unavailableFaceMatcher, type DetectedFace, type Point,
} from './faces.js'

describe('face math', () => {
  it('cosine similarity is 1 for the same direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 5])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1)
    expect(() => cosineSimilarity([1], [1, 2])).toThrow()
  })

  it('recovers a known rotation, scale and translation', () => {
    const angle = 0.4, scale = 1.7
    const truth = { a: scale * Math.cos(angle), b: scale * Math.sin(angle), tx: 12, ty: -5 }
    const src: Point[] = [[10, 10], [60, 12], [35, 40], [15, 70], [55, 72]]
    const dst = src.map(p => applySimilarity(truth, p))
    const got = similarityTransform(src, dst)
    expect(got.a).toBeCloseTo(truth.a, 6)
    expect(got.b).toBeCloseTo(truth.b, 6)
    expect(got.tx).toBeCloseTo(truth.tx, 6)
    expect(got.ty).toBeCloseTo(truth.ty, 6)
  })

  it('never reflects: a mirrored point set does not map exactly', () => {
    const src: Point[] = [[0, 0], [10, 0], [0, 10]]
    const mirrored: Point[] = src.map(([x, y]) => [-x, y])
    const t = similarityTransform(src, mirrored)
    const err = src.reduce((sum, p, i) => sum + Math.hypot(applySimilarity(t, p)[0] - mirrored[i]![0], applySimilarity(t, p)[1] - mirrored[i]![1]), 0)
    expect(err).toBeGreaterThan(1)
  })

  it('aligns landmarks onto the SFace template', () => {
    // A 200x200 image whose "landmarks" are the template scaled by 1.5 and
    // shifted; a bright dot at the nose tip must land at the template nose.
    const W = 200, H = 200
    const lm = SFACE_TEMPLATE.map(([x, y]) => [x * 1.5 + 20, y * 1.5 + 10] as Point)
    const data = new Uint8Array(W * H * 3)
    const [nx, ny] = lm[2]!
    for (let y = Math.round(ny) - 2; y <= Math.round(ny) + 2; y++) for (let x = Math.round(nx) - 2; x <= Math.round(nx) + 2; x++) data.fill(255, (y * W + x) * 3, (y * W + x) * 3 + 3)
    const out = alignFace({ data, width: W, height: H }, lm)
    expect(out.width).toBe(112)
    const [tx, ty] = SFACE_TEMPLATE[2]!
    expect(out.data[(Math.round(ty) * 112 + Math.round(tx)) * 3]).toBeGreaterThan(200)
    expect(out.data[(10 * 112 + 10) * 3]).toBe(0)
  })

  it('keeps the strongest of overlapping detections', () => {
    const face = (x: number, score: number): DetectedFace => ({ box: { x, y: 0, w: 10, h: 10 }, landmarks: [], score })
    expect(iou(face(0, 1).box, face(5, 1).box)).toBeCloseTo(50 / 150)
    const kept = nms([face(0, 0.8), face(1, 0.9), face(50, 0.7)], 0.3)
    expect(kept.map(f => f.score)).toEqual([0.9, 0.7])
  })

  it('decodes YuNet outputs into boxes and landmarks', () => {
    const outputs: Record<string, { data: Float32Array }> = {}
    for (const s of [8, 16, 32]) {
      const n = (64 / s) ** 2
      outputs[`cls_${s}`] = { data: new Float32Array(n) }
      outputs[`obj_${s}`] = { data: new Float32Array(n) }
      outputs[`bbox_${s}`] = { data: new Float32Array(n * 4) }
      outputs[`kps_${s}`] = { data: new Float32Array(n * 10) }
    }
    // One confident face at stride 16, cell (row 1, col 2) of a 4x4 grid.
    const i = 1 * 4 + 2
    outputs.cls_16!.data[i] = 0.9
    outputs.obj_16!.data[i] = 0.9
    outputs.bbox_16!.data.set([0.5, 0.5, Math.log(2), Math.log(3)], i * 4)
    outputs.kps_16!.data.set([0.1, 0.2, 0.9, 0.2, 0.5, 0.5, 0.2, 0.8, 0.8, 0.8], i * 10)
    const faces = decodeYunet(outputs, 64, 64, 0.6, 0.3)
    expect(faces).toHaveLength(1)
    const f = faces[0]!
    expect(f.score).toBeCloseTo(0.9)
    expect(f.box.w).toBeCloseTo(32)
    expect(f.box.h).toBeCloseTo(48)
    expect(f.box.x).toBeCloseTo((2.5 * 16) - 16)
    expect(f.box.y).toBeCloseTo((1.5 * 16) - 24)
    expect(f.landmarks[0]![0]).toBeCloseTo((2 + 0.1) * 16)
    expect(f.landmarks[2]![1]).toBeCloseTo((1 + 0.5) * 16)
  })

  it('reports why it is unavailable', async () => {
    const m = unavailableFaceMatcher('no models')
    expect(await m.status()).toEqual({ available: false, reason: 'no models' })
    await expect(m.analyze(Buffer.alloc(1))).rejects.toThrow('no models')
    const missing = createFaceMatcher({ modelsDir: '/nonexistent' })
    expect((await missing.status()).reason).toMatch(/npm run models/)
  })
})

// With the real models (fetched by `npm run models`; CI fetches them too).
const MODELS_DIR = process.env.STUDIO_MODELS_DIR || '.data/models'
const haveModels = Object.values(FACE_MODELS).every(f => existsSync(join(MODELS_DIR, f)))
const FACES = join(process.cwd(), 'fixtures', 'faces')

describe.skipIf(!haveModels)('face matcher with the real models', () => {
  const matcher = createFaceMatcher({ modelsDir: MODELS_DIR })
  const load = (f: string) => readFileSync(join(FACES, f))
  const THRESHOLD = 0.363 // config/review.yaml qa.identity_min_similarity

  it('loads', async () => {
    expect(await matcher.status()).toEqual({ available: true })
  }, 60_000)

  it('finds one face with five landmarks inside the box', async () => {
    const r = (await matcher.analyze(load('person-a-1.jpg')))!
    expect(r.faces).toBe(1)
    expect(r.embedding).toHaveLength(128)
    const { box, landmarks } = r.face
    for (const [x, y] of landmarks) {
      expect(x).toBeGreaterThan(box.x); expect(x).toBeLessThan(box.x + box.w)
      expect(y).toBeGreaterThan(box.y); expect(y).toBeLessThan(box.y + box.h)
    }
    // Right eye (image left) comes first.
    expect(landmarks[0]![0]).toBeLessThan(landmarks[1]![0])
  }, 60_000)

  it('matches the same person across photos and separates a different person', async () => {
    const a1 = (await matcher.analyze(load('person-a-1.jpg')))!.embedding
    const a2 = (await matcher.analyze(load('person-a-2.jpg')))!.embedding
    const b = (await matcher.analyze(load('person-b.jpg')))!.embedding
    expect(cosineSimilarity(a1, a2)).toBeGreaterThan(THRESHOLD + 0.2)
    expect(cosineSimilarity(a1, b)).toBeLessThan(THRESHOLD)
    expect(cosineSimilarity(a2, b)).toBeLessThan(THRESHOLD)
  }, 60_000)

  it('still matches a horizontally flipped copy (identity is not a side check)', async () => {
    const original = load('person-a-1.jpg')
    const flipped = await sharp(original).flop().jpeg().toBuffer()
    const a = (await matcher.analyze(original))!.embedding
    const f = (await matcher.analyze(flipped))!.embedding
    expect(cosineSimilarity(a, f)).toBeGreaterThan(THRESHOLD)
  }, 60_000)

  it('returns null when there is no face', async () => {
    const blank = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#7a6f66' } }).png().toBuffer()
    expect(await matcher.analyze(blank)).toBeNull()
  }, 60_000)
})
