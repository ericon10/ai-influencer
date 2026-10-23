import { and, eq, isNull, sql } from 'drizzle-orm'
import { contentItems, socialAccounts } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { parseCsv } from '../core/csvImport.js'
import { hashtagsOf } from '../core/planImport.js'
import { planMetaSchema } from '../core/planMeta.js'
import { lintCopy } from '../core/copyLint.js'
import { safeDownload } from '../jobs/download.js'
import { saveAsset } from '../storage/assets.js'
import { getCharacter, listCharacters } from './characters.js'
import { createContent, type ContentRow } from './content.js'
import { kindOf, useStillAsset } from './faceless.js'
import { runModel } from './sceneActions.js'
import { lintFor } from './copyLint.js'
import { trash } from './trash.js'
import { postPictures } from './planImport.js'

// A faceless account's plan CSV (owner, 2026-10-22; UX-PLAN.md section 35,
// item 4g). Columns: row_id, structure, moment, hook, scene, clip_action,
// video_prompt, caption, hashtags, sound_name (music), voiceover_clip,
// still_job_id, still_url (and an optional account). The rows go to the
// faceless character the account links to (Posts home > Accounts). A row
// with still_job_id pulls that Higgsfield still (free, from the owner's
// account) and lands as a draft with it attached; a still_url is fetched
// from Higgsfield's own hosts. Same rule as the launch plan: rows matching
// posts already made ask Replace or Add as new. Preview is free.

export const FACELESS_COLUMNS = ['row_id', 'account', 'structure', 'moment', 'hook', 'scene', 'clip_action', 'video_prompt', 'caption', 'hashtags', 'sound_name', 'voiceover_clip', 'still_job_id', 'still_url'] as const
type Col = (typeof FACELESS_COLUMNS)[number]
interface Row { line: number; cells: Record<Col, string> }

function readRows(text: string): { rows: Row[]; unknown: string[] } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], unknown: [] }
  const header = table[0]!.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const at = new Map<string, number>()
  header.forEach((h, i) => { if (!at.has(h)) at.set(h, i) })
  const unknown = header.filter(h => h && !(FACELESS_COLUMNS as readonly string[]).includes(h))
  const rows = table.slice(1).map((r, i) => ({ line: i + 2, cells: Object.fromEntries(FACELESS_COLUMNS.map(c => [c, (at.has(c) ? r[at.get(c)!] ?? '' : '').trim()])) as Record<Col, string> }))
    .filter(r => Object.values(r.cells).some(Boolean))
  return { rows, unknown }
}

export interface FacelessPreviewRow { line: number; rowId: string; hook: string; scene: string; still: 'job' | 'url' | null; state: 'new' | 'update' | 'kept' | 'problem'; errors: string[]; lint: string[] }
export interface FacelessPreview { rows: FacelessPreviewRow[]; problems: string[]; character: { id: string; name: string } | null; accountTag: string; matches: number; faceless: Array<{ id: string; name: string; tags: string[] }> }

// The faceless characters and the accounts each links to.
async function facelessAccounts(deps: Deps, ctx: Ctx) {
  const chars = (await listCharacters(deps, ctx)).filter(c => kindOf(c) === 'faceless')
  const links = await deps.db.select({ tag: socialAccounts.tag, characterId: socialAccounts.characterId }).from(socialAccounts).where(eq(socialAccounts.accountId, ctx.accountId))
  return chars.map(c => ({ id: c.id, name: c.name, tags: links.filter(l => l.characterId === c.id).map(l => l.tag) }))
}

async function made(deps: Deps, ctx: Ctx, tag: string): Promise<Map<string, ContentRow[]>> {
  const rows = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), isNull(contentItems.archivedAt), eq(contentItems.accountTag, tag), sql`coalesce(${contentItems.spec}->'plan'->>'rowId', '') <> ''`))
  const out = new Map<string, ContentRow[]>()
  for (const r of rows) { const k = String((r.spec as { plan?: { rowId?: string } }).plan?.rowId ?? ''); out.set(k, [...(out.get(k) ?? []), r]) }
  return out
}

