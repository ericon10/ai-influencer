import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lt, or, sql } from 'drizzle-orm'
import { bankLines, candidates, contentItems, jobs, products } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { fill, hardWrap } from '../core/text.js'
import { planMetaSchema, type PlanMeta } from '../core/planMeta.js'
import { hashtagsOf, type PlanColumn, type PlanRow } from '../core/planImport.js'
import { slideList } from '../core/slides.js'
import { slideshowSpecSchema, type SlideshowSpec } from '../core/slideshowSpec.js'
import { cleanLine, plain, voiceJsonSchema, mockVoice, type BankTags } from '../core/lineBank.js'
import { claimFlags } from '../core/scriptKit.js'
import { cleanVoiceCard, voiceCardText } from '../core/voiceCard.js'
import {
  assignBlend, checkWeekRow, currentStep, draftVisual, drawLines, hashSeed, lineLint, nearDuplicate, readLines, readWeek, rowHash, sheetRef, slotNumber, weekDays, weekOf,
  type CheckedWeekRow, type DrawSlot, type HistoryItem, type LifeOrJob, type PoolLine, type PostType, type VoiceFit, type WeekAccountInfo, type WeekCounts, type WeekRow,
} from '../core/weeks.js'
import { enqueueLocalJob, type JobSpec } from '../jobs/runner.js'
import { registerJobHook, registerLocalJob, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import type { RuleViolation } from '../core/rules.js'
import { getSetting, resolveRoute, setSetting } from './settings.js'
import { createContent, getContent, updateContent, type ContentRow } from './content.js'
import { createScene, getScene, updateScene } from './scenes.js'
import { getCharacter, listCharacters, toData, type CharacterRow } from './characters.js'
import { facelessOf, kindOf, buildFacelessStill, buildFacelessVideo, useStillAsset, readFacelessPost } from './faceless.js'
import { pullStill } from './facelessImport.js'
import { lightOf, postPictures, slidesOf } from './planImport.js'
import { buildSlideshowStills, slideModel, stillPathFor } from './slideshow.js'
import { buildChainedSceneVideo, buildSceneRun, buildSceneVideo } from './sceneActions.js'
import { PATH_LABELS, type StillPath } from '../core/stillModels.js'
import { trash } from './trash.js'
import { claimsOf, saveSocialAccount, scoreboard } from './scaleKit.js'
import { productOf } from './products.js'
import { lintFor } from './copyLint.js'
import { setPosting } from './postingDay.js'
import { STANCES_KEY, painsFor, type BankImport, IMPORTS_KEY } from './lineBank.js'
import { listSheets, readSheet, startDriveSend } from './drive.js'
import { withRunProvider } from './engines.js'
import type { BuiltAction } from './actions.js'

// Weeks (owner, 2026-10-22; UX-PLAN.md section 37): the plan CSV in (spec
// docs/PLAN-CSV-SPEC.md), the grid of a week by account and day, Fill
// (the draw from the line bank under rules a to e, then Fit to voice),
// the visual drafted from each line, the free Check, Make the week (one
// price: stills, then each video chained to its still, ten posts at a
// time under the daily cap), Review, and Send to Drive. A post's week state
// lives in its spec (`week`), saved on its own.

export const REVIEW_LOG_KEY = 'week_review_log'
const MAX_BYTES = 400_000
const MAX_ROWS = 300
const QUEUE = 10
const norm = (s: string) => s.trim().toLowerCase()

export interface WeekState {
  lineId?: string | null
  // csv: the plan gave the line; drawn: Fill drew it; null: none yet.
  lineFrom?: 'csv' | 'drawn' | null
  locked?: boolean
  fillFlag?: string | null
  fit?: { before: string; after: string; why: string; at: string } | null
  check?: { flags: string[]; at: string } | null
  review?: { call: 'approved' | 'killed'; at: string } | null
  drive?: { fileId?: string; folderId?: string; name?: string; sentAt?: string } | null
}
const weekOfPost = (row: ContentRow): WeekState => (((row.spec ?? {}) as { week?: WeekState | null }).week ?? {})
const planOf = (row: ContentRow) => planMetaSchema.parse(((row.spec ?? {}) as { plan?: unknown }).plan ?? {})

// A post's week state, merged and saved on its own: the post's last-changed
// time stays (like results and posting).
export async function patchWeek(deps: Deps, ctx: Ctx, postId: string, patch: Partial<WeekState>): Promise<void> {
  await deps.db.transaction(async tx => {
    const [row] = await tx.select({ id: contentItems.id, spec: contentItems.spec }).from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, postId))).for('update')
    if (!row) return
    const week = { ...(((row.spec ?? {}) as { week?: WeekState | null }).week ?? {}), ...patch }
    await tx.update(contentItems).set({ spec: sql`jsonb_set(coalesce(${contentItems.spec}, '{}'::jsonb), '{week}', ${JSON.stringify(week)}::jsonb, true)` }).where(eq(contentItems.id, row.id))
  })
}

// ── Accounts as Weeks sees them ───────────────────────────────────────

export interface WeekAccount extends WeekAccountInfo { deviceId: string; platform: string; lifeShare: number; saved: boolean }

export async function weekAccounts(deps: Deps, ctx: Ctx): Promise<Map<string, WeekAccount>> {
  const board = await scoreboard(deps, ctx)
  return new Map(board.accounts.map(a => [a.tag.toLowerCase(), { tag: a.tag, kind: a.kind as 'person' | 'faceless' | null, characterId: a.characterId, characterName: a.characterName, slotsPerDay: a.slotsPerDay, deviceId: a.deviceId, platform: a.platform, lifeShare: a.lifeShare, saved: a.saved }]))
}

// A new account named in a plan: its character from the row's character
// column, else the character whose name starts the tag (callie_tt_01).
function guessCharacter(chars: CharacterRow[], tag: string, named: string): CharacterRow | null {
  if (named) return chars.find(c => norm(c.name) === norm(named)) ?? null
  const t = norm(tag)
  return [...chars].sort((a, b) => b.name.length - a.name.length).find(c => t.startsWith(norm(c.name).replace(/\s+/g, '')) || t.startsWith(norm(c.name).replace(/\s+/g, '_'))) ?? null
}

// ── Import ────────────────────────────────────────────────────────────

export interface WeekPreviewRow {
  line: number; rowId: string; account: string; date: string; slot: number | null; postType: PostType | null; characterName: string
  text: string; lineId: string | null; state: 'new' | 'update' | 'kept' | 'problem'; errors: string[]; warnings: string[]; lint: string[]
}
export interface WeekPreview {
  rows: WeekPreviewRow[]; problems: string[]; weeks: string[]; newAccounts: Array<{ tag: string; characterName: string }>
  totals: { rows: number; ok: number; problem: number; matches: number; withLine: number }
}

async function plan(deps: Deps, ctx: Ctx, csv: string) {
  if (csv.length > MAX_BYTES) throw new AppError('bad_request', 'That file is too big for one import (400 KB). Split it.')
  const read = readWeek(csv)
  const problems: string[] = []
  if (read.missing.length) problems.push(`Missing column${read.missing.length === 1 ? '' : 's'}: ${read.missing.join(', ')}. The spec: docs/PLAN-CSV-SPEC.md (Read the spec on Weeks).`)
  if (read.unknown.length) problems.push(`Columns not used: ${read.unknown.join(', ')}.`)
  if (read.rows.length > MAX_ROWS) problems.push(`Only the first ${MAX_ROWS} rows are read.`)
  const rows = read.rows.slice(0, MAX_ROWS)
  const chars = await listCharacters(deps, ctx)
  const accounts = await weekAccounts(deps, ctx)
  // Accounts the file names that are not on the Accounts page yet.
  const fresh = new Map<string, WeekAccount>()
  for (const r of rows) {
    const tag = r.cells.account.replace(/^@+/, '').trim()
    if (!tag || accounts.has(tag.toLowerCase()) || fresh.has(tag.toLowerCase())) continue
    const ch = guessCharacter(chars, tag, r.cells.character)
    fresh.set(tag.toLowerCase(), { tag, kind: ch ? kindOf(ch) : null, characterId: ch?.id ?? null, characterName: ch?.name ?? '', slotsPerDay: deps.config.pipeline.content.weeks.slots_per_day, deviceId: '', platform: '', lifeShare: deps.config.pipeline.content.weeks.blend_fallback, saved: false })
  }
  const all = new Map([...accounts, ...fresh])
  const checked = rows.map(r => checkWeekRow(r, all))
  const ids = new Map<string, number>()
  for (const r of checked) ids.set(r.rowId, (ids.get(r.rowId) ?? 0) + 1)
  for (const r of checked) if (r.rowId && (ids.get(r.rowId) ?? 0) > 1) r.errors.push(`row_id ${r.rowId} is used more than once`)
  // A named character must exist.
  for (const [i, r] of checked.entries()) {
    const named = rows[i]!.cells.character.trim()
    if (named && !chars.some(c => norm(c.name) === norm(named))) r.errors.push(`No character named "${named}"`)
  }
  // A line_id must be in the bank and not used on another account.
  const lineIds = [...new Set(rows.map(r => r.cells.line_id).filter(Boolean))]
  const bank = lineIds.length ? await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), inArray(bankLines.id, lineIds))) : []
  for (const [i, r] of checked.entries()) {
    const id = rows[i]!.cells.line_id
    if (!id || rows[i]!.cells.line) continue
    const hit = bank.find(b => b.id === id)
    if (!hit) r.warnings.push(`line_id ${id} is not in the line bank: Fill draws one`)
    else if (hit.usedAccountTag && norm(hit.usedAccountTag) !== norm(r.account)) r.errors.push(`line_id ${id} is used on ${hit.usedAccountTag}: a line goes to one account only`)
  }
  // A product by name (rule two).
  const list = await deps.db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.accountId, ctx.accountId), isNull(products.archivedAt))).orderBy(asc(products.createdAt))
  const productOfRow = new Map<number, string>()
  for (const [i, r] of checked.entries()) {
    const name = rows[i]!.cells.product.trim()
    if (!name) continue
    const hit = list.find(p => norm(p.name) === norm(name))
    if (hit) productOfRow.set(r.line, hit.id)
    else r.errors.push(`Product "${name}" is not in Products: add it there, or fix the row`)
  }
  return { rows, checked, problems, all, fresh, chars, bank, productOfRow, productNames: list.map(p => p.name) }
}

