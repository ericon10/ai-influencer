import { randomBytes } from 'node:crypto'
import { zipSync } from 'fflate'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { readSecret, revokeCredential, storeSecret } from '../providers/credentials.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { readAsset } from '../storage/assets.js'
import { captionWithLabel, driveName, manifestCsv, MANIFEST_COLUMNS } from '../core/weeks.js'
import { getSetting, setSetting } from './settings.js'
import { exportPostNow, getContent, type ContentOutputs, type ContentRow } from './content.js'
import { getCharacter } from './characters.js'

// Google Drive (owner, 2026-10-22; UX-PLAN.md section 37, items 15 and 16):
// the owner's own Google sign-in (an OAuth client from his Google Cloud
// project, sealed in the vault as google_oauth; the drive.file scope, so
// the Studio sees only the folders and files it made), a root folder, and
// Send to Drive: approved posts to ROOT / CHARACTER / week of YYYY-MM-DD /,
// named date_slot_account_rowid, with a manifest Google Sheet and CSV in
// the same folder. Sending again updates the same files and rows. Free:
// the upload runs on the worker.

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
// Reading a sheet the Studio did not make (section 39: a week's plan in a
// Google Sheet) needs read-only Drive on top of drive.file.
const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const FOLDER = 'application/vnd.google-apps.folder'
const SHEET = 'application/vnd.google-apps.spreadsheet'
const DRIVE_KEY = 'google_drive'
const OAUTH_KEY = 'google_drive_oauth'
export const MANIFESTS_KEY = 'drive_manifests'
const SEND = 'drive_send'

export interface DriveSettings { rootId: string | null; rootName: string; connectedAt: string | null; email: string; scopes?: string }
const PLANS_KEY = 'drive_plans'
interface PlansFolders { rootId: string; plansId: string; chars: Record<string, string> }
export interface Manifest { folderId: string; folderName: string; character: string; week: string; sheetId: string | null; csvId: string | null; rows: Record<string, Record<(typeof MANIFEST_COLUMNS)[number], string>> }

const api = (deps: Deps) => deps.env.GOOGLE_API_BASE.replace(/\/$/, '')
const oauth = (deps: Deps) => deps.env.GOOGLE_OAUTH_BASE.replace(/\/$/, '')

async function client(deps: Deps, ctx: Ctx): Promise<{ id: string; secret: string } | null> {
  const raw = await readSecret(deps.db, deps.vault, ctx.accountId, 'google_oauth')
  if (!raw) return null
  const at = raw.indexOf(':')
  return at > 0 ? { id: raw.slice(0, at), secret: raw.slice(at + 1) } : null
}

export const redirectUri = (deps: Deps, origin: string) => `${(deps.env.STUDIO_PUBLIC_URL || origin).replace(/\/$/, '')}/api/v1/drive/callback`

export async function driveStatus(deps: Deps, ctx: Ctx, origin: string) {
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  const token = await readSecret(deps.db, deps.vault, ctx.accountId, DRIVE_KEY)
  return { client: !!(await client(deps, ctx)), connected: !!token, connectedAt: s.connectedAt, email: s.email, root: s.rootId ? { id: s.rootId, name: s.rootName } : null, redirectUri: redirectUri(deps, origin), sheets: !!token && canReadSheets(s) }
}

const canReadSheets = (s: DriveSettings) => (s.scopes ?? '').split(/\s+/).includes(READ_SCOPE)

// The sign-in link: Google's consent screen for drive.file and read-only.
export async function driveAuthUrl(deps: Deps, ctx: Ctx, origin: string): Promise<string> {
  const c = await client(deps, ctx)
  if (!c) throw new AppError('provider_not_configured', 'Add your Google OAuth client first (Settings > Provider keys, Google Drive): CLIENT_ID:CLIENT_SECRET from Google Cloud, APIs and Services, Credentials.')
  // Google's account chooser always shows (prompt select_account): the
  // Drive can live on another Google account than the browser's (a Gmail
  // with Drive, next to a work address without it). Nothing here is tied to
  // a Claude.ai sign-in.
  const state = randomBytes(18).toString('base64url')
  await setSetting(deps, ctx, OAUTH_KEY, { state, at: deps.clock.now().toISOString() })
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri(deps, origin), response_type: 'code', scope: `${SCOPE} ${READ_SCOPE} openid email`, access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'true', state })
  return `${deps.env.GOOGLE_ACCOUNTS_BASE.replace(/\/$/, '')}/o/oauth2/v2/auth?${q}`
}

