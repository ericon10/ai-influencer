import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { bankLines, characters, contentItems, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { fill, hardWrap } from '../core/text.js'
import { cleanVoiceCard, voiceCardText } from '../core/voiceCard.js'
import {
  cleanLine, examplesText, firstPass, fitsStance, listComments, mockLines, mockReviews, mockTags, mockVoice, passes, plain, readCaptions, readComments,
  readReview, readTags, reviewerJsonSchema, stanceFrom, tagsJsonSchema, voiceJsonSchema, withCaptions, writerJsonSchema,
  DROP_LABEL, type BankReview, type BankTags, type DropReason, type LineBankConfig, type Stance,
} from '../core/lineBank.js'
import { activateChildren, cancelChildren, type JobSpec } from '../jobs/runner.js'
import { registerJobHook, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { getSetting, resolveRoute, setSetting } from './settings.js'
import { postWriting, productOf, standardOf, templateFor } from './products.js'
import { getContent, updateContent } from './content.js'
import { getCharacter, toData } from './characters.js'
import { sheetCsvUrl } from './massRecreate.js'
import type { BuiltAction } from './actions.js'

// The line bank (owner, 2026-10-22; UX-PLAN.md section 36, item 29): an
// Apify comment scrape in, the free first pass, then one priced run that
// tags each kept comment, writes its on-screen line and has
// a separate reviewer score it (rejected lines never show). The owner's
// Keep or Reject on a line teaches the writer and the reviewer. A line is
// used once: put in a character's voice and placed on a post, it never
// shows for another account.

export const IMPORTS_KEY = 'line_bank_imports'
export const STANCES_KEY = 'line_bank_stances'

export interface BankImport {
  id: string; name: string; at: string; productId: string | null; productName: string
  rows: number; empty: number; kept: number; already: number; captions: number; joined: number
  dropped: Record<DropReason, number>; examples: Record<DropReason, string[]>
}

export type BankRow = typeof bankLines.$inferSelect
type Skip = { characterId: string; why: string }

const cfgOf = (deps: Deps): LineBankConfig => deps.config.pipeline.content.line_bank as LineBankConfig

// The product's ICP pain points (its writing rules), none for a product
// without.
export async function painsFor(deps: Deps, ctx: Ctx, productId: string | null): Promise<string[]> {
  const product = await productOf(deps, ctx, productId)
  const std = standardOf(deps, product?.writing)
  return std ? deps.config.pipeline.content.writing_standards[std.key]?.pains ?? [] : []
}

// ── Import and the free first pass ────────────────────────────────────

async function readLink(link: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(sheetCsvUrl(link), { redirect: 'follow' }).catch(e => { throw new AppError('bad_request', `Could not read the sheet: ${(e as Error).message}`) })
  const text = await res.text()
  if (!res.ok || /^\s*<!doctype html|<html/i.test(text)) throw new AppError('bad_request', 'Google did not share the sheet. In the sheet: Share, General access, Anyone with the link (Viewer); or download the tab as CSV (File, Download, Comma separated values) and choose the file.')
  return text
}

export interface ImportInput { comments: { csv?: string; link?: string }; videos?: { csv?: string; link?: string } | null; name?: string; productId?: string | null }

// Free: reads the comments (and the videos' captions), runs the first pass,
// and keeps what passes. A comment already in the bank (same words) is
// counted as already there.
export async function importBank(deps: Deps, ctx: Ctx, input: ImportInput, fetchImpl: typeof fetch = fetch): Promise<BankImport> {
  const cfg = cfgOf(deps)
  const csv = input.comments.csv || (input.comments.link ? await readLink(input.comments.link, fetchImpl) : '')
  if (!csv) throw new AppError('invalid_request', 'Choose the comments CSV, or paste the Sheet link.')
  const read = readComments(csv)
  if (read.missing.length) throw new AppError('invalid_request', `The comments file needs these columns: ${read.missing.join(', ')}. Its first line is the header (comment, comment_likes, replies, video_account, video_views, video_url).`)
  const vcsv = input.videos?.csv || (input.videos?.link ? await readLink(input.videos.link, fetchImpl) : '')
  const caps = readCaptions(vcsv)
  const rows = withCaptions(read.rows, caps)
  const pass = firstPass(rows, cfg)
  const product = input.productId ? await productOf(deps, ctx, input.productId) : null
  if (input.productId && !product) throw new AppError('not_found', 'That product is not in this account.')
  // The bank's own duplicates across imports.
  const have = new Set((await deps.db.select({ comment: bankLines.comment }).from(bankLines).where(eq(bankLines.accountId, ctx.accountId))).map(r => plain(r.comment)))
  const fresh = pass.kept.filter(r => !have.has(plain(r.comment)))
  const id = newId('bim')
  for (let i = 0; i < fresh.length; i += 500) {
    await deps.db.insert(bankLines).values(fresh.slice(i, i + 500).map(r => ({
      id: newId('bl'), accountId: ctx.accountId, importId: id, productId: product?.id ?? null,
      comment: r.comment.slice(0, 2000), likes: Math.min(r.likes, 2_000_000_000), replies: Math.min(r.replies, 2_000_000_000),
      videoAccount: r.videoAccount.slice(0, 120), videoViews: Math.min(r.videoViews, 2_000_000_000), videoUrl: r.videoUrl.slice(0, 500), videoCaption: r.videoCaption.slice(0, 600),
    })))
  }
  const summary: BankImport = {
    id, name: (input.name ?? '').trim().slice(0, 120) || `Import of ${deps.clock.now().toISOString().slice(0, 10)}`, at: deps.clock.now().toISOString(),
    productId: product?.id ?? null, productName: product?.name ?? '', rows: read.rows.length, empty: read.empty, kept: fresh.length, already: pass.kept.length - fresh.length,
    captions: caps.count, joined: rows.filter(r => r.videoCaption).length, dropped: pass.dropped, examples: pass.examples,
  }
  const all = await getSetting<BankImport[]>(deps.db, ctx.accountId, IMPORTS_KEY, [])
  await setSetting(deps, ctx, IMPORTS_KEY, [summary, ...all].slice(0, 50))
  return summary
}

// ── Who a character is, for the bank ──────────────────────────────────

export interface Voice { characterId: string; name: string; stance: Stance; picked: boolean; facts: string; voice: string }

export async function voiceOf(deps: Deps, ctx: Ctx, characterId: string): Promise<Voice> {
  const ch = toData(await getCharacter(deps, ctx, characterId))
  const v = cleanVoiceCard(ch.persona.voice)
  const facts = [v.who && `Who: ${v.who}`, v.pov && `Point of view: ${v.pov}`, ch.persona.vibe && `Vibe: ${ch.persona.vibe}`, v.pillars?.length && `Posts about: ${v.pillars.join('; ')}`].filter(Boolean).join('\n')
  const picked = (await getSetting<Record<string, Stance>>(deps.db, ctx.accountId, STANCES_KEY, {}))[characterId]
  return { characterId, name: ch.name, stance: picked ?? stanceFrom(`${v.who ?? ''} ${v.pov ?? ''}`, cfgOf(deps)), picked: !!picked, facts: facts || 'None written yet (the voice card has no who or point of view).', voice: voiceCardText(ch.name, v) }
}

export async function setStance(deps: Deps, ctx: Ctx, characterId: string, stance: Stance | null): Promise<void> {
  await getCharacter(deps, ctx, characterId)
  const all = { ...(await getSetting<Record<string, Stance>>(deps.db, ctx.accountId, STANCES_KEY, {})) }
  if (stance) all[characterId] = stance
  else delete all[characterId]
  await setSetting(deps, ctx, STANCES_KEY, all)
}

// ── The view ──────────────────────────────────────────────────────────

export interface BankQuery { characterId?: string | null; emotion?: string | null; topic?: string | null; pain?: string | null; importId?: string | null; accountTag?: string | null; limit?: number }

export function lineView(r: BankRow) {
  const review = r.review as BankReview | null
  return {
    id: r.id, line: r.line, comment: r.comment, likes: r.likes, replies: r.replies, videoAccount: r.videoAccount, videoViews: r.videoViews, videoUrl: r.videoUrl, videoCaption: r.videoCaption,
    tags: r.tags as BankTags | null, review, score: review ? Math.min(review.gut, review.specific, review.real) : null,
    call: r.call as 'kept' | 'rejected' | null, usedPostId: r.usedPostId, usedAccountTag: r.usedAccountTag, usedText: r.usedText,
    skips: (r.skips as Skip[]) ?? [],
  }
}

// Lines in a run that has not finished (never offered twice, never run twice).
async function busyIds(deps: Deps, ctx: Ctx): Promise<Set<string>> {
  const rows = await deps.db.select({ request: jobs.request }).from(jobs).where(and(
    eq(jobs.accountId, ctx.accountId), sql`${jobs.purpose} like 'bank\\_%'`, inArray(jobs.status, ['waiting', 'queued', 'submitting', 'running', 'ingesting']),
  ))
  return new Set(rows.flatMap(r => ((r.request as { meta?: { ids?: string[] } }).meta?.ids ?? [])))
}

export async function bankView(deps: Deps, ctx: Ctx, q: BankQuery) {
  const cfg = cfgOf(deps)
  const all = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), q.importId ? eq(bankLines.importId, q.importId) : undefined)).orderBy(desc(bankLines.likes))
  const busy = await busyIds(deps, ctx)
  const counts = { comments: all.length, waiting: 0, running: 0, tagged: 0, written: 0, passed: 0, rejected: 0, skipped: 0, fights: 0, used: 0, kept: 0, called: 0 }
  for (const r of all) {
    if (busy.has(r.id)) counts.running++
    else if (r.state === 'new' || r.state === 'failed') counts.waiting++
    if (r.tags) counts.tagged++
    if (r.state === 'written') counts.written++
    if (r.passed) counts.passed++
    if (r.passed === false) counts.rejected++
    if (r.skipped) counts.skipped++
    if ((r.tags as BankTags | null)?.fight) counts.fights++
    if (r.usedPostId) counts.used++
    if (r.call === 'kept') counts.kept++
    if (r.call) counts.called++
  }
  const voice = q.characterId ? await voiceOf(deps, ctx, q.characterId) : null
  const tag = (q.accountTag ?? '').trim().toLowerCase()
  // Only lines that passed the reviewer ever show.
  const shown = all.filter(r => r.passed && !busy.has(r.id)).filter(r => {
    const t = r.tags as BankTags | null
    if (q.emotion && t?.emotion !== q.emotion) return false
    if (q.topic && t?.topic !== q.topic) return false
    if (q.pain && t?.pain !== q.pain) return false
    if (voice) {
      if (!fitsStance(t?.fits, voice.stance)) return false
      if (((r.skips as Skip[]) ?? []).some(s => s.characterId === voice.characterId)) return false
    }
    // A line used on one account never shows for another.
    if (r.usedAccountTag != null && tag && r.usedAccountTag.toLowerCase() !== tag) return false
    if (r.usedAccountTag != null && !tag && q.characterId) return false
    return true
  })
  const imports = await getSetting<BankImport[]>(deps.db, ctx.accountId, IMPORTS_KEY, [])
  const productId = (q.importId ? imports.find(i => i.id === q.importId)?.productId : imports.find(i => i.productId)?.productId) ?? null
  return {
    counts, imports, voice: voice ? { characterId: voice.characterId, name: voice.name, stance: voice.stance, picked: voice.picked } : null,
    lines: shown.slice(0, Math.min(q.limit ?? 200, 500)).map(lineView), total: shown.length,
    skippedHere: voice ? all.filter(r => ((r.skips as Skip[]) ?? []).some(s => s.characterId === voice.characterId)).slice(0, 20).map(r => ({ id: r.id, line: r.line, why: ((r.skips as Skip[]) ?? []).find(s => s.characterId === voice.characterId)?.why ?? '' })) : [],
    options: { emotions: cfg.emotions, topics: cfg.topics, pains: await painsFor(deps, ctx, productId), fits: cfg.fits, formats: cfg.formats, passScore: cfg.pass_score, maxWords: cfg.max_words, dropLabels: DROP_LABEL },
  }
}

