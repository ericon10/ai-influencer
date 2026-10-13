import { and, eq, isNull } from 'drizzle-orm'
import { providerCredentials } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import type { KeyVault } from '../lib/vault.js'
import { newId } from '../lib/ids.js'
import { audit } from '../lib/audit.js'
import { AppError } from '../lib/errors.js'

// Provider keys belong to an account (customers bring their own keys). They
// are sealed with the key vault and only the last four characters are ever
// returned to the browser.

const KNOWN = new Set(['higgsfield', 'anthropic', 'wavespeed', 'fal'])
const aad = (accountId: string, provider: string) => `${accountId}|${provider}`

export interface CredentialView {
  id: string
  provider: string
  label: string
  last4: string
  verifyStatus: string
  verifiedAt: string | null
  createdAt: string
}

export async function saveCredential(deps: Deps, ctx: Ctx, provider: string, secret: string, label = ''): Promise<CredentialView> {
  if (!KNOWN.has(provider)) throw new AppError('bad_request', `Unknown provider "${provider}".`)
  const trimmed = secret.trim()
  if (trimmed.length < 8) throw new AppError('bad_request', 'That key looks too short.')
  if (provider === 'higgsfield' && !/^[^:\s]+:[^:\s]+$/.test(trimmed)) {
    throw new AppError('bad_request', 'Higgsfield keys look like KEY_ID:KEY_SECRET (both parts from the Higgsfield Console).')
  }
  return storeSecret(deps, ctx, provider, trimmed, label, trimmed.slice(-4))
}

// Stores a secret that did not come from the keys form (for example the
// Higgsfield account sign-in tokens), replacing the active one.
export async function storeSecret(deps: Deps, ctx: Ctx, provider: string, trimmed: string, label: string, last4: string): Promise<CredentialView> {
  const sealed = deps.vault.seal(trimmed, aad(ctx.accountId, provider))
  const now = deps.clock.now()
  const id = newId('cred')
  await deps.db.transaction(async tx => {
    await tx.update(providerCredentials).set({ revokedAt: now })
      .where(and(eq(providerCredentials.accountId, ctx.accountId), eq(providerCredentials.provider, provider), isNull(providerCredentials.revokedAt)))
    await tx.insert(providerCredentials).values({
      id, accountId: ctx.accountId, provider, label,
      keyVersion: sealed.keyVersion, envelope: sealed.envelope, last4, createdBy: ctx.userId,
    })
  })
  await audit(deps.db, ctx, 'credential.saved', { type: 'credential', id }, { provider, last4 })
  return { id, provider, label, last4, verifyStatus: 'unverified', verifiedAt: null, createdAt: now.toISOString() }
}

export async function listCredentials(db: Db, accountId: string): Promise<CredentialView[]> {
  const rows = await db.select().from(providerCredentials)
    .where(and(eq(providerCredentials.accountId, accountId), isNull(providerCredentials.revokedAt)))
  return rows.map(r => ({
    id: r.id, provider: r.provider, label: r.label, last4: r.last4, verifyStatus: r.verifyStatus,
    verifiedAt: r.verifiedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  }))
}

export async function readSecret(db: Db, vault: KeyVault, accountId: string, provider: string): Promise<string | null> {
  return (await readCredential(db, vault, accountId, provider))?.secret ?? null
}

export async function readCredential(db: Db, vault: KeyVault, accountId: string, provider: string): Promise<{ id: string; secret: string; createdAt: Date; verifyStatus: string } | null> {
  const [row] = await db.select().from(providerCredentials)
    .where(and(eq(providerCredentials.accountId, accountId), eq(providerCredentials.provider, provider), isNull(providerCredentials.revokedAt)))
  if (!row) return null
  return { id: row.id, secret: vault.open(row.envelope, aad(accountId, provider)), createdAt: row.createdAt, verifyStatus: row.verifyStatus }
}

// Re-seals an active credential in place (refreshed sign-in tokens). Only the
// row read earlier is touched, so a reconnect in between is never undone.
export async function updateSecret(db: Db, vault: KeyVault, accountId: string, provider: string, credentialId: string, secret: string): Promise<boolean> {
  const sealed = vault.seal(secret, aad(accountId, provider))
  const rows = await db.update(providerCredentials).set({ keyVersion: sealed.keyVersion, envelope: sealed.envelope })
    .where(and(eq(providerCredentials.id, credentialId), eq(providerCredentials.accountId, accountId), isNull(providerCredentials.revokedAt)))
    .returning({ id: providerCredentials.id })
  return rows.length > 0
}

export async function markVerified(db: Db, accountId: string, provider: string, ok: boolean, now: Date): Promise<void> {
  await db.update(providerCredentials).set({ verifyStatus: ok ? 'ok' : 'failed', verifiedAt: now })
    .where(and(eq(providerCredentials.accountId, accountId), eq(providerCredentials.provider, provider), isNull(providerCredentials.revokedAt)))
}

export async function revokeCredential(deps: Deps, ctx: Ctx, provider: string): Promise<void> {
  await deps.db.update(providerCredentials).set({ revokedAt: deps.clock.now() })
    .where(and(eq(providerCredentials.accountId, ctx.accountId), eq(providerCredentials.provider, provider), isNull(providerCredentials.revokedAt)))
  await audit(deps.db, ctx, 'credential.revoked', { type: 'credential', id: provider }, { provider })
}
