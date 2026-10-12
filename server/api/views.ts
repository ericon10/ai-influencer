import type { Ctx, Deps } from '../context'
import { validateCharacter } from '../core/character'
import { listCredentials } from '../providers/credentials'
import { effectiveBudgets } from '../costs/budgets'
import { formatUsd, microsToUsd } from '../costs/money'
import { candidatesFor, getCharacter, inspirationAssetIds, listConcepts, sheetState, toData, type CharacterRow } from '../pipeline/characters'
import { characterCosts } from '../pipeline/costs'
import { providerMode, resolveRoute } from '../pipeline/settings'

// Response shapes for the UI. Plain data only; no secrets, no internals.

export async function characterSummary(deps: Deps, ctx: Ctx, row: CharacterRow) {
  const state = await sheetState(deps, ctx, row.id)
  const ref00 = state.refs.find(r => r.refId === 'REF-00')
  let ref00Asset: string | null = null
  if (ref00?.approvedCandidateId) {
    const cands = await candidatesFor(deps, ctx, row.id, { refId: 'REF-00', statuses: ['approved'] })
    ref00Asset = cands.find(c => c.id === ref00.approvedCandidateId)?.assetId ?? null
  }
  const costs = await characterCosts(deps, ctx, row.id)
  return {
    id: row.id, name: row.name, stage: row.stage, status: row.status, card: row.card,
    portraitAssetId: ref00Asset, progress: state.progress, spent: costs.spent, updatedAt: row.updatedAt.toISOString(),
  }
}

export async function characterView(deps: Deps, ctx: Ctx, id: string) {
  const row = await getCharacter(deps, ctx, id)
  const data = toData(row)
  const state = await sheetState(deps, ctx, id)
  const all = await candidatesFor(deps, ctx, id)
  const shapeCandidate = (c: (typeof all)[number]) => ({
    id: c.id, assetId: c.assetId, status: c.status, refId: c.refId, heroPromptIndex: c.heroPromptIndex, prompt: c.prompt,
    qaVerdict: c.qaVerdict, qaReport: c.qaReport, rejectReasons: c.rejectReasons, rejectNote: c.rejectNote,
    favorite: c.favorite, createdAt: c.createdAt.toISOString(),
  })
  const shots = state.shots.map(s => {
    const ref = state.refs.find(r => r.refId === s.id)
    const approved = ref?.approvedCandidateId ? all.find(c => c.id === ref.approvedCandidateId) : undefined
    return {
      id: s.id, label: s.label, view: s.view, framing: s.framing, aspect: deps.config.pipeline.sheet.settings.aspect[s.framing], attach: s.attach,
      status: state.states.find(x => x.refId === s.id)!.status, staleReason: ref?.staleReason ?? '',
      approved: approved ? { candidateId: approved.id, assetId: approved.assetId } : null,
      candidates: all.filter(c => c.refId === s.id && c.target === 'sheet').map(shapeCandidate),
    }
  })
  const concepts = await listConcepts(deps, ctx, id)
  return {
    id: row.id, name: row.name, slug: row.slug, stage: row.stage, status: row.status, revision: row.revision,
    data, breakdown: row.breakdown, issues: validateCharacter(data),
    sheetLock: row.sheetLock,
    inspirations: await inspirationAssetIds(deps, ctx, id),
    concepts: concepts.filter(c => c.status !== 'discarded').map(c => ({ id: c.id, position: c.position, status: c.status, data: c.data })),
    heroes: all.filter(c => c.target === 'hero').map(shapeCandidate),
    sheet: { shots, next: state.next ? { refId: state.next.shot.id, action: state.next.action } : null, progress: state.progress },
    costs: await characterCosts(deps, ctx, id),
    reasons: deps.config.pipeline.review.reasons.map(r => ({ id: r.id, label: r.label })),
    variationDefault: await defaultVariations(deps, ctx),
  }
}

async function defaultVariations(deps: Deps, ctx: Ctx): Promise<number> {
  const b = await effectiveBudgets(deps.db, ctx.accountId, deps.config.budgets)
  const route = await resolveRoute(deps, ctx, 'sheet')
  const [provider, model] = route.model.split('/')
  const price = deps.config.pricebook.entries.find(e => e.provider === provider && e.model === model && e.unit === 'image')?.price ?? 0
  return price * 1_000_000 > b.variationThresholdMicros ? deps.config.budgets.default_variations_expensive : Math.min(2, deps.config.budgets.default_variations_cheap)
}

export async function settingsView(deps: Deps, ctx: Ctx) {
  const b = await effectiveBudgets(deps.db, ctx.accountId, deps.config.budgets)
  const tasks = Object.keys(deps.config.routing.tasks)
  return {
    mode: await providerMode(deps.db, ctx.accountId),
    credentials: await listCredentials(deps.db, ctx.accountId),
    providers: [
      { id: 'higgsfield', label: 'Higgsfield', hint: 'KEY_ID:KEY_SECRET from the Higgsfield Console (API keys, pay-per-use). Not your web login.', placeholder: 'kid_xxx:secret_xxx', usedFor: 'Images and video' },
      { id: 'anthropic', label: 'Anthropic', hint: 'An API key from the Anthropic Console.', placeholder: 'sk-ant-...', usedFor: 'Breakdowns, concepts and QA' },
    ],
    budgets: {
      job: microsToUsd(b.jobCapMicros), character: microsToUsd(b.characterCapMicros), month: microsToUsd(b.monthCapMicros),
      confirmAbove: microsToUsd(b.confirmAboveMicros), warnPct: b.warnPct,
    },
    routing: await Promise.all(tasks.map(async t => ({ task: t, configured: deps.config.routing.tasks[t]!.model, effective: (await resolveRoute(deps, ctx, t)).model }))),
    models: deps.config.models.models.filter(m => !m.ref.startsWith('mock/')).map(m => ({ ref: m.ref, label: m.label, kinds: m.kinds, verified: m.verified && !!m.endpoint, notes: m.notes ?? '' })),
    prices: deps.config.pricebook.entries.filter(e => e.provider !== 'mock').map(e => ({ model: `${e.provider}/${e.model}`, unit: e.unit, price: formatUsd(Math.round(e.price * 1_000_000)), verified: e.verified, source: e.source ?? '' })),
    priceVersion: deps.config.pricebook.version,
  }
}