// The owner's Keep or Reject on a line (the writer and the reviewer learn
// from the latest ones).
export async function setLineCall(deps: Deps, ctx: Ctx, lineId: string, call: 'kept' | 'rejected' | null): Promise<void> {
  const [row] = await deps.db.update(bankLines).set({ call, calledAt: call ? deps.clock.now() : null, updatedAt: deps.clock.now() })
    .where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.id, lineId))).returning({ id: bankLines.id })
  if (!row) throw new AppError('not_found', 'That line is not in the bank.')
}

async function examples(deps: Deps, ctx: Ctx): Promise<string> {
  const n = cfgOf(deps).examples
  if (!n) return 'None yet.'
  const of = (call: string) => deps.db.select({ line: bankLines.line }).from(bankLines)
    .where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.call, call), isNotNull(bankLines.calledAt))).orderBy(desc(bankLines.calledAt)).limit(n)
  return examplesText((await of('kept')).map(r => r.line).filter(Boolean), (await of('rejected')).map(r => r.line).filter(Boolean))
}

// ── The priced run: tags, then the writer, then the reviewer ──────────

const listTagged = (rows: Array<Pick<BankRow, 'comment' | 'likes' | 'videoCaption' | 'tags'>>) => listComments(rows).split('\n').map((l, i) => {
  const t = rows[i]!.tags as BankTags | null
  return t ? `${l} [emotion: ${t.emotion}; topic: ${t.topic}; pain: ${t.pain}]` : l
}).join('\n')

