import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '../db/client'
import type { Ctx, Deps } from '../context'
import { hasRole } from '../context'
import type { KeyVault } from '../lib/vault'
import type { StudioConfig } from '../config/load'
import { AppError } from '../lib/errors'
import { safeEqual, sha256Hex } from '../lib/passwords'
import { audit } from '../lib/audit'
import { deleteSetting, getSetting, setSetting } from '../pipeline/settings'
import { markVerified, readCredential, revokeCredential, storeSecret, updateSecret } from './credentials'
import { readBilling, saveBilling } from './billing'
import { ProviderError } from './types'

// Signs the owner's Higgsfield account in on the server: OAuth with PKCE and
// dynamic client registration against mcp.higgsfield.ai, the same flow the
// classic app runs in the browser. The tokens are sealed in the account's
// key vault like any provider key and never reach the browser.
//
// The callback is a plain browser redirect, so it carries no API session.
// The state names the account and is checked against a hash stored when the
// flow started (single use, ten minutes), which binds the sign-in to the
// admin who started it.

export const ACCOUNT_PROVIDER = 'higgsfield_account'
export const CALLBACK_PATH = '/api/v1/oauth/higgsfield/callback'
const PENDING_KEY = 'higgsfield_oauth_pending'
const CLIENT_KEY = 'higgsfield_oauth_client'
const PENDING_TTL_MS = 10 * 60_000
const REFRESH_EARLY_MS = 120_000

export interface AccountTokens {
  accessToken: string
  refreshToken?: string
  // Epoch milliseconds.
  expiresAt?: number
  clientId: string
}

interface Pending {
  stateHash: string
  verifier: string // sealed
  userId: string | null
  redirectUri: string
  clientId: string
  expiresAt: string
}

export interface OAuthOptions {
  fetchImpl?: typeof fetch
  retryDelayMs?: number
}

const pendingAad = (accountId: string) => `${accountId}|higgsfield_oauth`
const RETRY = new Set([429, 500, 502, 503, 504])

// Higgsfield rate-limits its OAuth endpoints by IP, so transient answers are
// retried with backoff (and Retry-After when it is sent).
async function oauthFetch(o: OAuthOptions, url: string, init: RequestInit, attempts = 3): Promise<Response> {
  const doFetch = o.fetchImpl ?? fetch
  const base = o.retryDelayMs ?? 500
  let last: Response | null = null
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const res = await doFetch(url, { ...init, signal: controller.signal })
      if (!RETRY.has(res.status) || i === attempts - 1) return res
      last = res
      const ra = Number(res.headers.get('retry-after'))
      await new Promise(r => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 8000) : base * 2 ** i))
    } catch (e) {
      if (i === attempts - 1) throw e
      await new Promise(r => setTimeout(r, base * 2 ** i))
    } finally {
      clearTimeout(timer)
    }
  }
  return last!
}

function parseTokens(body: Record<string, unknown>, clientId: string, now: number, previous?: AccountTokens): AccountTokens {
  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  if (!accessToken) throw new Error('Higgsfield returned no access token.')
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in)
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : previous?.refreshToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : undefined,
    clientId,
  }
}

