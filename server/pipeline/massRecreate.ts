import { and, eq, inArray, like } from 'drizzle-orm'
import { characters, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { randomBytes } from 'node:crypto'
import { newId } from '../lib/ids.js'
import { registerJobHook, registerLocalJob, type JobOutcome, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob, quoteItemsFor, type JobSpec } from '../jobs/runner.js'
import { displayPrice } from '../costs/quotes.js'
import { parseCsv } from '../core/csvImport.js'
import type { RuleViolation } from '../core/rules.js'
import type { GenRequest } from '../providers/types.js'
import { readSecret } from '../providers/credentials.js'
import { readAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'
import { createAgeChecker, type AgeChecker } from '../qa/age.js'
import { createContent, getContent, updateContent, type CloneSource } from './content.js'
import { addCloneSource, bestCloneStill, buildClone, buildCloneStill, cloneModel, cloneStills, motionPath, postClones, useCloneStill } from './clone.js'
import { runModel } from './sceneActions.js'
import { providerMode } from './settings.js'

// Mass recreate (owner, 2026-10-22; UX-PLAN.md section 36, item 24): real
// motion in bulk, in a batch post. The rows come from a Google Sheet of
// TikTok links (columns: the link, character, keep place or new set, motion
// model, notes) or a Google Drive folder of clips (synced: a sync adds the
// clips that are new). Each clip is fetched one at a time (a TikTok link
// through the owner's Apify account, priced per clip; a Drive clip free with
// the owner's Google key), cleaned (watermark and captions masked, the end
// card cut, as every Recreate clip), and a failure is skipped with its
// reason. Then a free first pass: a clear adult in every face (or the row is
// skipped), how many people, the length, and the price of the row. The owner
// ticks rows, sees one total and clicks once: stills first (every row runs
// the Recreate recipe: the first frame, stills, the face pass, the gates),
// Keep or Reject on each row's still, then the videos for the kept rows
// only. Each row is its own queue group, so a long run goes on overnight
// at the daily cap. Two-person clips take two characters, left to right,
// swappable. Every model has an API path (Google AI Studio and fal), so it
// works without a Higgsfield plan.

export type MassStatus = 'to_fetch' | 'fetching' | 'checking' | 'ready' | 'skipped'
export interface MassCheck { adult: boolean | null; people: number | null; seconds: number | null; notes: string[] }
export interface MassRow {
  id: string
  source: { kind: 'tiktok' | 'drive' | 'link'; url: string; driveId: string | null; name: string }
  // Left to right; one or two.
  characters: string[]
  place: 'keep' | 'new'
  model: string | null
  notes: string
  status: MassStatus
  reason: string | null
  postId: string | null
  check: MassCheck | null
  ticked: boolean
  stillCall: 'kept' | 'rejected' | null
}
export interface MassState { sheet: string | null; folder: string | null; syncedAt: string | null; rows: MassRow[] }

const EMPTY: MassState = { sheet: null, folder: null, syncedAt: null, rows: [] }
const MAX_ROWS = 200

async function batchOf(deps: Deps, ctx: Ctx, batchId: string) {
  const batch = await getContent(deps, ctx, batchId)
  if (batch.kind !== 'batch') throw new AppError('bad_request', 'Mass recreate lives in a batch post.')
  const mass = { ...EMPTY, ...((batch.spec as { mass?: Partial<MassState> | null }).mass ?? {}) } as MassState
  return { batch, mass }
}

async function saveMass(deps: Deps, ctx: Ctx, batchId: string, change: (m: MassState) => MassState): Promise<MassState> {
  // Read again right before writing: hooks and the worker change rows too.
  const { mass } = await batchOf(deps, ctx, batchId)
  const next = change(mass)
  await updateContent(deps, ctx, batchId, { spec: { mass: next } })
  return next
}

const patchRow = (deps: Deps, ctx: Ctx, batchId: string, rowId: string, patch: Partial<MassRow>) =>
  saveMass(deps, ctx, batchId, m => ({ ...m, rows: m.rows.map(r => (r.id === rowId ? { ...r, ...patch } : r)) }))

// ── Reading the sources (free) ──────────────────────────────────────

// The sheet's CSV: a Google Sheets link (shared "anyone with the link can
// view"; the tab by its gid) or a CSV link.
export function sheetCsvUrl(link: string): string {
  let u: URL
  try { u = new URL(link.trim()) } catch { throw new AppError('invalid_request', 'Paste the Google Sheet link (https://docs.google.com/spreadsheets/d/...).') }
  const m = u.pathname.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
  if (u.hostname === 'docs.google.com' && m) {
    const gid = u.searchParams.get('gid') ?? u.hash.match(/gid=(\d+)/)?.[1] ?? '0'
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`
  }
  if (u.protocol === 'https:' && /\.csv$|format=csv|output=csv/.test(u.pathname + u.search)) return u.toString()
  throw new AppError('invalid_request', 'Paste a Google Sheet link (or a link to its CSV).')
}

export function driveFolderId(link: string): string {
  const m = link.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? link.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (!m) throw new AppError('invalid_request', 'Paste the Google Drive folder link (https://drive.google.com/drive/folders/...).')
  return m[1]!
}

const col = (headers: string[], re: RegExp) => headers.findIndex(h => re.test(h))

// The motion model a sheet names (its label, an alias or its ref), or null.
function modelFor(deps: Deps, words: string): string | null {
  const w = words.trim().toLowerCase()
  if (!w) return null
  const motion = deps.config.pipeline.content.clone.models.map(m => deps.config.models.models.find(x => x.ref === m.ref)!).filter(m => m?.clone?.mode === 'motion')
  return motion.find(m => m.ref === w || m.label.toLowerCase() === w || m.aliases.some(a => a.toLowerCase() === w))?.ref
    ?? motion.find(m => m.label.toLowerCase().includes(w) || w.includes(m.label.toLowerCase()))?.ref ?? null
}

// Rows from the sheet's cells. Pure apart from the character names.
export function rowsFromCsv(deps: Deps, csv: string, chars: Array<{ id: string; name: string }>, fallbackCharacter: string | null): MassRow[] {
  const table = parseCsv(csv).filter(r => r.some(c => c.trim()))
  if (table.length < 2) throw new AppError('invalid_request', 'The sheet has no rows under its header.')
  const headers = table[0]!.map(h => h.trim().toLowerCase())
  const iUrl = col(headers, /url|link|tiktok|video/), iChar = col(headers, /character|who/), iPlace = col(headers, /keep|place|set/), iModel = col(headers, /model|motion/), iNotes = col(headers, /note/)
  if (iUrl < 0) throw new AppError('invalid_request', 'The sheet needs a column with the TikTok links (a header like "url" or "link").')
  const byName = new Map(chars.map(c => [c.name.trim().toLowerCase(), c.id]))
  const out: MassRow[] = []
  for (const cells of table.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
    const url = cell(iUrl)
    if (!url) continue
    const names = cell(iChar).split(/\s*(?:,|\+|&|\/|\band\b)\s*/i).map(s => s.trim()).filter(Boolean).slice(0, 2)
    const unknown = names.filter(n => !byName.has(n.toLowerCase()))
    const ids = names.length ? names.map(n => byName.get(n.toLowerCase())).filter((x): x is string => !!x) : fallbackCharacter ? [fallbackCharacter] : []
    const modelWords = cell(iModel)
    const model = modelFor(deps, modelWords)
    let kind: MassRow['source']['kind'] = 'link'
    let reason: string | null = null
    try {
      const u = new URL(url)
      if (/(^|\.)tiktok\.com$/.test(u.hostname)) kind = 'tiktok'
      else if (u.protocol !== 'https:') reason = 'Only https links are read.'
    } catch { reason = `"${url.slice(0, 60)}" is not a link.` }
    if (unknown.length) reason = `No character named ${unknown.map(n => `"${n}"`).join(' or ')}. Pick one of: ${chars.map(c => c.name).join(', ')}.`
    else if (!ids.length) reason = 'No character in the row (and the batch has none to fall back on).'
    const notes = [cell(iNotes), modelWords && !model ? `Model "${modelWords}" is not one of the motion models; the default is used.` : ''].filter(Boolean).join(' ')
    out.push({
      id: newId('mr'), source: { kind, url, driveId: null, name: url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80) },
      characters: ids, place: /new/i.test(cell(iPlace)) ? 'new' : 'keep', model, notes,
      status: reason ? 'skipped' : 'to_fetch', reason, postId: null, check: null, ticked: true, stillCall: null,
    })
  }
  return out
}

async function accountCharacters(deps: Deps, ctx: Ctx) {
  return deps.db.select({ id: characters.id, name: characters.name }).from(characters).where(eq(characters.accountId, ctx.accountId))
}

// "Read the sheet" (free): new links become rows to fetch; links already in
// the batch are left as they are.
export async function readMassSheet(deps: Deps, ctx: Ctx, batchId: string, input: { link?: string; csv?: string }, fetchImpl: typeof fetch = fetch): Promise<{ added: number; skipped: number; already: number }> {
  const { batch, mass } = await batchOf(deps, ctx, batchId)
  let csv = input.csv ?? ''
  if (!csv) {
    if (!input.link) throw new AppError('invalid_request', 'Paste the sheet link.')
    const res = await fetchImpl(sheetCsvUrl(input.link), { redirect: 'follow' }).catch(e => { throw new AppError('bad_request', `Could not read the sheet: ${(e as Error).message}`) })
    const text = await res.text()
    if (!res.ok || /^\s*<!doctype html|<html/i.test(text)) throw new AppError('bad_request', 'Google did not share the sheet. In the sheet: Share, General access, Anyone with the link (Viewer). Then read it again.')
    csv = text
  }
  const rows = rowsFromCsv(deps, csv, await accountCharacters(deps, ctx), batch.characterId)
  const have = new Set(mass.rows.map(r => r.source.url))
  const fresh = rows.filter(r => !have.has(r.source.url))
  if (mass.rows.length + fresh.length > MAX_ROWS) throw new AppError('invalid_request', `A mass recreate takes up to ${MAX_ROWS} rows; this would make ${mass.rows.length + fresh.length}.`)
  await saveMass(deps, ctx, batchId, m => ({ ...m, sheet: input.link ?? m.sheet, rows: [...m.rows, ...fresh] }))
  // Direct file links need no fetch: they start now (free).
  await startLinks(deps, ctx, batchId)
  return { added: fresh.length, skipped: fresh.filter(r => r.status === 'skipped').length, already: rows.length - fresh.length }
}

// "Sync the folder" (free): the folder's videos that are not rows yet.
// Google Drive API v3 with the account's Google key (the Drive API on for
// its project; the folder shared "anyone with the link").
export async function syncMassFolder(deps: Deps, ctx: Ctx, batchId: string, input: { link?: string }, fetchImpl: typeof fetch = fetch): Promise<{ added: number; already: number }> {
  const { batch, mass } = await batchOf(deps, ctx, batchId)
  const link = input.link ?? mass.folder
  if (!link) throw new AppError('invalid_request', 'Paste the Drive folder link.')
  const folder = driveFolderId(link)
  const key = await readSecret(deps.db, deps.vault, ctx.accountId, 'google')
  if (!key) throw new AppError('provider_not_configured', 'Add your Google AI Studio key in Settings > Provider keys (turn on the Google Drive API for its project) to read the folder.')
  const files: Array<{ id: string; name: string; mimeType: string }> = []
  let page: string | undefined
  for (let i = 0; i < 20; i++) {
    const q = encodeURIComponent(`'${folder}' in parents and mimeType contains 'video/' and trashed = false`)
    const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=200${page ? `&pageToken=${page}` : ''}&key=${encodeURIComponent(key)}`)
    const body = await res.json().catch(() => ({})) as { files?: typeof files; nextPageToken?: string; error?: { message?: string } }
    if (!res.ok) throw new AppError('bad_request', `Google Drive did not list the folder: ${body.error?.message ?? res.status}. Share the folder (anyone with the link) and turn on the Drive API for the key's project.`)
    files.push(...(body.files ?? []))
    page = body.nextPageToken
    if (!page) break
  }
  const have = new Set(mass.rows.map(r => r.source.driveId).filter(Boolean))
  const fresh: MassRow[] = files.filter(f => !have.has(f.id)).map(f => ({
    id: newId('mr'), source: { kind: 'drive', url: `https://drive.google.com/file/d/${f.id}/view`, driveId: f.id, name: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) },
    characters: batch.characterId ? [batch.characterId] : [], place: 'keep', model: null, notes: '', status: batch.characterId ? 'to_fetch' : 'skipped', reason: batch.characterId ? null : 'Pick the batch\'s character first.', postId: null, check: null, ticked: true, stillCall: null,
  }))
  if (mass.rows.length + fresh.length > MAX_ROWS) throw new AppError('invalid_request', `A mass recreate takes up to ${MAX_ROWS} rows; this would make ${mass.rows.length + fresh.length}.`)
  await saveMass(deps, ctx, batchId, m => ({ ...m, folder: link, syncedAt: deps.clock.now().toISOString(), rows: [...m.rows, ...fresh] }))
  if (fresh.length) await queueDriveFetch(deps, ctx, batchId)
  return { added: fresh.length, already: files.length - fresh.length }
}

