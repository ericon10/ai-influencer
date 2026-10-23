import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { assets, comfyLoras, comfyTasks, jobs } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { BlobStore } from '../storage/blobStore.js'
import type { StudioConfig } from '../config/load.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { sha256Hex } from '../lib/passwords.js'
import { getSetting, putCacheSetting, setSetting } from './settings.js'
import { bindWorkflow, envDiff, envHash, workflowProblems, type ApiGraph, type BindInput, type ComfyFamily, type EnvLock, type Workflow, type WorkflowManifest } from '../core/comfyWorkflows.js'

// ComfyUI on a remote workstation (UX-PLAN.md section 41). The machine
// never takes a call: its agent calls out with a token, sends a heartbeat,
// claims tasks from this queue, fetches inputs through short-lived links,
// puts outputs straight into storage and reports done. Every task has an
// idempotency key, a lease renewed by progress, one reclaim (attempt 2)
// and then the Failed list. Applies to every account and character.

export interface ComfyDeps { db: Db; store: BlobStore; config: StudioConfig }

export const OFFLINE_AFTER_MS = 120_000
export const LEASE_MS = 90_000
const INPUT_LINK_SEC = 3600
const COMFY_KEY = 'comfy'
const AGENT_KEY = 'comfy_agent'
const WORKFLOWS_KEY = 'comfy_workflows'

export interface ComfySettings {
  tokenHash?: string
  tokenLast4?: string
  tokenAt?: string
  // The machine's private tunnel address (Tailscale or Cloudflare Tunnel),
  // for reaching it by hand. The Studio never calls it.
  tunnel?: string
  paused?: boolean
  maxJobs?: number
  // The environment this account accepts (Use this machine's environment);
  // null: the repo's comfy/env/environment.lock.json.
  expectedEnv?: EnvLock | null
  expectedEnvAt?: string
  testAskedAt?: string | null
}

export interface AgentStatus {
  lastSeen: string
  agentVersion?: string
  comfyOk?: boolean
  comfyError?: string
  gpu?: string
  vramTotalMb?: number
  vramFreeMb?: number
  gpuUse?: number
  comfyQueue?: number
  models?: string[]
  env?: EnvLock
  envHash?: string
  loadedFamily?: ComfyFamily | null
  localPause?: boolean
  running?: Array<{ id: string; claimToken: string }>
  testAnsweredAt?: string
}

export const comfySettings = (db: Db, accountId: string) => getSetting<ComfySettings>(db, accountId, COMFY_KEY, {})
export const agentStatus = (db: Db, accountId: string) => getSetting<AgentStatus | null>(db, accountId, AGENT_KEY, null)
export const isOnline = (a: AgentStatus | null, now: Date) => !!a && now.getTime() - new Date(a.lastSeen).getTime() < OFFLINE_AFTER_MS

// ── Workflows ──

const COMFY_DIR = () => resolve(process.cwd(), 'comfy')
let repoWorkflows: Workflow[] | null = null
let repoLockCache: EnvLock | null = null

export function loadRepoWorkflows(dir = resolve(COMFY_DIR(), 'workflows')): Workflow[] {
  if (repoWorkflows && dir === resolve(COMFY_DIR(), 'workflows')) return repoWorkflows
  const out: Workflow[] = []
  for (const f of readdirSync(dir).filter(n => n.endsWith('.manifest.json')).sort()) {
    const manifest = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as WorkflowManifest
    const graph = JSON.parse(readFileSync(resolve(dir, f.replace('.manifest.json', '.api.json')), 'utf8')) as ApiGraph
    const problems = workflowProblems(manifest, graph)
    if (problems.length) throw new Error(`comfy/workflows/${f}: ${problems.join(' ')}`)
    out.push({ manifest, graph, source: 'repo' })
  }
  repoWorkflows = out
  return out
}

export function repoLock(): EnvLock {
  if (!repoLockCache) repoLockCache = JSON.parse(readFileSync(resolve(COMFY_DIR(), 'env', 'environment.lock.json'), 'utf8')) as EnvLock
  return repoLockCache
}