async function ensureClient(deps: Deps, ctx: Ctx, redirectUri: string, o: OAuthOptions): Promise<string> {
  const saved = await getSetting<{ clientId?: string; redirectUri?: string }>(deps.db, ctx.accountId, CLIENT_KEY, {})
  if (saved.clientId && saved.redirectUri === redirectUri) return saved.clientId
  let res: Response
  try {
    res = await oauthFetch(o, deps.config.runtime.higgsfield_account.oauth.register, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Character Studio',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
  } catch (e) {
    ctx.log.warn({ err: e }, 'higgsfield client registration unreachable')
    throw new AppError('provider_error', 'Could not reach Higgsfield to start the sign-in. Check the connection and try again.')
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || typeof body.client_id !== 'string') {
    throw new AppError('provider_error', res.status === 429 ? 'Higgsfield is busy. Wait a few seconds and connect again.' : `Higgsfield did not register the Studio for sign-in (${res.status}).`)
  }
  await setSetting(deps, ctx, CLIENT_KEY, { clientId: body.client_id, redirectUri })
  return body.client_id
}

// Starts the sign-in and returns the Higgsfield page to send the browser to.
export async function startAccountConnect(deps: Deps, ctx: Ctx, input: { origin: string }, o: OAuthOptions = {}): Promise<{ url: string }> {
  if (!hasRole(ctx, 'admin')) throw new AppError('forbidden', 'Only an owner or admin can connect a Higgsfield account.')
  const base = (deps.env.STUDIO_PUBLIC_URL || input.origin).replace(/\/$/, '')
  if (!/^https?:\/\/[^/]+$/.test(base)) throw new AppError('bad_request', 'The Studio does not know its own address. Set STUDIO_PUBLIC_URL.')
  const redirectUri = `${base}${CALLBACK_PATH}`
  const clientId = await ensureClient(deps, ctx, redirectUri, o)
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = `${ctx.accountId}.${randomBytes(24).toString('base64url')}`
  const pending: Pending = {
    stateHash: sha256Hex(state),
    verifier: deps.vault.seal(verifier, pendingAad(ctx.accountId)).envelope,
    userId: ctx.userId,
    redirectUri,
    clientId,
    expiresAt: new Date(deps.clock.now().getTime() + PENDING_TTL_MS).toISOString(),
  }
  await setSetting(deps, ctx, PENDING_KEY, pending)
  const cfg = deps.config.runtime.higgsfield_account.oauth
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: cfg.scope,
    state, code_challenge: challenge, code_challenge_method: 'S256',
  })
  return { url: `${cfg.authorize}?${params}` }
}

export type ConnectResult = { ok: true; returnTo: string } | { ok: false; returnTo: string | null; message: string }

// The redirect back from Higgsfield. Never throws; the API turns the result
// into a redirect to Settings with a message.
export async function finishAccountConnect(deps: Deps, query: { code?: string; state?: string; error?: string; error_description?: string }, o: OAuthOptions = {}): Promise<ConnectResult> {
  const state = query.state ?? ''
  const accountId = state.split('.')[0] ?? ''
  if (!accountId || !state.includes('.')) return { ok: false, returnTo: null, message: 'That sign-in link is not valid. Start again from Settings.' }
  const pending = await getSetting<Pending | null>(deps.db, accountId, PENDING_KEY, null)
  if (!pending || !safeEqual(pending.stateHash, sha256Hex(state))) return { ok: false, returnTo: null, message: 'That sign-in link is not valid. Start again from Settings.' }
  const returnTo = pending.redirectUri.slice(0, -CALLBACK_PATH.length)
  await deleteSetting(deps.db, accountId, PENDING_KEY)
  if (new Date(pending.expiresAt).getTime() < deps.clock.now().getTime()) return { ok: false, returnTo, message: 'The sign-in took too long. Connect again.' }
  if (query.error) return { ok: false, returnTo, message: query.error === 'access_denied' ? 'Higgsfield sign-in was canceled.' : `Higgsfield sign-in failed: ${query.error_description ?? query.error}` }
  if (!query.code) return { ok: false, returnTo, message: 'Higgsfield sent no sign-in code. Connect again.' }

  const ctx: Ctx = { accountId, userId: pending.userId, role: 'admin', email: '', requestId: 'oauth', log: deps.log.child({ accountId }) }
  let tokens: AccountTokens
  try {
    const res = await oauthFetch(o, deps.config.runtime.higgsfield_account.oauth.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: query.code, redirect_uri: pending.redirectUri,
        client_id: pending.clientId, code_verifier: deps.vault.open(pending.verifier, pendingAad(accountId)),
      }).toString(),
    })
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) {
      // A rejected client means the saved registration is gone upstream.
      if (body.error === 'invalid_client' || res.status === 401) await deleteSetting(deps.db, accountId, CLIENT_KEY)
      return { ok: false, returnTo, message: res.status === 429 ? 'Higgsfield is busy. Wait a moment and connect again.' : `Higgsfield did not finish the sign-in (${String(body.error_description ?? body.error ?? res.status)}).` }
    }
    tokens = parseTokens(body, pending.clientId, deps.clock.now().getTime())
  } catch (e) {
    ctx.log.warn({ err: e }, 'higgsfield sign-in failed')
    return { ok: false, returnTo, message: 'Could not reach Higgsfield to finish the sign-in. Connect again.' }
  }
  await storeSecret(deps, ctx, ACCOUNT_PROVIDER, JSON.stringify(tokens), 'Higgsfield account', '')
  await audit(deps.db, ctx, 'higgsfield_account.connected', { type: 'credential', id: ACCOUNT_PROVIDER }, {})
  return { ok: true, returnTo }
}

