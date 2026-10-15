import { ffmpeg, MediaError, probeFile } from './ffmpeg.js'
import { fitFilter, type Canvas } from './meme.js'

// Every input made plain before it is cut, edited or captioned (owner,
// 2026-10-14, after a clone render failed with "Error reinitializing
// filters!"): one picture size (the canvas, 1080x1920), square pixels, one
// constant frame rate, yuv420p, and the sound as 48 kHz stereo AAC or none.
// Files from providers and phones can change size, pixel format or sound
// layout mid-stream, run at a variable frame rate, carry a rotation, or use
// odd sizes; a filter graph that mixes several inputs can then fail to
// start. Each input gets its own simple pass first, so the render only ever
// sees plain files. The fit is the renderer's own (cover for portrait, a
// blurred backdrop for landscape), so pictures look the same as before.

export const NORMALIZE_VERSION = 1

export interface Normalized {
  hasAudio: boolean
  durationSec: number
  // True when the clip's sound could not be read and was left out.
  droppedSound: boolean
}

export async function normalizeForRender(input: string, out: string, o: { canvas: Canvas; keepSound: boolean; maxSeconds?: number; videoKbps?: number }): Promise<Normalized> {
  const c = o.canvas
  if (c.width % 2 || c.height % 2) throw new MediaError('The frame size must be even.')
  const p = await probeFile(input)
  if (!p.hasVideo) throw new MediaError('That file has no video.')
  const landscape = (p.width ?? 0) > (p.height ?? 0)
  // A simple, one-input filter chain (-vf): if the file changes size or
  // format mid-stream, ffmpeg rebuilds this chain on its own, which a graph
  // that joins several inputs cannot always do.
  const vf = fitFilter('IN', 'OUT', c, landscape).replace('[IN]', '').replace(/\[OUT\]$/, '')
  const run = (withSound: boolean) => ffmpeg([
    '-fflags', '+genpts', '-i', input,
    ...(o.maxSeconds ? ['-t', String(o.maxSeconds)] : []),
    '-map', '0:v:0', '-vf', vf,
    // The sound is padded to the picture and stops with it.
    ...(withSound ? ['-map', '0:a:0', '-af', 'aresample=48000:async=1:first_pts=0,apad', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    // An export preset's bitrate cap (long run part 4), on top of the quality.
    ...(o.videoKbps ? ['-maxrate', `${o.videoKbps}k`, '-bufsize', `${o.videoKbps * 2}k`] : []),
    '-pix_fmt', 'yuv420p', '-r', String(c.fps), '-fps_mode', 'cfr',
    '-color_range', 'tv', '-movflags', '+faststart', out,
  ], 600_000)
  const wantSound = o.keepSound && p.hasAudio
  let droppedSound = false
  try {
    await run(wantSound)
  } catch (e) {
    // A sound track that cannot be read never stops the picture.
    if (!wantSound) throw e
    await run(false)
    droppedSound = true
  }
  const done = await probeFile(out)
  if (!done.hasVideo || !done.durationSec) throw new MediaError('The clip could not be prepared for the render.')
  return { hasAudio: done.hasAudio, durationSec: done.durationSec, droppedSound }
}
