import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { StudioConfig } from '../config/load.js'
import type { BlobStore } from '../storage/blobStore.js'
import { estimateGen } from '../costs/pricebook.js'
import { ProviderError, type CostEstimate, type GenRequest, type JobStatus, type ModelInfo, type Output, type ProviderAdapter } from './types.js'

// ElevenLabs for voice lines (overnight item 4): speech to speech turns the
// owner's performed take into the character's voice, then speech to text
// times every word (for captions and karaoke). Both run in one priced
// request. ElevenLabs answers both calls directly, so submit does the work
// and keeps the results in storage under the job id; any worker process
// can then read them (status, download). Without a key (tests, local dev)
// the mock stands in: the same take, a little higher, and words spread
// over its length.
//
// Endpoints (ElevenLabs API reference):
//   POST /v1/speech-to-speech/{voice_id}  multipart: audio, model_id
//   POST /v1/speech-to-text               multipart: file, model_id, timestamps_granularity=word

const API = 'https://api.elevenlabs.io'
const STS_MODEL = 'eleven_multilingual_sts_v2'
const STT_MODEL = 'scribe_v1'

export interface Word { text: string; start: number; end: number }

export interface ElevenLabsOptions {
  config: StudioConfig
  store: BlobStore
  loadAsset: (assetId: string) => Promise<Buffer>
  apiKey?: string
  mock?: boolean
  fetchImpl?: typeof fetch
}

const cacheKey = (jobId: string, part: 'audio' | 'words') => `provider-cache/elevenlabs/${jobId}.${part === 'audio' ? 'mp3' : 'json'}`

export function createElevenLabsAdapter(o: ElevenLabsOptions): ProviderAdapter {
  const f = o.fetchImpl ?? fetch
  const headers = () => ({ 'xi-api-key': o.apiKey ?? '' })

  async function call(path: string, form: FormData): Promise<Response> {
    let res: Response
    try {
      res = await f(`${API}${path}`, { method: 'POST', headers: headers(), body: form })
    } catch (e) {
      throw new ProviderError(`ElevenLabs could not be reached: ${(e as Error).message}`, { retryable: true, submitted: 'unknown' })
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      throw new ProviderError(`ElevenLabs answered ${res.status}: ${text}`, { retryable: res.status >= 500 || res.status === 429, submitted: res.status >= 500 ? 'unknown' : 'no', status: res.status })
    }
    return res
  }

  async function convert(take: Buffer, voiceId: string): Promise<{ audio: Buffer; words: Word[] }> {
    const sts = new FormData()
    // The prepared take is a WAV; an older one may be an MP3.
    const wav = take.subarray(0, 4).toString() === 'RIFF'
    sts.append('audio', new Blob([new Uint8Array(take)], { type: wav ? 'audio/wav' : 'audio/mpeg' }), wav ? 'take.wav' : 'take.mp3')
    sts.append('model_id', STS_MODEL)
    const audio = Buffer.from(await (await call(`/v1/speech-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, sts)).arrayBuffer())
    const stt = new FormData()
    stt.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'line.mp3')
    stt.append('model_id', STT_MODEL)
    stt.append('timestamps_granularity', 'word')
    const body = await (await call('/v1/speech-to-text', stt)).json() as { words?: Array<{ text: string; start: number; end: number; type?: string }> }
    const words = (body.words ?? []).filter(w => (w.type ?? 'word') === 'word' && w.text.trim()).map(w => ({ text: w.text.trim(), start: w.start, end: w.end }))
    return { audio, words }
  }

  return {
    id: 'elevenlabs',
    async listModels(): Promise<ModelInfo[]> {
      return [{ ref: 'elevenlabs/sts-v2', provider: 'elevenlabs', label: 'ElevenLabs speech to speech (with word timings)', kinds: ['audio'], maxRefs: 1, verified: false }]
    },
    async estimate(req: GenRequest): Promise<CostEstimate> {
      return estimateGen(o.config, req)
    },
    async submit(req: GenRequest): Promise<{ jobId: string }> {
      if (req.kind !== 'audio' || !req.refs?.[0]) throw new ProviderError('A voice line needs the performed take.', { retryable: false, submitted: 'no' })
      if (!req.voiceId) throw new ProviderError('Add the character\'s ElevenLabs voice ID in the character file first.', { retryable: false, submitted: 'no' })
      const take = await o.loadAsset(req.refs[0].assetId)
      const jobId = randomUUID()
      const out = o.mock ? await mockConvert(take, req.prompt) : await convert(take, req.voiceId)
      await o.store.put(cacheKey(jobId, 'audio'), out.audio, 'audio/mpeg')
      await o.store.put(cacheKey(jobId, 'words'), Buffer.from(JSON.stringify(out.words)), 'application/json')
      return { jobId }
    },
    async status(jobId: string): Promise<JobStatus> {
      const ready = await o.store.exists(cacheKey(jobId, 'audio'))
      return ready ? { state: 'succeeded', outputs: await this.result(jobId) } : { state: 'failed', error: 'The converted line was not kept. Convert it again; a failed run is not charged.' }
    },
    async result(jobId: string): Promise<Output[]> {
      return [
        { url: `elevenlabs-cache://${jobId}/audio`, kind: 'audio', mime: 'audio/mpeg' },
        { url: `elevenlabs-cache://${jobId}/words`, kind: 'audio', mime: 'application/json' },
      ]
    },
    async download(output: Output): Promise<Buffer> {
      const m = output.url.match(/^elevenlabs-cache:\/\/([\w-]+)\/(audio|words)$/)
      if (!m) throw new ProviderError('Unknown ElevenLabs output.', { retryable: false, submitted: 'no' })
      return o.store.get(cacheKey(m[1]!, m[2] as 'audio' | 'words'))
    },
    async verifyCredentials() {
      if (o.mock) return { ok: true, message: 'The mock voice (no ElevenLabs key yet).' }
      const res = await f(`${API}/v1/user`, { headers: headers() }).catch(() => null)
      return res?.ok ? { ok: true, message: 'ElevenLabs key works.' } : { ok: false, message: `ElevenLabs refused the key${res ? ` (${res.status})` : ''}.` }
    },
  }
}

// The mock: the take a little higher (so it is audibly "converted") as MP3,
// and the line's words (the prompt carries the take's text) spread evenly
// over its length.
async function mockConvert(take: Buffer, text: string): Promise<{ audio: Buffer; words: Word[] }> {
  const audio = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-af', 'asetrate=44100*1.06,aresample=44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let err = ''
    p.stdout.on('data', d => chunks.push(d))
    p.stderr.on('data', d => { err += d })
    p.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new ProviderError(`The mock voice failed: ${err.slice(-200)}`, { retryable: false, submitted: 'no' }))))
    p.stdin.on('error', () => undefined)
    p.stdin.end(take)
  })
  const seconds = await durationOf(audio)
  const tokens = (text.trim() || 'voice line').split(/\s+/).filter(Boolean)
  const lead = Math.min(0.3, seconds * 0.05), span = Math.max(0.2, seconds - lead * 2)
  const step = span / tokens.length
  const words = tokens.map((t, i) => ({ text: t, start: Math.round((lead + i * step) * 100) / 100, end: Math.round((lead + (i + 0.85) * step) * 100) / 100 }))
  return { audio, words }
}

async function durationOf(audio: Buffer): Promise<number> {
  return new Promise(resolve => {
    const p = spawn(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', '-i', 'pipe:0'], { stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.on('close', () => resolve(Number(out.trim()) || 1))
    p.stdin.on('error', () => undefined)
    p.stdin.end(audio)
  })
}
