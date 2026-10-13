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
import { createHiggsfieldAccountAdapter, type AccountBalance } from './higgsfieldAccount'
import { accountTokenSource, readAccountTokens } from './higgsfieldOAuth'
import { createMcpClient, type McpClient } from './mcpClient'
import { readBilling } from './billing'
import { readModelOverrides, withModelOverrides } from './modelOverrides'
import type { HiggsfieldBilling, LlmProvider, ProviderAdapter } from './types'

// Resolves the adapter for a model ref, using the account's own encrypted
// key. Mock adapters keep job state in memory, one instance per account.
//
// Higgsfield has two paths: the pay-per-use REST API (billing "api", the
// default) and the owner's own account through the MCP connector (billing
// "account", plan credits). The caller names the path; jobs carry the one
// they were quoted with.

export interface GenOptions {
  billing?: HiggsfieldBilling
}

export interface ProviderRegistry {
  gen(accountId: string, modelRef: string, opts?: GenOptions): Promise<ProviderAdapter>
  llm(accountId: string, modelRef: string): Promise<LlmProvider>
  // The connected Higgsfield account's plan and credits (a free call).
  higgsfieldAccountBalance(accountId: string): Promise<AccountBalance>
}

export interface RegistryOptions {
  db: Db
  vault: KeyVault
  config: StudioConfig
  store: BlobStore
  loadAsset: (accountId: string, assetId: string) => Promise<Buffer>
  mockScenario?: MockOptions['scenario']
  mockPollsUntilDone?: number
  mockTransform?: MockOptions['transform']
  mockLlmResponders?: Record<string, LlmResponder>
  // Tests can inject any adapter by provider id ("higgsfield_account" for
  // the account path).
  overrides?: { gen?: Record<string, ProviderAdapter>; llm?: Record<string, LlmProvider> }
  // Network for the Higgsfield account path (tests pass a fake server).
  fetchImpl?: typeof fetch
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
        transform: o.mockTransform,
      })
      mocks.set(accountId, m)
    }
    return m
  }
  const mockLlm = createMockLlm(o.config, o.mockLlmResponders)
  const provider = (ref: string) => ref.split('/')[0] ?? ''

  // One MCP session per connected account, reused across jobs. A reconnect
  // stores a new credential, which starts a new session.
  const sessions = new Map<string, { credentialId: string; client: McpClient }>()
  async function accountAdapter(accountId: string) {
    const stored = await readAccountTokens(o.db, o.vault, accountId)
    if (!stored) throw new AppError('provider_not_configured', 'Connect your Higgsfield account in Settings to run on plan credits, or switch Higgsfield billing to the API.')
    let s = sessions.get(accountId)
    if (!s || s.credentialId !== stored.id) {
      const cfg = o.config.runtime.mcp_connections.higgsfield!
      const tokens = accountTokenSource(o, accountId, stored, { fetchImpl: o.fetchImpl })
      s = {
        credentialId: stored.id,
        client: createMcpClient({ url: cfg.mcp_url!, getToken: tokens.getToken, refreshToken: tokens.refresh, timeoutMs: cfg.timeout_sec * 1000, clientName: 'Character Studio', fetchImpl: o.fetchImpl }),
      }
      sessions.set(accountId, s)
    }
    const { creditUsd } = await readBilling(o.db, accountId)
    const adapter = createHiggsfieldAccountAdapter({ config: o.config, client: s.client, creditUsd, fetchImpl: o.fetchImpl, timeoutMs: o.config.runtime.mcp_connections.higgsfield!.timeout_sec * 1000 })
    // A test network serves the results too; real downloads go through the
    // runner's guarded download (host allowlist, no private addresses).
    const net = o.fetchImpl
    if (net) adapter.download = async out => Buffer.from(await (await net(out.url)).arrayBuffer())
    return adapter
  }

  return {
    mockFor,
    mockLlm,
    async higgsfieldAccountBalance(accountId) {
      return (await accountAdapter(accountId)).balance()
    },
    async gen(accountId, modelRef, opts = {}) {
      const p = provider(modelRef)
      if (p === 'higgsfield' && opts.billing === 'account') {
        if (o.overrides?.gen?.higgsfield_account) return o.overrides.gen.higgsfield_account
        return accountAdapter(accountId)
      }
      if (o.overrides?.gen?.[p]) return o.overrides.gen[p]!
      if (p === 'mock') return mockFor(accountId)
      const secret = await readSecret(o.db, o.vault, accountId, p)
      if (!secret) throw new AppError('provider_not_configured', `Add your ${p} API key in Settings to run this live.`)
      // The account's own confirmed endpoints apply on top of the catalog.
      if (p === 'higgsfield') return createHiggsfieldAdapter({ credentials: secret, config: withModelOverrides(o.config, await readModelOverrides(o.db, accountId)) })
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
