import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { candidates, contentItems, hooks as hookRows, slideScenes } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerJobHook, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { activateChildren, cancelChildren, cancelWaiting, childJobs, type JobSpec } from '../jobs/runner.js'
import { fill, hardWrap } from '../core/text.js'
import { pronounVars } from '../core/prompts.js'
import { lintPrompt, type RuleViolation } from '../core/rules.js'
import { realismBlock, realismBlockers, type RealismWarning } from '../core/realism.js'
import { EXPLICIT_MESSAGE, findExplicitTerms } from '../core/safety.js'
import { identityForModel } from '../core/identity.js'
import { buildScenePrompt, sceneFieldsSchema, type ReferenceMode, type SceneFields } from '../core/scenes.js'
import { catalogWording } from '../core/wording.js'
import { cleanVoiceCard, voiceCardText } from '../core/voiceCard.js'
import { claimsText, languageText } from '../core/scriptKit.js'
import {
  CTA_IDS, DRAWN_SPECIAL_IDS, PATTERN_IDS, backdropFor, cleanSpecial, emptySpecial, fullSpecial, ctaText, guessPattern, isListPattern, postCaption, reorderMiddle, setAt, slideList, trimWords, vaultHooks,
  type HookIdea, type HookPattern, type SpecialSlide,
} from '../core/slides.js'
import { slideshowSpecSchema, type SceneLock, type SlideshowSpec } from '../core/slideshowSpec.js'
import { postExportJson } from '../core/postExport.js'
import { EFFECT_CODES, STRUCTURE_CODES, codeLabel, effectLabel, readCode, readEffect, type EffectCode, type StructureCode } from '../core/playbook.js'
import type { PlanMeta } from '../core/planMeta.js'
import { accountStructures } from './playbook.js'
import { renderSlide, fontDraw } from '../media/slideRender.js'
import type { GenRequest } from '../providers/types.js'
import { estimateGen } from '../costs/pricebook.js'
import { listCredentials } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { getCharacter, toData, type CharacterRow } from './characters.js'
import { effectiveFields, fieldOptions, getScene, sceneRefs } from './scenes.js'
import { runModel, stillLevelFor, withModelLines } from './sceneActions.js'
import { localStillChecks } from './sceneHooks.js'
import { ruleSwitches } from './rules.js'
import { getSetting, providerMode, resolveRoute, setSetting } from './settings.js'
import { apiKeyReady, type StillChoice } from './clone.js'
import { claimsOf, languageOf, listProducts } from './scaleKit.js'
import { candidateAsset, getContent, postScene, updateContent, type ContentOutputs, type ContentRow } from './content.js'

// The slideshow power-up (owner, 2026-10-16; UX-PLAN.md section 27): hooks
// (from the vault for free, or written by Claude), every slide drafted
// from one hook, stills made in one locked scene (the character, or a
// topic with no one in it), one slide rerolled, the Scene library, special
// slides, text styles burned into the export, both sizes and post.json,
// variations in a family, and a batch from pasted hooks with one review.
// Every paid step is an action with its price shown first; the rest is
// free and runs here or on the worker.

type Built = { purpose: string; characterId: string | null; specs: JobSpec[]; preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: RuleViolation[]; invalidates: string[] } }
type Ch = ReturnType<typeof toData>

