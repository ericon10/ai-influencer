import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { ffmpeg, ffmpegVerbose, MediaError, probeFile } from './ffmpeg.js'
import type { Canvas } from './meme.js'

// Amazing Edits (Phase 5; config/edits.yaml): edits rendered by code on the
// worker, free, never by a video model. Each works on the finished picture
// of a post (its shots already joined with hard cuts), before the captions
// and the sound bed go on. A picture is cut into time segments; each
// segment gets its own filters (a zoom, a speed change, a freeze, a shake);
// the segments are joined with hard cuts in one pass. Frame blending is used
// only inside one shot (motion blur), never across a cut: the never-
// crossfade rule holds. Every edit reports how it moved time, so captions
// can follow.

export type EditStyle = 'crash_zoom' | 'speed_ramp' | 'punch_in' | 'freeze_pop' | 'flash_shake' | 'seamless_loop' | 'word_pop' | 'whip_pan' | 'hand_lens' | 'zoom_reveal'

export interface EditInput {
  style: EditStyle
  video: string
  out: string
  workDir: string
  canvas: Canvas
  params: Record<string, number>
  // Where shot 2, 3 and so on start in the picture, in seconds.
  cuts: number[]
  // Where a one-shot edit lands (a speed ramp, a freeze, a flash).
  payoff: number
  // Her face, as a share of the frame (0 to 1), for the zooms.
  face?: { x: number; y: number }
  // Beat times from the music, for the punch-ins.
  beats?: number[]
}

export interface EditResult {
  durationSec: number
  // Points [time in the picture, time in the result] to move captions by.
  timeMap: Array<[number, number]>
  note: string | null
}

export const DEFAULT_FACE = { x: 0.5, y: 0.38 }
const r3 = (n: number) => Math.round(n * 1000) / 1000

// Encoding for the in-between files: near lossless and quick, so the final
// export loses nothing to the extra pass.
function workArgs(fps: number, audio: boolean): string[] {
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(fps), '-fps_mode', 'cfr', ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']), '-movflags', '+faststart']
}

// atempo takes 0.5 to 2 per stage; slower speeds chain stages.
export function atempoChain(speed: number): string {
  const parts: string[] = []
  let s = speed
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5 }
  while (s > 2) { parts.push('atempo=2'); s /= 2 }
  parts.push(`atempo=${s.toFixed(4)}`)
  return parts.join(',')
}

interface Seg {
  // A time range of the picture, or a frame range (whip pan works frame by frame).
  start?: number
  end?: number
  startFrame?: number
  endFrame?: number
  vf?: string
  af?: string
  // Hold the first frame of the range this long (a freeze).
  freeze?: number
  // A white flash over the start of the segment, this long.
  flash?: number
}

async function renderSegments(e: EditInput, segs: Seg[], hasAudio: boolean): Promise<void> {
  const { width: W, height: H, fps } = e.canvas
  const n = segs.length
  const f: string[] = [`[0:v]split=${n}${segs.map((_, k) => `[i${k}]`).join('')}`]
  if (hasAudio) f.push(`[0:a]asplit=${n}${segs.map((_, k) => `[j${k}]`).join('')}`)
  for (const [k, s] of segs.entries()) {
    const range = s.startFrame != null ? `trim=start_frame=${s.startFrame}:end_frame=${s.endFrame}` : `trim=start=${r3(s.start!)}:end=${r3(s.end!)}`
    if (s.freeze) {
      const frames = Math.max(1, Math.round(s.freeze * fps))
      f.push(`[i${k}]trim=start=${r3(s.start!)}:duration=${r3(1.5 / fps)},setpts=PTS-STARTPTS,select='eq(n,0)',loop=loop=${frames - 1}:size=1:start=0,setpts=N/(${fps}*TB),fps=${fps}${s.vf ? `,${s.vf}` : ''}[v${k}]`)
      if (hasAudio) f.push(`[j${k}]anullsink`, `aevalsrc=0:s=48000:c=stereo:d=${r3(frames / fps)}[a${k}]`)
      continue
    }
    const chain = `[i${k}]${range},setpts=PTS-STARTPTS${s.vf ? `,${s.vf}` : ''},setsar=1,format=yuv420p`
    if (s.flash) {
      f.push(`${chain}[p${k}]`)
      f.push(`color=c=white:s=${W}x${H}:r=${fps}:d=${r3(s.flash)},format=rgba,fade=t=out:st=0:d=${r3(s.flash)}:alpha=1[fl${k}]`)
      f.push(`[p${k}][fl${k}]overlay=0:0:eof_action=pass,format=yuv420p[v${k}]`)
    } else f.push(`${chain}[v${k}]`)
    if (hasAudio) {
      const arange = s.startFrame != null ? `atrim=start=${r3(s.startFrame / fps)}:end=${r3(s.endFrame! / fps)}` : `atrim=start=${r3(s.start!)}:end=${r3(s.end!)}`
      f.push(`[j${k}]${arange},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo${s.af ? `,${s.af}` : ''}[a${k}]`)
    }
  }
  f.push(`${segs.map((_, k) => (hasAudio ? `[v${k}][a${k}]` : `[v${k}]`)).join('')}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[v]${hasAudio ? '[a]' : ''}`)
  await ffmpeg(['-i', e.video, '-filter_complex', f.join(';'), '-map', '[v]', ...(hasAudio ? ['-map', '[a]'] : []), ...workArgs(fps, hasAudio), e.out], 900_000)
}