async function target(deps: Deps, ctx: Ctx, rows: Row[], opts: { characterId?: string | null; accountTag?: string | null }) {
  const list = await facelessAccounts(deps, ctx)
  const fileTag = rows.find(r => r.cells.account)?.cells.account.replace(/^@+/, '') ?? ''
  const tag = (opts.accountTag ?? fileTag).replace(/^@+/, '').trim()
  const byTag = tag ? list.find(c => c.tags.some(t => t.toLowerCase() === tag.toLowerCase())) : undefined
  const ch = opts.characterId ? list.find(c => c.id === opts.characterId) : byTag ?? (list.length === 1 ? list[0] : undefined)
  return { list, ch: ch ?? null, tag: tag || ch?.tags[0] || '' }
}

export async function previewFacelessPlan(deps: Deps, ctx: Ctx, csv: string, opts: { characterId?: string | null; accountTag?: string | null } = {}): Promise<FacelessPreview> {
  if (csv.length > 400_000) throw new AppError('bad_request', 'That file is too big for one import (400 KB). Split it.')
  const { rows, unknown } = readRows(csv)
  const problems: string[] = []
  if (unknown.length) problems.push(`Columns not used: ${unknown.join(', ')}.`)
  const { list, ch, tag } = await target(deps, ctx, rows, opts)
  if (!list.length) problems.push('No faceless character yet: make one on Characters (New character > Faceless).')
  else if (!ch) problems.push('Pick the faceless account these rows are for.')
  if (ch && !tag) problems.push(`Name the account (its tag) these posts go on; link it to ${ch.name} on Posts home > Accounts.`)
  const existing = ch && tag ? await made(deps, ctx, tag) : new Map<string, ContentRow[]>()
  const lint = await lintFor(deps, ctx, ch?.id ?? null)
  const ids = new Map<string, number>()
  for (const r of rows) ids.set(r.cells.row_id, (ids.get(r.cells.row_id) ?? 0) + 1)
  const out: FacelessPreviewRow[] = rows.map(r => {
    const c = r.cells
    const errors: string[] = []
    if (!c.row_id) errors.push('No row_id')
    else if ((ids.get(c.row_id) ?? 0) > 1) errors.push(`row_id ${c.row_id} is used more than once`)
    if (!c.hook) errors.push('No hook (the on-screen line)')
    if (!c.scene && !c.still_job_id && !c.still_url) errors.push('No scene and no still: the still has nothing to show')
    if (c.still_url && !/^https:\/\//i.test(c.still_url)) errors.push('still_url is not an https link')
    const old = existing.get(c.row_id) ?? []
    const state: FacelessPreviewRow['state'] = errors.length ? 'problem' : old.length ? (old.some(p => (p.spec as { stillId?: string | null }).stillId) ? 'kept' : 'update') : 'new'
    const notes = lintCopy(c.hook, { kind: 'hook', lists: lint.lists, off: lint.off }).map(h => h.message)
    return { line: r.line, rowId: c.row_id, hook: c.hook, scene: c.scene, still: c.still_job_id ? 'job' : c.still_url ? 'url' : null, state, errors, lint: notes }
  })
  return { rows: out, problems, character: ch ? { id: ch.id, name: ch.name } : null, accountTag: tag, matches: out.filter(r => r.state === 'update' || r.state === 'kept').length, faceless: list }
}

// A still from the owner's Higgsfield account by its job id, or from a
// Higgsfield link (free: a lookup, not a run).
export async function pullStill(deps: Deps, ctx: Ctx, from: { jobId?: string; url?: string }): Promise<string> {
  const d = deps.config.runtime.downloads
  let url = from.url ?? ''
  if (from.jobId) {
    // The owner's account (where the job ran); demo mode reads the mock.
    const run = await runModel(deps, ctx, 'higgsfield/soul-2', 'image')
    const adapter = await deps.providers.gen(ctx.accountId, run.model, { billing: run.model.startsWith('mock/') ? 'api' : 'account' })
    const outputs = await adapter.result(from.jobId)
    const img = outputs.find(o => o.kind === 'image') ?? outputs[0]
    if (!img) throw new AppError('bad_request', `Higgsfield has no picture for job ${from.jobId}.`)
    if (adapter.download) return (await saveAsset(deps, ctx, { data: await adapter.download(img), mime: img.mime ?? 'image/png', origin: 'upload', label: `Still ${from.jobId}` })).id
    url = img.url
  }
  const { data, contentType } = await safeDownload(url, { allowedHosts: d.allowed_hosts.higgsfield ?? [], maxBytes: d.max_bytes, timeoutMs: d.timeout_sec * 1000 })
  return (await saveAsset(deps, ctx, { data, mime: contentType || 'image/png', origin: 'upload', label: 'Imported still' })).id
}

export interface FacelessImportResult { created: number; replaced: number; skipped: number; stills: number; stillProblems: string[]; posts: Array<{ rowId: string; id: string; still: boolean }> }

export async function importFacelessPlan(deps: Deps, ctx: Ctx, csv: string, opts: { characterId?: string | null; accountTag?: string | null; rows: string[]; existing?: 'replace' | 'add' }): Promise<FacelessImportResult> {
  const picked = new Set(opts.rows.map(r => r.trim()).filter(Boolean))
  if (!picked.size) throw new AppError('invalid_request', 'Tick the rows to import first.')
  const pv = await previewFacelessPlan(deps, ctx, csv, opts)
  if (!pv.character) throw new AppError('invalid_request', pv.problems[0] ?? 'Pick the faceless account these rows are for.')
  if (!pv.accountTag) throw new AppError('invalid_request', 'Name the account these posts go on.')
  const ch = await getCharacter(deps, ctx, pv.character.id)
  const matching = pv.rows.filter(r => picked.has(r.rowId) && (r.state === 'update' || r.state === 'kept'))
  if (matching.length && !opts.existing) throw new AppError('invalid_request', `${matching.length} row${matching.length === 1 ? ' matches posts' : 's match posts'} you already have. Pick Replace them (their pictures go to Trash) or Add as new posts.`)
  const existing = await made(deps, ctx, pv.accountTag)
  const { rows } = readRows(csv)
  const planId = `faceless-${new Date(deps.clock.now()).toISOString().slice(0, 10)}`
  const out: FacelessImportResult = { created: 0, replaced: 0, skipped: 0, stills: 0, stillProblems: [], posts: [] }
  for (const r of rows) {
    const c = r.cells
    if (!picked.has(c.row_id)) continue
    const p = pv.rows.find(x => x.line === r.line)!
    if (p.state === 'problem') { out.skipped++; continue }
    let replaced = false
    if (opts.existing === 'replace') for (const old of existing.get(c.row_id) ?? []) {
      await trash(deps, ctx, await postPictures(deps, ctx, old))
      await trash(deps, ctx, [{ kind: 'post', id: old.id }])
      replaced = true
    }
    const plan = planMetaSchema.parse({ rowId: c.row_id.slice(0, 20), planId, format: 'faceless clip', structure: c.structure.slice(0, 4) || null, moment: c.moment.slice(0, 800), scene: c.scene.slice(0, 4000), clipAction: c.clip_action.slice(0, 2000), caption: c.caption.slice(0, 2200), hashtags: hashtagsOf(c.hashtags).slice(0, 15) })
    const row = await createContent(deps, ctx, {
      kind: 'meme', characterId: ch.id, title: `${c.row_id}: ${c.hook}`.slice(0, 120), idea: c.moment, accountTag: pv.accountTag, step: 'stills',
      spec: {
        // The file names no product: the post asks for it on its start sheet (section 45).
        caption: c.hook.slice(0, 400), plan, picks: { character: true, product: false },
        faceless: { line: c.scene.slice(0, 800), videoPrompt: (c.video_prompt || c.clip_action).slice(0, 2000), postCaption: c.caption.slice(0, 2200), hashtags: hashtagsOf(c.hashtags).slice(0, 15), musicName: c.sound_name.slice(0, 120), voiceover: c.voiceover_clip ? { search: c.voiceover_clip.slice(0, 200), note: '' } : null, posted: false },
      },
    })
    let still = false
    if (c.still_job_id || c.still_url) {
      try {
        const assetId = await pullStill(deps, ctx, c.still_job_id ? { jobId: c.still_job_id } : { url: c.still_url })
        await useStillAsset(deps, ctx, row.id, assetId, `Still for ${c.row_id}`)
        out.stills++
        still = true
      } catch (e) { out.stillProblems.push(`${c.row_id}: ${(e as Error).message}`) }
    }
    if (replaced) out.replaced++
    else out.created++
    out.posts.push({ rowId: c.row_id, id: row.id, still })
  }
  return out
}
