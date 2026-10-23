import { and, eq } from 'drizzle-orm'
import { characters, comfyLoras, jobs } from '../db/schema.js'
import { adultProblem } from '../core/character.js'
import { EXPLICIT_MESSAGE, findExplicitTerms } from '../core/safety.js'
import { realismBlockers } from '../core/realism.js'
import { activeLora, agentStatus, bindWorkflow, enqueue, estimateSeconds, isOnline, sweep, taskRow, cancelTask, workflowForRef, type ComfyDeps } from '../pipeline/comfy.js'
import type { Workflow } from '../core/comfyWorkflows.js'
import { newId } from '../lib/ids.js'
import { ProviderError, type CostEstimate, type GenRequest, type JobStatus, type Output, type ProviderAdapter } from './types.js'

// ComfyUI on a remote workstation (UX-PLAN.md section 41): one more provider.
// Submit puts a task on the Studio's own queue (one per idempotency key, so
// a retried submit never makes a second task); the machine's agent pulls
// it. Status reads the task. Outputs are already in our storage (the agent
// put them there), so download reads the store. $0 API: the quote says
// about how many minutes the machine takes. Our rules run here because
// nothing outside does: 21 or older, the explicit check, REALISM and no
// smoothing words, beautify never (no such node is ever bound).

export interface ComfyAdapterOptions extends ComfyDeps {
  accountId: string
  now?: () => Date
}

const SIZES: Record<string, [number, number]> = {
  '9:16': [1088, 1920], '16:9': [1920, 1088], '1:1': [1472, 1472], '4:5': [1296, 1632], '3:4': [1248, 1664], '2:3': [1216, 1824], '4:3': [1664, 1248], '3:2': [1824, 1216],
}
const VIDEO_SIZES: Record<string, [number, number]> = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [960, 960], '4:5': [864, 1080], '3:4': [816, 1088] }

// Wan wants 4n + 1 frames.
const wanFrames = (sec: number, fps: number) => Math.max(17, Math.round((sec * fps) / 4) * 4 + 1)

