import { AsyncLocalStorage } from 'node:async_hooks'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { estimateGen } from '../costs/pricebook.js'
import { formatUsd } from '../costs/money.js'
import { listCredentials } from '../providers/credentials.js'
import type { GenKind, GenRequest } from '../providers/types.js'
import { alternatives, familyOf, providerLabel, providerOf, routeRef, stepOfKind, type EngineChoices, type EngineStep } from '../core/engines.js'
import { getSetting, setSetting } from './settings.js'
import { agentStatus, isOnline } from './comfy.js'

// Step > model > provider (owner, 2026-10-23; UX-PLAN.md section 40): the
// owner's picks (one account setting), the picker's view with every
// provider's price side by side, and the routing every paid step goes
// through (runModel in sceneActions.ts).

export const ENGINE_KEY = 'engine_choices'
interface Saved { steps: Partial<Record<EngineStep, Record<string, string>>>; characters: Record<string, Partial<Record<EngineStep, Record<string, string>>>> }
const empty = (): Saved => ({ steps: {}, characters: {} })

async function saved(deps: Deps, ctx: Ctx): Promise<Saved> {
  const s = await getSetting<Saved>(deps.db, ctx.accountId, ENGINE_KEY, empty())
  return { steps: s.steps ?? {}, characters: s.characters ?? {} }
}

export async function choicesFor(deps: Deps, ctx: Ctx, step: EngineStep, characterId?: string | null, run?: string | null): Promise<EngineChoices> {
  const s = await saved(deps, ctx)
  return { run: run ?? null, step: s.steps[step] ?? {}, character: characterId ? s.characters[characterId]?.[step] ?? {} : {} }
}

export interface RouteOpts { step?: EngineStep; characterId?: string | null; provider?: string | null }

// A whole run's provider (Weeks > Make the week, "Provider for this run"):
// every post built inside withRunProvider uses it where it runs that post's
// model, else the post's own pick.
const runProvider = new AsyncLocalStorage<string>()
export function withRunProvider<T>(provider: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return provider ? runProvider.run(provider, fn) : fn()
}

// The ref that runs for this step (the owner's pick), before demo mode
// swaps in the mock.
export async function routeModel(deps: Deps, ctx: Ctx, model: string, kind: GenKind, opts: RouteOpts = {}): Promise<string> {
  return (await routeWithLever(deps, ctx, model, kind, opts)).ref
}

// The full route (section 41, item 15): the run's provider, then this
// character's provider pick, then the step's pick (all for the same model),
// then the lever's overrides for this character and this step, then the
// engine's model for the step, else the model as asked. A model the target
// cannot run as asked (a still with refs on a text-only model) keeps the
// asked one. The Higgsfield subscription engine pays from the plan.
export async function routeWithLever(deps: Deps, ctx: Ctx, model: string, kind: GenKind, opts: RouteOpts = {}): Promise<{ ref: string; billing?: 'account' | 'api'; source: 'pick' | 'character' | 'step' | 'engine' | 'asked'; engine: string | null }> {
  const step = opts.step ?? stepOfKind(kind)
  const lever = await readLever(deps, ctx.accountId)
  const billingFor = (ref: string) => (providerOf(ref) === 'higgsfield' && lever.engine ? deps.config.engines.engines[lever.engine]?.billing : undefined)
  if (familyOf(deps.config.engines, model)) {
    const picked = routeRef(deps.config.engines, model, step, await choicesFor(deps, ctx, step!, opts.characterId, opts.provider ?? runProvider.getStore() ?? null))
    if (picked !== model) return { ref: picked, source: 'pick', engine: lever.engine, billing: billingFor(picked) }
  }
  if (!step) return { ref: model, source: 'asked', engine: lever.engine }
  const fits = (ref: string | null | undefined): ref is string => !!ref && !!deps.config.models.models.find(m => m.ref === ref)?.kinds.includes(kind)
  const ch = opts.characterId ? lever.characters[opts.characterId]?.[step] : undefined
  if (fits(ch)) return { ref: ch, source: 'character', engine: lever.engine, billing: billingFor(ch) }
  const st = lever.steps[step]
  if (fits(st)) return { ref: st, source: 'step', engine: lever.engine, billing: billingFor(st) }
  if (lever.engine) {
    const ref = leverTable(deps, lever)[lever.engine]?.[step]
    if (fits(ref)) return { ref, source: 'engine', engine: lever.engine, billing: billingFor(ref) }
  }
  return { ref: model, source: 'asked', engine: lever.engine, billing: billingFor(model) }
}

