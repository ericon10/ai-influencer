import { and, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { contentItems, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import {
  DAY, TIME, VIDEO_FILE, checklistText, folderNames, isApproved, leftOutReason, leftOutText, orderDay, postingDay, postingSlot, readPosting,
  shortWhen, slideFile, slotList, slotTime, type DayPost, type LeftOutKind, type Posting, type SlotTimes,
} from '../core/postingDay.js'
import { resultsJson } from '../core/postExport.js'
import { isProductPost } from '../core/slides.js'
import { getSetting, setSetting } from './settings.js'
import { exportPostNow, getContent, renderProblems, videoPostJson, type ContentOutputs, type ContentRow } from './content.js'
import { readAsset, saveAsset } from '../storage/assets.js'

// Download day (owner, 2026-10-17; UX-PLAN.md section 33): until the
// posting engine is ready, posts go out by hand. For a date: every video
// post and slideshow planned or scheduled for it, in posting order, each
// going in or left out with the reason (free preview); then one zip made on
// the worker (free): a folder per account, a subfolder per slot (numbered
// slides or video.mp4, caption.txt, post.json), checklist.txt and
// left-out.txt. Only approved posts go in; an approved post never exported
// is exported first (free). Each post packed is marked, so it does not pack
// twice. A batch (many videos in one post) is not a day's post: its own zip
// is its download.

const SETTING = 'posting_slot_times'
const PACK = 'posting_pack'

export async function slotTimes(deps: Deps, ctx: Ctx): Promise<SlotTimes> {
  const saved = await getSetting<SlotTimes | null>(deps.db, ctx.accountId, SETTING, null)
  return { ...deps.config.pipeline.content.posting.slot_times, ...(saved ?? {}) }
}

// The slot times (Download day > Slot times): a clock time per slot; a
// slot can be added; an empty time takes a slot out (a default slot goes
// back to its default).
export async function saveSlotTimes(deps: Deps, ctx: Ctx, times: SlotTimes): Promise<Array<{ slot: string; time: string }>> {
  const clean: SlotTimes = {}
  for (const [slot, time] of Object.entries(times)) {
    const s = slot.trim().slice(0, 12)
    if (!s) continue
    if (time && !TIME.test(time)) throw new AppError('invalid_request', `"${time}" is not a time for ${s} (use 09:00 or 18:30).`)
    if (time) clean[s] = time
  }
  if (!Object.keys(clean).length) throw new AppError('invalid_request', 'Keep at least one slot time.')
  await setSetting(deps, ctx, SETTING, clean)
  return slotList(await slotTimes(deps, ctx))
}

// A post's posting state, written on its own (never through the post's
// spec patch, never moving it up Posts home). Approve for posting, the
// owner's own day and slot.
export async function setPosting(deps: Deps, ctx: Ctx, itemId: string, patch: { approved?: boolean; date?: string; slot?: string }): Promise<Posting> {
  const row = await getContent(deps, ctx, itemId)
  if (row.kind === 'batch') throw new AppError('bad_request', 'A batch is many videos in one post: download its zip in its Finish step. Download day packs video posts and slideshows.')
  if (patch.date && !DAY.test(patch.date)) throw new AppError('invalid_request', `"${patch.date}" is not a day (YYYY-MM-DD).`)
  const before = readPosting((row.spec as { posting?: unknown } | null)?.posting)
  const next: Posting = {
    ...before,
    ...(patch.date !== undefined ? { date: patch.date } : {}),
    ...(patch.slot !== undefined ? { slot: patch.slot.trim().slice(0, 12) } : {}),
    ...(patch.approved !== undefined ? { approved: patch.approved, approvedAt: patch.approved ? deps.clock.now().toISOString() : null } : {}),
  }
  await writePosting(deps, ctx, row.id, next)
  return next
}

async function writePosting(deps: Deps, ctx: Ctx, id: string, posting: Posting): Promise<void> {
  await deps.db.update(contentItems)
    .set({ spec: sql`jsonb_set(coalesce(${contentItems.spec}, '{}'::jsonb), '{posting}', ${JSON.stringify(posting)}::jsonb, true)` })
    .where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, id)))
}