// A still released because its slide became a special slide: not a failure
// (the run list shows it as "not needed").
export const NOT_NEEDED = 'Not needed:'
const warn = (ruleId: string, title: string, message: string): RuleViolation => ({ ruleId, spec: '27', title, severity: 'warning', message })
const parse = (row: ContentRow): SlideshowSpec => slideshowSpecSchema.parse(row.spec ?? {})
const cfgOf = (deps: Deps) => deps.config.pipeline.content.slideshow
const LONG_DASH = new RegExp(`\\s*${String.fromCharCode(8212)}\\s*`, 'g')
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(LONG_DASH, ', ').replace(/^["“]+|["”]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const tags = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map(h => String(h).replace(/^#+/, '').replace(/\s+/g, '').toLowerCase().slice(0, 60)).filter(h => h && h !== 'ad').slice(0, max)

async function slideshowPost(deps: Deps, ctx: Ctx, contentId: string): Promise<{ row: ContentRow; spec: SlideshowSpec }> {
  const row = await getContent(deps, ctx, contentId)
  if (row.kind !== 'slideshow') throw new AppError('bad_request', 'Pick a slideshow.')
  if (!row.characterId) throw new AppError('bad_request', 'Pick the character for this slideshow first (Idea step).')
  return { row, spec: parse(row) }
}

// ── What the writers are told: the voice, the vault, the buyers' words ──

async function kitFor(deps: Deps, ctx: Ctx, productId: string | null) {
  const list = await listProducts(deps, ctx)
  const product = list.find(p => p.id === productId) ?? list[0] ?? null
  if (!product) return { product: null, vault: [] as Array<{ text: string; kind: string }>, phrases: [] as string[], claims: '', language: '' }
  const vault = await deps.db.select({ text: hookRows.text, kind: hookRows.kind }).from(hookRows)
    .where(and(eq(hookRows.accountId, ctx.accountId), eq(hookRows.productId, product.id), isNull(hookRows.archivedAt))).orderBy(asc(hookRows.number))
  const language = languageOf(product)
  return {
    product, vault,
    phrases: language.groups.flatMap(g => g.items),
    claims: claimsText(product.name, claimsOf(product)),
    language: languageText(language) || '',
  }
}

const voiceOf = (ch: Ch) => voiceCardText(ch.name, cleanVoiceCard(ch.persona.voice))
const topicOf = (row: ContentRow, s: SlideshowSpec) => row.idea.trim() || s.topic.trim() || s.hook.trim()

// ── Hooks: from the vault (free) or written by Claude (priced) ─────────

// "10 from the vault": the vault's hooks and the buyers' words recast into
// the patterns, by code. Another press shows the next ones.
export async function vaultHookIdeas(deps: Deps, ctx: Ctx, contentId: string, input: { offset?: number; patterns?: HookPattern[] } = {}): Promise<ContentRow> {
  const { row, spec } = await slideshowPost(deps, ctx, contentId)
  const kit = await kitFor(deps, ctx, spec.productId)
  const ideas = vaultHooks({ vault: kit.vault, phrases: kit.phrases, topic: topicOf(row, spec) || 'my job search', n: cfgOf(deps).hooks, offset: input.offset ?? 0, patterns: input.patterns })
  return updateContent(deps, ctx, row.id, { spec: { hookIdeas: ideas, hookReview: null, ...(kit.product && !spec.productId ? { productId: kit.product.id } : {}) } })
}

// Who the words are for: the character, or a faceless topic account (a
// feeder: nothing of the character it is filed under goes in).
function writerFor(ch: Ch, row: ContentRow, spec: SlideshowSpec) {
  if (spec.mode === 'topic') {
    const acct = row.accountTag ? ` (${row.accountTag})` : ''
    return { who: `a faceless topic account${acct}: no person in the photos, only places, things and mock screens`, voice: '', name: '', captionVoice: 'plain words, no emoji or one', photos: 'The photos show no one: places, things and mock screens only.' }
  }
  return { who: `${ch.name}, an original, fictional adult character`, voice: voiceOf(ch), name: ch.name, captionVoice: `the way ${ch.name} talks (the voice card), emoji as the voice card says`, photos: `The photos show ${ch.name}.` }
}

// The account's structures for the writer: the primary for about a third
// of the candidates, the backup for about a fifth, never the last code.
export function structuresLine(st: { primary: string | null; backup: string | null; last: string | null }): string {
  const parts = [
    st.primary ? `the primary is ${codeLabel(st.primary)}: use it for about a third of the candidates.` : '',
    st.backup ? `The backup is ${codeLabel(st.backup)}: about a fifth.` : '',
    st.primary || st.backup ? 'Spread the rest over at least 3 other codes.' : 'No primary or backup is set: use at least 5 different codes.',
    st.last ? `Never use ${codeLabel(st.last)}: the account's last post used it.` : '',
  ]
  return parts.filter(Boolean).join(' ')
}

export const hooksJsonSchema = (n: number) => ({
  type: 'object', additionalProperties: false, required: ['hooks'],
  properties: {
    hooks: {
      type: 'array', minItems: n, maxItems: n,
      items: {
        type: 'object', additionalProperties: false, required: ['effect_open', 'effect_payoff', 'moment', 'code', 'pain', 'hook', 'alt_hook', 'rank'],
        properties: {
          effect_open: { type: 'string', enum: [...EFFECT_CODES] }, effect_payoff: { type: 'string', enum: [...EFFECT_CODES] },
          moment: { type: 'string' }, code: { type: 'string', enum: [...STRUCTURE_CODES] }, pain: { type: 'integer', minimum: 1, maximum: 10 },
          hook: { type: 'string' }, alt_hook: { type: 'string' }, rank: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
  },
})
export const reviewJsonSchema = (n: number) => ({
  type: 'object', additionalProperties: false, required: ['reviews'],
  properties: { reviews: { type: 'array', minItems: n, maxItems: n, items: { type: 'object', additionalProperties: false, required: ['n', 'stops', 'clear', 'pain', 'score', 'note'], properties: { n: { type: 'integer', minimum: 1, maximum: n }, stops: { type: 'boolean' }, clear: { type: 'boolean' }, pain: { type: 'integer', minimum: 1, maximum: 10 }, score: { type: 'integer', minimum: 1, maximum: 5 }, note: { type: 'string' } } } } },
})

interface HookOut { effect_open?: unknown; effect_payoff?: unknown; moment?: unknown; code?: unknown; pain?: unknown; hook?: unknown; alt_hook?: unknown; rank?: unknown }

// A free stand-in for demo mode and tests: hooks written to THE STANDARD
// (the pain plainly, in the group-chat voice, 15 words or fewer) with
// codes (the account's primary and backup first, never its last), effects,
// a moment, a pain score and an alt hook each.
const MOCK_HOOKS: Array<[string, string]> = [
  ['man, 300 apps since grad and not one human email back. is it me fam?', 'ok so 300 applications and the only reply was a newsletter'],
  ['uggh the portal wants my whole resume typed out again. on page 4 of 6', 'why does every portal make me retype the resume i just uploaded'],
  ['ok so they said talk friday. it has been six fridays', 'they said talk friday. i have stopped counting fridays'],
  ['applied before midnight and got rejected before i woke up. who is up doing this', 'rejected while i was asleep. somebody was up at 2am for this'],
  ['entry level role wants 5 years. i graduated in may. be so for real', 'entry level but make it 5 years. i am 23'],
  ['round 5 interview for a job that pays less than my last one. why', 'five rounds for less money than my old job. fam what'],
  ['rent is due in 9 days. recruiter said end of week three weeks ago', 'rent in 9 days. recruiter in three weeks. same energy'],
  ['rewrote my resume 40 times and still no callback. is it the font??', 'resume version 40 and still nothing. losing my mind fr'],
  ['they ghosted me after the final round then reposted the job. cool cool cool', 'final round, then silence, then the same job reposted'],
  ['a free 6 hour take-home for one interview. is this normal or am i cooked', 'six unpaid hours on a take-home. is this a job or a hobby'],
]
export function mockHooks(n: number, _vault: string[], topic: string, st: { primary: string | null; backup: string | null; last: string | null }): { hooks: Array<Required<{ [K in keyof HookOut]: string | number }>> } {
  const pool = [st.primary, st.primary, st.primary, st.backup, st.backup, ...STRUCTURE_CODES].filter((c): c is StructureCode => !!c && c !== st.last)
  const codes: StructureCode[] = []
  for (const c of pool) if (codes.length < n && (codes.filter(x => x === c).length < (c === st.primary ? 3 : c === st.backup ? 2 : 1))) codes.push(c)
  return {
    hooks: Array.from({ length: n }, (_, i) => {
      const [hook, alt] = MOCK_HOOKS[i % MOCK_HOOKS.length]!
      return {
        effect_open: EFFECT_CODES[i % 3]!, effect_payoff: (['E4', 'E6', 'E7'] as const)[i % 3]!,
        moment: `${['Sunday 9:40pm', 'Tuesday 2:14am', 'Friday 4pm'][i % 3]}, ${topic || 'the job search'}: the tell is on the screen`,
        code: codes[i % Math.max(1, codes.length)] ?? 'S7', pain: 7 + (i % 3), hook, alt_hook: alt, rank: i % 3 === 2 ? 2 : 1,
      }
    }),
  }
}
// The reviewer's stand-in: the stop test, then the ladder. Most are a 1
// or 2; the rest score 3 to 5 or fail the stop test (hook 7 is a 2 on the
// ladder with pain 6, so the stop test hides it) and are hidden.
const MOCK_SCORES = [1, 2, 2, 3, 1, 4, 2, 3, 1, 2]
const MOCK_NOTES = ['A stranger stops on the first words; the turn waits for slide 2.', 'The pain is plain and clear on one read; the loop could pull harder.', 'Clear, but it closes its own loop.', 'Needs the photo to land.']
export const mockReview = (n: number) => ({
  reviews: Array.from({ length: n }, (_, i) => {
    const score = MOCK_SCORES[i % 10]!
    const pain = i % 10 === 6 ? 6 : score <= 2 ? 8 : 6
    return { n: i + 1, stops: score <= 3, clear: score !== 4, pain, score, note: i % 10 === 6 ? 'A real tell, but the pain is a 6: a stranger scrolls past.' : MOCK_NOTES[score - 1]! }
  }),
})

async function hookWriterVars(deps: Deps, ctx: Ctx, row: ContentRow, spec: SlideshowSpec) {
  const ch = toData(await getCharacter(deps, ctx, row.characterId!))
  const kit = await kitFor(deps, ctx, spec.productId)
  const st = await accountStructures(deps, ctx, row.accountTag, { postId: row.id, characterId: row.characterId })
  const w = writerFor(ch, row, spec)
  const topic = topicOf(row, spec) || 'the job search'
  return {
    ch, kit, st, w, topic,
    vars: {
      ...pronounVars(ch.pronouns), name: w.name || 'the account', who: w.who, count: String(cfgOf(deps).hooks), topic, account: row.accountTag || 'not given', voice: w.voice,
      structures: structuresLine(st), tension: spec.plan.tension ? `Tension (a tag, never the subject): ${spec.plan.tension}` : '',
      vault: kit.vault.length ? kit.vault.slice(0, 30).map(h => `- ${h.text}${h.kind ? ` (${h.kind})` : ''}`).join('\n') : 'None yet.',
      language: kit.language || 'No buyer language collected yet.', claims: kit.claims || '', ...standardVars(deps),
    },
  }
}

// THE STANDARD for slide 1, the ladder and the playbook's menu (with the
// ladder in it), for every hook writer and the reviewer.
export function standardVars(deps: Deps) {
  const t = deps.config.pipeline.templates
  const ladder = t.playbook_ladder.trim()
  return { standard: t.hook_standard.trim(), ladder, menu: fill(t.playbook_menu, { ladder }) }
}

// "Write 10 with Claude" (section 28): the writer, then a separate reviewer
// that scores every hook on the ladder (waiting for the writer, one price
// for both). Only the 1s and 2s are shown.
export async function buildSlideshowHooks(deps: Deps, ctx: Ctx, contentId: string): Promise<Built> {
  const { row, spec } = await slideshowPost(deps, ctx, contentId)
  const n = cfgOf(deps).hooks
  const t = deps.config.pipeline.templates.slideshow_hooks
  const rt = deps.config.pipeline.templates.slideshow_hooks_review
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const { kit, st, topic, vars } = await hookWriterVars(deps, ctx, row, spec)
  const system = fill(t.system, vars), prompt = fill(t.prompt, vars)
  const reviewPrompt = fill(rt.prompt, { claims: kit.claims || '', hooks: `(the ${n} hooks the writer returns, numbered 1 to ${n})` })
  const reviewSystem = fill(rt.system, standardVars(deps))
  const purpose = `slideshow_hooks:${row.id}`
  const mock = mockHooks(n, kit.vault.map(h => h.text), topic, st)
  return {
    purpose, characterId: row.characterId,
    preview: {
      title: `Write ${n} hooks, then a reviewer scores them`,
      prompts: [
        { label: 'Hook writer', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) },
        { label: 'Reviewer', text: `${reviewSystem}\n${reviewPrompt}`, wrapped: hardWrap(`${reviewSystem}\n${reviewPrompt}`) },
      ],
      warnings: [], invalidates: [],
    },
    specs: [
      { type: 'llm', stage: 'content', purpose, label: `${n} slideshow hooks`, request: { model: route.model, system, prompt, schema: hooksJsonSchema(n), schemaName: 'slideshow_hooks', maxTokens: 400 + 170 * n, effort: route.effort ?? 'low', meta: { itemId: row.id, mockHooks: mock } } },
      { type: 'llm', stage: 'content', purpose: `${purpose}:review`, label: `Review of ${n} hooks`, parentIndex: 0, request: { model: route.model, system: reviewSystem, prompt: reviewPrompt, schema: reviewJsonSchema(n), schemaName: 'slideshow_hooks_review', maxTokens: 300 + 90 * n, effort: route.effort ?? 'low', meta: { itemId: row.id, mockReview: mockReview(n) } } },
    ],
  }
}

const code = (v: unknown) => (STRUCTURE_CODES as readonly string[]).includes(String(v)) ? String(v) as StructureCode : readCode(String(v ?? ''))
const effect = (v: unknown) => (EFFECT_CODES as readonly string[]).includes(String(v)) ? String(v) as EffectCode : readEffect(String(v ?? ''))
const rank = (v: unknown) => { const x = Math.round(Number(v)); return x >= 1 && x <= 5 ? x : null }
const pain = (v: unknown) => { const x = Math.round(Number(v)); return x >= 1 && x <= 10 ? x : null }

async function onSlideshowHooks(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const [, postId, part] = job.purpose.split(':') as [string, string, string | undefined]
  if (part === 'review') return onHooksReviewed(deps, ctx, postId, out)
  if (out.status !== 'completed') { await cancelChildren(deps, job.id, 'The hooks were not written, so there was nothing to review. Nothing was charged for the review.'); return }
  const d = (out.data ?? {}) as { hooks?: HookOut[] }
  const ideas: HookIdea[] = (Array.isArray(d.hooks) ? d.hooks : []).map(h => {
    // Never cut mid-line: a hook over 15 words keeps its words and gets
    // the lint's note (a hard cap only against a runaway answer).
    const text = trimWords(clean(h.hook, 200), 30)
    return {
      text, pattern: guessPattern(text), source: 'claude' as const,
      code: code(h.code), effectOpen: effect(h.effect_open), effectPayoff: effect(h.effect_payoff),
      moment: clean(h.moment, 400), alt: trimWords(clean(h.alt_hook, 200), 30), selfScore: rank(h.rank), score: null, note: '', reviewed: false, pain: pain(h.pain), stops: null,
    }
  }).filter(h => h.text.length >= 3)
  if (!ideas.length) { await cancelChildren(deps, job.id, 'No hooks came back, so there was nothing to review. Nothing was charged for the review.'); return }
  await updateContent(deps, ctx, postId, { spec: { hookIdeas: ideas, hookReview: 'pending' } })
  const post = await getContent(deps, ctx, postId).catch(() => null)
  const kit = post ? await kitFor(deps, ctx, parse(post).productId) : null
  const listed = ideas.map((h, i) => `${i + 1}. Moment: ${h.moment || 'not given'}. Code: ${h.code ? codeLabel(h.code) : 'not given'}. Hook: ${h.text}`).join('\n')
  await activateChildren(deps, job.id, c => ({
    prompt: fill(deps.config.pipeline.templates.slideshow_hooks_review.prompt, { claims: kit?.claims ?? '', hooks: listed }),
    schema: reviewJsonSchema(ideas.length),
    meta: { ...((c.request as { meta?: Record<string, unknown> }).meta ?? {}), mockReview: mockReview(ideas.length) },
  }))
}

// The reviewer's scores land on the hooks; a failed review leaves the
// writer's own ranks (marked not reviewed).
async function onHooksReviewed(deps: Deps, ctx: Ctx, postId: string, out: JobOutcome): Promise<void> {
  const post = await getContent(deps, ctx, postId).catch(() => null)
  if (!post) return
  const spec = parse(post)
  if (out.status !== 'completed') { await updateContent(deps, ctx, postId, { spec: { hookReview: 'failed' } }); return }
  const d = (out.data ?? {}) as { reviews?: Array<{ n?: unknown; stops?: unknown; clear?: unknown; pain?: unknown; score?: unknown; note?: unknown }> }
  const byN = new Map((Array.isArray(d.reviews) ? d.reviews : []).map(r => [Math.round(Number(r.n)), r]))
  const ideas = spec.hookIdeas.map((h, i) => {
    if (h.source !== 'claude') return h
    const r = byN.get(i + 1)
    if (!r) return h
    // The stop test first (THE STANDARD): a hook that would not stop a
    // stranger, is not clear on one read, or hurts under 7 is a 3 at best,
    // so it is hidden whatever its other marks.
    const p = pain(r.pain) ?? h.pain ?? null
    const stops = r.stops !== false && r.clear !== false && (p == null || p >= 7)
    const s = rank(r.score)
    return { ...h, score: s == null ? null : stops ? s : Math.max(3, s), note: clean(r.note, 300), reviewed: true, pain: p, stops }
  })
  await updateContent(deps, ctx, postId, { spec: { hookIdeas: ideas, hookReview: 'done' } })
}

// ── The draft: every slide from one hook (priced) ──────────────────────

const specialJson = {
  type: 'object', additionalProperties: false, required: ['type', 'from', 'title', 'body', 'lines', 'time'],
  properties: { type: { type: 'string', enum: ['none', ...DRAWN_SPECIAL_IDS] }, from: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, lines: { type: 'array', items: { type: 'string' } }, time: { type: 'string' } },
}

export function draftJsonSchema(n: number, tagsMax: number, lights: string[], cameras: string[] | null) {
  return {
    type: 'object', additionalProperties: false, required: ['slides', 'scene', 'caption', 'cta', 'hashtags'],
    properties: {
      slides: { type: 'array', minItems: n, maxItems: n, items: { type: 'object', additionalProperties: false, required: ['text', 'shot', 'special'], properties: { text: { type: 'string' }, shot: { type: 'string' }, special: specialJson } } },
      scene: {
        type: 'object', additionalProperties: false, required: ['place', 'light', 'camera', 'outfit', 'details'],
        properties: { place: { type: 'string' }, light: { type: 'string', enum: lights }, camera: cameras ? { type: 'string', enum: cameras } : { type: 'string' }, outfit: { type: 'string' }, details: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } },
      },
      caption: { type: 'string' },
      cta: { type: 'string' },
      hashtags: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: tagsMax },
    },
  }
}

interface DraftOut {
  slides?: Array<{ text?: unknown; shot?: unknown; special?: { type?: unknown; from?: unknown; title?: unknown; body?: unknown; lines?: unknown; time?: unknown } }>
  scene?: { place?: unknown; light?: unknown; camera?: unknown; outfit?: unknown; details?: unknown }
  caption?: unknown
  cta?: unknown
  hashtags?: unknown
}

// A free stand-in for demo mode and tests: the hook, slides that each open
// the next, the payoff last, one special slide, and a home-office scene.
export function mockDraft(hook: string, n: number, mode: 'character' | 'topic'): Required<DraftOut> {
  const base = ['It started with one email at 2:14am', 'The subject line said "Quick question!"', 'The question was on page 4 of 6', 'Page 4 wanted the resume from page 1', 'So I typed it again, line by line', 'Then the CAPTCHA asked if I was human', 'Honestly? Some days, unclear']
  const shots = mode === 'topic'
    ? ['the desk with the laptop open', 'a coffee mug beside the keyboard', 'the window view at lunch', 'a notepad with a to-do list', 'the monitor glowing at dusk', 'the empty chair at the end of the day', 'the hallway by the elevators', 'a phone face down on the desk', 'the door on the way out']
    : ['looking at the laptop with a coffee mug', 'leaning back in the chair, thinking', 'reading something on the phone', 'writing a list on a notepad', 'smiling at the screen', 'packing the laptop into a tote bag', 'standing by the window', 'checking the phone again', 'walking out the door']
  const slides = Array.from({ length: n }, (_, i) => ({
    text: i === 0 ? hook : i === n - 1 ? 'Which page broke you? Asking for page 4' : base[(i - 1) % base.length]!,
    shot: shots[i % shots.length]!,
    special: i === 2 && n >= 4 ? { type: 'notification', from: 'Mail', title: 'Hiring Team', body: 'We would love to set up a call this week.', lines: [], time: 'now' } : { type: 'none', from: '', title: '', body: '', lines: [], time: '' },
  }))
  return {
    slides,
    scene: { place: 'a small home office by a window', light: 'window', camera: mode === 'topic' ? 'phone held at chest height' : 'friend_phone', outfit: mode === 'topic' ? '' : 'a gray cotton crewneck sweater', details: ['a mug of coffee', 'a sticky note on the monitor'] },
    caption: `Not me thinking this would take a week. ${hook.replace(/[.!?]*$/, '.')}`,
    cta: 'Which page broke you?',
    hashtags: ['jobsearch', 'careertok', 'storytime'],
  }
}

// What the writer is given about the hook (from a hook card, or none).
export interface HookInfo { hook: string; pattern: HookPattern | null; code?: StructureCode | null; effectOpen?: EffectCode | null; effectPayoff?: EffectCode | null; moment?: string; alt?: string; score?: number | null }

async function draftRequest(deps: Deps, ctx: Ctx, row: ContentRow, spec: SlideshowSpec, h: HookInfo, n: number) {
  const ch = toData(await getCharacter(deps, ctx, row.characterId!))
  const kit = await kitFor(deps, ctx, spec.productId)
  const sc = deps.config.pipeline.scenes
  const t = deps.config.pipeline.templates.slideshow_draft
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const topicMode = spec.mode === 'topic'
  const lights = sc.lights.filter(l => l.id !== 'as_written').map(l => l.id)
  const cameras = topicMode ? null : sc.cameras.map(c => c.id)
  const pv = pronounVars(ch.pronouns)
  const w = writerFor(ch, row, spec)
  const lock = spec.lock
  const given = [lock.place && `place: ${lock.place}`, lock.light && `light: ${lock.light}`, lock.camera && `camera: ${lock.camera}`, !topicMode && lock.outfit && `outfit: ${lock.outfit}`, lock.details.length && `details: ${lock.details.join('; ')}`].filter(Boolean)
  const product = kit.product?.name ?? ''
  const isProduct = spec.ad || spec.plan.product
  const structure = h.code
    ? `Pour it into ${codeLabel(h.code)}.${h.effectOpen ? ` The viewer feels ${effectLabel(h.effectOpen)} on slide 1` : ''}${h.effectPayoff ? `${h.effectOpen ? ' and' : ' The viewer feels'} ${effectLabel(h.effectPayoff)} at the end` : ''}${h.effectOpen || h.effectPayoff ? '.' : ''}`
    : 'Pick the structure or lens that fits the hook (S1 to S12, L13 to L25).'
  const vars = {
    ...pv, name: w.name || 'the account', who: w.who, photos: w.photos, n: String(n), hook: h.hook, topic: topicOf(row, spec) || h.hook,
    structure, moment: h.moment ? `Moment: ${h.moment}` : '', specials: deps.config.pipeline.templates.slideshow_special_menu,
    lights: lights.join(', '), cameras: cameras ? `one of: ${cameras.join(', ')}` : 'a few words: how the phone is held',
    outfit_rule: topicMode ? 'leave it empty' : `what ${pv.subj} wears in every photo`, tags_max: String(cfgOf(deps).hashtags[1]),
    caption_voice: w.captionVoice, voice: w.voice,
    scene: given.length ? `The scene is set: ${given.join('; ')}. Keep it.` : '',
    product_rule: !product ? '' : isProduct
      ? `This is a product post: name ${product} once, on slide 5 or 6 only, inside its claims sheet (what it does, never a result for anyone), and start the caption with "Ad:" naming it.`
      : `This is not a product post: never name ${product}.`,
    language: kit.language, claims: kit.claims,
  }
  const system = fill(t.system, vars), prompt = fill(t.prompt, vars)
  return { system, prompt, route, schema: draftJsonSchema(n, cfgOf(deps).hashtags[1], lights, cameras), mock: mockDraft(h.hook, n, spec.mode) }
}

export async function buildSlideshowDraft(deps: Deps, ctx: Ctx, input: { contentId: string; hook: string; pattern?: HookPattern | null; code?: StructureCode | null; effectOpen?: EffectCode | null; effectPayoff?: EffectCode | null; moment?: string; alt?: string; score?: number | null }): Promise<Built> {
  const { row, spec } = await slideshowPost(deps, ctx, input.contentId)
  const hook = trimWords(clean(input.hook, 200), 16)
  if (hook.length < 3) throw new AppError('invalid_request', 'Write or pick the hook first.')
  const n = spec.slideCount
  const info: HookInfo = { hook, pattern: input.pattern ?? null, code: input.code ?? null, effectOpen: input.effectOpen ?? null, effectPayoff: input.effectPayoff ?? null, moment: clean(input.moment, 400), alt: clean(input.alt, 200), score: input.score ?? null }
  const r = await draftRequest(deps, ctx, row, spec, info, n)
  const purpose = `slide_draft:${row.id}:self`
  return {
    purpose, characterId: row.characterId,
    preview: { title: `Draft ${n} slides from the hook`, prompts: [{ label: 'Slideshow writer', text: `${r.system}\n${r.prompt}`, wrapped: hardWrap(`${r.system}\n${r.prompt}`) }], warnings: [], invalidates: [] },
    specs: [{ type: 'llm', stage: 'content', purpose, label: `Slideshow draft, ${n} slides`, request: { model: r.route.model, system: r.system, prompt: r.prompt, schema: r.schema, schemaName: 'slideshow_draft', maxTokens: 1000 + 220 * n, effort: r.route.effort ?? 'low', meta: { itemId: row.id, ...info, pattern: info.pattern ?? guessPattern(hook), n, mockDraft: r.mock } } }],
  }
}

// What a draft writes into a post: the slides (the hook word for word), each
// slide's shot (Claude's words in catalog terms), special slides (generic
// names only, never on slide 1, at most 2), the scene fields the owner did
// not set, the caption, the CTA line and at most 5 hashtags; and what the
// hook brought (its code, effects, moment, alt hook and score). The
// pictures already picked stay; dragged positions reset with the new words.
export function draftPatch(deps: Deps, spec: SlideshowSpec, d: DraftOut, meta: HookInfo & { n: number }): Partial<SlideshowSpec> {
  const cfg = cfgOf(deps)
  const wording = deps.config.pipeline.wording
  const catalog = (s: string) => catalogWording(s, wording).text
  const sc = deps.config.pipeline.scenes
  const raw = (Array.isArray(d.slides) ? d.slides : []).slice(0, 10)
  const n = Math.max(1, raw.length || meta.n)
  const texts = Array.from({ length: n }, (_, i) => (i === 0 ? meta.hook : trimWords(clean(raw[i]?.text, 300), 18)))
  const shots = Array.from({ length: n }, (_, i) => catalog(clean(raw[i]?.shot, 300)))
  let specialsLeft = 2
  const specials = Array.from({ length: n }, (_, i): SpecialSlide | null => {
    const sp = raw[i]?.special
    const type = String(sp?.type ?? 'none')
    if (i === 0 || !specialsLeft || !(DRAWN_SPECIAL_IDS as readonly string[]).includes(type)) return null
    specialsLeft--
    const lines = (Array.isArray(sp?.lines) ? sp!.lines as unknown[] : []).map(l => clean(l, 300)).filter(Boolean).slice(0, 10)
    return cleanSpecial(fullSpecial({ ...emptySpecial(type as SpecialSlide['type']), from: clean(sp?.from, 80), title: clean(sp?.title, 200), body: clean(sp?.body, 600), lines, time: clean(sp?.time, 40) }), cfg.brand_names, cfg.generic_names)
  })
  const own = new Set(spec.lock.ownerSet)
  const scene = d.scene ?? {}
  const light = String(scene.light ?? '')
  const camera = clean(scene.camera, 60)
  const lock: SceneLock = {
    ...spec.lock,
    place: own.has('place') ? spec.lock.place : catalog(clean(scene.place, 300)) || spec.lock.place,
    light: own.has('light') ? spec.lock.light : sc.lights.some(l => l.id === light) ? light : spec.lock.light,
    camera: own.has('camera') ? spec.lock.camera : spec.mode === 'topic' ? camera || spec.lock.camera : sc.cameras.some(c => c.id === camera) ? camera : spec.lock.camera,
    outfit: own.has('outfit') || spec.mode === 'topic' ? spec.lock.outfit : catalog(clean(scene.outfit, 300)) || spec.lock.outfit,
    details: own.has('details') ? spec.lock.details : (Array.isArray(scene.details) ? scene.details : []).map(x => catalog(clean(x, 160))).filter(Boolean).slice(0, 2),
  }
  const plan: PlanMeta = {
    ...spec.plan,
    ...(meta.code ? { structure: meta.code } : {}),
    ...(meta.effectOpen ? { effectOpen: meta.effectOpen } : {}),
    ...(meta.effectPayoff ? { effectPayoff: meta.effectPayoff } : {}),
    ...(meta.moment ? { moment: meta.moment } : {}),
    ...(meta.alt ? { altHook: meta.alt } : {}),
    ...(meta.score ? { hookScore: meta.score } : {}),
  }
  return {
    hook: texts[0]!, slides: texts.slice(1), shots, specials, textPos: [], lock,
    pattern: meta.pattern, slideCount: Math.min(10, Math.max(3, n)),
    stillIds: spec.stillIds.slice(0, n),
    caption: clean(d.caption, 2200), hashtags: tags(d.hashtags, cfg.hashtags[1]), ctaLine: clean(d.cta, 300),
    cta: { ...spec.cta, kind: 'own' },
    plan,
  }
}

// ── Stills: one locked scene, one still a slide (priced) ───────────────

const STILL_MODEL_KEY = 'slideshow_still_model'

// The stills model (like Recreate's): Nano Banana 2.1 on the Higgsfield
// plan, GPT Image 2.5 Flare on the Higgsfield API; the last pick kept, the
// plan when it is connected. One that cannot run says why.
export async function slideStillChoices(deps: Deps, ctx: Ctx): Promise<{ choices: StillChoice[]; pick: string }> {
  const cfg = cfgOf(deps)
  const live = (await providerMode(deps.db, ctx.accountId)) === 'live'
  const plan = (await listCredentials(deps.db, ctx.accountId)).some(c => c.provider === ACCOUNT_PROVIDER)
  const api = !live || await apiKeyReady(deps, ctx)
  const label = (ref: string) => deps.config.models.models.find(m => m.ref === ref)?.label ?? ref
  const choices: StillChoice[] = [
    { ref: cfg.still_model, label: label(cfg.still_model), path: 'account', pathLabel: 'Your Higgsfield plan', problem: !live || plan ? null : 'Runs only on your Higgsfield plan (the API does not offer it): connect it in Settings > Connected accounts.', note: null },
    { ref: cfg.api_still_model, label: label(cfg.api_still_model), path: 'api', pathLabel: 'Higgsfield API', problem: api ? null : 'Needs your Higgsfield API key: Settings > Connected accounts.', note: null },
  ]
  const saved = await getSetting<string | null>(deps.db, ctx.accountId, STILL_MODEL_KEY, null)
  const pick = choices.find(c => c.ref === saved && !c.problem)?.ref ?? (plan || !live ? cfg.still_model : cfg.api_still_model)
  return { choices, pick }
}

// One still's price with the picked model and path (the plan import's
// preview): a character still attaches the sheet, a topic still does not.
export async function slideStillPrice(deps: Deps, ctx: Ctx, want: string | null, mode: 'character' | 'topic'): Promise<{ micros: number; model: string; label: string; path: StillChoice['path']; problem: string | null }> {
  const { choices, pick } = await slideStillChoices(deps, ctx)
  const choice = choices.find(c => c.ref === want) ?? choices.find(c => c.ref === pick)!
  const entry = deps.config.models.models.find(m => m.ref === choice.ref)
  const kind: GenRequest['kind'] = mode === 'character' && (entry?.max_refs ?? 0) > 0 ? 'image_edit' : 'image'
  const base = await runModel(deps, ctx, choice.ref, kind)
  const run = choice.path === 'api' && base.model.startsWith('higgsfield/') ? { ...base, billing: 'api' as const } : base
  const level = stillLevelFor(deps, choice.ref)
  try {
    const est = estimateGen(deps.config, { kind, model: run.model, modelRef: choice.ref, prompt: '', aspect: '9:16', quality: level.quality, resolution: level.resolution, ...(run.billing ? { billing: run.billing } : {}) })
    return { micros: est.totalMicros, model: choice.ref, label: choice.label, path: choice.path, problem: choice.problem }
  } catch {
    return { micros: 0, model: choice.ref, label: choice.label, path: choice.path, problem: choice.problem ?? 'The price book has no price for it yet.' }
  }
}

export async function saveSlideStillModel(deps: Deps, ctx: Ctx, ref: string): Promise<void> {
  const cfg = cfgOf(deps)
  if (ref !== cfg.still_model && ref !== cfg.api_still_model) throw new AppError('invalid_request', `"${ref}" is not one of the slideshow stills models.`)
  await setSetting(deps, ctx, STILL_MODEL_KEY, ref)
}

interface StillCtx {
  row: ContentRow; spec: SlideshowSpec
  model: string; label: string; entry: { label: string; max_refs: number }
  run: { model: string; billing?: 'account' | 'api' }
  level: { quality: string; resolution: string }
  aspect: '9:16' | '3:4'
  ch: Ch; characterRow: CharacterRow
  // Character mode: the scene's fields with the lock, and the refs.
  base?: SceneFields; refs?: Array<{ assetId: string }>; element?: string | null; mode?: ReferenceMode
  sw: Awaited<ReturnType<typeof ruleSwitches>>
}

async function stillContext(deps: Deps, ctx: Ctx, row: ContentRow, spec: SlideshowSpec, want?: string | null): Promise<StillCtx> {
  const { choices, pick } = await slideStillChoices(deps, ctx)
  const choice = choices.find(c => c.ref === want && !c.problem) ?? choices.find(c => c.ref === (spec.stillModel ?? pick) && !c.problem) ?? choices.find(c => c.ref === pick)!
  if (choice.problem) throw new AppError('bad_request', `${choice.label}: ${choice.problem}`)
  const model = choice.ref
  const entry = deps.config.models.models.find(m => m.ref === model)
  if (!entry) throw new AppError('bad_request', `Unknown model "${model}".`)
  const characterRow = await getCharacter(deps, ctx, row.characterId!)
  const ch = toData(characterRow)
  const sw = await ruleSwitches(deps, ctx, characterRow.id)
  const aspect = spec.made === 'instagram' ? '3:4' : '9:16'
  const level = stillLevelFor(deps, model)
  const onPlan = choice.path === 'account'
  if (spec.mode === 'topic') {
    const kind: GenRequest['kind'] = spec.lock.lookAssetId && entry.max_refs > 0 ? 'image_edit' : 'image'
    const base = await runModel(deps, ctx, model, kind)
    const run = !onPlan && base.model.startsWith('higgsfield/') ? { ...base, billing: 'api' as const } : base
    return { row, spec, model, label: entry.label, entry, run, level, aspect, ch, characterRow, sw }
  }
  // The character: the post's scene (made from the idea or the hook, free)
  // with the slideshow's locked lines over it.
  let sceneId = row.sceneId
  if (!sceneId) sceneId = (await postScene(deps, ctx, row.id)).sceneId
  const scene = await getScene(deps, ctx, sceneId!)
  const fields = effectiveFields(deps, scene, await fieldOptions(deps, ctx, characterRow.id)) as Partial<SceneFields>
  const lock = spec.lock
  const place = lock.place.trim()
  const details = lock.details.map(d => d.trim()).filter(Boolean)
  const first = spec.shots[0]?.trim() || spec.hook.trim() || fields.moment || 'an ordinary moment of the day'
  const parsed = sceneFieldsSchema.safeParse({
    ...fields,
    moment: first.length >= 3 ? first : 'an ordinary moment of the day',
    ...(place ? { location: place.slice(0, 60), setting: place } : {}),
    ...(details.length ? { setting: [place || fields.setting || '', `Also in the place: ${details.join(', ')}`].filter(Boolean).join('. ') } : {}),
    ...(lock.light ? { light: lock.light } : {}),
    ...(lock.camera ? { camera: lock.camera } : {}),
    ...(lock.phone ? { phone: lock.phone } : {}),
    ...(lock.outfit.trim() ? { outfit: lock.outfit.trim() } : {}),
    ...(lock.hair.trim() ? { hair: lock.hair.trim().slice(0, 160) } : {}),
    destination: aspect === '3:4' ? 'portrait' : 'vertical',
    task: '', trigger: '', asWritten: false,
  })
  if (!parsed.success) throw new AppError('invalid_request', `Finish the scene first: ${parsed.error.issues[0]?.path.join('.') ?? 'fields'} ${parsed.error.issues[0]?.message ?? ''}.`)
  const refs = await sceneRefs(deps, ctx, characterRow.id, parsed.data, sw.on('scene-refs-by-angle'))
  if (!refs.length) throw new AppError('bad_request', `Approve ${ch.name}'s REF-00 first: the stills attach the sheet so the face holds. Or pick No one, a topic, for photos without ${ch.pronouns.obj}.`)
  const identity = identityForModel(ch.identities, model)
  const mode: ReferenceMode = entry.max_refs > 0 ? 'refs' : identity ? 'trained' : 'text'
  const kind: GenRequest['kind'] = mode === 'refs' ? 'image_edit' : 'image'
  const base = await runModel(deps, ctx, model, kind)
  const run = !onPlan && base.model.startsWith('higgsfield/') ? { ...base, billing: 'api' as const } : base
  // On the plan the character's Higgsfield element goes with the refs.
  const element = onPlan ? ch.identities.find(i => i.kind === 'element' && i.status === 'ready' && i.provider === 'higgsfield')?.externalId ?? null : null
  return { row: { ...row, sceneId: sceneId! }, spec, model, label: entry.label, entry, run, level, aspect, ch, characterRow, base: parsed.data, refs: mode === 'refs' ? refs.slice(0, Math.max(1, entry.max_refs)).map(r => ({ assetId: r.assetId })) : [], element, mode, sw }
}

const LIGHT_WORDS = (deps: Deps, id: string) => deps.config.pipeline.scenes.lights.find(l => l.id === id)?.text ?? ''

// A shot as the moment of a sentence: "sitting at her desk" becomes
// "Callie is sitting at her desk"; a shot that already names who stays.
export function shotMoment(shot: string, name: string | null): string {
  const t = shot.trim().replace(/[.\s]+$/, '')
  if (!t) return t
  const cap = t.charAt(0).toUpperCase() + t.slice(1)
  if (!name) return cap
  const who = new RegExp(`^(?:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|she|he|they|her|his|their)\\b`, 'i')
  if (who.test(t)) return cap
  if (/^\w+ing\b/i.test(t)) return `${name} is ${t}`
  return `${name}, ${t}`
}

// One slide's still request: the locked scene and this slide's shot.
function slideRequest(deps: Deps, c: StillCtx, shot: string, seed: number, realism: RealismWarning[]): { prompt: string; request: GenRequest; warnings: RuleViolation[] } {
  const t = deps.config.pipeline.templates
  const { scenes: sc, views, rules } = deps.config.pipeline
  const s = c.spec
  const moment = shot.trim().length >= 3 ? shot.trim() : (s.hook.trim() || 'an ordinary moment of the day')
  if (s.mode === 'topic') {
    const lock = s.lock
    const details = lock.details.map(d => d.trim()).filter(Boolean)
    const body = fill(t.slideshow_topic, {
      camera: (lock.camera && !sc.cameras.some(x => x.id === lock.camera) ? lock.camera : 'held at chest height'),
      shot: shotMoment(moment, null), place: (lock.place || topicOf(c.row, s) || 'an ordinary place').replace(/[.\s]+$/, ''),
      details: details.length ? ` Also there: ${details.join(', ')}.` : '',
      light: lock.light ? `${LIGHT_WORDS(deps, lock.light) || 'Natural available light'}.` : 'Natural available light.',
      aspect: c.aspect,
    })
    const look = s.lock.lookAssetId && c.entry.max_refs > 0 ? s.lock.lookAssetId : null
    const prompt = withModelLines(deps, c.model, `${body}${look ? t.slideshow_same_place : ''}\n${realismBlock(t.slideshow_topic_realism)}`).replace(/\n?Bare natural lips, no gloss\.?/, '')
    const request: GenRequest = {
      kind: look ? 'image_edit' : 'image', model: c.run.model, modelRef: c.model, prompt, aspect: c.aspect, quality: c.level.quality, resolution: c.level.resolution, seed,
      ...(look ? { refs: [{ assetId: look }] } : {}), ...(c.run.billing ? { billing: c.run.billing } : {}),
    }
    const warnings = lintPrompt(rules, prompt, { stage: 'slideshow', kind: request.kind, request: { ...request, model: c.model }, switches: c.sw })
    return { prompt, request, warnings }
  }
  const f: SceneFields = { ...c.base!, moment: shotMoment(moment, c.ch.name).slice(0, 400) }
  const identity = identityForModel(c.ch.identities, c.model)
  const sceneRules = { outfitOverride: c.sw.on('scene-outfit-override'), brandFree: c.sw.on('scene-brand-free'), colors: c.sw.on('scene-colors'), referenceLine: c.sw.on('scene-reference-slot') }
  const element = c.element ? ` ${fill(t.slideshow_element, { noun: c.ch.pronouns.noun || 'person', name: c.ch.name, element: c.element })}` : ''
  const prompt = withModelLines(deps, c.model, buildScenePrompt(t, sc, views, f, c.ch, c.mode!, { identityBlock: identity?.promptBlock, warnings: realism, addendum: `${t.slideshow_set}${element}`, rules: sceneRules, flawDose: c.sw.on('realism-flaw-dose') }))
  const kind: GenRequest['kind'] = c.mode === 'refs' ? 'image_edit' : 'image'
  const request: GenRequest = {
    kind, model: c.run.model, modelRef: c.model, prompt, aspect: c.aspect, quality: c.level.quality, resolution: c.level.resolution, seed,
    ...(c.refs?.length ? { refs: c.refs } : {}),
    ...(c.mode === 'trained' && identity ? { identityId: identity.externalId } : {}),
    ...(c.run.billing ? { billing: c.run.billing } : {}),
  }
  const lintSwitches = f.brands ? { on: (id: string) => id !== 'scene-brand-free' && c.sw.on(id), value: c.sw.value } : c.sw
  const warnings = lintPrompt(rules, prompt, { stage: 'scene', framing: f.framing, kind, request: { ...request, model: c.model }, marks: c.ch.marks, identityBlock: identity?.promptBlock, switches: lintSwitches })
  return { prompt, request, warnings }
}

function checked(warnings: RuleViolation[], label: string): RuleViolation[] {
  const errors = warnings.filter(w => w.severity === 'error')
  if (errors.length) throw new AppError('prompt_rejected', `${label}: ${errors.map(e => `${e.title} (SPEC ${e.spec})`).join('; ')}`, errors)
  return warnings
}

// The slides that still need a picture: no still, no special slide.
export function emptySlides(spec: SlideshowSpec): number[] {
  return slideList(spec).filter(s => !s.stillId && !s.special).map(s => s.index)
}

export async function buildSlideshowStills(deps: Deps, ctx: Ctx, input: { contentId: string; slides?: number[]; stillModel?: string }): Promise<Built> {
  const { row, spec } = await slideshowPost(deps, ctx, input.contentId)
  const list = slideList(spec)
  const wanted = input.slides?.length ? [...new Set(input.slides)].filter(i => i >= 0 && i < Math.max(list.length, 1)) : emptySlides(spec)
  if (!wanted.length) throw new AppError('bad_request', list.length ? 'Every slide has a picture. Press Reroll on a slide for a new one.' : 'Write or draft the slides first (the hook and the slides), or pick stills from the Library.')
  const c = await stillContext(deps, ctx, row, spec, input.stillModel)
  const realism: RealismWarning[] = []
  const warnings: RuleViolation[] = []
  const prompts: Built['preview']['prompts'] = []
  const specs: JobSpec[] = []
  const stage = spec.mode === 'topic' ? 'slideshow' : 'scene'
  const total = wanted.filter(i => !list[i]?.special).length
  const [{ n: made } = { n: 0 }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), sql`${candidates.meta}->>'slideshow' = ${row.id}`))
  for (const i of wanted) {
    const slide = list[i]
    if (slide?.special) continue
    const shot = slide?.shot || slide?.text || ''
    // A new seed each time a still of this post lands, so a reroll draws a
    // new picture (the same between the price and the run).
    const r = slideRequest(deps, c, shot, 1 + i + 37 * made, realism)
    warnings.push(...checked(r.warnings, `Slide ${i + 1}`))
    if (prompts.length < 2) prompts.push({ label: `Slide ${i + 1} prompt`, text: r.prompt, wrapped: hardWrap(r.prompt) })
    specs.push({ type: 'gen', stage, purpose: `slide_still:${row.id}`, label: `Slideshow still ${specs.length + 1} of ${total} (slide ${i + 1}), ${c.label}`, request: { ...r.request, slide: { slide: i, postId: row.id, sceneId: c.row.sceneId ?? null } } })
  }
  if (!specs.length) throw new AppError('bad_request', 'Those slides are special slides; they are drawn for free.')
  if (spec.mode === 'topic') warnings.push(warn('slideshow-topic', 'No one in these photos', 'A topic slideshow has no character: no face check runs. The REALISM line is in every prompt.'))
  const one = specs.length === 1
  return {
    purpose: `slide_still:${row.id}`, characterId: row.characterId,
    preview: { title: one ? `Reroll slide ${wanted[0]! + 1}` : `${specs.length} stills, one locked scene`, prompts, warnings: dedupeWarnings([...realism, ...warnings]), invalidates: [] },
    specs,
  }
}

const dedupeWarnings = (list: RuleViolation[]): RuleViolation[] => {
  const seen = new Set<string>()
  return list.filter(w => { const k = `${w.ruleId}|${w.match ?? ''}|${w.message}`; if (seen.has(k)) return false; seen.add(k); return true })
}

// A still landed: kept as a candidate (in the post's scene for the
// character, with the free face and skin checks; a topic still has no
// face to check) and put in its slide.
async function onSlideStill(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const req = job.request as GenRequest
  const meta = req.slide ?? { slide: 0 }
  const postId = meta.postId ?? job.purpose.split(':')[1]!
  const slide = meta.slide
  const asset = out.assets?.find(a => a.kind === 'image') ?? out.assets?.[0]
  if (out.status !== 'completed' || !asset || !job.characterId) return
  const topic = job.stage === 'slideshow'
  const id = newId('cand')
  const sceneId = topic ? null : meta.sceneId ?? null
  await deps.db.insert(candidates).values({
    id, accountId: job.accountId, characterId: job.characterId, jobId: job.id, createdBy: job.userId, prompt: req.prompt ?? '',
    target: 'scene', sceneId, op: topic ? 'slide_topic' : 'generate', status: topic ? 'in_review' : 'qa_pending',
    label: `Slide ${slide + 1}`, meta: { slideshow: postId, slide },
  })
  if (!topic && sceneId) {
    const report = await localStillChecks(deps, ctx, job, asset.id, [], sceneId)
    await deps.db.update(candidates).set({ assetId: asset.id, status: 'in_review', qaReport: report, qaVerdict: report.verdict }).where(eq(candidates.id, id))
  } else {
    await deps.db.update(candidates).set({ assetId: asset.id, status: 'in_review' }).where(eq(candidates.id, id))
  }
  await setSlideStill(deps, ctx, postId, slide, id)
}

// Puts a still in one slide, under a row lock so stills landing together
// never undo each other.
export async function setSlideStill(deps: Deps, ctx: Ctx, postId: string, slide: number, candidateId: string): Promise<void> {
  await deps.db.transaction(async tx => {
    const [row] = await tx.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, postId))).for('update')
    if (!row || row.archivedAt) return
    const spec = parse(row)
    const stillIds = setAt(spec.stillIds, slide, candidateId, '')
    await tx.update(contentItems).set({ spec: { ...(row.spec as object), stillIds }, updatedAt: deps.clock.now() }).where(eq(contentItems.id, row.id))
  })
}