// A zoom toward her face, frame by frame: z is an expression of the
// segment's own time (it), 1 or more.
function zoomTo(e: EditInput, z: string): string {
  const { width: W, height: H, fps } = e.canvas
  const fc = e.face ?? DEFAULT_FACE
  return `zoompan=z='${z}':x='max(0,min(iw-iw/zoom,${fc.x.toFixed(4)}*iw-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${fc.y.toFixed(4)}*ih-ih/zoom/2))':d=1:s=${W}x${H}:fps=${fps}`
}

const clampTime = (t: number, dur: number) => Math.max(0.2, Math.min(dur - 0.2, t))

export async function applyEdit(e: EditInput): Promise<EditResult> {
  const pr = await probeFile(e.video)
  const D = pr.durationSec ?? 0
  if (!pr.hasVideo || D < 0.5) throw new MediaError('The video is too short for an edit.')
  const audio = pr.hasAudio
  const p = e.params
  const fps = e.canvas.fps
  const id = (): Array<[number, number]> => [[0, 0], [D, D]]
  const firstCut = e.cuts.find(c => c > 0.3 && c < D - 0.3)
  const needCut = (label: string) => { if (firstCut == null) throw new MediaError(`${label} needs two shots: shot A, then shot B.`); return firstCut }

  switch (e.style) {
    case 'crash_zoom': {
      // The last moment of shot A rushes into her face (ease-in, up to the
      // zoom), with motion blur inside the shot; then a hard cut to B.
      const c = needCut('Crash zoom')
      const L = Math.min(p.seconds ?? 0.6, c - 0.1)
      const Z = p.zoom ?? 3
      await renderSegments(e, [
        { start: 0, end: c - L },
        { start: c - L, end: c, vf: `${zoomTo(e, `1+${Z - 1}*pow(min(1,it/${r3(L)}),2)`)},tmix=frames=3` },
        { start: c, end: D },
      ], audio)
      return { durationSec: D, timeMap: id(), note: `Zoom to ${Z}x over the last ${r3(L)} s of shot A, hard cut at ${r3(c)} s.` }
    }
    case 'zoom_reveal': {
      // Tight on her face, easing out to the whole frame.
      const S = Math.min(p.seconds ?? 1.2, D - 0.2)
      const Z = p.zoom ?? 2.4
      await renderSegments(e, [
        { start: 0, end: S, vf: zoomTo(e, `${Z}-${Z - 1}*(1-pow(1-min(1,it/${r3(S)}),3))`) },
        { start: S, end: D },
      ], audio)
      return { durationSec: D, timeMap: id(), note: `From ${Z}x on her face to the full frame in ${r3(S)} s.` }
    }
    case 'punch_in': {
      // Instant punches to the zoom on alternate beats (the music's, or a
      // steady grid), held until the next beat.
      const Z = p.zoom ?? 1.14
      const every = p.every ?? 1
      let beats = (e.beats ?? []).filter(b => b > 0.2 && b < D - 0.1)
      if (beats.length >= 2) {
        const gap = (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1)
        if (gap < 0.4) beats = beats.filter((_, i) => i % 2 === 0)
      } else beats = Array.from({ length: Math.floor((D - 0.3) / every) }, (_, i) => r3(0.5 + i * every)).filter(b => b < D - 0.1)
      const windows: Array<[number, number]> = []
      for (let i = 0; i < beats.length; i += 2) windows.push([beats[i]!, beats[i + 1] ?? D])
      if (!windows.length) throw new MediaError('The video is too short for punch-ins.')
      const expr = windows.map(([a, b]) => `between(it,${r3(a)},${r3(b - 1 / fps)})`).join('+')
      await renderSegments(e, [{ start: 0, end: D, vf: zoomTo(e, `if(${expr},${Z},1)`) }], audio)
      return { durationSec: D, timeMap: id(), note: `${windows.length} punch-ins to ${Z}x${e.beats?.length ? ' on the music\'s beat' : ''}.` }
    }
    case 'speed_ramp': {
      // Ramp down to slow motion at the payoff (motion-interpolated frames
      // inside the shot), then back to normal speed.
      const v = p.speed ?? 0.4
      const a = clampTime(e.payoff, D)
      const b = Math.min(D, a + (p.seconds ?? 1))
      const r = Math.min(0.2, (b - a) / 4)
      const mid = (1 + v) / 2
      // Frame blending by default (quick on the worker); smooth: 1 asks for
      // motion-compensated frames (much slower at full size).
      const interp = (p.smooth ?? 0) >= 1 ? 'mi_mode=mci:mc_mode=obmc:me_mode=bidir' : 'mi_mode=blend'
      const slow = (sp: number) => `setpts=PTS/${sp.toFixed(4)},minterpolate=fps=${fps}:${interp}`
      const segs: Seg[] = [
        { start: 0, end: a },
        { start: a, end: a + r, vf: slow(mid), af: atempoChain(mid) },
        { start: a + r, end: b, vf: slow(v), af: atempoChain(v) },
      ]
      if (b < D - 0.05) segs.push({ start: b, end: D })
      await renderSegments(e, segs, audio)
      const t1 = a + r / mid, t2 = t1 + (b - a - r) / v
      return { durationSec: t2 + (D - b), timeMap: [[0, 0], [a, a], [a + r, t1], [b, t2], [D, t2 + (D - b)]], note: `Slow motion at ${v}x from ${r3(a)} s for ${r3(b - a)} s of the video.` }
    }
    case 'freeze_pop': {
      const F = p.seconds ?? 1.1
      const a = clampTime(e.payoff, D)
      await renderSegments(e, [{ start: 0, end: a }, { start: a, freeze: F }, { start: a, end: D }], audio)
      const held = Math.max(1, Math.round(F * fps)) / fps
      return { durationSec: D + held, timeMap: [[0, 0], [a, a], [a, a + held], [D, D + held]], note: `Frozen at ${r3(a)} s for ${r3(held)} s.` }
    }
    case 'flash_shake': {
      // A white flash and a shake that dies out, on the cut (or the payoff).
      const at = firstCut ?? clampTime(e.payoff, D)
      const S = Math.min(p.seconds ?? 0.4, D - at)
      const A = p.shake ?? 18
      const { width: W, height: H } = e.canvas
      const shake = `scale=${Math.round(W * 1.08 / 2) * 2}:${Math.round(H * 1.08 / 2) * 2},crop=${W}:${H}:x='(iw-${W})/2+${A}*sin(2*PI*14*t)*max(0,1-t/${r3(S)})':y='(ih-${H})/2+${(A * 0.7).toFixed(1)}*cos(2*PI*11*t)*max(0,1-t/${r3(S)})'`
      const segs: Seg[] = []
      if (at > 0.01) segs.push({ start: 0, end: at })
      segs.push({ start: at, end: at + S, vf: shake, flash: Math.min(p.flash ?? 0.14, S) })
      if (at + S < D - 0.01) segs.push({ start: at + S, end: D })
      await renderSegments(e, segs, audio)
      return { durationSec: D, timeMap: id(), note: `Flash and shake at ${r3(at)} s${firstCut != null ? ' (the cut)' : ' (the payoff)'}.` }
    }
    case 'seamless_loop': {
      // Trim to the frame most like the first one, so the loop has no jump.
      const from = Math.max(0.5, D * (p.min_share ?? 0.6))
      const best = await bestLoopEnd(e.video, from, D, e.workDir)
      await renderSegments(e, [{ start: 0, end: best.time }], audio)
      return { durationSec: best.time, timeMap: [[0, 0], [best.time, best.time]], note: `Loops at ${r3(best.time)} s (frame difference ${best.diff.toFixed(3)}; 0 is identical).` }
    }
    case 'whip_pan': {
      // Shot A slides away and shot B slides in, each under a directional
      // blur that grows toward the cut, with motion blur from the slide
      // itself (frames blended inside each shot); a hard cut between them.
      const c = needCut('Whip pan')
      const S = Math.max(2 / fps, Math.min(p.seconds ?? 0.16, c - 0.1, D - c - 0.1))
      const sh = p.shift ?? 0.3
      const B = p.blur ?? 40
      const { width: W, height: H } = e.canvas
      const big = (x: number) => Math.round(x * (1 + sh) / 2) * 2
      const half = S / 2
      // u runs 0 to 1 across the whole side; each half restarts its own t.
      const side = (dir: 'out' | 'in', from: number, radius: number) => {
        const u = `min(1,max(0,(t+${r3(from)})/${r3(S)}))`
        const x = dir === 'out' ? `(iw-${W})/2+(iw-${W})/2*pow(${u},2)` : `(iw-${W})/2*(1-pow(1-${u},2))`
        return `scale=${big(W)}:${big(H)},crop=${W}:${H}:x='${x}':y='(ih-${H})/2',dblur=angle=0:radius=${Math.max(1, Math.round(radius))},tmix=frames=3`
      }
      await renderSegments(e, [
        { start: 0, end: c - S },
        { start: c - S, end: c - half, vf: side('out', 0, B * 0.4) },
        { start: c - half, end: c, vf: side('out', half, B) },
        { start: c, end: c + half, vf: side('in', 0, B) },
        { start: c + half, end: c + S, vf: side('in', half, B * 0.4) },
        { start: c + S, end: D },
      ], audio)
      return { durationSec: D, timeMap: id(), note: `Whip over ${r3(S)} s on each side of the cut at ${r3(c)} s.` }
    }
    case 'hand_lens': {
      // Cut from shot A's darkest frame (her palm on the lens) to shot B's
      // darkest frame. With no dark frame, a short dip to black on each side
      // (a dip, never a blend of the two shots).
      const c = needCut('Hand over the lens')
      const search = p.search ?? 1
      // The lens is fully covered from A's first dark frame to B's last one.
      const a = await darkest(e.video, Math.max(0, c - search), c, fps, 'first')
      const b = await darkest(e.video, c, Math.min(D, c + search), fps, 'last')
      if (a && b && a.luma < 40 && b.luma < 40) {
        await renderSegments(e, [{ start: 0, end: a.time + 1 / fps }, { start: b.time, end: D }], audio)
        const cutA = a.time + 1 / fps
        const removed = b.time - cutA
        return { durationSec: D - removed, timeMap: [[0, 0], [cutA, cutA], [b.time, cutA], [D, D - removed]], note: `Cut from the dark frame at ${r3(a.time)} s to the one at ${r3(b.time)} s.` }
      }
      const d = Math.min(p.dip ?? 0.2, c / 2, (D - c) / 2)
      await renderSegments(e, [{ start: 0, end: c - d }, { start: c - d, end: c, vf: `fade=t=out:st=0:d=${r3(d)}` }, { start: c, end: c + d, vf: `fade=t=in:st=0:d=${r3(d)}` }, { start: c + d, end: D }], audio)
      return { durationSec: D, timeMap: id(), note: `No dark frame near the cut (the lens was not covered), so a ${r3(d)} s dip to black on each side.` }
    }
    case 'word_pop':
      // The picture is unchanged; the captions pop word by word.
      await ffmpeg(['-i', e.video, '-c', 'copy', e.out])
      return { durationSec: D, timeMap: id(), note: null }
  }
}