type Spec = {
  hook?: string; caption?: string; review?: string | null; ad?: boolean; productEnding?: string | null
  plan?: { rowId?: string; date?: string; slot?: string; product?: boolean } | null
  results?: { postedAt?: string } | null; posting?: unknown
}

const exportedOf = (row: ContentRow) => {
  const o = (row.outputs ?? {}) as ContentOutputs
  return row.kind === 'slideshow' ? !!(o.imageAssetIds?.length && o.jsonAssetId) : !!o.videoAssetId
}

// What a post is on the day: its account, slot, hook, Ad, approval,
// whether it was packed, whether its files are made, and what stops them.
function dayPost(deps: Deps, row: ContentRow): DayPost {
  const s = (row.spec ?? {}) as Spec
  const posting = readPosting(s.posting)
  const o = (row.outputs ?? {}) as ContentOutputs
  const exported = exportedOf(row)
  let missing: string | null = null, problem: string | null = null
  if (!exported) {
    const problems = renderProblems(deps, row)
    if (row.kind === 'slideshow') missing = problems.length ? problems.join('; ') : null
    else {
      if (problems.includes('Pick a clip')) missing = 'the clip (Video step)'
      const rest = problems.filter(p => p !== 'Pick a clip')
      problem = rest.length ? rest.join('; ') : null
    }
  }
  const hook = (row.kind === 'slideshow' ? s.hook : s.caption) ?? ''
  return {
    id: row.id, name: row.title.trim() || hook.trim().slice(0, 80) || row.idea.trim().slice(0, 60) || 'Untitled post', kind: row.kind,
    account: row.accountTag, slot: postingSlot({ posting, planSlot: s.plan?.slot }), hook: hook || row.title,
    ad: row.kind === 'slideshow' ? isProductPost(s) : !!s.plan?.product,
    approved: isApproved(posting, s.review), packed: posting.packed,
    exported, exportedAt: exported ? o.renderedAt ?? null : null, rendering: row.status === 'rendering',
    missing, problem, rowId: String(s.plan?.rowId ?? ''),
  }
}

// The day's posts: video posts and slideshows whose day (the owner's own,
// else the plan's, else when it was posted) is this date.
async function dayRows(deps: Deps, ctx: Ctx, date: string): Promise<ContentRow[]> {
  const rows = await deps.db.select().from(contentItems).where(and(
    eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), inArray(contentItems.kind, ['meme', 'slideshow']),
    sql`(${contentItems.spec}->'posting'->>'date' = ${date} or ${contentItems.spec}->'plan'->>'date' = ${date} or left(${contentItems.spec}->'results'->>'postedAt', 10) = ${date})`,
  ))
  return rows.filter(r => {
    const s = (r.spec ?? {}) as Spec
    return postingDay({ posting: readPosting(s.posting), planDate: s.plan?.date, postedAt: s.results?.postedAt }) === date
  })
}

export interface DayRow extends DayPost { in: boolean; reason: string | null; reasonKind: LeftOutKind | null; exportFirst: boolean; time: string | null; folder: string | null }

async function planDay(deps: Deps, ctx: Ctx, date: string, o: { includePacked: boolean; tz?: string | null }) {
  const times = await slotTimes(deps, ctx)
  const rows = await dayRows(deps, ctx, date)
  const posts = orderDay(rows.map(r => dayPost(deps, r)), times)
  const judged = posts.map(p => ({ p, why: leftOutReason(p, o) }))
  const folders = folderNames(judged.filter(x => !x.why).map(x => x.p), times)
  const out: DayRow[] = judged.map(({ p, why }) => ({ ...p, in: !why, reason: why?.text ?? null, reasonKind: why?.kind ?? null, exportFirst: !why && !p.exported, time: slotTime(p.slot, times), folder: why ? null : folders.get(p.id) ?? null }))
  return { times, rows: out, byId: new Map(rows.map(r => [r.id, r])) }
}

