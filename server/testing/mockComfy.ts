import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { createHash } from 'node:crypto'
import { renderPlaceholderPortrait, renderVideo } from '../providers/mock.js'

// A mock ComfyUI for the tests (UX-PLAN.md section 41): the endpoints the
// agent uses (/system_stats, /queue, /upload/image, /prompt, /history,
// /view, /interrupt, /free) and the /ws progress socket, hand-rolled (no ws
// package). Outputs are real PNG and MP4 files. Scenarios: "hang" never
// finishes (a killed machine), "oom-once" fails the first run out of
// memory, "reject" refuses every workflow.

export type MockComfyScenario = 'ok' | 'hang' | 'oom-once' | 'reject'

export interface MockComfy {
  url: string
  scenario: MockComfyScenario
  prompts: Array<{ id: string; graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> }>
  uploads: string[]
  interrupts: number
  stop(): Promise<void>
}

const KNOWN = new Set(['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'ModelSamplingAuraFlow', 'CFGNorm', 'LoadImage', 'TextEncodeQwenImageEditPlus', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage', 'CLIPTextEncode', 'ModelSamplingSD3', 'WanImageToVideo', 'KSamplerAdvanced', 'CreateVideo', 'SaveVideo', 'CLIPVisionLoader', 'CLIPVisionEncode', 'LoadVideo', 'GetVideoComponents', 'DWPreprocessor', 'DownloadAndLoadSAM2Model', 'Sam2Segmentation', 'GrowMask', 'WanAnimateToVideo', 'TrimVideoLatent'])

const readBody = (req: IncomingMessage) => new Promise<Buffer>((res, rej) => { const p: Buffer[] = []; req.on('data', c => p.push(c as Buffer)); req.on('end', () => res(Buffer.concat(p))); req.on('error', rej) })

function wsFrame(text: string): Buffer {
  const data = Buffer.from(text)
  const head = data.length < 126 ? Buffer.from([0x81, data.length]) : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(data.length), 2); return b })()
  return Buffer.concat([head, data])
}

