import { mkdtemp, mkdir, writeFile, utimes, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, like } from 'drizzle-orm'
import { createHarness, type Harness } from '../testing/harness.js'
import { accountSettings, jobs } from '../db/schema.js'
import type { BlobStore } from '../storage/blobStore.js'
import { tick } from '../jobs/runner.js'
import { freeDiskMb, sweepTemp } from '../jobs/workerStatus.js'
import { registerPipelineHooks } from './hooks.js'
import { cleanIfDue, measureUsage, monthlyCost, setAutoCleanDays, storageView, sweepUploads } from './storage.js'

// Storage, traffic and auto-clean (owner, 2026-10-15): upload slots never
// used go after a day, the readout counts the account's files and prices
// them ($0.015 per GB-month, the first 10 GB free), the daily clean runs on
// the worker once a day, and the worker clears temp folders a crash left.

const DAY = 86_400_000
let h: Harness

beforeAll(async () => {
  h = await createHarness()
  registerPipelineHooks()
})
afterAll(async () => { await h.close() })

// The memory store dates files by the real clock; here a slot is made old.
const aged = (store: BlobStore, old: (key: string) => boolean, at: Date): BlobStore => ({
  ...store,
  list: async prefix => (await store.list(prefix)).map(f => (old(f.key) ? { ...f, lastModified: at } : f)),
})

describe('storage', () => {
  it('prices storage: free under 10 GB, $0.015 per GB-month above', () => {
    expect(monthlyCost(3e9)).toBe(0)
    expect(monthlyCost(10e9)).toBe(0)
    expect(monthlyCost(110e9)).toBeCloseTo(1.5, 6)
  })

  it('deletes upload slots never used after a day, and only this account', async () => {
    const acct = h.ctx.accountId
    const other = await h.newAccount('Other')
    await h.deps.store.put(`uploads/${acct}/old-slot`, Buffer.from('x'), 'image/png')
    await h.deps.store.put(`uploads/${acct}/new-slot`, Buffer.from('y'), 'image/png')
    await h.deps.store.put(`uploads/${other.accountId}/old-slot`, Buffer.from('z'), 'image/png')
    const now = new Date()
    h.clock.set(now)
    const deps = { ...h.deps, store: aged(h.deps.store, k => k.endsWith('old-slot'), new Date(now.getTime() - 2 * DAY)) }
    expect(await sweepUploads(deps, h.ctx)).toBe(1)
    expect(await h.deps.store.exists(`uploads/${acct}/old-slot`)).toBe(false)
    expect(await h.deps.store.exists(`uploads/${acct}/new-slot`)).toBe(true)
    expect(await h.deps.store.exists(`uploads/${other.accountId}/old-slot`)).toBe(true)
  })

  it('measures the account in storage and keeps the readout', async () => {
    await h.deps.store.put(`acct/${h.ctx.accountId}/2026/10/a.png`, Buffer.alloc(1500), 'image/png')
    const usage = await measureUsage(h.deps, h.ctx)
    expect(usage.files).toBeGreaterThanOrEqual(2)
    expect(usage.bytes).toBeGreaterThanOrEqual(1501)
    expect(usage.uploadsWaiting).toBe(1)
    const view = await storageView(h.deps, h.ctx)
    expect(view).toMatchObject({ usage: { bytes: usage.bytes }, monthlyCost: 0, autoCleanDays: 14, trashDays: 7, uploadSlotDays: 1 })
    expect(view.priceNote).toMatch(/\$0.015 per GB-month; the first 10 GB/)
  })

  it('Auto-clean is 14 days by default, can be another choice or Off, nothing else', async () => {
    await setAutoCleanDays(h.deps, h.ctx, 30)
    expect((await storageView(h.deps, h.ctx)).autoCleanDays).toBe(30)
    await setAutoCleanDays(h.deps, h.ctx, null)
    expect((await storageView(h.deps, h.ctx)).autoCleanDays).toBeNull()
    await expect(setAutoCleanDays(h.deps, h.ctx, 5)).rejects.toThrow(/Pick 3, 7, 14, 30 days, or Off/)
    await setAutoCleanDays(h.deps, h.ctx, 14)
  })

  it('queues the daily clean once a day, and it runs on the worker', async () => {
    const queued = async () => h.deps.db.select().from(jobs).where(and(eq(jobs.accountId, h.ctx.accountId), like(jobs.purpose, 'storage_clean:%')))
    expect(await cleanIfDue(h.deps, h.ctx)).toBe(true)
    // Not twice while one waits.
    expect(await cleanIfDue(h.deps, h.ctx)).toBe(false)
    expect((await storageView(h.deps, h.ctx)).measuring).toBe(true)
    while (await tick(h.deps)) { /* run it */ }
    const [job] = await queued()
    expect(job!.status).toBe('completed')
    const view = await storageView(h.deps, h.ctx)
    expect(view.cleanedAt).toBe(h.clock.now().toISOString())
    expect(view.measuring).toBe(false)
    // Done today: not due again until a day has passed.
    expect(await cleanIfDue(h.deps, h.ctx)).toBe(false)
    // A clean that failed is tried again tomorrow, not on every refresh.
    await h.deps.db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, job!.id))
    await h.deps.db.delete(accountSettings).where(and(eq(accountSettings.accountId, h.ctx.accountId), eq(accountSettings.key, 'storage.cleanedAt')))
    expect(await cleanIfDue(h.deps, h.ctx)).toBe(false)
    expect(await cleanIfDue(h.deps, h.ctx, { now: true })).toBe(true)
    while (await tick(h.deps)) { /* run it */ }
    h.clock.advance(DAY + 1000)
    expect(await cleanIfDue(h.deps, h.ctx)).toBe(true)
    while (await tick(h.deps)) { /* run it */ }
  })
})

describe('worker temp sweep', () => {
  it('deletes temp folders a crash left behind, never fresh ones or anything else', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sweep-test-'))
    try {
      for (const d of ['studio-media-old', 'ingest-old', 'mock-video-old', 'studio-media-fresh', 'someone-else']) {
        await mkdir(join(root, d))
        await writeFile(join(root, d, 'part.mp4'), Buffer.alloc(2048))
      }
      const old = new Date(Date.now() - 60 * 60_000)
      for (const d of ['studio-media-old', 'ingest-old', 'mock-video-old', 'someone-else']) await utimes(join(root, d), old, old)
      const r = await sweepTemp(root)
      expect(r.removed).toBe(3)
      expect(r.bytes).toBeGreaterThanOrEqual(3 * 2048)
      expect((await readdir(root)).sort()).toEqual(['someone-else', 'studio-media-fresh'])
      expect(freeDiskMb(root)).toBeGreaterThan(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
