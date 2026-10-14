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
  // Edit pack 2 (overnight run, 2026-10-14).
  | 'velocity' | 'text_behind' | 'karaoke' | 'split_screen' | 'green_screen' | 'glitch' | 'spin' | 'dolly_zoom' | 'record_scratch' | 'snap_zoom'

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
  // Her outline, frame for frame with the picture (white where she is),
  // for the edits that put something behind her.
  mask?: string
  // What goes behind her on the green screen (a video or a still image).
  background?: string
  // A layout choice (split screen: "stacked" or "side").
  variant?: string
}

export interface EditResult {
  durationSec: number
  // Points [time in the picture, time in the result] to move captions by.
  timeMap: Array<[number, number]>
  note: string | null
  // Sound accents the edit asks for (made by code), at a time in the result.
  accents?: Array<{ kind: 'scratch'; at: number }>
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
  // Filters that also use her outline (the mask, trimmed the same way):
  // inputs are the segment's picture and mask labels, output the label.
  withMask?: (v: string, m: string, out: string, k: number) => string[]
}

async function renderSegments(e: EditInput, segs: Seg[], hasAudio: boolean): Promise<void> {
  const { width: W, height: H, fps } = e.canvas
  const n = segs.length
  const f: string[] = [`[0:v]split=${n}${segs.map((_, k) => `[i${k}]`).join('')}`]
  if (hasAudio) f.push(`[0:a]asplit=${n}${segs.map((_, k) => `[j${k}]`).join('')}`)
  const masked = segs.map((s, k) => (s.withMask ? k : -1)).filter(k => k >= 0)
  if (masked.length && !e.mask) throw new MediaError('This edit needs her outline (the person mask).')
  if (masked.length) f.push(`[1:v]format=gray,split=${masked.length}${masked.map(k => `[mi${k}]`).join('')}`)
  for (const [k, s] of segs.entries()) {
    const range = s.startFrame != null ? `trim=start_frame=${s.startFrame}:end_frame=${s.endFrame}` : `trim=start=${r3(s.start!)}:end=${r3(s.end!)}`
    if (s.withMask) {
      f.push(`[i${k}]${range},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[sv${k}]`)
      f.push(`[mi${k}]${range},setpts=PTS-STARTPTS,scale=${W}:${H},format=gray[sm${k}]`)
      f.push(...s.withMask(`[sv${k}]`, `[sm${k}]`, `[w${k}]`, k))
      f.push(`[w${k}]setsar=1,format=yuv420p[v${k}]`)
      if (hasAudio) f.push(`[j${k}]atrim=start=${r3(s.start!)}:end=${r3(s.end!)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${k}]`)
      continue
    }
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
  await ffmpeg(['-i', e.video, ...(masked.length ? ['-i', e.mask!] : []), '-filter_complex', f.join(';'), '-map', '[v]', ...(hasAudio ? ['-map', '[a]'] : []), ...workArgs(fps, hasAudio), e.out], 900_000)
}

// A steady zoom on her face (z fixed), for the snap zoom's steps.
const holdZoom = (e: EditInput, z: number) => zoomTo(e, String(z))

// Pseudo-random but repeatable numbers (the glitch looks the same each export).
const jitter = (k: number, salt: number) => {
  const x = Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

// Slow and fast stretches of a picture as segments, with the time map.
function speedSegments(D: number, pieces: Array<{ start: number; end: number; speed: number }>, fps: number) {
  const segs: Seg[] = []
  const map: Array<[number, number]> = [[0, 0]]
  let out = 0
  for (const p of pieces) {
    if (p.end - p.start < 1 / fps) continue
    const sp = p.speed
    const vf = sp === 1 ? undefined : sp < 1 ? `setpts=PTS/${sp.toFixed(4)},minterpolate=fps=${fps}:mi_mode=blend` : `setpts=PTS/${sp.toFixed(4)}`
    segs.push({ start: p.start, end: p.end, ...(vf ? { vf } : {}), ...(sp === 1 ? {} : { af: atempoChain(sp) }) })
    out += (p.end - p.start) / sp
    map.push([p.end, out])
  }
  if (map.at(-1)![0] < D) map.push([D, out + (D - map.at(-1)![0])])
  return { segs, map, duration: out }
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
    case 'karaoke':
    case 'text_behind':
      // The picture is unchanged here; the captions carry these edits
      // (text behind subject is laid in with overlayBehind).
      await ffmpeg(['-i', e.video, '-c', 'copy', e.out])
      return { durationSec: D, timeMap: id(), note: null }
    case 'velocity': {
      // Fast, then slow right on the beat, then fast again: the speed
      // ramps used in velocity edits, on the music's beat (or a steady grid).
      const fast = p.fast ?? 2, slow = p.slow ?? 0.4, win = p.window ?? 0.5, every = p.every ?? 1
      const ramp = Math.min(0.08, win / 4)
      let beats = (e.beats ?? []).filter(b => b > 0.4 && b < D - 0.3)
      if (beats.length >= 2 && (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1) < 0.45) beats = beats.filter((_, i) => i % 2 === 0)
      if (!beats.length) beats = Array.from({ length: Math.max(1, Math.floor((D - 0.6) / every)) }, (_, i) => r3(0.6 + i * every)).filter(b => b < D - 0.3)
      const pieces: Array<{ start: number; end: number; speed: number }> = []
      let t = 0
      for (const b of beats) {
        const a = Math.max(t, b - win * 0.35), z = Math.min(D, b + win * 0.65)
        if (z - a < 0.15) continue
        if (a - ramp > t) pieces.push({ start: t, end: a - ramp, speed: fast })
        if (a - ramp >= t) pieces.push({ start: Math.max(t, a - ramp), end: a, speed: (fast + slow) / 2 })
        pieces.push({ start: a, end: z, speed: slow })
        t = z
        if (t + ramp < D) { pieces.push({ start: t, end: t + ramp, speed: (fast + slow) / 2 }); t += ramp }
      }
      if (t < D - 0.02) pieces.push({ start: t, end: D, speed: fast })
      const s2 = speedSegments(D, pieces, fps)
      await renderSegments(e, s2.segs, audio)
      return { durationSec: s2.duration, timeMap: s2.map, note: `${beats.length} slow-motion hits at ${slow}x, ${fast}x between${e.beats?.length ? ', on the music\'s beat' : ''}.` }
    }
    case 'snap_zoom': {
      // Two instant punch-ins on her reaction, then back to the full frame.
      const a = clampTime(e.payoff, D)
      const g = p.gap ?? 0.25, hold = p.hold ?? 1, z1 = p.zoom1 ?? 1.3, z2 = p.zoom2 ?? 1.65
      const b = Math.min(D, a + g), c = Math.min(D, b + hold)
      const segs: Seg[] = [{ start: 0, end: a }, { start: a, end: b, vf: holdZoom(e, z1) }]
      if (c > b + 0.02) segs.push({ start: b, end: c, vf: holdZoom(e, z2) })
      if (c < D - 0.02) segs.push({ start: c, end: D })
      await renderSegments(e, segs, audio)
      return { durationSec: D, timeMap: id(), note: `Snaps to ${z1}x at ${r3(a)} s, then ${z2}x for ${r3(c - b)} s.` }
    }
    case 'glitch': {
      // A burst of RGB split, sideways jumps and noise on the hit (the first
      // cut, or the payoff). Each 2-frame slice has its own offsets; every
      // frame is still one picture, never two blended.
      const at = firstCut ?? clampTime(e.payoff, D)
      const S = Math.min(p.seconds ?? 0.35, D - 0.1)
      const amp = Math.round((p.shift ?? 16) * (e.canvas.width / 1080))
      const slice = 2 / fps
      const from = Math.max(0, at - S / 2), to = Math.min(D, from + S)
      const segs: Seg[] = []
      if (from > 0.01) segs.push({ start: 0, end: from })
      const { width: W, height: H } = e.canvas
      const big = (x: number) => Math.round(x * 1.06 / 2) * 2
      for (let k = 0, t0 = from; t0 < to - 1e-3; k++, t0 += slice) {
        const t1 = Math.min(to, t0 + slice)
        const sx = Math.round((jitter(k, 1) - 0.5) * 2 * amp), dx = Math.round((jitter(k, 2) - 0.5) * 2 * amp * 1.5)
        const vf = `rgbashift=rh=${sx}:bh=${-sx}:gv=${Math.round(sx / 3)},scale=${big(W)}:${big(H)},crop=${W}:${H}:${Math.round((big(W) - W) / 2 + dx)}:${Math.round((big(H) - H) / 2)},noise=alls=${Math.round(14 + jitter(k, 3) * 20)}:allf=t`
        segs.push({ start: t0, end: t1, vf })
      }
      if (to < D - 0.01) segs.push({ start: to, end: D })
      await renderSegments(e, segs, audio)
      return { durationSec: D, timeMap: id(), note: `Glitch for ${r3(to - from)} s at ${r3(at)} s${firstCut != null ? ' (the cut)' : ''}.` }
    }
    case 'spin': {
      // Shot A spins away while it zooms in; shot B spins in from the other
      // side and settles. The zoom always covers the corners, so no black
      // shows; a hard cut joins them inside the motion blur.
      const c = needCut('The zoom-rotate spin')
      const S = Math.max(3 / fps, Math.min(p.seconds ?? 0.3, c - 0.1, D - c - 0.1))
      const ang = ((p.angle ?? 90) * Math.PI) / 180
      const Z = p.zoom ?? 1.4
      const { width: W, height: H } = e.canvas
      const k = (H / W).toFixed(4)
      const pre = 2.2
      const big = (x: number) => Math.round(x * pre / 2) * 2
      const side = (dir: 'out' | 'in') => {
        const u = `min(1,max(0,t/${r3(S)}))`
        const th = dir === 'out' ? `${ang.toFixed(4)}*pow(${u},2)` : `-${ang.toFixed(4)}*pow(1-${u},2)`
        const ui = `min(1,max(0,it/${r3(S)}))`
        const thi = dir === 'out' ? `${ang.toFixed(4)}*pow(${ui},2)` : `-${ang.toFixed(4)}*pow(1-${ui},2)`
        const zz = dir === 'out' ? `1+${(Z - 1).toFixed(3)}*pow(${ui},2)` : `1+${(Z - 1).toFixed(3)}*pow(1-${ui},2)`
        const cover = `abs(cos(${thi}))+${k}*abs(sin(${thi}))`
        return `scale=${big(W)}:${big(H)},rotate=a='${th}':ow=iw:oh=ih:c=black,zoompan=z='max(${zz},${cover})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x${H}:fps=${fps},tmix=frames=3`
      }
      await renderSegments(e, [{ start: 0, end: c - S }, { start: c - S, end: c, vf: side('out') }, { start: c, end: c + S, vf: side('in') }, { start: c + S, end: D }], audio)
      return { durationSec: D, timeMap: id(), note: `Spin of ${p.angle ?? 90} degrees over ${r3(S)} s on each side of the cut at ${r3(c)} s.` }
    }
    case 'record_scratch': {
      // The record-scratch freeze: the frame stops, the color drains and a
      // slow push-in starts; a scratch sound plays (made by code) and the
      // caption says "you're probably wondering how I got here".
      const F = p.seconds ?? 2
      const a = clampTime(e.payoff, D)
      const frames = Math.max(1, Math.round(F * fps))
      const push = `zoompan=z='1+${((p.zoom ?? 1.08) - 1).toFixed(3)}*on/${frames}':x='iw/2-iw/zoom/2':y='ih*${(e.face ?? DEFAULT_FACE).y.toFixed(3)}-ih/zoom*${(e.face ?? DEFAULT_FACE).y.toFixed(3)}':d=1:s=${e.canvas.width}x${e.canvas.height}:fps=${fps}`
      await renderSegments(e, [{ start: 0, end: a }, { start: a, freeze: F, vf: `hue=s=${(p.color ?? 0.25).toFixed(2)},eq=contrast=1.06,${push},vignette=PI/5` }, { start: a, end: D }], audio)
      const held = frames / fps
      return { durationSec: D + held, timeMap: [[0, 0], [a, a], [a, a + held], [D, D + held]], note: `Frozen at ${r3(a)} s for ${r3(held)} s with a record scratch.`, accents: [{ kind: 'scratch', at: a }] }
    }
    case 'dolly_zoom': {
      // The vertigo shot: she stays the same size while the room behind her
      // pushes in. Her outline lifts her off the picture; the room behind
      // her is filled with a blur of itself first, so the bigger room never
      // shows a second copy of her.
      const a = clampTime(e.payoff, D)
      const S = Math.min(p.seconds ?? 1.5, D - a)
      const Z = p.zoom ?? 1.4
      const { width: W, height: H } = e.canvas
      const fy = (e.face ?? DEFAULT_FACE).y.toFixed(3)
      const dolly = (v: string, m: string, out: string, k: number) => [
        `${v}split=3[d0${k}][d1${k}][d2${k}]`,
        `${m}split=2[m0${k}][m1${k}]`,
        `[d1${k}]boxblur=${Math.round(W / 40)}:2[bl${k}]`,
        `[m0${k}]lut=y='if(gt(val,16),255,0)',gblur=sigma=${Math.round(W / 60)},lut=y='if(gt(val,8),255,0)',format=gray[md${k}]`,
        `[bl${k}][md${k}]alphamerge[blp${k}]`,
        `[d0${k}][blp${k}]overlay=format=auto[cl${k}]`,
        `[cl${k}]zoompan=z='1+${(Z - 1).toFixed(3)}*(0.5-0.5*cos(PI*min(1,it/${r3(S)})))':x='iw/2-iw/zoom/2':y='ih*${fy}-ih/zoom*${fy}':d=1:s=${W}x${H}:fps=${fps}[bg${k}]`,
        `[d2${k}][m1${k}]alphamerge[pp${k}]`,
        `[bg${k}][pp${k}]overlay=format=auto${out}`,
      ]
      const segs: Seg[] = [{ start: 0, end: a }, { start: a, end: a + S, withMask: dolly }]
      if (a + S < D - 0.02) segs.push({ start: a + S, end: D })
      await renderSegments(e, segs.filter(x => x.end! - x.start! > 0.01), audio)
      return { durationSec: D, timeMap: id(), note: `Dolly zoom from ${r3(a)} s for ${r3(S)} s: the room pushes to ${Z}x behind her.` }
    }
    case 'split_screen': {
      // Two clips at once: shot A and shot B stacked (or side by side), the
      // shorter one holding its last frame. Their own sounds are mixed.
      const c = needCut('Split screen')
      const { width: W, height: H } = e.canvas
      const gap = Math.round((p.gap ?? 8) * (W / 1080) / 2) * 2
      const side = e.variant === 'side'
      const cw = side ? Math.round((W - gap) / 4) * 2 : W, ch = side ? H : Math.round((H - gap) / 4) * 2
      const la = c, lb = D - c, out = Math.max(la, lb)
      const cover = `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},setsar=1`
      const f = [
        `[0:v]split=2[x][y]`,
        `[x]trim=start=0:end=${r3(c)},setpts=PTS-STARTPTS,${cover},tpad=stop_mode=clone:stop_duration=${r3(out - la + 0.05)}[a]`,
        `[y]trim=start=${r3(c)}:end=${r3(D)},setpts=PTS-STARTPTS,${cover},tpad=stop_mode=clone:stop_duration=${r3(out - lb + 0.05)}[b]`,
        `color=c=white:s=${W}x${H}:r=${fps}:d=${r3(out)}[bg]`,
        `[bg][a]overlay=0:0:shortest=1[ab]`,
        `[ab][b]overlay=${side ? `${cw + gap}:0` : `0:${ch + gap}`}:shortest=1,trim=duration=${r3(out)},format=yuv420p[v]`,
      ]
      if (audio) f.push(`[0:a]asplit=2[p][q]`, `[p]atrim=0:${r3(c)},asetpts=PTS-STARTPTS[pa]`, `[q]atrim=${r3(c)}:${r3(D)},asetpts=PTS-STARTPTS[qa]`, `[pa][qa]amix=inputs=2:normalize=0:duration=longest,atrim=0:${r3(out)}[a]`)
      await ffmpeg(['-i', e.video, '-filter_complex', f.join(';'), '-map', '[v]', ...(audio ? ['-map', '[a]'] : []), ...workArgs(fps, audio), e.out], 900_000)
      return { durationSec: out, timeMap: [[0, 0], [c, Math.min(c, out)], [D, out]], note: `Shot A and shot B ${side ? 'side by side' : 'stacked'} for ${r3(out)} s.` }
    }
    case 'green_screen': {
      // Her clip over a background (a screen recording, a screenshot, a
      // post): her outline lifts her off her own room, smaller, at the
      // bottom, the way TikTok's green screen effect looks.
      if (!e.background) throw new MediaError('The green screen needs a background: pick B-roll or a screenshot.')
      if (!e.mask) throw new MediaError('The green screen needs her outline (the person mask).')
      const { width: W, height: H } = e.canvas
      const sc = p.scale ?? 0.72
      const pw = Math.round(W * sc / 2) * 2, ph = Math.round(H * sc / 2) * 2
      const still = /\.(png|jpe?g|webp)$/i.test(e.background)
      const f = [
        `[2:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},trim=duration=${r3(D)},setpts=PTS-STARTPTS[bg]`,
        `[1:v]format=gray,scale=${W}:${H}[m]`,
        `[0:v]setsar=1,format=yuv420p[pv]`,
        `[pv][m]alphamerge,scale=${pw}:${ph}[me]`,
        `[bg][me]overlay=x=${(W - pw) / 2}:y=${H - ph}:format=auto:shortest=1,format=yuv420p[v]`,
      ]
      await ffmpeg(['-i', e.video, '-i', e.mask, ...(still ? ['-loop', '1', '-t', String(r3(D + 0.1)), '-i', e.background] : ['-stream_loop', '-1', '-i', e.background]), '-filter_complex', f.join(';'), '-map', '[v]', ...(audio ? ['-map', '0:a'] : []), ...workArgs(fps, audio), '-t', String(r3(D)), e.out], 900_000)
      return { durationSec: D, timeMap: id(), note: `She sits over the background at ${Math.round(sc * 100)}% size.` }
    }
  }
}

// Text behind subject: the captions go between the picture and her. Her
// outline (the mask) is laid back on top, so the words sit behind her and
// in front of the room.
export async function overlayBehind(o: { video: string; mask: string; out: string; canvas: Canvas; captions: Array<{ png: string; start: number; end: number | null }> }): Promise<void> {
  const { width: W, height: H, fps } = o.canvas
  const pr = await probeFile(o.video)
  const D = pr.durationSec ?? 0
  const f = [`[0:v]setsar=1,format=yuv420p,split=2[base][pv]`, `[1:v]format=gray,scale=${W}:${H}[m]`, `[pv][m]alphamerge[her]`]
  let last = '[base]'
  o.captions.forEach((c, i) => {
    const end = c.end ?? D
    f.push(`${last}[${i + 2}:v]overlay=0:0:enable='between(t,${r3(c.start)},${r3(end)})'[t${i}]`)
    last = `[t${i}]`
  })
  f.push(`${last}[her]overlay=0:0:format=auto,format=yuv420p[v]`)
  await ffmpeg(['-i', o.video, '-i', o.mask, ...o.captions.flatMap(c => ['-loop', '1', '-t', String(r3(D + 0.1)), '-i', c.png]), '-filter_complex', f.join(';'), '-map', '[v]', ...(pr.hasAudio ? ['-map', '0:a'] : []), ...workArgs(fps, pr.hasAudio), '-t', String(r3(D)), o.out], 900_000)
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