async function queueDriveFetch(deps: Deps, ctx: Ctx, batchId: string) {
  const busy = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.purpose, `mass_drive:${batchId}`), inArray(jobs.status, ['queued', 'running']))).limit(1)
  if (!busy.length) await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `mass_drive:${batchId}`, label: 'Fetch the folder\'s clips, one at a time', characterId: null, request: {} })
}

// ── Fetching, one at a time ─────────────────────────────────────────

// A row's clip becomes its own video post, open at Recreate; the clip is
// prepared (cleaned) on the worker, then the free first pass runs.
async function startRow(deps: Deps, ctx: Ctx, batchId: string, row: MassRow, from: { assetId: string } | { uploadId: string } | { link: string }): Promise<string> {
  // A row's post is for the batch's product, the owner's pick on the batch (section 45).
  const batch = await getContent(deps, ctx, batchId)
  const post = await createContent(deps, ctx, { kind: 'meme', characterId: row.characters[0]!, idea: `Recreate: ${row.source.name}`, step: 'video', productId: batch.productId, spec: { start: 'clip', massOf: { batchId, rowId: row.id } } })
  await addCloneSource(deps, ctx, { contentId: post.id, name: row.source.name, ...from })
  await patchRow(deps, ctx, batchId, row.id, { postId: post.id, status: 'checking', reason: null })
  return post.id
}