// A time in the picture, moved the way the edit moved time.
export function mapTime(map: Array<[number, number]>, t: number): number {
  if (!map.length) return t
  if (t <= map[0]![0]) return map[0]![1] + (t - map[0]![0])
  for (let i = 1; i < map.length; i++) {
    const [x0, y0] = map[i - 1]!, [x1, y1] = map[i]!
    if (t <= x1) return x1 === x0 ? y1 : y0 + ((t - x0) * (y1 - y0)) / (x1 - x0)
  }
  const [xl, yl] = map[map.length - 1]!
  return yl + (t - xl)
}

// Gray pixels of a frame, small, for quick comparisons.
async function gray(path: string): Promise<Buffer> {
  return sharp(path).resize(72, 128, { fit: 'fill' }).greyscale().raw().toBuffer()
}
const meanDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length / 255 }

export async function bestLoopEnd(video: string, from: number, to: number, workDir: string): Promise<{ time: number; diff: number }> {
  const dir = join(workDir, `loop-${Date.now()}`)
  await ffmpeg(['-i', video, '-frames:v', '1', '-vf', 'scale=144:256', join(workDir, 'loop-first.png')])
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true })
  const rate = 10
  await ffmpeg(['-ss', r3(from).toString(), '-i', video, '-vf', `fps=${rate},scale=144:256`, join(dir, 'f_%04d.png')])
  const first = await gray(join(workDir, 'loop-first.png'))
  const files = (await readdir(dir)).filter(f => f.startsWith('f_')).sort()
  let best = { time: to, diff: Infinity }
  for (const [i, f] of files.entries()) {
    const d = meanDiff(first, await gray(join(dir, f)))
    const t = from + i / rate
    if (t > to - 0.05) break
    if (d <= best.diff) best = { time: t, diff: d }
  }
  return { time: Math.max(0.5, best.time), diff: Number.isFinite(best.diff) ? best.diff : 1 }
}

