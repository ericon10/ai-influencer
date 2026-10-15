import { existsSync, readFileSync, statfsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { jobs, workerStatus } from '../db/schema.js'
import type { Deps } from '../context.js'
import { codeVersion } from '../lib/codeVersion.js'
import { workerBaseUrl } from './wake.js'

// The worker light in the Studio header (owner, 2026-10-13): green "Worker
// ready" with the code version, yellow "Worker restarting" after a push,
// red "Worker down". It is read from the database, never by calling the
// worker, so an open Studio tab does not keep a sleeping worker awake.

export type WorkerState = 'ready' | 'restarting' | 'down'
export interface WorkerStatusView {
  state: WorkerState
  message: string
  version: string | null
  expected: string | null
  commit: string | null
  startedAt: string | null
  lastSeenAt: string | null
  inProcess: boolean
  // Free disk on the worker, in MB (owner, 2026-10-15), and when it was read.
  freeDiskMb: number | null
  diskCheckedAt: string | null
}

// Free space where the worker writes its temp files, in MB.
export function freeDiskMb(dir = tmpdir()): number | null {
  try {
    const s = statfsSync(dir)
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 / 1024)
  } catch { return null }
}

// The temp folders the Studio makes (server/media/ffmpeg.ts withTempDir, the
// runner's ingest, the mock video). A crash leaves them behind; the worker
// deletes them when it starts (owner, 2026-10-15). Only folders older than
// a few minutes, in case another worker shares the disk.
const TEMP_PREFIXES = ['studio-media-', 'ingest-', 'mock-video-']
export async function sweepTemp(dir = tmpdir(), olderThanMs = 5 * 60_000, now = Date.now()): Promise<{ removed: number; bytes: number }> {
  let removed = 0, bytes = 0
  const size = async (p: string): Promise<number> => {
    const st = await stat(p).catch(() => null)
    if (!st) return 0
    if (!st.isDirectory()) return st.size
    let n = 0
    for (const e of await readdir(p).catch(() => [] as string[])) n += await size(join(p, e))
    return n
  }
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!TEMP_PREFIXES.some(x => name.startsWith(x))) continue
    const p = join(dir, name)
    const st = await stat(p).catch(() => null)
    if (!st?.isDirectory() || now - st.mtimeMs < olderThanMs) continue
    bytes += await size(p)
    await rm(p, { recursive: true, force: true }).then(() => { removed++ }, () => undefined)
  }
  return { removed, bytes }
}

const ROW = 'main'
// Work that waited this long while the worker stayed quiet means it is down.
const STUCK_MS = 3 * 60_000
const QUIET_MS = 2 * 60_000
const WAKE_FAIL_MS = 10 * 60_000
// A worker deploy that has not arrived after this long probably failed.
const UPDATE_MS = 20 * 60_000

let apiVersion: string | null | undefined
// The code the API runs (and so the code a worker should run).
export function expectedVersion(): string | null {
  if (apiVersion === undefined) apiVersion = codeVersion(process.cwd())
  return apiVersion
}

// The worker's own version: saved next to its bundle at build time (the
// Docker image has no sources), else hashed from the sources (local runs).
export function workerVersion(): string | null {
  try {
    const file = new URL('./code-version.txt', import.meta.url)
    if (existsSync(file)) return readFileSync(file, 'utf8').trim() || null
  } catch { /* not built */ }
  return codeVersion(process.cwd())
}

export async function reportWorkerStart(deps: Pick<Deps, 'db' | 'clock'>, info: { version: string | null; commit: string | null }): Promise<void> {
  const now = deps.clock.now()
  const values = { version: info.version, commit: info.commit, startedAt: now, lastSeenAt: now, wakeFailedAt: null, wakeError: null, freeDiskMb: freeDiskMb(), diskCheckedAt: now, updatedAt: now }
  await deps.db.insert(workerStatus).values({ id: ROW, ...values }).onConflictDoUpdate({ target: workerStatus.id, set: values })
}

