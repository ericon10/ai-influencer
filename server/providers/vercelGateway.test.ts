import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { createVercelGatewayAdapter, type GatewaySdk } from './vercelGateway.js'
import type { GenRequest } from './types.js'

// Kling 3.0 Motion Control on the Vercel AI Gateway, with a fake SDK: no
// network and no spend. The start returns an opaque operation that becomes
// the job id, so a poll from any process (a restarted worker) finds the run.

const config = loadConfig()

function fakeSdk() {
  const calls: Array<{ kind: 'start' | 'status'; args: unknown }> = []
  let polls = 0
  const sdk: GatewaySdk = {
    async start(o) { calls.push({ kind: 'start', args: o }); return { operation: { jobId: 'gw_job_1', model: o.modelId } } },
    async status(o) {
      calls.push({ kind: 'status', args: o })
      polls += 1
      if (polls < 2) return { status: 'pending' }
      return { status: 'completed', videos: [{ type: 'url', url: 'https://gateway.example/v/out.mp4', mediaType: 'video/mp4' }, { type: 'base64', data: Buffer.from('fake mp4').toString('base64'), mediaType: 'video/mp4' }] }
    },
  }
  return { sdk, calls }
}

const req = (o: Partial<GenRequest> = {}): GenRequest => ({
  kind: 'video_clone', model: 'vercel/kling-3.0-motion-control', prompt: 'The person in the reference image performs the exact motion of the source video.',
  refs: [{ assetId: 'ast_still', url: 'https://r2.example/still.png' }], sourceVideo: { assetId: 'ast_clip', url: 'https://r2.example/clip.mp4' },
  durationSec: 10, audio: false, ...o,
})

describe('Kling 3.0 Motion Control on the Vercel AI Gateway', () => {
  it('starts with the still, the clip and the motion options; the operation is the job id', async () => {
    const { sdk, calls } = fakeSdk()
    const a = createVercelGatewayAdapter({ config, sdk })
    const { jobId } = await a.submit(req(), { idempotencyKey: 'job_abc' })
    expect(jobId.startsWith('gw1:')).toBe(true)
    expect(calls[0]!.args).toEqual({
      modelId: 'klingai/kling-v3.0-motion-control',
      image: 'https://r2.example/still.png',
      text: 'The person in the reference image performs the exact motion of the source video.',
      providerOptions: { klingai: { videoUrl: 'https://r2.example/clip.mp4', characterOrientation: 'video', mode: 'std', keepOriginalSound: 'no' } },
      headers: { 'idempotency-key': 'job_abc' },
    })
    // A new adapter (a restarted worker) polls the same run from the id.
    const b = createVercelGatewayAdapter({ config, sdk })
    expect((await b.status(jobId)).state).toBe('running')
    const done = await b.status(jobId)
    expect(done.state).toBe('succeeded')
    expect((calls[1]!.args as { operation: unknown }).operation).toEqual({ jobId: 'gw_job_1', model: 'klingai/kling-v3.0-motion-control' })
    expect(done.outputs![0]!.url).toBe('https://gateway.example/v/out.mp4')
    // A video sent as data is read again from the operation, never stored.
    expect((await b.download!(done.outputs![1]!)).toString()).toBe('fake mp4')
  })

  it('Pro runs in pro mode; anything but a motion copy, or a missing link, is refused before a call', async () => {
    const { sdk, calls } = fakeSdk()
    const a = createVercelGatewayAdapter({ config, sdk })
    await a.submit(req({ model: 'vercel/kling-3.0-motion-control-pro' }), { idempotencyKey: 'job_pro' })
    expect((calls[0]!.args as { providerOptions: { klingai: { mode: string } } }).providerOptions.klingai.mode).toBe('pro')
    await expect(a.submit(req({ kind: 'video' }), { idempotencyKey: 'x' })).rejects.toThrow(/only copies motion/)
    await expect(a.submit(req({ sourceVideo: { assetId: 'ast_clip' } }), { idempotencyKey: 'y' })).rejects.toThrow(/public links/)
    expect(calls).toHaveLength(1)
  })

  it('prices from the price book, marked not confirmed until a real run', async () => {
    const a = createVercelGatewayAdapter({ config, sdk: fakeSdk().sdk })
    const e = await a.estimate(req())
    expect(e.totalMicros).toBeGreaterThan(0)
    expect(e.verified).toBe(false)
  })
})