// The darkest frame in a window (mean luma 0 to 255), from signalstats.
// Among frames as dark as the darkest (within 3), the first or the last.
export async function darkest(video: string, from: number, to: number, fps: number, prefer: 'first' | 'last' = 'first'): Promise<{ time: number; luma: number } | null> {
  if (to - from < 1 / fps) return null
  const { stderr } = await ffmpegVerbose(['-i', video, '-vf', `trim=start=${r3(from)}:end=${r3(to)},setpts=PTS-STARTPTS,signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-f', 'null', '-'])
  const times = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map(m => Number(m[1]))
  const lumas = [...stderr.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].map(m => Number(m[1]))
  const n = Math.min(times.length, lumas.length)
  if (!n) return null
  const min = Math.min(...lumas.slice(0, n))
  const dark = Array.from({ length: n }, (_, i) => i).filter(i => lumas[i]! <= min + 3)
  const i = prefer === 'first' ? dark[0]! : dark[dark.length - 1]!
  return { time: from + times[i]!, luma: lumas[i]! }
}

// Beats of a music track (onsets, then the steady beat that fits them
// best), for punch-ins on the beat. Decoded to mono samples in memory.
export async function detectBeats(audio: string, maxSec: number): Promise<number[]> {
  const rate = 11025
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', audio, '-t', String(maxSec), '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'])
    const chunks: Buffer[] = []
    proc.stdout.on('data', d => chunks.push(d as Buffer))
    proc.on('error', reject)
    proc.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new MediaError('Could not read the music for its beat.'))))
  })
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4))
  const hop = 128, win = 512
  const env: number[] = []
  for (let i = 0; i + win <= samples.length; i += hop) {
    let s = 0
    for (let j = i; j < i + win; j++) s += samples[j]! * samples[j]!
    env.push(Math.log(1e-9 + s / win))
  }
  const raw = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)))
  // Smoothed, so a beat that falls between two analysis frames still lines up.
  const kernel = [1, 2, 3, 2, 1]
  const onset = raw.map((_, i) => kernel.reduce((a, k, j) => a + k * (raw[i + j - 2] ?? 0), 0) / 9)
  const frameSec = hop / rate
  // The beat period: the lag (0.3 to 1 s) where the onsets repeat best.
  let bestLag = 0, bestScore = -1
  for (let lag = Math.round(0.3 / frameSec); lag <= Math.round(1 / frameSec); lag++) {
    let s = 0
    for (let i = lag; i < onset.length; i++) s += onset[i]! * onset[i - lag]!
    if (s > bestScore) { bestScore = s; bestLag = lag }
  }
  if (!bestLag || bestScore <= 0) return []
  // A beat at half the period that repeats almost as well is the real beat
  // (the longer lag only counts every other one).
  const halfLag = Math.round(bestLag / 2)
  if (halfLag * frameSec >= 0.25) {
    let s = 0
    for (let i = halfLag; i < onset.length; i++) s += onset[i]! * onset[i - halfLag]!
    if (s >= bestScore * 0.8) bestLag = halfLag
  }
  // The phase: where a grid of that period meets the most onsets.
  let bestPhase = 0, phaseScore = -1
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0
    for (let i = ph; i < onset.length; i += bestLag) s += onset[i]!
    if (s > phaseScore) { phaseScore = s; bestPhase = ph }
  }
  const beats: number[] = []
  for (let i = bestPhase; i < onset.length; i += bestLag) beats.push(r3(i * frameSec))
  return beats
}
