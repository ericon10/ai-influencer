import type { Db } from '../db/client.js'
import type { KeyVault } from '../lib/vault.js'
import type { StudioConfig } from '../config/load.js'
import type { BlobStore } from '../storage/blobStore.js'
import { AppError } from '../lib/errors.js'
import { readSecret } from './credentials.js'
import { createMockAdapter, type MockOptions } from './mock.js'
import { createMockLlm, type LlmResponder } from './mockLlm.js'
import { createAnthropicLlm } from './anthropic.js'
import { createHiggsfieldAdapter } from './higgsfield.js'
import { createElevenLabsAdapter } from './elevenlabs.js'
import { createFalAdapter } from './fal.js'
import { createApifyAdapter } from './apify.js'
import { createGoogleAdapter } from './google.js'
import { createHiggsfieldAccountAdapter, type AccountBalance, type LivePriceStore } from './higgsfieldAccount.js'
import { getSetting, putCacheSetting } from '../pipeline/settings.js'
import { accountTokenSource, readAccountTokens } from './higgsfieldOAuth.js'
import { createMcpClient, type McpClient } from './mcpClient.js'
import { readBilling } from './billing.js'
import { readModelOverrides, withModelOverrides } from './modelOverrides.js'
import { serverKeyFor, type ServerKeys } from './serverKeys.js'
import type { HiggsfieldBilling, LlmProvider, ProviderAdapter } from './types.js'

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
  // A video in the connected account's Higgsfield media, by its ID (free).
  higgsfieldMedia(accountId: string, id: string): Promise<{ id: string; url: string } | null>
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
  // Keys set on the server for the owner's own account (HF_CREDENTIALS,
  // ELEVENLABS_API_KEY).
  serverKeys?: ServerKeys
  // Voice lines without an ElevenLabs key use the mock voice (local dev).
  voiceMock?: boolean
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

  // Higgsfield's live prices on the account path, saved per request shape,
  // so an estimate answers at once when Higgsfield is slow to price.
  const LIVE_PRICES_KEY = 'higgsfield_live_prices'
  type LivePrices = Record<string, { credits: number; at: number }>
  const livePrices = (accountId: string): LivePriceStore => ({
    async get(sig) {
      return (await getSetting<LivePrices>(o.db, accountId, LIVE_PRICES_KEY, {}))[sig] ?? null
    },
    async set(sig, credits) {
      const all = await getSetting<LivePrices>(o.db, accountId, LIVE_PRICES_KEY, {})
      const next = Object.entries({ ...all, [sig]: { credits, at: Date.now() } }).sort((a, b) => b[1].at - a[1].at).slice(0, 100)
      await putCacheSetting(o.db, accountId, LIVE_PRICES_KEY, Object.fromEntries(next))
    },
  })

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
    const adapter = createHiggsfieldAccountAdapter({ config: o.config, client: s.client, creditUsd, fetchImpl: o.fetchImpl, timeoutMs: o.config.runtime.mcp_connections.higgsfield!.timeout_sec * 1000, livePrices: livePrices(accountId) })
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
    async higgsfieldMedia(accountId, id) {
      const fake = o.overrides?.gen?.higgsfield_account as (ProviderAdapter & { findMedia?: (id: string) => Promise<{ id: string; url: string } | null> }) | undefined
      if (fake) return fake.findMedia ? fake.findMedia(id) : null
      return (await accountAdapter(accountId)).findMedia(id)
    },
    async gen(accountId, modelRef, opts = {}) {
      const p = provider(modelRef)
      if (p === 'higgsfield' && opts.billing === 'account') {
        if (o.overrides?.gen?.higgsfield_account) return o.overrides.gen.higgsfield_account
        return accountAdapter(accountId)
      }
      if (o.overrides?.gen?.[p]) return o.overrides.gen[p]!
      if (p === 'mock') return mockFor(accountId)
      if (p === 'elevenlabs') {
        const key = (await readSecret(o.db, o.vault, accountId, p)) ?? (await serverKeyFor(o.db, o.serverKeys, accountId, p))
        const base = { config: o.config, store: o.store, loadAsset: (id: string) => o.loadAsset(accountId, id), fetchImpl: o.fetchImpl }
        if (key) return createElevenLabsAdapter({ ...base, apiKey: key })
        if (o.voiceMock) return createElevenLabsAdapter({ ...base, mock: true })
        throw new AppError('provider_not_configured', 'Voice lines need an ElevenLabs key: add ELEVENLABS_API_KEY to the server (Vercel and Railway), or your ElevenLabs key in Settings.')
      }
      // fal and Google AI Studio (item 19): the account's own key from
      // Settings > Provider keys only, never a server key.
      if (p === 'fal' || p === 'google' || p === 'apify') {
        const key = await readSecret(o.db, o.vault, accountId, p)
        if (!key) throw new AppError('provider_not_configured', `Add your ${({ fal: 'fal', google: 'Google AI Studio', apify: 'Apify' } as Record<string, string>)[p]} key in Settings > Provider keys to run this on the API.`)
        if (p === 'apify') return createApifyAdapter({ apiKey: key, config: o.config, fetchImpl: o.fetchImpl })
        if (p === 'fal') return createFalAdapter({ apiKey: key, config: o.config, fetchImpl: o.fetchImpl })
        return createGoogleAdapter({ apiKey: key, config: o.config, store: o.store, loadAsset: id => o.loadAsset(accountId, id), fetchImpl: o.fetchImpl })
      }
      // The account's own key first; the owner's account can also use the
      // server key (HF_CREDENTIALS).
      const secret = (await readSecret(o.db, o.vault, accountId, p)) ?? (await serverKeyFor(o.db, o.serverKeys, accountId, p))
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
