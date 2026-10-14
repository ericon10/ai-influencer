import { and, eq } from 'drizzle-orm'
import { memberships, users } from '../db/schema.js'
import type { Db } from '../db/client.js'

// Provider keys set on the server (HF_CREDENTIALS) instead of in Settings.
// They belong to the owner's own account only: a customer account never
// runs on the owner's balance. Never logged or returned to the browser.

export interface ServerKeys {
  ownerEmail: string
  higgsfield?: string
  elevenlabs?: string
  // The Vercel AI Gateway (AI_GATEWAY_API_KEY): Kling 3.0 Motion Control.
  vercel?: string
}

const ownerCache = new Map<string, boolean>()

export async function isOwnerAccount(db: Db, accountId: string, ownerEmail: string): Promise<boolean> {
  const email = ownerEmail.trim().toLowerCase()
  if (!email) return false
  const key = `${accountId}|${email}`
  const hit = ownerCache.get(key)
  if (hit !== undefined) return hit
  const rows = await db.select({ role: memberships.role }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.accountId, accountId), eq(users.email, email), eq(memberships.role, 'owner')))
  const owner = rows.length > 0
  ownerCache.set(key, owner)
  return owner
}

// The server key for a provider, when this is the owner's account.
export async function serverKeyFor(db: Db, keys: ServerKeys | undefined, accountId: string, provider: string): Promise<string | null> {
  const key = provider === 'higgsfield' ? keys?.higgsfield : provider === 'elevenlabs' ? keys?.elevenlabs : provider === 'vercel' ? keys?.vercel : undefined
  if (!keys || !key?.trim()) return null
  return (await isOwnerAccount(db, accountId, keys.ownerEmail)) ? key.trim() : null
}
