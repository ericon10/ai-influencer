import sharp from 'sharp'
import { ffmpeg, MediaError, probeFile } from './ffmpeg.js'

// Meme videos (owner, 2026-10-13): a kept clip, an optional B-roll clip cut
// in hard (never a crossfade), and the caption overlay on top for the whole
// video. 9:16, no music. Silent unless the clip carries sound the owner
// chose to keep (a clone with "Keep original sound"); the B-roll part is
// then silent. B-roll uploads are converted first to a lean copy, so
// renders stay quick.

export interface Canvas { width: number; height: number; fps: number }

// Social export: H.264, BT.709, TV range, constant frame rate, fast start.
export function socialArgs(fps: number, sound = false): string[] {
  return [
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(fps), '-fps_mode', 'cfr', '-movflags', '+faststart',
    ...(sound ? ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']),
  ]
}

// One input made 9:16: a portrait clip fills the frame (center crop); a
// landscape one (a laptop screen recording) is fitted over a blurred copy of
// itself, so nothing on the screen is cut off.
export function fitFilter(input: string, label: string, c: Canvas, landscape: boolean, extra = ''): string {
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
  // Keep the clip's own sound, when it has one (off unless asked).
  keepSound?: boolean
}

export async function renderMeme(m: MemeInput): Promise<{ durationSec: number }> {
  const c = m.canvas
  if (c.width % 2 || c.height % 2) throw new MediaError('The frame size must be even.')
  const clip = await probeFile(m.clip)
  if (!clip.hasVideo) throw new MediaError('The clip has no video.')
  const isLandscape = (p: { width?: number; height?: number }) => (p.width ?? 0) > (p.height ?? 0)
  const args: string[] = ['-i', m.clip]
  const filters: string[] = [fitFilter('0:v', 'c', c, isLandscape(clip), `,trim=duration=${m.maxClipSeconds},setpts=PTS-STARTPTS`)]
  // The clip's sound, padded or cut to exactly the clip's length so a cut
  // to B-roll stays in sync.
  const sound = !!m.keepSound && clip.hasAudio
  const clipLen = Math.min(clip.durationSec ?? m.maxClipSeconds, m.maxClipSeconds)
  if (sound) filters.push(`[0:a]atrim=duration=${clipLen},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${clipLen}[ca]`)
  let chain = '[c]'
  if (m.broll) {
    const b = await probeFile(m.broll.path)
    if (!b.hasVideo) throw new MediaError('The B-roll clip has no video.')
    const start = Math.max(0, m.broll.startSec)
    args.push('-ss', String(start), '-t', String(Math.max(0.5, m.broll.seconds)), '-i', m.broll.path)
    filters.push(fitFilter('1:v', 'b', c, isLandscape(b), ',setpts=PTS-STARTPTS'))
    if (sound) {
      // The B-roll part is silent: silence for exactly its length.
      const brollLen = Math.max(0.5, Math.min(m.broll.seconds, (b.durationSec ?? m.broll.seconds) - start))
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${brollLen}[ba]`)
      chain = m.order === 'broll_first' ? '[b][ba][c][ca]' : '[c][ca][b][ba]'
      filters.push(`${chain}concat=n=2:v=1:a=1[v][a]`)
    } else {
      chain = m.order === 'broll_first' ? '[b][c]' : '[c][b]'
      filters.push(`${chain}concat=n=2:v=1:a=0[v]`)
    }
  } else {
    filters.push('[c]null[v]')
    if (sound) filters.push('[ca]anull[a]')
  }
  const captionIndex = m.broll ? 2 : 1
  args.push('-loop', '1', '-framerate', String(c.fps), '-i', m.caption)
  filters.push(`[v][${captionIndex}:v]overlay=0:0:shortest=1:format=auto,format=yuv420p[out]`)
  await ffmpeg([...args, '-filter_complex', filters.join(';'), '-map', '[out]', ...(sound ? ['-map', '[a]'] : []), ...socialArgs(c.fps, sound), m.out], 600_000)
  const done = await probeFile(m.out)
  return { durationSec: done.durationSec ?? 0 }
}

// A B-roll upload made lean: at most 1920 px on the long side, 30 fps,
// H.264, no sound, cut at the length limit.
export async function transcodeBroll(input: string, out: string, o: { maxSeconds: number; fps: number; stillSeconds?: number }): Promise<{ still: boolean }> {
  // A screenshot or a saved post (an image) becomes a still B-roll clip,
  // for the green screen's background or a cut-in.
  const img = await sharp(input).metadata().catch(() => null)
  if (img?.width && img.height && (img.pages ?? 1) === 1 && img.format !== 'gif') {
    await ffmpeg([
      '-loop', '1', '-t', String(o.stillSeconds ?? 8), '-i', input,
      '-vf', `scale=w='min(iw,1920)':h='min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,fps=${o.fps},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-tune', 'stillimage', '-movflags', '+faststart', '-an', out,
    ], 600_000)
    return { still: true }
  }
  const p = await probeFile(input)
  if (!p.hasVideo) throw new MediaError('That file has no video.')
  await ffmpeg([
    '-i', input, '-t', String(o.maxSeconds),
    // Only ever smaller: a 720p recording stays 720p.
    '-vf', `scale=w='min(iw,1920)':h='min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,fps=${o.fps},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out,
  ], 600_000)
  return { still: false }
}

// A clone's source clip (Clone Video): made lean like B-roll, but its sound
// is kept as AAC so "Keep original sound" can put it back on the result. At
// most 1920 px on the long side and 30 fps, cut at the length limit.
export async function transcodeSource(input: string, out: string, o: { maxSeconds: number }): Promise<{ hasAudio: boolean }> {
  const p = await probeFile(input)
  if (!p.hasVideo) throw new MediaError('That file has no video.')
  await ffmpeg([
    '-i', input, '-t', String(o.maxSeconds), '-map', '0:v:0', ...(p.hasAudio ? ['-map', '0:a:0'] : []),
    '-vf', "scale=w='min(iw,1920)':h='min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,format=yuv420p",
    '-fpsmax', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    ...(p.hasAudio ? ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']), '-movflags', '+faststart', out,
  ], 600_000)
  return { hasAudio: p.hasAudio }
}