// The plan's posts already made, by account and row_id (an import again
// asks Replace or Add; never silent).
async function existing(deps: Deps, ctx: Ctx): Promise<Map<string, ContentRow[]>> {
  const rows = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`))
  const out = new Map<string, ContentRow[]>()
  for (const r of rows) { const k = `${norm(r.accountTag)}|${planOf(r).rowId}`; out.set(k, [...(out.get(k) ?? []), r]) }
  return out
}

const hasPictures = (row: ContentRow) => {
  const s = (row.spec ?? {}) as { stillIds?: string[]; stillId?: string | null; clipId?: string | null }
  return row.kind === 'slideshow' ? (s.stillIds ?? []).some(Boolean) : !!(s.stillId || s.clipId)
}

export async function previewWeek(deps: Deps, ctx: Ctx, csv: string): Promise<WeekPreview> {
  const { rows, checked, problems, fresh, bank } = await plan(deps, ctx, csv)
  const made = await existing(deps, ctx)
  const lint = await lintFor(deps, ctx)
  const max = deps.config.pipeline.content.line_bank.max_words
  const out: WeekPreviewRow[] = checked.map((r, i) => {
    const c = rows[i]!.cells
    const text = c.line || bank.find(b => b.id === c.line_id)?.line || ''
    const old = made.get(`${norm(r.account)}|${r.rowId}`) ?? []
    const state: WeekPreviewRow['state'] = r.errors.length ? 'problem' : old.length ? (old.some(hasPictures) ? 'kept' : 'update') : 'new'
    const notes = text ? lineLint(text, { lists: lint.lists, maxWords: max, off: lint.off }).filter(p => !p.ok).map(p => `${p.n}. ${p.message}`) : []
    return { line: r.line, rowId: r.rowId, account: r.account, date: r.date, slot: r.slot, postType: r.postType, characterName: r.characterName, text, lineId: c.line_id || null, state, errors: r.errors, warnings: r.warnings, lint: notes }
  })
  const ok = out.filter(r => r.state !== 'problem')
  return {
    rows: out, problems, weeks: [...new Set(ok.map(r => weekOf(r.date)).filter(Boolean))].sort(),
    newAccounts: [...fresh.values()].map(a => ({ tag: a.tag, characterName: a.characterName })),
    totals: { rows: out.length, ok: ok.length, problem: out.length - ok.length, matches: ok.filter(r => r.state !== 'new').length, withLine: ok.filter(r => r.text).length },
  }
}

export interface WeekImportResult { created: number; replaced: number; skipped: number; posts: Array<{ rowId: string; id: string }>; weeks: string[]; noLine: number; pulls: number }

// "Import N rows" (free): each ticked good row a draft on the grid. A row
// matching posts already made needs Replace (the old posts and their
// pictures to the Trash, their bank lines freed) or Add as new.
export async function importWeek(deps: Deps, ctx: Ctx, csv: string, opts: { rows: string[]; existing?: 'replace' | 'add'; sheet?: { id: string; name: string; modifiedTime: string } }): Promise<WeekImportResult> {
  const picked = new Set(opts.rows.map(r => r.trim()).filter(Boolean))
  if (!picked.size) throw new AppError('invalid_request', 'Tick the rows to import first.')
  const p = await plan(deps, ctx, csv)
  const made = await existing(deps, ctx)
  const matching = p.checked.filter(r => picked.has(r.rowId) && !r.errors.length && (made.get(`${norm(r.account)}|${r.rowId}`) ?? []).length)
  if (matching.length && !opts.existing) throw new AppError('invalid_request', `${matching.length} row${matching.length === 1 ? ' matches posts' : 's match posts'} you already have. Pick Replace them (their pictures go to Trash) or Add as new posts.`)
  // New accounts go on the Accounts page, with the character they read as.
  for (const a of p.fresh.values()) if (p.checked.some(r => picked.has(r.rowId) && !r.errors.length && norm(r.account) === norm(a.tag))) await saveSocialAccount(deps, ctx, a.tag, { characterId: a.characterId })
  const out: WeekImportResult = { created: 0, replaced: 0, skipped: 0, posts: [], weeks: [], noLine: 0, pulls: 0 }
  const order = p.checked.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || (a.r.slot ?? 0) - (b.r.slot ?? 0) || a.r.line - b.r.line)
  for (const { r, i } of order) {
    if (!picked.has(r.rowId)) continue
    if (r.errors.length || !r.postType) { out.skipped++; continue }
    const old = made.get(`${norm(r.account)}|${r.rowId}`) ?? []
    let replaced = false
    if (old.length && opts.existing === 'replace') {
      for (const o of old) {
        await trash(deps, ctx, await postPictures(deps, ctx, o))
        await trash(deps, ctx, [{ kind: 'post', id: o.id }])
        await freeLines(deps, ctx, o.id)
      }
      replaced = true
    }
    const created = await draftRow(deps, ctx, p, p.rows[i]!, r, opts.sheet?.id ?? '')
    if (created.pull) out.pulls++
    if (!created.text) out.noLine++
    if (replaced) out.replaced++
    else out.created++
    out.posts.push({ rowId: r.rowId, id: created.id })
    const wk = weekOf(r.date)
    if (wk && !out.weeks.includes(wk)) out.weeks.push(wk)
  }
  out.weeks.sort()
  if (opts.sheet) await linkSheet(deps, ctx, opts.sheet, p.checked.filter(r => !r.errors.length).length)
  return out
}

// A bank line freed from a post (the post went to the Trash, or its line
// was drawn again): it can be drawn for any account again.
async function freeLines(deps: Deps, ctx: Ctx, postId: string, keep: string | null = null): Promise<void> {
  await deps.db.update(bankLines).set({ usedPostId: null, usedAccountTag: null, usedCharacterId: null, usedText: '', usedAt: null, usedDate: null, updatedAt: deps.clock.now() })
    .where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.usedPostId, postId), keep ? sql`${bankLines.id} <> ${keep}` : undefined))
}

type Plan = Awaited<ReturnType<typeof plan>>

async function draftRow(deps: Deps, ctx: Ctx, p: Plan, raw: WeekRow, r: CheckedWeekRow, sheetId = ''): Promise<{ id: string; text: string; pull: boolean }> {
  const c = raw.cells
  const acct = p.all.get(norm(r.account))!
  const ch = r.characterName ? p.chars.find(x => norm(x.name) === norm(r.characterName))! : p.chars.find(x => x.id === acct.characterId)!
  if (!ch) throw new AppError('invalid_request', `${r.rowId}: no character for ${r.account}.`)
  const bankLine = !c.line && c.line_id ? p.bank.find(b => b.id === c.line_id) ?? null : null
  const text = (c.line || bankLine?.line || '').slice(0, 300)
  const monday = weekOf(r.date)
  const meta = planMetaSchema.parse({
    rowId: r.rowId, planId: `week-${monday}`, date: r.date, slot: String(r.slot ?? ''), format: r.postType!, week: monday, postType: r.postType!,
    deviceId: c.device_id, lifeOrJob: r.lifeOrJob ?? '', voiceFit: r.voiceFit ?? '', storyBeat: c.story_beat.slice(0, 800), lineId: bankLine?.id ?? '',
    placeId: c.place_id.slice(0, 60), videoPrompt: c.video_prompt.slice(0, 2000), soundName: c.sound_name.slice(0, 200), soundType: c.sound_type.slice(0, 20), voiceoverClip: c.voiceover_clip.slice(0, 200),
    lane: c.lane.slice(0, 60), lineFormat: c.line_format.slice(0, 60), feeling: c.feeling.slice(0, 60), topic: c.topic.slice(0, 60),
    product: /^(?:y|yes|true|1)$/i.test(c.ad), notes: c.notes.slice(0, 1500), scene: c.scene.slice(0, 4000), clipAction: c.clip_action.slice(0, 2000),
    caption: c.caption.slice(0, 2200), hashtags: hashtagsOf(c.hashtags).slice(0, 15),
    sheetId, rowHash: rowHash(c),
  })
  const week: WeekState = { lineId: bankLine?.id ?? null, lineFrom: text ? 'csv' : null, locked: false }
  const title = `${r.rowId}: ${text || c.story_beat || r.postType}`.slice(0, 120)
  const productId = p.productOfRow.get(r.line) ?? null
  const accountTag = acct.tag
  let id: string, pull = false
  if (r.postType === 'faceless') {
    const file = facelessOf(ch)
    const place = c.place_id ? file.places.find(x => x.id === c.place_id) ?? null : null
    const row = await createContent(deps, ctx, {
      kind: 'meme', characterId: ch.id, title, idea: c.story_beat || text, accountTag, step: 'stills', productId,
      spec: { caption: text, plan: meta, week, faceless: { placeId: place?.id ?? null, line: c.scene.slice(0, 800), videoPrompt: (c.video_prompt || c.clip_action || place?.motion || '').slice(0, 2000), postCaption: c.caption.slice(0, 2200), hashtags: hashtagsOf(c.hashtags).slice(0, 15), musicName: c.sound_name.slice(0, 120), voiceover: c.voiceover_clip ? { search: c.voiceover_clip.slice(0, 200), note: '' } : null, posted: false } },
    })
    id = row.id
    const job = c.still_job_id || place?.stillJobId
    if (job) { await queuePull(deps, ctx, row.id, job); pull = true }
  } else if (r.postType === 'clip') {
    const light = lightOf(deps, c.light)
    const moment = (c.clip_action.split(/(?<=[.!?])\s+/)[0] ?? '') || c.story_beat
    const fields = { setting: [c.scene, light.words].filter(Boolean).join('. ').slice(0, 400), outfit: c.outfit.slice(0, 300), moment: moment.slice(0, 400), ...(light.id ? { light: light.id } : {}) }
    const scene = await createScene(deps, ctx, ch.id, { brief: c.scene || c.story_beat, title: r.rowId, fields })
    const motion = c.video_prompt || c.clip_action
    if (motion) await updateScene(deps, ctx, scene.id, { prompts: { video: motion.slice(0, 3000) } })
    id = (await createContent(deps, ctx, { kind: 'meme', characterId: ch.id, title, idea: c.story_beat || text, accountTag, sceneId: scene.id, step: 'stills', productId, spec: { caption: text, plan: meta, week } })).id
  } else {
    // A photo is a one-slide character slideshow; a slideshow has slides 2
    // to 6 after the line (the launch plan's own reader makes the slides).
    const cells = Object.fromEntries(['row_id', 'date', 'slot', 'account', 'format', 'tension', 'pillar', 'audience', 'product', 'ad', 'mention_mother', 'structure', 'effect_open', 'effect_payoff', 'hook_score', 'moment_id', 'moment', 'hook', 'alt_hook', 'slide_2', 'slide_3', 'slide_4', 'slide_5', 'slide_6', 'scene', 'clip_action', 'caption', 'hashtags', 'cta', 'stat_source', 'notes', 'place', 'light', 'outfit', 'detail_1', 'detail_2', 'slide_1_image', 'slide_2_image', 'slide_3_image', 'slide_4_image', 'slide_5_image', 'slide_6_image'].map(k => [k, ''])) as Record<PlanColumn, string>
    Object.assign(cells, { hook: text, moment: c.story_beat, scene: c.scene, light: c.light, outfit: c.outfit, caption: c.caption, hashtags: c.hashtags, slide_2: c.slide_2, slide_3: c.slide_3, slide_4: c.slide_4, slide_5: c.slide_5, slide_6: c.slide_6, slide_1_image: c.slide_1_image || (r.postType === 'photo' ? c.scene : ''), slide_2_image: c.slide_2_image, slide_3_image: c.slide_3_image, slide_4_image: c.slide_4_image, slide_5_image: c.slide_5_image, slide_6_image: c.slide_6_image })
    const kind = r.postType === 'photo' ? 'photo' as const : 'character_slideshow' as const
    const planRow: PlanRow = { line: r.line, cells }
    const s = slidesOf(deps, planRow, kind, true, p.productNames)
    const light = lightOf(deps, s.scene.light)
    const spec: Partial<SlideshowSpec> = {
      hook: s.texts[0]!.slice(0, 200), slides: s.texts.slice(1).map(t => t.slice(0, 300)), slideCount: Math.max(3, Math.min(10, s.texts.length)),
      mode: 'character', shots: s.shots, specials: s.specials, asWritten: s.asWritten, stillIds: [], textPos: [], people: kind === 'photo' ? ['character'] : [],
      lock: slideshowSpecSchema.shape.lock.parse({ place: [s.scene.place, light.words].filter(Boolean).join('. ').slice(0, 1000), light: light.id, details: [], outfit: s.scene.outfit.slice(0, 300), hair: s.scene.hair.slice(0, 200), ownerSet: ['place', 'outfit', 'hair', 'light', 'camera', 'details'] }),
      caption: c.caption.slice(0, 2200), hashtags: hashtagsOf(c.hashtags).slice(0, 15), ctaLine: '', ad: meta.product,
      cta: { kind: 'own', handle: '', word: '' }, pattern: null, hookIdeas: [], hookReview: null, plan: meta, week: week as Record<string, unknown>,
    }
    id = (await createContent(deps, ctx, { kind: 'slideshow', characterId: ch.id, title, idea: c.story_beat || text, accountTag, step: 'stills', spec, productId })).id
  }
  if (bankLine) await useLine(deps, ctx, bankLine.id, { id, accountTag, characterId: ch.id, text, date: r.date })
  return { id, text, pull }
}

async function useLine(deps: Deps, ctx: Ctx, lineId: string, post: { id: string; accountTag: string; characterId: string | null; text: string; date: string }): Promise<void> {
  await deps.db.update(bankLines).set({ usedPostId: post.id, usedAccountTag: post.accountTag, usedCharacterId: post.characterId, usedText: post.text, usedAt: deps.clock.now(), usedDate: post.date || null, updatedAt: deps.clock.now() })
    .where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.id, lineId)))
}

// A place's own still (still_job_id), pulled free on the worker.
async function queuePull(deps: Deps, ctx: Ctx, postId: string, jobId: string): Promise<void> {
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `week_pull:${postId}`, label: `Pull the place's still (${jobId.slice(0, 8)})`, characterId: null, request: { postId, jobId } })
}
async function runPull(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const req = job.request as { postId: string; jobId: string }
  const row = await getContent(deps, ctx, req.postId)
  if ((row.spec as { stillId?: string | null }).stillId) return { skipped: 'the post has its still' }
  const assetId = await pullStill(deps, ctx, { jobId: req.jobId })
  await useStillAsset(deps, ctx, row.id, assetId, `Place still ${req.jobId.slice(0, 8)}`)
  return { assetId }
}