async function writerVars(deps: Deps, ctx: Ctx, productId: string | null) {
  const cfg = cfgOf(deps)
  const { std } = await postWriting(deps, ctx, productId)
  return { standard: String(templateFor(deps, std, 'hook_standard')).trim(), examples: await examples(deps, ctx), max_words: String(cfg.max_words), pass_score: String(cfg.pass_score) }
}

// Token budgets from production (2026-10-22): a tag is about 60 output
// tokens, a line or a review about 80; the limit leaves room for each.
// "Tag, write and review": the comments not run yet (most liked first, up
// to `limit`), in batches; each batch is a tag call, then its writer, then
// its reviewer, quoted together and held up front.
export async function buildBankRun(deps: Deps, ctx: Ctx, input: { importId?: string | null; limit?: number | null }): Promise<BuiltAction> {
  const cfg = cfgOf(deps)
  const busy = await busyIds(deps, ctx)
  const rows = (await deps.db.select().from(bankLines).where(and(
    eq(bankLines.accountId, ctx.accountId), inArray(bankLines.state, ['new', 'failed']), input.importId ? eq(bankLines.importId, input.importId) : undefined,
  )).orderBy(desc(bankLines.likes), bankLines.id)).filter(r => !busy.has(r.id)).slice(0, input.limit && input.limit > 0 ? input.limit : undefined)
  if (!rows.length) throw new AppError('invalid_request', 'Every comment in the bank has been run. Import more comments first.')
  const [tagRoute, writeRoute, reviewRoute] = await Promise.all([resolveRoute(deps, ctx, 'line_tagger'), resolveRoute(deps, ctx, 'line_writer'), resolveRoute(deps, ctx, 'line_reviewer')])
  const t = deps.config.pipeline.templates
  const specs: JobSpec[] = []
  const previews: Array<{ label: string; text: string }> = []
  const varsByProduct = new Map<string, Awaited<ReturnType<typeof writerVars>> & { pains: string[] }>()
  for (let i = 0; i < rows.length; i += cfg.tag_batch) {
    const batch = rows.slice(i, i + cfg.tag_batch)
    // One product per batch (its pain points and its standard).
    const groups = new Map<string, typeof batch>()
    for (const r of batch) groups.set(r.productId ?? '', [...(groups.get(r.productId ?? '') ?? []), r])
    for (const [pid, group] of groups) {
      if (!varsByProduct.has(pid)) varsByProduct.set(pid, { ...await writerVars(deps, ctx, pid || null), pains: await painsFor(deps, ctx, pid || null) })
      const v = varsByProduct.get(pid)!
      const ids = group.map(r => r.id), n = group.length, key = ids[0]!
      const comments = listComments(group)
      const tagSystem = fill(t.line_bank_tags.system, { emotions: cfg.emotions.join(', '), topics: cfg.topics.join(', '), pains: v.pains.length ? v.pains.map(p => `  - ${p}`).join('\n') : '  (this product has no pain points: none)' })
      const tagPrompt = fill(t.line_bank_tags.prompt, { comments })
      const { pains: _pains, ...words } = v
      const writeSystem = fill(t.line_bank_writer.system, words)
      const writePrompt = fill(t.line_bank_writer.prompt, { comments })
      const reviewSystem = fill(t.line_bank_reviewer.system, words)
      // Priced on the comments as the lines' stand-in (a line is shorter).
      const reviewPrompt = fill(t.line_bank_reviewer.prompt, { lines: comments })
      const at = specs.length
      specs.push(
        { type: 'llm', stage: 'content', purpose: `bank_tag:${key}`, label: `Line bank: tag ${n} comments`, request: { model: tagRoute.model, system: tagSystem, prompt: tagPrompt, schema: tagsJsonSchema(n, cfg, v.pains), schemaName: 'line_bank_tags', maxTokens: 200 + 90 * n, effort: tagRoute.effort ?? 'low', meta: { ids, productId: pid || null, mockTags: mockTags(group, cfg, v.pains) } } },
        { type: 'llm', stage: 'content', purpose: `bank_write:${key}`, label: `Line bank: write ${n} lines`, parentIndex: at, request: { model: writeRoute.model, system: writeSystem, prompt: writePrompt, schema: writerJsonSchema(n), schemaName: 'line_bank_writer', maxTokens: 200 + 110 * n, effort: writeRoute.effort ?? 'medium', meta: { ids } } },
        { type: 'llm', stage: 'content', purpose: `bank_review:${key}`, label: `Line bank: review ${n} lines`, parentIndex: at + 1, request: { model: reviewRoute.model, system: reviewSystem, prompt: reviewPrompt, schema: reviewerJsonSchema(n), schemaName: 'line_bank_reviewer', maxTokens: 200 + 110 * n, effort: reviewRoute.effort ?? 'low', meta: { ids } } },
      )
      if (!previews.length) previews.push({ label: 'Tags (first batch)', text: `${tagSystem}\n${tagPrompt}` }, { label: 'Writer (first batch)', text: `${writeSystem}\n${writePrompt}` }, { label: 'Reviewer', text: `${reviewSystem}\n(the batch's lines, each under its source comment)` })
    }
  }
  const batches = specs.length / 3
  return {
    purpose: `bank_run:${rows[0]!.id}`, characterId: null, specs,
    preview: { title: `Tag, write and review ${rows.length} comments (${batches} batch${batches === 1 ? '' : 'es'})`, prompts: previews.map(p => ({ label: p.label, text: p.text, wrapped: hardWrap(p.text) })), warnings: [], invalidates: [] },
  }
}

