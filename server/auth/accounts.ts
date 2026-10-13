import { and, eq } from 'drizzle-orm'
import { accounts, memberships, users } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Principal, Role } from '../context.js'
import { newId } from '../lib/ids.js'

// Accounts and memberships. v1 has one account and one owner, but nothing
// assumes that: every principal is an (account, user, role) triple.

export async function createAccount(db: Db, input: { name: string; ownerEmail: string; ownerName?: string; passwordHash?: string | null }): Promise<Principal> {
  const accountId = newId('acct')
  const email = input.ownerEmail.trim().toLowerCase()
  // One transaction, so a failed insert never leaves an account without its owner.
  return db.transaction(async tx => {
    let [user] = await tx.select().from(users).where(eq(users.email, email))
    await tx.insert(accounts).values({ id: accountId, name: input.name })
    if (!user) {
      ;[user] = await tx.insert(users).values({ id: newId('usr'), email, name: input.ownerName ?? '', passwordHash: input.passwordHash ?? null }).returning()
    }
    await tx.insert(memberships).values({ accountId, userId: user!.id, role: 'owner' })
    return { accountId, userId: user!.id, role: 'owner' as const, email }
  })
}

export async function principalFor(db: Db, accountId: string, userId: string): Promise<Principal | null> {
  const [row] = await db.select({ role: memberships.role, email: users.email })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.accountId, accountId), eq(memberships.userId, userId)))
  if (!row) return null
  return { accountId, userId, role: row.role as Role, email: row.email }
}