// ── The grid ──────────────────────────────────────────────────────────

const ACTIVE = ['waiting', 'queued', 'submitting', 'running', 'ingesting']

export interface WeekCell {
  postId: string; account: string; date: string; slot: number; rowId: string; postType: PostType; kind: string; characterId: string | null
  line: string; lineId: string | null; lineFrom: WeekState['lineFrom']; locked: boolean; lifeOrJob: LifeOrJob | null; storyBeat: string
  // The sound to add in the app (section 42 D): its name and type.
  sound: { name: string; type: string } | null
  fillFlag: string | null; flags: string[]; checked: boolean; fit: WeekState['fit']
  need: number; have: number; video: boolean; hasVideo: boolean; made: boolean; making: number
  thumbAssetId: string | null; videoAssetId: string | null; review: 'approved' | 'killed' | null; approved: boolean; sentAt: string | null; driveName: string
}

export async function weekPosts(deps: Deps, ctx: Ctx, monday: string): Promise<ContentRow[]> {
  const days = weekDays(monday)
  return deps.db.select().from(contentItems).where(and(
    eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), inArray(contentItems.kind, ['meme', 'slideshow']),
    sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`, sql`${contentItems.spec}->'plan'->>'date' >= ${days[0]!}`, sql`${contentItems.spec}->'plan'->>'date' <= ${days[6]!}`,
  ))
}

const postTypeOf = (row: ContentRow, p: PlanMeta): PostType => {
  if (['slideshow', 'clip', 'photo', 'faceless'].includes(p.postType)) return p.postType as PostType
  if (row.kind === 'meme') return ((row.spec as { faceless?: unknown }).faceless ? 'faceless' : 'clip')
  return /photo/i.test(p.format) ? 'photo' : 'slideshow'
}
export const lineOf = (row: ContentRow) => String((row.kind === 'slideshow' ? (row.spec as { hook?: string }).hook : (row.spec as { caption?: string }).caption) ?? '')
const needsVideo = (type: PostType) => type === 'clip' || type === 'faceless'

export async function weekCells(deps: Deps, ctx: Ctx, rows: ContentRow[]): Promise<WeekCell[]> {
  // A person clip's stills and takes are its scene's.
  const sceneIds = rows.filter(r => r.kind === 'meme' && r.sceneId).map(r => r.sceneId!)
  const cands = sceneIds.length ? await deps.db.select({ id: candidates.id, sceneId: candidates.sceneId, op: candidates.op, assetId: candidates.assetId, createdAt: candidates.createdAt }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.sceneId, sceneIds), isNotNull(candidates.assetId), sql`${candidates.status} not in ('trashed', 'purged', 'failed', 'superseded')`)).orderBy(desc(candidates.createdAt)) : []
  const stillIds = rows.flatMap(r => r.kind === 'slideshow' ? (((r.spec as { stillIds?: string[] }).stillIds ?? []).filter(Boolean)) : [])
  const slideAssets = new Map((stillIds.length ? await deps.db.select({ id: candidates.id, assetId: candidates.assetId }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, stillIds))) : []).map(c => [c.id, c.assetId]))
  const postIds = rows.map(r => r.id)
  const active = rows.length ? await deps.db.select({ purpose: jobs.purpose }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), inArray(jobs.status, ACTIVE), or(
    ...['slide_still', 'faceless_still', 'faceless_video', 'week_pull'].map(p => like(jobs.purpose, `${p}:%`)), like(jobs.purpose, 'scene:%'), like(jobs.purpose, 'scene_video:%'), like(jobs.purpose, 'drift_lock:%'),
  ))) : []
  const busy = new Map<string, number>()
  for (const j of active) { const key = j.purpose.split(':')[1] ?? ''; busy.set(key, (busy.get(key) ?? 0) + 1) }
  return rows.map(r => {
    const p = planOf(r)
    const w = weekOfPost(r)
    const type = postTypeOf(r, p)
    const spec = (r.spec ?? {}) as { stillId?: string | null; clipId?: string | null; faceless?: { stillAssetId?: string; clipAssetId?: string } | null; posting?: { approved?: boolean } | null }
    let need = 0, have = 0, thumb: string | null = null, videoAsset: string | null = null
    if (r.kind === 'slideshow') {
      const s = slideshowSpecSchema.parse(r.spec ?? {})
      for (const sl of slideList(s)) { if (sl.special) continue; need++; if (sl.stillId) { have++; thumb ??= slideAssets.get(sl.stillId) ?? null } }
    } else if (spec.faceless) {
      need = 1; have = spec.stillId ? 1 : 0; thumb = spec.faceless.stillAssetId ?? null; videoAsset = spec.faceless.clipAssetId ?? null
    } else {
      const mine = cands.filter(c => c.sceneId === r.sceneId)
      const still = mine.find(c => c.op !== 'video' && c.op !== 'last_frame')
      const take = mine.find(c => c.op === 'video')
      need = 1; have = still ? 1 : 0; thumb = still?.assetId ?? null; videoAsset = take?.assetId ?? null
    }
    const video = r.kind === 'meme' && (needsVideo(type) || !!p.videoPrompt)
    const hasVideo = !!videoAsset
    const making = (busy.get(r.id) ?? 0) + (r.sceneId ? busy.get(r.sceneId) ?? 0 : 0)
    const line = lineOf(r)
    return {
      postId: r.id, account: r.accountTag, date: p.date, slot: slotNumber(p.slot) ?? 1, rowId: p.rowId, postType: type, kind: r.kind, characterId: r.characterId,
      line, lineId: w.lineId ?? null, lineFrom: w.lineFrom ?? (line ? 'csv' : null), locked: !!w.locked, lifeOrJob: (p.lifeOrJob || null) as LifeOrJob | null, storyBeat: p.storyBeat,
      sound: (() => { const name = (p as { soundName?: string }).soundName || String((spec as { faceless?: { musicName?: string } }).faceless?.musicName ?? ''); return name ? { name, type: (p as { soundType?: string }).soundType || '' } : null })(),
      fillFlag: w.fillFlag ?? null, flags: w.check?.flags ?? [], checked: !!w.check, fit: w.fit ?? null,
      need, have, video, hasVideo, made: need > 0 && have >= need && (!video || hasVideo), making,
      thumbAssetId: thumb, videoAssetId: videoAsset, review: w.review?.call ?? null, approved: !!spec.posting?.approved, sentAt: w.drive?.sentAt ?? null, driveName: w.drive?.name ?? '',
    }
  })
}

function countsOf(cells: WeekCell[]): WeekCounts {
  const live = cells.filter(c => c.review !== 'killed')
  return {
    posts: cells.length, noLine: live.filter(c => !c.line.trim()).length, flagged: live.filter(c => c.flags.length).length, unchecked: live.filter(c => !c.checked).length,
    toMake: live.filter(c => !c.made && !c.making && !c.flags.length).length, making: live.filter(c => c.making > 0).length,
    toReview: live.filter(c => c.made && !c.review).length, approved: cells.filter(c => c.approved).length, killed: cells.length - live.length,
    toSend: cells.filter(c => c.approved && !c.sentAt).length, sent: cells.filter(c => c.sentAt).length,
  }
}

export async function weekView(deps: Deps, ctx: Ctx, monday: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday) || weekOf(monday) !== monday) throw new AppError('invalid_request', 'A week starts on a Monday (YYYY-MM-DD).')
  const rows = await weekPosts(deps, ctx, monday)
  const cells = (await weekCells(deps, ctx, rows)).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)
  const accounts = await weekAccounts(deps, ctx)
  const used = [...new Set(cells.map(c => c.account))]
  const list = [...used.map(t => accounts.get(t.toLowerCase()) ?? { tag: t, kind: null, characterId: null, characterName: '', slotsPerDay: 1, deviceId: '', platform: '', lifeShare: 50, saved: false }), ...[...accounts.values()].filter(a => !used.some(t => norm(t) === norm(a.tag)) && a.characterId)]
  const counts = countsOf(cells)
  const fits = cells.filter(c => c.fit).length
  return { monday, days: weekDays(monday), accounts: list.map(a => ({ ...a, slotsPerDay: Math.max(a.slotsPerDay, ...cells.filter(c => norm(c.account) === norm(a.tag)).map(c => c.slot), 1) })), cells, counts, step: currentStep(counts), fitsWaiting: fits }
}

// Every week with plan posts (the week picker), newest first.
export async function weekList(deps: Deps, ctx: Ctx): Promise<Array<{ monday: string; posts: number }>> {
  const rows = await deps.db.select({ date: sql<string>`${contentItems.spec}->'plan'->>'date'`, n: sql<number>`count(*)` }).from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), inArray(contentItems.kind, ['meme', 'slideshow']), sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`, sql`coalesce(${contentItems.spec}->'plan'->>'date', '') <> ''`))
    .groupBy(sql`${contentItems.spec}->'plan'->>'date'`)
  const by = new Map<string, number>()
  for (const r of rows) { const m = weekOf(r.date); if (m) by.set(m, (by.get(m) ?? 0) + Number(r.n)) }
  return [...by.entries()].map(([monday, posts]) => ({ monday, posts })).sort((a, b) => b.monday.localeCompare(a.monday))
}