const idsOf = (job: JobRow) => ((job.request as { meta?: { ids?: string[] } }).meta?.ids ?? [])
async function rowsIn(deps: Deps, ctx: Ctx, ids: string[]): Promise<BankRow[]> {
  if (!ids.length) return []
  const rows = await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), inArray(bankLines.id, ids)))
  const at = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => at.get(id)).filter((r): r is BankRow => !!r)
}
async function setRow(deps: Deps, id: string, patch: Partial<typeof bankLines.$inferInsert>) {
  await deps.db.update(bankLines).set({ ...patch, updatedAt: deps.clock.now() }).where(eq(bankLines.id, id))
}
const byN = <T extends { n?: unknown }>(list: unknown): Map<number, T & Record<string, unknown>> =>
  new Map((Array.isArray(list) ? list : []).map(x => [Math.round(Number((x as T).n)), x as T & Record<string, unknown>]))

async function failRun(deps: Deps, ctx: Ctx, job: JobRow, what: string) {
  for (const r of await rowsIn(deps, ctx, idsOf(job))) if (r.state !== 'written') await setRow(deps, r.id, { state: 'failed' })
  await cancelChildren(deps, job.id, `The ${what} did not finish, so the next step did not run. Nothing was charged for it; the comments go back in the queue.`)
}

