import { ProviderError } from './types'

// A small client for the MCP streamable HTTP transport: JSON-RPC over POST,
// answered with JSON or an SSE stream, one session per client. A 401 (or a
// token error inside a 200 body) refreshes the sign-in once and repeats the
// call; nothing was processed in that case, so even a submit is safe to
// repeat. Only what the Higgsfield account path needs.

export interface McpClientOptions {
  url: string
  getToken(): Promise<string>
  // Returns a fresh access token, or throws a ProviderError.
  refreshToken(rejected: string): Promise<string>
  timeoutMs: number
  clientName: string
  fetchImpl?: typeof fetch
}

export interface McpClient {
  callTool(name: string, args: Record<string, unknown>, phase?: 'submit' | 'read'): Promise<unknown>
}

interface RpcReply {
  id?: number | string
  result?: { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown; isError?: boolean }
  error?: { code?: number; message?: string }
}

const TOKEN_ERROR = /invalid or expired token/i

// Reads an SSE body until the reply with this id arrives. The stream may stay
// open after it, so the read stops there instead of waiting for the close.
async function readSse(res: Response, id: number, signal: AbortSignal): Promise<RpcReply | null> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const onAbort = () => { reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', onAbort, { once: true })
  let buffer = ''
  let data: string[] = []
  let last: RpcReply | null = null
  const flush = (): RpcReply | null => {
    if (!data.length) return null
    const raw = data.join('\n')
    data = []
    try {
      const msg = JSON.parse(raw) as RpcReply
      if (msg && (msg.result !== undefined || msg.error !== undefined)) {
        last = msg
        if (msg.id === id) return msg
      }
    } catch { /* keep-alive or partial event */ }
    return null
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line === '') {
          const hit = flush()
          if (hit) { reader.cancel().catch(() => undefined); return hit }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
      }
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''))
    return flush() ?? last
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

// The tool's answer: structured content when present, else the first text
// item parsed as JSON, else the text itself.
export function unwrapToolResult(result: RpcReply['result']): unknown {
  if (!result) return null
  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent
  const text = (result.content ?? []).find(c => typeof c.text === 'string')?.text
  if (text === undefined) return result
  try { return JSON.parse(text) } catch { return text }
}

export function createMcpClient(o: McpClientOptions): McpClient {
  const doFetch = o.fetchImpl ?? fetch
  let sessionId: string | null = null
  let ready: Promise<void> | null = null
  let nextId = 1

  async function post(body: Record<string, unknown>, phase: 'submit' | 'read', token: string): Promise<{ status: number; reply: RpcReply | null; text: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), o.timeoutMs)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    }
    if (sessionId) headers['Mcp-Session-Id'] = sessionId
    try {
      let res: Response
      try {
        res = await doFetch(o.url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError'
        throw new ProviderError(aborted ? 'Higgsfield did not answer in time.' : `Could not reach Higgsfield: ${(e as Error).message}`, {
          retryable: !aborted || phase === 'read', submitted: phase === 'submit' && aborted ? 'unknown' : 'no',
        })
      }
      const sid = res.headers.get('mcp-session-id')
      if (sid) sessionId = sid
      if (!res.ok || res.status === 202) return { status: res.status, reply: null, text: await res.text().catch(() => '') }
      const id = typeof body.id === 'number' ? body.id : -1
      try {
        if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) return { status: res.status, reply: await readSse(res, id, controller.signal), text: '' }
        const text = await res.text()
        if (text.trimStart().startsWith('event:') || text.trimStart().startsWith('data:')) {
          return { status: res.status, reply: await readSse(new Response(text), id, controller.signal), text }
        }
        return { status: res.status, reply: text ? JSON.parse(text) as RpcReply : null, text }
      } catch (e) {
        if (controller.signal.aborted) {
          throw new ProviderError('Higgsfield did not finish answering in time.', { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no' })
        }
        throw new ProviderError(`Higgsfield sent an answer the Studio could not read: ${(e as Error).message}`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no' })
      }
    } finally {
      clearTimeout(timer)
    }
  }

  function httpError(status: number, text: string, phase: 'submit' | 'read'): ProviderError {
    const detail = text.slice(0, 300)
    if (status === 403) return new ProviderError(`Higgsfield refused the request: ${detail || 'forbidden'}`, { retryable: false, submitted: 'no', status })
    if (status === 400 || status === 422) return new ProviderError(`Higgsfield rejected the request: ${detail}`, { retryable: false, submitted: 'no', status })
    if (status === 429 || status === 502 || status === 503 || status === 504) return new ProviderError(`Higgsfield is busy (${status}). Will retry.`, { retryable: true, submitted: 'no', status })
    return new ProviderError(`Higgsfield error ${status}: ${detail}`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no', status })
  }

  // One request with the session and sign-in handled: a 401 or token error
  // refreshes once, an expired session (404) starts a new one once.
  async function request(method: string, params: Record<string, unknown>, phase: 'submit' | 'read', notify = false): Promise<RpcReply | null> {
    let token = await o.getToken()
    let refreshed = false
    let reinit = false
    for (;;) {
      const body: Record<string, unknown> = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: nextId++, method, params }
      const { status, reply, text } = await post(body, phase, token)
      const tokenError = status === 401 || (status < 300 && TOKEN_ERROR.test(JSON.stringify(reply?.result ?? reply?.error ?? '')))
      if (tokenError && !refreshed) {
        refreshed = true
        token = await o.refreshToken(token)
        if (method !== 'initialize') { sessionId = null; ready = null; await ensureSession() }
        continue
      }
      if (tokenError) throw new ProviderError('Your Higgsfield account sign-in was refused. Reconnect it in Settings.', { retryable: false, submitted: 'no', status: 401, code: 'reconnect' })
      if (status === 404 && sessionId && method !== 'initialize' && !reinit) {
        reinit = true
        sessionId = null
        ready = null
        await ensureSession()
        continue
      }
      if (status >= 300) throw httpError(status, text, phase)
      return reply
    }
  }

  function ensureSession(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        const reply = await request('initialize', {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: o.clientName, version: '1.0' },
        }, 'read')
        if (reply?.error) throw new ProviderError(`Higgsfield did not start a session: ${reply.error.message ?? 'unknown error'}`, { retryable: true, submitted: 'no' })
        await request('notifications/initialized', {}, 'read', true).catch(() => undefined)
      })()
      ready.catch(() => { ready = null })
    }
    return ready
  }

  return {
    async callTool(name, args, phase = 'read') {
      await ensureSession()
      const reply = await request('tools/call', { name, arguments: args }, phase)
      if (!reply) throw new ProviderError(`Higgsfield sent no answer to ${name}.`, { retryable: phase === 'read', submitted: phase === 'submit' ? 'unknown' : 'no' })
      if (reply.error) {
        // A JSON-RPC error means the call was refused before the tool ran.
        throw new ProviderError(`Higgsfield refused ${name}: ${reply.error.message ?? 'unknown error'}`, { retryable: false, submitted: 'no', code: 'rpc_error' })
      }
      const value = unwrapToolResult(reply.result)
      if (reply.result?.isError) {
        const message = typeof value === 'string' ? value : JSON.stringify(value).slice(0, 400)
        throw new ProviderError(`Higgsfield ${name} failed: ${message}`, { retryable: false, submitted: 'no', code: 'tool_error' })
      }
      return value
    },
  }
}
