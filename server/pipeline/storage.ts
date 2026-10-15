import { and, eq, inArray, like } from 'drizzle-orm'
import type { Ctx, Deps } from '../context.js'
import { jobs } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { getSetting, putCacheSetting, setSetting } from './settings.js'
import { autoClean, autoCleanPlan, DEFAULT_AUTO_CLEAN_DAYS, purgeDue, TRASH_DAYS, type AutoCleanItem } from './trash.js'

// Storage, traffic and auto-clean (owner, 2026-10-15; UX-PLAN.md section
// 22). The daily clean runs on the worker once a day per account: upload
// slots never used (older than a day), the Trash past its 7 days, Auto-clean
// of takes never kept, and the storage measure for Settings > Storage.

const DAY = 86_400_000
export const UPLOAD_SLOT_DAYS = 1
// R2: $0.015 per GB-month; the first 10 GB a month are free (per Cloudflare
// account). GB here is 10^9 bytes, as R2 bills it.
export const R2_PRICE_PER_GB = 0.015
export const R2_FREE_GB = 10
export const AUTO_CLEAN_CHOICES = [3, 7, 14, 30] as const

const KEY_AUTO = 'storage.autoCleanDays'
const KEY_USAGE = 'storage.usage'
const KEY_RAN = 'storage.cleanedAt'
// Auto-clean never runs until the owner has looked at its first list
// (owner, 2026-10-15) and pressed Start Auto-clean.
const KEY_STARTED = 'storage.autoCleanStartedAt'

export interface StorageUsage { bytes: number; files: number; uploadsWaiting: number; measuredAt: string }
export interface CleanResult { uploadsRemoved: number; purged: number; filesRemoved: number; autoCleaned: number; usage: StorageUsage; lifecycle: string | null }

export const monthlyCost = (bytes: number) => Math.max(0, bytes / 1e9 - R2_FREE_GB) * R2_PRICE_PER_GB

const prefixes = (accountId: string) => [`acct/${accountId}/`, `uploads/${accountId}/`]

export async function measureUsage(deps: Deps, ctx: Ctx): Promise<StorageUsage> {
  let bytes = 0, files = 0, uploadsWaiting = 0
  for (const p of prefixes(ctx.accountId)) {
    for (const f of await deps.store.list(p)) {
      bytes += f.size
      files++
      if (p.startsWith('uploads/')) uploadsWaiting++
    }
  }
  const usage = { bytes, files, uploadsWaiting, measuredAt: deps.clock.now().toISOString() }
  await putCacheSetting(deps.db, ctx.accountId, KEY_USAGE, usage)
  return usage
}

// Upload slots never used (a closed tab, a form never sent) after a day.
export async function sweepUploads(deps: Deps, ctx: Ctx): Promise<number> {
  const cutoff = deps.clock.now().getTime() - UPLOAD_SLOT_DAYS * DAY
  let removed = 0
  for (const f of await deps.store.list(`uploads/${ctx.accountId}/`)) {
    if (f.lastModified.getTime() > cutoff) continue
    await deps.store.delete(f.key)
    removed++
  }
  return removed
}

// Off is kept as 0 (a setting is never null).
export async function autoCleanDays(deps: Deps, ctx: Ctx): Promise<number | null> {
  return (await getSetting<number | null>(deps.db, ctx.accountId, KEY_AUTO, DEFAULT_AUTO_CLEAN_DAYS)) || null
}

export async function setAutoCleanDays(deps: Deps, ctx: Ctx, days: number | null): Promise<void> {
  if (days !== null && !(AUTO_CLEAN_CHOICES as readonly number[]).includes(days)) throw new AppError('bad_request', `Pick ${AUTO_CLEAN_CHOICES.join(', ')} days, or Off.`)
  await setSetting(deps, ctx, KEY_AUTO, days ?? 0)
}

export const autoCleanStarted = async (deps: Deps, ctx: Ctx) => !!(await getSetting<string | null>(deps.db, ctx.accountId, KEY_STARTED, null))

// What the next Auto-clean would move to the Trash, without moving it.
export async function autoCleanPreview(deps: Deps, ctx: Ctx): Promise<{ days: number | null; started: boolean; items: AutoCleanItem[] }> {
  const days = await autoCleanDays(deps, ctx)
  return { days, started: await autoCleanStarted(deps, ctx), items: await autoCleanPlan(deps, ctx, days) }
}

