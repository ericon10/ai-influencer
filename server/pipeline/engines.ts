import { AsyncLocalStorage } from 'node:async_hooks'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { estimateGen } from '../costs/pricebook.js'
import { formatUsd } from '../costs/money.js'
import { listCredentials } from '../providers/credentials.js'
import type { GenKind, GenRequest } from '../providers/types.js'
import { alternatives, familyOf, providerLabel, providerOf, routeRef, stepOfKind, type EngineChoices, type EngineStep } from '../core/engines.js'
import { getSetting, setSetting } from './settings.js'

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
  const step = opts.step ?? stepOfKind(kind)
  if (!familyOf(deps.config.engines, model)) return model
  return routeRef(deps.config.engines, model, step, await choicesFor(deps, ctx, step!, opts.characterId, opts.provider ?? runProvider.getStore() ?? null))
}

// Which providers have what they need to run: a saved key. Higgsfield, the
// default, counts as ready (its key, the server's key or the connected plan;
// its own runs say which one is missing).
export async function readyProviders(deps: Deps, ctx: Pick<Ctx, 'accountId'>): Promise<Set<string>> {
  const out = new Set((await listCredentials(deps.db, ctx.accountId)).map(c => c.provider))
  out.add('higgsfield')
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
      price: micros === null ? 'No price' : formatUsd(micros), micros, verified, checked,
      ready: ready.has(p), cheapest: false, chosen: ref === chosen, isDefault: i === 0, keys: eng.providers[p]?.keys ?? null,
    }
  })
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
