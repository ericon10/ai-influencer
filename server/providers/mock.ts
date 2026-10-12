import sharp from 'sharp'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StudioConfig } from '../config/load'
import { estimateGen } from '../costs/pricebook'
import { ffmpeg } from '../media/ffmpeg'
import { newId } from '../lib/ids'
import { ProviderError, type GenRequest, type JobStatus, type ModelInfo, type Output, type ProviderAdapter } from './types'

// A free, deterministic provider for tests and demo mode. It produces real
// image and video files (so storage, probing and QA all run for real) and
// can be scripted to fail in every way a real provider fails.

export type MockScenario = 'success' | 'fail' | 'nsfw' | 'submit_error' | 'submit_timeout' | 'no_output'

export interface MockOptions {
  config: StudioConfig
  loadAsset: (assetId: string) => Promise<Buffer>
  scenario?: (req: GenRequest) => MockScenario
  // Status calls before a job reports done.
  pollsUntilDone?: number
}

interface MockJob {
  req: GenRequest
  scenario: MockScenario
  polls: number
  outputs?: Output[]
}

const TAG = /\[mock:(fail|nsfw|submit_error|submit_timeout|no_output)\]/

export function scenarioFromPrompt(req: GenRequest): MockScenario {
  const m = req.prompt.match(TAG)
  return (m?.[1] as MockScenario) ?? 'success'
}

const SIZES: Record<string, [number, number]> = {
  '3:4': [1152, 1536], '9:16': [864, 1536], '4:5': [1080, 1350], '1:1': [1200, 1200], '16:9': [1536, 864],
}

function hashHue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!))
}

