import { ffmpegVerbose } from './ffmpeg.js'

// Where the picture cuts in a video (Recreate's review): ffmpeg's scene
// score per frame, above `threshold` (0 to 1) counts as a cut. Times in
// seconds, at most one every half second. Free, on the worker.
export async function detectCuts(video: string, threshold: number): Promise<number[]> {
  const { stderr } = await ffmpegVerbose(['-i', video, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], 180_000)
  const out: number[] = []
  for (const m of stderr.matchAll(/pts_time:\s*([0-9.]+)/g)) {
    const t = Math.round(Number(m[1]) * 100) / 100
    if (Number.isFinite(t) && t > 0.05 && (!out.length || t - out[out.length - 1]! >= 0.5)) out.push(t)
  }
  return out
}
