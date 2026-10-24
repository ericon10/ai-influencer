import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// The browser suite's own data (owner, 2026-10-17: "every run starts from
// the same known set"). Made once per run, before any spec, all through the
// Studio's public API in demo mode (the mock providers, nothing paid):
//
//   Callie        her character file (fixtures/callie) and 12 approved REF images
//   Solei         Callie's file with the name replaced (the plan's SOLEI rows)
//   SideStep      the product the plan and the hook writers use (the starter kit)
//   stills, clip  two uploaded stills and one uploaded clip in Callie's Library
//   base post     a video post with one picked take, made like a user would:
//                 a scene, a still (Use this still), a 5 s take (Use this take)
//   voice line    one of Callie's, converted (ready)
//   music         an uploaded 12 s music bed at 120 BPM (ready)
//   Recreate x2   a post from a real clip: 4 stills and the face pass, You
//                 pick, the motion run, the take kept. One is read by the
//                 failures and garment specs (they put back what they change);
//                 the take spec uses its own (it picks the take as the clip).
//
// Wren is not seeded: the character file spec makes her itself. The ids go
// to e2e/.out/seed.json, which the specs read through helpers.ts.
//
// Run alone against a Studio that is already running (demo mode only):
//   E2E_API=http://localhost:8787/api/v1 npm run e2e:seed

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
export const SEED_FILE = join(HERE, '.out', 'seed.json')
const CACHE = join(HERE, '.out', 'cache')

export interface Seed {
  api: string
  createdAt: string
  callie: string
  solei: string
  sideStep: string
  stills: string[]
  libraryClip: string
  basePost: string
  voiceLine: string
  music: string
  recreatePost: string
  recreateTake: string
  takeRecreatePost: string
}

type Log = (line: string) => void

class Studio {
  constructor(readonly api: string, readonly log: Log) {}

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.api}${path}`, { method, headers: { 'x-studio-request': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text()
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 400)}`)
    return (text ? JSON.parse(text) : {}) as T
  }

  async upload(data: Buffer, name: string, type: string): Promise<string> {
    const { slots } = await this.call<{ slots: { uploadId: string; url: string; headers?: Record<string, string> }[] }>('POST', '/uploads', { files: [{ name, type, size: data.length }] })
    const slot = slots[0]!
    const url = slot.url.startsWith('http') ? slot.url : `${new URL(this.api).origin}${slot.url}`
    const r = await fetch(url, { method: 'PUT', headers: { 'x-studio-request': '1', ...(slot.headers ?? { 'content-type': type }) }, body: new Uint8Array(data) })
    if (!r.ok) throw new Error(`upload ${name}: ${r.status} ${await r.text()}`)
    return slot.uploadId
  }

  // A priced action as the Studio runs it: its quote first, then the run.
  async run(action: Record<string, unknown>): Promise<string[]> {
    const est = await this.call<{ quote: { id: string; status: string } }>('POST', '/actions/estimate', { action })
    if (est.quote.status === 'blocked') throw new Error(`${String(action.type)}: the quote is blocked`)
    const { jobIds } = await this.call<{ jobIds: string[] }>('POST', '/actions/run', { action, quoteId: est.quote.id, confirmed: true })
    return jobIds
  }

  // Every job settled and its free checks done; a failed one stops the seed.
  async jobs(ids: string[], what: string, timeoutMs = 180_000): Promise<void> {
    const end = Date.now() + timeoutMs
    const done = new Set<string>()
    while (done.size < ids.length) {
      for (const id of ids) {
        if (done.has(id)) continue
        const { job } = await this.call<{ job: { status: string; phase: string | null; error?: { message?: string } | null } }>('GET', `/jobs/${id}`)
        if (['failed', 'canceled', 'needs_attention'].includes(job.status)) throw new Error(`${what}: job ${id} ${job.status}: ${job.error?.message ?? ''}`)
        if (job.status === 'completed' && job.phase !== 'checking') done.add(id)
      }
      if (done.size < ids.length) {
        if (Date.now() > end) throw new Error(`${what}: ${ids.length - done.size} of ${ids.length} jobs still running after ${timeoutMs / 1000} s`)
        await sleep(500)
      }
    }
  }

  // Polls until the check returns a value (not null or undefined).
  async until<T>(what: string, check: () => Promise<T | null | undefined>, timeoutMs = 120_000): Promise<T> {
    const end = Date.now() + timeoutMs
    for (;;) {
      const v = await check()
      if (v != null) return v
      if (Date.now() > end) throw new Error(`${what}: not ready after ${timeoutMs / 1000} s`)
      await sleep(500)
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args])