export async function renderPlaceholderPortrait(prompt: string, aspect = '3:4'): Promise<Buffer> {
  const [w, h] = SIZES[aspect] ?? SIZES['3:4']!
  const hue = hashHue(prompt)
  const label = escapeXml(prompt.replace(TAG, '').slice(0, 60))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue},28%,86%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},24%,70%)"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <ellipse cx="${w / 2}" cy="${h * 0.38}" rx="${w * 0.17}" ry="${h * 0.15}" fill="hsl(${hue},18%,48%)" opacity="0.85"/>
    <path d="M ${w * 0.12} ${h} C ${w * 0.16} ${h * 0.66}, ${w * 0.84} ${h * 0.66}, ${w * 0.88} ${h} Z" fill="hsl(${hue},18%,42%)" opacity="0.85"/>
    <text x="${w / 2}" y="${h * 0.93}" font-family="sans-serif" font-size="${Math.round(w / 34)}" text-anchor="middle" fill="white" opacity="0.9">${label}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function renderFromRef(ref: Buffer, aspect: string, prompt: string): Promise<Buffer> {
  const [w, h] = SIZES[aspect] ?? SIZES['3:4']!
  const hue = hashHue(prompt)
  const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${w * 0.04}" y="${h * 0.03}" width="${w * 0.3}" height="${h * 0.045}" rx="${h * 0.02}" fill="hsl(${hue},60%,45%)" opacity="0.85"/>
    <text x="${w * 0.19}" y="${h * 0.062}" font-family="sans-serif" font-size="${Math.round(w / 40)}" text-anchor="middle" fill="white">Demo render</text></svg>`)
  return sharp(ref).resize(w, h, { fit: 'cover' }).modulate({ hue: (hue % 30) - 15, saturation: 1 })
    .composite([{ input: badge }]).png().toBuffer()
}

async function renderVideo(start: Buffer | null, seconds: number, prompt: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'mock-video-'))
  try {
    const frame = join(dir, 'start.png')
    await writeFile(frame, start ? await sharp(start).resize(480, 854, { fit: 'cover' }).png().toBuffer() : await renderPlaceholderPortrait(prompt, '9:16'))
    const out = join(dir, 'clip.mp4')
    const frames = Math.round(seconds * 24)
    // Real providers sometimes return an audio track even with audio off;
    // the mock does too, so the strip-audio step is always exercised.
    await ffmpeg([
      '-loop', '1', '-i', frame, '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
      '-vf', `scale=480:854,zoompan=z='min(zoom+0.0008,1.08)':d=${frames}:s=480x854:fps=24`,
      '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
    ])
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function createMockAdapter(opts: MockOptions): ProviderAdapter & { jobs: Map<string, MockJob>; files: Map<string, Buffer> } {
  const jobs = new Map<string, MockJob>()
  const files = new Map<string, Buffer>()
  const pick = opts.scenario ?? scenarioFromPrompt
  const pollsUntilDone = opts.pollsUntilDone ?? 1

  async function produce(id: string, job: MockJob): Promise<Output[]> {
    const { req } = job
    const aspect = req.aspect ?? '3:4'
    let data: Buffer
    let kind: Output['kind'] = 'image'
    if (req.kind === 'video' || req.kind === 'video_extend') {
      kind = 'video'
      const start = req.startFrame ? await opts.loadAsset(req.startFrame.assetId) : null
      data = await renderVideo(start, req.durationSec ?? 5, req.prompt)
    } else if (req.kind === 'upscale' && req.refs?.[0]) {
      const src = await opts.loadAsset(req.refs[0].assetId)
      const meta = await sharp(src).metadata()
      data = await sharp(src).resize((meta.width ?? 512) * 2, (meta.height ?? 512) * 2).png().toBuffer()
    } else if (req.refs?.length) {
      data = await renderFromRef(await opts.loadAsset(req.refs[0]!.assetId), aspect, req.prompt)
    } else {
      data = await renderPlaceholderPortrait(req.prompt, aspect)
    }
    const url = `mock://${id}/0`
    files.set(url, data)
    return [{ url, kind, mime: kind === 'video' ? 'video/mp4' : 'image/png' }]
  }

  return {
    id: 'mock',
    jobs,
    files,
    async listModels(): Promise<ModelInfo[]> {
      return opts.config.models.models.filter(m => m.ref.startsWith('mock/'))
        .map(m => ({ ref: m.ref, provider: 'mock', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: true }))
    },
    async estimate(req) { return estimateGen(opts.config, req) },
    async submit(req) {
      const scenario = pick(req)
      if (scenario === 'submit_error') throw new ProviderError('Mock provider rejected the request.', { retryable: false, submitted: 'no', status: 422 })
      if (scenario === 'submit_timeout') throw new ProviderError('Mock provider timed out after the request was sent.', { retryable: false, submitted: 'unknown' })
      if (req.kind === 'video' && req.audio !== false) throw new ProviderError('Video requests must send audio off.', { retryable: false, submitted: 'no' })
      const id = newId('req').replace('req_', 'mock_')
      jobs.set(id, { req, scenario, polls: 0 })
      return { jobId: id }
    },
    async status(jobId): Promise<JobStatus> {
      const job = jobs.get(jobId)
      if (!job) return { state: 'failed', error: 'Mock job not found (the mock provider forgets jobs on restart).' }
      job.polls++
      if (job.polls <= pollsUntilDone) return { state: job.polls === 1 ? 'queued' : 'running', pollAfterSec: 0 }
      if (job.scenario === 'fail') return { state: 'failed', error: 'Mock generation failed.' }
      if (job.scenario === 'nsfw') return { state: 'nsfw', error: 'Mock content filter.' }
      if (job.scenario === 'no_output') return { state: 'succeeded', outputs: [] }
      job.outputs ??= await produce(jobId, job)
      return { state: 'succeeded', outputs: job.outputs }
    },
    async result(jobId) {
      const job = jobs.get(jobId)
      if (!job) throw new ProviderError('Mock job not found.', { retryable: false, submitted: 'no' })
      job.outputs ??= await produce(jobId, job)
      return job.outputs
    },
    async cancel(jobId) { jobs.delete(jobId) },
    async download(output) {
      const f = files.get(output.url)
      if (!f) throw new ProviderError('Mock output missing.', { retryable: false, submitted: 'no' })
      return f
    },
    async verifyCredentials() { return { ok: true, message: 'Mock provider needs no key.' } },
  }
}