// ── Caption (priced) ───────────────────────────────────────────────────

const captionJson = (max: number) => ({ type: 'object', additionalProperties: false, required: ['caption', 'hashtags'], properties: { caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: max } } })

export async function buildSlideshowCaption(deps: Deps, ctx: Ctx, contentId: string): Promise<Built> {
  const { row, spec } = await slideshowPost(deps, ctx, contentId)
  const list = slideList(spec).filter(s => s.text)
  if (!list.length) throw new AppError('invalid_request', 'Write the slides first; the caption is written from them.')
  const ch = toData(await getCharacter(deps, ctx, row.characterId!))
  const t = deps.config.pipeline.templates.slideshow_caption
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const vars = { ...pronounVars(ch.pronouns), name: ch.name, tags_max: String(cfgOf(deps).hashtags[1]), voice: voiceOf(ch), slides: list.map(s => `${s.index + 1}. ${s.text}`).join('\n'), caption: spec.caption.trim() || 'none yet' }
  const system = fill(t.system, vars), prompt = fill(t.prompt, vars)
  const purpose = `slideshow_caption:${row.id}`
  const mock = { caption: `Honestly did not expect this one. ${spec.hook.trim().replace(/[.!?]*$/, '.')} Has this happened to you?`, hashtags: ['storytime', 'relatable', 'fyp'] }
  return {
    purpose, characterId: row.characterId,
    preview: { title: 'Rewrite the caption', prompts: [{ label: 'Caption writer', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }], warnings: [], invalidates: [] },
    specs: [{ type: 'llm', stage: 'content', purpose, label: 'Slideshow caption', request: { model: route.model, system, prompt, schema: captionJson(cfgOf(deps).hashtags[1]), schemaName: 'slideshow_caption', maxTokens: 600, effort: route.effort ?? 'low', meta: { itemId: row.id, mockCaption: mock } } }],
  }
}

