import { ffmpeg } from './ffmpeg.js'

// Synthetic clips for tests: real encoded video, no fixtures needed.
export interface ClipSpec {
  width: number
  height: number
  fps: number
  durationSec: number
  source?: string // lavfi source name, default testsrc2
  vf?: string
  audio?: boolean
}

export async function makeClip(out: string, s: ClipSpec): Promise<void> {
  const src = `${s.source ?? 'testsrc2'}=size=${s.width}x${s.height}:rate=${s.fps}:duration=${s.durationSec}`
  const args = ['-f', 'lavfi', '-i', src]
  if (s.audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${s.durationSec}`)
  if (s.vf) args.push('-vf', s.vf)
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', String(s.fps))
  if (s.audio) args.push('-c:a', 'aac', '-shortest')
  args.push(out)
  await ffmpeg(args)
}

export async function makeTone(out: string, frequency: number, durationSec: number): Promise<void> {
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${durationSec}`, out])
}
