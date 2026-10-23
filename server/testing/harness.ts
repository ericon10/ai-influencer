import { randomBytes } from 'node:crypto'
import { openDb, type DbHandle } from '../db/client.js'
import { createMemoryStore } from '../storage/blobStore.js'
import { createKeyVault } from '../lib/vault.js'
import { loadConfig } from '../config/load.js'
import { logger } from '../lib/logger.js'
import { loadEnv } from '../lib/env.js'
import { createRegistry, type RegistryOptions } from '../providers/registry.js'
import { createAccount } from '../auth/accounts.js'
import { readAsset } from '../storage/assets.js'
import type { Ctx, Deps } from '../context.js'
import type { LlmProvider, ProviderAdapter } from '../providers/types.js'
import { unavailableFaceMatcher, type FaceMatcher } from '../qa/faces.js'

// Real providers are unreachable from tests: any call fails loudly, except
// the free key check, which answers locally.
const offline = (id: string): ProviderAdapter & LlmProvider => {
  const refuse = async (): Promise<never> => { throw new Error(`Tests never call the real ${id} API.`) }
  return {
    id, listModels: refuse, estimate: refuse, submit: refuse, status: refuse, result: refuse, run: refuse,
    actualCost: () => { throw new Error(`Tests never call the real ${id} API.`) },
    verifyCredentials: async () => ({ ok: true, message: 'offline test double' }),
  }
}

// Everything a test needs: in-memory Postgres, memory storage, a clock the
// test controls, mock providers only, and one seeded account.

export interface Harness {
  deps: Deps
  ctx: Ctx
  handle: DbHandle
  registry: ReturnType<typeof createRegistry>
  clock: { now(): Date; advance(ms: number): void; set(d: Date): void }
  close(): Promise<void>
  newAccount(name?: string): Promise<Ctx>
}

export async function createHarness(opts: Partial<Pick<RegistryOptions, 'mockScenario' | 'mockPollsUntilDone' | 'mockLlmResponders' | 'mockTransform' | 'overrides' | 'fetchImpl'>> & { publicUrl?: string; faces?: FaceMatcher; env?: Record<string, string> } = {}): Promise<Harness> {
  const handle = await openDb({ memory: true })
  let now = new Date('2026-10-12T12:00:00Z')
  const clock = { now: () => new Date(now), advance: (ms: number) => { now = new Date(now.getTime() + ms) }, set: (d: Date) => { now = d } }
  const store = createMemoryStore()
  const vault = createKeyVault(`t1:${randomBytes(32).toString('base64')}`)
  const config = loadConfig()
  const env = loadEnv({
    NODE_ENV: 'test',
    STUDIO_MASTER_KEYS: `t1:${randomBytes(32).toString('base64')}`,
    STUDIO_SESSION_SECRET: randomBytes(32).toString('base64'),
    STUDIO_PUBLIC_URL: opts.publicUrl ?? '',
    ...(opts.env ?? {}),
  })
  const depsRef: { current?: Deps } = {}
  const registry = createRegistry({
    db: handle.db, vault, config, store,
    loadAsset: async (accountId, assetId) => (await readAsset(depsRef.current!, { ...ctxBase, accountId }, assetId)).data,
    mockScenario: opts.mockScenario,
    mockPollsUntilDone: opts.mockPollsUntilDone ?? 1,
    mockTransform: opts.mockTransform,
    mockLlmResponders: opts.mockLlmResponders,
    // Voice lines: the mock voice (the take a little higher, words spread).
    voiceMock: true,
    baseUrls: { kie: env.KIE_API_BASE, wavespeed: env.WAVESPEED_API_BASE },
    // The Higgsfield account path never reaches the network in tests.
    fetchImpl: opts.fetchImpl ?? (async () => { throw new Error('Tests never call the real Higgsfield account.') }),
    overrides: {
      gen: { higgsfield: offline('higgsfield'), ...(opts.overrides?.gen ?? {}) },
      llm: { anthropic: offline('anthropic'), ...(opts.overrides?.llm ?? {}) },
    },
  })
  const faces = opts.faces ?? unavailableFaceMatcher('Face matching is off in this test.')
  const deps: Deps = { db: handle.db, store, vault, env, config, providers: registry, faces, clock, log: logger }
  depsRef.current = deps
  const ctxBase = { userId: null, role: 'owner' as const, email: '', requestId: 'test', log: logger }

  const newAccount = async (name = 'Test Studio'): Promise<Ctx> => {
    const p = await createAccount(handle.db, { name, ownerEmail: `owner-${randomBytes(4).toString('hex')}@example.com` })
    return { ...p, requestId: 'test', log: logger }
  }
  const ctx = await newAccount()
  return { deps, ctx, handle, registry, clock, close: () => handle.close(), newAccount }
}

// Runs worker ticks until no job is due, advancing the clock between rounds.
export async function drain(h: Harness, maxRounds = 30): Promise<void> {
  const { tick } = await import('../jobs/runner.js')
  for (let i = 0; i < maxRounds; i++) {
    const n = await tick(h.deps, 20)
    if (n === 0) {
      h.clock.advance(60_000)
      const again = await tick(h.deps, 20)
      if (again === 0) return
    }
    h.clock.advance(5_000)
  }
}