// ── Fill ──────────────────────────────────────────────────────────────

const tagsOf = (r: { tags: unknown }) => (r.tags ?? {}) as Partial<BankTags>
const fitOf = (f: unknown): VoiceFit => (f === 'first' || f === 'secondhand' ? f : 'both')

// How a character tells a line: the owner's pick on the line bank, else a
// faceless character first person, else from their voice card.
async function stanceOf(deps: Deps, ctx: Ctx, ch: CharacterRow, picked: Record<string, 'first' | 'secondhand'>): Promise<'first' | 'secondhand'> {
  if (picked[ch.id]) return picked[ch.id]!
  if (kindOf(ch) === 'faceless') return 'first'
  const { voiceOf } = await import('./lineBank.js')
  return (await voiceOf(deps, ctx, ch.id)).stance
}

export interface DrawRow { postId: string; account: string; date: string; slot: number; rowId: string; lineId: string | null; line: string; pain: string; emotion: string; format: string; fits: VoiceFit; lifeOrJob: LifeOrJob; kept: boolean; locked: boolean; from: 'csv' | 'drawn' | 'draft' | null; flag: string | null }

// The draw (free, nothing saved): every post of the week, the ones with a
// line kept (the plan's own, a locked one, a saved one not redrawn, a
// draft one not redrawn), the rest drawn. redraw: 'empty' (posts with no
// line), 'all' (every post not locked and not the plan's), or post ids.
export async function drawWeek(deps: Deps, ctx: Ctx, monday: string, input: { seed: number; redraw: 'empty' | 'all' | string[]; draft?: Record<string, string | null>; accounts?: string[] }): Promise<{ rows: DrawRow[]; seed: number; drawn: number; empty: number; pool: number }> {
  const rows = (await weekPosts(deps, ctx, monday)).filter(r => !input.accounts?.length || input.accounts.some(a => norm(a) === norm(r.accountTag)))
  const live = rows.filter(r => weekOfPost(r).review?.call !== 'killed')
  const accounts = await weekAccounts(deps, ctx)
  const chars = new Map((await listCharacters(deps, ctx)).map(c => [c.id, c]))
  const picked = await getSetting<Record<string, 'first' | 'secondhand'>>(deps.db, ctx.accountId, STANCES_KEY, {})
  const stances = new Map<string, 'first' | 'secondhand'>()
  for (const r of live) if (r.characterId && !stances.has(r.characterId)) stances.set(r.characterId, await stanceOf(deps, ctx, chars.get(r.characterId)!, picked))
  const draft = input.draft ?? {}
  const redrawSet = new Set(Array.isArray(input.redraw) ? input.redraw : [])
  const isRedrawn = (r: ContentRow) => {
    const w = weekOfPost(r)
    if (w.locked) return false
    const line = lineOf(r).trim()
    const from = w.lineFrom ?? (line ? 'csv' : null)
    if (from === 'csv') return false
    if (input.redraw === 'all') return true
    if (input.redraw === 'empty') return !line && !(r.id in draft && draft[r.id])
    return redrawSet.has(r.id)
  }
  const redrawn = new Set(live.filter(isRedrawn).map(r => r.id))
  // The bank: lines that passed, not used anywhere (or used by a post of
  // this week that is drawn again, which frees it).
  const all = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.passed, true)))
  const byId = new Map(all.map(l => [l.id, l]))
  const draftIds = new Set(Object.entries(draft).filter(([pid, id]) => id && !redrawn.has(pid)).map(([, id]) => id!))
  // A slot drawn again gets another line: its current one (drafted or saved) is out.
  const current = new Set([...Object.entries(draft).filter(([pid, id]) => id && redrawn.has(pid)).map(([, id]) => id!), ...live.filter(r => redrawn.has(r.id)).map(r => weekOfPost(r).lineId).filter((x): x is string => !!x)])
  const pool: PoolLine[] = all.filter(l => !draftIds.has(l.id) && !current.has(l.id) && (!l.usedPostId || redrawn.has(l.usedPostId))).map(l => {
    const t = tagsOf(l)
    return { id: l.id, text: l.line, pain: t.pain ?? '', emotion: t.emotion ?? '', format: t.format ?? '', fits: fitOf(t.fits), lifeOrJob: (l.lifeOrJob as LifeOrJob | null) ?? null, usedAccount: null, fight: !!t.fight }
  })
  // Each account's posts before this week (rule a looks back across weeks).
  const tags = [...new Set(live.map(r => r.accountTag))]
  const before = tags.length ? await deps.db.select({ tag: bankLines.usedAccountTag, date: bankLines.usedDate, tags: bankLines.tags }).from(bankLines)
    .where(and(eq(bankLines.accountId, ctx.accountId), inArray(bankLines.usedAccountTag, tags), lt(bankLines.usedDate, monday))).orderBy(asc(bankLines.usedDate)) : []
  const history = new Map<string, HistoryItem[]>()
  for (const b of before) { const t = tagsOf(b); const k = norm(b.tag ?? ''); history.set(k, [...(history.get(k) ?? []), { pain: t.pain ?? '', emotion: t.emotion ?? '', format: t.format ?? '' }]) }
  const slots: DrawSlot[] = live.map(r => {
    const p = planOf(r)
    const w = weekOfPost(r)
    const keepId = redrawn.has(r.id) ? null : (r.id in draft ? draft[r.id] ?? null : w.lineId ?? null)
    const line = lineOf(r).trim()
    const keepLine = keepId ? byId.get(keepId) : null
    const keep = redrawn.has(r.id) ? null : keepLine ? { lineId: keepLine.id, pain: tagsOf(keepLine).pain ?? '', emotion: tagsOf(keepLine).emotion ?? '', format: tagsOf(keepLine).format ?? '' } : line ? { lineId: null, pain: '', emotion: '', format: '' } : null
    return { postId: r.id, account: r.accountTag, date: p.date, slot: slotNumber(p.slot) ?? 1, lifeOrJob: (p.lifeOrJob || null) as LifeOrJob | null, voiceFit: (p.voiceFit || null) as VoiceFit | null, stance: r.characterId ? stances.get(r.characterId) ?? 'secondhand' : 'secondhand', keep }
  })
  const blend = new Map<string, LifeOrJob>()
  for (const tag of tags) {
    const mine = slots.filter(s => norm(s.account) === norm(tag))
    const share = accounts.get(norm(tag))?.lifeShare ?? deps.config.pipeline.content.weeks.blend_fallback
    for (const [k, v] of assignBlend(mine.map(s => ({ postId: s.postId, lifeOrJob: s.lifeOrJob ?? (s.keep?.lineId ? ((byId.get(s.keep.lineId)?.lifeOrJob as LifeOrJob | null) ?? null) : null) })), share, hashSeed(input.seed, tag))) blend.set(k, v)
  }
  const draws = drawLines({ slots, pool, history, blend, seed: input.seed, rules: deps.config.pipeline.content.weeks.rules })
  const postsById = new Map(live.map(r => [r.id, r]))
  const out: DrawRow[] = draws.map(d => {
    const r = postsById.get(d.postId)!
    const p = planOf(r)
    const w = weekOfPost(r)
    const l = d.lineId ? byId.get(d.lineId) : null
    const t = l ? tagsOf(l) : {}
    const text = d.kept && !d.lineId ? lineOf(r) : l?.line ?? ''
    const from: DrawRow['from'] = d.kept ? (r.id in draft && !w.locked ? 'draft' : (w.lineFrom ?? (lineOf(r) ? 'csv' : null))) : d.lineId ? 'draft' : null
    return { postId: r.id, account: r.accountTag, date: p.date, slot: slotNumber(p.slot) ?? 1, rowId: p.rowId, lineId: d.lineId, line: d.kept && w.lineFrom !== 'csv' && w.lineId === d.lineId ? lineOf(r) || text : text, pain: t.pain ?? '', emotion: t.emotion ?? '', format: t.format ?? '', fits: fitOf(t.fits), lifeOrJob: d.lifeOrJob, kept: d.kept && from !== 'draft', locked: !!w.locked, from, flag: d.flag }
  }).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot || a.account.localeCompare(b.account))
  return { rows: out, seed: input.seed, drawn: out.filter(r => !r.kept && r.lineId).length, empty: out.filter(r => !r.lineId && !r.line).length, pool: pool.length }
}

// Save the draw: each line on its post (a slideshow's slide 1, a video's
// on-screen line), the bank line marked used on that account and day (a
// line freed when its post got another), empty slots flagged, and the
// visual drafted for every post that has none (item 11).
export async function saveFill(deps: Deps, ctx: Ctx, monday: string, input: { rows: Array<{ postId: string; lineId: string | null; lifeOrJob: LifeOrJob; flag?: string | null }> }): Promise<{ filled: number; empty: number; drafted: number; pulls: number }> {
  const rows = new Map((await weekPosts(deps, ctx, monday)).map(r => [r.id, r]))
  let filled = 0, empty = 0
  for (const a of input.rows) {
    const post = rows.get(a.postId)
    if (!post) continue
    const w = weekOfPost(post)
    const p = planOf(post)
    if (w.lineFrom === 'csv' || (w.locked && w.lineId === a.lineId)) continue
    if (!a.lineId) {
      if (!lineOf(post).trim()) { await patchWeek(deps, ctx, post.id, { fillFlag: a.flag ?? null }); empty++ }
      continue
    }
    if (a.lineId === w.lineId) continue
    const [line] = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.id, a.lineId)))
    if (!line || !line.passed) throw new AppError('invalid_request', 'A drawn line is no longer in the bank. Draw again.')
    if (line.usedPostId && line.usedPostId !== post.id && rows.get(line.usedPostId) === undefined) throw new AppError('invalid_request', `"${line.line}" was used on ${line.usedAccountTag} since the draw. Draw again.`)
    await freeLines(deps, ctx, post.id, line.id)
    const text = line.line
    await updateContent(deps, ctx, post.id, { spec: (post.kind === 'slideshow' ? { hook: text, plan: { ...p, lifeOrJob: a.lifeOrJob, lineId: line.id } } : { caption: text, captionOff: false, plan: { ...p, lifeOrJob: a.lifeOrJob, lineId: line.id } }) as never })
    await useLine(deps, ctx, line.id, { id: post.id, accountTag: post.accountTag, characterId: post.characterId, text, date: p.date })
    await patchWeek(deps, ctx, post.id, { lineId: line.id, lineFrom: 'drawn', fillFlag: null, fit: null, check: null })
    filled++
  }
  const drafted = await draftVisuals(deps, ctx, monday)
  return { filled, empty, ...drafted }
}