// Google sends the owner back here with a code: it becomes a refresh token,
// sealed in the vault (never shown, never in the browser).
export async function driveCallback(deps: Deps, ctx: Ctx, input: { code: string; state: string; origin: string }): Promise<void> {
  const saved = await getSetting<{ state: string; at: string } | null>(deps.db, ctx.accountId, OAUTH_KEY, null)
  if (!saved || saved.state !== input.state || deps.clock.now().getTime() - Date.parse(saved.at) > 15 * 60_000) throw new AppError('bad_request', 'That Google sign-in is too old or did not start here. Press Connect Google Drive again.')
  const c = await client(deps, ctx)
  if (!c) throw new AppError('provider_not_configured', 'Add your Google OAuth client first.')
  const res = await fetch(`${oauth(deps)}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: input.code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri(deps, input.origin), grant_type: 'authorization_code' }) })
  const body = await res.json().catch(() => ({})) as { refresh_token?: string; access_token?: string; id_token?: string; scope?: string; error_description?: string; error?: string }
  if (!res.ok || !body.refresh_token) throw new AppError('bad_request', `Google did not connect: ${body.error_description ?? body.error ?? (body.access_token ? 'no refresh token came back (remove the Studio at myaccount.google.com/permissions, then connect again)' : res.status)}.`)
  await storeSecret(deps, ctx, DRIVE_KEY, body.refresh_token, 'Google Drive', body.refresh_token.slice(-4))
  let email = ''
  try { email = String(JSON.parse(Buffer.from((body.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')).email ?? '') } catch { /* no id token */ }
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  await setSetting(deps, ctx, DRIVE_KEY, { ...s, connectedAt: deps.clock.now().toISOString(), email, scopes: body.scope ?? '' })
  await setSetting(deps, ctx, OAUTH_KEY, { state: '', at: '' })
}

export async function driveDisconnect(deps: Deps, ctx: Ctx): Promise<void> {
  await revokeCredential(deps, ctx, DRIVE_KEY).catch(() => undefined)
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  await setSetting(deps, ctx, DRIVE_KEY, { ...s, connectedAt: null })
}

const tokens = new Map<string, { token: string; until: number }>()
async function accessToken(deps: Deps, ctx: Ctx): Promise<string> {
  const hit = tokens.get(ctx.accountId)
  if (hit && hit.until > Date.now() + 60_000) return hit.token
  const refresh = await readSecret(deps.db, deps.vault, ctx.accountId, DRIVE_KEY)
  const c = await client(deps, ctx)
  if (!refresh || !c) throw new AppError('provider_not_configured', 'Connect Google Drive first (Settings > General > Google Drive).')
  const res = await fetch(`${oauth(deps)}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refresh, client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token' }) })
  const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !body.access_token) throw new AppError('provider_error', `Google Drive refused the sign-in (${body.error_description ?? body.error ?? res.status}). Connect Google Drive again in Settings.`)
  tokens.set(ctx.accountId, { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 })
  return body.access_token
}

async function call<T>(deps: Deps, ctx: Ctx, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(deps, ctx)
  const res = await fetch(`${api(deps)}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 300)
    try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg } catch { /* not json */ }
    throw new AppError('provider_error', `Google Drive: ${msg || res.status}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// The folders the Studio can see (drive.file: the ones it made).
export async function driveFolders(deps: Deps, ctx: Ctx): Promise<Array<{ id: string; name: string }>> {
  const r = await call<{ files?: Array<{ id: string; name: string }> }>(deps, ctx, `/drive/v3/files?${new URLSearchParams({ q: `mimeType='${FOLDER}' and trashed=false and 'root' in parents`, fields: 'files(id,name)', pageSize: '100', orderBy: 'name' })}`)
  return r.files ?? []
}

export async function setDriveRoot(deps: Deps, ctx: Ctx, input: { folderId?: string | null; create?: string | null }): Promise<DriveSettings> {
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  let root: { id: string; name: string }
  if (input.create?.trim()) root = await createFolder(deps, ctx, null, input.create.trim().slice(0, 120))
  else if (input.folderId) {
    const f = await call<{ id: string; name: string; mimeType: string }>(deps, ctx, `/drive/v3/files/${encodeURIComponent(input.folderId)}?fields=id,name,mimeType`)
    if (f.mimeType !== FOLDER) throw new AppError('bad_request', 'That is not a folder.')
    root = { id: f.id, name: f.name }
  } else throw new AppError('invalid_request', 'Pick a folder or name a new one.')
  const next = { ...s, rootId: root.id, rootName: root.name }
  await setSetting(deps, ctx, DRIVE_KEY, next)
  return next
}

async function createFolder(deps: Deps, ctx: Ctx, parentId: string | null, name: string): Promise<{ id: string; name: string }> {
  return call<{ id: string; name: string }>(deps, ctx, '/drive/v3/files?fields=id,name', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parentId ? { parents: [parentId] } : {}) }) })
}

