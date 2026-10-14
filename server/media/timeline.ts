import { ffmpeg, MediaError, probeFile, type ProbeResult } from './ffmpeg.js'
import { fitFilter, socialArgs, type Canvas } from './meme.js'

// The rough cut (Phase 3): a post's shots (clips and B-roll, each trimmed)
// joined with hard cuts, never a crossfade, and its captions laid over the
// picture, each for its own time. Every shot is fitted to the frame (a
// landscape screen recording sits over a blurred copy of itself). The
// shots' own sound is kept when asked (and silence fills the shots that
// have none), so the sound bed can go on top afterwards.

export interface TimelineShot {
  path: string
  // Trim, in seconds of the source. A null end plays to the source's end.
  in: number
  out: number | null
  // The longest a shot with an open end may run.
  maxSeconds?: number
}

export interface TimelineCaption {
  // A transparent PNG the size of the frame.
  png: string
  start: number
  // Null runs to the end of the video.
  end: number | null
}

export interface TimelineInput {
  shots: TimelineShot[]
  captions: TimelineCaption[]
  canvas: Canvas
  out: string
  keepSound: boolean
  maxSeconds?: number
}

export interface ShotPlan { start: number; in: number; out: number; durationSec: number; hasAudio: boolean; landscape: boolean }

export interface TimelineResult {
  durationSec: number
  hasSound: boolean
  // Where each shot sits in the finished video.
  shots: ShotPlan[]
}

const MIN_SHOT = 0.2
const r3 = (n: number) => Math.round(n * 1000) / 1000

// Each shot's real trim and place, from the sources' lengths. Pure, so the
// Finish step and the renderer agree on the timings.
export function planShots(shots: Array<Pick<TimelineShot, 'in' | 'out' | 'maxSeconds'>>, sources: Array<Pick<ProbeResult, 'durationSec' | 'hasAudio' | 'width' | 'height'>>, maxTotal = Infinity): ShotPlan[] {
  const out: ShotPlan[] = []
  let at = 0
  for (const [i, s] of shots.entries()) {
    const src = sources[i]!
    const len = src.durationSec ?? 0
    if (len < MIN_SHOT) continue
    const start = Math.min(Math.max(0, s.in), Math.max(0, len - MIN_SHOT))
    let end = s.out == null ? len : Math.min(len, Math.max(start + MIN_SHOT, s.out))
    if (s.out == null && s.maxSeconds) end = Math.min(end, start + s.maxSeconds)
    end = Math.min(end, start + Math.max(0, maxTotal - at))
    const durationSec = r3(end - start)
    if (durationSec < MIN_SHOT) break
    out.push({ start: r3(at), in: r3(start), out: r3(end), durationSec, hasAudio: src.hasAudio, landscape: (src.width ?? 0) > (src.height ?? 0) })
    at += durationSec
  }
  return out
}

export async function renderTimeline(t: TimelineInput): Promise<TimelineResult> {
  const c = t.canvas
  if (c.width % 2 || c.height % 2) throw new MediaError('The frame size must be even.')
  if (!t.shots.length) throw new MediaError('The cut has no shots.')
  const probes = await Promise.all(t.shots.map(s => probeFile(s.path)))
  for (const [i, p] of probes.entries()) if (!p.hasVideo) throw new MediaError(`Shot ${i + 1} has no video.`)
  const plan = planShots(t.shots, probes, t.maxSeconds)
  if (!plan.length) throw new MediaError('The shots are too short to cut.')
  const sound = t.keepSound && plan.some(p => p.hasAudio)
  const total = r3(plan.reduce((a, p) => a + p.durationSec, 0))

  const args: string[] = []
  const filters: string[] = []
  const used = plan.map((p, i) => ({ p, s: t.shots[i]! }))
  for (const [k, { p, s }] of used.entries()) {
    args.push('-i', s.path)
    filters.push(`[${k}:v]trim=start=${p.in}:end=${p.out},setpts=PTS-STARTPTS[t${k}]`)
    filters.push(fitFilter(`t${k}`, `v${k}`, c, p.landscape))
    if (sound) {
      filters.push(p.hasAudio
        ? `[${k}:a]atrim=start=${p.in}:end=${p.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${p.durationSec},atrim=0:${p.durationSec}[a${k}]`
        : `anullsrc=r=48000:cl=stereo,atrim=0:${p.durationSec}[a${k}]`)
    }
  }
  const n = used.length
  filters.push(sound
    ? `${used.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${n}:v=1:a=1[cut][aout]`
    : `${used.map((_, k) => `[v${k}]`).join('')}concat=n=${n}:v=1:a=0[cut]`)
  let last = 'cut'
  let idx = n
  for (const [j, cap] of t.captions.entries()) {
    const end = cap.end == null ? total : Math.min(total, cap.end)
    const start = Math.max(0, Math.min(cap.start, total))
    if (end - start < 0.05) continue
    args.push('-loop', '1', '-framerate', String(c.fps), '-i', cap.png)
    const whole = start <= 0 && end >= total
    filters.push(`[${last}][${idx}:v]overlay=0:0:shortest=1:format=auto${whole ? '' : `:enable='between(t,${r3(start)},${r3(end)})'`}[o${j}]`)
    last = `o${j}`
    idx++
  }
  filters.push(`[${last}]format=yuv420p[vout]`)
  await ffmpeg([...args, '-filter_complex', filters.join(';'), '-map', '[vout]', ...(sound ? ['-map', '[aout]'] : []), '-t', String(total), ...socialArgs(c.fps, sound), t.out], 900_000)
  const done = await probeFile(t.out)
  return { durationSec: done.durationSec ?? total, hasSound: sound, shots: plan }
}
