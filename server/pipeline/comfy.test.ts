import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { and, eq } from 'drizzle-orm'
import { createHarness, type Harness } from '../testing/harness.js'
import { startMockComfy, type MockComfy, type MockComfyScenario } from '../testing/mockComfy.js'
import { createApp } from '../api/app.js'
import { createPassphraseAuth } from '../auth/provider.js'
import { quoteJobs, runJobs, tick, type JobSpec } from '../jobs/runner.js'
import { comfyTasks, jobOutputs, jobs } from '../db/schema.js'
import { saveAsset } from '../storage/assets.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { finalizeImagePrompt } from '../core/realism.js'
import { createCharacter } from './characters.js'
import { setSetting } from './settings.js'
import { claim, comfyView, createAgentToken, done, enqueue, heartbeat, loadRepoWorkflows, repoLock, updateComfySettings, LEASE_MS } from './comfy.js'
import { envHash, type EnvLock } from '../core/comfyWorkflows.js'
// @ts-expect-error the agent is plain JavaScript (it runs on the machine)
import { createAgent, envHash as agentEnvHash } from '../../comfy/agent/agent.mjs'

// ComfyUI on a remote workstation (UX-PLAN.md section 41), against a mock
// ComfyUI and the real agent over HTTP: the full loop, a killed job that is
// reclaimed, a retry that does not double post or double charge, an
// environment mismatch refused, out of memory retried at batch 1, jobs
// grouped by model family, offline said out loud, our rules enforced.

interface Agent { tick(): Promise<Promise<void>[]>; heartbeat(): Promise<{ env: { ok: boolean } }>; loadedFamily: string | null; running: Map<string, unknown> }

let h: Harness
let server: ServerType
let base = ''
let comfy: MockComfy
let home = ''
let token = ''

async function start(scenario: MockComfyScenario = 'ok') {
  comfy = await startMockComfy({ scenario })
}
function agent(o: { lock?: EnvLock } = {}): Agent {
  return createAgent({
    env: { STUDIO_URL: base, STUDIO_AGENT_TOKEN: token, COMFY_URL: comfy.url, COMFY_AGENT_HOME: home, COMFY_MODELS: join(home, 'models') },
    measureEnv: async () => o.lock ?? repoLock(), pollMs: 50, pingMs: 0, keepAliveMs: 3_600_000, log: () => undefined,
  }) as Agent
}
const still = (refs: string[]): JobSpec => ({
  type: 'gen', stage: 'scene', purpose: 'test:comfy', label: 'ComfyUI still',
  request: { kind: 'image_edit', model: 'comfy/qwen-image-edit-2511', prompt: finalizeImagePrompt('She laughs at a cafe table, wearing a denim jacket.').prompt, aspect: '9:16', refs: refs.map(assetId => ({ assetId })) },
})
async function refs(n: number): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push((await saveAsset(h.deps, h.ctx, { data: await renderPlaceholderPortrait(`REF-0${i}`, '3:4'), mime: 'image/png', origin: 'upload' })).id)
  return out
}
async function run(specs: JobSpec[], characterId: string | null) {
  const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId, specs })
  const rows = await runJobs(h.deps, h.ctx, { quoteId: q.id, purpose: 'test', characterId, specs })
  return { q, rows }
}
const jobRow = async (id: string) => (await h.deps.db.select().from(jobs).where(eq(jobs.id, id)))[0]!
async function settle(jobId: string) {
  for (let i = 0; i < 20; i++) {
    await tick(h.deps, 10)
    const j = await jobRow(jobId)
    if (['completed', 'failed', 'canceled', 'needs_attention'].includes(j.status)) return j
  }
  return jobRow(jobId)
}

beforeEach(async () => {
  h = await createHarness()
  await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
  const app = createApp(h.deps, createPassphraseAuth(h.deps, { devAutoLogin: false }))
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise(r => setTimeout(r, 20))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  home = mkdtempSync(join(tmpdir(), 'comfy-agent-'))
  token = (await createAgentToken(h.deps, h.ctx)).token
})
afterEach(async () => {
  await comfy?.stop()
  await new Promise<void>(r => server.close(() => r()))
  rmSync(home, { recursive: true, force: true })
  await h.close()
})