// ── The engine lever (section 41, item 15) ──

export const LEVER_KEY = 'engine_lever'
export type LeverStep = EngineStep | 'lora'
export interface Lever {
  engine: string | null
  // The owner's edits to the engines' tables (Settings > Engine).
  table: Record<string, Partial<Record<LeverStep, string | null>>>
  // Overrides for a step on every engine ("ComfyUI stills"), and for one
  // character.
  steps: Partial<Record<EngineStep, string>>
  characters: Record<string, Partial<Record<EngineStep, string>>>
}

export async function readLever(deps: Pick<Deps, 'db'>, accountId: string): Promise<Lever> {
  const s = await getSetting<Partial<Lever>>(deps.db, accountId, LEVER_KEY, {})
  return { engine: s.engine ?? null, table: s.table ?? {}, steps: s.steps ?? {}, characters: s.characters ?? {} }
}

export function leverTable(deps: Pick<Deps, 'config'>, lever: Lever): Record<string, Partial<Record<LeverStep, string | null>>> {
  const out: Record<string, Partial<Record<LeverStep, string | null>>> = {}
  for (const [id, e] of Object.entries(deps.config.engines.engines)) out[id] = { ...e.steps, ...(lever.table[id] ?? {}) }
  return out
}

const LEVER_STEPS: LeverStep[] = ['still', 'edit', 'video', 'recreate_still', 'recreate_motion', 'lora']
const STEP_LABEL: Record<LeverStep, string> = { still: 'Stills', edit: 'Edits', video: 'Video (image to video)', recreate_still: 'Recreate stills and face pass', recreate_motion: 'Recreate motion', lora: 'Character LoRA' }

// A model's price for one representative run, in the engine's units.
async function cellPrice(deps: Deps, ctx: Ctx, ref: string, step: LeverStep): Promise<string> {
  if (step === 'lora') return providerOf(ref) === 'comfy' ? '$0 API, about 30 min on ComfyUI' : 'No price'
  const kind = (step === 'video' ? 'video' : step === 'recreate_motion' ? 'video_clone' : step === 'still' ? 'image' : 'image_edit') as GenKind
  try {
    if (providerOf(ref) === 'comfy') {
      const e = await (await deps.providers.gen(ctx.accountId, ref)).estimate({ ...sample(step, kind, {}), model: ref })
      return `$0 API, about ${e.minutes ?? 1} min on ComfyUI`
    }
    const e = estimateGen(deps.config, { ...sample(step, kind, {}), model: ref })
    const credits = deps.config.pricebook.entries.find(x => x.provider === providerOf(ref) && x.model === ref.slice(providerOf(ref).length + 1) && x.credits != null)?.credits
    return credits != null && providerOf(ref) === 'higgsfield' ? `${formatUsd(e.totalMicros)} or ${credits} plan credits` : formatUsd(e.totalMicros)
  } catch { return 'No price' }
}