export async function startMockComfy(opts: { scenario?: MockComfyScenario; steps?: number; stepMs?: number } = {}): Promise<MockComfy> {
  const sockets = new Map<string, Duplex>()
  const files = new Map<string, { data: Buffer; mime: string }>()
  const history = new Map<string, { status: { status_str: string; completed: boolean; messages: unknown[] }; outputs: Record<string, unknown> }>()
  const timers = new Set<NodeJS.Timeout>()
  let oomDone = false, n = 0
  const m: MockComfy = { url: '', scenario: opts.scenario ?? 'ok', prompts: [], uploads: [], interrupts: 0, stop: async () => undefined }
  const send = (client: string, v: unknown) => { const s = sockets.get(client); if (s && !s.destroyed) s.write(wsFrame(JSON.stringify(v))) }
  const json = (res: ServerResponse, code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
  let current: { id: string; client: string; stop: () => void } | null = null

  async function execute(id: string, client: string, graph: MockComfy['prompts'][number]['graph']) {
    if (m.scenario === 'hang') { current = { id, client, stop: () => undefined }; return }
    const steps = opts.steps ?? 3
    let i = 0
    await new Promise<void>(resolveRun => {
      const t = setInterval(() => {
        i++
        send(client, { type: 'progress', data: { value: i, max: steps, prompt_id: id } })
        if (i >= steps) { clearInterval(t); timers.delete(t); resolveRun() }
      }, opts.stepMs ?? 20)
      timers.add(t)
      current = { id, client, stop: () => { clearInterval(t); timers.delete(t); resolveRun() } }
    })
    if (m.scenario === 'oom-once' && !oomDone) {
      oomDone = true
      const msg = { prompt_id: id, node_id: '13', exception_type: 'torch.OutOfMemoryError', exception_message: 'CUDA out of memory. Tried to allocate 2.00 GiB.' }
      history.set(id, { status: { status_str: 'error', completed: false, messages: [['execution_error', msg]] }, outputs: {} })
      send(client, { type: 'execution_error', data: msg })
      return
    }
    const outputs: Record<string, unknown> = {}
    for (const [nodeId, node] of Object.entries(graph)) {
      if (node.class_type === 'SaveImage') {
        const name = `studio_${id}_${nodeId}.png`
        files.set(name, { data: await renderPlaceholderPortrait(`ComfyUI ${id}`, '9:16'), mime: 'image/png' })
        outputs[nodeId] = { images: [{ filename: name, subfolder: '', type: 'output' }] }
      }
      if (node.class_type === 'SaveVideo') {
        const name = `studio_${id}_${nodeId}.mp4`
        files.set(name, { data: await renderVideo(null, 2, `ComfyUI ${id}`), mime: 'video/mp4' })
        outputs[nodeId] = { images: [{ filename: name, subfolder: 'video', type: 'output' }], animated: [true] }
      }
    }
    history.set(id, { status: { status_str: 'success', completed: true, messages: [] }, outputs })
    send(client, { type: 'executing', data: { node: null, prompt_id: id } })
    current = null
  }

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    try {
      if (u.pathname === '/system_stats') return json(res, 200, { system: { os: 'posix', python_version: '3.12.3', pytorch_version: '2.8.0+cu128', comfyui_version: '0.3.66' }, devices: [{ name: 'cuda:0 NVIDIA RTX 6000 Ada Generation', type: 'cuda', vram_total: 51527024640, vram_free: 48000000000 }] })
      if (u.pathname === '/queue') return json(res, 200, { queue_running: current ? [[0, current.id]] : [], queue_pending: [] })
      if (u.pathname === '/upload/image' && req.method === 'POST') {
        const body = await readBody(req)
        const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': String(req.headers['content-type']) }, body: new Uint8Array(body) }).formData()
        const file = form.get('image') as File
        files.set(file.name, { data: Buffer.from(await file.arrayBuffer()), mime: file.type })
        m.uploads.push(file.name)
        return json(res, 200, { name: file.name, subfolder: '', type: 'input' })
      }
      if (u.pathname === '/prompt' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString()) as { prompt: MockComfy['prompts'][number]['graph']; client_id: string }
        if (m.scenario === 'reject') return json(res, 400, { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' }, node_errors: { 4: { errors: [{ message: 'Value not in list: lora_name' }] } } })
        const bad = Object.entries(b.prompt).filter(([, nd]) => !KNOWN.has(nd.class_type) || JSON.stringify(nd.inputs).includes('studio:'))
        if (bad.length) return json(res, 400, { error: { type: 'invalid_prompt', message: `Bad nodes: ${bad.map(([k]) => k).join(', ')}` }, node_errors: {} })
        for (const nd of Object.values(b.prompt)) if (nd.class_type === 'LoadImage' && !files.has(String(nd.inputs.image))) return json(res, 400, { error: { type: 'invalid_prompt', message: `Image not uploaded: ${String(nd.inputs.image)}` }, node_errors: {} })
        const id = `p${++n}`
        m.prompts.push({ id, graph: b.prompt })
        void execute(id, b.client_id, b.prompt)
        return json(res, 200, { prompt_id: id, number: n, node_errors: {} })
      }
      if (u.pathname.startsWith('/history/')) {
        const id = u.pathname.slice('/history/'.length)
        const h = history.get(id)
        return json(res, 200, h ? { [id]: h } : {})
      }
      if (u.pathname === '/view') {
        const f = files.get(u.searchParams.get('filename') ?? '')
        if (!f) return json(res, 404, { error: 'not found' })
        res.writeHead(200, { 'content-type': f.mime }); res.end(f.data); return
      }
      if (u.pathname === '/interrupt' && req.method === 'POST') { m.interrupts++; current?.stop(); current = null; return json(res, 200, {}) }
      if (u.pathname === '/free' && req.method === 'POST') return json(res, 200, {})
      json(res, 404, { error: `mock ComfyUI has no ${u.pathname}` })
    } catch (e) {
      json(res, 500, { error: (e as Error).message })
    }
  })
  server.on('upgrade', (req, socket) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname !== '/ws') { socket.destroy(); return }
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const client = u.searchParams.get('clientId') ?? ''
    sockets.set(client, socket)
    socket.write(wsFrame(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: client } })))
    // Frames from the client (close, ping) are read and dropped.
    socket.on('data', d => { if ((d[0]! & 0x0f) === 0x8) socket.end() })
    socket.on('error', () => undefined)
    socket.on('close', () => sockets.delete(client))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  m.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  m.stop = async () => {
    for (const t of timers) clearInterval(t)
    for (const s of sockets.values()) s.destroy()
    await new Promise<void>(r => server.close(() => r()))
  }
  return m
}
