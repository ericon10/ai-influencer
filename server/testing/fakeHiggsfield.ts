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
  // The answer seen live on 2026-10-13: a failed submission carrying a
  // preset_recommendation. 'always' recommends again after a decline.
  presetRecommend: 'once' | 'always' | null
  // Live Higgsfield flags a preset recommendation as a tool error (isError).
  presetAsError: boolean
  sse: boolean
  hangOn: string | null
  refuseRefresh: boolean
  sessions: number
  // The account's spends, newest last (the `transactions` tool). Each
  // submitted job spends its price times `chargeFactor` at `now()`.
  spends: Array<{ display_name: string; credits: number; action: string; created_at: string }>
  chargeFactor: number
  now(): Date
  tool(name: string): Array<{ tool: string; args: Json; token: string }>
}

const DISPLAY: Record<string, string> = { nano_banana_2_1: 'Nano Banana 2.1', gpt_image_2_5: 'GPT Image 2.5', seedance_2_5: 'Seedance 2.5', kling3_0: 'Kling 3.0', hf_mult_motion_control: 'Higgsfield Genjutsu - Motion Transfer' }

const COST: Record<string, (p: Json) => number> = {
  nano_banana_2_1: () => 1.5,
  // Flare's real plan charges (2026-10-14): 1 credit at medium, 2.75 at high.
  gpt_image_2_5: p => (p.variant === 'flare' ? (p.quality === 'high' ? 2.75 : 1) : 3),
  seedance_2_5: p => 7 * (p.duration ?? 5),
  kling3_0: p => (p.mode === 'pro' ? 1.5 : 1) * (p.duration ?? 5),
  hf_mult_motion_control: p => 7 * (p.duration ?? 10),
}

function sseBody(obj: unknown): string {
  return `event: message\ndata: ${JSON.stringify(obj)}\n\n`
}

export function createFakeHiggsfield(): FakeHiggsfield {
  let tokenN = 1
  const f: FakeHiggsfield = {
    calls: [], tokenRequests: [], registrations: [], uploads: new Map(), jobs: new Map(),
    validTokens: new Set(['at-1']),
    presetNoticeOnce: false, presetRecommend: null, presetAsError: true, sse: false, hangOn: null, refuseRefresh: false, sessions: 0,
    spends: [], chargeFactor: 1, now: () => new Date(),
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
          if (f.presetRecommend && (f.presetRecommend === 'always' || !p.declined_preset_id)) {
            const preset_id = p.declined_preset_id ? 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' : '24bae836-2c4a-48e0-89b6-49fcc0b21612'
            return answer({
              jobs: [{ index: 0, status: 'submission_failed', error: 'Preset "IN THE DARK" was recommended instead of submitting a job.', preset_recommendation: { preset_id, name: 'IN THE DARK', preview_url: 'https://cdn.higgsfield.ai/job_set_chain_preset/x.mp4' } }],
              submitted_count: 0, failed_count: 1,
            }, f.presetAsError)
          }
          if (f.presetNoticeOnce && !p.declined_preset_id) {
            f.presetNoticeOnce = false
            return answer('A matching preset was found. To generate without it, call again with declined_preset_id: 11111111-2222-4333-8444-555555555555')
          }
          const type = tool.startsWith('generate_video') ? 'video' : tool.startsWith('generate_audio') ? 'audio' : 'image'
          f.spends.push({ display_name: DISPLAY[p.model] ?? String(p.model), credits: -((COST[p.model] ?? (() => 2))(p) * f.chargeFactor), action: 'spend', created_at: f.now().toISOString() })
          return answer({ jobs: [{ index: 0, job_id: newJob(type), status: 'queued' }] })
        }
        case 'upscale_image':
          return answer({ job_id: newJob('image'), status: 'queued' })
        case 'upscale_video':
          return answer({ job_id: newJob('video'), status: 'queued' })
        case 'motion_control':
          return answer({ job_id: newJob('video'), status: 'queued' })
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
        case 'transactions':
          return answer({ items: [...f.spends].reverse().slice(0, Number(args.size ?? 10)), next_cursor: null })
        default:
          return answer(`Unknown tool ${tool}`, true)
      }
    },
  }
  return f
}
