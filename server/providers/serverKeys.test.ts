import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../testing/harness.js'
import { createRegistry } from './registry.js'
import { serverKeyFor } from './serverKeys.js'
import { users, memberships } from '../db/schema.js'
import { eq } from 'drizzle-orm'

// HF_CREDENTIALS serves the owner's own account only; a customer account
// never runs on the owner's balance.

let h: Harness
let ownerEmail = ''

beforeAll(async () => {
  h = await createHarness()
  const [m] = await h.deps.db.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.accountId, h.ctx.accountId))
  ownerEmail = m!.email
}, 120_000)
afterAll(async () => { await h?.close() })

describe('server key (HF_CREDENTIALS)', () => {
  it('belongs to the owner account only', async () => {
    const keys = { ownerEmail, higgsfield: 'kid_srv:secret_srv' }
    expect(await serverKeyFor(h.deps.db, keys, h.ctx.accountId, 'higgsfield')).toBe('kid_srv:secret_srv')
    const customer = await h.newAccount('Customer')
    expect(await serverKeyFor(h.deps.db, keys, customer.accountId, 'higgsfield')).toBeNull()
    expect(await serverKeyFor(h.deps.db, { ownerEmail, higgsfield: '' }, h.ctx.accountId, 'higgsfield')).toBeNull()
    expect(await serverKeyFor(h.deps.db, keys, h.ctx.accountId, 'anthropic')).toBeNull()
  })

  it('lets the owner run the API path without a key in Settings, and refuses a customer', async () => {
    const registry = createRegistry({
      db: h.deps.db, vault: h.deps.vault, config: h.deps.config, store: h.deps.store, loadAsset: async () => Buffer.alloc(0),
      serverKeys: { ownerEmail, higgsfield: 'kid_srv:secret_srv' },
    })
    await expect(registry.gen(h.ctx.accountId, 'higgsfield/gpt-image-2.5')).resolves.toMatchObject({ id: 'higgsfield' })
    const customer = await h.newAccount('Customer 2')
    await expect(registry.gen(customer.accountId, 'higgsfield/gpt-image-2.5')).rejects.toThrow(/Add your higgsfield API key/)
  })
})