async function onSlideshowCaption(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const d = (out.data ?? {}) as { caption?: unknown; hashtags?: unknown }
  const caption = clean(d.caption, 2200)
  if (caption) await updateContent(deps, ctx, job.purpose.split(':')[1]!, { spec: { caption, hashtags: tags(d.hashtags, cfgOf(deps).hashtags[1]) } })
}

// ── Variations: a family of slideshows (priced) ───────────────────────

export const variationsJsonSchema = (count: number, rest: number, max: number) => ({
  type: 'object', additionalProperties: false, required: ['variations'],
  properties: { variations: { type: 'array', minItems: count, maxItems: count, items: { type: 'object', additionalProperties: false, required: ['hook', 'slides', 'caption', 'hashtags'], properties: { hook: { type: 'string' }, slides: { type: 'array', items: { type: 'string' }, minItems: rest, maxItems: rest }, caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: max } } } } },
})

// The order of variation k's slides: a list post (listicle, tier list, red
// flags) has its middle slides reordered; the hook and the last slide stay.
export function variationOrder(spec: SlideshowSpec, n: number, k: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  return isListPattern(spec.pattern ?? guessPattern(spec.hook)) ? reorderMiddle(idx, k + 1, 1) : idx
}

export async function buildSlideshowVariations(deps: Deps, ctx: Ctx, input: { contentId: string; count: number }): Promise<Built> {
  const { row, spec } = await slideshowPost(deps, ctx, input.contentId)
  const max = cfgOf(deps).max_variations
  const count = Math.max(1, Math.min(max, Math.round(input.count)))
  const list = slideList(spec)
  if (!list.length || !spec.hook.trim()) throw new AppError('invalid_request', 'Write or draft the slides first: a variation rewrites them.')
  const ch = toData(await getCharacter(deps, ctx, row.characterId!))
  const t = deps.config.pipeline.templates.slideshow_variations
  const route = await resolveRoute(deps, ctx, 'content_writer')
  const n = list.length
  // Variations start from the alt hook (section 28): variation 1 uses it
  // word for word, the others reword it.
  const alt = spec.plan.altHook.trim()
  const vars = {
    ...pronounVars(ch.pronouns), name: ch.name, count: String(count), rest: String(n - 1), tags_max: String(cfgOf(deps).hashtags[1]), voice: voiceOf(ch), slides: list.map(s => `${s.index + 1}. ${s.text || '(no words)'}`).join('\n'), caption: spec.caption.trim() || 'none',
    alt: alt ? `Start from the alt hook: variation 1's hook is "${alt}" word for word; the other variations reword it.` : '',
    standard: standardVars(deps).standard,
  }
  const system = fill(t.system, vars), prompt = fill(t.prompt, vars)
  const purpose = `slide_vars:${row.id}`
  const mock = { variations: Array.from({ length: count }, (_, k) => ({ hook: k === 0 && alt ? alt : `${(alt || spec.hook.trim()).replace(/[.!?]*$/, '')} (take ${k + 2})`, slides: list.slice(1).map(s => `${s.text || 'More of this'} (take ${k + 2})`), caption: `${spec.caption.trim() || spec.hook.trim()} Take ${k + 2}.`, hashtags: spec.hashtags.slice(0, 3) })) }
  const specs: JobSpec[] = [{ type: 'llm', stage: 'content', purpose, label: `${count} variation${count === 1 ? '' : 's'} of the slideshow`, request: { model: route.model, system, prompt, schema: variationsJsonSchema(count, n - 1, cfgOf(deps).hashtags[1]), schemaName: 'slideshow_variations', maxTokens: 500 + count * (250 + 60 * n), effort: route.effort ?? 'low', meta: { itemId: row.id, count, n, mockVariations: mock } } }]
  // A new image set for each: the same shots in the same locked scene, new
  // seeds, made when the words come back (one price for all).
  const photos = list.filter(s => !s.special)
  const prompts: Built['preview']['prompts'] = [{ label: 'Variation writer', text: `${system}\n${prompt}`, wrapped: hardWrap(`${system}\n${prompt}`) }]
  const warnings: RuleViolation[] = []
  const realism: RealismWarning[] = []
  if (photos.length) {
    const c = await stillContext(deps, ctx, row, spec)
    const stage = spec.mode === 'topic' ? 'slideshow' : 'scene'
    for (let k = 0; k < count; k++) {
      const order = variationOrder(spec, n, k)
      order.forEach((from, to) => {
        const s = list[from]!
        if (s.special) return
        const r = slideRequest(deps, c, s.shot || s.text, 101 + k * 31 + to, realism)
        warnings.push(...checked(r.warnings, `Variation ${k + 1}, slide ${to + 1}`))
        if (prompts.length < 2) prompts.push({ label: `Variation 1, slide ${to + 1} prompt`, text: r.prompt, wrapped: hardWrap(r.prompt) })
        specs.push({ type: 'gen', stage, purpose: `slide_still:${row.id}:v`, label: `Variation still ${specs.length} of ${count * photos.length} (variation ${k + 1}, slide ${to + 1}), ${c.label}`, parentIndex: 0, request: { ...r.request, slide: { slide: to, variant: k, sceneId: c.row.sceneId ?? null } } })
      })
    }
  }
  return {
    purpose, characterId: row.characterId,
    preview: { title: `${count} variation${count === 1 ? '' : 's'}: new hook, new images${isListPattern(spec.pattern ?? guessPattern(spec.hook)) ? ', reordered list' : ''}, new caption`, prompts, warnings: dedupeWarnings([...realism, ...warnings]), invalidates: [] },
    specs,
  }
}

