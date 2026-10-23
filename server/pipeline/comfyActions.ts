import { and, desc, eq, inArray, like, max } from 'drizzle-orm'
import { candidates, characters, comfyLoras, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import type { JobSpec } from '../jobs/runner.js'
import type { JobHook } from '../jobs/hooks.js'
import { registerJobHook } from '../jobs/hooks.js'
import type { RuleViolation } from '../core/rules.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { readAsset } from '../storage/assets.js'
import { cosineSimilarity } from '../qa/faces.js'
import { compareTexture } from '../qa/texture.js'
import { approvedAssets } from './characters.js'
import { setLever } from './engines.js'
import { activeLora } from './comfy.js'
import { forMode } from './settings.js'

// Character LoRAs and the bake-off (UX-PLAN.md section 41, items 6, 7, 12).
// Both are runs like any other: priced ($0 API on the machine, dollars on
// Kie.ai), and nothing starts without the owner's click.

const warn = (ruleId: string, title: string, message: string): RuleViolation => ({ ruleId, spec: '', title, severity: 'warning', message })
const SHEET = Array.from({ length: 14 }, (_, i) => `REF-${String(i).padStart(2, '0')}`)

async function personCharacter(deps: Deps, ctx: Ctx, characterId: string) {
  const [ch] = await deps.db.select().from(characters).where(and(eq(characters.id, characterId), eq(characters.accountId, ctx.accountId)))
  if (!ch) throw new AppError('not_found', 'No such character.')
  if ((ch.features as { kind?: string }).kind === 'faceless') throw new AppError('bad_request', 'Faceless characters have no LoRA: there is no face to hold.')
  return ch
}

export const defaultTrigger = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}_studio`

// Train LoRA: REF-00 to REF-11 (12 and 13 when present) and the approved
// stills the owner ticked, on the picked base.
export async function buildComfyTrain(deps: Deps, ctx: Ctx, a: { characterId: string; base: 'qwen' | 'krea2'; stillIds: string[]; trigger?: string; steps?: number }) {
  const ch = await personCharacter(deps, ctx, a.characterId)
  const sheet = await approvedAssets(deps, ctx, ch.id)
  const refs = SHEET.map(id => ({ id, assetId: sheet.get(id) })).filter((r): r is { id: string; assetId: string } => !!r.assetId)
  if (!refs.some(r => r.id === 'REF-00')) throw new AppError('bad_request', `${ch.name} has no approved REF-00 yet. Approve the sheet first; the LoRA learns the face from it.`)
  const stills = a.stillIds.length ? await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, ch.id), inArray(candidates.id, a.stillIds), eq(candidates.status, 'approved'))) : []
  if (stills.length !== a.stillIds.length) throw new AppError('bad_request', 'Only approved stills of this character can train its LoRA.')
  const images = [...refs.map(r => ({ assetId: r.assetId, refId: r.id })), ...stills.filter(s => s.assetId && !s.op.startsWith('video')).map(s => ({ assetId: s.assetId!, stillId: s.id }))]
  const [{ v } = { v: 0 }] = await deps.db.select({ v: max(comfyLoras.version) }).from(comfyLoras).where(and(eq(comfyLoras.accountId, ctx.accountId), eq(comfyLoras.characterId, ch.id), eq(comfyLoras.base, a.base)))
  const version = (v ?? 0) + 1
  const trigger = (a.trigger?.trim() || defaultTrigger(ch.name)).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)
  const steps = Math.max(500, Math.min(6000, a.steps ?? 2000))
  const warnings: RuleViolation[] = []
  if (a.base === 'krea2') warnings.push(warn('comfy-license', 'Krea 2: license check', 'Krea 2 Raw and Turbo are marked "license check" until Eric confirms commercial use is allowed. Train and test freely; do not post from it until then.'))
  if (images.length < 12) warnings.push(warn('comfy-lora-few', 'Few images', `${images.length} images. A LoRA holds a face best with the 12 sheet images and a few approved stills.`))
  const spec: JobSpec = {
    type: 'gen', stage: 'lora', purpose: `comfy_lora:${ch.id}:${a.base}:${version}`, label: `Train ${ch.name}'s ${a.base === 'krea2' ? 'Krea 2' : 'Qwen'} LoRA v${version}`,
    request: { kind: 'train_identity', model: (await forMode(deps, ctx, { model: 'comfy/lora-train', kind: 'train_identity' } as never) as { model: string }).model === 'comfy/lora-train' ? 'comfy/lora-train' : 'mock/image', modelRef: 'comfy/lora-train', prompt: '', refs: images.map(i => ({ assetId: i.assetId })), lora: { base: a.base, version, trigger, steps, images } },
  }
  return { purpose: spec.purpose, characterId: ch.id, specs: [spec], preview: { title: spec.label, prompts: [], warnings, invalidates: [] } }
}