// A scene's video prompt as written (the owner's or the writer's).
const videoText = (scene: { prompts: unknown }) => String(((scene.prompts ?? {}) as { video?: { text?: string } | null }).video?.text ?? '').trim()

// Item 11: every post with a line and no scene gets one (free, by code).
export async function draftVisuals(deps: Deps, ctx: Ctx, monday: string): Promise<{ drafted: number; pulls: number }> {
  const rows = await weekPosts(deps, ctx, monday)
  const chars = new Map((await listCharacters(deps, ctx)).map(c => [c.id, c]))
  const placeUse = new Map<string, number>()
  for (const r of rows) { const f = (r.spec as { faceless?: { placeId?: string | null } | null }).faceless; if (f?.placeId) placeUse.set(f.placeId, (placeUse.get(f.placeId) ?? 0) + 1) }
  const settings = deps.config.pipeline.content.weeks.settings
  let drafted = 0, pulls = 0
  for (const r of rows) {
    const line = lineOf(r).trim()
    const ch = r.characterId ? chars.get(r.characterId) : null
    if (!line || !ch) continue
    const p = planOf(r)
    const type = postTypeOf(r, p)
    const seed = hashSeed(r.id)
    if (type === 'faceless') {
      const f = readFacelessPost((r.spec as { faceless?: unknown }).faceless)
      if (f.placeId || f.line.trim() || (r.spec as { stillId?: string | null }).stillId) continue
      const file = facelessOf(ch)
      const v = draftVisual({ postType: 'faceless', line, storyBeat: p.storyBeat, name: ch.name, places: file.places.map(x => ({ id: x.id, name: x.name, line: x.line, motion: x.motion ?? '' })), placeUse, sounds: file.sounds.map(s => ({ name: s.name, search: s.search, kind: s.kind })), settings: [], seed })
      if (v.placeId) placeUse.set(v.placeId, (placeUse.get(v.placeId) ?? 0) + 1)
      const prev = ((r.spec as { faceless?: Record<string, unknown> | null }).faceless ?? {})
      await updateContent(deps, ctx, r.id, { spec: { faceless: { ...prev, placeId: v.placeId, line: v.placeId ? '' : v.scene.slice(0, 800), videoPrompt: (f.videoPrompt || v.videoPrompt).slice(0, 2000), musicName: (prev.musicName as string | undefined) || v.soundName } } as never })
      const place = v.placeId ? file.places.find(x => x.id === v.placeId) : null
      if (place?.stillJobId) { await queuePull(deps, ctx, r.id, place.stillJobId); pulls++ }
      drafted++
    } else if (r.kind === 'meme' && r.sceneId) {
      const scene = await getScene(deps, ctx, r.sceneId)
      const fields = (scene.fields ?? {}) as { setting?: string; moment?: string }
      const video = videoText(scene)
      if ((fields.setting ?? '').trim() && video) continue
      const v = draftVisual({ postType: type, line, storyBeat: p.storyBeat, name: ch.name, places: [], placeUse, sounds: [], settings, seed })
      await updateScene(deps, ctx, scene.id, { ...((fields.setting ?? '').trim() ? {} : { fields: { setting: v.scene.slice(0, 400), ...((fields.moment ?? '').trim() ? {} : { moment: (p.storyBeat || line).slice(0, 400) }) } }), ...(video || !v.videoPrompt ? {} : { prompts: { video: v.videoPrompt } }) })
      drafted++
    } else if (r.kind === 'slideshow') {
      const s = slideshowSpecSchema.parse(r.spec ?? {})
      const shots = s.shots.length ? [...s.shots] : Array.from({ length: Math.max(1, s.slides.length + 1) }, () => '')
      if (s.lock.place.trim() && shots.every(x => x.trim())) continue
      const v = draftVisual({ postType: type, line, storyBeat: p.storyBeat, name: ch.name, places: [], placeUse, sounds: [], settings, seed })
      await updateContent(deps, ctx, r.id, { spec: { lock: { ...s.lock, place: s.lock.place.trim() || v.scene.slice(0, 1000) }, shots: shots.map((x, i) => x.trim() || (i === 0 ? v.scene : `${s.slides[i - 1] ?? ''}`.trim() || v.scene).slice(0, 800)) } as never })
      drafted++
    }
  }
  return { drafted, pulls }
}

export async function setLock(deps: Deps, ctx: Ctx, postId: string, locked: boolean): Promise<void> {
  await getContent(deps, ctx, postId)
  await patchWeek(deps, ctx, postId, { locked })
}

// ── Fit to voice (item 10, priced) ────────────────────────────────────

// Each drawn line in the character's voice, fitted to its story beat;
// before and after, waiting for the owner's OK.
export async function buildWeekFit(deps: Deps, ctx: Ctx, input: { week: string; postIds?: string[] }): Promise<BuiltAction> {
  const rows = (await weekPosts(deps, ctx, input.week)).filter(r => lineOf(r).trim() && (!input.postIds?.length || input.postIds.includes(r.id)) && weekOfPost(r).review?.call !== 'killed')
  if (!rows.length) throw new AppError('invalid_request', 'No post of this week has a line yet: Fill first.')
  const byChar = new Map<string, ContentRow[]>()
  for (const r of rows) if (r.characterId) byChar.set(r.characterId, [...(byChar.get(r.characterId) ?? []), r])
  const route = await resolveRoute(deps, ctx, 'line_voice')
  const t = deps.config.pipeline.templates.week_fit
  const max = deps.config.pipeline.content.line_bank.max_words
  const picked = await getSetting<Record<string, 'first' | 'secondhand'>>(deps.db, ctx.accountId, STANCES_KEY, {})
  const specs: JobSpec[] = []
  for (const [characterId, list] of byChar) {
    const ch = await getCharacter(deps, ctx, characterId)
    const stance = await stanceOf(deps, ctx, ch, picked)
    const data = toData(ch)
    const face = kindOf(ch) === 'faceless' ? facelessOf(ch) : null
    const v = cleanVoiceCard(data.persona.voice)
    const voice = face ? `${ch.name}: ${face.persona.who} ${face.persona.town}. ${face.persona.life} How he talks: ${face.voice.notes} ${face.voice.formats.join(' ')}` : voiceCardText(ch.name, v) || `${ch.name} has no voice card yet: keep the line's own voice.`
    const system = fill(t.system, { max_words: String(max), voice, stance: stance === 'first' ? 'in the first person: it happened to them' : 'secondhand: it happened to a friend, a sister or a roommate, never as their own' })
    const prompt = fill(t.prompt, { lines: list.map((r, i) => `${i + 1}. Line: ${lineOf(r)}\n   Story beat that day: ${planOf(r).storyBeat || '(none: keep the line\'s own moment)'}`).join('\n'), count: String(list.length) })
    specs.push({ type: 'llm', stage: 'content', purpose: `week_fit:${input.week}`, label: `Fit ${list.length} line${list.length === 1 ? '' : 's'} to ${ch.name}'s voice`, characterId, request: { model: route.model, system, prompt, schema: voiceJsonSchema(list.length), schemaName: 'week_fit', maxTokens: 200 + 110 * list.length, effort: route.effort ?? 'low', meta: { postIds: list.map(r => r.id), befores: list.map(lineOf), mockVoice: mockVoice(list.map(l => lineOf(l).toLowerCase().replace(/[.!\s]+$/, ''))) } } })
  }
  return {
    purpose: `week_fit:${input.week}`, characterId: null, specs,
    preview: { title: `Fit ${rows.length} line${rows.length === 1 ? '' : 's'} to voice (before and after; nothing changes until you OK it)`, prompts: specs.slice(0, 2).map(s => { const r = (s as Extract<JobSpec, { type: 'llm' }>).request; return { label: s.label, text: `${r.system}\n${r.prompt}`, wrapped: hardWrap(`${r.system}\n${r.prompt}`) } }), warnings: [], invalidates: [] },
  }
}

async function onFit(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const meta = (job.request as { meta?: { postIds?: string[]; befores?: string[] } }).meta ?? {}
  const got = new Map((((out.data as { results?: unknown })?.results ?? []) as Array<{ n?: number; line?: string; fits?: boolean; why?: string }>).map(x => [Math.round(Number(x.n)), x]))
  for (const [i, postId] of (meta.postIds ?? []).entries()) {
    const r = got.get(i + 1)
    const after = cleanLine(r?.line)
    await patchWeek(deps, ctx, postId, { fit: { before: meta.befores?.[i] ?? '', after: r?.fits === false ? '' : after, why: String(r?.why ?? '').slice(0, 240), at: deps.clock.now().toISOString() } })
  }
}

// The owner's OK on Fit to voice: the after line goes on the post (and on
// its bank line's record); No keeps the line as it was.
export async function applyFit(deps: Deps, ctx: Ctx, input: { postIds: string[]; use: boolean }): Promise<{ applied: number }> {
  let applied = 0
  for (const id of input.postIds) {
    const post = await getContent(deps, ctx, id)
    const w = weekOfPost(post)
    if (!w.fit) continue
    if (input.use && w.fit.after.trim()) {
      const text = w.fit.after.trim()
      await updateContent(deps, ctx, post.id, { spec: (post.kind === 'slideshow' ? { hook: text } : { caption: text }) as never })
      if (w.lineId) await deps.db.update(bankLines).set({ usedText: text, updatedAt: deps.clock.now() }).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.id, w.lineId)))
      applied++
    }
    await patchWeek(deps, ctx, post.id, { fit: null, check: null })
  }
  return { applied }
}

// ── Check (item 12, free) ─────────────────────────────────────────────

