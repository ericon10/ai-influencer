import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../testing/harness'
import { createFakeHiggsfield, type FakeHiggsfield } from '../testing/fakeHiggsfield'
import { callbackPath, credentialFor, disconnect, finishConnect, liveConnection, startConnect } from './mcpConnections'
import { settingsView } from '../api/views'

// One connection flow for every MCP provider on the owner's own plan.
// Dzine AI is a slot only: listed as coming soon, and never called.

let h: Harness
let fake: FakeHiggsfield
let calls = 0

beforeAll(async () => {
  fake = createFakeHiggsfield()
  h = await createHarness({ fetchImpl: async (input, init) => { calls += 1; return fake.fetch(input, init) } })
}, 120_000)

afterAll(async () => { await h?.close() })

describe('shared MCP connection flow', () => {
  it('lists Higgsfield as live and Dzine AI as coming soon', async () => {
    const view = await settingsView(h.deps, h.ctx)
    expect(view.connections.map(c => [c.id, c.status, c.connected])).toEqual([['higgsfield', 'live', false], ['dzine', 'coming_soon', false]])
    expect(view.connections.find(c => c.id === 'dzine')).toMatchObject({ label: 'Dzine AI', site: 'https://www.dzine.ai' })
  })

  it('gives every provider its own callback and credential on the same flow', () => {
    expect(callbackPath('higgsfield')).toBe('/api/v1/oauth/higgsfield/callback')
    expect(callbackPath('dzine')).toBe('/api/v1/oauth/dzine/callback')
    expect(credentialFor('dzine')).toBe('dzine_account')
  })

  it('never calls Dzine: connecting, finishing and token use all refuse without a request', async () => {
    const before = calls
    await expect(startConnect(h.deps, h.ctx, 'dzine', { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })).rejects.toThrow(/Dzine AI is coming soon/)
    expect((await finishConnect(h.deps, 'dzine', { code: 'x', state: `${h.ctx.accountId}.y` })).ok).toBe(false)
    expect(() => liveConnection(h.deps.config, 'dzine')).toThrow(/coming soon/)
    expect(calls).toBe(before)
    expect(fake.registrations).toHaveLength(0)
  })

  it('starts a Higgsfield sign-in on the same code path', async () => {
    const { url } = await startConnect(h.deps, h.ctx, 'higgsfield', { origin: 'http://localhost:5173' }, { fetchImpl: fake.fetch })
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/v1/oauth/higgsfield/callback')
  })

  it('refuses unknown providers', async () => {
    await expect(startConnect(h.deps, h.ctx, 'nope', { origin: 'http://localhost:5173' })).rejects.toThrow(/Unknown connection/)
    await expect(disconnect(h.deps, h.ctx, 'nope')).rejects.toThrow(/Unknown connection/)
  })
})