// The account's workflows: the repo's, then uploads (an upload with the
// same id and a higher version wins).
export async function workflowsFor(db: Db, accountId: string): Promise<Workflow[]> {
  const uploaded = await getSetting<Array<{ manifest: WorkflowManifest; graph: ApiGraph }>>(db, accountId, WORKFLOWS_KEY, [])
  const all = new Map<string, Workflow>()
  for (const w of loadRepoWorkflows()) all.set(w.manifest.id, w)
  for (const w of uploaded) {
    const had = all.get(w.manifest.id)
    if (!had || had.manifest.version <= w.manifest.version) all.set(w.manifest.id, { ...w, source: 'uploaded' })
  }
  return [...all.values()]
}

export async function workflowForRef(db: Db, accountId: string, ref: string, kind: string): Promise<Workflow> {
  const list = await workflowsFor(db, accountId)
  const wf = list.find(w => w.manifest.ref === ref && w.manifest.kinds.includes(kind)) ?? list.find(w => w.manifest.ref === ref)
  if (!wf) throw new AppError('bad_request', `No ComfyUI workflow for ${ref}. Upload one in Settings > ComfyUI > Workflows.`)
  return wf
}

export async function uploadWorkflow(deps: Deps, ctx: Ctx, input: { manifest: unknown; graph: unknown }): Promise<{ id: string; version: number }> {
  const m = input.manifest as WorkflowManifest
  const problems = workflowProblems(m, input.graph)
  if (problems.length) throw new AppError('bad_request', problems.join(' '))
  const list = await getSetting<Array<{ manifest: WorkflowManifest; graph: ApiGraph }>>(deps.db, ctx.accountId, WORKFLOWS_KEY, [])
  const current = (await workflowsFor(deps.db, ctx.accountId)).find(w => w.manifest.id === m.id)
  const version = Math.max(m.version || 1, (current?.manifest.version ?? 0) + 1)
  const next = [...list.filter(w => w.manifest.id !== m.id), { manifest: { ...m, version }, graph: input.graph as ApiGraph }]
  await setSetting(deps, ctx, WORKFLOWS_KEY, next)
  return { id: m.id, version }
}

// ── Owner settings: token, pause, max jobs, environment ──

export async function createAgentToken(deps: Deps, ctx: Ctx): Promise<{ token: string; last4: string }> {
  const token = `cfy.${ctx.accountId}.${randomBytes(24).toString('base64url')}`
  const s = await comfySettings(deps.db, ctx.accountId)
  await setSetting(deps, ctx, COMFY_KEY, { ...s, tokenHash: sha256Hex(token), tokenLast4: token.slice(-4), tokenAt: deps.clock.now().toISOString() })
  return { token, last4: token.slice(-4) }
}

export async function updateComfySettings(deps: Deps, ctx: Ctx, patch: { paused?: boolean; maxJobs?: number; tunnel?: string; acceptMachineEnv?: boolean; useRepoEnv?: boolean; testConnection?: boolean }): Promise<void> {
  const s = await comfySettings(deps.db, ctx.accountId)
  const next: ComfySettings = { ...s }
  if (patch.paused !== undefined) next.paused = patch.paused
  if (patch.maxJobs !== undefined) next.maxJobs = Math.max(1, Math.min(8, Math.round(patch.maxJobs)))
  if (patch.tunnel !== undefined) next.tunnel = patch.tunnel.trim().slice(0, 300)
  if (patch.acceptMachineEnv) {
    const a = await agentStatus(deps.db, ctx.accountId)
    if (!a?.env) throw new AppError('bad_request', 'The machine has not sent its environment yet. Start the agent, then try again.')
    next.expectedEnv = a.env
    next.expectedEnvAt = deps.clock.now().toISOString()
  }
  if (patch.useRepoEnv) { next.expectedEnv = null; next.expectedEnvAt = deps.clock.now().toISOString() }
  if (patch.testConnection) next.testAskedAt = deps.clock.now().toISOString()
  await setSetting(deps, ctx, COMFY_KEY, next)
}

