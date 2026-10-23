#!/usr/bin/env node
// The Character Studio agent for a ComfyUI machine (UX-PLAN.md section 41).
// It only calls out: a heartbeat every few seconds, claims a task, fetches
// its inputs through short-lived links, runs it on the local ComfyUI
// (upload, queue, websocket progress), puts the outputs straight into the
// Studio's storage and reports done. Nothing listens on the network.
//
//   comfy-agent run      the loop (the image's start.sh restarts it)
//   comfy-agent pause    stop taking Studio jobs (your own work comes first)
//   comfy-agent resume   take Studio jobs again
//   comfy-agent lock     measure this machine's environment and print it
//   comfy-agent status   what the agent sees
//
// Settings (environment): STUDIO_URL (https://character-studio-pi.vercel.app),
// STUDIO_AGENT_TOKEN (made in Settings > Provider keys > ComfyUI; never in a
// repo), COMFY_URL (http://127.0.0.1:8188), COMFY_DIR, COMFY_MODELS,
// COMFY_LOCK (the environment.lock.json in the image), COMFY_AGENT_HOME
// (~/.comfy-agent), LORA_TRAIN_CMD (the trainer, {config} is its file).
// No dependencies: Node 22 has fetch and WebSocket.

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const AGENT_VERSION = '1.0.0'
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.gif': 'image/gif', '.json': 'application/json' }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Sorted-key JSON, the same as the Studio's stableStringify, so both sides
// hash an environment the same way.
export function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
}
export const envHash = lock => createHash('sha256').update(stable({ version: lock.version, comfyui: lock.comfyui, pytorch: lock.pytorch ?? null, nodes: lock.nodes, models: lock.models })).digest('hex')

function sha256File(path) {
  return new Promise((ok, bad) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', bad)
  })
}