async function onTagged(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return failRun(deps, ctx, job, 'tagging')
  const cfg = cfgOf(deps)
  const meta = (job.request as { meta?: { productId?: string | null } }).meta ?? {}
  const pains = await painsFor(deps, ctx, meta.productId ?? null)
  const rows = await rowsIn(deps, ctx, idsOf(job))
  const got = byN((out.data as { tags?: unknown })?.tags)
  for (const [i, r] of rows.entries()) {
    const tags = readTags(got.get(i + 1), cfg, pains)
    await setRow(deps, r.id, { tags, state: tags ? 'tagged' : 'failed' })
  }
  const tagged = await rowsIn(deps, ctx, idsOf(job))
  await activateChildren(deps, job.id, () => ({
    prompt: fill(deps.config.pipeline.templates.line_bank_writer.prompt, { comments: listTagged(tagged) }),
    meta: { ids: tagged.map(r => r.id), mockLines: mockLines(tagged, cfg.max_words) },
  }))
}

async function onWritten(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return failRun(deps, ctx, job, 'writer')
  const rows = await rowsIn(deps, ctx, idsOf(job))
  const got = byN((out.data as { lines?: unknown })?.lines)
  const written: BankRow[] = []
  for (const [i, r] of rows.entries()) {
    const w = got.get(i + 1)
    const line = cleanLine(w?.line)
    if (!w || w.skip === true || !line) {
      await setRow(deps, r.id, { line: '', skipped: String(w?.why ?? 'no line came back').slice(0, 240) || 'no usable truth', state: 'written', passed: null })
      continue
    }
    await setRow(deps, r.id, { line, skipped: '' })
    written.push({ ...r, line })
  }
  if (!written.length) { await cancelChildren(deps, job.id, 'The writer passed on every comment, so there was nothing to review. Nothing was charged for the review.'); return }
  const listed = written.map((r, i) => `${i + 1}. Line: ${r.line}\n   Source comment (${r.likes} likes): ${r.comment.slice(0, 400)}`).join('\n')
  await activateChildren(deps, job.id, () => ({
    prompt: fill(deps.config.pipeline.templates.line_bank_reviewer.prompt, { lines: listed }),
    schema: reviewerJsonSchema(written.length),
    meta: { ids: written.map(r => r.id), mockReview: mockReviews(written.length) },
  }))
}

