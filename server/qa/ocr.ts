import { existsSync } from 'node:fs'
import { join } from 'node:path'

// The text check in Recreate's review (owner, 2026-10-14): Tesseract (via
// tesseract.js, on the worker, free) reads frames of a take for logos,
// @handles and captions that carried over. The English data is fetched with
// the face models (`npm run models`, scripts/fetch-models.mjs). Without it
// the check says it is off instead of guessing.

export interface OcrLine { text: string; confidence: number; box: { x: number; y: number; w: number; h: number } }

export interface Ocr {
  status(): Promise<{ available: boolean; reason?: string }>
  read(png: Buffer): Promise<OcrLine[]>
  // Frees the reader's memory on the worker.
  close(): Promise<void>
}

type TessWorker = { recognize(img: Buffer, opts?: unknown, output?: unknown): Promise<{ data: { blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }> | null } }>; terminate(): Promise<unknown> }

export function createOcr(dir = process.env.STUDIO_MODELS_DIR || '.data/models'): Ocr {
  const data = join(dir, 'eng.traineddata')
  let worker: Promise<TessWorker> | null = null
  const ready = () => {
    worker ??= (async () => {
      const { createWorker } = await import('tesseract.js')
      // The data is read from disk as fetched (not gzipped), never downloaded.
      return await createWorker('eng', 1, { langPath: dir, gzip: false, cacheMethod: 'none', logger: () => undefined, errorHandler: () => undefined }) as unknown as TessWorker
    })()
    return worker
  }
  return {
    async status() {
      return existsSync(data) ? { available: true } : { available: false, reason: 'the text data is not installed (npm run models)' }
    },
    async read(png) {
      const w = await ready()
      const { data: d } = await w.recognize(png, {}, { blocks: true, text: false })
      const out: OcrLine[] = []
      for (const b of d.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
        const text = l.text.replace(/\s+/g, ' ').trim()
        if (text) out.push({ text, confidence: l.confidence, box: { x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 } })
      }
      return out
    },
    async close() {
      const w = worker
      worker = null
      if (w) await (await w).terminate().catch(() => undefined)
    },
  }
}

export type TextKind = 'handle' | 'logo' | 'caption'

const LOGOS = /\b(tik\s?tok|reels?|instagram|capcut|youtube|shorts|snapchat)\b/i

// What a line of text on a frame is: an @handle, a platform logo, or other
// text (a caption). Short noise (fewer than 3 letters, low confidence) is
// dropped.
export function classifyText(line: { text: string; confidence: number }): { kind: TextKind; text: string } | null {
  const text = line.text.replace(/[^\p{L}\p{N}@#._\s'!?,:-]/gu, '').replace(/\s+/g, ' ').trim()
  const letters = text.replace(/[^\p{L}\p{N}]/gu, '')
  if (letters.length < 3 || line.confidence < 55) return null
  if (/@[\w.]{3,}/.test(text)) return { kind: 'handle', text: text.match(/@[\w.]{3,}/)![0] }
  if (LOGOS.test(text)) return { kind: 'logo', text: text.match(LOGOS)![0] }
  return { kind: 'caption', text: text.slice(0, 80) }
}