async function startLinks(deps: Deps, ctx: Ctx, batchId: string) {
  const { mass } = await batchOf(deps, ctx, batchId)
  for (const r of mass.rows.filter(x => x.status === 'to_fetch' && x.source.kind === 'link')) {
    try { await startRow(deps, ctx, batchId, r, { link: r.source.url }) } catch (e) { await patchRow(deps, ctx, batchId, r.id, { status: 'skipped', reason: (e as Error).message }) }
  }
}

// The worker fetches the folder's new clips one at a time (free); a clip
// that fails is skipped with its reason and the next one goes on.
async function runDriveFetch(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const batchId = job.purpose.split(':')[1]!
  const key = await readSecret(deps.db, deps.vault, ctx.accountId, 'google')
  let done = 0
  for (;;) {
    const { mass } = await batchOf(deps, ctx, batchId)
    const row = mass.rows.find(r => r.status === 'to_fetch' && r.source.kind === 'drive')
    if (!row) break
    await patchRow(deps, ctx, batchId, row.id, { status: 'fetching' })
    try {
      if (!key) throw new Error('No Google key in Settings > Provider keys.')
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${row.source.driveId}?alt=media&key=${encodeURIComponent(key)}`)
      if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`)
      const data = Buffer.from(await res.arrayBuffer())
      if (data.length > deps.config.pipeline.content.clone.max_upload_mb * 1024 * 1024) throw new Error(`Over ${deps.config.pipeline.content.clone.max_upload_mb} MB.`)
      const uploadId = `upl_${randomBytes(15).toString('hex').slice(0, 20)}`
      await deps.store.put(uploadKey(ctx.accountId, uploadId), data, res.headers.get('content-type') ?? 'video/mp4')
      await startRow(deps, ctx, batchId, row, { uploadId })
      done++
    } catch (e) {
      await patchRow(deps, ctx, batchId, row.id, { status: 'skipped', reason: `Could not fetch the clip: ${(e as Error).message}` })
    }
  }
  return { fetched: done }
}