// The LoRA record is made when the run starts (submit), from the request;
// this hook fills it in when the machine reports the file.
const onLora: JobHook = async (deps, ctx, job, outcome) => {
  const [, characterId, base, version] = job.purpose.split(':')
  const where = and(eq(comfyLoras.accountId, ctx.accountId), eq(comfyLoras.characterId, characterId!), eq(comfyLoras.base, base!), eq(comfyLoras.version, Number(version)))
  if (outcome.status !== 'completed') { await deps.db.update(comfyLoras).set({ state: 'failed', updatedAt: deps.clock.now() }).where(where); return }
  // Demo mode: the mock stood in for the machine; a demo record shows how
  // the LoRA list reads (its file name says demo).
  const req = job.request as { model?: string; lora?: { trigger: string; steps: number; images: unknown[] } }
  if (String(req.model).startsWith('mock/') && req.lora) {
    await deps.db.insert(comfyLoras).values({ id: newId('lora'), accountId: ctx.accountId, characterId: characterId!, base: base!, version: Number(version), trigger: req.lora.trigger, steps: req.lora.steps, images: req.lora.images, state: 'training', createdBy: job.userId })
      .onConflictDoNothing({ target: [comfyLoras.accountId, comfyLoras.characterId, comfyLoras.base, comfyLoras.version] })
    await deps.db.update(comfyLoras).set({ active: false }).where(and(eq(comfyLoras.accountId, ctx.accountId), eq(comfyLoras.characterId, characterId!), eq(comfyLoras.base, base!)))
    await deps.db.update(comfyLoras).set({ state: 'ready', fileName: `demo_${characterId}_${base}_v${version}.safetensors`, sha256: '0'.repeat(64), active: true, updatedAt: deps.clock.now() }).where(where)
    return
  }
  const asset = outcome.assets?.[0]
  const rec = asset ? JSON.parse((await readAsset(deps, ctx, asset.id)).data.toString()) as { fileName?: string; sha256?: string } : {}
  if (!rec.fileName || !/^[a-f0-9]{64}$/.test(rec.sha256 ?? '')) { await deps.db.update(comfyLoras).set({ state: 'failed', updatedAt: deps.clock.now() }).where(where); return }
  // The newest finished version rides along; older ones stay selectable.
  await deps.db.update(comfyLoras).set({ active: false }).where(and(eq(comfyLoras.accountId, ctx.accountId), eq(comfyLoras.characterId, characterId!), eq(comfyLoras.base, base!)))
  await deps.db.update(comfyLoras).set({ state: 'ready', fileName: rec.fileName, sha256: rec.sha256, active: true, updatedAt: deps.clock.now() }).where(where)
}

// ── The bake-off (item 12) ──

export const BAKEOFF_MODELS = ['kie/nano-banana-2.1', 'comfy/qwen-image-edit-2511', 'comfy/krea-2-turbo'] as const

export async function buildCompare(deps: Deps, ctx: Ctx, a: { characterId: string; count?: number }) {
  const ch = await personCharacter(deps, ctx, a.characterId)
  const sheet = await approvedAssets(deps, ctx, ch.id)
  const ref00 = sheet.get('REF-00')
  if (!ref00) throw new AppError('bad_request', `${ch.name} has no approved REF-00 to compare faces against.`)
  const side = ['REF-02', 'REF-03', 'REF-01'].map(id => sheet.get(id)).find(Boolean)
  const refs = [ref00, ...(side ? [side] : [])].map(assetId => ({ assetId }))
  const rows = await deps.db.select({ prompt: candidates.prompt }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, ch.id), eq(candidates.target, 'scene'), eq(candidates.op, 'generate'))).orderBy(desc(candidates.createdAt)).limit(60)
  const prompts = [...new Set(rows.map(r => r.prompt).filter(p => p && p.includes('REALISM')))].slice(0, a.count ?? 10)
  if (!prompts.length) throw new AppError('bad_request', `${ch.name} has no scene stills yet. Make a few, then compare providers on her real prompts.`)
  const krea = await activeLora(deps.db, ctx.accountId, ch.id, 'krea2')
  const run = newId('que')
  const specs: JobSpec[] = []
  for (const [i, prompt] of prompts.entries()) {
    for (const model of BAKEOFF_MODELS) {
      if (model === 'comfy/krea-2-turbo' && !krea) continue
      const text = model === 'comfy/krea-2-turbo'
      const kind = text ? 'image' : 'image_edit'
      // Demo mode runs the free mock in each one's place; modelRef keeps
      // the compared model. Never routed through the lever or the picks.
      const ran = (await forMode(deps, ctx, { model, kind } as never) as { model: string }).model
      specs.push({ type: 'gen', stage: 'scene', purpose: `bakeoff:${run}:${i}`, label: `Compare ${i + 1}: ${deps.config.models.models.find(m => m.ref === model)?.label}`, request: { kind, model: ran, modelRef: model, prompt, aspect: '9:16', resolution: '2k', ...(text ? {} : { refs }) } })
    }
  }
  const warnings: RuleViolation[] = []
  if (!krea) warnings.push(warn('bakeoff-krea', 'No Krea 2 LoRA yet', `Krea 2 Turbo is text to image: its face comes from ${ch.name}'s Krea 2 LoRA. Train one to add it to the comparison.`))
  if (!(await activeLora(deps.db, ctx.accountId, ch.id, 'qwen'))) warnings.push(warn('bakeoff-qwen', 'No Qwen LoRA yet', 'Qwen-Image-Edit runs with her refs only. Train her Qwen LoRA for the fair comparison.'))
  return { purpose: `bakeoff:${run}`, characterId: ch.id, specs, preview: { title: `Compare providers: ${prompts.length} of ${ch.name}'s prompts`, prompts: [], warnings, invalidates: [] } }
}