describe('workflows and the environment', () => {
  it('every shipped workflow binds its manifest, and the agent hashes an environment the way the Studio does', async () => {
    const wfs = loadRepoWorkflows()
    expect(wfs.map(w => w.manifest.id).sort()).toEqual(['krea-2-turbo', 'qwen-image-edit-2511', 'wan-2.2-animate-mix', 'wan-2.2-animate-replace', 'wan-2.2-i2v'])
    expect(wfs.find(w => w.manifest.id === 'krea-2-turbo')!.manifest.license_check).toBe(true)
    expect(agentEnvHash(repoLock())).toBe(envHash(repoLock()))
    // Whitespace and key order never change the hash.
    expect(envHash(JSON.parse(JSON.stringify({ ...repoLock(), nodes: Object.fromEntries(Object.entries(repoLock().nodes).reverse()) })))).toBe(envHash(repoLock()))
  })

  it('refuses a token that is not the current one', async () => {
    await start()
    const r = await fetch(`${base}/api/v1/comfy/agent/heartbeat`, { method: 'POST', headers: { authorization: `Bearer ${token.slice(0, -2)}xx`, 'content-type': 'application/json' }, body: '{}' })
    expect(r.status).toBe(401)
  })
})

describe('the loop', () => {
  it('a still runs on the machine: inputs fetched, graph bound, output in storage, $0 API with minutes on the price', async () => {
    await start()
    const ch = await createCharacter(h.deps, h.ctx, { name: 'Callie', data: { age: 24 } })
    const ids = await refs(2)
    const { q, rows } = await run([still(ids)], ch.id)
    expect(q.display).toMatch(/^\$0 API, about \d+ min on ComfyUI$/)
    expect(q.notes.join(' ')).toMatch(/has not connected yet/)
    await tick(h.deps, 10) // submit: one task on the queue
    const [t] = await h.deps.db.select().from(comfyTasks)
    expect(t).toMatchObject({ state: 'queued', family: 'qwen', workflowId: 'qwen-image-edit-2511', characterId: ch.id })
    const a = agent()
    const started = await a.tick()
    expect(started).toHaveLength(1)
    await Promise.all(started)
    expect(a.loadedFamily).toBe('qwen')
    // What ComfyUI was sent: both refs uploaded, the third slot dropped, no
    // LoRA yet (the loader bypassed), no placeholder left.
    const g = comfy.prompts[0]!.graph
    expect(comfy.uploads).toHaveLength(2)
    expect(g['9']).toBeUndefined()
    expect(g['4']).toBeUndefined()
    expect(g['5']!.inputs.model).toEqual(['1', 0])
    expect(JSON.stringify(g)).not.toContain('studio:')
    expect(String(g['10']!.inputs.prompt)).toContain('REALISM')
    const j = await settle(rows[0]!.id)
    expect(j.status).toBe('completed')
    expect(j.actualMicros).toBe(0)
    expect(await h.deps.db.select().from(jobOutputs).where(eq(jobOutputs.jobId, j.id))).toHaveLength(1)
    const [after] = await h.deps.db.select().from(comfyTasks)
    expect(after!.recipe).toMatchObject({ engine: 'comfy', workflow: 'qwen-image-edit-2511', refs: ids, lora: null })
    // Settings: online, the GPU, the workflow now confirmed by a real run.
    const v = await comfyView(h.deps, h.ctx)
    expect(v).toMatchObject({ online: true, queue: { done: 1, queued: 0 }, agent: { gpu: expect.stringContaining('RTX 6000') }, env: { ok: true } })
    expect(v.workflows.find(w => w.id === 'qwen-image-edit-2511')!.confirmed).toBe(true)
  })

  it('a killed job is reclaimed (attempt 2) and a late report from the dead try is refused; nothing is posted twice', async () => {
    await start('hang')
    const ids = await refs(1)
    const { rows } = await run([still(ids)], null)
    await tick(h.deps, 10)
    const dead = agent()
    const hung = await dead.tick()
    expect(hung).toHaveLength(1)
    await new Promise(r => setTimeout(r, 100))
    const [claimed] = await h.deps.db.select().from(comfyTasks)
    expect(claimed!.state).toBe('running')
    // The machine dies: no pings, the lease runs out. The runner's next poll
    // reclaims it.
    h.clock.advance(LEASE_MS + 1000)
    await h.deps.db.update(jobs).set({ nextPollAt: h.clock.now() }).where(eq(jobs.id, rows[0]!.id))
    await tick(h.deps, 10)
    const [back] = await h.deps.db.select().from(comfyTasks)
    expect(back).toMatchObject({ state: 'queued', attempt: 2, failReason: 'lease', claimToken: null })
    // A late "done" from the first try is refused.
    await expect(done(h.deps, h.ctx.accountId, h.clock.now(), back!.id, { claimToken: claimed!.claimToken!, outputs: [{ key: `comfy/${h.ctx.accountId}/${back!.id}/a1-0.png`, kind: 'image', mime: 'image/png' }] })).rejects.toMatchObject({ code: 'conflict' })
    // The machine comes back (a healthy ComfyUI) and runs attempt 2.
    comfy.scenario = 'ok'
    const alive = agent()
    await Promise.all(await alive.tick())
    // The dead agent's heartbeat is told to stop its stale task.
    await dead.heartbeat()
    await Promise.all(hung)
    const j = await settle(rows[0]!.id)
    expect(j.status).toBe('completed')
    expect(await h.deps.db.select().from(jobOutputs).where(eq(jobOutputs.jobId, j.id))).toHaveLength(1)
    expect((await h.deps.db.select().from(comfyTasks))[0]).toMatchObject({ state: 'done', attempt: 2 })
  })

  it('a retried submit makes one task, and done reported twice stores the outputs once', async () => {
    await start()
    const ids = await refs(1)
    const { rows } = await run([still(ids)], null)
    const adapter = await h.deps.providers.gen(h.ctx.accountId, 'comfy/qwen-image-edit-2511')
    const req = (await jobRow(rows[0]!.id)).request as Parameters<typeof adapter.submit>[0]
    const key = (await jobRow(rows[0]!.id)).idempotencyKey
    const a1 = await adapter.submit(req, { idempotencyKey: key })
    const a2 = await adapter.submit(req, { idempotencyKey: key })
    expect(a1.jobId).toBe(a2.jobId)
    expect(await h.deps.db.select().from(comfyTasks)).toHaveLength(1)
    await tick(h.deps, 10)
    expect(await h.deps.db.select().from(comfyTasks)).toHaveLength(1)
    await Promise.all(await agent().tick())
    const [t] = await h.deps.db.select().from(comfyTasks)
    const again = await done(h.deps, h.ctx.accountId, h.clock.now(), t!.id, { claimToken: t!.claimToken!, outputs: (t!.outputs as never) })
    expect(again).toEqual({ ok: true, already: true })
    const j = await settle(rows[0]!.id)
    expect(j.status).toBe('completed')
    expect(await h.deps.db.select().from(jobOutputs).where(eq(jobOutputs.jobId, j.id))).toHaveLength(1)
  })

  it('an environment mismatch is refused and says why; Use this machine\'s environment switches it', async () => {
    await start()
    const ids = await refs(1)
    await run([still(ids)], null)
    await tick(h.deps, 10)
    const other = { ...repoLock(), comfyui: 'ffffffffffffffffffffffffffffffffffffffff' }
    const a = agent({ lock: other })
    expect(await a.tick()).toHaveLength(0)
    const v = await comfyView(h.deps, h.ctx)
    expect(v.env.ok).toBe(false)
    expect(v.env.problems.join(' ')).toMatch(/ComfyUI is at ffffffffffff, expected d07dff4565ea/)
    expect((await h.deps.db.select().from(comfyTasks))[0]!.state).toBe('queued')
    await updateComfySettings(h.deps, h.ctx, { acceptMachineEnv: true })
    const started = await a.tick()
    expect(started).toHaveLength(1)
    await Promise.all(started)
    expect((await h.deps.db.select().from(comfyTasks))[0]!.state).toBe('done')
  })

  it('out of memory is retried once at batch 1', async () => {
    await start('oom-once')
    const ids = await refs(1)
    const { rows } = await run([still(ids)], null)
    await tick(h.deps, 10)
    const a = agent()
    await Promise.all(await a.tick())
    const [t] = await h.deps.db.select().from(comfyTasks)
    expect(t).toMatchObject({ state: 'queued', attempt: 2, batch: 1, failReason: 'oom' })
    await Promise.all(await a.tick())
    expect((await h.deps.db.select().from(comfyTasks))[0]!.state).toBe('done')
    expect((comfy.prompts[1]!.graph['12']!.inputs.batch_size)).toBe(1)
    expect((await settle(rows[0]!.id)).status).toBe('completed')
  })
})