async function onReviewed(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return failRun(deps, ctx, job, 'reviewer')
  const cfg = cfgOf(deps)
  const rows = await rowsIn(deps, ctx, idsOf(job))
  const got = byN((out.data as { reviews?: unknown })?.reviews)
  for (const [i, r] of rows.entries()) {
    const review = readReview(got.get(i + 1))
    await setRow(deps, r.id, { review, passed: passes(review, cfg.pass_score), state: 'written' })
  }
}

// ── Use: a line in a character's voice, placed on a post ──────────────

type Placed = { postId: string; lineId: string }

type LlmSpec = Extract<JobSpec, { type: 'llm' }>
async function voiceSpec(deps: Deps, ctx: Ctx, voice: Voice, rows: BankRow[], purpose: string, assignments: Placed[]): Promise<LlmSpec> {
  const cfg = cfgOf(deps)
  const route = await resolveRoute(deps, ctx, 'line_voice')
  const t = deps.config.pipeline.templates.line_bank_voice
  const system = fill(t.system, { max_words: String(cfg.max_words), voice: voice.voice || `${voice.name} has no voice card yet: keep the line's own voice.`, facts: voice.facts, stance: voice.stance === 'first' ? 'in the first person: they are the one out of work' : 'secondhand: about a friend, a sister or a roommate, never as their own job search' })
  const prompt = fill(t.prompt, { lines: rows.map((r, i) => `${i + 1}. ${r.line}`).join('\n') })
  return { type: 'llm', stage: 'content', purpose, label: rows.length === 1 ? `Line in ${voice.name}'s voice` : `${rows.length} lines in ${voice.name}'s voice`, characterId: voice.characterId, request: { model: route.model, system, prompt, schema: voiceJsonSchema(rows.length), schemaName: 'line_bank_voice', maxTokens: 200 + 100 * rows.length, effort: route.effort ?? 'low', meta: { ids: rows.map(r => r.id), characterId: voice.characterId, assignments, mockVoice: mockVoice(rows.map(r => r.line)) } } }
}

function usableFor(r: BankRow, voice: Voice, accountTag: string, auto: boolean): string | null {
  if (!r.passed) return 'That line did not pass the reviewer.'
  if (r.usedAccountTag != null && r.usedAccountTag.toLowerCase() !== accountTag.toLowerCase()) return `That line is used on @${r.usedAccountTag}; a line goes to one account only.`
  if (((r.skips as Skip[]) ?? []).some(s => s.characterId === voice.characterId)) return `That line does not fit ${voice.name}'s facts.`
  if (!fitsStance((r.tags as BankTags | null)?.fits, voice.stance)) return `That line is not told the way ${voice.name} tells lines.`
  if (auto && (r.tags as BankTags | null)?.fight) return 'Lines that could start a fight are never used automatically.'
  return null
}

const PLACEABLE = ['slideshow', 'meme', 'batch']

