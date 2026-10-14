import { isVideoOp } from '../core/clips.js'
import type { Ctx, Deps } from '../context.js'
import { validateCharacter } from '../core/character.js'
import { hardWrap } from '../core/text.js'
import { listCredentials } from '../providers/credentials.js'
import { effectiveBudgets } from '../costs/budgets.js'
import { formatUsd, microsToUsd } from '../costs/money.js'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { jobs } from '../db/schema.js'
import { getAsset } from '../storage/assets.js'
import { approvedAssets, candidatesFor, getCharacter, inspirationAssetIds, listConcepts, sheetState, toData, type CharacterRow } from '../pipeline/characters.js'
import { characterCosts } from '../pipeline/costs.js'
import { claudeModels, liveRoute, providerMode, resolveRoute } from '../pipeline/settings.js'
import { effectiveModel, readModelOverrides } from '../providers/modelOverrides.js'
import { readBilling } from '../providers/billing.js'
import { serverKeyFor } from '../providers/serverKeys.js'
import { identityForModel } from '../core/identity.js'
import { checkSceneFields, sceneFieldsSchema, templateBody } from '../core/scenes.js'
import { scenePrompts } from '../core/promptWriter.js'
import { realismBlock } from '../core/realism.js'
import { modelLabel } from '../costs/quotes.js'
import { comboEntries, comboProblem, draftFields, effectiveFields, listScenes, sceneAspect, sceneCandidates, sceneRefs, videoModel } from '../pipeline/scenes.js'
import { ruleSwitches } from '../pipeline/rules.js'
import { comboPreview, stillBasis } from '../pipeline/sceneActions.js'

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
        id: 'higgsfield', label: 'Higgsfield', hint: 'KEY_ID:KEY_SECRET from the Higgsfield Console (API keys, pay-per-use). Not your web login.', placeholder: 'e.g. kid_xxx:secret_xxx', usedFor: 'Images and video',
        // The owner's account can run on the server key (HF_CREDENTIALS).
        serverKey: !!(await serverKeyFor(deps.db, { ownerEmail: deps.env.STUDIO_OWNER_EMAIL || 'owner@studio.local', higgsfield: deps.env.HF_CREDENTIALS }, ctx.accountId, 'higgsfield')),
      },
      { id: 'anthropic', label: 'Anthropic', hint: 'An API key from the Anthropic Console.', placeholder: 'e.g. sk-ant-...', usedFor: 'Scene planner, Punch it up, concepts and Check this' },
      {
        id: 'elevenlabs', label: 'ElevenLabs', hint: 'An API key from ElevenLabs (Developers, API keys) with speech to speech and speech to text.', placeholder: 'e.g. sk_...', usedFor: 'Voice lines (your takes in the character\'s voice, with word timings)',
        // The owner's account can run on the server key (ELEVENLABS_API_KEY).
        serverKey: !!(await serverKeyFor(deps.db, { ownerEmail: deps.env.STUDIO_OWNER_EMAIL || 'owner@studio.local', elevenlabs: deps.env.ELEVENLABS_API_KEY }, ctx.accountId, 'elevenlabs')),
      },
    ],
    budgets: {
      job: microsToUsd(b.jobCapMicros), character: microsToUsd(b.characterCapMicros), month: microsToUsd(b.monthCapMicros),
      confirmAbove: microsToUsd(b.confirmAboveMicros), warnPct: b.warnPct,
    },
    routing: await Promise.all(tasks.map(async t => ({ task: t, configured: deps.config.routing.tasks[t]!.model, effective: (await resolveRoute(deps, ctx, t)).model }))),
    claude: await claudeModels(deps, ctx),
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

// ── Scenes (Stage 7 and 8) ───────────────────────────────────────────

// Fills pronoun placeholders and leaves the rest (an edit preset's {thing}).
const withPronouns = (text: string, p: { subj: string; obj: string; poss: string }) =>
  text.replace(/\{(subj|obj|poss)\}/g, (_, k: 'subj' | 'obj' | 'poss') => p[k])