export async function checkWeek(deps: Deps, ctx: Ctx, monday: string): Promise<{ checked: number; flagged: number }> {
  const rows = (await weekPosts(deps, ctx, monday)).filter(r => weekOfPost(r).review?.call !== 'killed')
  const chars = new Map((await listCharacters(deps, ctx)).map(c => [c.id, c]))
  // The same line on two accounts: every live post's line, by its words.
  const everywhere = await deps.db.select({ id: contentItems.id, kind: contentItems.kind, tag: contentItems.accountTag, spec: contentItems.spec }).from(contentItems)
    .where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), inArray(contentItems.kind, ['meme', 'slideshow'])))
  const accountsByLine = new Map<string, Set<string>>()
  for (const e of everywhere) {
    const t = plain(String((e.kind === 'slideshow' ? (e.spec as { hook?: string }).hook : (e.spec as { caption?: string }).caption) ?? ''))
    if (t.split(' ').length < 3) continue
    accountsByLine.set(t, new Set([...(accountsByLine.get(t) ?? []), norm(e.tag)]))
  }
  const lineIds = rows.map(r => weekOfPost(r).lineId).filter((x): x is string => !!x)
  const bank = new Map((lineIds.length ? await deps.db.select({ id: bankLines.id, lifeOrJob: bankLines.lifeOrJob }).from(bankLines).where(inArray(bankLines.id, lineIds)) : []).map(b => [b.id, b]))
  const productRows = new Map<string, Awaited<ReturnType<typeof productOf>>>()
  let flagged = 0
  for (const r of rows) {
    const p = planOf(r)
    const w = weekOfPost(r)
    const type = postTypeOf(r, p)
    const line = lineOf(r).trim()
    const ch = r.characterId ? chars.get(r.characterId) : null
    const person = !!ch && kindOf(ch) !== 'faceless'
    const flags: string[] = []
    if (!line) flags.push('No line')
    if (type === 'faceless') {
      const f = readFacelessPost((r.spec as { faceless?: unknown }).faceless)
      if (!f.placeId && !f.line.trim() && !(r.spec as { stillId?: string | null }).stillId) flags.push('No scene: pick a place or write what the still shows')
    } else if (r.kind === 'meme' && r.sceneId) {
      const scene = await getScene(deps, ctx, r.sceneId)
      const fields = (scene.fields ?? {}) as { setting?: string; moment?: string; outfit?: string }
      if (!(fields.setting ?? '').trim() && !(fields.moment ?? '').trim() && !scene.brief.trim()) flags.push('No scene')
      if (person && !(fields.outfit ?? '').trim()) flags.push('No outfit')
    } else if (r.kind === 'slideshow') {
      const s = slideshowSpecSchema.parse(r.spec ?? {})
      if (!s.lock.place.trim() && !s.shots.some(x => x.trim())) flags.push('No scene')
      if (person && s.mode === 'character' && !s.lock.outfit.trim()) flags.push('No outfit')
    }
    if (p.lifeOrJob === 'life' && w.lineId && (bank.get(w.lineId)?.lifeOrJob ?? 'job') !== 'life') flags.push('A life slot with a job line')
    const others = [...(accountsByLine.get(plain(line)) ?? [])].filter(a => a !== norm(r.accountTag))
    if (line && others.length) flags.push(`The same line is on ${others.join(', ')}`)
    if (r.productId && line) {
      if (!productRows.has(r.productId)) productRows.set(r.productId, await productOf(deps, ctx, r.productId))
      const product = productRows.get(r.productId)
      const hits = product ? claimFlags(`${line} ${p.caption}`, claimsOf(product)) : []
      if (hits.length) flags.push(`Outside ${product!.name}'s claims: ${hits.join(', ')}`)
    }
    if (w.fillFlag && !line) flags.push(w.fillFlag)
    await patchWeek(deps, ctx, r.id, { check: { flags: [...new Set(flags)], at: deps.clock.now().toISOString() } })
    if (flags.length) flagged++
  }
  return { checked: rows.length, flagged }
}

// ── Make the week (item 13, priced) ───────────────────────────────────

type Built = { purpose: string; characterId: string | null; specs: JobSpec[]; preview: { title: string; prompts: Array<{ label: string; text: string; wrapped: string }>; warnings: RuleViolation[]; invalidates: string[] } }
const warn = (ruleId: string, title: string, message: string): RuleViolation => ({ ruleId, title, message, severity: 'warning', spec: '37' } as RuleViolation)

// One post's runs: its stills, then its video chained to its own still
// (the video starts when that still lands, on the same quote). redo: make
// them again (the old pictures go to the Trash when the run starts).
async function postRuns(deps: Deps, ctx: Ctx, row: ContentRow, cell: WeekCell, path: StillPath, redo: boolean): Promise<{ specs: JobSpec[]; prompts: Built['preview']['prompts']; warnings: RuleViolation[]; stills: number; videos: number }> {
  const specs: JobSpec[] = []
  const prompts: Built['preview']['prompts'] = []
  const warnings: RuleViolation[] = []
  let stills = 0, videos = 0
  const add = (b: { specs: JobSpec[]; preview: { prompts: Built['preview']['prompts']; warnings: RuleViolation[] } }) => { const at = specs.length; specs.push(...b.specs.map(s => ({ ...s, ...(s.parentIndex != null ? { parentIndex: s.parentIndex + at } : {}) }) as JobSpec)); prompts.push(...b.preview.prompts.slice(0, 1)); warnings.push(...b.preview.warnings); return at }
  const p = planOf(row)
  if (row.kind === 'slideshow') {
    if (!redo && cell.have >= cell.need) return { specs, prompts, warnings, stills, videos }
    const all = redo ? slideList(slideshowSpecSchema.parse(row.spec ?? {})).filter(x => !x.special).map(x => x.index) : undefined
    const b = await buildSlideshowStills(deps, ctx, { contentId: row.id, path, ...(all?.length ? { slides: all } : {}) })
    add(b); stills += b.specs.length
    return { specs, prompts, warnings, stills, videos }
  }
  const f = (row.spec as { faceless?: unknown }).faceless
  if (f) {
    const post = readFacelessPost(f)
    const hasStill = !!(row.spec as { stillId?: string | null }).stillId && !redo
    let parent: number | null = null
    if (!hasStill) {
      const b = await buildFacelessStill(deps, ctx, { contentId: row.id, path })
      parent = add(b); stills++
    }
    if (cell.video && (redo || !cell.hasVideo)) {
      if (!post.videoPrompt.trim() && !post.placeId) warnings.push(warn('week-no-video-prompt', 'No video prompt', `${p.rowId}: no video prompt, so the video is left out. Write one in the post.`))
      else {
        const b = await buildFacelessVideo(deps, ctx, { contentId: row.id, chain: parent != null })
        const at = add(b); videos++
        if (parent != null) specs[at] = { ...specs[at]!, parentIndex: parent } as JobSpec
      }
    }
    return { specs, prompts, warnings, stills, videos }
  }
  if (!row.sceneId || !row.characterId) return { specs, prompts, warnings, stills, videos }
  const character = await getCharacter(deps, ctx, row.characterId)
  const scene = await getScene(deps, ctx, row.sceneId)
  const motion = videoText(scene) || p.videoPrompt || p.clipAction
  let parent: number | null = null
  if (redo || cell.have < 1) {
    const model = slideModel(deps, 'character', toData(character), path)
    if (!model) throw new AppError('bad_request', `No stills model runs on ${PATH_LABELS[path]}.`)
    const b = await buildSceneRun(deps, ctx, character, { sceneId: row.sceneId, models: [model.ref], variations: 1, withQa: false, billing: path })
    parent = add(b); stills++
  }
  if (cell.video && (redo || !cell.hasVideo)) {
    if (motion.length < 3) warnings.push(warn('week-no-video-prompt', 'No video prompt', `${p.rowId}: no video prompt, so the video is left out. Write one in the post.`))
    else if (parent != null) {
      const v = await buildChainedSceneVideo(deps, ctx, character, { sceneId: row.sceneId, motion })
      specs.push({ ...v, parentIndex: parent } as JobSpec); videos++
    } else {
      const [still] = await deps.db.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.sceneId, row.sceneId), isNotNull(candidates.assetId), sql`${candidates.op} not in ('video', 'last_frame')`, sql`${candidates.status} not in ('trashed', 'purged', 'failed', 'superseded')`)).orderBy(desc(candidates.createdAt)).limit(1)
      if (still) { const b = await buildSceneVideo(deps, ctx, character, { characterId: character.id, candidateId: still.id, motion, directions: '', durationSec: deps.config.pipeline.scenes.video.duration, aspect: '9:16', audio: false, takes: 1, test: false } as Parameters<typeof buildSceneVideo>[3]); add(b); videos++ }
    }
  }
  return { specs, prompts, warnings, stills, videos }
}

// Make the week: the week's posts that are not made, not making, not
// killed and not flagged by Check (or the ticked ones), ten posts at a
// time; each group checked against the daily cap when its turn comes.
export async function buildWeekMake(deps: Deps, ctx: Ctx, input: { week: string; postIds?: string[]; path?: StillPath | null; redo?: boolean; provider?: string | null }): Promise<Built> {
  // "Provider for this run" (section 40): each post uses it where it runs
  // that post's model, else the post's own pick.
  return withRunProvider(input.provider, () => buildWeekMakeRun(deps, ctx, input))
}

async function buildWeekMakeRun(deps: Deps, ctx: Ctx, input: { week: string; postIds?: string[]; path?: StillPath | null; redo?: boolean; provider?: string | null }): Promise<Built> {
  const rows = await weekPosts(deps, ctx, input.week)
  const cells = new Map((await weekCells(deps, ctx, rows)).map(c => [c.postId, c]))
  const wanted = input.postIds?.length ? new Set(input.postIds) : null
  const pick = rows.filter(r => {
    const c = cells.get(r.id)!
    if (wanted) return wanted.has(r.id) && c.review !== 'killed' && !c.making
    return c.review !== 'killed' && !c.made && !c.making && !c.flags.length && c.checked && c.line.trim()
  }).sort((a, b) => cells.get(a.id)!.date.localeCompare(cells.get(b.id)!.date) || cells.get(a.id)!.slot - cells.get(b.id)!.slot)
  if (!pick.length) throw new AppError('invalid_request', wanted ? 'Those posts are made already or making now.' : 'Nothing to make: every checked post without a flag is made or making. Run Check first.')
  const path = await stillPathFor(deps, ctx, null, { path: input.path ?? null })
  const specs: JobSpec[] = []
  const prompts: Built['preview']['prompts'] = []
  const warnings: RuleViolation[] = []
  const skipped: string[] = []
  let group = 0, inGroup = 0, stills = 0, videos = 0, posts = 0
  for (const row of pick) {
    const cell = cells.get(row.id)!
    let runs
    try { runs = await postRuns(deps, ctx, row, cell, path, !!input.redo) } catch (e) { skipped.push(`${cell.rowId}: ${(e as Error).message}`); continue }
    if (!runs.specs.length) { skipped.push(`${cell.rowId}: nothing to make`); continue }
    const offset = specs.length
    for (const s of runs.specs) specs.push({ ...s, characterId: s.characterId ?? row.characterId ?? undefined, ...(s.parentIndex != null ? { parentIndex: s.parentIndex + offset } : {}), queue: { group } } as JobSpec)
    if (prompts.length < 2) prompts.push(...runs.prompts.slice(0, 2 - prompts.length).map(x => ({ ...x, label: `${cell.rowId}: ${x.label}` })))
    for (const w of runs.warnings) if (warnings.length < 12 && !warnings.some(x => x.ruleId === w.ruleId && x.message === w.message)) warnings.push(w)
    stills += runs.stills; videos += runs.videos; posts++
    if (++inGroup >= QUEUE) { group++; inGroup = 0 }
  }
  if (!specs.length) throw new AppError('bad_request', `Nothing to make. ${skipped.slice(0, 3).join(' ')}`)
  if (skipped.length) warnings.push(warn('week-skipped', `${skipped.length} not made`, skipped.slice(0, 5).join(' ')))
  if (group > 1 || (group === 1 && inGroup > 0)) warnings.push(warn('week-queue', 'Ten at a time', `${posts} posts run ten at a time: the next ten start when the ten before them are done, each group checked against your daily cap; a group over it waits and goes on after midnight (UTC).`))
  const what = [stills ? `${stills} still${stills === 1 ? '' : 's'}` : '', videos ? `${videos} video${videos === 1 ? '' : 's'}` : ''].filter(Boolean).join(' then ')
  return {
    purpose: `${input.redo ? 'week_redo' : 'week_make'}:${input.week}`, characterId: null, specs,
    preview: { title: input.redo ? `Redo ${posts} post${posts === 1 ? '' : 's'}: ${what} (the old pictures go to the Trash)` : `Make the week: ${posts} post${posts === 1 ? '' : 's'}, ${what}`, prompts: prompts.map(x => ({ ...x, wrapped: x.wrapped || hardWrap(x.text) })), warnings, invalidates: [] },
  }
}