export async function leverView(deps: Deps, ctx: Ctx) {
  const lever = await readLever(deps, ctx.accountId)
  const table = leverTable(deps, lever)
  const label = (ref: string | null | undefined) => (ref ? deps.config.models.models.find(m => m.ref === ref)?.label ?? ref : null)
  const engines = Object.entries(deps.config.engines.engines).map(([id, e]) => ({ id, label: e.label, units: e.units, billing: e.billing ?? null }))
  const rows = []
  for (const step of LEVER_STEPS) {
    const cells: Record<string, { ref: string | null; label: string | null; price: string | null; provider: string | null }> = {}
    for (const e of engines) {
      const ref = table[e.id]?.[step] ?? null
      cells[e.id] = { ref, label: label(ref), price: ref ? await cellPrice(deps, ctx, ref, step) : null, provider: ref ? providerLabel(deps.config.engines, providerOf(ref)) : null }
    }
    const options = deps.config.models.models.filter(m => !m.ref.startsWith('mock/') && (step === 'lora' ? m.kinds.includes('train_identity') && m.ref.startsWith('comfy/') : m.kinds.some(k => (deps.config.engines.steps[step as EngineStep]?.kinds ?? []).includes(k)))).map(m => ({ ref: m.ref, label: `${m.label}${m.ref.startsWith('comfy/') ? '' : ` (${providerLabel(deps.config.engines, providerOf(m.ref))})`}` }))
    rows.push({ step, label: STEP_LABEL[step], cells, override: step === 'lora' ? null : lever.steps[step as EngineStep] ?? null, overrideLabel: step === 'lora' ? null : label(lever.steps[step as EngineStep]), options })
  }
  // What the chosen engine cannot do, in words, with what runs instead.
  const notes: string[] = []
  if (lever.engine) {
    const e = deps.config.engines.engines[lever.engine]!
    for (const r of rows) {
      if (r.cells[lever.engine]?.ref) continue
      const instead = r.step === 'lora' ? null : engines.map(x => r.cells[x.id]).find(c => c?.ref)
      notes.push(r.step === 'lora' ? `${e.label} trains no character LoRA; LoRAs train on ComfyUI only.` : `${e.label} cannot do ${r.label.toLowerCase()}: those keep their own model${instead?.ref ? `, for example ${instead.label} on ${instead.provider} at ${instead.price}` : ''}.`)
    }
  }
  return { engine: lever.engine, engines, rows, notes, characters: lever.characters }
}

export async function setLever(deps: Deps, ctx: Ctx, input: { engine?: string | null; cell?: { engine: string; step: LeverStep; ref: string | null }; step?: { step: EngineStep; ref: string | null }; character?: { characterId: string; step: EngineStep; ref: string | null } }): Promise<void> {
  const lever = await readLever(deps, ctx.accountId)
  const known = (ref: string | null) => { if (ref && !deps.config.models.models.some(m => m.ref === ref)) throw new AppError('bad_request', `Unknown model ${ref}.`) }
  if (input.engine !== undefined) {
    if (input.engine && !deps.config.engines.engines[input.engine]) throw new AppError('bad_request', 'Unknown engine.')
    lever.engine = input.engine
  }
  if (input.cell) {
    if (!deps.config.engines.engines[input.cell.engine]) throw new AppError('bad_request', 'Unknown engine.')
    known(input.cell.ref)
    lever.table[input.cell.engine] = { ...(lever.table[input.cell.engine] ?? {}), [input.cell.step]: input.cell.ref }
  }
  if (input.step) {
    known(input.step.ref)
    if (input.step.ref) lever.steps[input.step.step] = input.step.ref
    else delete lever.steps[input.step.step]
  }
  if (input.character) {
    known(input.character.ref)
    const c = { ...(lever.characters[input.character.characterId] ?? {}) }
    if (input.character.ref) c[input.character.step] = input.character.ref
    else delete c[input.character.step]
    lever.characters[input.character.characterId] = c
  }
  await setSetting(deps, ctx, LEVER_KEY, lever)
}

// Which providers have what they need to run: a saved key. Higgsfield, the
// default, counts as ready (its key, the server's key or the connected plan;
// its own runs say which one is missing).
export async function readyProviders(deps: Deps, ctx: Pick<Ctx, 'accountId'>): Promise<Set<string>> {
  const out = new Set((await listCredentials(deps.db, ctx.accountId)).map(c => c.provider))
  out.add('higgsfield')
  // ComfyUI: ready once its agent token is made (section 41); offline is
  // shown on its own.
  if ((await getSetting<{ tokenHash?: string }>(deps.db, ctx.accountId, 'comfy', {})).tokenHash) out.add('comfy')
  return out
}