// The owner saw the list: from the next daily clean on, Auto-clean runs.
export async function startAutoClean(deps: Deps, ctx: Ctx): Promise<void> {
  await setSetting(deps, ctx, KEY_STARTED, deps.clock.now().toISOString())
}

export async function runClean(deps: Deps, ctx: Ctx): Promise<CleanResult> {
  // The bucket deletes stale upload slots itself when the key may say so.
  const lifecycle = deps.store.ensureExpiry ? (await deps.store.ensureExpiry('uploads/', UPLOAD_SLOT_DAYS)).message : null
  const uploadsRemoved = await sweepUploads(deps, ctx)
  const purge = await purgeDue(deps, ctx)
  const auto = (await autoCleanStarted(deps, ctx)) ? await autoClean(deps, ctx, await autoCleanDays(deps, ctx)) : { moved: 0 }
  const usage = await measureUsage(deps, ctx)
  await putCacheSetting(deps.db, ctx.accountId, KEY_RAN, deps.clock.now().toISOString())
  return { uploadsRemoved, purged: purge.items, filesRemoved: purge.files, autoCleaned: auto.moved, usage, lifecycle }
}

const CLEAN = 'storage_clean'
const running = (deps: Deps, ctx: Ctx) => deps.db.select({ id: jobs.id }).from(jobs)
  .where(and(eq(jobs.accountId, ctx.accountId), like(jobs.purpose, `${CLEAN}:%`), inArray(jobs.status, ['waiting', 'queued', 'submitting', 'running', 'ingesting'])))

// Queues the daily clean when it is due (the Studio calls this when Posts
// home opens; queueing wakes the worker). `now` runs it regardless.
export async function cleanIfDue(deps: Deps, ctx: Ctx, opts: { now?: boolean } = {}): Promise<boolean> {
  const last = await getSetting<string | null>(deps.db, ctx.accountId, KEY_RAN, null)
  if (!opts.now && last && deps.clock.now().getTime() - Date.parse(last) < DAY) return false
  if ((await running(deps, ctx)).length) return false
  const purpose = `${CLEAN}:${deps.clock.now().toISOString().slice(0, 10)}`
  // One try a day on its own: a clean that failed today waits for
  // tomorrow (or Measure now), never a new job on every list refresh.
  if (!opts.now) {
    const [today] = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.purpose, purpose))).limit(1)
    if (today) return false
  }
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose, label: opts.now ? 'Measure storage' : 'Daily clean', characterId: null, request: {} })
  return true
}

export interface StorageView {
  usage: StorageUsage | null
  monthlyCost: number | null
  priceNote: string
  autoCleanDays: number | null
  autoCleanChoices: number[]
  // The next Auto-clean: how many items, and whether it has been started.
  autoCleanNext: number
  autoCleanStarted: boolean
  trashDays: number
  uploadSlotDays: number
  cleanedAt: string | null
  measuring: boolean
}

export async function storageView(deps: Deps, ctx: Ctx): Promise<StorageView> {
  const usage = await getSetting<StorageUsage | null>(deps.db, ctx.accountId, KEY_USAGE, null)
  return {
    usage,
    monthlyCost: usage ? Math.round(monthlyCost(usage.bytes) * 100) / 100 : null,
    priceNote: `R2 storage: $${R2_PRICE_PER_GB} per GB-month; the first ${R2_FREE_GB} GB a month are free (for the whole Cloudflare account).`,
    autoCleanDays: await autoCleanDays(deps, ctx),
    autoCleanChoices: [...AUTO_CLEAN_CHOICES],
    autoCleanNext: (await autoCleanPlan(deps, ctx, await autoCleanDays(deps, ctx))).length,
    autoCleanStarted: await autoCleanStarted(deps, ctx),
    trashDays: TRASH_DAYS,
    uploadSlotDays: UPLOAD_SLOT_DAYS,
    cleanedAt: await getSetting<string | null>(deps.db, ctx.accountId, KEY_RAN, null),
    measuring: (await running(deps, ctx)).length > 0,
  }
}

async function runCleanJob(deps: Deps, ctx: Ctx, _job: JobRow): Promise<unknown> {
  return runClean(deps, ctx)
}

let registered = false
export function registerStorage(): void {
  if (registered) return
  registered = true
  registerLocalJob(CLEAN, runCleanJob)
}
