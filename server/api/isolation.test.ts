import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { serve, type ServerType } from '@hono/node-server'
import { createHarness, type Harness } from '../testing/harness.js'
import { createApp } from './app.js'
import { createPassphraseAuth, type AuthProvider } from '../auth/provider.js'
import { createAccount } from '../auth/accounts.js'
import { hashPassword } from '../lib/passwords.js'
import { registerPipelineHooks } from '../pipeline/hooks.js'
import { createFaceMatcher } from '../qa/faces.js'
import { tick } from '../jobs/runner.js'
import * as schema from '../db/schema.js'
import { seed } from '../../e2e/seed.js'

// Account isolation, route by route (multi-user, 2026-10-24). The owner's
// account (A) is filled the way the browser suite fills a Studio: two
// characters, the SideStep product, stills and a clip, a post with a take,
// a voice line, music, two Recreate posts. Then a customer (B) signs in and
// sends every API route A's ids: in the path, and in the body under every
// field name that carries an id. B never gets A's data back, A's records
// are byte for byte the same afterwards, and no record of B's points at
// anything of A's.

let h: Harness
let seeding: ServerType
let sweepApp: ReturnType<typeof createApp>
let cookieB = ''
let stopWorker = false
let worker: Promise<void> = Promise.resolve()

// Every table that belongs to an account.
const accountTables = (Object.values(schema) as unknown[]).filter((t): t is PgTable => is(t, PgTable) && 'accountId' in (t as object))

async function rowsOf(accountId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const t of accountTables) {
    const rows = await h.deps.db.select().from(t).where(eq((t as unknown as { accountId: Parameters<typeof eq>[0] }).accountId, accountId))
    out[getTableName(t)] = rows.map(r => JSON.parse(JSON.stringify(r))).sort((a, b) => String(a.id ?? JSON.stringify(a)).localeCompare(String(b.id ?? JSON.stringify(b))))
  }
  return out
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { cookie: cookieB }
  if (method !== 'GET') headers['x-studio-request'] = '1'
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await sweepApp.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, text: await res.text() }
}

beforeAll(async () => {
  const models = '.data/models'
  h = await createHarness({ faces: existsSync(`${models}/face_detection_yunet_2023mar.onnx`) ? createFaceMatcher({ modelsDir: models }) : undefined })
  registerPipelineHooks()
  // The worker, as on Railway: ticks while the seed waits on its jobs.
  worker = (async () => {
    while (!stopWorker) {
      await tick(h.deps, 20).catch(() => 0)
      h.clock.advance(2_000)
      await new Promise(r => setTimeout(r, 40))
    }
  })()
  // A: the harness's first account, the owner's, signed in as its owner.
  const [m] = await h.deps.db.select().from(schema.memberships).where(eq(schema.memberships.accountId, h.ctx.accountId))
  const asA: AuthProvider = {
    name: 'seed', authenticate: async () => ({ accountId: h.ctx.accountId, userId: m!.userId, role: 'owner', email: h.ctx.email }),
    login: async () => { throw new Error('no sign-in while seeding') }, logout: async () => undefined,
  }
  const seedApp = createApp(h.deps, asA)
  seeding = serve({ fetch: seedApp.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise<void>(r => seeding.once('listening', () => r()))
  const { port } = seeding.address() as AddressInfo
  await seed(`http://127.0.0.1:${port}/api/v1`, () => undefined, { save: false })
  stopWorker = true
  await worker
  // B: a customer's account with its own sign-in.
  await createAccount(h.deps.db, { name: 'Customer B', ownerEmail: 'b@customer.test', passwordHash: await hashPassword('customer b long phrase') })
  sweepApp = createApp(h.deps, createPassphraseAuth(h.deps, { devAutoLogin: false }))
  const login = await sweepApp.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ email: 'b@customer.test', passphrase: 'customer b long phrase' }) })
  expect(login.status).toBe(200)
  cookieB = login.headers.get('set-cookie')!.split(';')[0]!
}, 600_000)

afterAll(async () => {
  stopWorker = true
  await worker
  seeding?.close()
  await h?.close()
})

