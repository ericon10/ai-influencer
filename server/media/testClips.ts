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

// A drawn person (head, hair, shoulders) swaying a little in a warm room,
// for tests that need her outline. The person model finds this figure.
export async function makeFigureClip(out: string, o: { width: number; height: number; fps: number; durationSec: number; wall?: string }): Promise<void> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const sharp = (await import('sharp')).default
  const dir = await mkdtemp(join(tmpdir(), 'figure-'))
  const { width: W, height: H } = o
  const s = W / 360
  try {
    const n = Math.round(o.durationSec * o.fps)
    for (let i = 0; i < n; i++) {
      const t = i / o.fps
      const cx = W / 2 + Math.sin(t * 2) * 6 * s
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${o.wall ?? '#c9a77f'}"/><rect x="${40 * s}" y="${70 * s}" width="${110 * s}" height="${160 * s}" fill="#fff6dd" opacity="0.5"/>`
        + `<ellipse cx="${cx}" cy="${H - 80 * s}" rx="${150 * s}" ry="${130 * s}" fill="#3f5b7a"/><rect x="${cx - 26 * s}" y="${H * 0.56}" width="${52 * s}" height="${80 * s}" fill="#d9a07f"/>`
        + `<ellipse cx="${cx}" cy="${H * 0.46}" rx="${78 * s}" ry="${96 * s}" fill="#5a3420"/><ellipse cx="${cx}" cy="${H * 0.47}" rx="${62 * s}" ry="${80 * s}" fill="#e7b291"/></svg>`
      await sharp(Buffer.from(svg)).png().toFile(join(dir, `${String(i).padStart(4, '0')}.png`))
    }
    await ffmpeg(['-framerate', String(o.fps), '-i', join(dir, '%04d.png'), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out])
  } finally { await rm(dir, { recursive: true, force: true }) }
}