// "Fetch N clips" (priced): each TikTok link through Apify, one at a time
// (a queue group each), so a dead link is skipped and the rest go on.
export async function buildMassFetch(deps: Deps, ctx: Ctx, input: { contentId: string }) {
  const { batch, mass } = await batchOf(deps, ctx, input.contentId)
  const todo = mass.rows.filter(r => r.status === 'to_fetch' && r.source.kind === 'tiktok')
  if (!todo.length) throw new AppError('bad_request', 'No TikTok link is waiting to be fetched.')
  const run = await runModel(deps, ctx, deps.config.pipeline.content.clone.mass.fetch_model, 'video')
  const specs: JobSpec[] = todo.map((r, i) => ({
    type: 'gen', stage: 'content', purpose: `mass_fetch:${batch.id}:${r.id}`, label: `Fetch ${r.source.name}`,
    request: { kind: 'video', model: run.model, modelRef: deps.config.pipeline.content.clone.mass.fetch_model, prompt: '', fetchUrl: r.source.url, audio: true } satisfies GenRequest,
    queue: { group: i },
  }))
  return {
    purpose: `mass_fetch:${batch.id}`, characterId: batch.characterId, specs,
    preview: { title: `Fetch ${todo.length} TikTok clip${todo.length === 1 ? '' : 's'}, one at a time`, prompts: [], warnings: [] as RuleViolation[], invalidates: [] as string[] },
  }
}