// "Use this line" on a post: one small call, then the line is placed.
export async function buildBankUse(deps: Deps, ctx: Ctx, input: { lineId: string; contentId: string }): Promise<BuiltAction> {
  const post = await getContent(deps, ctx, input.contentId)
  if (!PLACEABLE.includes(post.kind)) throw new AppError('bad_request', 'A line goes on a slideshow, a video post or a batch.')
  if (!post.characterId) throw new AppError('bad_request', 'Pick the post\'s character first: the line is put in their voice.')
  const [row] = await rowsIn(deps, ctx, [input.lineId])
  if (!row) throw new AppError('not_found', 'That line is not in the bank.')
  const voice = await voiceOf(deps, ctx, post.characterId)
  const why = usableFor(row, voice, post.accountTag, false)
  if (why) throw new AppError('invalid_request', why)
  if ((await busyIds(deps, ctx)).has(row.id)) throw new AppError('invalid_request', 'That line is being placed already.')
  const spec = await voiceSpec(deps, ctx, voice, [row], `bank_voice:${post.id}`, [{ postId: post.id, lineId: row.id }])
  return { purpose: spec.purpose, characterId: voice.characterId, specs: [spec], preview: { title: `Put the line in ${voice.name}'s voice and place it`, prompts: [{ label: 'Voice', text: `${spec.request.system}\n${spec.request.prompt}`, wrapped: hardWrap(`${spec.request.system}\n${spec.request.prompt}`) }], warnings: [], invalidates: [] } }
}

// "Write the week" for an account: its posts dated in the next 7 days with
// no bank line each get the best unused line that fits their character
// (most liked first; never a fight line), one call per character.
export async function weekPlan(deps: Deps, ctx: Ctx, accountTag: string): Promise<{ posts: Array<{ postId: string; label: string; date: string; characterId: string; lineId: string | null; line: string; current: string; why: string }>; from: string; to: string }> {
  const tag = accountTag.trim()
  if (!tag) throw new AppError('invalid_request', 'Pick the account.')
  const from = deps.clock.now().toISOString().slice(0, 10)
  const to = new Date(deps.clock.now().getTime() + 6 * 86_400_000).toISOString().slice(0, 10)
  const dated = await deps.db.select().from(contentItems).where(and(
    eq(contentItems.accountId, ctx.accountId), eq(contentItems.accountTag, tag), isNull(contentItems.archivedAt), inArray(contentItems.kind, PLACEABLE),
    sql`${contentItems.spec}->'plan'->>'date' >= ${from}`, sql`${contentItems.spec}->'plan'->>'date' <= ${to}`,
  ))
  const usedPosts = new Set((await deps.db.select({ id: bankLines.usedPostId }).from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), isNotNull(bankLines.usedPostId)))).map(r => r.id))
  const posts = dated.filter(p => !usedPosts.has(p.id) && p.characterId).sort((a, b) => planDate(a).localeCompare(planDate(b)))
  const busy = await busyIds(deps, ctx)
  const pool = (await deps.db.select().from(bankLines).where(and(eq(bankLines.accountId, ctx.accountId), eq(bankLines.passed, true))).orderBy(desc(bankLines.likes))).filter(r => !busy.has(r.id))
  const taken = new Set<string>()
  const voices = new Map<string, Voice>()
  const out = []
  for (const p of posts) {
    if (!voices.has(p.characterId!)) voices.set(p.characterId!, await voiceOf(deps, ctx, p.characterId!))
    const voice = voices.get(p.characterId!)!
    // Kept lines first, then the rest; the most liked first in each.
    const pick = [...pool.filter(r => r.call === 'kept'), ...pool.filter(r => r.call !== 'kept' && r.call !== 'rejected')].find(r => !taken.has(r.id) && !usableFor(r, voice, tag, true))
    if (pick) taken.add(pick.id)
    const spec = p.spec as { hook?: string; caption?: string; captions?: string[]; plan?: { rowId?: string } }
    out.push({ postId: p.id, label: spec.plan?.rowId || p.title || p.idea.slice(0, 40) || 'Post', date: planDate(p), characterId: p.characterId!, lineId: pick?.id ?? null, line: pick?.line ?? '', current: currentLine(p.kind, spec), why: pick ? '' : `No unused line fits ${voice.name} yet.` })
  }
  return { posts: out, from, to }
}
const planDate = (p: { spec: unknown }) => String((p.spec as { plan?: { date?: string } }).plan?.date ?? '')
const currentLine = (kind: string, spec: { hook?: string; caption?: string; captions?: string[] }) => (kind === 'slideshow' ? spec.hook ?? '' : kind === 'meme' ? spec.caption ?? '' : '')

