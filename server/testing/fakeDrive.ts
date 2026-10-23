import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// A fake Google for the tests (UX-PLAN.md section 37, items 15 and 16): the
// sign-in (it sends the browser straight back with a code), the token
// exchange and refresh, and the Drive v3 calls the Studio makes (list and
// get files, make folders, multipart upload, replace a file's contents,
// rename). Everything is kept in memory; a CSV uploaded as a Google Sheet
// is kept as its CSV.

export interface FakeFile { id: string; name: string; mimeType: string; parents: string[]; data: Buffer; versions: number }

export interface FakeDrive { url: string; files: () => FakeFile[]; byName: (name: string) => FakeFile | undefined; stop: () => Promise<void>; calls: string[] }

const body = (req: IncomingMessage) => new Promise<Buffer>((res, rej) => { const parts: Buffer[] = []; req.on('data', c => parts.push(c as Buffer)); req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej) })

export async function startFakeDrive(port = 0): Promise<FakeDrive> {
  const files = new Map<string, FakeFile>()
  const calls: string[] = []
  let n = 0
  const newId = () => `fake${String(++n).padStart(5, '0')}`
  const json = (res: import('node:http').ServerResponse, code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
  const view = (f: FakeFile) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents })
  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    calls.push(`${req.method} ${u.pathname}`)
    try {
      if (u.pathname === '/o/oauth2/v2/auth') {
        const back = new URL(u.searchParams.get('redirect_uri')!)
        back.searchParams.set('code', 'fake-code')
        back.searchParams.set('state', u.searchParams.get('state') ?? '')
        res.writeHead(302, { location: back.toString() }); res.end(); return
      }
      if (u.pathname === '/token') {
        const form = new URLSearchParams((await body(req)).toString())
        const idToken = `x.${Buffer.from(JSON.stringify({ email: 'owner@example.com' })).toString('base64url')}.y`
        if (form.get('grant_type') === 'authorization_code') return json(res, 200, { access_token: 'fake-access', refresh_token: 'fake-refresh-token', expires_in: 3600, id_token: idToken })
        return json(res, 200, { access_token: 'fake-access', expires_in: 3600 })
      }
      // For the browser tests: what is in the fake Drive (names, parents, sizes, versions).
      if (u.pathname === '/__files') return json(res, 200, { files: [...files.values()].map(f => ({ ...view(f), size: f.data.length, versions: f.versions, text: /csv|spreadsheet/.test(f.mimeType) || f.name.endsWith('.csv') ? f.data.toString('utf8') : undefined })) })
      if (req.headers.authorization !== 'Bearer fake-access') return json(res, 401, { error: { message: 'Invalid Credentials' } })
      const m = u.pathname.match(/^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/)
      if (!m) return json(res, 404, { error: { message: 'not found' } })
      const [, upload, id] = m
      if (req.method === 'GET' && !id) {
        const q = u.searchParams.get('q') ?? ''
        const name = q.match(/name='((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'")
        const parent = q.match(/'([^']+)' in parents/)?.[1]
        const folder = /mimeType='application\/vnd\.google-apps\.folder'/.test(q)
        const list = [...files.values()].filter(f => (!name || f.name === name) && (!parent || (parent === 'root' ? !f.parents.length || f.parents.includes('root') : f.parents.includes(parent))) && (!folder || f.mimeType === 'application/vnd.google-apps.folder'))
        return json(res, 200, { files: list.map(view) })
      }
      if (req.method === 'GET' && id) { const f = files.get(id); return f ? json(res, 200, view(f)) : json(res, 404, { error: { message: 'File not found' } }) }
      if (req.method === 'POST' && !upload) {
        const meta = JSON.parse((await body(req)).toString() || '{}') as { name: string; mimeType?: string; parents?: string[] }
        const f = { id: newId(), name: meta.name, mimeType: meta.mimeType ?? 'application/octet-stream', parents: meta.parents ?? ['root'], data: Buffer.alloc(0), versions: 1 }
        files.set(f.id, f); return json(res, 200, view(f))
      }
      if (req.method === 'POST' && upload) {
        const raw = await body(req)
        const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'] ?? '')?.[1]
        if (!boundary) return json(res, 400, { error: { message: 'no boundary' } })
        const text = raw.toString('latin1')
        const parts = text.split(`--${boundary}`).filter(p => p.trim() && p.trim() !== '--')
        const part = (p: string) => { const at = p.indexOf('\r\n\r\n'); return { head: p.slice(0, at), body: p.slice(at + 4).replace(/\r\n$/, '') } }
        const meta = JSON.parse(part(parts[0]!).body) as { name: string; parents?: string[]; mimeType?: string }
        const media = part(parts[1]!)
        const f = { id: newId(), name: meta.name, mimeType: meta.mimeType ?? /content-type: ([^\r\n]+)/i.exec(media.head)?.[1] ?? 'application/octet-stream', parents: meta.parents ?? ['root'], data: Buffer.from(media.body, 'latin1'), versions: 1 }
        files.set(f.id, f); return json(res, 200, { id: f.id })
      }
      if (req.method === 'PATCH' && id) {
        const f = files.get(id)
        if (!f) return json(res, 404, { error: { message: 'File not found' } })
        const raw = await body(req)
        if (upload) { f.data = raw; f.versions++ }
        else { const meta = JSON.parse(raw.toString() || '{}') as { name?: string }; if (meta.name) f.name = meta.name }
        return json(res, 200, { id: f.id })
      }
      return json(res, 405, { error: { message: 'method' } })
    } catch (e) { json(res, 500, { error: { message: (e as Error).message } }) }
  })
  await new Promise<void>(r => server.listen(port, '127.0.0.1', () => r()))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url, calls, files: () => [...files.values()], byName: name => [...files.values()].find(f => f.name === name),
    stop: () => new Promise<void>(r => server.close(() => r())),
  }
}