// A representative run per step, priced the same way for every provider.
function sample(step: EngineStep, kind: GenKind, o: { resolution?: string; seconds?: number; audio?: boolean }): Omit<GenRequest, 'model'> {
  const video = kind === 'video' || kind === 'video_clone'
  return { kind, prompt: '', aspect: '9:16', ...(video ? { durationSec: o.seconds ?? 5, resolution: o.resolution ?? '720p', audio: o.audio === true } : { resolution: o.resolution ?? '2k' }) }
}

export interface PickRow {
  ref: string; provider: string; providerLabel: string; label: string
  price: string; micros: number | null; verified: boolean; checked: string | null
  ready: boolean; cheapest: boolean; chosen: boolean; isDefault: boolean; keys: string | null
  // ComfyUI (section 41): the machine has sent no heartbeat for 2 minutes.
  offline?: boolean
}
export interface PickView {
  step: EngineStep; stepLabel: string; family: { id: string; label: string } | null
  per: string; rows: PickRow[]
  pick: { character: string | null; step: string | null; run: string | null }
}

export async function pickView(deps: Deps, ctx: Ctx, input: { step: EngineStep; model: string; characterId?: string | null; resolution?: string; seconds?: number; audio?: boolean }): Promise<PickView> {
  const eng = deps.config.engines
  const stepCfg = eng.steps[input.step]
  if (!stepCfg) throw new AppError('bad_request', `Unknown step "${input.step}".`)
  const fam = familyOf(eng, input.model)
  const per = (input.step === 'video' || input.step === 'recreate_motion') ? `${input.seconds ?? 5} s` : 'still'
  if (!fam || !fam.steps.includes(input.step)) return { step: input.step, stepLabel: stepCfg.label, family: null, per, rows: [], pick: { character: null, step: null, run: null } }
  const choices = await choicesFor(deps, ctx, input.step, input.characterId)
  const chosen = routeRef(eng, fam.providers[0]!, input.step, choices)
  const ready = await readyProviders(deps, ctx)
  const kind = (stepCfg.kinds.includes('video') ? 'video' : stepCfg.kinds.includes('video_clone') ? 'video_clone' : input.step === 'still' ? 'image' : 'image_edit') as GenKind
  const rows: PickRow[] = fam.providers.map((ref, i) => {
    const p = providerOf(ref)
    const m = deps.config.models.models.find(x => x.ref === ref)!
    let micros: number | null = null, verified = false, checked: string | null = null
    try {
      const e = estimateGen(deps.config, { ...sample(input.step, kind, input), model: ref })
      micros = e.totalMicros; verified = e.verified
      checked = deps.config.pricebook.entries.find(x => x.provider === p && x.model === ref.slice(p.length + 1) && x.checked)?.checked ?? null
    } catch { /* no price for this request shape */ }
    return {
      ref, provider: p, providerLabel: providerLabel(eng, p), label: m.label,
      price: micros === null ? 'No price' : p === 'comfy' ? '$0 API' : formatUsd(micros), micros, verified, checked,
      ready: ready.has(p), cheapest: false, chosen: ref === chosen, isDefault: i === 0, keys: eng.providers[p]?.keys ?? null,
    }
  })
  if (rows.some(r => r.provider === 'comfy')) {
    const off = !isOnline(await agentStatus(deps.db, ctx.accountId), deps.clock.now())
    for (const r of rows) if (r.provider === 'comfy') r.offline = off
  }
  const priced = rows.filter(r => r.micros !== null)
  const low = Math.min(...priced.map(r => r.micros!))
  for (const r of rows) r.cheapest = priced.length > 1 && r.micros === low
  return {
    step: input.step, stepLabel: stepCfg.label, family: { id: fam.id, label: fam.label }, per, rows,
    pick: { character: choices.character?.[fam.id] ?? null, step: choices.step?.[fam.id] ?? null, run: null },
  }
}