// Redo started: the post's old pictures go to the Trash, its picks and its
// review are cleared.
export async function redoStarted(deps: Deps, ctx: Ctx, postIds: string[], newJobs: string[] = []): Promise<void> {
  for (const id of postIds) {
    const post = await getContent(deps, ctx, id).catch(() => null)
    if (!post) continue
    // Never a picture the redo itself just made.
    const refs = await postPictures(deps, ctx, post)
    const fresh = refs.length && newJobs.length ? new Set((await deps.db.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, refs.map(r => r.id)), inArray(candidates.jobId, newJobs)))).map(c => c.id)) : new Set<string>()
    await trash(deps, ctx, refs.filter(r => !fresh.has(r.id)))
    if (post.kind === 'slideshow') await updateContent(deps, ctx, id, { spec: { stillIds: [] } as never })
    else await updateContent(deps, ctx, id, { spec: { stillId: null, clipId: null } as never })
    await patchWeek(deps, ctx, id, { review: null })
    await setPosting(deps, ctx, id, { approved: false }).catch(() => undefined)
  }
}

// ── Review (item 14) ──────────────────────────────────────────────────

export interface ReviewCall { postId: string; rowId: string; account: string; call: 'approved' | 'killed' | null; at: string; by: string | null }

// Approve is Approve for posting (section 33); Kill takes it off. A person
// clip's still and take are picked for it, so its export has them. Every
// call is logged.
export async function setReview(deps: Deps, ctx: Ctx, postId: string, call: 'approved' | 'killed' | null): Promise<void> {
  const post = await getContent(deps, ctx, postId)
  if (call === 'approved' && post.kind === 'meme' && post.sceneId && !(post.spec as { faceless?: unknown }).faceless) {
    const spec = post.spec as { stillId?: string | null; clipId?: string | null }
    if (!spec.clipId || !spec.stillId) {
      const list = await deps.db.select({ id: candidates.id, op: candidates.op }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.sceneId, post.sceneId), isNotNull(candidates.assetId), sql`${candidates.status} not in ('trashed', 'purged', 'failed', 'superseded')`)).orderBy(desc(candidates.createdAt))
      const take = list.find(c => c.op === 'video'), still = list.find(c => c.op !== 'video' && c.op !== 'last_frame')
      await updateContent(deps, ctx, post.id, { spec: { ...(spec.clipId || !take ? {} : { clipId: take.id }), ...(spec.stillId || !still ? {} : { stillId: still.id }) } as never })
    }
  }
  await setPosting(deps, ctx, postId, { approved: call === 'approved' })
  await patchWeek(deps, ctx, postId, { review: call ? { call, at: deps.clock.now().toISOString() } : null })
  const log = await getSetting<ReviewCall[]>(deps.db, ctx.accountId, REVIEW_LOG_KEY, [])
  const p = planOf(post)
  await setSetting(deps, ctx, REVIEW_LOG_KEY, [{ postId, rowId: p.rowId, account: post.accountTag, call, at: deps.clock.now().toISOString(), by: ctx.userId }, ...log].slice(0, 2000))
}

export async function reviewLog(deps: Deps, ctx: Ctx, limit = 200): Promise<ReviewCall[]> {
  return (await getSetting<ReviewCall[]>(deps.db, ctx.accountId, REVIEW_LOG_KEY, [])).slice(0, limit)
}

// ── Send to Drive (item 16) ───────────────────────────────────────────

export async function sendWeek(deps: Deps, ctx: Ctx, monday: string, input: { postIds?: string[]; again?: boolean }): Promise<{ jobId: string; posts: number }> {
  const cells = await weekCells(deps, ctx, await weekPosts(deps, ctx, monday))
  const ids = cells.filter(c => c.approved && (input.again || !c.sentAt) && (!input.postIds?.length || input.postIds.includes(c.postId))).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot).map(c => c.postId)
  return startDriveSend(deps, ctx, { week: monday, postIds: ids })
}

// ── The line bank page (items 6 to 8) ─────────────────────────────────

export interface BankPageQuery { pain?: string | null; emotion?: string | null; format?: string | null; fits?: string | null; lifeOrJob?: string | null; unused?: boolean; source?: string | null; q?: string | null; limit?: number }

export async function bankPage(deps: Deps, ctx: Ctx, q: BankPageQuery) {
  const all = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.passed, true))).orderBy(desc(bankLines.likes))
  const lines = all.map(r => {
    const t = tagsOf(r)
    return { id: r.id, text: r.usedText || r.line, original: r.line, source: r.source, likes: r.likes, pain: t.pain ?? '', emotion: t.emotion ?? '', format: t.format ?? '', fits: fitOf(t.fits), lifeOrJob: (r.lifeOrJob as LifeOrJob | null) ?? null, usedAccount: r.usedAccountTag, usedDate: r.usedDate, usedPostId: r.usedPostId, comment: r.comment, fight: !!t.fight }
  })
  const words = (q.q ?? '').trim().toLowerCase()
  const shown = lines.filter(l => (!q.pain || l.pain === q.pain) && (!q.emotion || l.emotion === q.emotion) && (!q.format || l.format === q.format) && (!q.fits || l.fits === q.fits)
    && (!q.lifeOrJob || (q.lifeOrJob === 'untagged' ? !l.lifeOrJob : l.lifeOrJob === q.lifeOrJob)) && (!q.unused || !l.usedAccount) && (!q.source || l.source === q.source) && (!words || l.text.toLowerCase().includes(words) || l.comment.toLowerCase().includes(words)))
  const cfg = deps.config.pipeline.content.line_bank
  const imports = await getSetting<BankImport[]>(deps.db, ctx.accountId, IMPORTS_KEY, [])
  const productId = imports.find(i => i.productId)?.productId ?? null
  const options = { pains: [...new Set([...(await painsFor(deps, ctx, productId)), ...lines.map(l => l.pain).filter(p => p && p !== 'none')])].sort(), emotions: cfg.emotions, formats: [...new Set([...cfg.formats, ...lines.map(l => l.format).filter(Boolean)])], fits: ['first', 'secondhand', 'both'], sources: [...new Set(lines.map(l => l.source))] }
  return {
    lines: shown.slice(0, Math.min(q.limit ?? 500, 5000)), total: shown.length,
    counts: { lines: lines.length, untagged: lines.filter(l => !l.lifeOrJob).length, life: lines.filter(l => l.lifeOrJob === 'life').length, job: lines.filter(l => l.lifeOrJob === 'job').length, used: lines.filter(l => l.usedAccount).length },
    options,
  }
}

// Import lines (item 7, free): text plus the line's fields; near-matches of
// a line in the bank or earlier in the file are dropped and counted.
export async function importLines(deps: Deps, ctx: Ctx, input: { csv: string; name?: string; productId?: string | null; dryRun?: boolean }) {
  const cfg = deps.config.pipeline.content.line_bank
  if (input.csv.length > 2_000_000) throw new AppError('bad_request', 'That file is too big for one import (2 MB). Split it.')
  const read = readLines(input.csv, { emotions: cfg.emotions, formats: cfg.formats })
  if (read.missing.length) throw new AppError('invalid_request', 'The file needs a text column (the line). Optional: source, source_likes, pain, emotion, format, voice_fit, life_or_job.')
  const product = input.productId ? await productOf(deps, ctx, input.productId) : null
  const have = (await deps.db.select({ line: bankLines.line, comment: bankLines.comment }).from(bankLines).where(eq(bankLines.accountId, ctx.accountId))).flatMap(r => [r.line, r.comment]).filter(Boolean)
  const share = deps.config.pipeline.content.weeks.near_duplicate
  const kept: typeof read.rows = []
  let dupBank = 0, dupFile = 0
  const exact = new Set(have.map(plain))
  for (const r of read.rows) {
    if (exact.has(plain(r.text)) || have.some(h => nearDuplicate(h, r.text, share))) { dupBank++; continue }
    if (kept.some(k => nearDuplicate(k.text, r.text, share))) { dupFile++; continue }
    kept.push(r)
  }
  const id = newId('bim')
  if (!input.dryRun && kept.length) {
    for (let i = 0; i < kept.length; i += 500) {
      await deps.db.insert(bankLines).values(kept.slice(i, i + 500).map(r => ({
        id: newId('bl'), accountId: ctx.accountId, importId: id, productId: product?.id ?? null, comment: r.text.slice(0, 2000), likes: Math.min(r.likes, 2_000_000_000),
        state: 'written', line: cleanLine(r.text).slice(0, 300), passed: true, source: r.source, lifeOrJob: r.lifeOrJob,
        tags: { emotion: r.emotion || 'none', topic: '', pain: r.pain || 'none', fits: r.fits, format: r.format || cfg.formats[0]!, fight: false, fightReason: '' } as BankTags,
      })))
    }
    const all = await getSetting<BankImport[]>(deps.db, ctx.accountId, IMPORTS_KEY, [])
    const zero = { duplicate: dupBank + dupFile, likes: 0, short: 0, language: 0, video: 0, topic: 0 }
    await setSetting(deps, ctx, IMPORTS_KEY, [{ id, name: (input.name ?? '').trim().slice(0, 120) || `Lines of ${deps.clock.now().toISOString().slice(0, 10)}`, at: deps.clock.now().toISOString(), productId: product?.id ?? null, productName: product?.name ?? '', rows: read.rows.length, empty: 0, kept: kept.length, already: dupBank, captions: 0, joined: 0, dropped: zero, examples: { duplicate: [], likes: [], short: [], language: [], video: [], topic: [] } } satisfies BankImport, ...all].slice(0, 50))
  }
  return { rows: read.rows.length, kept: kept.length, duplicatesInBank: dupBank, duplicatesInFile: dupFile, unknown: read.unknown, problems: read.rows.filter(r => r.problems.length).slice(0, 20).map(r => `Line ${r.line}: ${r.problems.join('; ')}`), importId: input.dryRun ? null : id }
}

