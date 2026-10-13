import type { Ctx, Deps } from '../context.js'
import { validateCharacter } from '../core/character.js'
import { hardWrap } from '../core/text.js'
import { listCredentials } from '../providers/credentials.js'
import { effectiveBudgets } from '../costs/budgets.js'
import { formatUsd, microsToUsd } from '../costs/money.js'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { jobs } from '../db/schema.js'
import { getAsset } from '../storage/assets.js'
import { candidatesFor, getCharacter, inspirationAssetIds, listConcepts, sheetState, toData, type CharacterRow } from '../pipeline/characters.js'
import { characterCosts } from '../pipeline/costs.js'
import { providerMode, resolveRoute } from '../pipeline/settings.js'
import { effectiveModel, readModelOverrides } from '../providers/modelOverrides.js'
import { readBilling } from '../providers/billing.js'
import { serverKeyFor } from '../providers/serverKeys.js'

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
  const ref00 = shots[0]?.approved?.assetId ? await getAsset(deps, ctx, shots[0].approved.assetId) : null
  const [cardJob] = await deps.db.select().from(jobs)
    .where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.characterId, id), eq(jobs.purpose, 'card_update'), eq(jobs.status, 'completed')))
    .orderBy(desc(jobs.completedAt)).limit(1)
  return {
    id: row.id, name: row.name, slug: row.slug, stage: row.stage, status: row.status, revision: row.revision,
    // Kept sections are shown hard-wrapped, like prompts.
    data: { ...data, sections: data.sections.map(sec => ({ ...sec, wrapped: hardWrap(sec.body, 80) })) },
    breakdown: row.breakdown, issues: validateCharacter(data),
    sheetLock: row.sheetLock,
    ref00: ref00 ? { assetId: ref00.id, width: ref00.width, height: ref00.height, needsUpscale: (ref00.height ?? 0) < deps.config.pipeline.sheet.settings.upscale_ref00_below_px } : null,
    cardSuggestion: cardJob ? { jobId: cardJob.id, at: cardJob.completedAt?.toISOString() ?? null, ...((cardJob.resultMeta as { data?: object } | null)?.data ?? {}) } : null,
    inspirations: await inspirationAssetIds(deps, ctx, id),
    concepts: concepts.filter(c => c.status !== 'discarded').map(c => ({ id: c.id, position: c.position, status: c.status, data: c.data })),
    heroes: all.filter(c => c.target === 'hero').map(shapeCandidate),
    sheet: { shots, next: state.next ? { refId: state.next.shot.id, action: state.next.action } : null, progress: state.progress },
    costs: await characterCosts(deps, ctx, id),
    reasons: deps.config.pipeline.review.reasons.map(r => ({ id: r.id, label: r.label })),
    variationDefault: await defaultVariations(deps, ctx),
    modelLabels: Object.fromEntries(deps.config.models.models.map(m => [m.ref, m.label])),
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
  const overrides = await readModelOverrides(deps.db, ctx.accountId)
  const tasks = Object.keys(deps.config.routing.tasks)
  const credentials = await listCredentials(deps.db, ctx.accountId)
  const account = credentials.find(c => c.provider === 'higgsfield_account')
  const connectionIds = Object.keys(deps.config.runtime.mcp_connections)
  // The model test suite: each model's latest test, with what it cost.
  const suite = deps.config.runtime.model_suite
  const suiteJobIds = suite.tests.map(t => overrides[t.model]?.pendingTest?.jobId ?? overrides[t.model]?.lastTest?.jobId).filter((id): id is string => !!id)
  const suiteJobs = suiteJobIds.length
    ? await deps.db.select({ id: jobs.id, estimate: jobs.estimateMicros, actual: jobs.actualMicros }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), inArray(jobs.id, suiteJobIds)))
    : []
  return {
    mode: await providerMode(deps.db, ctx.accountId),
    modelSuite: {
      cap: formatUsd(Math.round(suite.cap_usd * 1_000_000)),
      tests: suite.tests.map(t => {
        const base = deps.config.models.models.find(m => m.ref === t.model)
        const o = overrides[t.model]
        const job = suiteJobs.find(j => j.id === (o?.pendingTest?.jobId ?? o?.lastTest?.jobId))
        const what = t.kind === 'video'
          ? `Image to video, ${t.frames === 'start_end' ? 'start and end frame' : 'start frame'}, ${[t.resolution, `${t.duration_sec ?? 5} s`, t.aspect].filter(Boolean).join(', ')}, audio off`
          : t.kind === 'upscale' ? `Upscale${t.resolution ? ` to ${t.resolution}` : ''}` : `Still${t.refs ? ` with ${t.refs} reference images` : ''}`
        return {
          ref: t.model, label: base?.label ?? t.model, what, endpoint: base ? (effectiveModel(base, o).endpoint ?? '') : '',
          // Where the test runs: the API, or the owner's account for a model the API does not offer.
          path: base?.api === false ? 'account' as const : 'api' as const,
          testing: !!o?.pendingTest, lastTest: o?.lastTest ?? null,
          cost: job ? (job.actual != null ? formatUsd(job.actual) : null) : null, estimate: job ? formatUsd(job.estimate) : null,
        }
      }),
    },
    credentials: credentials.filter(c => !connectionIds.some(id => c.provider === `${id}_account`)),
    // Accounts on the owner's own plan, over MCP (one connection flow).
    connections: Object.entries(deps.config.runtime.mcp_connections).map(([id, c]) => {
      const cred = credentials.find(x => x.provider === `${id}_account`)
      return { id, label: c.label, site: c.site, status: c.status, note: c.note ?? '', connected: !!cred, verifyStatus: cred?.verifyStatus ?? null, connectedAt: cred?.createdAt ?? null }
    }),
    // Which Higgsfield balance pays: the REST API (USD) or the owner's own
    // account (plan credits). Models with no account path always use the API.
    billing: {
      ...(await readBilling(deps.db, ctx.accountId)),
      accountConnected: !!account,
      accountStatus: account?.verifyStatus ?? null,
      accountModels: deps.config.models.models.filter(m => m.ref.startsWith('higgsfield/') && m.mcp_id && m.mcp).map(m => m.ref),
    },
    providers: [
      {
        id: 'higgsfield', label: 'Higgsfield', hint: 'KEY_ID:KEY_SECRET from the Higgsfield Console (API keys, pay-per-use). Not your web login.', placeholder: 'kid_xxx:secret_xxx', usedFor: 'Images and video',
        // The owner's account can run on the server key (HF_CREDENTIALS).
        serverKey: !!(await serverKeyFor(deps.db, { ownerEmail: deps.env.STUDIO_OWNER_EMAIL || 'owner@studio.local', higgsfield: deps.env.HF_CREDENTIALS }, ctx.accountId, 'higgsfield')),
      },
      { id: 'anthropic', label: 'Anthropic', hint: 'An API key from the Anthropic Console.', placeholder: 'sk-ant-...', usedFor: 'Breakdowns, concepts and QA' },
    ],
    budgets: {
      job: microsToUsd(b.jobCapMicros), character: microsToUsd(b.characterCapMicros), month: microsToUsd(b.monthCapMicros),
      confirmAbove: microsToUsd(b.confirmAboveMicros), warnPct: b.warnPct,
    },
    routing: await Promise.all(tasks.map(async t => ({ task: t, configured: deps.config.routing.tasks[t]!.model, effective: (await resolveRoute(deps, ctx, t)).model }))),
    models: deps.config.models.models.filter(m => !m.ref.startsWith('mock/')).map(m => {
      const e = effectiveModel(m, overrides[m.ref])
      const o = overrides[m.ref]
      return {
        ref: m.ref, label: m.label, kinds: m.kinds, verified: e.confirmed, notes: m.notes ?? '', api: m.api, reference: m.reference ?? null,
        endpoint: e.endpoint ?? '', endpointSource: e.endpointSource, confirmedAt: e.confirmed ? (o?.confirmedAt ?? null) : null,
        lastTest: o?.lastTest ?? null, testing: !!o?.pendingTest,
      }
    }),
    prices: deps.config.pricebook.entries.filter(e => e.provider !== 'mock').map(e => ({
      model: `${e.provider}/${e.model}`, unit: e.unit, price: formatUsd(Math.round(e.price * 1_000_000)), verified: e.verified, source: e.source ?? '',
      when: e.when ? Object.values(e.when).join(', ') : '', credits: e.credits ?? null,
    })),
    priceVersion: deps.config.pricebook.version,
  }
}