let lastTouch = 0
// "Still here", at most every 20 seconds while the worker has work.
export async function touchWorker(deps: Pick<Deps, 'db' | 'clock'>): Promise<void> {
  const now = deps.clock.now()
  if (now.getTime() - lastTouch < 20_000) return
  lastTouch = now.getTime()
  await deps.db.update(workerStatus).set({ lastSeenAt: now, freeDiskMb: freeDiskMb(), diskCheckedAt: now, updatedAt: now }).where(eq(workerStatus.id, ROW))
}

export async function recordWakeFailure(deps: Pick<Deps, 'db' | 'clock'>, message: string): Promise<void> {
  const now = deps.clock.now()
  await deps.db.insert(workerStatus).values({ id: ROW, wakeFailedAt: now, wakeError: message.slice(0, 300), updatedAt: now })
    .onConflictDoUpdate({ target: workerStatus.id, set: { wakeFailedAt: now, wakeError: message.slice(0, 300), updatedAt: now } })
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000))

export async function readWorkerStatus(deps: Pick<Deps, 'db' | 'clock' | 'env'>): Promise<WorkerStatusView> {
  const expected = expectedVersion()
  // Without a worker address the worker runs inside the API process (local
  // development): it is as ready as the API answering this.
  if (!workerBaseUrl(deps.env.STUDIO_WORKER_URL)) {
    return { state: 'ready', message: 'The worker runs inside the Studio here.', version: expected, expected, commit: null, startedAt: null, lastSeenAt: null, inProcess: true, freeDiskMb: freeDiskMb(), diskCheckedAt: deps.clock.now().toISOString() }
  }
  const now = deps.clock.now().getTime()
  const [row] = await deps.db.select().from(workerStatus).where(eq(workerStatus.id, ROW))
  // How long the oldest due job has waited (since it became due).
  const [stuck] = await deps.db.select({ oldest: sql<Date | null>`min(coalesce(${jobs.nextPollAt}, ${jobs.createdAt}))` }).from(jobs)
    .where(and(eq(jobs.status, 'queued'), or(isNull(jobs.nextPollAt), lte(jobs.nextPollAt, deps.clock.now()))))
  const oldest = stuck?.oldest ? new Date(stuck.oldest).getTime() : null
  const base = {
    version: row?.version ?? null, expected, commit: row?.commit ?? null,
    startedAt: iso(row?.startedAt), lastSeenAt: iso(row?.lastSeenAt), inProcess: false,
    freeDiskMb: row?.freeDiskMb ?? null, diskCheckedAt: iso(row?.diskCheckedAt),
  }
  const lastSeen = row?.lastSeenAt?.getTime() ?? 0
  const wakeFailed = row?.wakeFailedAt?.getTime() ?? 0
  if (wakeFailed && wakeFailed > lastSeen && now - wakeFailed < WAKE_FAIL_MS) {
    return { ...base, state: 'down', message: `The Studio could not wake the worker (${row?.wakeError ?? 'no answer'}). Nothing new will run until it is back; check Railway.` }
  }
  if (oldest && now - oldest > STUCK_MS && now - lastSeen > QUIET_MS) {
    return { ...base, state: 'down', message: `Work has waited ${minutes(now - oldest)} min and the worker is not picking it up. Check Railway.` }
  }
  if (!row?.version || (expected && row.version !== expected)) {
    // Remember since when this version is awaited (the first read after a push).
    let since = row?.waitingFor === expected && row?.waitingSince ? row.waitingSince.getTime() : null
    if (since === null) {
      since = now
      await deps.db.insert(workerStatus).values({ id: ROW, waitingFor: expected, waitingSince: deps.clock.now(), updatedAt: deps.clock.now() })
        .onConflictDoUpdate({ target: workerStatus.id, set: { waitingFor: expected, waitingSince: deps.clock.now(), updatedAt: deps.clock.now() } })
    }
    if (now - since > UPDATE_MS) {
      return { ...base, state: 'down', message: `The worker has not updated to the new code in ${minutes(now - since)} min; its deploy may have failed. Check Railway.` }
    }
    return { ...base, state: 'restarting', message: 'The worker is updating to the new code (usually 3 to 5 minutes). Starting work now could run on the old code, so it waits.' }
  }
  return { ...base, state: 'ready', message: 'The worker is running the current code.' }
}