export async function buildBankWeek(deps: Deps, ctx: Ctx, input: { accountTag: string }): Promise<BuiltAction> {
  const plan = await weekPlan(deps, ctx, input.accountTag)
  const filled = plan.posts.filter(p => p.lineId)
  if (!filled.length) throw new AppError('invalid_request', plan.posts.length ? 'No unused line in the bank fits these posts\' characters yet.' : `No posts on @${input.accountTag.trim()} are dated ${plan.from} to ${plan.to} without a bank line.`)
  const byChar = new Map<string, typeof filled>()
  for (const p of filled) byChar.set(p.characterId, [...(byChar.get(p.characterId) ?? []), p])
  const specs: LlmSpec[] = []
  for (const [characterId, list] of byChar) {
    const voice = await voiceOf(deps, ctx, characterId)
    specs.push(await voiceSpec(deps, ctx, voice, await rowsIn(deps, ctx, list.map(p => p.lineId!)), `bank_voice:week-${input.accountTag.trim()}`, list.map(p => ({ postId: p.postId, lineId: p.lineId! }))))
  }
  const replaced = filled.filter(p => p.current.trim()).length
  return {
    purpose: `bank_week:${input.accountTag.trim()}`, characterId: null, specs,
    preview: { title: `Write the week: ${filled.length} post${filled.length === 1 ? '' : 's'} on @${input.accountTag.trim()}`, prompts: specs.map(s => ({ label: s.label, text: `${s.request.system}\n${s.request.prompt}`, wrapped: hardWrap(`${s.request.system}\n${s.request.prompt}`) })), warnings: replaced ? [{ ruleId: 'bank-week-replaces', spec: 'UX-PLAN 36 (29f)', title: 'Replaces words', severity: 'warning', message: `${replaced} of these posts have words on slide 1 or in the caption already; the bank line takes their place.` }] : [], invalidates: [] },
  }
}

// The line, in the character's voice, goes on its post: a slideshow's
// hook, a video post's caption, a batch's next caption.
async function onVoiced(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  if (out.status !== 'completed') return
  const meta = (job.request as { meta?: { characterId?: string; assignments?: Placed[] } }).meta ?? {}
  const got = byN((out.data as { results?: unknown })?.results)
  for (const [i, a] of (meta.assignments ?? []).entries()) {
    const [row] = await rowsIn(deps, ctx, [a.lineId])
    if (!row) continue
    const r = got.get(i + 1)
    const line = cleanLine(r?.line)
    if (!r || r.fits === false || !line) {
      const skips = [...((row.skips as Skip[]) ?? []).filter(s => s.characterId !== meta.characterId), { characterId: meta.characterId!, why: String(r?.why ?? 'no line came back').slice(0, 240) }]
      await setRow(deps, row.id, { skips })
      continue
    }
    const post = await getContent(deps, ctx, a.postId).catch(() => null)
    if (!post) continue
    const spec = post.spec as { captions?: string[] }
    const patch = post.kind === 'slideshow' ? { hook: line } : post.kind === 'meme' ? { caption: line, captionOff: false } : { captions: [...(spec.captions ?? []).filter(c => c.trim()), line].slice(0, 50) }
    await updateContent(deps, ctx, post.id, { spec: patch })
    await setRow(deps, row.id, { usedPostId: post.id, usedAccountTag: post.accountTag, usedCharacterId: post.characterId, usedText: line, usedAt: deps.clock.now() })
  }
}

// ── Results: which truths perform ─────────────────────────────────────

export async function sourcesFor(deps: Deps, ctx: Ctx, postIds: string[]): Promise<Map<string, { id: string; comment: string; likes: number }>> {
  if (!postIds.length) return new Map()
  const rows = await deps.db.select({ id: bankLines.id, post: bankLines.usedPostId, comment: bankLines.comment, likes: bankLines.likes }).from(bankLines)
    .where(and(eq(bankLines.accountId, ctx.accountId), inArray(bankLines.usedPostId, postIds)))
  return new Map(rows.map(r => [r.post!, { id: r.id, comment: r.comment, likes: r.likes }]))
}

// The characters a bank can be filtered by.
export async function bankCharacters(deps: Deps, ctx: Ctx) {
  return deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(and(eq(characters.accountId, ctx.accountId), isNull(characters.archivedAt)))
}

let registered = false
export function registerLineBank(): void {
  if (registered) return
  registered = true
  registerJobHook('bank_tag', onTagged)
  registerJobHook('bank_write', onWritten)
  registerJobHook('bank_review', onReviewed)
  registerJobHook('bank_voice', onVoiced)
}