export async function afterMassFetchStarted(deps: Deps, ctx: Ctx, batchId: string): Promise<void> {
  await saveMass(deps, ctx, batchId, m => ({ ...m, rows: m.rows.map(r => (r.status === 'to_fetch' && r.source.kind === 'tiktok' ? { ...r, status: 'fetching' } : r)) }))
}

async function onMassFetch(deps: Deps, ctx: Ctx, job: JobRow, out: JobOutcome): Promise<void> {
  const [, batchId, rowId] = job.purpose.split(':') as [string, string, string]
  const { mass } = await batchOf(deps, ctx, batchId).catch(() => ({ mass: null }))
  const row = mass?.rows.find(r => r.id === rowId)
  if (!row) return
  const video = out.assets?.find(a => a.kind === 'video')
  if (out.status !== 'completed' || !video) {
    await patchRow(deps, ctx, batchId, rowId, { status: 'skipped', reason: `Could not fetch the clip: ${out.error ?? 'no video came back'}.` })
    return
  }
  try { await startRow(deps, ctx, batchId, row, { assetId: video.id }) } catch (e) { await patchRow(deps, ctx, batchId, rowId, { status: 'skipped', reason: (e as Error).message }) }
}

// ── The free first pass ─────────────────────────────────────────────

let ages: AgeChecker | null = null

// Queued when a row's clip is ready (clone.ts calls this after the clip is
// prepared): the free first pass on the worker.
export async function afterMassClipReady(deps: Deps, ctx: Ctx, postId: string): Promise<void> {
  const post = await getContent(deps, ctx, postId).catch(() => null)
  const of = (post?.spec as { massOf?: { batchId: string; rowId: string } | null } | undefined)?.massOf
  if (!of) return
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `mass_check:${of.batchId}:${of.rowId}`, label: 'Free first pass: an adult, people, length', characterId: post!.characterId, request: { postId } })
}

// What the free pass decides, from what it read. Pure (unit tested).
export function massVerdict(input: { seconds: number | null; people: number; characters: number; adult: boolean | null; ageNote: string | null; minSec: number; maxSec: number; demo: boolean }): { ok: boolean; reason: string | null; notes: string[] } {
  const notes: string[] = []
  if (input.ageNote) notes.push(input.ageNote)
  if (!input.demo && input.adult !== true) return { ok: false, reason: input.adult === false ? `No clear adult in the clip. Every face must read 25 or older; skipped. ${input.ageNote ?? ''}`.trim() : `The adult check could not run, so there is no clear adult; skipped. ${input.ageNote ?? ''}`.trim(), notes }
  if (!input.demo && input.people === 0) return { ok: false, reason: 'No person was found in the clip.', notes }
  if (input.characters === 2 && input.people < 2 && !input.demo) return { ok: false, reason: `Two characters were asked for, but the clip shows ${input.people} person.`, notes }
  if (input.characters === 1 && input.people > 1) notes.push(`${input.people} people in the clip; the largest is replaced.`)
  if (input.seconds != null && (input.seconds < input.minSec - 0.05 || input.seconds > input.maxSec + 0.05)) return { ok: false, reason: `The clip is ${input.seconds} s; the motion model takes ${input.minSec} to ${input.maxSec} s.`, notes }
  return { ok: true, reason: null, notes }
}