// The packs made, newest first (each is the worker job that made it).
async function packList(deps: Deps, ctx: Ctx, limit = 10) {
  const rows = await deps.db.select().from(jobs).where(and(eq(jobs.accountId, ctx.accountId), like(jobs.purpose, `${PACK}:%`))).orderBy(desc(jobs.createdAt)).limit(limit)
  return rows.map(j => {
    const req = j.request as { date: string; postIds?: string[] }
    const data = ((j.resultMeta ?? {}) as { data?: PackResult }).data
    return {
      id: j.id, date: req.date, status: j.status, createdAt: j.createdAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null,
      assetId: data?.assetId ?? null, posts: data?.posts.length ?? req.postIds?.length ?? 0, leftOut: data?.leftOut.length ?? 0,
      error: (j.error as { message?: string } | null)?.message ?? null,
    }
  })
}
const ACTIVE = ['queued', 'submitting', 'running', 'waiting']

// Download day's preview (free): every post of the day in posting order,
// going in or left out with the reason; the slot times; the packs.
export async function dayView(deps: Deps, ctx: Ctx, q: { date: string; includePacked?: boolean; tz?: string | null }) {
  if (!DAY.test(q.date)) throw new AppError('invalid_request', 'Pick a day.')
  const { times, rows } = await planDay(deps, ctx, q.date, { includePacked: !!q.includePacked, tz: q.tz })
  const packs = await packList(deps, ctx)
  return {
    date: q.date, slots: slotList(times), rows,
    counts: { in: rows.filter(r => r.in).length, out: rows.filter(r => !r.in).length, exportFirst: rows.filter(r => r.exportFirst).length },
    running: packs.find(p => p.date === q.date && ACTIVE.includes(p.status)) ?? null,
    packs,
  }
}
export type DayView = Awaited<ReturnType<typeof dayView>>

// "Make the zip": a free local job on the worker.
export async function startPack(deps: Deps, ctx: Ctx, input: { date: string; includePacked?: boolean; tz?: string | null }): Promise<{ jobId: string; posts: number }> {
  const view = await dayView(deps, ctx, input)
  if (view.running) throw new AppError('bad_request', 'A zip for this day is being made. Wait for it to finish.')
  const ids = view.rows.filter(r => r.in).map(r => r.id)
  if (!ids.length) throw new AppError('bad_request', view.rows.length ? 'Nothing to pack: every post of this day is left out (the list says why).' : 'No post is planned for this day.')
  const job = await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `${PACK}:${input.date}`, label: `Download day ${input.date}: ${ids.length} post${ids.length === 1 ? '' : 's'}`, characterId: null, request: { date: input.date, includePacked: !!input.includePacked, tz: input.tz ?? null, postIds: ids } })
  return { jobId: job.id, posts: ids.length }
}

export interface PackResult { assetId: string; date: string; posts: Array<{ id: string; folder: string }>; leftOut: Array<{ id: string; reason: string }>; exported: string[] }