export const expectedLock = (s: ComfySettings): EnvLock => s.expectedEnv ?? repoLock()

export function envCheck(s: ComfySettings, a: AgentStatus | null): { ok: boolean; expected: string; actual: string | null; problems: string[] } {
  const lock = expectedLock(s)
  const expected = envHash(lock)
  const actual = a?.env ? envHash(a.env) : null
  return { ok: actual === expected, expected, actual, problems: actual === expected ? [] : envDiff(lock, a?.env) }
}

// ── The agent's side ──

// The account a token belongs to, or a 401. The token names its account;
// only its hash is stored.
export async function agentAccount(db: Db, header: string | undefined): Promise<string> {
  const token = (header ?? '').replace(/^Bearer\s+/i, '').trim()
  const m = /^cfy\.([a-z0-9_]+)\.[A-Za-z0-9_-]{20,}$/.exec(token)
  if (!m) throw new AppError('unauthorized', 'The agent token is missing or malformed. Make one in Settings > General > ComfyUI.')
  const s = await comfySettings(db, m[1]!)
  const want = Buffer.from(s.tokenHash ?? '', 'hex'), got = Buffer.from(sha256Hex(token), 'hex')
  if (!s.tokenHash || want.length !== got.length || !timingSafeEqual(want, got)) throw new AppError('unauthorized', 'This agent token is not the current one. Make a new one in Settings and put it on the machine.')
  return m[1]!
}

export async function heartbeat(d: ComfyDeps, accountId: string, now: Date, body: Omit<AgentStatus, 'lastSeen' | 'testAnsweredAt'>): Promise<{ paused: boolean; maxJobs: number; env: ReturnType<typeof envCheck>; cancel: string[]; test: boolean }> {
  const s = await comfySettings(d.db, accountId)
  const prev = await agentStatus(d.db, accountId)
  const test = !!s.testAskedAt && (!prev?.testAnsweredAt || prev.testAnsweredAt < s.testAskedAt)
  const status: AgentStatus = { ...body, lastSeen: now.toISOString(), testAnsweredAt: test ? now.toISOString() : prev?.testAnsweredAt }
  await putCacheSetting(d.db, accountId, AGENT_KEY, status)
  await sweep(d, accountId, now)
  // Tasks the agent is running that the Studio no longer wants (canceled,
  // timed out, reclaimed): it interrupts them.
  const running = (body.running ?? []).filter(r => /^cft_/.test(r.id))
  const rows = running.length ? await d.db.select({ id: comfyTasks.id, state: comfyTasks.state, claimToken: comfyTasks.claimToken }).from(comfyTasks).where(and(eq(comfyTasks.accountId, accountId), inArray(comfyTasks.id, running.map(r => r.id)))) : []
  const cancel = running.filter(x => { const r = rows.find(y => y.id === x.id); return !r || !['claimed', 'running'].includes(r.state) || r.claimToken !== x.claimToken }).map(x => x.id)
  return { paused: !!s.paused || !!body.localPause, maxJobs: s.maxJobs ?? 1, env: envCheck(s, status), cancel, test }
}

export interface ClaimedTask {
  id: string
  claimToken: string
  kind: 'workflow' | 'train'
  family: string
  workflowId: string
  graph: ApiGraph
  inputs: Record<string, { url: string; mime: string; name: string }>
  batch: number
  timeoutSec: number
  leaseSec: number
  train?: Record<string, unknown>
}

async function inputLink(d: ComfyDeps, accountId: string, taskId: string, slot: string, assetId: string): Promise<{ url: string; mime: string; name: string }> {
  const [a] = await d.db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.accountId, accountId)))
  if (!a) throw new AppError('not_found', `Input ${slot} is gone from storage.`)
  const ext = a.mime.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov') ?? 'bin'
  const url = (await d.store.presignGet(a.storageKey, INPUT_LINK_SEC)) ?? `/api/v1/comfy/agent/tasks/${taskId}/inputs/${encodeURIComponent(slot)}`
  return { url, mime: a.mime, name: `studio_${taskId}_${slot}.${ext}` }
}