export function createAgent(opts = {}) {
  const env = { ...process.env, ...(opts.env ?? {}) }
  const studio = (env.STUDIO_URL ?? 'https://character-studio-pi.vercel.app').replace(/\/$/, '')
  const token = env.STUDIO_AGENT_TOKEN ?? ''
  const comfy = (env.COMFY_URL ?? 'http://127.0.0.1:8188').replace(/\/$/, '')
  const comfyDir = env.COMFY_DIR ?? '/comfy/ComfyUI'
  const modelsDir = env.COMFY_MODELS ?? '/models'
  const home = env.COMFY_AGENT_HOME ?? join(homedir(), '.comfy-agent')
  const lockPath = env.COMFY_LOCK ?? '/comfy/env/environment.lock.json'
  const log = opts.log ?? ((...a) => console.log(new Date().toISOString(), ...a))
  const fetchImpl = opts.fetch ?? fetch
  const pauseFile = join(home, 'paused')
  mkdirSync(home, { recursive: true })

  let loadedFamily = null
  let measured = null
  const running = new Map() // taskId -> { promptId, abort }
  let maxJobs = 1, paused = false, envOk = false

  const api = async (path, body, extra = {}) => {
    const r = await fetchImpl(`${studio}/api/v1${path}`, { method: extra.method ?? 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(extra.headers ?? {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text()
    const json = text ? JSON.parse(text) : {}
    if (!r.ok) { const e = new Error(json?.error?.message ?? `Studio answered ${r.status}`); e.status = r.status; throw e }
    return json
  }
  const comfyJson = async (path, init) => {
    const r = await fetchImpl(`${comfy}${path}`, init)
    if (!r.ok) throw new Error(`ComfyUI ${path} answered ${r.status}: ${(await r.text()).slice(0, 500)}`)
    return r.json()
  }
  // A Studio link: a direct storage link, or an API path that takes the
  // agent token and the claim.
  const studioLink = (url, claim) => (url.startsWith('/') ? { url: `${studio}${url}`, headers: { authorization: `Bearer ${token}`, 'x-claim-token': claim } } : { url, headers: {} })

  // ── The environment (E3) ──
  async function measureEnv() {
    if (opts.measureEnv) return opts.measureEnv()
    const want = JSON.parse(readFileSync(lockPath, 'utf8'))
    const git = dir => { try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return null } }
    const nodes = {}
    const nodesDir = join(comfyDir, 'custom_nodes')
    if (existsSync(nodesDir)) for (const d of readdirSync(nodesDir)) if (existsSync(join(nodesDir, d, '.git'))) nodes[d] = git(join(nodesDir, d))
    let pytorch = null
    try { pytorch = (await comfyJson('/system_stats')).system?.pytorch_version ?? null } catch { /* ComfyUI not up yet */ }
    const cachePath = join(home, 'hashes.json')
    const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
    const models = {}
    for (const k of Object.keys(want.models ?? {})) {
      const path = k.startsWith('@comfy/') ? join(comfyDir, k.slice(7)) : join(modelsDir, k)
      if (!existsSync(path)) continue
      const st = statSync(path)
      const sig = `${st.size}:${st.mtimeMs}`
      if (cache[path]?.sig !== sig) { log(`measuring ${k} (once)`); cache[path] = { sig, sha256: await sha256File(path) } }
      models[k] = cache[path].sha256
    }
    writeFileSync(cachePath, JSON.stringify(cache))
    return { version: want.version ?? 1, comfyui: git(comfyDir) ?? 'unknown', pytorch, nodes, models }
  }

  async function modelList() {
    const out = []
    for (const sub of ['diffusion_models', 'text_encoders', 'vae', 'clip_vision', 'loras', 'sam2']) {
      const dir = join(modelsDir, sub)
      if (existsSync(dir)) for (const f of readdirSync(dir)) out.push(`${sub}/${f}`)
    }
    return out
  }

  async function heartbeat() {
    let stats = null, queue = null, comfyError
    try { stats = await comfyJson('/system_stats'); queue = await comfyJson('/queue') } catch (e) { comfyError = e.message }
    if (!measured || opts.remeasure) measured = await measureEnv()
    const dev = stats?.devices?.[0]
    const body = {
      agentVersion: AGENT_VERSION, comfyOk: !!stats, ...(comfyError ? { comfyError } : {}),
      ...(dev ? { gpu: dev.name, vramTotalMb: Math.round((dev.vram_total ?? 0) / 1048576), vramFreeMb: Math.round((dev.vram_free ?? 0) / 1048576) } : {}),
      comfyQueue: queue ? (queue.queue_running?.length ?? 0) + (queue.queue_pending?.length ?? 0) : undefined,
      models: await modelList(), env: measured, loadedFamily, localPause: existsSync(pauseFile), running: [...running.entries()].map(([id, t]) => ({ id, claimToken: t.claimToken })),
    }
    const r = await api('/comfy/agent/heartbeat', body)
    maxJobs = r.maxJobs ?? 1; paused = !!r.paused; envOk = !!r.env?.ok
    if (!envOk && r.env?.problems?.length) log(`environment is not the one the Studio expects: ${r.env.problems.slice(0, 3).join(' ')}`)
    for (const id of r.cancel ?? []) { const t = running.get(id); if (t) { log(`stopping ${id} (the Studio no longer wants it)`); t.abort() } }
    return r
  }

  // ── Running a workflow ──
  async function uploadToComfy(name, data, mime) {
    const form = new FormData()
    form.append('image', new Blob([data], { type: mime }), name)
    form.append('overwrite', 'true')
    form.append('type', 'input')
    const r = await comfyJson('/upload/image', { method: 'POST', body: form })
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name
  }

  function watch(promptId, clientId, onProgress, signal) {
    // Websocket progress, with /history as the fallback every 5 s.
    return new Promise((ok, bad) => {
      let finished = false
      const end = (fn, v) => { if (finished) return; finished = true; clearInterval(poll); try { ws?.close() } catch { /* closed */ } fn(v) }
      let ws
      try {
        ws = new WebSocket(`${comfy.replace(/^http/, 'ws')}/ws?clientId=${clientId}`)
        ws.onmessage = ev => {
          if (typeof ev.data !== 'string') return
          const m = JSON.parse(ev.data)
          if (m.data?.prompt_id && m.data.prompt_id !== promptId) return
          if (m.type === 'progress') onProgress(m.data.max ? m.data.value / m.data.max : 0)
          if (m.type === 'execution_error') end(bad, Object.assign(new Error(`${m.data.exception_type ?? 'Error'}: ${m.data.exception_message ?? 'ComfyUI failed'}`), { oom: /OutOfMemory|out of memory/i.test(`${m.data.exception_type} ${m.data.exception_message}`) }))
          if ((m.type === 'executing' && m.data.node === null) || m.type === 'execution_success') end(ok)
        }
        ws.onerror = () => { /* the poll carries on */ }
      } catch { /* no websocket: the poll carries on */ }
      const poll = setInterval(async () => {
        try {
          const h = await comfyJson(`/history/${promptId}`)
          const st = h[promptId]?.status
          if (st?.completed || st?.status_str === 'success') end(ok)
          if (st?.status_str === 'error') {
            const msg = (st.messages ?? []).find(x => x[0] === 'execution_error')?.[1]
            end(bad, Object.assign(new Error(`${msg?.exception_type ?? 'Error'}: ${msg?.exception_message ?? 'ComfyUI failed'}`), { oom: /OutOfMemory|out of memory/i.test(JSON.stringify(msg ?? '')) }))
          }
        } catch { /* try again */ }
      }, opts.pollMs ?? 5000)
      signal.addEventListener('abort', () => end(bad, Object.assign(new Error(signal.reason ?? 'Stopped.'), { stopped: true })))
    })
  }

  async function runWorkflow(task, ping, signal) {
    const graph = JSON.parse(JSON.stringify(task.graph))
    const names = {}
    for (const [slot, input] of Object.entries(task.inputs)) {
      const l = studioLink(input.url, task.claimToken)
      const r = await fetchImpl(l.url, { headers: l.headers })
      if (!r.ok) throw new Error(`Could not fetch input ${slot} (${r.status}).`)
      names[slot] = await uploadToComfy(input.name, Buffer.from(await r.arrayBuffer()), input.mime)
    }
    for (const n of Object.values(graph)) for (const [f, v] of Object.entries(n.inputs)) {
      if (typeof v === 'string' && v.startsWith('studio:')) {
        const slot = v.slice(7)
        if (!names[slot]) throw Object.assign(new Error(`The graph needs input ${slot}, which the task did not bring.`), { reason: 'validation' })
        n.inputs[f] = names[slot]
      }
    }
    const clientId = randomUUID()
    const q = await fetchImpl(`${comfy}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: clientId }) })
    const qj = await q.json()
    if (!q.ok || !qj.prompt_id) throw Object.assign(new Error(`ComfyUI refused the workflow: ${JSON.stringify(qj.error ?? qj.node_errors ?? qj).slice(0, 800)}`), { reason: 'validation' })
    running.get(task.id).promptId = qj.prompt_id
    await watch(qj.prompt_id, clientId, ping, signal)
    const hist = (await comfyJson(`/history/${qj.prompt_id}`))[qj.prompt_id]
    const files = []
    for (const out of Object.values(hist?.outputs ?? {})) for (const key of ['images', 'gifs', 'videos', 'video']) for (const f of [].concat(out[key] ?? [])) if (f?.filename && f.type !== 'temp') files.push(f)
    if (!files.length) throw new Error('ComfyUI finished without saving an output.')
    return Promise.all(files.map(async f => {
      const r = await fetchImpl(`${comfy}/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' })}`)
      if (!r.ok) throw new Error(`Could not read output ${f.filename} from ComfyUI.`)
      const mime = MIME[extname(f.filename).toLowerCase()] ?? 'application/octet-stream'
      return { data: Buffer.from(await r.arrayBuffer()), mime, kind: mime.startsWith('video/') ? 'video' : 'image' }
    }))
  }

  // ── Training a LoRA (item 6) ──
  async function runTrain(task, ping, signal) {
    const t = task.train
    const dir = join(home, 'train', task.id)
    const data = join(dir, 'dataset')
    rmSync(dir, { recursive: true, force: true }); mkdirSync(data, { recursive: true })
    let i = 0
    for (const [slot, input] of Object.entries(task.inputs)) {
      const l = studioLink(input.url, task.claimToken)
      const r = await fetchImpl(l.url, { headers: l.headers })
      if (!r.ok) throw new Error(`Could not fetch training image ${slot} (${r.status}).`)
      const name = `${String(i++).padStart(3, '0')}${extname(input.name) || '.png'}`
      writeFileSync(join(data, name), Buffer.from(await r.arrayBuffer()))
      writeFileSync(join(data, name.replace(/\.[a-z]+$/, '.txt')), t.caption)
    }
    const out = join(dir, 'out')
    mkdirSync(out, { recursive: true })
    const config = join(dir, 'config.json')
    const base = t.base === 'krea2' ? join(modelsDir, 'diffusion_models', 'krea2_raw.safetensors') : join(modelsDir, 'diffusion_models', 'qwen_image_edit_2511_bf16.safetensors')
    writeFileSync(config, JSON.stringify({
      job: 'extension', config: { name: t.fileName.replace(/\.safetensors$/, ''), process: [{
        type: 'sd_trainer', training_folder: out, device: 'cuda:0', trigger_word: t.trigger,
        network: { type: 'lora', linear: t.rank, linear_alpha: t.rank },
        save: { dtype: 'bf16', save_every: t.steps, max_step_saves_to_keep: 1 },
        datasets: [{ folder_path: data, caption_ext: 'txt', resolution: [t.resolution] }],
        train: { batch_size: 1, steps: t.steps, gradient_accumulation_steps: 1, train_unet: true, train_text_encoder: false, lr: t.learningRate, optimizer: 'adamw8bit', dtype: 'bf16' },
        model: { name_or_path: base, arch: t.base === 'krea2' ? 'krea2' : 'qwen_image_edit' },
      }] },
    }, null, 2))
    // Free ComfyUI's memory first; the trainer needs the GPU.
    try { await fetchImpl(`${comfy}/free`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }) } catch { /* not running */ }
    loadedFamily = null
    const cmd = (env.LORA_TRAIN_CMD ?? `${env.AITOOLKIT_DIR ?? '/comfy/ai-toolkit'}/venv/bin/python ${env.AITOOLKIT_DIR ?? '/comfy/ai-toolkit'}/run.py {config}`).replace('{config}', config).replace('{out}', out).replace('{file}', t.fileName)
    const started = Date.now()
    await new Promise((ok, bad) => {
      const p = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, STUDIO_TRAIN_OUT: out, STUDIO_TRAIN_STEPS: String(t.steps) } })
      let tail = ''
      const read = d => {
        const s = d.toString(); tail = (tail + s).slice(-2000)
        const m = [...s.matchAll(/(\d+)\s*\/\s*(\d+)/g)].pop()
        if (m && Number(m[2]) >= t.steps * 0.5) ping(Math.min(0.99, Number(m[1]) / Number(m[2])))
      }
      p.stdout.on('data', read); p.stderr.on('data', read)
      signal.addEventListener('abort', () => p.kill('SIGTERM'))
      p.on('exit', code => (code === 0 ? ok() : bad(Object.assign(new Error(`The trainer stopped (code ${code}): ${tail.slice(-600)}`), { oom: /out of memory/i.test(tail) }))))
    })
    const made = readdirSync(out, { recursive: true }).map(String).filter(f => f.endsWith('.safetensors')).map(f => join(out, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    if (!made) throw new Error('The trainer finished without a .safetensors file.')
    const lorasDir = join(modelsDir, 'loras')
    mkdirSync(lorasDir, { recursive: true })
    copyFileSync(made, join(lorasDir, t.fileName))
    const sha256 = await sha256File(join(lorasDir, t.fileName))
    rmSync(data, { recursive: true, force: true })
    const record = { fileName: t.fileName, sha256, base: t.base, trigger: t.trigger, steps: t.steps, seconds: Math.round((Date.now() - started) / 1000), bytes: statSync(join(lorasDir, t.fileName)).size }
    return [{ data: Buffer.from(JSON.stringify(record)), mime: 'application/json', kind: 'json' }]
  }

  async function runTask(task) {
    const ctl = new AbortController()
    running.set(task.id, { promptId: null, claimToken: task.claimToken, abort: () => ctl.abort('Stopped by the Studio.') })
    let lastPing = 0, progress = 0
    const ping = p => { progress = p; if (Date.now() - lastPing > (opts.pingMs ?? 5000)) { lastPing = Date.now(); api(`/comfy/agent/tasks/${task.id}/progress`, { claimToken: task.claimToken, progress }).then(r => { if (r.cancel) ctl.abort('Stopped by the Studio.') }).catch(() => { /* next ping */ }) } }
    // The lease is renewed even while a long step sends no progress.
    const keepAlive = setInterval(() => { lastPing = 0; ping(progress) }, opts.keepAliveMs ?? 20_000)
    const hard = setTimeout(() => ctl.abort('Hard timeout.'), task.timeoutSec * 1000)
    log(`task ${task.id} (${task.kind} ${task.workflowId}, ${task.family})`)
    try {
      ping(0)
      const outputs = task.kind === 'train' ? await runTrain(task, ping, ctl.signal) : await runWorkflow(task, ping, ctl.signal)
      const sent = []
      for (const [i, o] of outputs.entries()) {
        const up = await api(`/comfy/agent/tasks/${task.id}/upload-url`, { claimToken: task.claimToken, index: i, mime: o.mime })
        const l = studioLink(up.url, task.claimToken)
        const r = await fetchImpl(l.url, { method: 'PUT', headers: { ...l.headers, ...up.headers }, body: o.data })
        if (!r.ok) throw new Error(`Could not put output ${i} into storage (${r.status}).`)
        sent.push({ key: up.key, kind: o.kind, mime: o.mime })
      }
      // Done is safe to send again: the Studio stores the outputs once.
      for (let a = 0; ; a++) {
        try { await api(`/comfy/agent/tasks/${task.id}/done`, { claimToken: task.claimToken, outputs: sent }); break } catch (e) { if (e.status === 409 || a >= 4) throw e; await sleep(2000 * 2 ** a) }
      }
      if (task.kind !== 'train') loadedFamily = task.family
      log(`task ${task.id} done`)
    } catch (e) {
      if (running.get(task.id)?.promptId) { try { await fetchImpl(`${comfy}/interrupt`, { method: 'POST' }) } catch { /* gone */ } }
      const reason = e.oom ? 'oom' : e.reason === 'validation' ? 'validation' : /Hard timeout/.test(String(ctl.signal.reason ?? '')) ? 'timeout' : 'agent'
      log(`task ${task.id} failed: ${e.message}`)
      if (e.status !== 409) await api(`/comfy/agent/tasks/${task.id}/fail`, { claimToken: task.claimToken, error: e.message, reason }).catch(() => { /* the lease runs out and the Studio reclaims it */ })
    } finally {
      clearInterval(keepAlive); clearTimeout(hard)
      running.delete(task.id)
    }
  }

  // One round: heartbeat, then claim while there is room. Returns the tasks
  // started (their promises), so a test can wait on them.
  async function tick() {
    await heartbeat()
    const started = []
    while (!paused && envOk && running.size < maxJobs) {
      const r = await api('/comfy/agent/claim', { loadedFamily })
      if (!r.task) break
      started.push(runTask(r.task))
    }
    return started
  }

  return {
    tick, heartbeat, measureEnv, runTask, running,
    get loadedFamily() { return loadedFamily },
    pause() { writeFileSync(pauseFile, new Date().toISOString()) },
    resume() { rmSync(pauseFile, { force: true }) },
    async run() {
      log(`agent ${AGENT_VERSION}: Studio ${studio}, ComfyUI ${comfy}`)
      if (!token) throw new Error('Set STUDIO_AGENT_TOKEN (Settings > Provider keys > ComfyUI > Make the agent token).')
      for (;;) {
        try { await tick() } catch (e) { log(`round failed: ${e.message}`) }
        await sleep(running.size ? 2000 : 4000)
      }
    },
  }
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href || (process.argv[1] ?? '').endsWith('comfy-agent')
if (isMain) {
  const agent = createAgent()
  const cmd = process.argv[2] ?? 'run'
  if (cmd === 'pause') { agent.pause(); console.log('Paused: the Studio\'s jobs wait until you run comfy-agent resume. A job already running finishes first.') }
  else if (cmd === 'resume') { agent.resume(); console.log('Resumed: the agent takes Studio jobs again.') }
  else if (cmd === 'lock') { const l = await agent.measureEnv(); console.log(JSON.stringify(l, null, 2)); console.error(`environment hash ${envHash(l)}`) }
  else if (cmd === 'status') { const l = await agent.measureEnv(); console.log(JSON.stringify({ hash: envHash(l), paused: existsSync(join(process.env.COMFY_AGENT_HOME ?? join(homedir(), '.comfy-agent'), 'paused')) }, null, 2)) }
  else await agent.run()
}