async function folderIn(deps: Deps, ctx: Ctx, parentId: string, name: string): Promise<string> {
  const r = await call<{ files?: Array<{ id: string }> }>(deps, ctx, `/drive/v3/files?${new URLSearchParams({ q: `mimeType='${FOLDER}' and trashed=false and name='${q(name)}' and '${q(parentId)}' in parents`, fields: 'files(id)', pageSize: '1' })}`)
  return r.files?.[0]?.id ?? (await createFolder(deps, ctx, parentId, name)).id
}

// A file made, or the same file's contents replaced (never a second copy).
// as: a Google type the upload is converted to (the manifest's Sheet).
async function putFile(deps: Deps, ctx: Ctx, f: { id?: string | null; parentId: string; name: string; mime: string; data: Uint8Array; as?: string }): Promise<string> {
  if (f.id) {
    try {
      await call(deps, ctx, `/upload/drive/v3/files/${encodeURIComponent(f.id)}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'content-type': f.mime }, body: Buffer.from(f.data) })
      await call(deps, ctx, `/drive/v3/files/${encodeURIComponent(f.id)}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.name }) })
      return f.id
    } catch (e) {
      // Deleted on Drive since: made again below.
      if (!/not found|404/i.test((e as Error).message)) throw e
    }
  }
  const boundary = `studio${randomBytes(8).toString('hex')}`
  const meta = JSON.stringify({ name: f.name, parents: [f.parentId], ...(f.as ? { mimeType: f.as } : {}) })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${f.mime}\r\n\r\n`),
    Buffer.from(f.data), Buffer.from(`\r\n--${boundary}--`),
  ])
  return (await call<{ id: string }>(deps, ctx, '/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body })).id
}

// ── Send to Drive ─────────────────────────────────────────────────────

export async function startDriveSend(deps: Deps, ctx: Ctx, input: { week: string; postIds: string[] }): Promise<{ jobId: string; posts: number }> {
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  if (!(await readSecret(deps.db, deps.vault, ctx.accountId, DRIVE_KEY))) throw new AppError('provider_not_configured', 'Connect Google Drive first (Settings > General > Google Drive).')
  if (!s.rootId) throw new AppError('invalid_request', 'Pick the root folder first (Settings > General > Google Drive).')
  if (!input.postIds.length) throw new AppError('invalid_request', 'Approve posts first: only approved posts go to Drive.')
  const job = await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `${SEND}:${input.week}`, label: `Send ${input.postIds.length} post${input.postIds.length === 1 ? '' : 's'} to Google Drive`, characterId: null, request: { week: input.week, postIds: input.postIds.slice(0, 300) } })
  return { jobId: job.id, posts: input.postIds.length }
}

type WeekState = { drive?: { fileId?: string; folderId?: string; name?: string; sentAt?: string } | null }
type Spec = { caption?: string; hashtags?: string[]; ad?: boolean; plan?: { rowId?: string; date?: string; slot?: string; deviceId?: string; soundName?: string; product?: boolean; caption?: string; hashtags?: string[]; postType?: string }; faceless?: { postCaption?: string; hashtags?: string[]; musicName?: string } | null; week?: WeekState | null }

// What a post sends: its file (a video, a photo, a slideshow's zip), its
// caption as posted with the AI label line, and its manifest row.
async function postFile(deps: Deps, ctx: Ctx, job: JobRow, row: ContentRow): Promise<{ ext: string; mime: string; data: Uint8Array }> {
  let o = (row.outputs ?? {}) as ContentOutputs
  const ready = row.kind === 'slideshow' ? !!o.imageAssetIds?.length : !!o.videoAssetId
  if (!ready) o = await exportPostNow(deps, ctx, job, row)
  if (row.kind === 'slideshow') {
    const ids = o.imageAssetIds ?? []
    if (!ids.length) throw new Error('no slides exported')
    if (ids.length === 1 || (row.spec as Spec).plan?.postType === 'photo') return { ext: 'jpg', mime: 'image/jpeg', data: (await readAsset(deps, ctx, ids[0]!)).data }
    const files: Record<string, Uint8Array> = {}
    for (const [i, a] of ids.entries()) files[`${String(i + 1).padStart(2, '0')}.jpg`] = (await readAsset(deps, ctx, a)).data
    return { ext: 'zip', mime: 'application/zip', data: zipSync(files, { level: 0 }) }
  }
  if (!o.videoAssetId) throw new Error('no video exported')
  return { ext: 'mp4', mime: 'video/mp4', data: (await readAsset(deps, ctx, o.videoAssetId)).data }
}

function captionOf(row: ContentRow): { caption: string; hashtags: string[] } {
  const s = (row.spec ?? {}) as Spec
  if (row.kind === 'slideshow') return { caption: s.caption ?? '', hashtags: s.hashtags ?? [] }
  if (s.faceless) return { caption: s.faceless.postCaption || s.plan?.caption || '', hashtags: s.faceless.hashtags?.length ? s.faceless.hashtags : s.plan?.hashtags ?? [] }
  return { caption: s.plan?.caption ?? '', hashtags: s.plan?.hashtags ?? [] }
}

async function runSend(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const req = job.request as { week: string; postIds: string[] }
  const settings = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  if (!settings.rootId) throw new Error('No root folder: pick one in Settings > General > Google Drive.')
  const { accountsByTag, aiLabel } = await sendContext(deps, ctx)
  const manifests = await getSetting<Record<string, Manifest>>(deps.db, ctx.accountId, MANIFESTS_KEY, {})
  const charFolders = new Map<string, string>(), weekFolders = new Map<string, string>()
  const touched = new Set<string>()
  const sent: Array<{ postId: string; name: string }> = [], failed: Array<{ postId: string; reason: string }> = []
  const weekName = deps.config.pipeline.content.weeks.drive.week_folder.replace('{date}', req.week)
  for (const id of req.postIds) {
    try {
      const row = await getContent(deps, ctx, id)
      const s = (row.spec ?? {}) as Spec
      const ch = row.characterId ? await getCharacter(deps, ctx, row.characterId) : null
      const chName = ch?.name ?? 'No character'
      if (!charFolders.has(chName)) charFolders.set(chName, await folderIn(deps, ctx, settings.rootId, chName))
      const folderKey = `${chName}|${req.week}`
      if (!weekFolders.has(folderKey)) weekFolders.set(folderKey, await folderIn(deps, ctx, charFolders.get(chName)!, weekName))
      const folderId = weekFolders.get(folderKey)!
      const file = await postFile(deps, ctx, job, row)
      const date = s.plan?.date ?? '', slot = s.plan?.slot ?? '', rowId = s.plan?.rowId || row.id
      const name = driveName({ date, slot, account: row.accountTag, rowId, ext: file.ext })
      const prev = s.week?.drive
      const fileId = await putFile(deps, ctx, { id: prev?.folderId === folderId ? prev.fileId : null, parentId: folderId, name, mime: file.mime, data: file.data })
      await setWeekField(deps, ctx, row.id, { drive: { fileId, folderId, name, sentAt: deps.clock.now().toISOString() } })
      const { caption, hashtags } = captionOf(row)
      const label = ch ? labelFor(ch.disclosure, aiLabel) : aiLabel
      const m = manifests[folderKey] ?? { folderId, folderName: weekName, character: chName, week: req.week, sheetId: null, csvId: null, rows: {} }
      m.folderId = folderId
      m.rows[row.id] = {
        'Device ID': s.plan?.deviceId || accountsByTag.get(row.accountTag.toLowerCase())?.deviceId || '', Account: row.accountTag, file_name: name,
        caption: captionWithLabel(caption, label), hashtags: hashtags.map(h => `#${h.replace(/^#+/, '')}`).join(' '), date, slot,
        sound_name: s.plan?.soundName || s.faceless?.musicName || '', ad_label: (row.kind === 'slideshow' ? s.ad : s.plan?.product) ? 'Ad' : '', platform: 'tiktok',
      }
      // A slideshow's three platforms set (section 42 C), when made: the
      // Instagram carousel (a zip), the reel and the Shorts copy, each with
      // its own manifest row.
      const plat = (row.outputs as ContentOutputs | null)?.platforms
      if (row.kind === 'slideshow' && plat) {
        const extras: Array<{ platform: string; suffix: string; ext: string; mime: string; data: () => Promise<Uint8Array> }> = [
          { platform: 'instagram', suffix: 'ig', ext: 'zip', mime: 'application/zip', data: async () => { const f: Record<string, Uint8Array> = {}; for (const [i, a] of plat.carouselIds.entries()) f[`${String(i + 1).padStart(2, '0')}.jpg`] = (await readAsset(deps, ctx, a)).data; return zipSync(f, { level: 0 }) } },
          { platform: 'reels', suffix: 'reel', ext: 'mp4', mime: 'video/mp4', data: async () => (await readAsset(deps, ctx, plat.reelId)).data },
          { platform: 'shorts', suffix: 'shorts', ext: 'mp4', mime: 'video/mp4', data: async () => (await readAsset(deps, ctx, plat.shortsId)).data },
        ]
        const prevExtras = (prev as { extras?: Record<string, string> } | undefined)?.extras ?? {}
        const extraIds: Record<string, string> = {}
        for (const x of extras) {
          const xname = name.replace(/\.[a-z0-9]+$/, `_${x.suffix}.${x.ext}`)
          extraIds[x.platform] = await putFile(deps, ctx, { id: prev?.folderId === folderId ? prevExtras[x.platform] ?? null : null, parentId: folderId, name: xname, mime: x.mime, data: await x.data() })
          m.rows[`${row.id}:${x.platform}`] = { ...m.rows[row.id]!, file_name: xname, platform: x.platform }
        }
        await setWeekField(deps, ctx, row.id, { drive: { fileId, folderId, name, sentAt: deps.clock.now().toISOString(), extras: extraIds } as never })
      }
      manifests[folderKey] = m
      touched.add(folderKey)
      sent.push({ postId: row.id, name })
    } catch (e) { failed.push({ postId: id, reason: (e as Error).message.slice(0, 300) }) }
  }
  // The manifest of each folder touched: a CSV and a Google Sheet, one row
  // a post (the folder's every post sent so far, in posting order).
  for (const key of touched) {
    const m = manifests[key]!
    const rows = Object.values(m.rows).sort((a, b) => a.date.localeCompare(b.date) || Number(a.slot) - Number(b.slot) || a.Account.localeCompare(b.Account))
    const csv = Buffer.from(manifestCsv(rows))
    const base = deps.config.pipeline.content.weeks.drive.manifest.replace('{date}', m.week)
    m.csvId = await putFile(deps, ctx, { id: m.csvId, parentId: m.folderId, name: `${base}.csv`, mime: 'text/csv', data: csv })
    m.sheetId = await putFile(deps, ctx, { id: m.sheetId, parentId: m.folderId, name: base, mime: 'text/csv', data: csv, as: SHEET })
  }
  await setSetting(deps, ctx, MANIFESTS_KEY, manifests)
  if (!sent.length && failed.length) throw new Error(`Nothing was sent: ${failed.slice(0, 3).map(f => f.reason).join('; ')}`)
  return { sent, failed, folders: [...touched].map(k => ({ key: k, folderId: manifests[k]!.folderId, sheetId: manifests[k]!.sheetId })) }
}