// The next task for the machine: none while paused, at max jobs, or when
// its environment is not the expected one. Prefers the family it has
// loaded, so models are not swapped back and forth (E4).
export async function claim(d: ComfyDeps, accountId: string, now: Date, body: { loadedFamily?: string | null }): Promise<{ task: ClaimedTask | null; reason?: string }> {
  await sweep(d, accountId, now)
  const s = await comfySettings(d.db, accountId)
  const a = await agentStatus(d.db, accountId)
  if (s.paused || a?.localPause) return { task: null, reason: 'paused' }
  const env = envCheck(s, a)
  if (!env.ok) return { task: null, reason: `The machine's environment is not the expected one: ${env.problems.slice(0, 3).join(' ')}` }
  const busy = await d.db.select({ n: sql<number>`count(*)::int` }).from(comfyTasks).where(and(eq(comfyTasks.accountId, accountId), inArray(comfyTasks.state, ['claimed', 'running'])))
  if ((busy[0]?.n ?? 0) >= (s.maxJobs ?? 1)) return { task: null, reason: 'max jobs' }
  const queued = await d.db.select({ id: comfyTasks.id, family: comfyTasks.family }).from(comfyTasks)
    .where(and(eq(comfyTasks.accountId, accountId), eq(comfyTasks.state, 'queued'))).orderBy(asc(comfyTasks.createdAt)).limit(50)
  const order = [...queued.filter(q => q.family === body.loadedFamily), ...queued.filter(q => q.family !== body.loadedFamily)]
  for (const q of order) {
    const claimToken = randomBytes(12).toString('hex')
    const [row] = await d.db.update(comfyTasks).set({ state: 'claimed', claimToken, claimedAt: now, leaseUntil: new Date(now.getTime() + LEASE_MS), envHash: env.actual, updatedAt: now })
      .where(and(eq(comfyTasks.id, q.id), eq(comfyTasks.state, 'queued'))).returning()
    if (!row) continue
    const inputs: ClaimedTask['inputs'] = {}
    for (const [slot, assetId] of Object.entries(row.inputs as Record<string, string>)) inputs[slot] = await inputLink(d, accountId, row.id, slot, assetId)
    return { task: { id: row.id, claimToken, kind: row.kind as ClaimedTask['kind'], family: row.family, workflowId: row.workflowId, graph: row.graph as ApiGraph, inputs, batch: row.batch, timeoutSec: row.timeoutSec, leaseSec: LEASE_MS / 1000, ...(row.kind === 'train' ? { train: (row.recipe as { train?: Record<string, unknown> }).train } : {}) } }
  }
  return { task: null }
}

async function ownTask(d: ComfyDeps, accountId: string, id: string, claimToken: string) {
  const [t] = await d.db.select().from(comfyTasks).where(and(eq(comfyTasks.id, id), eq(comfyTasks.accountId, accountId)))
  if (!t) throw new AppError('not_found', 'No such task.')
  return { t, current: t.claimToken === claimToken && ['claimed', 'running'].includes(t.state) }
}

const STALE = 'This task was handed to another try (the lease ran out); this report is ignored.'

export async function progress(d: ComfyDeps, accountId: string, now: Date, id: string, body: { claimToken: string; progress?: number }): Promise<{ cancel: boolean }> {
  const { t, current } = await ownTask(d, accountId, id, body.claimToken)
  if (!current) return { cancel: true }
  await d.db.update(comfyTasks).set({ state: 'running', startedAt: t.startedAt ?? now, progress: Math.max(0, Math.min(1, body.progress ?? t.progress)), leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now }).where(eq(comfyTasks.id, id))
  return { cancel: false }
}

