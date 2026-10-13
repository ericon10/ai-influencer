import { and, eq } from 'drizzle-orm'
import { accountSettings } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import type { Route } from '../config/load.js'
import { audit } from '../lib/audit.js'
import { AppError } from '../lib/errors.js'
import { ruleSwitches } from './rules.js'

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

// A cache the Studio keeps for itself (no person changed anything, so no
// audit entry): last write wins.
export async function putCacheSetting(db: Db, accountId: string, key: string, value: unknown): Promise<void> {
  await db.insert(accountSettings).values({ accountId, key, value })
    .onConflictDoUpdate({ target: [accountSettings.accountId, accountSettings.key], set: { value, updatedAt: new Date() } })
}

export async function deleteSetting(db: Db, accountId: string, key: string): Promise<void> {
  await db.delete(accountSettings).where(and(eq(accountSettings.accountId, accountId), eq(accountSettings.key, key)))
}

// Demo mode routes every task to free mock providers. New accounts start in
// demo mode, so nothing can spend money until keys are added and the owner
// switches to live.
export type ProviderMode = 'demo' | 'live'
export const providerMode = (db: Db, accountId: string) => getSetting<ProviderMode>(db, accountId, 'provider_mode', 'demo')

// The route as configured for this account (config plus overrides), before
// demo mode swaps in mock providers. Locks such as the sheet model record
// this real model, so a sheet started in demo mode keeps its real model
// when the account goes live.
export const ROUTING_OVERRIDES_KEY = 'routing_overrides'

export async function liveRoute(deps: Deps, ctx: Ctx, task: string): Promise<Route> {
  const base = deps.config.routing.tasks[task]
  if (!base) throw new AppError('bad_request', `No route for task "${task}".`)
  const overrides = await getSetting<Record<string, Partial<Route>>>(deps.db, ctx.accountId, ROUTING_OVERRIDES_KEY, {})
  return { ...base, ...(overrides[task] ?? {}) }
}

// What actually runs: the real route when live, its free mock in demo mode.
export async function forMode(deps: Deps, ctx: Ctx, route: Route): Promise<Route> {
  if ((await providerMode(deps.db, ctx.accountId)) === 'live') return route
  const isLlm = deps.config.models.llm_models.some(m => m.ref === route.model)
  const isVideo = route.kind === 'video' || route.kind === 'video_extend'
  return { ...route, model: isLlm ? deps.config.routing.mock.llm : isVideo ? deps.config.routing.mock.video : deps.config.routing.mock.image }
}

// Claude tasks (a route on a Claude model) and the model each one runs on
// for this account: Sonnet 5.5 unless switched in Settings, Claude models.
const isClaudeTask = (deps: Deps, task: string) => deps.config.models.llm_models.some(m => m.ref === deps.config.routing.tasks[task]?.model && !m.ref.startsWith('mock/'))

export async function claudeModels(deps: Deps, ctx: Ctx) {
  const label = (ref: string) => deps.config.models.llm_models.find(m => m.ref === ref)?.label ?? ref
  const tasks = Object.keys(deps.config.routing.tasks).filter(t => isClaudeTask(deps, t))
  // A task with a rule can be switched off for the account (Settings, Rules
  // has the same switch, and a per-character one).
  const sw = await ruleSwitches(deps, ctx, null)
  return {
    choices: deps.config.routing.claude_choices.map(ref => ({ ref, label: label(ref) })),
    tasks: await Promise.all(tasks.map(async task => {
      const base = deps.config.routing.tasks[task]!
      const model = (await liveRoute(deps, ctx, task)).model
      return {
        task, label: base.label ?? task.replace(/_/g, ' '), hint: base.hint ?? '', model, modelLabel: label(model), default: base.model, changed: model !== base.model,
        rule: base.rule ? { id: base.rule, on: sw.on(base.rule) } : null,
      }
    })),
  }
}

export async function setClaudeModel(deps: Deps, ctx: Ctx, task: string, model: string): Promise<void> {
  if (!isClaudeTask(deps, task)) throw new AppError('bad_request', `"${task}" is not a Claude task.`)
  if (!deps.config.routing.claude_choices.includes(model)) throw new AppError('bad_request', `Pick one of: ${deps.config.routing.claude_choices.join(', ')}.`)
  const overrides = { ...(await getSetting<Record<string, Partial<Route>>>(deps.db, ctx.accountId, ROUTING_OVERRIDES_KEY, {})) }
  const { model: _old, ...rest } = overrides[task] ?? {}
  // Back to the default: drop the override, so a config change reaches it.
  if (model === deps.config.routing.tasks[task]!.model) {
    if (Object.keys(rest).length) overrides[task] = rest
    else delete overrides[task]
  } else {
    overrides[task] = { ...rest, model }
  }
  await setSetting(deps, ctx, ROUTING_OVERRIDES_KEY, overrides)
}

export async function resolveRoute(deps: Deps, ctx: Ctx, task: string): Promise<Route> {
  return forMode(deps, ctx, await liveRoute(deps, ctx, task))
}
