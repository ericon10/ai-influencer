import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { renderPlaceholderPortrait, renderVideo } from '../providers/mock.js'

// Fake Kie.ai and WaveSpeed for the tests (UX-PLAN.md section 40): the
// calls the adapters make, answered the way each provider's docs say, with
// real image and video files as outputs (served from here, so the runner
// downloads them like any provider's). Every request is recorded. A Kie
// task whose prompt says "FAIL" fails (a WaveSpeed one "WSFAIL"), "NSFW" is
// blocked by the safety check.

export interface FakeCall { provider: 'kie' | 'wavespeed'; method: string; path: string; auth: string; body: Record<string, unknown> | null }
export interface FakeProviders {
  url: string
  calls: FakeCall[]
  // Credits on Kie (200 = $1), dollars on WaveSpeed.
  balance: { kie: number; wavespeed: number }
  // A refused key answers 401.
  goodKey: { kie: string; wavespeed: string }
  stop: () => Promise<void>
}

const body = (req: IncomingMessage) => new Promise<Buffer>((res, rej) => { const parts: Buffer[] = []; req.on('data', c => parts.push(c as Buffer)); req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej) })

export async function startFakeProviders(port = 0): Promise<FakeProviders> {
  const calls: FakeCall[] = []
  const balance = { kie: 1234.5, wavespeed: 7.25 }
  const goodKey = { kie: 'kie-test-key-1234', wavespeed: 'ws-test-key-5678' }
  const tasks = new Map<string, { video: boolean; prompt: string; polls: number }>()
  let n = 0
  let image: Buffer | null = null, video: Buffer | null = null
  const json = (res: ServerResponse, code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
  let base = ''
  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    try {
      if (u.pathname === '/files/out.png') { image ??= await renderPlaceholderPortrait('fake provider still', '9:16'); res.writeHead(200, { 'content-type': 'image/png' }); res.end(image); return }
      if (u.pathname === '/files/out.mp4') { video ??= await renderVideo(null, 2, 'fake provider take'); res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(video); return }
      const raw = (await body(req)).toString()
      const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null
      const auth = String(req.headers.authorization ?? '')
      const ws = u.pathname.startsWith('/api/v3/')
      calls.push({ provider: ws ? 'wavespeed' : 'kie', method: req.method ?? 'GET', path: `${u.pathname}${u.search}`, auth, body: parsed })
      if (!ws) {
        // Kie answers errors in the body's code, with HTTP 200.
        if (auth !== `Bearer ${goodKey.kie}`) return json(res, 200, { code: 401, msg: 'You do not have access permissions', data: null })
        if (u.pathname === '/api/v1/chat/credit') return json(res, 200, { code: 200, msg: 'success', data: balance.kie })
        if (u.pathname === '/api/v1/jobs/createTask' && req.method === 'POST') {
          const input = (parsed?.input ?? {}) as { prompt?: string }
          if (!parsed?.model) return json(res, 200, { code: 422, msg: 'model is required', data: null })
          const id = `kie${++n}`
          tasks.set(id, { video: /video|seedance|motion|animate|kling/.test(String(parsed.model)), prompt: String(input.prompt ?? ''), polls: 0 })
          return json(res, 200, { code: 200, msg: 'success', data: { taskId: id } })
        }
        if (u.pathname === '/api/v1/jobs/recordInfo') {
          const t = tasks.get(u.searchParams.get('taskId') ?? '')
          if (!t) return json(res, 200, { code: 422, msg: 'recordInfo is null', data: null })
          if (t.polls++ < 1) return json(res, 200, { code: 200, msg: 'success', data: { state: 'generating' } })
          if (/FAIL/.test(t.prompt)) return json(res, 200, { code: 200, msg: 'success', data: { state: 'fail', failCode: '500', failMsg: 'Internal error, please try again later.' } })
          if (/NSFW/.test(t.prompt)) return json(res, 200, { code: 200, msg: 'success', data: { state: 'fail', failCode: '400', failMsg: 'Your content was flagged as sensitive.' } })
          const url = `${base}/files/out.${t.video ? 'mp4' : 'png'}`
          return json(res, 200, { code: 200, msg: 'success', data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [url] }), creditsConsumed: t.video ? 18 : 6.5 } })
        }
        return json(res, 404, { code: 404, msg: 'not found' })
      }
      if (auth !== `Bearer ${goodKey.wavespeed}`) return json(res, 401, { code: 401, message: 'Invalid API key', data: null })
      if (u.pathname === '/api/v3/balance') return json(res, 200, { code: 200, message: 'success', data: { balance: balance.wavespeed } })
      const result = u.pathname.match(/^\/api\/v3\/predictions\/([^/]+)\/result$/)
      if (result) {
        const t = tasks.get(result[1]!)
        if (!t) return json(res, 404, { code: 404, message: 'Prediction result not found.', data: null })
        if (t.polls++ < 1) return json(res, 200, { code: 200, message: 'success', data: { id: result[1], status: 'processing', outputs: [] } })
        if (/WSFAIL/.test(t.prompt)) return json(res, 200, { code: 200, message: 'success', data: { id: result[1], status: 'failed', outputs: [], error: 'The model could not finish this request.' } })
        if (/NSFW/.test(t.prompt)) return json(res, 200, { code: 200, message: 'success', data: { id: result[1], status: 'failed', outputs: [], error: 'Content flagged by the safety checker (nsfw).' } })
        return json(res, 200, { code: 200, message: 'success', data: { id: result[1], status: 'completed', outputs: [`${base}/files/out.${t.video ? 'mp4' : 'png'}`], error: null } })
      }
      if (req.method === 'POST') {
        const id = `ws${++n}`
        tasks.set(id, { video: /video|seedance|kling|animate/.test(u.pathname), prompt: String(parsed?.prompt ?? ''), polls: 0 })
        return json(res, 200, { code: 200, message: 'success', data: { id, status: 'created', urls: { get: `${base}/api/v3/predictions/${id}/result` } } })
      }
      return json(res, 404, { code: 404, message: 'not found', data: null })
    } catch (e) { json(res, 500, { code: 500, msg: (e as Error).message }) }
  })
  await new Promise<void>(r => server.listen(port, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url: base, calls, balance, goodKey, stop: () => new Promise<void>(r => server.close(() => r())) }
}