// Where the agent puts output i: a direct storage link when the store has
// them (R2), else this API (the local store).
export async function uploadTarget(d: ComfyDeps, accountId: string, id: string, body: { claimToken: string; index: number; mime: string }): Promise<{ key: string; url: string; headers: Record<string, string> }> {
  const { t, current } = await ownTask(d, accountId, id, body.claimToken)
  if (!current) throw new AppError('conflict', STALE)
  if (!/^(image|video|application)\/[a-z0-9.+-]+$/.test(body.mime)) throw new AppError('bad_request', 'Outputs are images, videos or a JSON record.')
  const ext = body.mime === 'application/json' ? 'json' : body.mime.split('/')[1]!.replace('jpeg', 'jpg')
  const key = `comfy/${accountId}/${t.id}/a${t.attempt}-${Math.max(0, Math.min(15, Math.round(body.index)))}.${ext}`
  const url = (await d.store.presignPut(key, body.mime, 3600)) ?? `/api/v1/comfy/agent/tasks/${t.id}/outputs?key=${encodeURIComponent(key)}`
  return { key, url, headers: { 'content-type': body.mime } }
}

export async function receiveOutput(d: ComfyDeps, accountId: string, id: string, claimToken: string, key: string, data: Buffer, mime: string): Promise<void> {
  const { current } = await ownTask(d, accountId, id, claimToken)
  if (!current) throw new AppError('conflict', STALE)
  if (!key.startsWith(`comfy/${accountId}/${id}/`)) throw new AppError('bad_request', 'That output key is not this task\'s.')
  await d.store.put(key, data, mime)
}

export interface TaskOutput { key: string; kind: 'image' | 'video' | 'json'; mime: string; width?: number; height?: number; durationSec?: number }

// Done, once: a second report (a retry after a lost answer) changes nothing,
// so outputs are stored and posted once. A report from an earlier claim
// that was reclaimed is refused.
export async function done(d: ComfyDeps, accountId: string, now: Date, id: string, body: { claimToken: string; outputs: TaskOutput[]; seconds?: number }): Promise<{ ok: true; already: boolean }> {
  const { t, current } = await ownTask(d, accountId, id, body.claimToken)
  if (t.state === 'done') return { ok: true, already: true }
  if (!current) throw new AppError('conflict', STALE)
  if (!body.outputs.length) throw new AppError('bad_request', 'Done with no outputs: report a failure instead.')
  for (const o of body.outputs) {
    if (!o.key.startsWith(`comfy/${accountId}/${id}/`)) throw new AppError('bad_request', 'An output key is not this task\'s.')
    if (!(await d.store.exists(o.key))) throw new AppError('bad_request', `Output ${o.key} was not uploaded.`)
  }
  const [row] = await d.db.update(comfyTasks).set({ state: 'done', outputs: body.outputs, progress: 1, finishedAt: now, leaseUntil: null, updatedAt: now })
    .where(and(eq(comfyTasks.id, id), eq(comfyTasks.claimToken, body.claimToken), inArray(comfyTasks.state, ['claimed', 'running']))).returning()
  if (!row) return { ok: true, already: true }
  await nudgeJob(d, row.jobId, now)
  return { ok: true, already: false }
}

// A failure: out of memory is retried once at batch 1 (E6); anything else
// lands in Failed.
export async function fail(d: ComfyDeps, accountId: string, now: Date, id: string, body: { claimToken: string; error: string; reason?: string }): Promise<{ retried: boolean }> {
  const { t, current } = await ownTask(d, accountId, id, body.claimToken)
  if (!current) return { retried: false }
  const recipe = t.recipe as { oomRetried?: boolean; batchBinding?: { node: string; field: string } }
  const error = body.error.slice(0, 2000)
  if (body.reason === 'oom' && !recipe.oomRetried) {
    const graph = t.graph as ApiGraph
    const b = recipe.batchBinding
    if (b && graph[b.node]) graph[b.node]!.inputs[b.field] = 1
    await d.db.update(comfyTasks).set({ state: 'queued', batch: 1, graph, attempt: t.attempt + 1, claimToken: null, leaseUntil: null, progress: 0, startedAt: null, error: `Out of memory; trying again at batch 1. ${error}`, failReason: 'oom', recipe: { ...recipe, oomRetried: true }, updatedAt: now }).where(eq(comfyTasks.id, id))
    return { retried: true }
  }
  await d.db.update(comfyTasks).set({ state: 'failed', error, failReason: body.reason ?? 'agent', finishedAt: now, leaseUntil: null, updatedAt: now }).where(eq(comfyTasks.id, id))
  await nudgeJob(d, t.jobId, now)
  return { retried: false }
}

