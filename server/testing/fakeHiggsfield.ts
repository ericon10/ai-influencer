import { randomUUID } from 'node:crypto'

// A stand-in for the owner's Higgsfield account: the MCP endpoint, its OAuth
// endpoints, presigned uploads and result downloads, all in memory. Tests
// pass `fetch` to the registry; nothing reaches the network.

const MCP = 'https://mcp.higgsfield.ai/mcp'
const OAUTH = 'https://mcp.higgsfield.ai/oauth2'
const UPLOADS = 'https://uploads.fake-higgsfield.test/'
const CDN = 'https://d8j0ntlcm91z4.cloudfront.net/test/'

type Json = Record<string, any>

export interface FakeHiggsfield {
  fetch: typeof fetch
  calls: Array<{ tool: string; args: Json; token: string }>
  tokenRequests: URLSearchParams[]
  registrations: Json[]
  uploads: Map<string, Buffer>
  jobs: Map<string, { status: string; type: string; polls: number }>
  validTokens: Set<string>
  // Knobs
  presetNoticeOnce: boolean
  sse: boolean
  hangOn: string | null
  refuseRefresh: boolean
  sessions: number
  tool(name: string): Array<{ tool: string; args: Json; token: string }>
}

const COST: Record<string, (p: Json) => number> = {
  nano_banana_2_1: () => 1.5,
  gpt_image_2_5: () => 3,
  seedance_2_5: p => 7 * (p.duration ?? 5),
  kling3_0: p => (p.mode === 'pro' ? 1.5 : 1) * (p.duration ?? 5),
}

function sseBody(obj: unknown): string {
  return `event: message\ndata: ${JSON.stringify(obj)}\n\n`
}

export function createFakeHiggsfield(): FakeHiggsfield {
  let tokenN = 1
  const f: FakeHiggsfield = {
    calls: [], tokenRequests: [], registrations: [], uploads: new Map(), jobs: new Map(),
    validTokens: new Set(['at-1']),
    presetNoticeOnce: false, sse: false, hangOn: null, refuseRefresh: false, sessions: 0,
    tool: name => f.calls.filter(c => c.tool === name),
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } })

      if (url === `${OAUTH}/register` && method === 'POST') {
        f.registrations.push(JSON.parse(String(init?.body)))
        return json({ client_id: `client-${f.registrations.length}` }, 201)
      }
      if (url === `${OAUTH}/token` && method === 'POST') {
        const form = new URLSearchParams(String(init?.body))
        f.tokenRequests.push(form)
        if (form.get('grant_type') === 'authorization_code') {
          if (form.get('code') !== 'good-code' || !form.get('code_verifier')) return json({ error: 'invalid_grant' }, 400)
          return json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' })
        }
        if (form.get('grant_type') === 'refresh_token') {
          if (f.refuseRefresh || !form.get('refresh_token')?.startsWith('rt-')) return json({ error: 'invalid_grant' }, 400)
          tokenN += 1
          f.validTokens.add(`at-${tokenN}`)
          return json({ access_token: `at-${tokenN}`, refresh_token: `rt-${tokenN}`, expires_in: 3600 })
        }
        return json({ error: 'unsupported_grant_type' }, 400)
      }
      if (url.startsWith(UPLOADS) && method === 'PUT') {
        if (headers.get('authorization')) return new Response('no auth on presigned links', { status: 400 })
        f.uploads.set(url.slice(UPLOADS.length), Buffer.from(init!.body as Uint8Array))
        return new Response(null, { status: 200 })
      }
      if (url.startsWith(CDN) && method === 'GET') {
        const { renderPlaceholderPortrait } = await import('../providers/mock.js')
        return new Response(new Uint8Array(await renderPlaceholderPortrait('Fake Higgsfield')), { status: 200, headers: { 'content-type': 'image/png' } })
      }
      if (url !== MCP || method !== 'POST') return new Response('not found', { status: 404 })

      const token = (headers.get('authorization') ?? '').replace(/^Bearer /, '')
      if (!f.validTokens.has(token)) return new Response('{"error":"invalid_token"}', { status: 401 })
      const msg = JSON.parse(String(init?.body)) as Json
      if (msg.method === 'initialize') {
        f.sessions += 1
        return json({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } }, 200, { 'mcp-session-id': `sess-${f.sessions}` })
      }
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (!headers.get('mcp-session-id')) return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'no session' } }, 400)
      if (msg.method !== 'tools/call') return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown method' } })

      const tool = msg.params.name as string
      const args = msg.params.arguments as Json
      f.calls.push({ tool, args, token })
      if (f.hangOn === tool) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        })
      }
      const answer = (value: unknown, isError = false) => {
        const reply = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError } }
        return f.sse
          ? new Response(sseBody(reply), { status: 200, headers: { 'content-type': 'text/event-stream' } })
          : json(reply)
      }
      const newJob = (type: string) => {
        const id = randomUUID()
        f.jobs.set(id, { status: 'queued', type, polls: 0 })
        return id
      }

      switch (tool) {
        case 'generate_image': case 'generate_video': case 'generate_audio': {
          const p = args.params as Json
          if (!p.get_cost) return answer('Use the batch tools in these tests.', true)
          const credits = (COST[p.model] ?? (() => 2))(p)
          return answer({ cost: { credits, credits_exact: credits } })
        }
        case 'generate_image_batch': case 'generate_video_batch': case 'generate_audio_batch': {
          const p = (args.requests as Json[])[0]!.params as Json
          if (f.presetNoticeOnce && !p.declined_preset_id) {
            f.presetNoticeOnce = false
            return answer('A matching preset was found. To generate without it, call again with declined_preset_id: 11111111-2222-4333-8444-555555555555')
          }
          const type = tool.startsWith('generate_video') ? 'video' : tool.startsWith('generate_audio') ? 'audio' : 'image'
          return answer({ jobs: [{ index: 0, job_id: newJob(type), status: 'queued' }] })
        }
        case 'upscale_image':
          return answer({ job_id: newJob('image'), status: 'queued' })
        case 'jobs_wait': {
          const jobId = (args.jobs as Json[])[0]!.job_id as string
          const job = f.jobs.get(jobId)
          if (!job) return answer({ jobs: [{ index: 0, job_id: jobId, status: 'lookup_failed', error: 'Generation not found', retryable: false }], all_terminal: true })
          job.polls += 1
          if (job.polls >= 2) job.status = 'completed'
          const ext = job.type === 'video' ? 'mp4' : job.type === 'audio' ? 'mp3' : 'png'
          return answer({
            jobs: [{ index: 0, job_id: jobId, status: job.status, type: job.type, ...(job.status === 'completed' ? { result_url: `${CDN}${jobId}.${ext}` } : {}) }],
            all_terminal: job.status === 'completed',
          })
        }
        case 'media_upload': {
          const id = randomUUID()
          return answer({ media_id: id, upload_url: `${UPLOADS}${id}` })
        }
        case 'media_confirm':
          return answer({ media_id: args.media_id, url: `${CDN}${args.media_id}.png` })
        case 'balance':
          return answer({ credits: 1078.45, subscription_plan_type: 'ultra' })
        default:
          return answer(`Unknown tool ${tool}`, true)
      }
    },
  }
  return f
}
