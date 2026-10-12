import { and, eq } from 'drizzle-orm'
import { accountSettings } from '../db/schema'
import type { Db } from '../db/client'
import type { Ctx, Deps } from '../context'
import type { Route } from '../config/load'
import { audit } from '../lib/audit'
import { AppError } from '../lib/errors'

// Per-account settings and overrides of config defaults.

export async function getSetting<T>(db: Db, accountId: string, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(accountSettings).where(and(eq(accountSettings.accountId, accountId), eq(accountSettings.key, key)))
  return row ? (row.value as T) : fallback
}

export async function setSetting(deps: Deps, ctx: Ctx, key: string, value: unknown): Promise<void> {
  const existing = await deps.db.select().from(accountSettings).where(and(eq(accountSettings.accountId, ctx.accountId), eq(accountSettings.key, key)))
  if (existing.length) {
    await deps.db.update(accountSettings).set({ value, updatedBy: ctx.userId, updatedAt: deps.clock.now() })
      .where(and(eq(accountSettings.accountId, ctx.accountId), eq(accountSettings.key, key)))
  } else {
    await deps.db.insert(accountSettings).values({ accountId: ctx.accountId, key, value, updatedBy: ctx.userId })
  }
  await audit(deps.db, ctx, 'setting.changed', { type: 'setting', id: key }, { value })
}

// Demo mode routes every task to free mock providers. New accounts start in
// demo mode, so nothing can spend money until keys are added and the owner
// switches to live.
export type ProviderMode = 'demo' | 'live'
export const providerMode = (db: Db, accountId: string) => getSetting<ProviderMode>(db, accountId, 'provider_mode', 'demo')

export async function resolveRoute(deps: Deps, ctx: Ctx, task: string): Promise<Route> {
  const base = deps.config.routing.tasks[task]
  if (!base) throw new AppError('bad_request', `No route for task "${task}".`)
  const overrides = await getSetting<Record<string, Partial<Route>>>(deps.db, ctx.accountId, 'routing_overrides', {})
  const route = { ...base, ...(overrides[task] ?? {}) }
  if ((await providerMode(deps.db, ctx.accountId)) === 'live') return route
  const isLlm = deps.config.models.llm_models.some(m => m.ref === route.model)
  const isVideo = route.kind === 'video' || route.kind === 'video_extend'
  return { ...route, model: isLlm ? deps.config.routing.mock.llm : isVideo ? deps.config.routing.mock.video : deps.config.routing.mock.image }
}