// A variation's post id, from the run that wrote it (so a still landing
// first still finds its post).
const variantId = (jobId: string, k: number) => `cnt_${jobId.slice(4, 25)}${'0123456789abcdefghjkmnpqrstvwxyz'[k % 32]}`
const batchChildId = (jobId: string) => `cnt_${jobId.slice(4)}`

const familyRoot = (row: ContentRow): string => row.variationOf ?? row.id

// The other account tags in use (a variation goes to another account) of
// the same kind: a character post's variations go to that character's
// other accounts, a topic post's to other faceless (topic) accounts, never
// a face onto a faceless account or the other way round.
async function otherTags(deps: Deps, ctx: Ctx, source: ContentRow): Promise<string[]> {
  const tag = source.accountTag.trim()
  const topic = parse(source).mode === 'topic'
  const rows = await deps.db.select({ tag: contentItems.accountTag, kind: contentItems.kind, characterId: contentItems.characterId, spec: contentItems.spec }).from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt)))
  const topicTags = new Set(rows.filter(r => r.kind === 'slideshow' && (r.spec as { mode?: string } | null)?.mode === 'topic').map(r => r.tag.trim()))
  const fits = (r: (typeof rows)[number]) => topic ? topicTags.has(r.tag.trim()) : !topicTags.has(r.tag.trim()) && r.characterId === source.characterId
  return [...new Set(rows.filter(fits).map(r => r.tag.trim()).filter(t => t && t !== tag))].sort()
}