async function runMassCheck(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const [, batchId, rowId] = job.purpose.split(':') as [string, string, string]
  const postId = (job.request as { postId: string }).postId
  const { mass } = await batchOf(deps, ctx, batchId)
  const row = mass.rows.find(r => r.id === rowId)
  if (!row) return { gone: true }
  const post = await getContent(deps, ctx, postId)
  const src = (post.spec as { clone?: CloneSource | null }).clone
  if (!src || src.status === 'failed') {
    await patchRow(deps, ctx, batchId, rowId, { status: 'skipped', reason: src?.error ?? 'The clip could not be prepared.' })
    return { skipped: true }
  }
  const demo = (await providerMode(deps.db, ctx.accountId)) !== 'live'
  const frames = [src.rawFrameId ?? src.firstFrameId, ...(src.motionFrameIds ?? [])].filter((x): x is string => !!x)
  let people = src.people?.length ?? 0
  let adult: boolean | null = null
  let ageNote: string | null = null
  if (demo) {
    adult = true
    ageNote = 'Demo mode: the adult check does not run on the mock.'
  } else if ((await deps.faces.status()).available) {
    ages ??= createAgeChecker(deps.env.STUDIO_MODELS_DIR)
    if (!ages.available()) ageNote = 'The age model is not installed (npm run models).'
    else {
      const reads: string[] = []
      adult = true
      let seen = 0
      for (const id of frames) {
        const data = (await readAsset(deps, ctx, id)).data
        const faces = await deps.faces.detect(data)
        seen = Math.max(seen, faces.length)
        if (!faces.length) continue
        const meta = await (await import('sharp')).default(data).rotate().metadata()
        const scale = Math.min(1, 1280 / Math.max(meta.width ?? 1, meta.height ?? 1))
        for (const r of await ages.read(data, faces, scale)) {
          reads.push(r.group)
          if (!r.adult) adult = false
        }
      }
      people = Math.max(people, seen)
      if (!reads.length) { adult = null; ageNote = 'No face could be read for the adult check.' }
      else ageNote = `Faces read as ${[...new Set(reads)].join(', ')}.`
    }
  } else {
    ageNote = 'The face models are not running, so the adult check could not run.'
  }
  const model = row.model ?? await cloneModel(deps, ctx, 'motion')
  const entry = deps.config.models.models.find(m => m.ref === model)
  const v = massVerdict({ seconds: src.durationSec, people, characters: row.characters.length, adult, ageNote, minSec: entry?.clone?.min_sec ?? 1, maxSec: entry?.clone?.max_sec ?? 30, demo })
  await patchRow(deps, ctx, batchId, rowId, { status: v.ok ? 'ready' : 'skipped', reason: v.reason, check: { adult, people, seconds: src.durationSec, notes: v.notes } })
  return { ok: v.ok }
}

// ── The view: rows, prices, the total ───────────────────────────────

export interface MassRowView extends MassRow {
  characterNames: string[]
  frameId: string | null
  sourceAssetId: string | null
  modelLabel: string
  // Where the row is in the recipe.
  stage: 'fetch' | 'wait' | 'stills' | 'working' | 'call' | 'video' | 'review' | 'done' | 'out'
  still: { id: string; assetId: string | null; gateOk: boolean; reasons: string[]; face: number | null; likeness: number | null; margin: number | null } | null
  take: { id: string; assetId: string | null; status: string; decision: string | null } | null
  price: { stills: { display: string; micros: number; credits: number | null } | null; video: { display: string; micros: number; credits: number | null } | null }
}

function sumPrice(items: Array<{ estimate: { totalMicros: number; credits?: number } }>) {
  const credits = items.some(i => i.estimate.credits != null) ? items.reduce((s, i) => s + (i.estimate.credits ?? 0), 0) : null
  const micros = items.reduce((s, i) => s + i.estimate.totalMicros, 0)
  return { display: displayPrice(items.map(i => ({ amountMicros: i.estimate.totalMicros, credits: i.estimate.credits ?? null }))), micros, credits }
}