// Saves a pick: for the step (every character) or for one character on the
// step. provider null goes back to the default.
export async function setPick(deps: Deps, ctx: Ctx, input: { step: EngineStep; family: string; provider: string | null; characterId?: string | null }): Promise<void> {
  const fam = deps.config.engines.families.find(f => f.id === input.family)
  if (!fam || !fam.steps.includes(input.step)) throw new AppError('bad_request', 'That model does not run on that step.')
  if (input.provider && !fam.providers.some(r => providerOf(r) === input.provider)) throw new AppError('bad_request', `${providerLabel(deps.config.engines, input.provider)} does not run ${fam.label}.`)
  const s = await saved(deps, ctx)
  const scope = input.characterId ? (s.characters[input.characterId] ??= {}) : s.steps
  const map = { ...(scope[input.step] ?? {}) }
  if (input.provider) map[fam.id] = input.provider
  else delete map[fam.id]
  scope[input.step] = map
  await setSetting(deps, ctx, ENGINE_KEY, s)
}

// The whole table for Settings: each step, its models and the pick.
export async function enginesView(deps: Deps, ctx: Ctx) {
  const eng = deps.config.engines
  const out = []
  for (const step of Object.keys(eng.steps) as EngineStep[]) {
    const fams = eng.families.filter(f => f.steps.includes(step))
    out.push({ step, label: eng.steps[step]!.label, models: await Promise.all(fams.map(f => pickView(deps, ctx, { step, model: f.providers[0]! }))) })
  }
  return { steps: out, providers: Object.entries(eng.providers).map(([id, p]) => ({ id, label: p.label, keys: p.keys ?? null })) }
}

// A failed or refused run's next tries: the other providers that run the
// same model on its step and have a key, each with its price for this
// exact request. Nothing runs from here; the UI shows priced buttons.
export async function nextProviders(deps: Deps, ctx: Pick<Ctx, 'accountId'>, req: GenRequest, step?: EngineStep | null): Promise<Array<{ ref: string; provider: string; label: string; price: string; micros: number; verified: boolean }>> {
  const ready = await readyProviders(deps, ctx)
  const out = []
  for (const ref of alternatives(deps.config.engines, req.model, step ?? stepOfKind(req.kind))) {
    const p = providerOf(ref)
    if (!ready.has(p)) continue
    try {
      const e = estimateGen(deps.config, { ...req, model: ref })
      out.push({ ref, provider: p, label: providerLabel(deps.config.engines, p), price: formatUsd(e.totalMicros), micros: e.totalMicros, verified: e.verified })
    } catch { /* no price for this shape: not offered */ }
  }
  return out.sort((a, b) => a.micros - b.micros)
}

// The model a run asked for: in demo mode the mock ran in its place, and
// modelRef keeps the Studio's pick.
export const askedModel = (req: { model?: unknown; modelRef?: unknown }) => String(typeof req.modelRef === 'string' && req.modelRef ? req.modelRef : req.model ?? '')

// "Try on Kie.ai": the failed run's request with only the provider changed.
// What was tied to the old provider (its billing path, a saved Higgsfield
// identity) is dropped; the new provider's quote prices it.
export function onProvider(deps: Deps, request: Record<string, unknown>, provider: string): { request: Record<string, unknown>; ref: string } {
  const asked = askedModel(request)
  const ref = alternatives(deps.config.engines, asked, null).find(r => providerOf(r) === provider)
  if (!ref) throw new AppError('bad_request', `${providerLabel(deps.config.engines, provider)} does not run this model.`)
  const next: Record<string, unknown> = { ...request, modelRef: ref }
  if (!String(request.model ?? '').startsWith('mock/')) next.model = ref
  if (provider !== 'higgsfield') { delete next.billing; delete next.identityId; delete next.quotedCredits }
  return { request: next, ref }
}
