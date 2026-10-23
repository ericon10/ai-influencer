import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seed, SEED_FILE, type Seed } from './seed'

// A hermetic run (owner, 2026-10-17): unless E2E_BASE names a Studio that is
// already running, the suite starts its own on a fresh, throwaway database
// and blob folder (e2e/.out/run-<time>/), seeds it (seed.ts) and stops it
// when the run ends. Nothing depends on what a container or an earlier run
// left. With E2E_BASE the Studio is used as it is; the seed is made once
// (demo mode only) and reused while its records are there.

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = join(HERE, '.out')
const KEEP_RUNS = 2

const log = (line: string) => console.log(`[e2e] ${line}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const inUse = (port: number, host = '127.0.0.1') => new Promise<boolean>(done => {
  const s = connect(port, host)
  s.once('connect', () => { s.destroy(); done(true) })
  s.once('error', () => done(false))
})

const freePort = () => new Promise<number>((done, fail) => {
  const s = createServer()
  s.once('error', fail)
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)) })
})

async function waitFor(url: string, what: string, proc: ChildProcess, logFile: string, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (proc.exitCode != null) throw new Error(`${what} stopped (exit ${proc.exitCode}). See ${logFile}`)
    const ok = await fetch(url).then(r => r.ok).catch(() => false)
    if (ok) return
    await sleep(300)
  }
  throw new Error(`${what} did not answer at ${url} in ${timeoutMs / 1000} s. See ${logFile}`)
}

// Old run folders go (the newest few stay for a look at their logs). A
// Studio left running by an interrupted run is stopped first: only a
// process whose command line names that run's own folder.
function cleanOldRuns() {
  if (!existsSync(OUT)) return
  const runs = readdirSync(OUT).filter(d => /^run-\d/.test(d)).sort()
  for (const d of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
    const dir = join(OUT, d)
    stopRecorded(dir)
    rmSync(dir, { recursive: true, force: true })
  }
}

function stopRecorded(dir: string) {
  const file = join(dir, 'pids.json')
  if (!existsSync(file)) return
  for (const pid of JSON.parse(readFileSync(file, 'utf8')) as number[]) {
    const environ = (() => { try { return readFileSync(`/proc/${pid}/environ`, 'utf8') } catch { return '' } })()
    if (environ.includes(dir)) { try { process.kill(-pid, 'SIGKILL') } catch { /* gone */ } }
  }
}

let stopping = false
function start(name: string, bin: string, args: string[], env: NodeJS.ProcessEnv, logFile: string): ChildProcess {
  const fd = openSync(logFile, 'a')
  // Its own process group, so the stop takes its children too.
  const p = spawn(join(ROOT, 'node_modules', '.bin', bin), args, { cwd: ROOT, env, stdio: ['ignore', fd, fd], detached: true })
  p.on('error', e => log(`${name}: ${e.message}`))
  // Stopped before the run ended (a crash, or something else stopped it):
  // said at once, in the console and its log, so the failures after it are clear.
  p.on('exit', (code, signal) => {
    if (stopping) return
    const line = `${name} stopped during the run (${signal ? `signal ${signal}` : `exit ${code}`}); the tests after this fail. See ${logFile}`
    log(line)
    try { appendFileSync(logFile, `[e2e] ${line}\n`) } catch { /* gone */ }
  })
  return p
}

async function stop(procs: ChildProcess[]) {
  stopping = true
  for (const p of procs) if (p.pid && p.exitCode == null) { try { process.kill(-p.pid, 'SIGTERM') } catch { /* gone */ } }
  const end = Date.now() + 8000
  while (Date.now() < end && procs.some(p => p.exitCode == null && p.signalCode == null)) await sleep(200)
  for (const p of procs) if (p.pid && p.exitCode == null && p.signalCode == null) { try { process.kill(-p.pid, 'SIGKILL') } catch { /* gone */ } }
}

// With E2E_BASE: the seed this Studio already has, if its records are all there.
async function reuse(api: string): Promise<Seed | null> {
  if (process.env.E2E_RESEED || !existsSync(SEED_FILE)) return null
  const s = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Seed
  if (s.api !== api.replace(/\/$/, '') || !s.sideStep) return null
  const ok = async (path: string) => (await fetch(`${api}${path}`, { headers: { 'x-studio-request': '1' } })).ok
  const posts = await Promise.all([s.basePost, s.recreatePost, s.takeRecreatePost].map(id => ok(`/content/${id}`)))
  const { characters } = await (await fetch(`${api}/characters`, { headers: { 'x-studio-request': '1' } })).json() as { characters: { id: string }[] }
  return posts.every(Boolean) && [s.callie, s.solei].every(id => characters.some(c => c.id === id)) ? s : null
}

export default async function globalSetup() {
  // The live-site proxy and the fake storage of r2.ts, on ports no one uses.
  process.env.E2E_LIVE_PORT ||= String(await freePort())
  process.env.E2E_R2_PORT ||= String(await freePort())
  const api = process.env.E2E_API!

  if (!process.env.E2E_HERMETIC) {
    log(`using the Studio at ${process.env.E2E_BASE} (API ${api})`)
    const kept = await reuse(api)
    if (kept) log(`seed reused from ${SEED_FILE} (E2E_RESEED=1 makes a new one)`)
    else await seed(api, line => log(`seed: ${line}`))
    process.env.E2E_SEED_FILE = SEED_FILE
    return
  }

  const webPort = Number(new URL(process.env.E2E_BASE!).port)
  const apiPort = Number(new URL(api).port)
  for (const [port, name] of [[apiPort, 'E2E_API_PORT'], [webPort, 'E2E_WEB_PORT']] as const) {
    if (await inUse(port) || await inUse(port, '::1')) throw new Error(`Port ${port} is in use. Stop what runs there, or pick another with ${name}=...`)
  }
  if (!existsSync(join(ROOT, 'dist-editor', 'index.html'))) throw new Error('The editor is not built: run npm run build:editor first (it makes dist-editor/).')
  const models = resolve(ROOT, process.env.STUDIO_MODELS_DIR || '.data/models')
  if (!existsSync(join(models, 'face_recognition_sface_2021dec.onnx'))) log(`no face models in ${models} (npm run models): the free face checks are off for this run`)

  cleanOldRuns()
  const runDir = join(OUT, `run-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}`)
  mkdirSync(runDir, { recursive: true })
  process.env.E2E_RUN_DIR = runDir

  // A fresh local Studio in demo mode: PGlite and local blobs in the run
  // folder, the mock providers, no deployment settings, no keys.
  // A fake Google (sign-in and Drive) for Send to Drive (UX-PLAN.md section 37).
  const { startFakeDrive } = await import('../server/testing/fakeDrive')
  const drive = await startFakeDrive()
  process.env.E2E_DRIVE_URL = drive.url
  // A fake Kie.ai and WaveSpeed for their keys, Test key and balance
  // (UX-PLAN.md section 40). The suite stays in demo mode: nothing runs there.
  const { startFakeProviders } = await import('../server/testing/fakeProviders')
  const fakes = await startFakeProviders()
  process.env.E2E_PROVIDERS_URL = fakes.url
  const studioEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development', VERCEL: '',
    DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', PGLITE_DIR: join(runDir, 'pg'),
    STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: join(runDir, 'blobs'),
    S3_ENDPOINT: '', S3_BUCKET: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '',
    STUDIO_MASTER_KEYS: '', STUDIO_SESSION_SECRET: '', STUDIO_OWNER_EMAIL: '', STUDIO_OWNER_PASSPHRASE: '',
    STUDIO_PUBLIC_URL: '', STUDIO_WORKER_URL: '', STUDIO_WORKER_IDLE: 'poll',
    HF_CREDENTIALS: '', ELEVENLABS_API_KEY: '',
    STUDIO_API_PORT: String(apiPort),
    GOOGLE_API_BASE: drive.url, GOOGLE_OAUTH_BASE: drive.url, GOOGLE_ACCOUNTS_BASE: drive.url,
    KIE_API_BASE: fakes.url, WAVESPEED_API_BASE: fakes.url,
    E2E_RUN_DIR: runDir,
  }
  const apiLog = join(runDir, 'api.log'), webLog = join(runDir, 'web.log')
  const procs: ChildProcess[] = []
  const t0 = Date.now()
  try {
    // By its full path: a stop aimed at someone's dev server ("tsx
    // server/dev.ts") never takes the suite's own Studio with it.
    procs.push(start('The Studio API', 'tsx', [join(ROOT, 'server', 'dev.ts')], studioEnv, apiLog))
    writeFileSync(join(runDir, 'pids.json'), JSON.stringify(procs.map(p => p.pid)))
    await waitFor(`http://127.0.0.1:${apiPort}/api/v1/health`, 'The Studio API', procs[0]!, apiLog)
    procs.push(start('Vite', 'vite', ['--port', String(webPort), '--strictPort'], studioEnv, webLog))
    writeFileSync(join(runDir, 'pids.json'), JSON.stringify(procs.map(p => p.pid)))
    await waitFor(`http://localhost:${webPort}/studio`, 'Vite', procs[1]!, webLog)
    await waitFor(`http://localhost:${webPort}/editor/`, 'The editor', procs[1]!, webLog)
    log(`Studio up in ${Math.round((Date.now() - t0) / 1000)} s: ${process.env.E2E_BASE} (API ${api}), data in ${runDir}`)
    await seed(api, line => log(`seed: ${line}`))
    copyFileSync(SEED_FILE, join(runDir, 'seed.json'))
    process.env.E2E_SEED_FILE = join(runDir, 'seed.json')
  } catch (e) {
    await stop(procs)
    await drive.stop()
    await fakes.stop()
    throw e
  }
  return async () => {
    await stop(procs)
    await drive.stop()
    await fakes.stop()
    const size = (dir: string): number => existsSync(dir) ? readdirSync(dir).reduce((a, f) => { const p = join(dir, f); const st = statSync(p); return a + (st.isDirectory() ? size(p) : st.size) }, 0) : 0
    log(`Studio stopped; the run's data (${Math.round(size(runDir) / 1e6)} MB) and logs are in ${runDir}`)
  }
}