// The caption's AI label line: the character file's disclosure when it is a
// line to post, else the default (config/content.yaml weeks.ai_label).
export const labelFor = (disclosure: string, fallback: string) => (!disclosure.trim() || /^label\b/i.test(disclosure.trim()) ? fallback : disclosure.trim())

async function sendContext(deps: Deps, ctx: Ctx) {
  const { scoreboard } = await import('./scaleKit.js')
  const board = await scoreboard(deps, ctx)
  return { accountsByTag: new Map(board.accounts.map(a => [a.tag.toLowerCase(), a])), aiLabel: deps.config.pipeline.content.weeks.ai_label }
}

// A post's week state, saved on its own (never bumps the post's time).
export async function setWeekField(deps: Deps, ctx: Ctx, postId: string, patch: Record<string, unknown>): Promise<void> {
  const { patchWeek } = await import('./weeks.js')
  await patchWeek(deps, ctx, postId, patch)
}

// Renaming an account renames it in the manifests too (the next send
// writes the files).
export async function renameInManifests(deps: Deps, ctx: Ctx, from: string, to: string): Promise<void> {
  const all = await getSetting<Record<string, Manifest>>(deps.db, ctx.accountId, MANIFESTS_KEY, {})
  let changed = false
  for (const m of Object.values(all)) for (const r of Object.values(m.rows)) if (r.Account === from) { r.Account = to; r.file_name = r.file_name.replace(`_${from}_`, `_${to}_`); changed = true }
  if (changed) await setSetting(deps, ctx, MANIFESTS_KEY, all)
}