async function runPack(deps: Deps, ctx: Ctx, job: JobRow): Promise<PackResult> {
  const req = job.request as { date: string; includePacked: boolean; tz: string | null; postIds: string[] }
  const tz = req.tz
  const wanted = new Set(req.postIds)
  // Approved but never exported: exported first (free, here on the worker).
  const exported: string[] = []
  const failed = new Map<string, string>()
  const first = await planDay(deps, ctx, req.date, { includePacked: req.includePacked, tz })
  for (const r of first.rows.filter(x => x.in && x.exportFirst && wanted.has(x.id))) {
    try { await exportPostNow(deps, ctx, job, await getContent(deps, ctx, r.id)); exported.push(r.id) } catch (e) { failed.set(r.id, `Could not be exported: ${(e as Error).message.slice(0, 200)}`) }
  }
  // The day again, with the new exports.
  const { times, rows, byId } = await planDay(deps, ctx, req.date, { includePacked: req.includePacked, tz })
  const going = rows.filter(r => r.in && wanted.has(r.id) && !failed.has(r.id))
  const folders = folderNames(going, times)
  const madeAt = shortWhen(deps.clock.now().toISOString(), tz)
  const root = req.date
  const files: Record<string, Uint8Array> = {}
  const packedAt = deps.clock.now().toISOString()
  for (const r of going) {
    const row = byId.get(r.id)!
    const dir = `${root}/${folders.get(r.id)!}`
    const o = (row.outputs ?? {}) as ContentOutputs
    let json: Record<string, unknown>
    if (row.kind === 'slideshow') {
      for (const [i, a] of (o.imageAssetIds ?? []).entries()) files[`${dir}/${slideFile(i)}`] = (await readAsset(deps, ctx, a)).data
      json = JSON.parse((await readAsset(deps, ctx, o.jsonAssetId!)).data.toString('utf8')) as Record<string, unknown>
    } else {
      files[`${dir}/${VIDEO_FILE}`] = (await readAsset(deps, ctx, o.videoAssetId!)).data
      json = o.jsonAssetId ? JSON.parse((await readAsset(deps, ctx, o.jsonAssetId)).data.toString('utf8')) as Record<string, unknown> : await videoPostJson(deps, ctx, row, { assetId: o.videoAssetId!, durationSec: o.durationSec ?? null, file: VIDEO_FILE })
    }
    const caption = String(((json.caption ?? {}) as { as_posted?: string }).as_posted ?? '')
    files[`${dir}/caption.txt`] = Buffer.from(`${caption}\n`)
    const posting = readPosting(((row.spec ?? {}) as Spec).posting)
    json.results = resultsJson(((row.spec ?? {}) as { results?: Parameters<typeof resultsJson>[0] }).results)
    json.posting = { date: req.date, slot: r.slot || null, slot_time: r.time, folder: folders.get(r.id), approved_at: posting.approvedAt, pack_id: job.id, packed_at: packedAt, ai_label: 'on' }
    files[`${dir}/post.json`] = Buffer.from(`${JSON.stringify(json, null, 2)}\n`)
  }
  files[`${root}/checklist.txt`] = Buffer.from(checklistText(req.date, going, folders, times, madeAt))
  const out = rows.filter(r => !going.some(g => g.id === r.id)).map(r => ({ ...r, reason: failed.get(r.id) ?? r.reason ?? 'Not in the list when the zip was started: make the zip again to add it' }))
  files[`${root}/left-out.txt`] = Buffer.from(leftOutText(req.date, out, times))
  const zip = await saveAsset(deps, ctx, { data: Buffer.from(zipSync(files, { level: 0 })), mime: 'application/zip', origin: 'derived', label: `Download day ${req.date} (zip)`, sourceJobId: job.id })
  // Packed: each post that went in, so the next Download day leaves it out.
  for (const r of going) {
    const row = await getContent(deps, ctx, r.id)
    const posting = readPosting(((row.spec ?? {}) as Spec).posting)
    await writePosting(deps, ctx, r.id, { ...posting, packed: { at: packedAt, packId: job.id, date: req.date, assetId: zip.id } })
  }
  return { assetId: zip.id, date: req.date, posts: going.map(r => ({ id: r.id, folder: folders.get(r.id)! })), leftOut: out.map(r => ({ id: r.id, reason: r.reason! })), exported }
}

let registered = false
export function registerPostingDay(): void {
  if (registered) return
  registered = true
  registerLocalJob(PACK, runPack)
}
