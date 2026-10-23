import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// A fake Google for the tests (UX-PLAN.md section 37, items 15 and 16): the
// sign-in (it sends the browser straight back with a code), the token
// exchange and refresh, and the Drive v3 calls the Studio makes (list and
// get files, make folders, multipart upload, replace a file's contents,
// rename). Everything is kept in memory; a CSV uploaded as a Google Sheet
// is kept as its CSV.

export interface FakeFile { id: string; name: string; mimeType: string; parents: string[]; data: Buffer; versions: number; modifiedTime: string }

export interface FakeDrive { url: string; files: () => FakeFile[]; byName: (name: string) => FakeFile | undefined; stop: () => Promise<void>; calls: string[]; putSheet: (name: string, csv: string, parent?: string) => FakeFile; editSheet: (id: string, csv: string) => void; scopes: { value: string } }

const body = (req: IncomingMessage) => new Promise<Buffer>((res, rej) => { const parts: Buffer[] = []; req.on('data', c => parts.push(c as Buffer)); req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej) })

export async function startFakeDrive(port = 0): Promise<FakeDrive> {
  const files = new Map<string, FakeFile>()
  const calls: string[] = []
  let n = 0
  let clock = Date.parse('2026-10-20T12:00:00Z')
  const stamp = () => new Date(clock += 60_000).toISOString()
  // The scopes the fake consent grants (a test can take read-only away).
  const scopes = { value: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly openid email' }
  // A sheet the owner made in Drive (the Studio did not make it).
  const putSheet = (name: string, csv: string, parent = 'root'): FakeFile => { const f = { id: `sheet${String(++n).padStart(5, '0')}xxxxxxxxxx`, name, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [parent], data: Buffer.from(csv), versions: 1, modifiedTime: stamp() }; files.set(f.id, f); return f }
  const editSheet = (id: string, csv: string) => { const f = files.get(id); if (!f) throw new Error(`no file ${id}`); f.data = Buffer.from(csv); f.versions++; f.modifiedTime = stamp() }
  const newId = () => `fake${String(++n).padStart(5, '0')}`
  const json = (res: import('node:http').ServerResponse, code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
  const view = (f: FakeFile) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, modifiedTime: f.modifiedTime })
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
        if (form.get('grant_type') === 'authorization_code') return json(res, 200, { access_token: 'fake-access', refresh_token: 'fake-refresh-token', expires_in: 3600, id_token: idToken, scope: scopes.value })
        return json(res, 200, { access_token: 'fake-access', expires_in: 3600 })
      }
      // For the browser tests: what is in the fake Drive (names, parents, sizes, versions).
      // For the browser tests: the owner makes or edits a sheet in Drive.
      if (u.pathname === '/__sheet' && req.method === 'POST') {
        const b = JSON.parse((await body(req)).toString()) as { id?: string; name?: string; csv: string; parent?: string }
        if (b.id) { editSheet(b.id, b.csv); return json(res, 200, view(files.get(b.id)!)) }
        return json(res, 200, view(putSheet(b.name ?? 'Plan', b.csv, b.parent)))
      }
      if (u.pathname === '/__scopes' && req.method === 'POST') { scopes.value = (await body(req)).toString(); return json(res, 200, { scopes: scopes.value }) }
      if (u.pathname === '/__files') return json(res, 200, { files: [...files.values()].map(f => ({ ...view(f), size: f.data.length, versions: f.versions, text: /csv|spreadsheet/.test(f.mimeType) || f.name.endsWith('.csv') ? f.data.toString('utf8') : undefined })) })
      if (req.headers.authorization !== 'Bearer fake-access') return json(res, 401, { error: { message: 'Invalid Credentials' } })
      // A Google Sheet's first tab as CSV.
      const ex = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/export$/)
      if (ex && req.method === 'GET') {
        const f = files.get(decodeURIComponent(ex[1]!))
        if (!f) return json(res, 404, { error: { message: 'File not found' } })
        if (f.mimeType !== 'application/vnd.google-apps.spreadsheet') return json(res, 403, { error: { message: 'Export only supports Docs Editors files.' } })
        res.writeHead(200, { 'content-type': 'text/csv' }); res.end(f.data); return
      }
      const m = u.pathname.match(/^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/)
      if (!m) return json(res, 404, { error: { message: 'not found' } })
      const [, upload, id] = m
      if (req.method === 'GET' && !id) {
        const q = u.searchParams.get('q') ?? ''
        const name = q.match(/name='((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'")
        const parent = q.match(/'([^']+)' in parents/)?.[1]
        const folder = /mimeType='application\/vnd\.google-apps\.folder'/.test(q)
        const sheet = /mimeType='application\/vnd\.google-apps\.spreadsheet'/.test(q)
        const contains = q.match(/name contains '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'").toLowerCase()
        const list = [...files.values()].filter(f => (!name || f.name === name) && (!contains || f.name.toLowerCase().includes(contains)) && (!parent || (parent === 'root' ? !f.parents.length || f.parents.includes('root') : f.parents.includes(parent))) && (!folder || f.mimeType === 'application/vnd.google-apps.folder') && (!sheet || f.mimeType === 'application/vnd.google-apps.spreadsheet'))
        if (u.searchParams.get('orderBy')?.startsWith('modifiedTime')) list.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
        return json(res, 200, { files: list.map(view) })
      }
      if (req.method === 'GET' && id) {
        const f = files.get(id)
        if (!f) return json(res, 404, { error: { message: 'File not found' } })
        if (u.searchParams.get('alt') === 'media') { res.writeHead(200, { 'content-type': f.mimeType }); res.end(f.data); return }
        // Without read-only Drive, Google hides files the Studio did not make.
        if (f.id.startsWith('sheet') && !scopes.value.includes('drive.readonly')) return json(res, 404, { error: { message: `File not found: ${f.id}.` } })
        return json(res, 200, view(f))
      }
      if (req.method === 'POST' && !upload) {
        const meta = JSON.parse((await body(req)).toString() || '{}') as { name: string; mimeType?: string; parents?: string[] }
        const f = { id: newId(), name: meta.name, mimeType: meta.mimeType ?? 'application/octet-stream', parents: meta.parents ?? ['root'], data: Buffer.alloc(0), versions: 1, modifiedTime: stamp() }
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
        const f = { id: newId(), name: meta.name, mimeType: meta.mimeType ?? /content-type: ([^\r\n]+)/i.exec(media.head)?.[1] ?? 'application/octet-stream', parents: meta.parents ?? ['root'], data: Buffer.from(media.body, 'latin1'), versions: 1, modifiedTime: stamp() }
        files.set(f.id, f); return json(res, 200, { id: f.id })
      }
      if (req.method === 'PATCH' && id) {
        const f = files.get(id)
        if (!f) return json(res, 404, { error: { message: 'File not found' } })
        const raw = await body(req)
        if (upload) { f.data = raw; f.versions++; f.modifiedTime = stamp() }
        else { const meta = JSON.parse(raw.toString() || '{}') as { name?: string }; if (meta.name) f.name = meta.name }
        return json(res, 200, { id: f.id })
      }
      return json(res, 405, { error: { message: 'method' } })
    } catch (e) { json(res, 500, { error: { message: (e as Error).message } }) }
  })
  await new Promise<void>(r => server.listen(port, '127.0.0.1', () => r()))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url, calls, files: () => [...files.values()], byName: name => [...files.values()].find(f => f.name === name), putSheet, editSheet, scopes,
    stop: () => new Promise<void>(r => server.close(() => r())),
  }
}
