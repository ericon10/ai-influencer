import { ffmpeg, MediaError, probeFile } from './ffmpeg'

// Shared encode settings so every clip the Studio produces can be joined
// without surprises: H.264, yuv420p, BT.709, TV (limited) range, constant fps.
export function encodeArgs(fps: number): string[] {
  return [
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(fps), '-fps_mode', 'cfr', '-movflags', '+faststart',
  ]
}

// Removes every audio stream. Generated clips are stripped even when audio
// was requested off (SPEC 5.4 rule 34).
export async function stripAudio(input: string, out: string): Promise<void> {
  await ffmpeg(['-i', input, '-map', '0:v:0', '-c:v', 'copy', '-an', out])
}

export interface NormalizeTarget {
  width: number
  height: number
  fps: number
}

// Re-encodes to one resolution, constant frame rate, pixel format and color
// range (SPEC 4.3 step 2). Near-matching aspect ratios (480x854 vs 716x1280)
// are filled and center-cropped rather than letterboxed. Audio is dropped.
export async function normalizeClip(input: string, out: string, t: NormalizeTarget): Promise<void> {
  if (t.width % 2 || t.height % 2) throw new MediaError('Target width and height must be even numbers.')
  const vf = [
    `scale=${t.width}:${t.height}:force_original_aspect_ratio=increase:flags=lanczos:in_range=auto:out_range=tv`,
    `crop=${t.width}:${t.height}`,
    'setsar=1',
    `fps=${t.fps}`,
    'format=yuv420p',
  ].join(',')
  await ffmpeg(['-i', input, '-an', '-vf', vf, ...encodeArgs(t.fps), out])
}

export interface TrimOptions {
  startSec?: number
  endSec?: number
  dropFirstFrames?: number
}

// Frame-accurate trim. dropFirstFrames removes the duplicated handoff frame
// at the start of a chained clip (SPEC 5.4 rule 33).
export async function trimClip(input: string, out: string, o: TrimOptions): Promise<void> {
  const probe = await probeFile(input)
  const fps = probe.fps ?? 30
  const parts: string[] = []
  if (o.dropFirstFrames) parts.push(`trim=start_frame=${o.dropFirstFrames}`)
  if (o.startSec != null || o.endSec != null) {
    const opts = [o.startSec != null ? `start=${o.startSec}` : '', o.endSec != null ? `end=${o.endSec}` : ''].filter(Boolean).join(':')
    parts.push(`trim=${opts}`)
  }
  parts.push('setpts=PTS-STARTPTS')
  await ffmpeg(['-i', input, '-an', '-vf', parts.join(','), ...encodeArgs(fps), out])
}

export async function clipFrames(path: string): Promise<{ frames: number; fps: number; durationSec: number }> {
  const p = await probeFile(path)
  const fps = p.fps ?? 30
  const frames = p.frameCount ?? Math.round((p.durationSec ?? 0) * fps)
  return { frames, fps, durationSec: frames / fps }
}