// Each still's face score against REF-00 and its skin texture against
// REF-00's (Realism rule 5's Laplacian check; 1 = as much detail).
const onBakeoff: JobHook = async (deps, ctx, job, outcome) => {
  if (outcome.status !== 'completed' || !outcome.assets?.[0] || !job.characterId) return
  const sheet = await approvedAssets(deps, ctx, job.characterId)
  const ref00 = sheet.get('REF-00')
  let face: number | null = null, texture: number | null = null
  if (ref00) {
    const [ref, out] = await Promise.all([readAsset(deps, ctx, ref00), readAsset(deps, ctx, outcome.assets[0].id)])
    if ((await deps.faces.status()).available) {
      const [a, b] = await Promise.all([deps.faces.analyze(ref.data, ref.row.checksumSha256 ?? undefined), deps.faces.analyze(out.data)])
      if (a && b) face = Math.round(cosineSimilarity(a.embedding, b.embedding) * 1000) / 1000
    }
    const t = await compareTexture(ref.data, out.data, { faces: deps.faces }).catch(() => null)
    if (t?.judged) texture = Math.round(t.ratio * 100) / 100
  }
  await deps.db.update(jobs).set({ resultMeta: { ...(job.resultMeta as object ?? {}), bakeoff: { face, texture } } }).where(eq(jobs.id, job.id))
}

export async function compareView(deps: Deps, ctx: Ctx, characterId: string) {
  const rows = await deps.db.select().from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.characterId, characterId), like(jobs.purpose, 'bakeoff:%'))).orderBy(desc(jobs.createdAt)).limit(200)
  const runId = rows[0]?.purpose.split(':')[1]
  if (!runId) return { run: null }
  const mine = rows.filter(r => r.purpose.split(':')[1] === runId)
  const { jobOutputs } = await import('../db/schema.js')
  const outs = await deps.db.select().from(jobOutputs).where(inArray(jobOutputs.jobId, mine.map(m => m.id)))
  const label = (ref: string) => deps.config.models.models.find(m => m.ref === ref)?.label ?? ref
  const byPrompt = new Map<number, { prompt: string; cells: Record<string, { jobId: string; status: string; assetId: string | null; face: number | null; texture: number | null }> }>()
  for (const j of mine) {
    const i = Number(j.purpose.split(':')[2])
    const req = j.request as { prompt?: string; modelRef?: string; model: string }
    const ref = req.modelRef ?? req.model
    const row = byPrompt.get(i) ?? { prompt: req.prompt ?? '', cells: {} }
    const meta = (j.resultMeta as { bakeoff?: { face: number | null; texture: number | null } } | null)?.bakeoff
    row.cells[ref] = { jobId: j.id, status: j.status, assetId: outs.find(o => o.jobId === j.id)?.assetId ?? null, face: meta?.face ?? null, texture: meta?.texture ?? null }
    byPrompt.set(i, row)
  }
  const models = BAKEOFF_MODELS.filter(m => mine.some(j => ((j.request as { modelRef?: string; model: string }).modelRef ?? (j.request as { model: string }).model) === m))
  const avg = (m: string, k: 'face' | 'texture') => { const v = [...byPrompt.values()].map(r => r.cells[m]?.[k]).filter((x): x is number => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null }
  return {
    run: runId, at: mine[mine.length - 1]!.createdAt.toISOString(),
    models: models.map(m => ({ ref: m, label: label(m), face: avg(m, 'face'), texture: avg(m, 'texture') })),
    rows: [...byPrompt.entries()].sort((a, b) => a[0] - b[0]).map(([i, r]) => ({ index: i, ...r })),
  }
}

// "Use as default": that model for stills on every character (the lever's
// step override). Nothing changes until the owner picks.
export async function useAsDefault(deps: Deps, ctx: Ctx, ref: string): Promise<void> {
  if (!(BAKEOFF_MODELS as readonly string[]).includes(ref)) throw new AppError('bad_request', 'Pick one of the compared models.')
  await setLever(deps, ctx, { step: { step: 'still', ref } })
}

export function registerComfyHooks(): void {
  registerJobHook('comfy_lora', onLora)
  registerJobHook('bakeoff', onBakeoff)
}