async function onSlideshowVariations(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const sourceId = job.purpose.split(':')[1]!
  if (out.status !== 'completed') { await cancelChildren(deps, job.id, 'The variations were not written, so their stills were not made. Nothing was charged for them.'); return }
  const source = await getContent(deps, ctx, sourceId).catch(() => null)
  if (!source) { await cancelChildren(deps, job.id, 'The slideshow is gone.'); return }
  const spec = parse(source)
  const list = slideList(spec)
  const n = list.length
  const d = (out.data ?? {}) as { variations?: Array<{ hook?: unknown; slides?: unknown; caption?: unknown; hashtags?: unknown }> }
  const vars = (Array.isArray(d.variations) ? d.variations : []).slice(0, cfgOf(deps).max_variations)
  const root = familyRoot(source)
  const tagsInUse = await otherTags(deps, ctx, source)
  const seenCaptions = new Set([spec.caption.trim().toLowerCase()])
  const made: string[] = []
  for (const [k, v] of vars.entries()) {
    const order = variationOrder(spec, n, k)
    const alt = spec.plan.altHook.trim()
    const words = [(k === 0 && alt ? alt : clean(v.hook, 200)) || spec.hook, ...(Array.isArray(v.slides) ? v.slides : []).map(x => clean(x, 300))]
    let caption = clean(v.caption, 2200)
    // Never the exact caption of another account's post.
    if (!caption || seenCaptions.has(caption.toLowerCase())) caption = `${caption || spec.caption} (${k + 2})`.trim()
    seenCaptions.add(caption.toLowerCase())
    const texts = order.map((from, to) => (to === 0 ? words[0]! : words[from] ?? list[from]?.text ?? ''))
    const id = variantId(job.id, k)
    const vspec: SlideshowSpec = {
      ...spec,
      hook: texts[0]!, slides: texts.slice(1),
      shots: order.map(from => list[from]?.shot ?? ''),
      specials: order.map(from => list[from]?.special ?? null),
      stillIds: [], textPos: [], hookIdeas: [], hookReview: null, review: null, batchHooks: [],
      // The variation's own alt hook is the source's hook (one tap swaps back).
      plan: { ...spec.plan, rowId: '', planId: '', altHook: spec.hook },
      caption, hashtags: tags(v.hashtags, cfgOf(deps).hashtags[1]),
    }
    await deps.db.insert(contentItems).values({
      id, accountId: ctx.accountId, characterId: source.characterId, kind: 'slideshow', title: '', idea: source.idea,
      accountTag: tagsInUse.length ? tagsInUse[k % tagsInUse.length]! : '', sceneId: source.sceneId, spec: vspec, step: 'text',
      variationOf: root, createdBy: job.userId,
    }).onConflictDoNothing()
    made.push(id)
  }
  // Each variation's stills start now, into its own post.
  const children = (await childJobs(deps, job.id)).filter(c => c.status === 'waiting')
  for (const c of children) {
    const k = (c.request as GenRequest).slide?.variant ?? -1
    if (!made[k]) await cancelWaiting(deps, c.id, 'That variation was not written; its still was not made. Nothing was charged for it.')
  }
  await activateChildren(deps, job.id, c => {
    const m = (c.request as GenRequest).slide ?? { slide: 0 }
    return { slide: { ...m, postId: made[m.variant ?? 0] } }
  })
}