describe('the queue', () => {
  it('claims the family the machine has loaded first, and respects pause and max jobs', async () => {
    const wfs = loadRepoWorkflows()
    const wf = (id: string) => wfs.find(w => w.manifest.id === id)!
    const t0 = h.clock.now()
    for (const [i, id] of ['wan-2.2-i2v', 'qwen-image-edit-2511', 'wan-2.2-i2v'].entries()) {
      await enqueue(h.deps, h.ctx.accountId, new Date(t0.getTime() + i * 1000), { key: `k${i}`, jobId: null, characterId: null, userId: null, kind: 'workflow', workflow: wf(id), graph: wf(id).graph, inputs: {}, recipe: {} })
    }
    await heartbeat(h.deps, h.ctx.accountId, h.clock.now(), { env: repoLock() })
    await updateComfySettings(h.deps, h.ctx, { maxJobs: 3 })
    const fams: string[] = []
    for (let i = 0; i < 3; i++) fams.push((await claim(h.deps, h.ctx.accountId, h.clock.now(), { loadedFamily: 'qwen' })).task!.family)
    expect(fams).toEqual(['qwen', 'wan', 'wan'])
    expect((await claim(h.deps, h.ctx.accountId, h.clock.now(), { loadedFamily: 'qwen' })).task).toBeNull()
    await enqueue(h.deps, h.ctx.accountId, h.clock.now(), { key: 'k9', jobId: null, characterId: null, userId: null, kind: 'workflow', workflow: wf('wan-2.2-i2v'), graph: wf('wan-2.2-i2v').graph, inputs: {}, recipe: {} })
    expect((await claim(h.deps, h.ctx.accountId, h.clock.now(), {})).reason).toBe('max jobs')
    await updateComfySettings(h.deps, h.ctx, { paused: true, maxJobs: 8 })
    expect((await claim(h.deps, h.ctx.accountId, h.clock.now(), {})).reason).toBe('paused')
  })

  it('offline after two quiet minutes: the price says so, and Settings alerts while work waits', async () => {
    const ids = await refs(1)
    await heartbeat(h.deps, h.ctx.accountId, h.clock.now(), { env: repoLock() })
    expect((await comfyView(h.deps, h.ctx)).online).toBe(true)
    h.clock.advance(3 * 60_000)
    const { q } = await run([still(ids)], null)
    expect(q.notes.join(' ')).toMatch(/The ComfyUI machine is offline \(last seen .* UTC\)\. This run waits in its queue until the machine is back; pick another provider to run it now\./)
    await tick(h.deps, 10)
    const v = await comfyView(h.deps, h.ctx)
    expect(v.online).toBe(false)
    expect(v.alert).toMatch(/offline with 1 ComfyUI job waiting/)
  })
})