// A plain studio portrait as a REF image stand-in (the mock provider's
// stills are made from these).
async function portrait(label: string, hue: number): Promise<Buffer> {
  const w = 768, h = 1024
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="hsl(${hue},26%,80%)"/>
    <ellipse cx="${w / 2}" cy="${h * 0.38}" rx="${w * 0.17}" ry="${h * 0.15}" fill="hsl(${hue},20%,52%)"/>
    <path d="M ${w * 0.12} ${h} C ${w * 0.16} ${h * 0.66}, ${w * 0.84} ${h * 0.66}, ${w * 0.88} ${h} Z" fill="hsl(${hue},20%,44%)"/>
    <text x="${w / 2}" y="${h * 0.93}" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#333">${label}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function cached(name: string, make: (file: string) => void): Buffer {
  mkdirSync(CACHE, { recursive: true })
  const file = join(CACHE, name)
  if (!existsSync(file)) make(file)
  return readFileSync(file)
}

// A 6 s dark clip with movement and sound, like a club clip (the Recreate source).
const sourceClip = () => cached('seed-source-6s.mp4', f => ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=6', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-vf', 'eq=brightness=-0.35,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', f]))
// A 4 s clip for the Library (an uploaded clip of Callie's).
const libraryClip = () => cached('seed-library-4s.mp4', f => ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=540x960:r=30:d=4', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', f]))
// A 3 s voice take (a wavering tone; the mock voice keeps its length).
const voiceTake = () => cached('seed-voice-3s.m4a', f => ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*(180+40*sin(2*PI*3*t))*t)':d=3", '-c:a', 'aac', f]))
// The music bed the editor specs used: 12 s, a click every half second (120 BPM) over a low tone.
export const musicBed = () => cached('beat-120.m4a', f => ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=110:duration=12', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.04),sin(2*PI*1500*t),0)':d=12", '-filter_complex', 'amix=inputs=2:weights=1 3', '-c:a', 'aac', f]))

type Character = { id: string; name: string; progress?: { approved: number } }

async function character(s: Studio, name: string, markdown: string, hue: number): Promise<string> {
  const { characters } = await s.call<{ characters: Character[] }>('GET', '/characters')
  const have = characters.find(c => c.name === name)
  if (have && (have.progress?.approved ?? 0) >= 12) { s.log(`${name}: already here (${have.id})`); return have.id }
  // The sheet as the owner's folder holds it: REF-00 to REF-11.
  const uploads: { uploadId: string; name: string; type: string }[] = []
  for (let i = 0; i <= 11; i++) {
    const file = `REF-${String(i).padStart(2, '0')}.png`
    uploads.push({ uploadId: await s.upload(await portrait(`${name} ${file}`, hue + i * 3), file, 'image/png'), name: file, type: 'image/png' })
  }
  const r = await s.call<{ characterId: string; importedShots: string[]; checkJobId: string | null }>('POST', '/characters/import', { markdown, uploads, ...(have ? { characterId: have.id } : {}) })
  if (r.importedShots.length < 12) throw new Error(`${name}: only ${r.importedShots.length} sheet shots imported`)
  if (r.checkJobId) await s.jobs([r.checkJobId], `${name}'s sheet check`)
  s.log(`${name}: imported with 12 approved REF images (${r.characterId})`)
  return r.characterId
}

// SideStep, the owner's starter kit (Products, UX-PLAN section 29): the
// owner's account gets it with its first product list; loaded here if not.
async function product(s: Studio): Promise<string> {
  const find = async () => (await s.call<{ products: { id: string; name: string }[] }>('GET', '/products')).products.find(p => p.name === 'SideStep')
  let p = await find()
  if (!p) { await s.call('POST', '/products/import', { starter: true }); p = await find() }
  if (!p) throw new Error('SideStep is not in the product list.')
  s.log(`SideStep: the product (${p.id})`)
  return p.id
}

async function libraryItems(s: Studio, callie: string): Promise<{ stills: string[]; clip: string }> {
  const ups = []
  for (const [i, hue] of [[1, 20], [2, 200]] as const) {
    const name = `e2e-library-still-${i}.png`
    ups.push({ uploadId: await s.upload(await portrait(`Library still ${i}`, hue), name, 'image/png'), name, type: 'image/png' })
  }
  const { stills } = await s.call<{ stills: { id: string }[] }>('POST', `/characters/${callie}/stills`, { uploads: ups })
  const uploadId = await s.upload(libraryClip(), 'e2e-library-clip.mp4', 'video/mp4')
  const { id } = await s.call<{ id: string }>('POST', `/characters/${callie}/clips`, { uploadId, name: 'e2e-library-clip.mp4' })
  await s.until('the Library clip', async () => {
    const lib = await s.call<{ clips: { id: string; status: string }[] }>('GET', `/library?characterId=${callie}`)
    const c = lib.clips.find(x => x.id === id)
    if (c?.status === 'failed') throw new Error('The Library clip failed to prepare.')
    return c?.status === 'approved' ? c : null
  })
  s.log(`Library: 2 stills and 1 clip for Callie`)
  return { stills: stills.map(x => x.id), clip: id }
}

type SceneCand = { id: string; op: string; media: 'image' | 'video'; status: string; assetId: string | null; createdAt: string }

// A video post made the way the owner makes one: the idea, a scene, a still
// (Use this still), a 5 s take from it (Use this take).
async function basePost(s: Studio, callie: string): Promise<string> {
  const { id } = await s.call<{ id: string }>('POST', '/content', { kind: 'meme', characterId: callie, title: 'E2E base post', idea: 'Callie laughing at her laptop at the kitchen table' })
  const { sceneId } = await s.call<{ sceneId: string }>('POST', `/content/${id}/scene`)
  const cands = async () => (await s.call<{ scenes: { id: string; candidates: SceneCand[] }[] }>('GET', `/characters/${callie}/scenes`)).scenes.find(x => x.id === sceneId)!.candidates
  await s.jobs(await s.run({ type: 'scene', characterId: callie, sceneId, models: ['higgsfield/nano-banana-2.1'], variations: 1 }), 'the base post still')
  const still = await s.until('the base post still', async () => (await cands()).find(c => c.media === 'image' && c.assetId))
  await s.call('PATCH', `/content/${id}`, { spec: { stillId: still.id }, step: 'video' })
  await s.jobs(await s.run({ type: 'scene_video', characterId: callie, candidateId: still.id, motion: 'She laughs at the screen, then looks up at the camera.', durationSec: 5 }), 'the base post take')
  const take = await s.until('the base post take', async () => (await cands()).find(c => c.media === 'video' && c.assetId))
  await s.call('PATCH', `/content/${id}`, { spec: { clipId: take.id }, step: 'text' })
  const m = await s.call<{ media: { kind: string; role: string }[] }>('GET', `/content/${id}/editor`)
  if (m.media.filter(x => x.kind === 'video').length !== 1) throw new Error('The base post does not open with one take.')
  s.log(`base post: a 5 s take picked (${id})`)
  return id
}

async function voiceLine(s: Studio, callie: string): Promise<string> {
  const uploadId = await s.upload(voiceTake(), 'e2e-voice-take.m4a', 'audio/mp4')
  const { lines } = await s.call<{ lines: { id: string }[] }>('POST', '/voice-lines', { characterId: callie, takes: [{ uploadId, name: 'e2e-voice-take.m4a' }] })
  const id = lines[0]!.id
  const status = async () => (await s.call<{ lines: { id: string; status: string; error: string | null }[] }>('GET', '/voice-lines')).lines.find(l => l.id === id)!
  await s.until('the voice take', async () => { const l = await status(); if (l.status === 'failed') throw new Error(`voice take: ${l.error}`); return l.status === 'take' ? l : null })
  await s.jobs(await s.run({ type: 'voice_convert', soundIds: [id] }), 'the voice line')
  await s.until('the voice line', async () => ((await status()).status === 'ready' ? true : null))
  s.log(`voice line: ready (${id})`)
  return id
}

async function music(s: Studio): Promise<string> {
  const uploadId = await s.upload(musicBed(), 'e2e-beat-120.m4a', 'audio/mp4')
  const { id } = await s.call<{ id: string }>('POST', '/sounds', { uploadId, name: 'e2e-beat-120.m4a', kind: 'music', title: 'E2E beat 120' })
  await s.until('the music', async () => ((await s.call<{ sounds: { id: string; status: string }[] }>('GET', '/sounds')).sounds.find(x => x.id === id)?.status === 'ready' ? true : null))
  s.log(`music: ready (${id})`)
  return id
}

type CloneView = { id: string; assetId: string | null }

// Recreate from a real clip, as in the Studio: the source clip, 4 stills and
// the face pass, You pick, the motion run, the take kept.
async function recreatePost(s: Studio, callie: string, title: string): Promise<{ post: string; take: string }> {
  const { id } = await s.call<{ id: string }>('POST', '/content', { kind: 'meme', characterId: callie, title, idea: 'Callie recreates a dance clip' })
  const uploadId = await s.upload(sourceClip(), 'e2e-source-clip.mp4', 'video/mp4')
  await s.call('POST', `/content/${id}/clone-source`, { uploadId, name: 'e2e-source-clip.mp4' })
  await s.until('the Recreate source', async () => {
    const { item } = await s.call<{ item: { spec: { clone?: { assetId?: string | null; rawFrameId?: string | null } | null } } }>('GET', `/content/${id}`)
    return item.spec.clone?.assetId && item.spec.clone.rawFrameId ? true : null
  })
  await s.jobs(await s.run({ type: 'clone_still', contentId: id, characterId: callie }), 'the Recreate stills')
  // The face pass starts on the best still when the four are in.
  await s.until('the face pass', async () => {
    const { stills } = await s.call<{ stills: { pass: string; status: string; assetId: string | null }[] }>('GET', `/content/${id}/clone-stills`)
    const face = stills.filter(x => x.pass === 'face')
    return face.length && face.every(x => x.assetId || ['failed', 'skipped'].includes(x.status)) ? true : null
  })
  await s.call('POST', `/content/${id}/clone-stills/pick`, { characterId: callie })
  await s.jobs(await s.run({ type: 'clone', contentId: id, characterIds: [callie], mode: 'motion', looks: {}, keepSound: false }), 'the Recreate take')
  const take = await s.until('the Recreate take', async () => (await s.call<{ clones: CloneView[] }>('GET', `/content/${id}/clones`)).clones.find(c => c.assetId))
  await s.call('POST', `/clones/${take.id}/keep`, { acknowledge: true })
  s.log(`${title}: 4 stills, the face pass, a kept take (${id})`)
  return { post: id, take: take.id }
}

// `save` false: return the seed without writing seed.json (the API
// isolation test seeds its own in-process Studio).
export async function seed(api: string, log: Log = line => console.log(`[seed] ${line}`), opts: { save?: boolean } = {}): Promise<Seed> {
  const s = new Studio(api.replace(/\/$/, ''), log)
  const started = Date.now()
  // Never on a live Studio: every provider must be the mock.
  const me = await s.call<{ mode: string }>('GET', '/me')
  if (me.mode !== 'demo') throw new Error(`The Studio at ${api} is in ${me.mode} mode. The suite seeds and runs in demo mode only (nothing paid).`)
  const md = readFileSync(join(ROOT, 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  // Callie first: the oldest character files the plan's topic accounts.
  const callie = await character(s, 'Callie', md, 24)
  const solei = await character(s, 'Solei', md.replace(/Callie/g, 'Solei'), 300)
  const sideStep = await product(s)
  const lib = await libraryItems(s, callie)
  const [base, voice, bed] = [await basePost(s, callie), await voiceLine(s, callie), await music(s)]
  const rec = await recreatePost(s, callie, 'E2E Recreate')
  const takeRec = await recreatePost(s, callie, 'E2E Recreate (take spec)')
  const out: Seed = {
    api: s.api, createdAt: new Date().toISOString(), callie, solei, sideStep, stills: lib.stills, libraryClip: lib.clip,
    basePost: base, voiceLine: voice, music: bed, recreatePost: rec.post, recreateTake: rec.take, takeRecreatePost: takeRec.post,
  }
  if (opts.save !== false) {
    mkdirSync(dirname(SEED_FILE), { recursive: true })
    writeFileSync(SEED_FILE, `${JSON.stringify(out, null, 2)}\n`)
  }
  log(`done in ${Math.round((Date.now() - started) / 1000)} s${opts.save !== false ? `: ${SEED_FILE}` : ''}`)
  return out
}

// npm run e2e:seed (against E2E_API, default the local Studio on 8787).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed(process.env.E2E_API ?? 'http://localhost:8787/api/v1').catch(e => { console.error(e); process.exit(1) })
}
