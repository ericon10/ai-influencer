import { randomBytes } from 'node:crypto'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'

// Direct browser uploads. The browser asks for upload slots, PUTs each file
// straight to storage (a presigned R2 link, so the bytes never pass through
// the API and Vercel's 4.5 MB body cap does not apply), then names the
// upload ids in the request that uses them. Slots live under the account's
// own prefix, so an upload id can only ever be read back by its account.
// Without R2 (local development) the slot points at the API itself.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
// Videos (B-roll: screen recordings, phone video) may be larger; the worker
// converts them to a lean copy (config/content.yaml, broll.max_upload_mb).
const maxBytes = (deps: Deps, type: string) => (type.startsWith('video/') ? deps.config.pipeline.content.broll.max_upload_mb * 1024 * 1024 : MAX_UPLOAD_BYTES)
const MAX_FILES = 40
const SLOT_TTL_SEC = 15 * 60
const ID_RE = /^upl_[a-z0-9]{20}$/

const ALLOWED = /^(image\/(png|jpeg|webp)|video\/(mp4|quicktime|webm)|audio\/(mpeg|wav|x-wav|mp4))$/

export interface UploadRequest { name: string; type: string; size: number }
export interface UploadSlot { uploadId: string; name: string; url: string; method: 'PUT'; headers: Record<string, string> }
export interface UploadedFile { name: string; data: Buffer; mime: string }

export const uploadKey = (accountId: string, uploadId: string) => `uploads/${accountId}/${uploadId}`

export async function createUploadSlots(deps: Deps, ctx: Ctx, files: UploadRequest[]): Promise<{ slots: UploadSlot[]; direct: boolean }> {
  if (!files.length) throw new AppError('bad_request', 'Choose at least one file.')
  if (files.length > MAX_FILES) throw new AppError('bad_request', `Upload at most ${MAX_FILES} files at a time.`)
  const slots: UploadSlot[] = []
  let direct = false
  for (const f of files) {
    if (!ALLOWED.test(f.type)) throw new AppError('bad_request', /^image\/hei[cf]$/.test(f.type) ? `${f.name} is a HEIC photo. Upload it as JPEG or PNG (on an iPhone, Settings > Camera > Formats > Most Compatible, or share it as JPEG).` : `${f.name} is not a supported image, video or audio file.`)
    const max = maxBytes(deps, f.type)
    if (f.size > max) throw new AppError('bad_request', `${f.name} is larger than ${Math.round(max / 1024 / 1024)} MB.`)
    const uploadId = `upl_${randomBytes(15).toString('hex').slice(0, 20)}`
    const presigned = await deps.store.presignPut(uploadKey(ctx.accountId, uploadId), f.type, SLOT_TTL_SEC)
    if (presigned) direct = true
    slots.push({ uploadId, name: f.name, url: presigned ?? `/api/v1/uploads/${uploadId}`, method: 'PUT', headers: { 'Content-Type': f.type } })
  }
  return { slots, direct }
}

// The API-side slot for drivers without presigned links (local disk).
export async function receiveUpload(deps: Deps, ctx: Ctx, uploadId: string, data: Buffer, mime: string): Promise<void> {
  if (!ID_RE.test(uploadId)) throw new AppError('bad_request', 'That upload link is not valid.')
  if (deps.store.driver === 's3') throw new AppError('bad_request', 'Upload straight to storage with the link from /uploads.')
  if (data.length > maxBytes(deps, mime)) throw new AppError('bad_request', `That file is larger than ${Math.round(maxBytes(deps, mime) / 1024 / 1024)} MB.`)
  if (!ALLOWED.test(mime)) throw new AppError('bad_request', 'That is not a supported image, video or audio file.')
  await deps.store.put(uploadKey(ctx.accountId, uploadId), data, mime)
}

// Reads uploaded files for the request that names them, then frees the slots.
export async function takeUploads(deps: Deps, ctx: Ctx, refs: Array<{ uploadId: string; name: string; type?: string }>): Promise<UploadedFile[]> {
  const out: UploadedFile[] = []
  for (const r of refs) {
    if (!ID_RE.test(r.uploadId)) throw new AppError('bad_request', 'That upload id is not valid.')
    const key = uploadKey(ctx.accountId, r.uploadId)
    let data: Buffer
    try {
      data = await deps.store.get(key)
    } catch {
      throw new AppError('bad_request', `${r.name} did not finish uploading. Try again.`)
    }
    if (data.length > MAX_UPLOAD_BYTES) throw new AppError('bad_request', `${r.name} is larger than 25 MB.`)
    out.push({ name: r.name, data, mime: r.type ?? '' })
  }
  for (const r of refs) await deps.store.delete(uploadKey(ctx.accountId, r.uploadId)).catch(() => undefined)
  return out
}

// "REF 00.png", "ref_3.jpg", "Callie REF-11 final.webp" -> "REF-00" etc.
export function sheetRefOf(name: string): string | null {
  const m = name.toUpperCase().match(/REF[\s_-]*(\d{1,2})(?!\d)/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 11 ? `REF-${String(n).padStart(2, '0')}` : null
}