describe('our rules inside the pipeline', () => {
  it('refuses a character under 21 and an explicit prompt before anything reaches the machine', async () => {
    const ids = await refs(1)
    const young = await createCharacter(h.deps, h.ctx, { name: 'Test', data: { age: 24 } })
    await h.deps.db.execute(`update characters set age = 19 where id = '${young.id}'` as never)
    const { rows } = await run([still(ids)], young.id)
    await tick(h.deps, 10)
    const j = await jobRow(rows[0]!.id)
    expect(j.status).toBe('failed')
    expect(JSON.stringify(j.error)).toMatch(/21 or older/)
    expect(await h.deps.db.select().from(comfyTasks).where(and(eq(comfyTasks.accountId, h.ctx.accountId)))).toHaveLength(0)
    const spec = still(ids)
    ;(spec.request as { prompt: string }).prompt = finalizeImagePrompt('A nude woman on a bed.').prompt
    await expect(quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [spec] })).rejects.toMatchObject({ code: 'prompt_rejected' })
  })
})

describe('character LoRAs, the bake-off and the engine lever', () => {
  async function importAs(name: string) {
    const { readFileSync } = await import('node:fs')
    const { importCharacter } = await import('./files.js')
    const md = readFileSync(join(process.cwd(), 'fixtures/callie/character-callie.md'), 'utf8').replace(/^# Character: Callie/m, `# Character: ${name}`)
    const images: Record<string, { data: Buffer }> = {}
    for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`${name} REF-${i}`) }
    return (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  }

  it('Train LoRA runs on the machine, v1 then v2, the newest rides along on a Qwen still; faceless characters have none', async () => {
    const { registerPipelineHooks } = await import('./hooks.js')
    const { estimateAction, runAction } = await import('./actions.js')
    const { comfyLoras } = await import('../db/schema.js')
    const { writeFileSync } = await import('node:fs')
    registerPipelineHooks()
    await start()
    const callie = await importAs('Callie')
    // The trainer: a script that writes a small .safetensors file.
    const trainer = join(home, 'train.mjs')
    writeFileSync(trainer, "import { writeFileSync } from 'node:fs'; console.log('step 1000/1000'); writeFileSync(process.env.STUDIO_TRAIN_OUT + '/lora.safetensors', 'weights ' + Date.now())")
    const a = createAgent({ env: { STUDIO_URL: base, STUDIO_AGENT_TOKEN: token, COMFY_URL: comfy.url, COMFY_AGENT_HOME: home, COMFY_MODELS: join(home, 'models'), LORA_TRAIN_CMD: `node ${trainer}` }, measureEnv: async () => repoLock(), pollMs: 50, pingMs: 0, keepAliveMs: 3_600_000, log: () => undefined }) as Agent
    for (const v of [1, 2]) {
      const action = { type: 'comfy_train' as const, characterId: callie, base: 'qwen' as const, stillIds: [] }
      const est = await estimateAction(h.deps, h.ctx, action)
      expect(est.quote.display).toMatch(/^\$0 API, about \d+ min on ComfyUI$/)
      expect(est.preview.title).toBe(`Train Callie's Qwen LoRA v${v}`)
      const ran = await runAction(h.deps, h.ctx, action, est.quote.id, false) as { jobs: Array<{ id: string }> }
      await tick(h.deps, 10)
      await Promise.all(await a.tick())
      expect((await settle(ran.jobs[0]!.id)).status).toBe('completed')
    }
    const loras = await h.deps.db.select().from(comfyLoras).where(eq(comfyLoras.characterId, callie))
    expect(loras.map(l => [l.version, l.state, l.active]).sort()).toEqual([[1, 'ready', false], [2, 'ready', true]])
    expect(loras.find(l => l.version === 2)!.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(loras[0]!.images).toHaveLength(12)
    // A still now carries the v2 LoRA and its trigger word.
    const ids = await refs(1)
    const { rows } = await run([still(ids)], callie)
    await tick(h.deps, 10)
    await Promise.all(await a.tick())
    const g = comfy.prompts.at(-1)!.graph
    expect(g['4']!.inputs.lora_name).toBe(`studio_${callie}_qwen_v2.safetensors`)
    expect(String(g['10']!.inputs.prompt)).toMatch(/^callie_studio, /)
    expect((await settle(rows[0]!.id)).status).toBe('completed')
    const t = (await h.deps.db.select().from(comfyTasks)).find(x => x.jobId === rows[0]!.id)!
    expect(t.recipe).toMatchObject({ lora: { version: 2, trigger: 'callie_studio' } })
    const doug = await createCharacter(h.deps, h.ctx, { name: 'Doug', data: { age: 40 } })
    const { characters } = await import('../db/schema.js')
    await h.deps.db.update(characters).set({ features: { kind: 'faceless' } }).where(eq(characters.id, doug.id))
    await expect(estimateAction(h.deps, h.ctx, { type: 'comfy_train', characterId: doug.id, base: 'qwen', stillIds: [] })).rejects.toMatchObject({ message: expect.stringMatching(/Faceless characters have no LoRA/) })
  }, 120_000)

  it('Compare providers: 10 of her prompts on Kie.ai Nano Banana and Qwen, priced $0.30 plus machine minutes; Use as default sets stills', async () => {
    const { estimateAction } = await import('./actions.js')
    const { saveCredential } = await import('../providers/credentials.js')
    const { candidates } = await import('../db/schema.js')
    const { newId } = await import('../lib/ids.js')
    const { useAsDefault } = await import('./comfyActions.js')
    const { routeWithLever, readLever } = await import('./engines.js')
    await saveCredential(h.deps, h.ctx, 'kie', 'kie-test-key-1234')
    const callie = await importAs('Callie')
    for (let i = 0; i < 12; i++) await h.deps.db.insert(candidates).values({ id: newId('cand'), accountId: h.ctx.accountId, characterId: callie, target: 'scene', op: 'generate', status: 'approved', prompt: finalizeImagePrompt(`Scene ${i}: she reads on a bench, wearing a gray hoodie.`).prompt, createdAt: new Date(Date.UTC(2026, 9, 1, 12, i)) })
    const est = await estimateAction(h.deps, h.ctx, { type: 'compare_providers', characterId: callie })
    expect(est.quote.items).toHaveLength(20)
    expect(est.quote.display).toMatch(/^\$0\.30, about \d+ min on ComfyUI$/)
    expect(est.preview.warnings.map(w => w.ruleId)).toEqual(['bakeoff-krea', 'bakeoff-qwen'])
    // Nothing changes until he picks.
    expect(await routeWithLever(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image', { step: 'still' })).toMatchObject({ ref: 'higgsfield/nano-banana-2.1', source: 'asked' })
    await useAsDefault(h.deps, h.ctx, 'comfy/qwen-image-edit-2511')
    expect((await readLever(h.deps, h.ctx.accountId)).steps.still).toBe('comfy/qwen-image-edit-2511')
    expect(await routeWithLever(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image', { step: 'still' })).toMatchObject({ ref: 'comfy/qwen-image-edit-2511', source: 'step' })
  }, 120_000)

  it('the lever: run > character pick > step pick > lever > asked; a step the engine cannot do keeps its model and says so', async () => {
    const { routeWithLever, setLever, setPick, leverView, withRunProvider } = await import('./engines.js')
    const r = (model: string, kind: 'image' | 'image_edit' | 'video' | 'video_clone', step?: 'still' | 'edit' | 'video' | 'recreate_still' | 'recreate_motion', characterId?: string) => routeWithLever(h.deps, h.ctx, model, kind, { step, characterId })
    await setLever(h.deps, h.ctx, { engine: 'comfy' })
    expect(await r('higgsfield/kling-3.0-pro', 'video', 'video')).toMatchObject({ ref: 'comfy/wan-2.2-i2v', source: 'engine' })
    expect(await r('higgsfield/nano-banana-2.1', 'image_edit', 'edit')).toMatchObject({ ref: 'comfy/qwen-image-edit-2511', source: 'engine' })
    // ComfyUI has no Recreate stills model: the asked one stays.
    expect(await r('higgsfield/nano-banana-2.1', 'image_edit', 'recreate_still')).toMatchObject({ ref: 'higgsfield/nano-banana-2.1', source: 'asked' })
    const v = await leverView(h.deps, h.ctx)
    expect(v.notes.join(' ')).toMatch(/ComfyUI cannot do recreate stills and face pass: those keep their own model, for example Nano Banana 2.1 on Higgsfield at \$/)
    expect(v.rows.find(x => x.step === 'video')!.cells.comfy!.price).toMatch(/^\$0 API, about \d+ min on ComfyUI$/)
    // A step override ("Higgsfield video") beats the engine.
    await setLever(h.deps, h.ctx, { step: { step: 'video', ref: 'higgsfield/kling-3.0-pro' } })
    expect(await r('kie/kling-3.0-pro', 'video', 'video')).toMatchObject({ ref: 'higgsfield/kling-3.0-pro', source: 'step' })
    // A provider pick for the same model beats the lever.
    await setPick(h.deps, h.ctx, { step: 'video', family: 'kling-3.0-pro', provider: 'kie' })
    expect(await r('higgsfield/kling-3.0-pro', 'video', 'video')).toMatchObject({ ref: 'kie/kling-3.0-pro', source: 'pick' })
    // And the run's provider beats everything.
    expect(await withRunProvider('wavespeed', () => r('higgsfield/kling-3.0-pro', 'video', 'video'))).toMatchObject({ ref: 'wavespeed/kling-3.0-pro', source: 'pick' })
    // The subscription engine pays from the plan.
    await setLever(h.deps, h.ctx, { engine: 'higgsfield_plan', step: { step: 'video', ref: null } })
    await setPick(h.deps, h.ctx, { step: 'video', family: 'kling-3.0-pro', provider: null })
    expect(await r('kie/kling-3.0-pro', 'video', 'video')).toMatchObject({ ref: 'higgsfield/kling-3.0-pro', source: 'engine', billing: 'account' })
  })
})
