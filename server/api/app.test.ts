import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { createApp } from './app.js'
import { createPassphraseAuth } from '../auth/provider.js'
import { createAccount } from '../auth/accounts.js'
import { hashPassword } from '../lib/passwords.js'
import { registerPipelineHooks } from '../pipeline/hooks.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { candidates, providerCredentials } from '../db/schema.js'
import { saveAsset } from '../storage/assets.js'
import { newId } from '../lib/ids.js'

let h: Harness
let app: ReturnType<typeof createApp>
let cookieA = ''
let cookieB = ''

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; csrf?: boolean; form?: FormData } = {}) {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.csrf !== false && method !== 'GET') headers['x-studio-request'] = '1'
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['content-type'] = 'application/json' }
  const res = await app.request(`/api/v1${path}`, { method, headers, body })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, headers: res.headers }
}

async function login(email: string, passphrase: string): Promise<string> {
  const r = await call('POST', '/auth/login', { body: { email, passphrase } })
  expect(r.status).toBe(200)
  return r.headers.get('set-cookie')!.split(';')[0]!
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  app = createApp(h.deps, createPassphraseAuth(h.deps, { devAutoLogin: false }))
  await createAccount(h.deps.db, { name: 'Studio A', ownerEmail: 'a@example.com', passwordHash: await hashPassword('correct horse battery') })
  await createAccount(h.deps.db, { name: 'Studio B', ownerEmail: 'b@example.com', passwordHash: await hashPassword('another long phrase') })
  cookieA = await login('a@example.com', 'correct horse battery')
  cookieB = await login('b@example.com', 'another long phrase')
}, 120_000)

afterAll(async () => { await h.close() })