// ── Batch: paste hooks, make them all, review (priced) ────────────────

export async function buildSlideshowBatch(deps: Deps, ctx: Ctx, input: { contentId: string }): Promise<Built> {
  const { row, spec } = await slideshowPost(deps, ctx, input.contentId)
  const max = cfgOf(deps).batch_max
  const hooks = spec.batchHooks.map(h => trimWords(clean(h, 200), 14)).filter(h => h.length >= 3).slice(0, max)
  if (!hooks.length) throw new AppError('invalid_request', 'Paste the hooks first, one a line.')
  const n = spec.slideCount
  const specs: JobSpec[] = []
  const prompts: Built['preview']['prompts'] = []
  const warnings: RuleViolation[] = []
  const realism: RealismWarning[] = []
  const c = await stillContext(deps, ctx, row, spec)
  const stage = spec.mode === 'topic' ? 'slideshow' : 'scene'
  for (const [b, hook] of hooks.entries()) {
    const r = await draftRequest(deps, ctx, row, spec, { hook, pattern: guessPattern(hook) }, n)
    if (!b) prompts.push({ label: 'Slideshow writer (the first hook)', text: `${r.system}\n${r.prompt}`, wrapped: hardWrap(`${r.system}\n${r.prompt}`) })
    const parent = specs.length
    specs.push({ type: 'llm', stage: 'content', purpose: `slide_draft:${row.id}:batch`, label: `Batch draft ${b + 1} of ${hooks.length}`, request: { model: r.route.model, system: r.system, prompt: r.prompt, schema: r.schema, schemaName: 'slideshow_draft', maxTokens: 900 + 220 * n, effort: r.route.effort ?? 'low', meta: { itemId: row.id, hook, pattern: guessPattern(hook), n, row: b, mockDraft: r.mock } } })
    // Every slide's still waits for the draft (its shot comes from it);
    // until then each holds a prompt from the hook, which the price and
    // the checks see. A slide the draft makes special is released.
    for (let i = 0; i < n; i++) {
      const p = slideRequest(deps, c, i === 0 ? hook : `${hook}, moment ${i + 1}`, 201 + b * 17 + i, realism)
      warnings.push(...checked(p.warnings, `Slideshow ${b + 1}, slide ${i + 1}`))
      if (prompts.length < 2) prompts.push({ label: 'A still prompt (its shot comes from the draft)', text: p.prompt, wrapped: hardWrap(p.prompt) })
      specs.push({ type: 'gen', stage, purpose: `slide_still:${row.id}:b`, label: `Batch still ${b * n + i + 1} of ${hooks.length * n} (slideshow ${b + 1}, slide ${i + 1}), ${c.label}`, parentIndex: parent, request: { ...p.request, slide: { slide: i, row: b, sceneId: c.row.sceneId ?? null } } })
    }
  }
  warnings.push(warn('slideshow-batch-specials', 'Special slides are not charged', 'A slide the draft makes a mock screen gets no still: its part of the price is released.'))
  return {
    purpose: `slide_batch:${row.id}`, characterId: row.characterId,
    preview: { title: `Make ${hooks.length} slideshow${hooks.length === 1 ? '' : 's'}: each drafted, then ${n} stills each`, prompts, warnings: dedupeWarnings([...realism, ...warnings]), invalidates: [] },
    specs,
  }
}

// A draft landed: into the post itself ("Use this hook"), or into a new
// slideshow of the batch, whose stills then start with their own shots.
async function onSlideDraft(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const [, anchorId, tag] = job.purpose.split(':') as [string, string, string]
  const meta = ((job.request as { meta?: Partial<HookInfo> & { n?: number } }).meta ?? {})
  if (out.status !== 'completed') { await cancelChildren(deps, job.id, 'The draft was not written, so its stills were not made. Nothing was charged for them.'); return }
  const anchor = await getContent(deps, ctx, anchorId).catch(() => null)
  if (!anchor) { await cancelChildren(deps, job.id, 'The slideshow is gone.'); return }
  const d = (out.data ?? {}) as DraftOut
  const hook = meta.hook ?? ''
  if (tag !== 'batch') {
    const spec = parse(anchor)
    await updateContent(deps, ctx, anchor.id, { spec: { ...draftPatch(deps, spec, d, { ...meta, hook, pattern: meta.pattern ?? null, n: meta.n ?? spec.slideCount }) } })
    return
  }
  // A batch row: its own slideshow, the batch's scene and settings.
  const parentSpec = parse(anchor)
  const id = batchChildId(job.id)
  const base: SlideshowSpec = { ...parentSpec, hook: '', slides: [], stillIds: [], shots: [], specials: [], textPos: [], hookIdeas: [], hookReview: null, batchHooks: [], caption: '', ctaLine: '', hashtags: [], review: 'pending' }
  const spec = { ...base, ...draftPatch(deps, base, d, { hook, pattern: meta.pattern ?? null, n: meta.n ?? parentSpec.slideCount }), review: 'pending' as const }
  await deps.db.insert(contentItems).values({
    id, accountId: ctx.accountId, characterId: anchor.characterId, kind: 'slideshow', title: '', idea: hook,
    accountTag: anchor.accountTag, sceneId: anchor.sceneId, spec, step: 'text', batchOf: anchor.id, createdBy: job.userId,
  }).onConflictDoNothing()
  // The stills, each with its slide's shot; a special slide's is released.
  const row = await getContent(deps, ctx, id)
  const children = (await childJobs(deps, job.id)).filter(ch => ch.status === 'waiting')
  let c: StillCtx | null = null
  try { c = await stillContext(deps, ctx, row, spec, (children[0]?.request as GenRequest | undefined)?.modelRef ?? null) } catch (e) {
    await cancelChildren(deps, job.id, `The stills could not start: ${(e as Error).message} Nothing was charged for them.`)
    return
  }
  const list = slideList(spec)
  const prompts = new Map<string, string>()
  for (const ch of children) {
    const i = (ch.request as GenRequest).slide?.slide ?? 0
    const s = list[i]
    if (!s || s.special) { await cancelWaiting(deps, ch.id, `${NOT_NEEDED} this slide became a special slide (drawn free), so no still was made. Nothing was charged for it.`); continue }
    const r = slideRequest(deps, c, s.shot || s.text, (ch.request as GenRequest).seed ?? i + 1, [])
    const problems = [...realismBlockers(r.prompt, { kind: r.request.kind, stage: ch.stage }), ...(findExplicitTerms(r.prompt).length ? [EXPLICIT_MESSAGE] : [])]
    if (problems.length) { await cancelWaiting(deps, ch.id, `The written shot was refused: ${problems.join(' ')} Nothing was charged for this still.`); continue }
    prompts.set(ch.id, r.prompt)
  }
  await activateChildren(deps, job.id, ch => {
    const m = (ch.request as GenRequest).slide ?? { slide: 0 }
    return { ...(prompts.has(ch.id) ? { prompt: prompts.get(ch.id) } : {}), slide: { ...m, postId: id } }
  })
}

// The batch's slideshows, for the review screen.
export async function batchView(deps: Deps, ctx: Ctx, contentId: string) {
  const { row } = await slideshowPost(deps, ctx, contentId)
  const kids0 = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.batchOf, row.id))).orderBy(asc(contentItems.createdAt))
  // In the order the hooks were pasted (drafts land in any order).
  const order = parse(row).batchHooks.map(h => h.trim().toLowerCase())
  const at = (k: ContentRow) => { const i = order.indexOf(k.idea.trim().toLowerCase()); return i < 0 ? order.length : i }
  const kids = [...kids0].sort((a, b) => at(a) - at(b))
  // Each slideshow's pictures, so the review shows them as they land.
  const ids = [...new Set(kids.flatMap(k => parse(k).stillIds.filter(Boolean)))]
  const rows = ids.length ? await deps.db.select({ id: candidates.id, assetId: candidates.assetId }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, ids))) : []
  const assets = Object.fromEntries(rows.filter(r => r.assetId).map(r => [r.id, r.assetId!]))
  return { items: kids.map(k => ({ id: k.id, archived: !!k.archivedAt, status: k.status, spec: parse(k), outputs: k.outputs as ContentOutputs, accountTag: k.accountTag, idea: k.idea })), assets }
}

// Approve (export it, free), or Reject (archived). Reroll is priced: the
// Stills action on that slideshow.
export async function reviewBatchItem(deps: Deps, ctx: Ctx, contentId: string, childId: string, decision: 'approve' | 'reject' | 'pending', render: (id: string) => Promise<unknown>) {
  const { row } = await slideshowPost(deps, ctx, contentId)
  const [kid] = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, childId), eq(contentItems.batchOf, row.id)))
  if (!kid) throw notFound('Slideshow in this batch')
  const spec = { ...(kid.spec as object), review: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'pending' }
  await deps.db.update(contentItems).set({ spec, archivedAt: decision === 'reject' ? deps.clock.now() : null, updatedAt: deps.clock.now() }).where(eq(contentItems.id, kid.id))
  if (decision === 'approve') await render(kid.id)
  return batchView(deps, ctx, contentId)
}

// ── Family: the post's variations ─────────────────────────────────────

export async function familyView(deps: Deps, ctx: Ctx, contentId: string) {
  const { row } = await slideshowPost(deps, ctx, contentId)
  const root = row.variationOf ?? row.id
  const rows = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), eq(contentItems.kind, 'slideshow')))
  const family = rows.filter(r => r.id === root || r.variationOf === root).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return { root, items: family.map(f => ({ id: f.id, hook: parse(f).hook, accountTag: f.accountTag, status: f.status, stills: parse(f).stillIds.filter(Boolean).length, isThis: f.id === row.id, variationOf: f.variationOf })) }
}

