import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { API } from './helpers'

// The live site's media path, here (owner, 2026-10-15: the editor brought
// in the caption but not the take). In production a video's Studio address
// answers 302 to a presigned R2 link, and R2 adds its CORS header only to a
// request that names an allowed origin. A <video> on the post page asks
// with no origin, and the browser keeps both the redirect and that answer;
// the editor then fetched the same address, got the kept answer without a
// CORS header, and was refused. Nothing here is routed by Playwright
// (routing turns the browser's cache off, which would hide the bug): a
// small proxy plays the deployed Studio on its own port, and a fake R2 on
// another plays storage. Videos are served as VP9 (Playwright's Chromium
// has no H.264). Since the storage batch (owner, 2026-10-15) every file is
// a redirect, images and thumbnails too; `images: 'through'` plays the old
// rules (image bytes through the Studio). `transfer` counts what the
// Studio's API sends, as Vercel's origin transfer would.

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '..', '.out', 'cache')
mkdirSync(CACHE, { recursive: true })
const VITE = new URL(process.env.E2E_BASE ?? 'http://localhost:5173')
export const LIVE = 'http://localhost:5198'
export const R2 = 'http://localhost:5199'

export interface Live {
  // Storage refuses everything (the Studio then sends files in parts).
  refuse: boolean
  // The redirect is kept by the browser, as the live API did before the fix.
  keptRedirect: boolean
  hits: { origin: string | null; cors: boolean; id: string; w: number | null }[]
  proxied: number
  // 'redirect' (now, as production) or 'through' (the old rules).
  images: 'redirect' | 'through'
  transfer: { json: number; media: number; requests: number; redirects: number; byPath: Record<string, number> }
  close: () => Promise<void>
}

export const emptyTransfer = () => ({ json: 0, media: 0, requests: 0, redirects: 0, byPath: {} as Record<string, number> })
// "/api/v1/content/cnt_01.../editor?x=1" -> "GET /content/:id/editor"
const route = (method: string | undefined, url: string) => `${method} ${url.split('?')[0]!.replace('/api/v1', '').replace(/\/[a-z]+_[0-9a-z]{10,}/g, '/:id')}`

// The asset as the browser should get it: VP9 for video, MP3 for M4A sound.
async function playable(id: string, w: number | null = null): Promise<{ body: Buffer; type: string }> {
  const name = w ? `${id}.w${w}` : id
  const meta = join(CACHE, `${name}.type`)
  const file = join(CACHE, `${name}.r2`)
  if (existsSync(meta) && existsSync(file)) return { body: readFileSync(file), type: readFileSync(meta, 'utf8') }
  const r = await fetch(`${API}/assets/${id}/content${w ? `?w=${w}` : ''}`, { headers: { 'x-studio-request': '1' } })
  if (!r.ok) throw new Error(`asset ${id}: ${r.status}`)
  let type = r.headers.get('content-type') ?? 'application/octet-stream'
  let body = Buffer.from(await r.arrayBuffer())
  if (type.startsWith('video/')) {
    const src = join(CACHE, `${id}.src`), out = join(CACHE, `${id}.r2.webm`)
    writeFileSync(src, body)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libvpx-vp9', '-b:v', '1.5M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', out])
    body = readFileSync(out)
    type = 'video/webm'
  } else if (type.startsWith('audio/mp4')) {
    const src = join(CACHE, `${id}.m4a`), out = join(CACHE, `${id}.r2.mp3`)
    writeFileSync(src, body)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libmp3lame', '-b:a', '192k', out])
    body = readFileSync(out)
    type = 'audio/mpeg'
  }
  writeFileSync(file, body)
  writeFileSync(meta, type)
  return { body, type }
}

const kindOf = async (id: string) => (await playable(id)).type

let signed = 0
const presigned = (id: string, w: number | null = null) => `${R2}/${id}?${w ? `w=${w}&` : ''}X-Amz-Date=${Date.now()}-${signed++}&X-Amz-Signature=test`

function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: Buffer | string) {
  res.writeHead(status, headers)
  res.end(body)
}

// Forward a request to the Vite dev server (which proxies /api to the API).
// A browser that navigates away cancels its requests: the sockets close
// mid-stream, which is normal and must not end the test run.
const quiet = (...xs: Array<{ on: (e: 'error', f: () => void) => unknown }>) => { for (const x of xs) x.on('error', () => undefined) }

function forward(req: IncomingMessage, res: ServerResponse, rewrite?: (json: any) => void, count?: Live['transfer']) {
  quiet(req, res)
  const up = httpRequest({ host: VITE.hostname, port: VITE.port, path: req.url, method: req.method, headers: { ...req.headers, host: VITE.host } }, upRes => {
    quiet(upRes)
    // What the Studio's API sends (Vercel's origin transfer): JSON, or file
    // bytes when the old rules sent images through it.
    if (count && (req.url ?? '').startsWith('/api/v1/')) {
      count.requests++
      const json = (upRes.headers['content-type'] ?? '').includes('json')
      const key = route(req.method, req.url ?? '')
      upRes.on('data', (c: Buffer) => { if (json) count.json += c.length; else count.media += c.length; count.byPath[key] = (count.byPath[key] ?? 0) + c.length })
    }
    if (!rewrite || !(upRes.headers['content-type'] ?? '').includes('json')) {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers)
      return upRes.pipe(res)
    }
    const chunks: Buffer[] = []
    upRes.on('data', c => chunks.push(c))
    upRes.on('end', () => {
      let text = Buffer.concat(chunks).toString('utf8')
      try { const j = JSON.parse(text); rewrite(j); text = JSON.stringify(j) } catch { /* as is */ }
      const h = { ...upRes.headers }
      delete h['content-length']; delete h['content-encoding']; delete h['transfer-encoding']
      res.writeHead(upRes.statusCode ?? 502, h)
      res.end(text)
    })
  })
  up.on('error', e => send(res, 502, { 'content-type': 'text/plain' }, String(e)))
  req.pipe(up)
}