// Leases that ran out are reclaimed once (attempt 2), then Failed; a task
// past its hard timeout is Failed and the agent is told to stop it.
export async function sweep(d: ComfyDeps, accountId: string, now: Date): Promise<{ reclaimed: string[]; failed: string[] }> {
  const live = await d.db.select().from(comfyTasks).where(and(eq(comfyTasks.accountId, accountId), inArray(comfyTasks.state, ['claimed', 'running'])))
  const reclaimed: string[] = [], failed: string[] = []
  for (const t of live) {
    const started = t.startedAt ?? t.claimedAt
    if (started && now.getTime() - started.getTime() > t.timeoutSec * 1000) {
      await d.db.update(comfyTasks).set({ state: 'failed', failReason: 'timeout', error: `Stopped at the hard timeout (${Math.round(t.timeoutSec / 60)} min).`, finishedAt: now, leaseUntil: null, updatedAt: now }).where(and(eq(comfyTasks.id, t.id), eq(comfyTasks.state, t.state)))
      failed.push(t.id); await nudgeJob(d, t.jobId, now); continue
    }
    if (!t.leaseUntil || t.leaseUntil.getTime() > now.getTime()) continue
    if (t.attempt < 2) {
      await d.db.update(comfyTasks).set({ state: 'queued', attempt: t.attempt + 1, claimToken: null, leaseUntil: null, progress: 0, startedAt: null, failReason: 'lease', error: 'The machine went quiet while running this; it was reclaimed and runs again (attempt 2).', updatedAt: now }).where(and(eq(comfyTasks.id, t.id), eq(comfyTasks.state, t.state)))
      reclaimed.push(t.id)
    } else {
      await d.db.update(comfyTasks).set({ state: 'failed', failReason: 'lease', error: 'The machine went quiet twice while running this. It is in Failed; press Retry when the machine is back.', finishedAt: now, leaseUntil: null, updatedAt: now }).where(and(eq(comfyTasks.id, t.id), eq(comfyTasks.state, t.state)))
      failed.push(t.id); await nudgeJob(d, t.jobId, now)
    }
  }
  return { reclaimed, failed }
}

// The Studio job polls again now (the worker finds the change at once).
async function nudgeJob(d: ComfyDeps, jobId: string | null, now: Date): Promise<void> {
  if (jobId) await d.db.update(jobs).set({ nextPollAt: now }).where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
}

// ── The Studio's side ──

export interface EnqueueInput {
  key: string
  jobId: string | null
  characterId: string | null
  userId: string | null
  kind: 'workflow' | 'train'
  workflow: Workflow | { manifest: Pick<WorkflowManifest, 'id' | 'version' | 'family' | 'timeout_sec'>; graph: ApiGraph }
  graph: ApiGraph
  inputs: Record<string, string>
  recipe: Record<string, unknown>
}

// One task per key: submitting the same run twice makes one task.
export async function enqueue(d: ComfyDeps, accountId: string, now: Date, input: EnqueueInput): Promise<{ id: string; created: boolean }> {
  const m = input.workflow.manifest
  const id = newId('cft')
  const [row] = await d.db.insert(comfyTasks).values({
    id, accountId, jobId: input.jobId, characterId: input.characterId, userId: input.userId, key: input.key, kind: input.kind,
    workflowId: m.id, workflowVersion: m.version, family: m.family, graph: input.graph, inputs: input.inputs, recipe: input.recipe,
    timeoutSec: m.timeout_sec, createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: [comfyTasks.accountId, comfyTasks.key] }).returning()
  if (row) return { id: row.id, created: true }
  const [had] = await d.db.select({ id: comfyTasks.id }).from(comfyTasks).where(and(eq(comfyTasks.accountId, accountId), eq(comfyTasks.key, input.key)))
  return { id: had!.id, created: false }
}