describe('Studio API', () => {
  it('requires a session', async () => {
    expect((await call('GET', '/characters')).status).toBe(401)
    expect((await call('POST', '/auth/login', { body: { email: 'a@example.com', passphrase: 'wrong' } })).status).toBe(401)
  })

  it('pauses sign-in after repeated wrong passphrases, per email', async () => {
    await createAccount(h.deps.db, { name: 'Studio C', ownerEmail: 'c@example.com', passwordHash: await hashPassword('third long phrase') })
    const attempt = (passphrase: string, email = 'c@example.com') => call('POST', '/auth/login', { body: { email, passphrase } })
    // A good sign-in clears earlier strikes.
    for (let i = 0; i < 4; i++) expect((await attempt('wrong')).status).toBe(401)
    expect((await attempt('third long phrase')).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await attempt('wrong')).status).toBe(401)
    const paused = await attempt('third long phrase')
    expect(paused.status).toBe(429)
    expect(paused.json.error.message).toMatch(/Too many sign-in attempts/)
    // Other people are not locked out.
    expect((await attempt('another long phrase', 'b@example.com')).status).toBe(200)
  })

  it('requires the CSRF header on writes', async () => {
    const r = await call('POST', '/characters', { body: { name: 'x' }, cookie: cookieA, csrf: false })
    expect(r.status).toBe(403)
  })

  it('creates and reads a character, private to its account', async () => {
    const created = await call('POST', '/characters', { body: { name: 'Callie' }, cookie: cookieA })
    expect(created.status).toBe(201)
    const id = created.json.id
    const view = await call('GET', `/characters/${id}`, { cookie: cookieA })
    expect(view.json).toMatchObject({ name: 'Callie', stage: 1 })
    expect(view.json.sheet.shots).toHaveLength(12)
    expect(view.json.reasons.map((r: { id: string }) => r.id)).toContain('mark_wrong_side')
    expect((await call('GET', `/characters/${id}`, { cookie: cookieB })).status).toBe(404)
    expect((await call('GET', '/characters', { cookie: cookieB })).json.characters).toHaveLength(0)
  })

  it('estimates, then runs only with the quote', async () => {
    const id = (await call('POST', '/characters', { body: { name: 'Run test' }, cookie: cookieA })).json.id
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(await renderPlaceholderPortrait('insp'))], { type: 'image/png' }), 'insp.png')
    expect((await call('POST', `/characters/${id}/inspirations`, { cookie: cookieA, form })).status).toBe(201)

    const action = { type: 'breakdown', characterId: id }
    const est = await call('POST', '/actions/estimate', { body: { action }, cookie: cookieA })
    expect(est.status).toBe(200)
    expect(est.json.quote.total).toMatch(/^\$/)
    expect(est.json.preview.prompts[0].wrapped.split('\n').every((l: string) => l.length <= 72)).toBe(true)

    expect((await call('POST', '/actions/run', { body: { action, quoteId: 'qte_nope' }, cookie: cookieA })).json.error.code).toBe('quote_required')
    const run = await call('POST', '/actions/run', { body: { action, quoteId: est.json.quote.id }, cookie: cookieA })
    expect(run.status).toBe(202)
    await drain(h)
    const jobs = await call('GET', `/jobs?characterId=${id}`, { cookie: cookieA })
    expect(jobs.json.jobs[0]).toMatchObject({ status: 'completed', label: 'Keep and Change breakdown' })
    expect((await call('GET', `/characters/${id}`, { cookie: cookieA })).json.breakdown.keep.length).toBeGreaterThan(0)
  })

  it('serves assets only to their account, with thumbnails', async () => {
    const id = (await call('POST', '/characters', { body: { name: 'Asset test' }, cookie: cookieA })).json.id
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(await renderPlaceholderPortrait('a'))], { type: 'image/png' }), 'a.png')
    const assetId = (await call('POST', `/characters/${id}/inspirations`, { cookie: cookieA, form })).json.assetId
    const own = await app.request(`/api/v1/assets/${assetId}/content?w=200`, { headers: { cookie: cookieA } })
    expect(own.status).toBe(200)
    expect(own.headers.get('content-type')).toBe('image/webp')
    const other = await app.request(`/api/v1/assets/${assetId}/content`, { headers: { cookie: cookieB } })
    expect(other.status).toBe(404)
  })

  it('every file comes from storage by a redirect (thumbnails too); the editor\'s fallback sends parts of at most 4 MB; originals are never shrunk', async () => {
    const id = (await call('POST', '/characters', { body: { name: 'Proxy test' }, cookie: cookieA })).json.id
    // Noise compresses badly: a PNG over 4 MB.
    const noise = Buffer.alloc(1400 * 1300 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
    const png = await sharp(noise, { raw: { width: 1400, height: 1300, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
    expect(png.length).toBeGreaterThan(4 * 1024 * 1024)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'big.png')
    const assetId = (await call('POST', `/characters/${id}/inspirations`, { cookie: cookieA, form })).json.assetId
    const mem = h.deps.store
    ;(h.deps as { store: typeof mem }).store = { ...mem, driver: 's3', presignGet: async (key: string) => `https://r2.test/${key}?sig=1` }
    try {
      const get = (q: string, range?: string) => app.request(`/api/v1/assets/${assetId}/content${q}`, { headers: { cookie: cookieA, ...(range ? { range } : {}) } })
      // Over 4 MB: the original comes straight from storage (a Vercel
      // response is capped at 4.5 MB), never a smaller copy.
      const direct = await get('')
      expect(direct.status).toBe(302)
      expect(direct.headers.get('location')).toMatch(/^https:\/\/r2\.test\/acct\//)
      // The fallback: same origin, parts of at most 4 MB, the whole file.
      const first = await get('?proxy=1', 'bytes=0-')
      expect(first.status).toBe(206)
      const firstBytes = Buffer.from(await first.arrayBuffer())
      expect(firstBytes.length).toBe(4 * 1024 * 1024)
      expect(first.headers.get('content-range')).toBe(`bytes 0-${4 * 1024 * 1024 - 1}/${png.length}`)
      const rest = await get('?proxy=1', `bytes=${4 * 1024 * 1024}-${8 * 1024 * 1024 - 1}`)
      expect(rest.status).toBe(206)
      expect(Buffer.concat([firstBytes, Buffer.from(await rest.arrayBuffer())]).equals(png)).toBe(true)
      expect((await get('?proxy=1', `bytes=${png.length}-`)).status).toBe(416)
      // Thumbnails too (owner, 2026-10-15: Vercel moves only JSON): made
      // once as WebP next to the original, then a redirect to storage.
      const thumb = await get('?w=300')
      expect(thumb.status).toBe(302)
      expect(thumb.headers.get('location')).toMatch(/\.w320\.webp\?sig=1$/)
      const kept = thumb.headers.get('location')!.replace('https://r2.test/', '').replace('?sig=1', '')
      expect(await mem.exists(kept)).toBe(true)
      // A page that reads files with CORS gets its own link (signed apart).
      const corsLinks: string[] = []
      ;(h.deps as { store: typeof mem }).store = { ...mem, driver: 's3', presignGet: async (key: string, _t: number, o?: { cors?: boolean }) => { if (o?.cors) corsLinks.push(key); return `https://r2.test/${key}?sig=${o?.cors ? 'cors' : '1'}` } }
      expect((await get('?w=300&cors=1')).headers.get('location')).toMatch(/\.w320\.webp\?sig=cors$/)
      expect(corsLinks).toHaveLength(1)
      // Another account gets nothing.
      expect((await app.request(`/api/v1/assets/${assetId}/content?proxy=1`, { headers: { cookie: cookieB, range: 'bytes=0-' } })).status).toBe(404)
    } finally {
      ;(h.deps as { store: typeof mem }).store = mem
    }
  })

  it('Delete and the Trash: check, move, list, restore; the storage readout and Auto-clean; one account never touches another', async () => {
    const characterId = (await call('POST', '/characters', { body: { name: 'Trash test' }, cookie: cookieA })).json.id
    const accountId = (await call('GET', '/me', { cookie: cookieA })).json.accountId
    const png = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#a87' } }).png().toBuffer()
    const asset = await saveAsset(h.deps, { ...h.ctx, accountId }, { data: png, origin: 'upload' })
    const id = newId('cand')
    await h.deps.db.insert(candidates).values({ id, accountId, characterId, target: 'scene', op: 'upload_image', label: 'Beach', assetId: asset.id, status: 'approved' })
    const items = [{ kind: 'candidate', id }]
    expect((await call('POST', '/trash/check', { body: { items }, cookie: cookieA })).json.warnings).toEqual([])
    // Another account can neither move it nor see it.
    expect((await call('POST', '/trash', { body: { items }, cookie: cookieB })).json.moved).toBe(0)
    const moved = await call('POST', '/trash', { body: { items }, cookie: cookieA })
    expect(moved.json).toMatchObject({ moved: 1, ids: [expect.stringMatching(/^trash_/)] })
    expect((await call('GET', '/trash', { cookie: cookieB })).json.items).toEqual([])
    const list = await call('GET', '/trash', { cookie: cookieA })
    expect(list.json).toMatchObject({ days: 7, items: [{ refId: id, label: 'Beach', reason: 'owner', daysLeft: 7 }] })
    expect((await call('GET', `/library?characterId=${characterId}`, { cookie: cookieA })).json.stills).toEqual([])
    expect((await call('POST', '/trash/restore', { body: { ids: moved.json.ids }, cookie: cookieB })).json.restored).toBe(0)
    expect((await call('POST', '/trash/restore', { body: { ids: moved.json.ids }, cookie: cookieA })).json.restored).toBe(1)
    expect((await call('GET', `/library?characterId=${characterId}`, { cookie: cookieA })).json.stills.map((s: { id: string }) => s.id)).toEqual([id])
    // Bad input is refused, not guessed.
    expect((await call('POST', '/trash', { body: { items: [{ kind: 'everything', id }] }, cookie: cookieA })).status).toBe(400)
    // Settings > Storage: the readout and Auto-clean (14 days, a choice, or Off).
    const storage = await call('GET', '/settings/storage', { cookie: cookieA })
    expect(storage.json).toMatchObject({ autoCleanDays: 14, autoCleanChoices: [3, 7, 14, 30], trashDays: 7, uploadSlotDays: 1, worker: expect.any(Object) })
    expect((await call('PUT', '/settings/storage/auto-clean', { body: { days: null }, cookie: cookieA })).json.autoCleanDays).toBeNull()
    expect((await call('PUT', '/settings/storage/auto-clean', { body: { days: 9 }, cookie: cookieA })).status).toBe(400)
    expect((await call('PUT', '/settings/storage/auto-clean', { body: { days: 14 }, cookie: cookieA })).json.autoCleanDays).toBe(14)
    expect((await call('GET', '/settings/storage', { cookie: cookieB })).json.autoCleanDays).toBe(14)
    // The next Auto-clean, listed first; the first run waits for Start.
    expect((await call('GET', '/settings/storage/auto-clean/preview', { cookie: cookieA })).json).toMatchObject({ days: 14, started: false, items: [] })
    expect((await call('GET', '/settings/storage', { cookie: cookieA })).json).toMatchObject({ autoCleanNext: 0, autoCleanStarted: false })
    expect((await call('POST', '/settings/storage/auto-clean/start', { body: {}, cookie: cookieA })).json.autoCleanStarted).toBe(true)
    expect((await call('GET', '/settings/storage', { cookie: cookieB })).json.autoCleanStarted).toBe(false)
    await drain(h)
    expect((await call('POST', '/settings/storage/measure', { body: {}, cookie: cookieA })).json).toEqual({ queued: true })
    await drain(h)
    expect((await call('GET', '/settings/storage', { cookie: cookieA })).json.usage).toMatchObject({ files: expect.any(Number), bytes: expect.any(Number) })
  })

  it("imports Callie's file, then adds her sheet images to the same character", async () => {
    const md = readFileSync(join(process.cwd(), 'fixtures/callie/character-callie.md'))
    const form = new FormData()
    form.append('file', new Blob([md], { type: 'text/markdown' }), 'character-callie.md')
    const created = await call('POST', '/characters/import', { cookie: cookieA, form })
    expect(created.status).toBe(201)
    expect(created.json.importedShots).toEqual([])
    expect(created.json.warnings.join(' ')).toMatch(/Element "Callie"/)
    const id = created.json.characterId

    const png = async (label: string) => new Blob([new Uint8Array(await renderPlaceholderPortrait(label))], { type: 'image/png' })
    const imgs = new FormData()
    imgs.append('images', await png('ref00'), 'REF-00.png')
    imgs.append('images', await png('ref01'), 'REF-01.png')
    imgs.append('images', await png('ref04 mirrored'), 'REF-04-mirrored.png')
    const added = await call('POST', `/characters/${id}/import-file`, { cookie: cookieA, form: imgs })
    expect(added.status).toBe(200)
    // The mirrored copy is a QA fixture: it waits to be checked, never a sheet shot.
    expect(added.json.importedShots).toEqual(['REF-00', 'REF-01'])
    expect(added.json.checkShots).toEqual(['REF-04-mirrored.png'])
    const ref04 = (added.json.view.sheet.shots as Array<{ id: string; status: string; candidates: Array<{ status: string }> }>).find(s => s.id === 'REF-04')!
    expect(ref04.status).toBe('pending')
    expect(ref04.candidates.map(c => c.status)).toEqual(['check'])
    expect(added.json.view.data.identities.map((i: { name: string }) => i.name)).toEqual(['Callie', 'Callie'])

    // A new REF-00 replaces the old one and sends REF-01 back for a re-check.
    const again = new FormData()
    again.append('images', await png('ref00 v2'), 'REF-00.png')
    const replaced = await call('POST', `/characters/${id}/import-file`, { cookie: cookieA, form: again })
    const shots = replaced.json.view.sheet.shots as Array<{ id: string; status: string }>
    expect(shots.find(s => s.id === 'REF-00')!.status).toBe('approved')
    expect(shots.find(s => s.id === 'REF-01')!.status).toBe('stale')

    // Another account cannot touch her.
    const foreign = await call('POST', `/characters/${id}/import-file`, { cookie: cookieB, form: again })
    expect(foreign.status).toBe(404)
  })

  it('checks a file against the template, updates the character of the same name, and edits the brand layer', async () => {
    const md = readFileSync(join(process.cwd(), 'fixtures/template/character-wren.md'), 'utf8')
    // The free check: nothing missing, no match yet in this account.
    const first = await call('POST', '/characters/import/check', { cookie: cookieB, body: { markdown: md } })
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ name: 'Wren', match: null, report: { complete: true } })
    const made = await call('POST', '/characters/import', { cookie: cookieB, body: { markdown: md } })
    expect(made.status).toBe(201)
    const id = made.json.characterId as string
    expect(id).toMatch(/^chr_[a-z0-9]{8,40}$/)
    expect((await call('POST', '/characters/import/check', { cookie: cookieB, body: { markdown: md } })).json.match).toEqual({ id, name: 'Wren' })
    // Another account does not see her as a match, and cannot update her.
    expect((await call('POST', '/characters/import/check', { cookie: cookieA, body: { markdown: md } })).json.match).toBeNull()
    expect((await call('POST', '/characters/import', { cookie: cookieA, body: { markdown: md, characterId: id } })).status).toBe(404)
    // The same file again with her id: an update, the same character.
    const updated = await call('POST', '/characters/import', { cookie: cookieB, body: { markdown: md, characterId: id } })
    expect(updated.status).toBe(200)
    expect(updated.json).toMatchObject({ characterId: id, updated: true })
    expect((await call('POST', '/characters/import', { cookie: cookieB, body: { markdown: md, characterId: 'chr_NOPE' } })).status).toBe(400)
    // The brand layer, written into the file.
    const brand = await call('PUT', `/characters/${id}/brand`, { cookie: cookieB, body: { statement: 'Wren, the slow trail runner', winningStack: ['The mishap in the first second'] } })
    expect(brand.status).toBe(200)
    expect(brand.json.brand).toMatchObject({ statement: 'Wren, the slow trail runner', winningStack: ['The mishap in the first second'] })
    expect((await call('PUT', `/characters/${id}/brand`, { cookie: cookieB, body: { series: 'not a list' } })).status).toBe(400)
    expect((await call('PUT', `/characters/${id}/brand`, { cookie: cookieA, body: { statement: 'x' } })).status).toBe(404)
    const view = await call('GET', `/characters/${id}`, { cookie: cookieB })
    expect(view.json.brand.statement).toBe('Wren, the slow trail runner')
    expect(view.json.template.complete).toBe(true)
  })

  it("imports a dropped sheet folder: direct uploads, 'REF 00' names normalized, then a free face and texture check", async () => {
    const md = readFileSync(join(process.cwd(), 'fixtures/callie/character-callie.md'), 'utf8')
    const face = readFileSync(join(process.cwd(), 'fixtures/faces/person-a-1.jpg'))
    const files = [
      { name: 'REF 00.jpg', type: 'image/jpeg', data: face },
      { name: 'REF 01.jpg', type: 'image/jpeg', data: face },
      { name: 'notes.txt', type: 'image/jpeg', data: face },
    ]
    // 1. Ask for upload slots (local storage here, so the slot is the API's own).
    const slots = await call('POST', '/uploads', { cookie: cookieA, body: { files: files.map(f => ({ name: f.name, type: f.type, size: f.data.length })) } })
    expect(slots.status).toBe(200)
    expect(slots.json.direct).toBe(false)
    // 2. PUT each file to its slot.
    for (const [i, slot] of slots.json.slots.entries()) {
      const res = await app.request(slot.url, { method: 'PUT', headers: { cookie: cookieA, 'x-studio-request': '1', 'content-type': files[i]!.type }, body: new Uint8Array(files[i]!.data) })
      expect(res.status).toBe(200)
    }
    // Another account cannot use these upload ids.
    const stolen = await call('POST', '/characters/import', { cookie: cookieB, body: { markdown: md, uploads: slots.json.slots.slice(0, 1).map((s: { uploadId: string; name: string }) => ({ uploadId: s.uploadId, name: s.name, type: 'image/jpeg' })) } })
    expect(stolen.status).toBe(400)
    // 3. Import the file with the uploads named by id.
    const r = await call('POST', '/characters/import', { cookie: cookieA, body: { markdown: md, uploads: slots.json.slots.map((s: { uploadId: string; name: string }, i: number) => ({ uploadId: s.uploadId, name: s.name, type: files[i]!.type })) } })
    expect(r.status).toBe(201)
    expect(r.json.importedShots).toEqual(['REF-00', 'REF-01'])
    expect(r.json.checkJobId).toMatch(/^job_/)
    await drain(h)
    const job = await call('GET', `/jobs?characterId=${r.json.characterId}`, { cookie: cookieA })
    const check = job.json.jobs.find((j: { purpose: string }) => j.purpose === 'import_check')
    expect(check.status).toBe('completed')
    expect(check.actual === null || check.actual === '$0.00').toBe(true)
    const view = await call('GET', `/characters/${r.json.characterId}`, { cookie: cookieA })
    const ref01 = view.json.sheet.shots.find((s: { id: string }) => s.id === 'REF-01')
    const approved = ref01.candidates.find((c: { id: string }) => c.id === ref01.approved.candidateId)
    // The same image as REF-00 keeps all of its skin detail.
    expect(approved.qaReport.texture.smoothed).toBe(false)
    expect(ref01.status).toBe('approved')
  })

  it('refuses unsupported upload types and oversized files', async () => {
    expect((await call('POST', '/uploads', { cookie: cookieA, body: { files: [{ name: 'x.exe', type: 'application/x-msdownload', size: 10 }] } })).status).toBe(400)
    expect((await call('POST', '/uploads', { cookie: cookieA, body: { files: [{ name: 'x.png', type: 'image/png', size: 30 * 1024 * 1024 }] } })).status).toBe(400)
  })

  it('saving or removing a key asks for the password again; wrong tries count toward the sign-in pause', async () => {
    const key = { secret: 'sk-ant-test-0000000000-WXYZ' }
    const none = await call('PUT', '/settings/credentials/anthropic', { body: key, cookie: cookieB })
    expect(none.status).toBe(403)
    expect(none.json.error.message).toMatch(/Enter your password/)
    const wrong = await call('PUT', '/settings/credentials/anthropic', { body: { ...key, password: 'not it' }, cookie: cookieB })
    expect(wrong.status).toBe(403)
    expect(wrong.json.error.message).toMatch(/not right/)
    expect((await call('GET', '/settings', { cookie: cookieB })).json.credentials).toHaveLength(0)
    expect((await call('GET', '/settings', { cookie: cookieB })).json.keyPassword).toBe(true)
    expect((await call('PUT', '/settings/credentials/anthropic', { body: { ...key, password: 'another long phrase' }, cookie: cookieB })).status).toBe(200)
    expect((await call('DELETE', '/settings/credentials/anthropic', { cookie: cookieB })).status).toBe(403)
    expect((await call('DELETE', '/settings/credentials/anthropic', { body: { password: 'nope' }, cookie: cookieB })).status).toBe(403)
    expect((await call('GET', '/settings', { cookie: cookieB })).json.credentials).toHaveLength(1)
    expect((await call('DELETE', '/settings/credentials/anthropic', { body: { password: 'another long phrase' }, cookie: cookieB })).status).toBe(200)
    expect((await call('GET', '/settings', { cookie: cookieB })).json.credentials).toHaveLength(0)
    // Five wrong passwords pause key changes, even with the right one.
    for (let i = 0; i < 3; i++) await call('PUT', '/settings/credentials/anthropic', { body: { ...key, password: `wrong ${i}` }, cookie: cookieB })
    const paused = await call('PUT', '/settings/credentials/anthropic', { body: { ...key, password: 'another long phrase' }, cookie: cookieB })
    expect(paused.status).toBe(429)
    h.clock.advance(16 * 60_000)
    expect((await call('PUT', '/settings/credentials/anthropic', { body: { ...key, password: 'another long phrase' }, cookie: cookieB })).status).toBe(200)
    expect((await call('DELETE', '/settings/credentials/anthropic', { body: { password: 'another long phrase' }, cookie: cookieB })).status).toBe(200)
  })

  it('stores provider keys encrypted and only ever returns the last 4', async () => {
    const r = await call('PUT', '/settings/credentials/anthropic', { body: { secret: 'sk-ant-test-1234567890-ABCD', password: 'correct horse battery' }, cookie: cookieA })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.json)).not.toContain('sk-ant-test')
    expect(r.json.credential.last4).toBe('ABCD')
    const [row] = await h.deps.db.select().from(providerCredentials).where(eq(providerCredentials.provider, 'anthropic'))
    expect(row!.envelope).not.toContain('sk-ant-test')
    const settings = await call('GET', '/settings', { cookie: cookieA })
    expect(JSON.stringify(settings.json)).not.toContain('sk-ant-test')
    expect((await call('GET', '/settings', { cookie: cookieB })).json.credentials).toHaveLength(0)
  })

  it('refuses live mode without keys, and rejects malformed Higgsfield keys', async () => {
    expect((await call('PUT', '/settings/mode', { body: { mode: 'live' }, cookie: cookieB })).status).toBe(400)
    const bad = await call('PUT', '/settings/credentials/higgsfield', { body: { secret: 'just-one-part-key', password: 'another long phrase' }, cookie: cookieB })
    expect(bad.status).toBe(400)
    expect(bad.json.error.message).toMatch(/KEY_ID:KEY_SECRET/)
  })

  it('answers unknown webhooks with 404 and no detail', async () => {
    const r = await call('POST', '/webhooks/higgsfield/job_nope?t=abc', { csrf: false })
    expect(r.status).toBe(404)
  })

  it('takes a model path only as the reference shows it, and changing it needs a new test', async () => {
    const bad = await call('PUT', '/settings/models', { cookie: cookieA, body: { ref: 'higgsfield/seedance-2.5', endpoint: 'https://evil.example.com/x' } })
    expect(bad.status).toBe(400)
    const ok = await call('PUT', '/settings/models', { cookie: cookieA, body: { ref: 'higgsfield/seedance-2.5', endpoint: 'bytedance/seedance-2.5/reference-to-video' } })
    expect(ok.status).toBe(200)
    const m = ok.json.models.find((x: { ref: string }) => x.ref === 'higgsfield/seedance-2.5')
    expect(m).toMatchObject({ endpoint: 'bytedance/seedance-2.5/reference-to-video', endpointSource: 'account', verified: false, confirmedAt: null })
    // Another account sees none of it: only the path from the official reference.
    const other = await call('GET', '/settings', { cookie: cookieB })
    expect(other.json.models.find((x: { ref: string }) => x.ref === 'higgsfield/seedance-2.5')).toMatchObject({ endpoint: 'bytedance/seedance-2.5/image-to-video', endpointSource: 'config' })
  })

  it('runs every Claude task on Sonnet 5.5 by default; any one can switch to Opus, per account', async () => {
    const before = await call('GET', '/settings', { cookie: cookieA })
    const tasks = before.json.claude.tasks as Array<{ task: string; label: string; model: string; changed: boolean }>
    expect(tasks.map(t => t.task).sort()).toEqual(['breakdown', 'card_update', 'concepts', 'content_writer', 'line_reviewer', 'line_tagger', 'line_voice', 'line_writer', 'prompt_writer', 'punch_up', 'qa_perception', 'scene_ideas', 'scene_plan'])
    // The prompt writer is on by default and has its own switch.
    expect(tasks.find(t => t.task === 'prompt_writer')).toMatchObject({ label: 'Prompt writer', rule: { id: 'scene-prompt-writer', on: true } })
    for (const t of tasks) expect(t).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', changed: false })
    expect(tasks.find(t => t.task === 'scene_ideas')!.label).toBe('Punch it up')
    expect(before.json.claude.choices.map((c: { label: string }) => c.label)).toEqual(['Claude Sonnet 5.5', 'Claude Opus 5.5'])

    const opus = await call('PUT', '/settings/claude', { cookie: cookieA, body: { task: 'scene_plan', model: 'anthropic/claude-opus-5-5' } })
    expect(opus.status).toBe(200)
    expect(opus.json.claude.tasks.find((t: { task: string }) => t.task === 'scene_plan')).toMatchObject({ model: 'anthropic/claude-opus-5-5', modelLabel: 'Claude Opus 5.5', changed: true })
    expect(opus.json.routing.find((r: { task: string }) => r.task === 'scene_plan').configured).toBe('anthropic/claude-sonnet-5-5')
    // Only this account, and only that task.
    const other = await call('GET', '/settings', { cookie: cookieB })
    expect(other.json.claude.tasks.find((t: { task: string }) => t.task === 'scene_plan').model).toBe('anthropic/claude-sonnet-5-5')
    expect(opus.json.claude.tasks.find((t: { task: string }) => t.task === 'qa_perception').model).toBe('anthropic/claude-sonnet-5-5')

    // Image tasks and models outside the choices are refused.
    expect((await call('PUT', '/settings/claude', { cookie: cookieA, body: { task: 'hero', model: 'anthropic/claude-opus-5-5' } })).status).toBe(400)
    expect((await call('PUT', '/settings/claude', { cookie: cookieA, body: { task: 'scene_plan', model: 'anthropic/claude-haiku-5-5' } })).status).toBe(400)

    const back = await call('PUT', '/settings/claude', { cookie: cookieA, body: { task: 'scene_plan', model: 'anthropic/claude-sonnet-5-5' } })
    expect(back.json.claude.tasks.find((t: { task: string }) => t.task === 'scene_plan')).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', changed: false })
  })

  it('names the model next to each price', async () => {
    const id = (await call('POST', '/characters', { body: { name: 'Label test' }, cookie: cookieA })).json.id
    const est = await call('POST', '/actions/estimate', { body: { action: { type: 'concepts', characterId: id, notes: 'late 20s, short dark hair' } }, cookie: cookieA })
    // Demo mode runs a free mock, and says so.
    expect(est.json.quote.models).toEqual(['Demo mock, free'])
    expect(est.json.quote.items[0].modelLabel).toBe('Demo mock, free')
  })

  it('updates budgets', async () => {
    const r = await call('PUT', '/settings/budgets', { body: { job: 5, month: 300, warnPct: 75 }, cookie: cookieA })
    expect(r.json.budgets).toMatchObject({ job: 5, month: 300, warnPct: 75 })
  })
})
