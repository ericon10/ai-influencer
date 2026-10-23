import type { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { assets, comfyLoras, comfyTasks } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { hasRole } from '../context.js'
import { AppError } from '../lib/errors.js'
import { agentAccount, claim, comfyView, createAgentToken, done, fail, heartbeat, progress, receiveOutput, retryTask, updateComfySettings, uploadTarget, uploadWorkflow } from '../pipeline/comfy.js'

// ComfyUI routes (UX-PLAN.md section 41). The agent's routes take its token
// (Authorization: Bearer cfy...), never a sign-in; the machine only calls
// out. The owner's routes sit with Settings.

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new AppError('bad_request', r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  return r.data
}
const body = async (c: { req: { json(): Promise<unknown> } }) => { try { return await c.req.json() } catch { throw new AppError('bad_request', 'Expected a JSON body.') } }

const lock = z.object({ version: z.number().int(), comfyui: z.string().max(80), pytorch: z.string().max(80).optional(), nodes: z.record(z.string().max(120), z.string().max(80)), models: z.record(z.string().max(300), z.string().max(80).nullable()) })
const beat = z.object({
  agentVersion: z.string().max(40).optional(), comfyOk: z.boolean().optional(), comfyError: z.string().max(500).optional(),
  gpu: z.string().max(200).optional(), vramTotalMb: z.number().optional(), vramFreeMb: z.number().optional(), gpuUse: z.number().optional(),
  comfyQueue: z.number().int().optional(), models: z.array(z.string().max(300)).max(2000).optional(), env: lock.optional(),
  loadedFamily: z.enum(['qwen', 'krea2', 'wan']).nullable().optional(), localPause: z.boolean().optional(), running: z.array(z.object({ id: z.string().max(60), claimToken: z.string().max(64) })).max(16).optional(),
})
const claimed = z.object({ claimToken: z.string().min(8).max(64) })
const output = z.object({ key: z.string().max(300), kind: z.enum(['image', 'video', 'json']), mime: z.string().max(80), width: z.number().optional(), height: z.number().optional(), durationSec: z.number().optional() })

export function mountComfyAgent(app: Hono<{ Variables: { ctx: Ctx } }>, deps: Deps): void {
  const who = (c: { req: { header(n: string): string | undefined } }) => agentAccount(deps.db, c.req.header('authorization'))
  app.post('/comfy/agent/heartbeat', async c => c.json(await heartbeat(deps, await who(c), deps.clock.now(), parse(beat, await body(c)))))
  app.post('/comfy/agent/claim', async c => c.json(await claim(deps, await who(c), deps.clock.now(), parse(z.object({ loadedFamily: z.string().max(20).nullable().optional() }), await body(c)))))
  app.post('/comfy/agent/tasks/:id/progress', async c => c.json(await progress(deps, await who(c), deps.clock.now(), c.req.param('id'), parse(claimed.extend({ progress: z.number().min(0).max(1).optional() }), await body(c)))))
  app.post('/comfy/agent/tasks/:id/upload-url', async c => c.json(await uploadTarget(deps, await who(c), c.req.param('id'), parse(claimed.extend({ index: z.number().int().min(0).max(15), mime: z.string().max(80) }), await body(c)))))
  app.put('/comfy/agent/tasks/:id/outputs', async c => {
    const accountId = await who(c)
    await receiveOutput(deps, accountId, c.req.param('id'), c.req.header('x-claim-token') ?? '', c.req.query('key') ?? '', Buffer.from(await c.req.arrayBuffer()), (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0]!.trim())
    return c.json({ ok: true })
  })
  app.post('/comfy/agent/tasks/:id/done', async c => c.json(await done(deps, await who(c), deps.clock.now(), c.req.param('id'), parse(claimed.extend({ outputs: z.array(output).min(1).max(16), seconds: z.number().optional() }), await body(c)))))
  app.post('/comfy/agent/tasks/:id/fail', async c => c.json(await fail(deps, await who(c), deps.clock.now(), c.req.param('id'), parse(claimed.extend({ error: z.string().max(4000), reason: z.enum(['oom', 'agent', 'comfy', 'timeout', 'validation']).optional() }), await body(c)))))
  // An input's bytes, when the store has no direct links (the local store).
  app.get('/comfy/agent/tasks/:id/inputs/:slot', async c => {
    const accountId = await who(c)
    const [t] = await deps.db.select().from(comfyTasks).where(and(eq(comfyTasks.id, c.req.param('id')), eq(comfyTasks.accountId, accountId)))
    if (!t || t.claimToken !== c.req.header('x-claim-token')) throw new AppError('not_found', 'No such task for this claim.')
    const assetId = (t.inputs as Record<string, string>)[c.req.param('slot')]
    const [a] = assetId ? await deps.db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.accountId, accountId))) : []
    if (!a) throw new AppError('not_found', 'No such input.')
    return new Response(new Uint8Array(await deps.store.get(a.storageKey)), { headers: { 'content-type': a.mime } })
  })
}