export async function taskRow(d: ComfyDeps, accountId: string, id: string) {
  const [t] = await d.db.select().from(comfyTasks).where(and(eq(comfyTasks.id, id), eq(comfyTasks.accountId, accountId)))
  return t ?? null
}

export async function cancelTask(d: ComfyDeps, accountId: string, now: Date, id: string): Promise<void> {
  await d.db.update(comfyTasks).set({ state: 'canceled', finishedAt: now, leaseUntil: null, updatedAt: now }).where(and(eq(comfyTasks.id, id), eq(comfyTasks.accountId, accountId), inArray(comfyTasks.state, ['queued', 'claimed', 'running'])))
}

// About how long a workflow takes on this machine: the average of its last
// 20 runs, else the manifest's estimate.
export async function estimateSeconds(db: Db, accountId: string, m: Pick<WorkflowManifest, 'id' | 'est_sec'>): Promise<{ sec: number; measured: boolean }> {
  const rows = await db.select({ s: comfyTasks.startedAt, f: comfyTasks.finishedAt }).from(comfyTasks)
    .where(and(eq(comfyTasks.accountId, accountId), eq(comfyTasks.workflowId, m.id), eq(comfyTasks.state, 'done'))).orderBy(desc(comfyTasks.finishedAt)).limit(20)
  const secs = rows.filter(r => r.s && r.f).map(r => (r.f!.getTime() - r.s!.getTime()) / 1000).filter(s => s > 0)
  if (!secs.length) return { sec: m.est_sec, measured: false }
  return { sec: secs.reduce((a, b) => a + b, 0) / secs.length, measured: true }
}

export async function activeLora(db: Db, accountId: string, characterId: string | null, base: string | undefined) {
  if (!characterId || !base) return null
  const [l] = await db.select().from(comfyLoras).where(and(eq(comfyLoras.accountId, accountId), eq(comfyLoras.characterId, characterId), eq(comfyLoras.base, base), eq(comfyLoras.state, 'ready'), eq(comfyLoras.active, true)))
  return l ?? null
}

export { bindWorkflow, type BindInput }

// ── Settings > ComfyUI ──