let registered = false
export function registerDrive(): void {
  if (registered) return
  registered = true
  registerLocalJob(SEND, runSend)
}

// ── Week plans in Google Sheets (section 39) ─────────────────────────

export interface DriveSheet { id: string; name: string; modifiedTime: string; character: string | null }

// ROOT / Plans / CHARACTER /, made on first use (when the picker opens with
// a root folder set), one folder per character; kept in a setting.
export async function plansFolders(deps: Deps, ctx: Ctx, names: string[]): Promise<PlansFolders | null> {
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  if (!s.rootId) return null
  const had = await getSetting<PlansFolders | null>(deps.db, ctx.accountId, PLANS_KEY, null)
  const cur: PlansFolders = had && had.rootId === s.rootId ? { ...had, chars: { ...had.chars } } : { rootId: s.rootId, plansId: '', chars: {} }
  let changed = !had || had.rootId !== s.rootId
  if (!cur.plansId) { cur.plansId = await folderIn(deps, ctx, s.rootId, 'Plans'); changed = true }
  for (const n of names) if (n && !cur.chars[n]) { cur.chars[n] = await folderIn(deps, ctx, cur.plansId, n); changed = true }
  if (changed) await setSetting(deps, ctx, PLANS_KEY, cur)
  return cur
}

const notReadable = 'The Studio may not read that sheet yet: Google gave it access only to the files it made. Reconnect Google Drive in Settings > General (one consent screen) to let it read your sheets.'