async function rowView(deps: Deps, ctx: Ctx, batchId: string, r: MassRow, names: Map<string, string>, fallbackModel: string): Promise<MassRowView> {
  const model = r.model ?? fallbackModel
  const base: MassRowView = {
    ...r, characterNames: r.characters.map(id => names.get(id) ?? '?'), frameId: null, sourceAssetId: null, modelLabel: deps.config.models.models.find(m => m.ref === model)?.label ?? model,
    stage: r.status === 'skipped' || r.stillCall === 'rejected' ? 'out' : r.status === 'ready' ? 'stills' : r.status === 'to_fetch' ? 'fetch' : 'wait', still: null, take: null, price: { stills: null, video: null },
  }
  if (!r.postId) return base
  const post = await getContent(deps, ctx, r.postId).catch(() => null)
  const src = post ? (post.spec as { clone?: CloneSource | null }).clone : null
  if (!post || !src) return base
  base.frameId = src.rawFrameId ?? src.firstFrameId
  base.sourceAssetId = src.assetId
  if (r.status !== 'ready') return base
  const cid = r.characters[0]!
  const stills = await cloneStills(deps, ctx, post.id)
  const keptId = src.stills[cid]
  const best = (keptId ? stills.find(x => x.id === keptId) : null) ?? bestCloneStill(stills.filter(x => x.gate.ok), cid, 'face') ?? bestCloneStill(stills, cid)
  if (best) base.still = { id: best.id, assetId: best.assetId, gateOk: best.gate.ok, reasons: best.gate.reasons, face: best.gate.face, likeness: best.gate.likeness, margin: best.gate.margin }
  const take = (await postClones(deps, ctx, post.id))[0] ?? null
  if (take) base.take = { id: take.id, assetId: take.assetId, status: take.status, decision: take.decision }
  const busy = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), inArray(jobs.status, ['waiting', 'queued', 'submitting', 'running', 'ingesting']), like(jobs.purpose, `clone%:${post.id}:%`))).limit(1)
  base.stage = r.stillCall === 'rejected' ? 'out'
    : take && take.status !== 'failed' ? (take.decision ? 'done' : 'review')
    : busy.length ? 'working'
    : !stills.some(x => x.assetId && !x.error) ? 'stills'
    : r.stillCall === 'kept' ? 'video' : 'call'
  // The row's price: its stills (and face pass), and its video from a
  // still (for this clip's length on its model). Free estimates.
  if (r.ticked && base.stage !== 'out' && base.stage !== 'done' && base.stage !== 'review') {
    try {
      if (!stills.length) base.price.stills = sumPrice(await quoteItemsFor(deps, ctx, (await stillsFor(deps, ctx, r)).specs))
      const seconds = Math.max(1, Math.ceil(src.durationSec ?? 10))
      const path = await motionPath(deps, ctx, model)
      if (path.billing) {
        const run = await runModel(deps, ctx, model, 'video_clone')
        const request: GenRequest = { kind: 'video_clone', model: run.model, modelRef: model, prompt: 'price', durationSec: seconds, resolution: deps.config.pipeline.content.clone.recreate.resolution, aspect: '9:16', audio: false, ...(model.startsWith('higgsfield/') ? { billing: path.billing } : {}) }
        base.price.video = sumPrice(await quoteItemsFor(deps, ctx, [{ type: 'gen', stage: 'video', purpose: 'mass_price', label: base.modelLabel, request }]))
      }
    } catch { /* no price: the row says what is missing when it runs */ }
  }
  return base
}

const stillsFor = (deps: Deps, ctx: Ctx, r: MassRow) => buildCloneStill(deps, ctx, {
  contentId: r.postId!, characterId: r.characters[0]!, pairWith: r.characters[1] ?? null,
  newSet: r.place === 'new' ? (r.notes.trim() || true) : null,
})

export async function massView(deps: Deps, ctx: Ctx, batchId: string) {
  const { mass } = await batchOf(deps, ctx, batchId)
  const names = new Map((await accountCharacters(deps, ctx)).map(c => [c.id, c.name]))
  const fallback = await cloneModel(deps, ctx, 'motion')
  const rows = await Promise.all(mass.rows.map(r => rowView(deps, ctx, batchId, r, names, fallback)))
  const ticked = rows.filter(r => r.ticked && r.status === 'ready' && r.stage !== 'out')
  const add = (list: Array<{ micros: number; credits: number | null } | null>) => {
    const got = list.filter((x): x is { micros: number; credits: number | null } => !!x)
    return { micros: got.reduce((s, x) => s + x.micros, 0), credits: got.every(x => x.credits != null) && got.length ? got.reduce((s, x) => s + (x.credits ?? 0), 0) : null, rows: got.length }
  }
  const fetchPrice = mass.rows.some(r => r.status === 'to_fetch' && r.source.kind === 'tiktok')
  return {
    sheet: mass.sheet, folder: mass.folder, syncedAt: mass.syncedAt, rows, defaultModel: fallback, max: MAX_ROWS,
    counts: { all: rows.length, ready: rows.filter(r => r.status === 'ready').length, skipped: rows.filter(r => r.status === 'skipped').length, fetching: rows.filter(r => r.status === 'to_fetch' || r.status === 'fetching' || r.status === 'checking').length },
    total: { stills: add(ticked.map(r => r.price.stills)), video: add(ticked.map(r => r.price.video)), ticked: ticked.length },
    toFetch: fetchPrice ? mass.rows.filter(r => r.status === 'to_fetch' && r.source.kind === 'tiktok').length : 0,
  }
}

// ── The owner's picks ───────────────────────────────────────────────