describe('a customer cannot reach another account through any route', () => {
  it('every route, A\'s ids in the path and the body: nothing of A comes back, A is unchanged, B holds nothing of A\'s', async () => {
    const before = await rowsOf(h.ctx.accountId)
    const [bAccount] = await h.deps.db.select().from(schema.accounts).where(eq(schema.accounts.name, 'Customer B'))

    // A's ids by table, and every id A has.
    const idsOf = (table: string) => (before[table] ?? []).map(r => String((r as { id?: unknown }).id ?? '')).filter(Boolean)
    const allIds = [...new Set(Object.values(before).flat().map(r => String((r as { id?: unknown }).id ?? '')).filter(x => x.length >= 8))]
    expect(allIds.length).toBeGreaterThan(50)
    const tables = Object.keys(before).filter(t => idsOf(t).length)
    // Words that only A's records hold (character names are not: shared
    // config notes name the owner's characters).
    const marks = ['E2E Recreate']

    // The path segment before :id names its table; anything else is tried
    // with an id from every table A has rows in.
    const bySegment: Record<string, string[]> = {
      characters: ['characters'], concepts: ['concepts', 'characters'], scenes: ['scenes'], candidates: ['candidates'], jobs: ['jobs'],
      assets: ['assets'], 'public/assets': ['assets'], 'library/items': ['assets', 'clips'], content: ['content_items'], 'line-bank/lines': ['bank_lines'],
      clones: ['clones'], broll: ['broll'], sounds: ['sounds', 'assets'], 'voice-lines': ['voice_lines'], products: ['products'], hooks: ['hooks'],
      'hook-variants': ['hook_variants'], 'weeks/sheets': ['week_sheets'], 'weeks/posts': ['content_items'], 'slide-scenes': ['slide_scenes'], uploads: ['upload_slots', 'uploads'],
      'settings/comfy/tasks': ['comfy_tasks'], 'library/collections': ['assets'],
    }
    const pick = (names: string[]) => names.flatMap(n => idsOf(n).slice(0, 2))
    const everyTable = tables.flatMap(t => idsOf(t).slice(0, 1))
    const valuesFor = (route: string, param: string): string[] => {
      if (param === 'id') {
        const seg = route.match(/\/api\/v1\/(.*?)\/:id/)?.[1] ?? ''
        const hit = pick(bySegment[seg] ?? [])
        return hit.length ? hit : everyTable
      }
      if (param === 'cid' || param === 'child') return [...pick(['clones', 'content_items'])]
      if (param === 'jobId') return pick(['jobs'])
      if (param === 'loraId') return pick(['comfy_loras']).length ? pick(['comfy_loras']) : ['lora_none']
      if (param === 'sid') return everyTable
      if (param === 'tag') return (before.social_accounts ?? []).map(r => String((r as { tag: string }).tag)).slice(0, 2).concat(['@callie'])
      if (param === 'refId') return ['REF-00']
      if (param === 'monday') return ['2026-10-12', '2026-10-19']
      if (param === 'slot') return ['0']
      if (param === 'provider') return ['anthropic', 'higgsfield']
      return everyTable
    }
    // A body with A's ids under every id-carrying field name.
    const one = (t: string) => idsOf(t)[0] ?? 'none'
    const body = {
      id: one('content_items'), characterId: one('characters'), contentId: one('content_items'), postId: one('content_items'), productId: one('products'),
      assetId: one('assets'), assetIds: idsOf('assets').slice(0, 3), stillId: one('assets'), clipId: one('assets'), takeId: one('assets'), jobId: one('jobs'),
      quoteId: one('quotes'), voiceLineId: one('voice_lines'), soundId: one('assets'), hookId: one('hooks'), sceneId: one('scenes'), candidateId: one('candidates'),
      ids: idsOf('content_items').slice(0, 3), itemIds: idsOf('assets').slice(0, 3), contentIds: idsOf('content_items').slice(0, 3), from: one('content_items'),
      action: { type: 'model_test', model: 'higgsfield/soul-2', contentId: one('content_items'), characterId: one('characters') },
    }

    const routes = [...new Map(sweepApp.routes.filter(r => r.method !== 'ALL').map(r => [`${r.method} ${r.path}`, r])).values()]
    const leaks: string[] = []
    let calls = 0
    for (const r of routes) {
      if (r.path === '/api/v1/auth/login' || r.path === '/api/v1/auth/logout') continue
      const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map(m => m[1]!)
      // Each param tried with each of its values, the others at their first.
      const variants: Record<string, string>[] = params.length
        ? params.flatMap(p => valuesFor(r.path, p).map(v => Object.fromEntries(params.map(q => [q, q === p ? v : valuesFor(r.path, q)[0]!]))))
        : [{}]
      for (const v of variants) {
        const path = r.path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(v[k]!))
        const tries = r.method === 'GET' ? [undefined] : [body, {}]
        for (const b of tries) {
          calls++
          const res = await call(r.method, path, b)
          const sent = new Set(Object.values(v))
          // A success never names anything of A's; an error may repeat the
          // id it was sent, nothing else.
          const named = allIds.filter(id => res.text.includes(id) && (res.status >= 400 ? !sent.has(id) : true))
          const words = marks.filter(w => res.text.includes(w))
          if (named.length || words.length) leaks.push(`${r.method} ${path} -> ${res.status}: ${[...named.slice(0, 3), ...words].join(', ')}`)
        }
      }
    }
    expect(calls).toBeGreaterThan(400)
    expect(leaks).toEqual([])

    // A's records are exactly as they were.
    expect(await rowsOf(h.ctx.accountId)).toEqual(before)
    // B's records (whatever B's own calls made) hold none of A's ids.
    const bAfter = JSON.stringify(await rowsOf(bAccount!.id))
    expect(allIds.filter(id => bAfter.includes(id))).toEqual([])
  }, 600_000)
})