// The sheets the owner can pick: the Plans folders' first, then the newest.
export async function listSheets(deps: Deps, ctx: Ctx, input: { search?: string; characters: string[] }): Promise<{ sheets: DriveSheet[]; plans: { root: string; folders: string[] } | null; readable: boolean }> {
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  const folders = await plansFolders(deps, ctx, input.characters)
  const byFolder = new Map(Object.entries(folders?.chars ?? {}).map(([name, id]) => [id, name]))
  const words = (input.search ?? '').trim().slice(0, 80)
  const query = [`mimeType='${SHEET}'`, 'trashed=false', ...(words ? [`name contains '${q(words)}'`] : [])].join(' and ')
  const r = await call<{ files?: Array<{ id: string; name: string; modifiedTime?: string; parents?: string[] }> }>(deps, ctx, `/drive/v3/files?${new URLSearchParams({ q: query, fields: 'files(id,name,modifiedTime,parents)', pageSize: '50', orderBy: 'modifiedTime desc' })}`)
  const sheets = (r.files ?? []).map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime ?? '', character: (f.parents ?? []).map(p => byFolder.get(p)).find(Boolean) ?? null }))
  sheets.sort((a, b) => Number(!!b.character) - Number(!!a.character))
  return { sheets, plans: folders ? { root: s.rootName, folders: Object.keys(folders.chars) } : null, readable: canReadSheets(s) }
}

// A sheet's first tab as CSV (a CSV file in Drive reads as it is).
export async function readSheet(deps: Deps, ctx: Ctx, id: string): Promise<{ id: string; name: string; modifiedTime: string; csv: string }> {
  const s = await getSetting<DriveSettings>(deps.db, ctx.accountId, DRIVE_KEY, { rootId: null, rootName: '', connectedAt: null, email: '' })
  let meta: { id: string; name: string; mimeType: string; modifiedTime?: string }
  try { meta = await call(deps, ctx, `/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime`) }
  catch (e) { throw canReadSheets(s) ? new AppError('provider_error', `${(e as Error).message}. Check the link, and that the sheet is in the Google account connected in Settings.`) : new AppError('provider_error', notReadable) }
  const token = await accessToken(deps, ctx)
  const path = meta.mimeType === SHEET ? `/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=text%2Fcsv` : /csv|text\/plain/.test(meta.mimeType) ? `/drive/v3/files/${encodeURIComponent(id)}?alt=media` : null
  if (!path) throw new AppError('bad_request', `${meta.name} is not a Google Sheet or a CSV file.`)
  const res = await fetch(`${api(deps)}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new AppError('provider_error', res.status === 403 || res.status === 404 ? notReadable : `Google Drive: the sheet did not read (${res.status}).`)
  const csv = await res.text()
  if (csv.length > 2_000_000) throw new AppError('bad_request', `${meta.name} is too big for one import (2 MB). Split it.`)
  return { id: meta.id, name: meta.name, modifiedTime: meta.modifiedTime ?? '', csv }
}
