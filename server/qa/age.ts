import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { DetectedFace } from './faces.js'

// The free adult check before a mass recreate spends anything (owner,
// 2026-10-22, item 24): every face in the clip's frame must read clearly
// adult, or the row is skipped. It runs in-process on onnxruntime-web, like
// the face matcher: the age classifier from the ONNX model zoo (GoogLeNet,
// Levi and Hassner's eight age groups), fed the face crop with a margin,
// 224x224, BGR minus the ImageNet means. `npm run models` downloads it.
//
// It is a coarse screen, never a proof of age: a row passes only when every
// face's likeliest group is 25 or older and the groups up to 20 together
// stay under `maxYoung`. No face, a face it cannot read, or the model
// missing means "no clear adult", and the row is skipped.

export const AGE_MODEL = 'age_googlenet.onnx'
export const AGE_GROUPS = ['0-2', '4-6', '8-12', '15-20', '25-32', '38-43', '48-53', '60-100'] as const
// The first group a clear adult may read as (25-32).
const ADULT_FROM = 4

export interface AgeRead { group: string; adult: boolean; young: number; probs: number[] }

export interface AgeChecker {
  available(): boolean
  // One read per face, in the order given.
  read(image: Buffer, faces: DetectedFace[], scale?: number): Promise<AgeRead[]>
}

// Pure: is this read a clear adult?
export function clearAdult(probs: number[], maxYoung = 0.25): { adult: boolean; young: number; group: string } {
  const young = probs.slice(0, ADULT_FROM).reduce((s, p) => s + p, 0)
  const top = probs.indexOf(Math.max(...probs))
  return { adult: top >= ADULT_FROM && young < maxYoung, young: Math.round(young * 1000) / 1000, group: AGE_GROUPS[top] ?? '?' }
}

export function createAgeChecker(modelsDir: string, maxYoung = 0.25): AgeChecker {
  const file = join(resolve(modelsDir), AGE_MODEL)
  type Ort = typeof import('onnxruntime-web')
  let loading: Promise<{ ort: Ort; session: Awaited<ReturnType<Ort['InferenceSession']['create']>> }> | null = null
  const load = () => (loading ??= (async () => {
    const ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = 1
    return { ort, session: await ort.InferenceSession.create(readFileSync(file), { logSeverityLevel: 3 }) }
  })())
  return {
    available: () => existsSync(file),
    async read(image, faces, scale = 1) {
      const { ort, session } = await load()
      const meta = await sharp(image).rotate().metadata()
      const W = meta.width ?? 0, H = meta.height ?? 0
      const out: AgeRead[] = []
      for (const face of faces) {
        // The face with 40% around it, as the model was trained.
        const b = face.box, m = 0.4
        const x = Math.max(0, Math.round((b.x - b.w * m) / scale)), y = Math.max(0, Math.round((b.y - b.h * m) / scale))
        const w = Math.max(1, Math.min(W - x, Math.round((b.w * (1 + 2 * m)) / scale))), h = Math.max(1, Math.min(H - y, Math.round((b.h * (1 + 2 * m)) / scale)))
        const raw = await sharp(image).rotate().extract({ left: x, top: y, width: w, height: h }).resize(224, 224, { fit: 'fill' }).removeAlpha().raw().toBuffer()
        const plane = 224 * 224, t = new Float32Array(3 * plane)
        for (let i = 0; i < plane; i++) {
          t[i] = raw[i * 3 + 2]! - 104
          t[plane + i] = raw[i * 3 + 1]! - 117
          t[2 * plane + i] = raw[i * 3]! - 123
        }
        const res = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', t, [1, 3, 224, 224]) })
        const probs = Array.from(res[session.outputNames[0]!]!.data as Float32Array)
        out.push({ ...clearAdult(probs, maxYoung), probs: probs.map(p => Math.round(p * 1000) / 1000) })
      }
      return out
    },
  }
}
