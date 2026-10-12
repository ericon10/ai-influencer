import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Thin, safe wrappers around the ffmpeg and ffprobe binaries. Arguments are
// always passed as arrays (never through a shell), so file names cannot
// inject commands.

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

export class MediaError extends Error {
  constructor(message: string, readonly stderr = '') {
    super(message)
    this.name = 'MediaError'
  }
}

function run(bin: string, args: string[], timeoutMs = 300_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new MediaError(`${bin} timed out`, stderr)) }, timeoutMs)
    p.stdout.on('data', d => { stdout += d })
    p.stderr.on('data', d => { stderr += d; if (stderr.length > 200_000) stderr = stderr.slice(-100_000) })
    p.on('error', e => { clearTimeout(timer); reject(new MediaError(`${bin} could not start: ${e.message}`)) })
    p.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new MediaError(`${bin} exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`, stderr))
    })
  })
}

export const ffmpeg = (args: string[], timeoutMs?: number) =>
  run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], timeoutMs)

// For filters that report on stderr (ssim, signalstats), keep info-level logs.
export const ffmpegVerbose = (args: string[], timeoutMs?: number) =>
  run(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], timeoutMs)

export const ffprobe = (args: string[]) => run(FFPROBE, ['-v', 'error', ...args])

export interface ProbeResult {
  durationSec?: number
  width?: number
  height?: number
  fps?: number
  frameCount?: number
  pixFmt?: string
  colorRange?: string
  videoCodec?: string
  audioCodec?: string
  hasVideo: boolean
  hasAudio: boolean
}

function parseRate(rate?: string): number | undefined {
  if (!rate) return undefined
  const [n, d] = rate.split('/').map(Number)
  if (!n || !d) return undefined
  return n / d
}

export async function probeFile(path: string): Promise<ProbeResult> {
  const { stdout } = await ffprobe(['-print_format', 'json', '-show_streams', '-show_format', path])
  const info = JSON.parse(stdout) as {
    streams: Array<Record<string, string | number | undefined>>
    format?: { duration?: string }
  }
  const v = info.streams.find(s => s.codec_type === 'video')
  const a = info.streams.find(s => s.codec_type === 'audio')
  const duration = Number(info.format?.duration ?? v?.duration ?? a?.duration)
  return {
    durationSec: Number.isFinite(duration) ? duration : undefined,
    width: v ? Number(v.width) : undefined,
    height: v ? Number(v.height) : undefined,
    fps: parseRate(v?.avg_frame_rate as string) ?? parseRate(v?.r_frame_rate as string),
    frameCount: v?.nb_frames ? Number(v.nb_frames) : undefined,
    pixFmt: v?.pix_fmt as string | undefined,
    colorRange: v?.color_range as string | undefined,
    videoCodec: v?.codec_name as string | undefined,
    audioCodec: a?.codec_name as string | undefined,
    hasVideo: !!v,
    hasAudio: !!a,
  }
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'studio-media-'))
  try { return await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

export async function probeMedia(input: Buffer | string): Promise<ProbeResult> {
  if (typeof input === 'string') return probeFile(input)
  return withTempDir(async dir => {
    const p = join(dir, 'probe.bin')
    await writeFile(p, input)
    return probeFile(p)
  })
}