export async function comfyView(deps: Deps, ctx: Ctx) {
  const now = deps.clock.now()
  await sweep(deps, ctx.accountId, now)
  const s = await comfySettings(deps.db, ctx.accountId)
  const a = await agentStatus(deps.db, ctx.accountId)
  const online = isOnline(a, now)
  const env = envCheck(s, a)
  const counts = await deps.db.select({ state: comfyTasks.state, n: sql<number>`count(*)::int` }).from(comfyTasks).where(eq(comfyTasks.accountId, ctx.accountId)).groupBy(comfyTasks.state)
  const n = (st: string) => counts.find(c => c.state === st)?.n ?? 0
  const week = new Date(now.getTime() - 7 * 86400_000)
  const recent = await deps.db.select().from(comfyTasks).where(and(eq(comfyTasks.accountId, ctx.accountId), gte(comfyTasks.updatedAt, week), inArray(comfyTasks.state, ['done', 'failed'])))
  const wfs = await workflowsFor(deps.db, ctx.accountId)
  const perWorkflow = wfs.map(w => {
    const doneRows = recent.filter(r => r.workflowId === w.manifest.id && r.state === 'done' && r.startedAt && r.finishedAt)
    const failedRows = recent.filter(r => r.workflowId === w.manifest.id && r.state === 'failed')
    const avg = doneRows.length ? doneRows.reduce((t, r) => t + (r.finishedAt!.getTime() - r.startedAt!.getTime()) / 1000, 0) / doneRows.length : null
    return {
      id: w.manifest.id, label: w.manifest.label, version: w.manifest.version, steps: w.manifest.steps, family: w.manifest.family, ref: w.manifest.ref,
      licenseCheck: !!w.manifest.license_check, source: w.source, estSec: w.manifest.est_sec, avgSec: avg, done: doneRows.length, failed: failedRows.length,
      confirmed: doneRows.length > 0 || recent.some(r => r.workflowId === w.manifest.id && r.state === 'done'),
    }
  })
  const failed = await deps.db.select().from(comfyTasks).where(and(eq(comfyTasks.accountId, ctx.accountId), eq(comfyTasks.state, 'failed'))).orderBy(desc(comfyTasks.updatedAt)).limit(20)
  const failedJobs = failed.map(f => f.jobId).filter((x): x is string => !!x)
  const jobRows = failedJobs.length ? await deps.db.select({ id: jobs.id, status: jobs.status, purpose: jobs.purpose }).from(jobs).where(inArray(jobs.id, failedJobs)) : []
  const doneCount = recent.filter(r => r.state === 'done').length, failCount = recent.filter(r => r.state === 'failed').length
  const loras = await deps.db.select().from(comfyLoras).where(eq(comfyLoras.accountId, ctx.accountId)).orderBy(desc(comfyLoras.createdAt)).limit(50)
  return {
    token: s.tokenLast4 ? { last4: s.tokenLast4, at: s.tokenAt ?? null } : null,
    tunnel: s.tunnel ?? '',
    paused: !!s.paused, localPause: !!a?.localPause, maxJobs: s.maxJobs ?? 1,
    online, lastSeen: a?.lastSeen ?? null,
    agent: a ? { version: a.agentVersion ?? null, gpu: a.gpu ?? null, vramTotalMb: a.vramTotalMb ?? null, vramFreeMb: a.vramFreeMb ?? null, gpuUse: a.gpuUse ?? null, comfyOk: a.comfyOk ?? null, comfyError: a.comfyError ?? null, comfyQueue: a.comfyQueue ?? null, models: a.models ?? [], loadedFamily: a.loadedFamily ?? null } : null,
    test: { askedAt: s.testAskedAt ?? null, answeredAt: a?.testAnsweredAt ?? null, answered: !!s.testAskedAt && !!a?.testAnsweredAt && a.testAnsweredAt >= s.testAskedAt },
    env: { ...env, custom: !!s.expectedEnv, acceptedAt: s.expectedEnvAt ?? null },
    queue: { queued: n('queued'), running: n('claimed') + n('running'), failed: n('failed'), done: n('done') },
    failureRate: doneCount + failCount ? failCount / (doneCount + failCount) : null,
    // The machine dropped off with work still waiting (E7).
    alert: !online && (n('queued') + n('claimed') + n('running')) > 0 ? `The machine is offline with ${n('queued') + n('claimed') + n('running')} ComfyUI ${n('queued') + n('claimed') + n('running') === 1 ? 'job' : 'jobs'} waiting. They run when it is back; nothing moves to another provider unless you pick it.` : null,
    workflows: perWorkflow,
    failedTasks: failed.map(f => ({ id: f.id, jobId: f.jobId, jobStatus: jobRows.find(j => j.id === f.jobId)?.status ?? null, workflowId: f.workflowId, kind: f.kind, attempt: f.attempt, error: f.error ?? '', reason: f.failReason ?? null, at: f.updatedAt.toISOString() })),
    loras: loras.map(l => ({ id: l.id, characterId: l.characterId, base: l.base, version: l.version, trigger: l.trigger, state: l.state, active: l.active, fileName: l.fileName, sha256: l.sha256, images: (l.images as unknown[]).length, at: l.createdAt.toISOString() })),
  }
}

// A failed task run again from Settings when it has no Studio job (a LoRA
// training's job is retried through its own Retry button).
export async function retryTask(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const t = await taskRow(deps, ctx.accountId, id)
  if (!t || t.state !== 'failed') throw new AppError('bad_request', 'Only a failed ComfyUI task can be retried here.')
  if (t.jobId) throw new AppError('bad_request', 'This task belongs to a run: use its Retry (priced, $0 API) so it waits for your click.')
  const now = deps.clock.now()
  await deps.db.update(comfyTasks).set({ state: 'queued', attempt: t.attempt + 1, claimToken: null, leaseUntil: null, startedAt: null, finishedAt: null, progress: 0, error: null, failReason: null, updatedAt: now }).where(eq(comfyTasks.id, id))
}