export function mountComfySettings(app: Hono<{ Variables: { ctx: Ctx } }>, deps: Deps): void {
  const admin = (ctx: Ctx) => { if (!hasRole(ctx, 'admin')) throw new AppError('forbidden', 'You do not have permission to do that.') }
  app.get('/settings/comfy', async c => c.json(await comfyView(deps, c.get('ctx'))))
  // The agent token, shown once.
  app.post('/settings/comfy/token', async c => { const ctx = c.get('ctx'); admin(ctx); return c.json(await createAgentToken(deps, ctx)) })
  app.put('/settings/comfy', async c => {
    const ctx = c.get('ctx'); admin(ctx)
    await updateComfySettings(deps, ctx, parse(z.object({ paused: z.boolean().optional(), maxJobs: z.number().int().min(1).max(8).optional(), tunnel: z.string().max(300).optional(), acceptMachineEnv: z.boolean().optional(), useRepoEnv: z.boolean().optional(), testConnection: z.boolean().optional() }), await body(c)))
    return c.json(await comfyView(deps, ctx))
  })
  app.post('/settings/comfy/workflows', async c => {
    const ctx = c.get('ctx'); admin(ctx)
    const b = parse(z.object({ manifest: z.unknown(), graph: z.unknown() }), await body(c))
    return c.json(await uploadWorkflow(deps, ctx, b))
  })
  app.post('/settings/comfy/tasks/:id/retry', async c => { const ctx = c.get('ctx'); admin(ctx); await retryTask(deps, ctx, c.req.param('id')); return c.json({ ok: true }) })
  // A character's LoRAs, and which one rides along.
  app.get('/characters/:id/loras', async c => {
    const ctx = c.get('ctx')
    const rows = await deps.db.select().from(comfyLoras).where(and(eq(comfyLoras.accountId, ctx.accountId), eq(comfyLoras.characterId, c.req.param('id'))))
    return c.json({ loras: rows.sort((a, b) => a.base.localeCompare(b.base) || b.version - a.version).map(l => ({ id: l.id, base: l.base, version: l.version, trigger: l.trigger, state: l.state, active: l.active, fileName: l.fileName, sha256: l.sha256, images: (l.images as unknown[]).length, steps: l.steps, at: l.createdAt.toISOString() })) })
  })
  app.put('/characters/:id/loras/:loraId/active', async c => {
    const ctx = c.get('ctx'); admin(ctx)
    const [l] = await deps.db.select().from(comfyLoras).where(and(eq(comfyLoras.id, c.req.param('loraId')), eq(comfyLoras.accountId, ctx.accountId), eq(comfyLoras.characterId, c.req.param('id'))))
    if (!l || l.state !== 'ready') throw new AppError('bad_request', 'Only a finished LoRA can be the active one.')
    await deps.db.update(comfyLoras).set({ active: false }).where(and(eq(comfyLoras.accountId, ctx.accountId), eq(comfyLoras.characterId, l.characterId), eq(comfyLoras.base, l.base)))
    await deps.db.update(comfyLoras).set({ active: true, updatedAt: deps.clock.now() }).where(eq(comfyLoras.id, l.id))
    return c.json({ ok: true })
  })
}
