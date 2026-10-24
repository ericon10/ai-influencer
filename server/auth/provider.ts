import { and, count, eq, gt, isNull, lt } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { accounts, loginAttempts, memberships, sessions, users } from '../db/schema.js'
import type { Deps, Principal, Role } from '../context.js'
import { newId, newToken } from '../lib/ids.js'
import { sha256Hex, verifyPassword } from '../lib/passwords.js'
import { AppError } from '../lib/errors.js'
import { principalFor } from './accounts.js'

// Authentication goes through this interface so real accounts and logins
// (Clerk, WorkOS, Auth.js) can replace the v1 owner login without touching
// the rest of the app. A provider only has to turn a request into a
// Principal (account, user, role).

export interface AuthProvider {
  name: string
  authenticate(c: Context): Promise<Principal | null>
  login(c: Context, input: { email: string; passphrase: string }): Promise<Principal>
  logout(c: Context): Promise<void>
}

const COOKIE = 'studio_session'
const SESSION_DAYS = 30

// Login throttle, kept in the database so it holds across serverless
// instances: a few wrong passphrases per email, and a few more per address,
// within the window, then sign-in pauses until the window passes.
export const LOGIN_WINDOW_MS = 15 * 60_000
export const MAX_FAILS_PER_EMAIL = 5
export const MAX_FAILS_PER_IP = 20

const clientIp = (c: Context) => (c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? '').split(',')[0]!.trim().slice(0, 64)

export function createPassphraseAuth(deps: Deps, opts: { devAutoLogin: boolean }): AuthProvider {
  async function fromCookie(c: Context): Promise<Principal | null> {
    const token = getCookie(c, COOKIE)
    if (!token) return null
    const [s] = await deps.db.select().from(sessions)
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, deps.clock.now())))
    if (!s) return null
    return principalFor(deps.db, s.accountId, s.userId)
  }

  // Local development only: with no session, act as the first owner, so a
  // fresh checkout opens straight into the Studio.
  async function devPrincipal(): Promise<Principal | null> {
    const [m] = await deps.db.select({ accountId: memberships.accountId, userId: memberships.userId, role: memberships.role, email: users.email })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.role, 'owner')).limit(1)
    return m ? { accountId: m.accountId, userId: m.userId, role: m.role as Role, email: m.email } : null
  }

  return {
    name: opts.devAutoLogin ? 'passphrase+dev' : 'passphrase',
    async authenticate(c) {
      return (await fromCookie(c)) ?? (opts.devAutoLogin ? devPrincipal() : null)
    },
    async login(c, input) {
      const email = input.email.trim().toLowerCase()
      const ip = clientIp(c)
      const since = new Date(deps.clock.now().getTime() - LOGIN_WINDOW_MS)
      const fails = async (cond: ReturnType<typeof eq>) => (await deps.db.select({ n: count() }).from(loginAttempts)
        .where(and(cond, eq(loginAttempts.ok, false), gt(loginAttempts.createdAt, since))))[0]!.n
      if (await fails(eq(loginAttempts.email, email)) >= MAX_FAILS_PER_EMAIL || (ip && await fails(eq(loginAttempts.ip, ip)) >= MAX_FAILS_PER_IP)) {
        throw new AppError('too_many_requests', 'Too many sign-in attempts. Wait 15 minutes, then try again.')
      }
      const [u] = await deps.db.select().from(users).where(eq(users.email, email))
      const [m] = u ? await deps.db.select().from(memberships).innerJoin(accounts, eq(accounts.id, memberships.accountId)).where(eq(memberships.userId, u.id)).limit(1) : []
      const ok = !!u?.passwordHash && (await verifyPassword(input.passphrase, u.passwordHash))
      await deps.db.insert(loginAttempts).values({ id: newId('lga'), accountId: m?.memberships.accountId ?? null, email, ip, ok })
      // Same message for unknown email and wrong passphrase.
      if (!ok || !u) throw new AppError('unauthorized', 'That email and passphrase do not match.')
      if (!m) throw new AppError('forbidden', 'This user has no account.')
      // A good sign-in clears the email's strikes; old rows are pruned.
      await deps.db.delete(loginAttempts).where(and(eq(loginAttempts.email, email), eq(loginAttempts.ok, false)))
      await deps.db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(deps.clock.now().getTime() - 86400_000)))
      const token = newToken(32)
      const expiresAt = new Date(deps.clock.now().getTime() + SESSION_DAYS * 86400_000)
      await deps.db.insert(sessions).values({
        id: newId('ses'), accountId: m.memberships.accountId, userId: u.id, tokenHash: sha256Hex(token), expiresAt,
        userAgent: (c.req.header('user-agent') ?? '').slice(0, 300), ip,
      })
      setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: deps.env.isProduction, path: '/', expires: expiresAt })
      return { accountId: m.memberships.accountId, userId: u.id, role: m.memberships.role as Role, email }
    },
    async logout(c) {
      const token = getCookie(c, COOKIE)
      if (token) await deps.db.update(sessions).set({ revokedAt: deps.clock.now() }).where(eq(sessions.tokenHash, sha256Hex(token)))
      deleteCookie(c, COOKIE, { path: '/' })
    },
  }
}

// The signed-in user's password again before a provider key is saved or
// removed (multi-user, 2026-10-24): a stolen session alone cannot swap a
// key. Wrong tries count toward the same sign-in throttle. A user with no
// password set is refused in production; in local development (the demo
// owner signs in with no password) there is nothing to check.
export async function hasPassword(deps: Deps, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const [u] = await deps.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId))
  return !!u?.hash
}

export async function confirmPassword(deps: Deps, c: Context, who: { userId: string | null; accountId: string }, password: string | undefined): Promise<void> {
  const [u] = who.userId ? await deps.db.select().from(users).where(eq(users.id, who.userId)) : []
  if (!u?.passwordHash) {
    if (deps.env.isProduction) throw new AppError('forbidden', 'Set a password for this sign-in first.')
    return
  }
  const email = u.email
  const since = new Date(deps.clock.now().getTime() - LOGIN_WINDOW_MS)
  const [{ n }] = await deps.db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.email, email), eq(loginAttempts.ok, false), gt(loginAttempts.createdAt, since))) as [{ n: number }]
  if (n >= MAX_FAILS_PER_EMAIL) throw new AppError('too_many_requests', 'Too many wrong passwords. Wait 15 minutes, then try again.')
  if (!password) throw new AppError('forbidden', 'Enter your password to change a key.')
  if (await verifyPassword(password, u.passwordHash)) return
  await deps.db.insert(loginAttempts).values({ id: newId('lga'), accountId: who.accountId, email, ip: clientIp(c), ok: false, createdAt: deps.clock.now() })
  throw new AppError('forbidden', 'That password is not right.')
}