export async function setMassRows(deps: Deps, ctx: Ctx, batchId: string, input: {
  tick?: { id: string; on: boolean }; all?: boolean; swap?: string; model?: { id: string; ref: string | null }; place?: { id: string; place: 'keep' | 'new' }
  call?: { id: string; call: 'kept' | 'rejected' | null; stillId?: string }; remove?: string
}): Promise<{ ok: true }> {
  if (input.model?.ref != null && !modelFor(deps, input.model.ref)) throw new AppError('invalid_request', `"${input.model.ref}" is not one of the motion models.`)
  if (input.call?.call === 'kept') {
    const { mass } = await batchOf(deps, ctx, batchId)
    const row = mass.rows.find(r => r.id === input.call!.id)
    if (!row?.postId) throw new AppError('bad_request', 'That row has no clip yet.')
    const view = await rowView(deps, ctx, batchId, row, new Map(), row.model ?? '')
    const stillId = input.call.stillId ?? view.still?.id
    if (!stillId) throw new AppError('bad_request', 'That row has no still yet.')
    await useCloneStill(deps, ctx, row.postId, stillId)
  }
  await saveMass(deps, ctx, batchId, m => {
    let rows = m.rows
    if (input.all !== undefined) rows = rows.map(r => ({ ...r, ticked: input.all! }))
    if (input.tick) rows = rows.map(r => (r.id === input.tick!.id ? { ...r, ticked: input.tick!.on } : r))
    // Swap the two characters, left to right (before the stills only).
    if (input.swap) rows = rows.map(r => (r.id === input.swap && r.characters.length === 2 ? { ...r, characters: [r.characters[1]!, r.characters[0]!] } : r))
    if (input.model) rows = rows.map(r => (r.id === input.model!.id ? { ...r, model: input.model!.ref ? modelFor(deps, input.model!.ref) : null } : r))
    if (input.place) rows = rows.map(r => (r.id === input.place!.id ? { ...r, place: input.place!.place } : r))
    if (input.call) rows = rows.map(r => (r.id === input.call!.id ? { ...r, stillCall: input.call!.call } : r))
    if (input.remove) rows = rows.filter(r => r.id !== input.remove)
    return { ...m, rows }
  })
  return { ok: true }
}

// ── One click: the stills, then the videos of the kept rows ─────────

export async function buildMassRecreate(deps: Deps, ctx: Ctx, input: { contentId: string; step: 'stills' | 'video' }) {
  const view = await massView(deps, ctx, input.contentId)
  const { batch } = await batchOf(deps, ctx, input.contentId)
  const rows = view.rows.filter(r => r.ticked && r.status === 'ready' && r.stage === (input.step === 'stills' ? 'stills' : 'video'))
  const specs: JobSpec[] = []
  const prompts: Array<{ label: string; text: string; wrapped: string }> = []
  const warnings: RuleViolation[] = []
  let group = 0
  for (const r of rows) {
    const label = `${r.characterNames.join(' and ')}, ${r.source.name}`
    try {
      const built = input.step === 'stills'
        ? await stillsFor(deps, ctx, r)
        : await buildClone(deps, ctx, { contentId: r.postId!, characterIds: [r.characters[0]!], model: r.model ?? view.defaultModel, mode: 'motion', looks: {}, keepSound: false, stills: { [r.characters[0]!]: r.still!.id } })
      // Each row is its own queue group: one row at a time, and a row that
      // would pass today's cap waits for tomorrow (overnight).
      for (const sp of built.specs) specs.push({ ...sp, queue: { group } } as JobSpec)
      group++
      for (const p of built.preview.prompts) if (!prompts.some(x => x.text === p.text)) prompts.push({ ...p, label: `${label}: ${p.label}` })
      warnings.push(...built.preview.warnings.filter(w => !warnings.some(x => x.ruleId === w.ruleId && x.message === w.message)))
    } catch (e) {
      warnings.push({ ruleId: 'mass-recreate', spec: '13.1', title: `${label} skipped`, severity: 'warning', message: (e as Error).message })
    }
  }
  if (!specs.length) throw new AppError('bad_request', input.step === 'stills' ? 'No ticked row is waiting for its stills.' : 'No kept row is ready for its video. Keep a still on each row first.')
  return {
    purpose: `mass_recreate:${batch.id}`, characterId: batch.characterId, specs,
    preview: { title: `${input.step === 'stills' ? 'Stills' : 'Videos'} for ${group} row${group === 1 ? '' : 's'}, one row at a time (a row that would pass today's cap waits for tomorrow)`, prompts, warnings, invalidates: [] as string[] },
  }
}

// A take on a mass row back in the review queue (the batch).
export async function massReviewRows(deps: Deps, ctx: Ctx, batchId: string) {
  const v = await massView(deps, ctx, batchId)
  return v.rows.filter(r => r.take?.assetId)
}

let registered = false
export function registerMassRecreate(): void {
  if (registered) return
  registered = true
  registerLocalJob('mass_drive', runDriveFetch)
  registerLocalJob('mass_check', runMassCheck)
  registerJobHook('mass_fetch', onMassFetch)
}
