import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MediaError, probeFile } from './ffmpeg.js'

// The person mask (edit pack 2): which pixels of each frame are her, for the
// edits that put something behind her (text behind subject, the green
// screen, the dolly zoom). PP-HumanSeg (Apache-2.0, from the OpenCV Zoo
// like the face models) runs on onnxruntime-web in the worker, free and
// local. Frames go through at the model's 192x192, the soft mask is
// smoothed over time so the edge does not flicker, then it is scaled to the
// picture and feathered. The result is a grayscale video, white where she
// is, frame for frame with the picture.

export const SEGMENT_MODEL = 'human_segmentation_pphumanseg_2023mar.onnx'
const SIZE = 192

type Ort = typeof import('onnxruntime-web')
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>
const sessions = new Map<string, Promise<{ ort: Ort; session: Session }>>()

export function segmentAvailable(modelsDir: string): boolean {
  return existsSync(join(resolve(modelsDir), SEGMENT_MODEL))
}

function load(modelsDir: string) {
  const dir = resolve(modelsDir)
  let hit = sessions.get(dir)
  if (!hit) {
    hit = (async () => {
      const ort = await import('onnxruntime-web')
      ort.env.wasm.numThreads = 1
      ort.env.logLevel = 'error'
      const session = await ort.InferenceSession.create(readFileSync(join(dir, SEGMENT_MODEL)), { logSeverityLevel: 3 as const })
      return { ort, session }
    })()
    sessions.set(dir, hit)
  }
  return hit
}

// One 192x192 RGB frame in, the chance each pixel is a person out (0 to 1).
export async function personProbability(modelsDir: string, rgb: Uint8Array): Promise<Float32Array> {
  const { ort, session } = await load(modelsDir)
  const n = SIZE * SIZE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    input[i] = (rgb[i * 3]! / 255 - 0.5) / 0.5
    input[n + i] = (rgb[i * 3 + 1]! / 255 - 0.5) / 0.5
    input[2 * n + i] = (rgb[i * 3 + 2]! / 255 - 0.5) / 0.5
  }
  const feeds = { [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) }
  const out = (await session.run(feeds))[session.outputNames[0]!]!.data as Float32Array
  // Two channels (background, person). The export may give scores or
  // probabilities; a softmax over the pair works for both.
  const p = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = out[i]!, b = out[n + i]!
    const m = Math.max(a, b)
    const ea = Math.exp(a - m), eb = Math.exp(b - m)
    p[i] = eb / (ea + eb)
  }
  return p
}

export interface MaskResult {
  frames: number
  // The average share of the frame that is her (0 when no one is found).
  coverage: number
}

// The mask video for a picture: same size, rate and length (or `size`, for
// a small preview copy).
export async function personMaskVideo(video: string, out: string, opts: { modelsDir: string; fps: number; size?: { width: number; height: number }; smooth?: number; feather?: number }): Promise<MaskResult> {
  if (!segmentAvailable(opts.modelsDir)) throw new MediaError('The person model is not on this worker yet (run npm run models).')
  const info = await probeFile(video)
  if (!info.hasVideo || !info.width || !info.height) throw new MediaError('That file has no picture to find her in.')
  const W = opts.size?.width ?? info.width, H = opts.size?.height ?? info.height
  const smooth = opts.smooth ?? 0.55
  const feather = opts.feather ?? Math.max(1, Math.round(Math.min(W, H) / 270))
  await load(opts.modelsDir)

  const dec = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=${opts.fps},scale=${SIZE}:${SIZE}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const enc = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${SIZE}x${SIZE}`, '-r', String(opts.fps), '-i', 'pipe:0',
    '-vf', `scale=${W}:${H}:flags=bicubic,gblur=sigma=${feather},format=gray`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(opts.fps), '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] })
  let decErr = '', encErr = ''
  dec.stderr.on('data', d => { decErr += d })
  enc.stderr.on('data', d => { encErr += d })
  const encDone = new Promise<number>(res => enc.on('close', code => res(code ?? 1)))
  const decDone = new Promise<number>(res => dec.on('close', code => res(code ?? 1)))

  const frameBytes = SIZE * SIZE * 3
  let pending: Buffer = Buffer.alloc(0)
  let prev: Float32Array | null = null
  let frames = 0, cover = 0
  const write = (buf: Buffer) => new Promise<void>((res, rej) => enc.stdin.write(buf, e => (e ? rej(e) : res())))
  for await (const chunk of dec.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    while (pending.length >= frameBytes) {
      const frame = pending.subarray(0, frameBytes)
      pending = pending.subarray(frameBytes)
      const p = await personProbability(opts.modelsDir, frame)
      // Smoothed over time: steadier edges on a moving person.
      if (prev) for (let i = 0; i < p.length; i++) p[i] = smooth * prev[i]! + (1 - smooth) * p[i]!
      prev = p
      const gray = Buffer.alloc(p.length)
      let sum = 0
      for (let i = 0; i < p.length; i++) {
        // A soft edge: below 0.3 is background, above 0.7 is her.
        const v = Math.max(0, Math.min(1, (p[i]! - 0.3) / 0.4))
        gray[i] = Math.round(v * 255)
        sum += v
      }
      cover += sum / p.length
      frames++
      await write(gray)
    }
  }
  enc.stdin.end()
  const [dc, ec] = await Promise.all([decDone, encDone])
  if (dc !== 0) throw new MediaError(`The picture could not be read for the person mask: ${decErr.trim().slice(-300)}`)
  if (ec !== 0) throw new MediaError(`The person mask could not be written: ${encErr.trim().slice(-300)}`)
  if (!frames) throw new MediaError('No frames came out of the picture.')
  return { frames, coverage: Math.round((cover / frames) * 1000) / 1000 }
}
