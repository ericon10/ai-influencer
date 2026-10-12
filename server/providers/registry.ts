import type { Db } from '../db/client'
import type { KeyVault } from '../lib/vault'
import type { StudioConfig } from '../config/load'
import type { BlobStore } from '../storage/blobStore'
import { AppError } from '../lib/errors'
import { readSecret } from './credentials'
import { createMockAdapter, type MockOptions } from './mock'
import { createMockLlm, type LlmResponder } from './mockLlm'
import { createAnthropicLlm } from './anthropic'
import { createHiggsfieldAdapter } from './higgsfield'
import type { LlmProvider, ProviderAdapter } from './types'

// Resolves the adapter for a model ref, using the account's own encrypted
// key. Mock adapters keep job state in memory, one instance per account.

export interface ProviderRegistry {
  gen(accountId: string, modelRef: string): Promise<ProviderAdapter>
  llm(accountId: string, modelRef: string): Promise<LlmProvider>
}

export interface RegistryOptions {
  db: Db
  vault: KeyVault
  config: StudioConfig
  store: BlobStore
  loadAsset: (accountId: string, assetId: string) => Promise<Buffer>
  mockScenario?: MockOptions['scenario']
  mockPollsUntilDone?: number
  mockLlmResponders?: Record<string, LlmResponder>
  // Tests can inject any adapter by provider id.
  overrides?: { gen?: Record<string, ProviderAdapter>; llm?: Record<string, LlmProvider> }
}

export function createRegistry(o: RegistryOptions): ProviderRegistry & { mockFor(accountId: string): ReturnType<typeof createMockAdapter>; mockLlm: ReturnType<typeof createMockLlm> } {
  // One mock instance per account, so an account's mock jobs can only ever
  // read that account's assets.
  const mocks = new Map<string, ReturnType<typeof createMockAdapter>>()
  const mockFor = (accountId: string) => {
    let m = mocks.get(accountId)
    if (!m) {
      m = createMockAdapter({
        config: o.config,
        loadAsset: id => o.loadAsset(accountId, id),
        scenario: o.mockScenario,
        pollsUntilDone: o.mockPollsUntilDone,
      })
      mocks.set(accountId, m)
    }
    return m
  }
  const mockLlm = createMockLlm(o.config, o.mockLlmResponders)
  const provider = (ref: string) => ref.split('/')[0] ?? ''

  return {
    mockFor,
    mockLlm,
    async gen(accountId, modelRef) {
      const p = provider(modelRef)
      if (o.overrides?.gen?.[p]) return o.overrides.gen[p]!
      if (p === 'mock') return mockFor(accountId)
      const secret = await readSecret(o.db, o.vault, accountId, p)
      if (!secret) throw new AppError('provider_not_configured', `Add your ${p} API key in Settings to run this live.`)
      if (p === 'higgsfield') return createHiggsfieldAdapter({ credentials: secret, config: o.config })
      throw new AppError('provider_not_configured', `No adapter for provider "${p}" yet.`)
    },
    async llm(accountId, modelRef) {
      const p = provider(modelRef)
      if (o.overrides?.llm?.[p]) return o.overrides.llm[p]!
      if (p === 'mock') return mockLlm
      const secret = await readSecret(o.db, o.vault, accountId, p)
      if (!secret) throw new AppError('provider_not_configured', `Add your ${p} API key in Settings to run this live.`)
      if (p === 'anthropic') return createAnthropicLlm(secret, o.config)
      throw new AppError('provider_not_configured', `No LLM adapter for provider "${p}" yet.`)
    },
  }
}