// Tag the bank (item 6, priced): the lines that passed get life or job, and
// their pain, emotion, format and voice fit checked again, 30 to a call.
export async function buildBankRetag(deps: Deps, ctx: Ctx, input: { all?: boolean }): Promise<BuiltAction> {
  const cfg = deps.config.pipeline.content.line_bank
  const rows = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.passed, true), input.all ? undefined : isNull(bankLines.lifeOrJob))).orderBy(desc(bankLines.likes), bankLines.id)
  if (!rows.length) throw new AppError('invalid_request', 'Every line in the bank is tagged.')
  const route = await resolveRoute(deps, ctx, 'line_tagger')
  const t = deps.config.pipeline.templates.line_bank_retag
  const specs: JobSpec[] = []
  for (let i = 0; i < rows.length; i += cfg.tag_batch) {
    const batch = rows.slice(i, i + cfg.tag_batch)
    const pains = await painsFor(deps, ctx, batch[0]!.productId)
    const system = fill(t.system, { emotions: cfg.emotions.join(', '), formats: cfg.formats.join(', '), pains: pains.length ? pains.map(p => `  - ${p}`).join('\n') : '  (no pain points: none)' })
    const prompt = fill(t.prompt, { lines: batch.map((r, k) => `${k + 1}. ${r.line}${r.comment && r.comment !== r.line ? `\n   (from: "${r.comment.slice(0, 300)}")` : ''}`).join('\n'), count: String(batch.length) })
    const schema = retagSchema(batch.length, cfg, pains)
    specs.push({ type: 'llm', stage: 'content', purpose: `bank_retag:${batch[0]!.id}`, label: `Line bank: tag ${batch.length} lines (life or job)`, request: { model: route.model, system, prompt, schema, schemaName: 'line_bank_retag', maxTokens: 200 + 90 * batch.length, effort: route.effort ?? 'low', meta: { ids: batch.map(r => r.id), pains, mockRetag: { tags: batch.map((r, k) => ({ n: k + 1, life_or_job: /rent|mom|dad|sister|boyfriend|landlord|car|laundry|dog|cat|gym/i.test(r.line) ? 'life' : 'job', pain: pains[k % Math.max(1, pains.length)] ?? 'none', emotion: tagsOf(r).emotion && tagsOf(r).emotion !== 'none' ? tagsOf(r).emotion : cfg.emotions[k % cfg.emotions.length], format: tagsOf(r).format || cfg.formats[0], fits: tagsOf(r).fits ?? 'both' })) } } } })
  }
  return { purpose: `bank_retag:${rows[0]!.id}`, characterId: null, specs, preview: { title: `Tag ${rows.length} line${rows.length === 1 ? '' : 's'}: life or job, pain, emotion, format, voice fit (${specs.length} call${specs.length === 1 ? '' : 's'})`, prompts: specs.slice(0, 1).map(s => { const r = (s as Extract<JobSpec, { type: 'llm' }>).request; return { label: s.label, text: `${r.system}\n${r.prompt}`, wrapped: hardWrap(`${r.system}\n${r.prompt}`) } }), warnings: [], invalidates: [] } }
}

function retagSchema(n: number, cfg: { emotions: string[]; formats: string[] }, pains: string[]) {
  const item = { n: { type: 'integer' }, life_or_job: { type: 'string', enum: ['life', 'job'] }, pain: { type: 'string', enum: [...pains, 'none'] }, emotion: { type: 'string', enum: [...cfg.emotions, 'none'] }, format: { type: 'string', enum: cfg.formats }, fits: { type: 'string', enum: ['first', 'secondhand', 'both'] } }
  const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props })
  return obj({ tags: { type: 'array', minItems: n, maxItems: n, items: obj(item) } })
}

async function onRetag(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const meta = (job.request as { meta?: { ids?: string[]; pains?: string[] } }).meta ?? {}
  const cfg = deps.config.pipeline.content.line_bank
  const got = new Map((((out.data as { tags?: unknown })?.tags ?? []) as Array<Record<string, unknown>>).map(x => [Math.round(Number(x.n)), x]))
  for (const [i, id] of (meta.ids ?? []).entries()) {
    const t = got.get(i + 1)
    if (!t) continue
    const [row] = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.id, id)))
    if (!row) continue
    const prev = tagsOf(row)
    const pick = (v: unknown, list: string[], fb: string) => (list.includes(String(v)) ? String(v) : fb)
    const tags = { ...prev, pain: pick(t.pain, [...(meta.pains ?? []), 'none'], prev.pain ?? 'none'), emotion: pick(t.emotion, [...cfg.emotions, 'none'], prev.emotion ?? 'none'), format: pick(t.format, cfg.formats, prev.format ?? cfg.formats[0]!), fits: pick(t.fits, ['first', 'secondhand', 'both'], prev.fits ?? 'both') }
    await deps.db.update(bankLines).set({ tags, lifeOrJob: t.life_or_job === 'life' ? 'life' : 'job', updatedAt: deps.clock.now() }).where(eq(bankLines.id, id))
  }
}

// The bank as a CSV (item 8): every shown line with its fields.
export function bankCsv(lines: Awaited<ReturnType<typeof bankPage>>['lines']): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const head = ['id', 'text', 'source', 'source_likes', 'pain', 'emotion', 'format', 'voice_fit', 'life_or_job', 'used_on_account', 'used_on_date']
  return [head.join(','), ...lines.map(l => [l.id, l.text, l.source, l.likes, l.pain, l.emotion, l.format, l.fits, l.lifeOrJob ?? '', l.usedAccount ?? '', l.usedDate ?? ''].map(esc).join(','))].join('\n') + '\n'
}

let registered = false
export function registerWeeks(): void {
  if (registered) return
  registered = true
  registerJobHook('week_fit', onFit)
  registerJobHook('bank_retag', onRetag)
  registerLocalJob('week_pull', runPull)
}


// ── Google Sheets (section 39) ───────────────────────────────────────

export const SHEETS_KEY = 'week_sheets'
export interface LinkedSheet { id: string; name: string; modifiedTime: string; importedAt: string; syncedAt: string; rows: number }

async function linkSheet(deps: Deps, ctx: Ctx, sheet: { id: string; name: string; modifiedTime: string }, rows: number): Promise<void> {
  const all = await getSetting<Record<string, LinkedSheet>>(deps.db, ctx.accountId, SHEETS_KEY, {})
  const now = deps.clock.now().toISOString()
  all[sheet.id] = { id: sheet.id, name: sheet.name.slice(0, 200), modifiedTime: sheet.modifiedTime, importedAt: all[sheet.id]?.importedAt ?? now, syncedAt: now, rows }
  await setSetting(deps, ctx, SHEETS_KEY, all)
}

export async function linkedSheets(deps: Deps, ctx: Ctx): Promise<LinkedSheet[]> {
  return Object.values(await getSetting<Record<string, LinkedSheet>>(deps.db, ctx.accountId, SHEETS_KEY, {})).sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
}

const refOrThrow = (text: string) => {
  const id = sheetRef(text)
  if (!id) throw new AppError('invalid_request', 'That is not a Google Sheets link. Copy it from the address bar of the sheet (docs.google.com/spreadsheets/d/...).')
  return id
}

export async function weekSheets(deps: Deps, ctx: Ctx, search?: string) {
  const chars = (await listCharacters(deps, ctx)).map(c => c.name)
  return { ...(await listSheets(deps, ctx, { search, characters: chars })), linked: await linkedSheets(deps, ctx) }
}

// From Google Sheets: the sheet read (its first tab, as CSV) and the same
// free preview as an uploaded CSV.
export async function previewSheet(deps: Deps, ctx: Ctx, link: string) {
  const sheet = await readSheet(deps, ctx, refOrThrow(link))
  return { sheet: { id: sheet.id, name: sheet.name, modifiedTime: sheet.modifiedTime }, csv: sheet.csv, preview: await previewWeek(deps, ctx, sheet.csv) }
}

export async function importSheet(deps: Deps, ctx: Ctx, input: { sheet: string; rows: string[]; existing?: 'replace' | 'add' }) {
  const sheet = await readSheet(deps, ctx, refOrThrow(input.sheet))
  return importWeek(deps, ctx, sheet.csv, { rows: input.rows, existing: input.existing, sheet })
}

export interface ResyncRow { rowId: string; account: string; title: string; postIds: string[] }
export interface ResyncPlan {
  sheet: { id: string; name: string; modifiedTime: string }
  added: ResyncRow[]; changed: ResyncRow[]; changedWithPictures: ResyncRow[]; gone: ResyncRow[]; unchanged: number; problems: Array<{ rowId: string; errors: string[] }>
}

// Re-sync: what the sheet's latest edits would do, row by row. A changed
// row whose posts have pictures is never touched unless the owner ticks it.
export async function resyncPlan(deps: Deps, ctx: Ctx, sheetId: string): Promise<ResyncPlan & { csv: string }> {
  const sheet = await readSheet(deps, ctx, sheetId)
  const read = readWeek(sheet.csv)
  if (read.missing.length) throw new AppError('invalid_request', `The sheet needs these columns: ${read.missing.join(', ')} (docs/PLAN-CSV-SPEC.md).`)
  const p = await plan(deps, ctx, sheet.csv)
  const made = await existing(deps, ctx)
  const out: ResyncPlan = { sheet: { id: sheet.id, name: sheet.name, modifiedTime: sheet.modifiedTime }, added: [], changed: [], changedWithPictures: [], gone: [], unchanged: 0, problems: [] }
  const seen = new Set<string>()
  for (const [i, r] of p.checked.entries()) {
    if (r.errors.length || !r.postType) { out.problems.push({ rowId: r.rowId || `line ${r.line}`, errors: r.errors.length ? r.errors : ['no post type'] }); continue }
    const key = `${norm(r.account)}|${r.rowId}`
    seen.add(key)
    const old = made.get(key) ?? []
    const item: ResyncRow = { rowId: r.rowId, account: r.account, title: (p.rows[i]!.cells.line || p.rows[i]!.cells.story_beat || r.postType).slice(0, 120), postIds: old.map(o => o.id) }
    if (!old.length) { out.added.push(item); continue }
    if (old.every(o => planOf(o).rowHash === rowHash(p.rows[i]!.cells))) { out.unchanged++; continue }
    let pictures = old.some(hasPictures)
    for (const o of old) if (!pictures) pictures = (await postPictures(deps, ctx, o)).length > 0
    if (pictures) out.changedWithPictures.push(item)
    else out.changed.push(item)
  }
  for (const [key, rows] of made) {
    const mine = rows.filter(r => planOf(r).sheetId === sheet.id)
    if (mine.length && !seen.has(key)) out.gone.push({ rowId: planOf(mine[0]!).rowId, account: mine[0]!.accountTag, title: mine[0]!.title, postIds: mine.map(m => m.id) })
  }
  return { ...out, csv: sheet.csv }
}

export async function resyncSheet(deps: Deps, ctx: Ctx, sheetId: string, input: { update?: string[] } = {}): Promise<WeekImportResult & { kept: number }> {
  const r = await resyncPlan(deps, ctx, sheetId)
  const ok = new Set(input.update ?? [])
  const rows = [...r.added, ...r.changed, ...r.changedWithPictures.filter(x => ok.has(x.rowId))].map(x => x.rowId)
  const kept = r.changedWithPictures.length - r.changedWithPictures.filter(x => ok.has(x.rowId)).length
  if (!rows.length) { await linkSheet(deps, ctx, r.sheet, r.added.length + r.changed.length + r.changedWithPictures.length + r.unchanged); return { created: 0, replaced: 0, skipped: 0, posts: [], weeks: [], noLine: 0, pulls: 0, kept } }
  return { ...(await importWeek(deps, ctx, r.csv, { rows, existing: 'replace', sheet: r.sheet })), kept }
}

// Line bank > Import lines from a Google Sheet (same dry run and dedupe).
export async function importLinesFromSheet(deps: Deps, ctx: Ctx, input: { sheet: string; productId?: string | null; dryRun?: boolean }) {
  const sheet = await readSheet(deps, ctx, refOrThrow(input.sheet))
  return { ...(await importLines(deps, ctx, { csv: sheet.csv, name: sheet.name, productId: input.productId, dryRun: input.dryRun })), sheet: { id: sheet.id, name: sheet.name } }
}
