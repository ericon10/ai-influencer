import { copyFile, stat } from 'node:fs/promises'
import { ffmpeg, ffprobe, probeFile } from './ffmpeg.js'
import { videoKbps } from '../core/exportPresets.js'

// The export preset's bitrate cap (long run part 4): a video over the cap
// is encoded again at the cap; one under it is copied as it is.
export async function capBitrate(input: string, out: string, kbps: number): Promise<{ capped: boolean; kbps: number | null }> {
  const { stdout } = await ffprobe(['-select_streams', 'v:0', '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', input])
  const p = await probeFile(input)
  const have = videoKbps(Number(stdout.trim()) || null, (await stat(input)).size, p.durationSec ?? 0)
  if (have == null || have <= kbps * 1.05) { await copyFile(input, out); return { capped: false, kbps: have } }
  await ffmpeg(['-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], 600_000)
  return { capped: true, kbps }
}