export function createComfyAdapter(o: ComfyAdapterOptions): ProviderAdapter {
  const now = o.now ?? (() => new Date())
  const minutesFor = async (wf: Workflow, req: GenRequest) => {
    const { sec } = await estimateSeconds(o.db, o.accountId, wf.manifest)
    // Video runs scale with length past the manifest's 5 s baseline.
    const scale = req.kind === 'video' || req.kind === 'video_clone' ? Math.max(1, (req.durationSec ?? 5) / 5) : 1
    return Math.max(1, Math.round((sec * scale) / 60))
  }
  return {
    id: 'comfy',
    needsPublicAssetUrls: false,
    async listModels() {
      return o.config.models.models.filter(m => m.ref.startsWith('comfy/')).map(m => ({ ref: m.ref, provider: 'comfy', label: m.label, kinds: m.kinds, maxRefs: m.max_refs, verified: m.verified }))
    },
    async estimate(req) {
      const a = await agentStatus(o.db, o.accountId)
      const online = isOnline(a, now())
      let minutes = 30
      let label = 'LoRA training on the ComfyUI machine'
      if (req.kind !== 'train_identity') {
        const wf = await workflowForRef(o.db, o.accountId, req.model, req.kind)
        minutes = await minutesFor(wf, req)
        label = `${wf.manifest.label} on the ComfyUI machine`
      } else {
        minutes = Math.max(10, Math.round(((req.refs?.length ?? 12) * 2000 / 12) / 60 * 0.9))
      }
      const e: CostEstimate = {
        totalMicros: 0, lines: [{ label, quantity: 1, unit: 'run', unitPriceMicros: 0, amountMicros: 0 }],
        priceVersion: o.config.pricebook.version, verified: true, minutes,
        ...(online ? {} : { note: a ? `The ComfyUI machine is offline (last seen ${new Date(a.lastSeen).toISOString().slice(0, 16).replace('T', ' ')} UTC). This run waits in its queue until the machine is back; pick another provider to run it now.` : 'The ComfyUI machine has not connected yet (docs/COMFY.md). This run waits in its queue until it does; pick another provider to run it now.' }),
      }
      return e
    },
    async submit(req, opts) {
      const [job] = await o.db.select({ id: jobs.id, characterId: jobs.characterId, userId: jobs.userId }).from(jobs).where(and(eq(jobs.accountId, o.accountId), eq(jobs.idempotencyKey, opts.idempotencyKey)))
      const characterId = job?.characterId ?? null
      const [ch] = characterId ? await o.db.select({ age: characters.age, features: characters.features, name: characters.name }).from(characters).where(and(eq(characters.id, characterId), eq(characters.accountId, o.accountId))) : []
      // Fixed rules, enforced here because no provider filter runs.
      if (ch) {
        const young = adultProblem(ch.age)
        if (young) throw new ProviderError(`${ch.name}: ${young} Nothing was sent to the machine.`, { retryable: false, submitted: 'no' })
      }
      if (findExplicitTerms(req.prompt ?? '').length) throw new ProviderError(EXPLICIT_MESSAGE, { retryable: false, submitted: 'no' })
      if (req.kind !== 'train_identity') {
        const realism = realismBlockers(req.prompt, { kind: req.kind })
        if (realism.length) throw new ProviderError(realism.join(' '), { retryable: false, submitted: 'no' })
      }
      const faceless = (ch?.features as { kind?: string } | undefined)?.kind === 'faceless'
      if (req.kind === 'train_identity') return submitTrain(o, now(), req, opts.idempotencyKey, job, faceless)

      const wf = await workflowForRef(o.db, o.accountId, req.model, req.kind)
      const m = wf.manifest
      const lora = !faceless ? await activeLora(o.db, o.accountId, characterId, m.lora_base) : null
      if (m.id === 'krea-2-turbo' && ch && !faceless && !lora) throw new ProviderError(`Krea 2 Turbo is text to image: the face comes from ${ch.name}'s Krea 2 LoRA. Train one first (the character page, Train LoRA), or use Qwen-Image-Edit with her refs.`, { retryable: false, submitted: 'no' })
      const video = req.kind === 'video' || req.kind === 'video_clone'
      const fps = m.fps ?? 16
      const [w, h] = (video ? VIDEO_SIZES : SIZES)[req.aspect ?? '9:16'] ?? (video ? VIDEO_SIZES['9:16']! : SIZES['9:16']!)
      const refs = (req.refs ?? []).slice(0, m.inputs.refs?.length ?? 0)
      const start = req.startFrame ?? (req.kind === 'video' ? req.refs?.[0] : undefined)
      const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31)
      const prompt = lora ? `${lora.trigger}, ${req.prompt}` : req.prompt
      let bound
      try {
        bound = bindWorkflow(wf, {
          prompt, seed, width: w, height: h, batch: 1, refs: refs.length, startImage: !!start, clip: !!req.sourceVideo,
          frames: video ? wanFrames(req.durationSec ?? 5, fps) : undefined, fps: video ? fps : undefined,
          lora: lora ? { fileName: lora.fileName!, strength: 1 } : null,
        })
      } catch (e) {
        throw new ProviderError((e as Error).message, { retryable: false, submitted: 'no' })
      }
      const inputs: Record<string, string> = {}
      refs.forEach((r, i) => { inputs[`ref${i}`] = r.assetId })
      if (start && bound.slots.includes('start')) inputs.start = start.assetId
      if (req.sourceVideo && bound.slots.includes('clip')) inputs.clip = req.sourceVideo.assetId
      // The recipe log (E5): everything needed to make it again exactly.
      const recipe = {
        engine: 'comfy', workflow: m.id, workflowVersion: m.version, models: m.models, seed, prompt, refs: refs.map(r => r.assetId),
        start: start?.assetId ?? null, clip: req.sourceVideo?.assetId ?? null, size: [w, h], frames: video ? wanFrames(req.durationSec ?? 5, fps) : null,
        lora: lora ? { id: lora.id, base: lora.base, version: lora.version, trigger: lora.trigger, fileName: lora.fileName, sha256: lora.sha256 } : null,
        batchBinding: m.inputs.batch ?? null,
      }
      const t = await enqueue(o, o.accountId, now(), { key: opts.idempotencyKey, jobId: job?.id ?? null, characterId, userId: job?.userId ?? null, kind: 'workflow', workflow: wf, graph: bound.graph, inputs, recipe })
      return { jobId: t.id, raw: { created: t.created } }
    },
    async status(taskId): Promise<JobStatus> {
      // The sweep runs on every poll too, so a task on a machine that died
      // is reclaimed even when the agent never comes back.
      await sweep(o, o.accountId, now())
      const t = await taskRow(o, o.accountId, taskId)
      if (!t) return { state: 'failed', error: 'The ComfyUI task is gone.' }
      if (t.state === 'queued' || t.state === 'claimed') return { state: 'queued', pollAfterSec: 10 }
      if (t.state === 'running') return { state: 'running', pollAfterSec: 10 }
      if (t.state === 'canceled') return { state: 'canceled', error: 'Canceled.' }
      if (t.state === 'failed') return { state: 'failed', error: `ComfyUI: ${t.error ?? 'the run failed on the machine.'} It is in Settings > ComfyUI > Failed.` }
      return { state: 'succeeded', outputs: outputsOf(t.outputs) }
    },
    async result(taskId) {
      const t = await taskRow(o, o.accountId, taskId)
      return outputsOf(t?.outputs)
    },
    async cancel(taskId) {
      await cancelTask(o, o.accountId, now(), taskId)
    },
    async download(out: Output) {
      if (!out.url.startsWith('store:')) throw new ProviderError('A ComfyUI output must be in storage.', { retryable: false, submitted: 'no' })
      const key = out.url.slice('store:'.length)
      if (!key.startsWith(`comfy/${o.accountId}/`)) throw new ProviderError('That output is not this account\'s.', { retryable: false, submitted: 'no' })
      return o.store.get(key)
    },
    async verifyCredentials() {
      const a = await agentStatus(o.db, o.accountId)
      return isOnline(a, now()) ? { ok: true, message: `The machine is online${a?.gpu ? ` (${a.gpu})` : ''}.` } : { ok: false, message: 'The machine is offline or has not connected yet.' }
    },
  }
}

