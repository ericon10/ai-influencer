import { ffmpeg, MediaError, probeFile } from './ffmpeg.js'

// Meme videos (owner, 2026-10-13): a kept clip, an optional B-roll clip cut
// in hard (never a crossfade), and the caption overlay on top for the whole
// video. 9:16, no sound, no music. B-roll uploads are converted first to a
// lean copy, so renders stay quick.

export interface Canvas { width: number; height: number; fps: number }

// Social export: H.264, BT.709, TV range, constant frame rate, fast start.
function socialArgs(fps: number): string[] {
  return [
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(fps), '-fps_mode', 'cfr', '-movflags', '+faststart', '-an',
  ]
}

// One input made 9:16: a portrait clip fills the frame (center crop); a
// landscape one (a laptop screen recording) is fitted over a blurred copy of
// itself, so nothing on the screen is cut off.
function fitFilter(input: string, label: string, c: Canvas, landscape: boolean, extra = ''): string {
  const tail = `setsar=1,fps=${c.fps},format=yuv420p${extra}`
  if (!landscape) return `[${input}]scale=${c.width}:${c.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${c.width}:${c.height},${tail}[${label}]`
  return [
    `[${input}]split[${label}a][${label}b]`,
    `[${label}a]scale=${c.width}:${c.height}:force_original_aspect_ratio=increase,crop=${c.width}:${c.height},boxblur=24:2,eq=brightness=-0.06[${label}bg]`,
    `[${label}b]scale=${c.width}:${c.height}:force_original_aspect_ratio=decrease:flags=lanczos[${label}fg]`,
    `[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2,${tail}[${label}]`,
  ].join(';')
}

export interface MemeInput {
  clip: string
  broll?: { path: string; startSec: number; seconds: number } | null
  order: 'clip_first' | 'broll_first'
  caption: string // a transparent PNG the size of the frame
  out: string
  canvas: Canvas
  maxClipSeconds: number
}

export async function renderMeme(m: MemeInput): Promise<{ durationSec: number }> {
  const c = m.canvas
  if (c.width % 2 || c.height % 2) throw new MediaError('The frame size must be even.')
  const clip = await probeFile(m.clip)
  if (!clip.hasVideo) throw new MediaError('The clip has no video.')
  const isLandscape = (p: { width?: number; height?: number }) => (p.width ?? 0) > (p.height ?? 0)
  const args: string[] = ['-i', m.clip]
  const filters: string[] = [fitFilter('0:v', 'c', c, isLandscape(clip), `,trim=duration=${m.maxClipSeconds},setpts=PTS-STARTPTS`)]
  let chain = '[c]'
  if (m.broll) {
    const b = await probeFile(m.broll.path)
    if (!b.hasVideo) throw new MediaError('The B-roll clip has no video.')
    args.push('-ss', String(Math.max(0, m.broll.startSec)), '-t', String(Math.max(0.5, m.broll.seconds)), '-i', m.broll.path)
    filters.push(fitFilter('1:v', 'b', c, isLandscape(b), ',setpts=PTS-STARTPTS'))
    chain = m.order === 'broll_first' ? '[b][c]' : '[c][b]'
    filters.push(`${chain}concat=n=2:v=1:a=0[v]`)
  } else {
    filters.push('[c]null[v]')
  }
  const captionIndex = m.broll ? 2 : 1
  args.push('-loop', '1', '-framerate', String(c.fps), '-i', m.caption)
  filters.push(`[v][${captionIndex}:v]overlay=0:0:shortest=1:format=auto,format=yuv420p[out]`)
  await ffmpeg([...args, '-filter_complex', filters.join(';'), '-map', '[out]', ...socialArgs(c.fps), m.out], 600_000)
  const done = await probeFile(m.out)
  return { durationSec: done.durationSec ?? 0 }
}

// A B-roll upload made lean: at most 1920 px on the long side, 30 fps,
// H.264, no sound, cut at the length limit.
export async function transcodeBroll(input: string, out: string, o: { maxSeconds: number; fps: number }): Promise<void> {
  const p = await probeFile(input)
  if (!p.hasVideo) throw new MediaError('That file has no video.')
  await ffmpeg([
    '-i', input, '-t', String(o.maxSeconds),
    // Only ever smaller: a 720p recording stays 720p.
    '-vf', `scale=w='min(iw,1920)':h='min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,fps=${o.fps},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out,
  ], 600_000)
}