export async function startLive(): Promise<Live> {
  const live: Live = { refuse: false, keptRedirect: false, hits: [], proxied: 0, images: 'redirect', transfer: emptyTransfer(), close: async () => undefined }

  // Storage: the CORS header only for a request from the Studio's origin;
  // the answer may be kept by the browser (no Vary: Origin), as R2 does.
  const r2 = createServer((req, res) => {
    quiet(req, res)
    const origin = (req.headers.origin as string | undefined) ?? null
    const u = new URL(req.url ?? '/', R2)
    const id = u.pathname.slice(1)
    const w = u.searchParams.get('w') ? Number(u.searchParams.get('w')) : null
    const allowed = !live.refuse && origin === LIVE
    if (req.method === 'OPTIONS') return send(res, allowed ? 204 : 403, allowed ? { 'access-control-allow-origin': LIVE, 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': '*' } : {})
    live.hits.push({ origin, cors: allowed, id, w })
    if (live.refuse) return send(res, 403, { 'content-type': 'text/plain' }, 'refused')
    playable(id, w).then(({ body, type }) => {
      const h: Record<string, string> = { 'content-type': type, 'content-length': String(body.length), 'cache-control': 'max-age=3600', 'last-modified': 'Wed, 14 Oct 2026 10:00:00 GMT', etag: `"${id}"`, 'accept-ranges': 'bytes', 'cross-origin-resource-policy': 'cross-origin' }
      if (allowed) h['access-control-allow-origin'] = LIVE
      send(res, 200, h, body)
    }).catch(e => send(res, 500, {}, String(e)))
  })

  // The deployed Studio: same pages and API, with storage behind it.
  const studio = createServer(async (req, res) => {
    quiet(req, res)
    const url = new URL(req.url ?? '/', LIVE)
    const asset = url.pathname.match(/^\/api\/v1\/assets\/([^/]+)\/content$/)
    if (asset && req.method === 'GET' && !url.searchParams.get('download')) {
      const id = asset[1]!
      const w = url.searchParams.get('w') ? Number(url.searchParams.get('w')) : null
      try {
        if (url.searchParams.get('proxy')) {
          live.proxied++
          live.transfer.requests++
          const { body, type } = await playable(id)
          const PART = 4 * 1024 * 1024
          const m = /^bytes=(\d+)-(\d*)$/.exec((req.headers.range as string | undefined) ?? '')
          const start = m ? Number(m[1]) : 0
          if (start >= body.length) return send(res, 416, { 'content-range': `bytes */${body.length}` })
          const end = Math.min(m?.[2] ? Number(m[2]) : start + PART - 1, start + PART - 1, body.length - 1)
          live.transfer.media += end - start + 1
          return send(res, 206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${body.length}` }, body.subarray(start, end + 1))
        }
        const type = await kindOf(id)
        // Videos and sound were always redirects; images are now too.
        if (type.startsWith('video/') || type.startsWith('audio/') || live.images === 'redirect') {
          live.transfer.requests++
          live.transfer.redirects++
          return send(res, 302, { location: presigned(id, type.startsWith('image/') ? w : null), 'cache-control': live.keptRedirect ? 'private, max-age=600' : 'no-store' })
        }
      } catch (e) { return send(res, 500, {}, String(e)) }
    }
    // Each editor file and picker item carries a fresh direct link.
    if (req.method === 'GET' && /^\/api\/v1\/content\/[^/]+\/editor(\/media)?$/.test(url.pathname)) {
      return forward(req, res, j => {
        for (const m of j?.media ?? []) m.src = presigned(m.id)
        for (const g of j?.groups ?? []) for (const m of g.items ?? []) m.src = presigned(m.id)
      }, live.transfer)
    }
    forward(req, res, undefined, live.transfer)
  })
  // Vite's live reload socket goes straight through.
  for (const srv of [r2, studio]) srv.on('clientError', (_e, socket) => socket.destroy())
  studio.on('upgrade', (req, socket: Socket, head) => {
    socket.on('error', () => undefined)
    const up = connect(Number(VITE.port), VITE.hostname, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${k === 'host' ? VITE.host : v}`).join('\r\n')}\r\n\r\n`)
      up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    up.on('error', () => socket.destroy())
  })

  await new Promise<void>(r => r2.listen(Number(new URL(R2).port), r))
  await new Promise<void>(r => studio.listen(Number(new URL(LIVE).port), r))
  live.close = async () => {
    studio.closeAllConnections?.(); r2.closeAllConnections?.()
    await Promise.all([new Promise(r => studio.close(() => r(null))), new Promise(r => r2.close(() => r(null)))])
  }
  return live
}

// The editor, opened and settled (the take loaded or named in the bar).
export async function editorReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('body')).not.toContainText(/Opening the post|Loading |Adding the|Placing the|Ducking the music/, { timeout: 120_000 })
  await page.waitForTimeout(1200)
}