export async function scenesView(deps: Deps, ctx: Ctx, characterId: string) {
  const row = await getCharacter(deps, ctx, characterId)
  const ch = toData(row)
  const { scenes: sc, views } = deps.config.pipeline
  const sw = await ruleSwitches(deps, ctx, characterId)
  const list = await listScenes(deps, ctx, characterId)
  const cands = await sceneCandidates(deps, ctx, list.map(s => s.id))
  const active = await deps.db.select({ purpose: jobs.purpose }).from(jobs)
    .where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.characterId, characterId), inArray(jobs.status, ['waiting', 'queued', 'submitting', 'running', 'ingesting'])))
  const busy = new Set(active.map(j => j.purpose.split(':')[1]))
  const connected = (await listCredentials(deps.db, ctx.accountId)).some(c => c.provider === 'higgsfield_account')
  // The path a model runs on: the account when the API does not offer it, or
  // when the account's Higgsfield billing is set to plan credits.
  const onAccount = (await readBilling(deps.db, ctx.accountId)).default === 'account'
  const modelInfo = (ref: string) => {
    const m = deps.config.models.models.find(x => x.ref === ref)!
    const account = m.api === false || (onAccount && ref.startsWith('higgsfield/') && !!m.mcp_id)
    return { ref, label: m.label, path: account ? 'account' as const : 'api' as const, refs: m.max_refs, trained: !!identityForModel(ch.identities, ref), note: m.notes ?? '' }
  }
  const preferred = [ch.preferredModels.scene_still, ch.preferredModels.scene_still_alt].filter((r): r is string => !!r && sc.settings.still_models.includes(r))
  const stillModels = [...new Set([...preferred, ...sc.settings.still_models])].map(modelInfo)
  const editModels = sc.settings.edit_models.map(modelInfo)
  const shape = (c: (typeof cands)[number]) => ({
    id: c.id, assetId: c.assetId, status: c.status, prompt: c.prompt, op: c.op, parentId: c.parentId, sceneId: c.sceneId,
    media: isVideoOp(c.op) ? 'video' as const : 'image' as const,
    qaVerdict: c.qaVerdict, qaReport: c.qaReport, rejectReasons: c.rejectReasons, rejectNote: c.rejectNote,
    favorite: c.favorite, createdAt: c.createdAt.toISOString(), refId: null, heroPromptIndex: null,
  })
  const scenes = []
  for (const s of list) {
    const raw = draftFields(s)
    const f = effectiveFields(deps, s)
    const parsed = sceneFieldsSchema.safeParse(f)
    const issues = parsed.success ? checkSceneFields(sc, views, parsed.data) : []
    const missing = parsed.success ? issues.map(i => i.field) : [...new Set(parsed.error.issues.map(i => String(i.path[0])))]
    const complete = parsed.success && !issues.length
    scenes.push({
      id: s.id, title: s.title, brief: s.brief, fields: f, planned: Object.keys(raw).some(k => k !== 'title' && k !== 'refs' && k !== 'brands'), status: busy.has(s.id) ? 'generating' : s.status, busy: busy.has(s.id),
      createdAt: s.createdAt.toISOString(), comboLogged: !!s.comboLoggedAt, aspect: sceneAspect(deps, f), complete, missing,
      combo: complete ? comboPreview(deps, parsed.data) : null,
      // A small note, only when the owner switched the variety note on.
      comboProblem: complete && !s.comboLoggedAt && sw.on('scene-combo-log') ? comboProblem(deps, ch, parsed.data) : null,
      refs: await sceneRefs(deps, ctx, characterId, { view: f.view ?? 'front', framing: f.framing ?? 'waist_up', expression: f.expression ?? 'neutral', refs: f.refs ?? [] }, sw.on('scene-refs-by-angle')),
      refsChosen: (f.refs ?? []).length > 0,
      candidates: cands.filter(c => c.sceneId === s.id).map(shape),
      // The written prompts (prompt writer), with whether the details
      // changed after the still prompt was written.
      prompts: (() => {
        const w = scenePrompts(s.prompts)
        const stale = !!(w.still?.basis && complete && w.still.basis !== stillBasis(deps, ch, parsed.data))
        return { still: w.still ? { ...w.still, stale } : null, video: w.video ? { ...w.video, stale: false } : null }
      })(),
      // What "Use the template" puts in the prompt box.
      templateText: complete ? templateBody(deps.config.pipeline.templates, sc, views, parsed.data, ch) : null,
    })
  }
  const p = ch.pronouns
  // Every approved sheet shot, for choosing a scene's refs by hand.
  const state = await sheetState(deps, ctx, characterId)
  const approvedMap = await approvedAssets(deps, ctx, characterId)
  const sheetRefs = state.shots.filter(shot => approvedMap.has(shot.id)).map(shot => ({ refId: shot.id, label: shot.label, assetId: approvedMap.get(shot.id)! }))
  return {
    scenes,
    sheetRefs,
    combos: comboEntries(ch).slice(-sc.settings.combo_window),
    reasons: deps.config.pipeline.review.reasons.filter(r => r.id !== 'makeup' && r.id !== 'talking').map(r => ({ id: r.id, label: r.label })),
    options: {
      moments: sc.moments, cameras: sc.cameras.map(x => ({ id: x.id, label: x.label })), lights: sc.lights.map(x => ({ id: x.id, label: x.label })),
      framings: sc.framings.map(x => ({ id: x.id, label: x.label })), expressions: sc.expressions.map(x => ({ id: x.id, label: x.label })),
      heights: sc.heights.map(x => ({ id: x.id, label: x.label })),
      autoQa: sw.on('scene-auto-qa'), maxRefs: sc.settings.max_refs,
      signatureJewelry: ch.marks.filter(m => m.kind === 'jewelry').map(m => `${m.description} (${m.side} ${m.region})`),
      makeup: sc.makeup, destinations: sc.destinations,
      views: Object.entries(views.views).map(([id, v]) => ({ id, label: v.label })),
      editPresets: sc.edits.presets.map(e => ({ id: e.id, label: e.label, text: withPronouns(e.text, p), face: e.face, group: e.group, hint: e.hint ?? '' })),
      diagnose: sc.diagnose,
      stillModels, editModels, defaultModels: stillModels.slice(0, 1).map(m => m.ref),
      maxVariations: sc.settings.max_variations, maxModels: sc.settings.max_models,
      accountConnected: connected, mode: await providerMode(deps.db, ctx.accountId),
      // The prompt writer (default rule scene-prompt-writer), its model as
      // it runs live, its word ranges, and the REALISM block it always gets.
      promptWriter: {
        on: sw.on('scene-prompt-writer'), model: modelLabel(deps, (await liveRoute(deps, ctx, 'prompt_writer')).model),
        directorsPass: sw.on('scene-directors-pass'),
        words: sc.settings.prompt_words, realism: realismBlock(ch.realism?.block),
      },
      // Video defaults (Stage 9), all editable on the video card. The model
      // is the account's last pick (Kling 3.0 Pro until one is made).
      video: {
        model: modelInfo(await videoModel(deps, ctx)),
        models: sc.video.models.map(m => ({ ...modelInfo(m.ref), resolution: m.resolution ?? null })), durations: sc.video.durations, duration: sc.video.duration, aspect: sc.video.aspect,
        maxTakes: sc.video.max_takes, takes: sc.video.takes, directions: sc.video.directions,
        test: { model: modelInfo(sc.video.test.model), duration: sc.video.test.duration, label: sc.video.test.label, note: sc.video.test.note },
        upscale: modelInfo(sc.video.upscale.model),
        endFrame: { model: modelInfo(sc.video.end_frame.model), presets: sc.video.end_frame.presets.map(e => ({ id: e.id, label: e.label, text: capitalize(withPronouns(e.text, p)) })) },
      },
    },
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
