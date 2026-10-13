import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import type { KeyVault } from '../lib/vault.js'
import type { StudioConfig } from '../config/load.js'
import {
  connectionTokenSource, credentialFor, disconnect, finishConnect, readConnectionTokens, startConnect,
  type AccountTokens, type ConnectResult, type OAuthOptions,
} from './mcpConnections.js'

// The Higgsfield account (plan credits) on the shared MCP connection flow.

export const ACCOUNT_PROVIDER = credentialFor('higgsfield')
export type { AccountTokens }

export const startAccountConnect = (deps: Deps, ctx: Ctx, input: { origin: string }, o: OAuthOptions = {}) => startConnect(deps, ctx, 'higgsfield', input, o)
export const finishAccountConnect = (deps: Deps, query: Parameters<typeof finishConnect>[2], o: OAuthOptions = {}): Promise<ConnectResult> => finishConnect(deps, 'higgsfield', query, o)
export const disconnectAccount = (deps: Deps, ctx: Ctx) => disconnect(deps, ctx, 'higgsfield')
export const readAccountTokens = (db: Db, vault: KeyVault, accountId: string) => readConnectionTokens(db, vault, accountId, 'higgsfield')
export const accountTokenSource = (env: { db: Db; vault: KeyVault; config: StudioConfig }, accountId: string, start: { id: string; tokens: AccountTokens }, o: OAuthOptions = {}) =>
  connectionTokenSource(env, 'higgsfield', accountId, start, o)
