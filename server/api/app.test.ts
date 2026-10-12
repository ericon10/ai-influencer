import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness'
import { createApp } from './app'
import { createPassphraseAuth } from '../auth/provider'
import { createAccount } from '../auth/accounts'
import { hashPassword } from '../lib/passwords'
import { registerPipelineHooks } from '../pipeline/hooks'
import { renderPlaceholderPortrait } from '../providers/mock'
import { providerCredentials } from '../db/schema'

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

  it('stores provider keys encrypted and only ever returns the last 4', async () => {
    const r = await call('PUT', '/settings/credentials/anthropic', { body: { secret: 'sk-ant-test-1234567890-ABCD' }, cookie: cookieA })
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
    const bad = await call('PUT', '/settings/credentials/higgsfield', { body: { secret: 'just-one-part-key' }, cookie: cookieB })
    expect(bad.status).toBe(400)
    expect(bad.json.error.message).toMatch(/KEY_ID:KEY_SECRET/)
  })

  it('answers unknown webhooks with 404 and no detail', async () => {
    const r = await call('POST', '/webhooks/higgsfield/job_nope?t=abc', { csrf: false })
    expect(r.status).toBe(404)
  })

  it('updates budgets', async () => {
    const r = await call('PUT', '/settings/budgets', { body: { job: 5, month: 300, warnPct: 75 }, cookie: cookieA })
    expect(r.json.budgets).toMatchObject({ job: 5, month: 300, warnPct: 75 })
  })
})
