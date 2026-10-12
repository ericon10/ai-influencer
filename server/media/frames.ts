import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { ffmpeg, ffmpegVerbose, MediaError, probeFile } from './ffmpeg'

// Sharpness as variance of the Laplacian on a grayscale image. Higher is
// sharper. Used to avoid handing a blurry or mid-motion frame to the next clip.
export async function sharpness(image: string | Buffer): Promise<number> {
  const { data } = await sharp(image)
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sum = 0, sumSq = 0
  for (const v of data) { sum += v; sumSq += v * v }
  const n = data.length
  const mean = sum / n
  return sumSq / n - mean * mean
}

// SSIM between two frames via ffmpeg's ssim filter (1 = identical).
export async function ssim(a: string, b: string): Promise<number> {
  const { stderr } = await ffmpegVerbose(['-i', a, '-i', b, '-lavfi', '[0:v][1:v]scale2ref[x][y];[x][y]ssim', '-f', 'null', '-'])
  const m = stderr.match(/All:([0-9.]+)/)
  if (!m) throw new MediaError('Could not read the SSIM score.', stderr)
  return Number(m[1])
}

// Seam difference used everywhere: 0 = identical, 1 = unrelated.
export async function frameDifference(a: string, b: string): Promise<number> {
  return Math.max(0, 1 - await ssim(a, b))
}

export async function extractFrameAt(video: string, timeSec: number, out: string): Promise<void> {
  await ffmpeg(['-ss', timeSec.toFixed(4), '-i', video, '-frames:v', '1', out])
}

export async function extractFirstFrame(video: string, out: string): Promise<void> {
  await ffmpeg(['-i', video, '-frames:v', '1', out])
}

// Every frame from the last `windowSec` seconds, in order, as PNG files.
async function tailFrames(video: string, windowSec: number, dir: string): Promise<string[]> {
  await ffmpeg(['-sseof', `-${windowSec.toFixed(3)}`, '-i', video, '-fps_mode', 'passthrough', join(dir, 'tail_%05d.png')])
  return (await readdir(dir)).filter(f => f.startsWith('tail_')).sort().map(f => join(dir, f))
}

export interface LastFrameResult {
  path: string
  width: number
  height: number
  // Time of the chosen frame from the start of the clip. If it is earlier than
  // the clip end, trim the clip to this point so the handoff matches.
  timeSec: number
  steppedBackSec: number
  sharpness: number
  lastFrameSharpness: number
}

export interface LastFrameOptions {
  stepBackIfBlurry?: boolean
  stepBackSec?: number
  // The last frame counts as blurry when its sharpness falls below this share
  // of the sharpest frame in the search window.
  blurRatio?: number
}

// Extracts the final frame at full video resolution (never a screenshot).
// If it is blurry or mid-motion, steps back about half a second to the
// sharpest nearby frame (SPEC 5.4 rule 33).
export async function extractLastFrame(video: string, outPng: string, workDir: string, opts: LastFrameOptions = {}): Promise<LastFrameResult> {
  const { stepBackIfBlurry = true, stepBackSec = 0.5, blurRatio = 0.6 } = opts
  const probe = await probeFile(video)
  if (!probe.hasVideo || !probe.width || !probe.height || !probe.durationSec) throw new MediaError('Not a video file.')
  const fps = probe.fps ?? 30
  const window = Math.min(probe.durationSec, stepBackSec + 0.25)
  const frames = await tailFrames(video, window, workDir)
  if (!frames.length) throw new MediaError('No frames found at the end of the clip.')
  const scores = await Promise.all(frames.map(f => sharpness(f)))
  const lastIdx = frames.length - 1
  const lastScore = scores[lastIdx]!
  const best = Math.max(...scores)

  let chosen = lastIdx
  if (stepBackIfBlurry && lastScore < best * blurRatio) {
    // Prefer frames around stepBackSec before the end; take the sharpest there.
    const target = Math.max(0, lastIdx - Math.round(stepBackSec * fps))
    const lo = Math.max(0, target - Math.round(fps * 0.15))
    const hi = Math.min(lastIdx, target + Math.round(fps * 0.15))
    chosen = lo
    for (let i = lo; i <= hi; i++) if (scores[i]! > scores[chosen]!) chosen = i
  }

  await sharp(frames[chosen]!).png().toFile(outPng)
  const steppedBackSec = (lastIdx - chosen) / fps
  return {
    path: outPng,
    width: probe.width,
    height: probe.height,
    timeSec: Math.max(0, probe.durationSec - 1 / fps - steppedBackSec),
    steppedBackSec,
    sharpness: scores[chosen]!,
    lastFrameSharpness: lastScore,
  }
}

export interface ColorStats { mean: [number, number, number]; std: [number, number, number] }

export async function colorStats(image: string): Promise<ColorStats> {
  const s = await sharp(image).removeAlpha().stats()
  const ch = s.channels.slice(0, 3)
  return {
    mean: [ch[0]!.mean, ch[1]!.mean, ch[2]!.mean],
    std: [ch[0]!.stdev, ch[1]!.stdev, ch[2]!.stdev],
  }
}