export async function disconnectAccount(deps: Deps, ctx: Ctx): Promise<void> {
  if (!hasRole(ctx, 'admin')) throw new AppError('forbidden', 'Only an owner or admin can disconnect the Higgsfield account.')
  await revokeCredential(deps, ctx, ACCOUNT_PROVIDER)
  const billing = await readBilling(deps.db, ctx.accountId)
  if (billing.default === 'account') await saveBilling(deps, ctx, { ...billing, default: 'api' })
}

export async function readAccountTokens(db: Db, vault: KeyVault, accountId: string): Promise<{ id: string; tokens: AccountTokens; createdAt: Date; verifyStatus: string } | null> {
  const cred = await readCredential(db, vault, accountId, ACCOUNT_PROVIDER)
  if (!cred) return null
  try {
    return { id: cred.id, tokens: JSON.parse(cred.secret) as AccountTokens, createdAt: cred.createdAt, verifyStatus: cred.verifyStatus }
  } catch {
    return null
  }
}

// Access tokens for one connected account. Refreshes shortly before expiry
// and after a refusal; a refresh another worker already did is picked up
// from the vault instead of spending the refresh token twice.
export function accountTokenSource(
  env: { db: Db; vault: KeyVault; config: StudioConfig },
  accountId: string,
  start: { id: string; tokens: AccountTokens },
  o: OAuthOptions = {},
): { getToken(): Promise<string>; refresh(rejected: string): Promise<string> } {
  let current = start.tokens
  let inflight: Promise<string> | null = null
  const expiring = (t: AccountTokens) => t.expiresAt != null && t.expiresAt - Date.now() < REFRESH_EARLY_MS
  const reconnect = (message: string) => new ProviderError(message, { retryable: false, submitted: 'no', status: 401, code: 'reconnect' })

  async function doRefresh(rejected: string): Promise<string> {
    const latest = await readAccountTokens(env.db, env.vault, accountId)
    if (!latest || latest.id !== start.id) throw reconnect('Your Higgsfield account is not connected anymore. Connect it again in Settings.')
    if (latest.tokens.accessToken !== rejected && !expiring(latest.tokens)) { current = latest.tokens; return current.accessToken }
    if (!latest.tokens.refreshToken) throw reconnect('Your Higgsfield account sign-in expired. Connect it again in Settings.')
    let res: Response
    try {
      res = await oauthFetch(o, env.config.runtime.higgsfield_account.oauth.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: latest.tokens.refreshToken, client_id: latest.tokens.clientId }).toString(),
      })
    } catch {
      throw new ProviderError('Could not reach Higgsfield to renew the sign-in. Will retry.', { retryable: true, submitted: 'no' })
    }
    if (res.status === 400 || res.status === 401) {
      // Only a real refusal ends the sign-in; busy answers are retried.
      await markVerified(env.db, accountId, ACCOUNT_PROVIDER, false, new Date())
      throw reconnect('Your Higgsfield account sign-in expired. Connect it again in Settings.')
    }
    if (!res.ok) throw new ProviderError(`Higgsfield is busy renewing the sign-in (${res.status}). Will retry.`, { retryable: true, submitted: 'no', status: res.status })
    const next = parseTokens(await res.json() as Record<string, unknown>, latest.tokens.clientId, Date.now(), latest.tokens)
    await updateSecret(env.db, env.vault, accountId, ACCOUNT_PROVIDER, start.id, JSON.stringify(next))
    current = next
    return current.accessToken
  }

  function refresh(rejected: string): Promise<string> {
    if (!inflight) inflight = doRefresh(rejected).finally(() => { inflight = null })
    return inflight
  }

  return {
    async getToken() {
      if (expiring(current) && current.refreshToken) return refresh(current.accessToken)
      return current.accessToken
    },
    refresh,
  }
}