// ── Never reuse a picture or caption across accounts (default rule) ───

export interface ReuseHit { kind: 'image' | 'caption'; slide: number | null; postId: string; postName: string; accountTag: string }

export async function reuseReport(deps: Deps, ctx: Ctx, contentId: string): Promise<{ on: boolean; hits: ReuseHit[] }> {
  const { row, spec } = await slideshowPost(deps, ctx, contentId)
  const sw = await ruleSwitches(deps, ctx, row.characterId)
  if (!sw.on('slideshow-no-reuse')) return { on: false, hits: [] }
  const tag = row.accountTag.trim()
  if (!tag) return { on: true, hits: [] }
  const others = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), eq(contentItems.kind, 'slideshow'), ne(contentItems.id, row.id)))
  const mine = slideList(spec)
  const caption = spec.caption.trim().toLowerCase()
  const hits: ReuseHit[] = []
  for (const o of others) {
    const otag = o.accountTag.trim()
    if (!otag || otag === tag) continue
    const os = parse(o)
    const theirs = new Set(slideList(os).map(s => s.stillId).filter(Boolean))
    const name = o.title.trim() || os.hook.trim() || o.idea.trim().slice(0, 60) || 'Untitled slideshow'
    for (const s of mine) if (s.stillId && theirs.has(s.stillId)) hits.push({ kind: 'image', slide: s.index, postId: o.id, postName: name, accountTag: otag })
    if (caption && os.caption.trim().toLowerCase() === caption) hits.push({ kind: 'caption', slide: null, postId: o.id, postName: name, accountTag: otag })
  }
  return { on: true, hits }
}

// ── The Scene library ─────────────────────────────────────────────────

export type SlideSceneRow = typeof slideScenes.$inferSelect
const sceneView = (r: SlideSceneRow) => ({ id: r.id, characterId: r.characterId, topic: r.topic, name: r.name, place: r.place, light: r.light, camera: r.camera, phone: r.phone, details: (r.details as string[]) ?? [], lookAssetId: r.lookAssetId, createdAt: r.createdAt.toISOString() })
export type SlideSceneView = ReturnType<typeof sceneView>

export async function listSlideScenes(deps: Deps, ctx: Ctx): Promise<SlideSceneView[]> {
  const rows = await deps.db.select().from(slideScenes).where(and(eq(slideScenes.accountId, ctx.accountId), isNull(slideScenes.archivedAt))).orderBy(desc(slideScenes.createdAt)).limit(200)
  return rows.map(sceneView)
}

export async function saveSlideScene(deps: Deps, ctx: Ctx, input: { name: string; characterId?: string | null; topic?: string; place: string; light?: string; camera?: string; phone?: string; details?: string[]; lookAssetId?: string | null }): Promise<SlideSceneView> {
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new AppError('bad_request', 'Name the scene first.')
  if (!input.place.trim()) throw new AppError('bad_request', 'A saved scene needs its place.')
  if (input.characterId) await getCharacter(deps, ctx, input.characterId)
  const [row] = await deps.db.insert(slideScenes).values({
    id: newId('ssc'), accountId: ctx.accountId, characterId: input.characterId ?? null, topic: (input.topic ?? '').trim().slice(0, 120), name,
    place: input.place.trim().slice(0, 300), light: (input.light ?? '').slice(0, 40), camera: (input.camera ?? '').slice(0, 60), phone: ['front', 'rear'].includes(input.phone ?? '') ? input.phone! : '',
    details: (input.details ?? []).map(d => d.trim().slice(0, 160)).filter(Boolean).slice(0, 2), lookAssetId: input.lookAssetId ?? null, createdBy: ctx.userId,
  }).returning()
  return sceneView(row!)
}

export async function archiveSlideScene(deps: Deps, ctx: Ctx, id: string): Promise<void> {
  const [row] = await deps.db.select().from(slideScenes).where(and(eq(slideScenes.accountId, ctx.accountId), eq(slideScenes.id, id)))
  if (!row || row.archivedAt) throw notFound('Saved scene')
  await deps.db.update(slideScenes).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(slideScenes.id, id))
}

// ── Export: both sizes, caption.txt and post.json, one zip (free) ─────

export function slideshowProblems(spec: SlideshowSpec): string[] {
  const list = slideList(spec)
  if (!list.length) return ['Pick stills']
  const missing = list.filter(s => !s.stillId && !s.special).map(s => s.index + 1)
  if (missing.length) return [`Slide${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'need' : 'needs'} a picture (Stills step)`]
  // A product screenshot is only ever the owner's upload.
  const shots = list.filter(s => s.special?.type === 'product_shot' && !s.special.assetId).map(s => s.index + 1)
  if (shots.length) return [`Slide${shots.length > 1 ? 's' : ''} ${shots.join(', ')} ${shots.length > 1 ? 'need' : 'needs'} the product screenshot (Upload on the slide, Stills step)`]
  return []
}

export const AI_LABEL_LINE = 'Turn on the AI-generated content label (TikTok and Instagram).'

export async function renderSlideshow(deps: Deps, ctx: Ctx, job: JobRow, row: ContentRow, name: string): Promise<ContentOutputs> {
  const spec = parse(row)
  const cfg = deps.config.pipeline.content
  const tiktok = { width: cfg.canvas.width, height: cfg.canvas.height }
  const insta = { width: cfg.slideshow.instagram.width, height: cfg.slideshow.instagram.height }
  const list = slideList(spec)
  const draw = fontDraw(cfg.caption)
  const images: string[] = [], instagram: string[] = []
  const files: Record<string, Uint8Array> = {}
  const slides: Parameters<typeof postExportJson>[0]['slides'] = []
  for (const s of list) {
    // A special slide sits over the nearest slide's photo (blurred).
    const photo = s.special ? backdropFor(list, s.index) : s.stillId
    const still = photo ? (await readAsset(deps, ctx, await candidateAsset(deps, ctx, photo, row.characterId!, 'image'))).data : null
    const special = s.special ? cleanSpecial(s.special, cfg.slideshow.brand_names, cfg.slideshow.generic_names) : null
    const shot = special?.type === 'product_shot' && special.assetId ? (await readAsset(deps, ctx, special.assetId)).data : null
    const input = { still, shot, text: s.text, style: spec.textStyle, pos: s.pos, special, ad: spec.ad && s.index === 0 }
    const nn = String(s.index + 1).padStart(2, '0')
    const fileT = `tiktok/${nn}-${name}.jpg`, fileI = `instagram/${nn}-${name}.jpg`
    const a = await renderSlide(input, tiktok, cfg, draw)
    const b = await renderSlide(input, insta, cfg, draw)
    const label = s.text ? `Slide ${s.index + 1}: ${s.text.slice(0, 60)}` : `Slide ${s.index + 1}`
    images.push((await saveAsset(deps, ctx, { data: a, mime: 'image/jpeg', origin: 'derived', label, sourceJobId: job.id })).id)
    instagram.push((await saveAsset(deps, ctx, { data: b, mime: 'image/jpeg', origin: 'derived', label: `${label} (Instagram)`, sourceJobId: job.id })).id)
    files[fileT] = a
    files[fileI] = b
    slides.push({ index: s.index, text: s.text, shot: s.shot, picture: special ? 'special' : still ? 'still' : 'none', stillId: special ? null : s.stillId, special, position: s.pos, files: { tiktok: fileT, instagram: fileI } })
  }
  const caption = postCaption(spec.caption, spec.hashtags, { ad: spec.ad || spec.plan.product, max: cfg.slideshow.hashtags[1], cta: spec.ctaLine })
  files['caption.txt'] = Buffer.from(`${caption}\n\nPost as a photo slideshow, images in order (tiktok/ for TikTok at 1080 x 1920, instagram/ for Instagram at 1080 x 1440). ${AI_LABEL_LINE}\n`)
  const character = row.characterId ? toData(await getCharacter(deps, ctx, row.characterId)) : null
  const json = postExportJson({
    post: { id: row.id, kind: row.kind, title: row.title, idea: row.idea, accountTag: row.accountTag, characterId: row.characterId, characterName: character?.name ?? null, variationOf: row.variationOf, batchOf: row.batchOf, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() },
    slideshow: {
      mode: spec.mode, pattern: spec.pattern, hook: spec.hook, textStyle: spec.textStyle, made: spec.made,
      caption: spec.caption, postCaption: caption, hashtags: spec.hashtags.slice(0, cfg.slideshow.hashtags[1]), ad: spec.ad || spec.plan.product,
      cta: { kind: spec.cta.kind, handle: spec.cta.handle, word: spec.cta.word, text: ctaText(spec.cta.kind, spec.cta) },
      scene: { place: spec.lock.place, light: spec.lock.light, camera: spec.lock.camera, phone: spec.lock.phone, outfit: spec.lock.outfit, details: spec.lock.details, savedId: spec.lock.savedId },
    },
    slides,
    files: { caption: 'caption.txt', tiktok: slides.map(s => s.files.tiktok), instagram: slides.map(s => s.files.instagram) },
    sizes: { tiktok, instagram: insta },
    aiLabel: character?.disclosure ?? 'Label all posts as AI-generated',
    exportedAt: deps.clock.now().toISOString(),
    plan: spec.plan, ctaLine: spec.ctaLine,
  })
  const jsonBuf = Buffer.from(`${JSON.stringify(json, null, 2)}\n`)
  files['post.json'] = jsonBuf
  const jsonAsset = await saveAsset(deps, ctx, { data: jsonBuf, mime: 'application/json', origin: 'derived', label: `Slideshow ${name} (post.json)`, sourceJobId: job.id })
  const zip = await saveAsset(deps, ctx, { data: Buffer.from(zipSync(files, { level: 0 })), mime: 'application/zip', origin: 'derived', label: `Slideshow ${name} (zip)`, sourceJobId: job.id })
  return { imageAssetIds: images, instagramAssetIds: instagram, jsonAssetId: jsonAsset.id, zipAssetId: zip.id, renderedAt: deps.clock.now().toISOString() }
}

// ── Hooks ─────────────────────────────────────────────────────────────

let registered = false
export function registerSlideshow(): void {
  if (registered) return
  registered = true
  registerJobHook('slideshow_hooks', onSlideshowHooks)
  registerJobHook('slide_draft', onSlideDraft)
  registerJobHook('slide_still', onSlideStill)
  registerJobHook('slideshow_caption', onSlideshowCaption)
  registerJobHook('slide_vars', onSlideshowVariations)
}