function outputsOf(raw: unknown): Output[] {
  return ((raw as Array<{ key: string; kind: string; mime: string; width?: number; height?: number; durationSec?: number }> | null) ?? []).map(x => ({
    url: `store:${x.key}`, kind: x.kind === 'video' ? 'video' : x.kind === 'json' ? 'audio' : 'image', mime: x.mime, width: x.width, height: x.height, durationSec: x.durationSec,
  }))
}

// A LoRA training (item 6): the images are the refs; the record says the
// base, the trigger word and the steps. The agent runs the trainer and
// sends back a small JSON record (file name, checksum); the file stays on
// the machine.
async function submitTrain(o: ComfyAdapterOptions, now: Date, req: GenRequest, key: string, job: { id: string; characterId: string | null; userId: string | null } | undefined, faceless: boolean): Promise<{ jobId: string }> {
  if (faceless) throw new ProviderError('Faceless characters have no LoRA.', { retryable: false, submitted: 'no' })
  const spec = req.lora
  if (!spec || !job?.characterId) throw new ProviderError('A LoRA training starts from the character page (Train LoRA).', { retryable: false, submitted: 'no' })
  // The record, once (a retried submit finds it).
  await o.db.insert(comfyLoras).values({ id: newId('lora'), accountId: o.accountId, characterId: job.characterId, base: spec.base, version: spec.version, trigger: spec.trigger, steps: spec.steps, images: spec.images, state: 'training', createdBy: job.userId, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [comfyLoras.accountId, comfyLoras.characterId, comfyLoras.base, comfyLoras.version] })
  const [l] = await o.db.select().from(comfyLoras).where(and(eq(comfyLoras.accountId, o.accountId), eq(comfyLoras.characterId, job.characterId), eq(comfyLoras.base, spec.base), eq(comfyLoras.version, spec.version)))
  const inputs: Record<string, string> = {}
  ;(req.refs ?? []).forEach((r, i) => { inputs[`img${String(i).padStart(2, '0')}`] = r.assetId })
  const fileName = `studio_${l!.characterId}_${l!.base}_v${l!.version}.safetensors`
  const train = { base: l!.base, trigger: l!.trigger, steps: l!.steps, fileName, rank: 32, learningRate: 1e-4, resolution: 1024, caption: `${l!.trigger}, a photo of a real person, natural skin texture` }
  const t = await enqueue(o, o.accountId, now, {
    key, jobId: job.id, characterId: job.characterId, userId: job.userId, kind: 'train',
    workflow: { manifest: { id: 'lora-train', version: 1, family: l!.base === 'krea2' ? 'krea2' : 'qwen', timeout_sec: 4 * 3600 }, graph: {} }, graph: {}, inputs,
    recipe: { engine: 'comfy', train, loraId: l!.id, images: Object.values(inputs) },
  })
  await o.db.update(comfyLoras).set({ taskId: t.id, updatedAt: now }).where(eq(comfyLoras.id, l!.id))
  return { jobId: t.id }
}
