import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { assets } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { newId } from '../lib/ids.js'
import { AppError, notFound } from '../lib/errors.js'
import { probeMedia } from '../media/ffmpeg.js'

export type AssetRow = typeof assets.$inferSelect
export type AssetOrigin = 'generated' | 'upload' | 'derived' | 'fixture'

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
}

export function kindOf(mime: string): 'image' | 'video' | 'audio' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  throw new Error(`Unsupported media type: ${mime}`)
}

export function sniffMime(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (data.length >= 12 && data.subarray(4, 8).toString() === 'ftyp') return 'video/mp4'
  if (data.length >= 12 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WAVE') return 'audio/wav'
  if (data.length >= 3 && (data.subarray(0, 3).toString() === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0))) return 'audio/mpeg'
  return null
}

export interface SaveAssetInput {
  data: Buffer
  mime?: string
  origin: AssetOrigin
  label?: string
  sourceJobId?: string | null
  sourceUrl?: string | null
}

// Stores bytes under a tenant-prefixed key and records checksum, size,
// dimensions and duration so later stages never re-download or re-probe.
export async function saveAsset(deps: Deps, ctx: Ctx, input: SaveAssetInput): Promise<AssetRow> {
  const mime = sniffMime(input.data) ?? input.mime
  if (!mime) throw new Error('Could not determine the file type.')
  const kind = kindOf(mime)
  const id = newId('ast')
  const now = deps.clock.now()
  const ext = EXT[mime] ?? 'bin'
  const key = `acct/${ctx.accountId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${ext}`

  let width: number | null = null, height: number | null = null, durationMs: number | null = null
  if (kind === 'image') {
    // Decode the whole image now, so a corrupt upload is refused here with a
    // clear message instead of failing later inside a paid job.
    try {
      await sharp(input.data, { failOn: 'error' }).resize(16).toBuffer()
    } catch {
      throw new AppError('bad_request', 'That image file is damaged or not a supported format. Try exporting it again as PNG or JPEG.')
    }
    const meta = await sharp(input.data).metadata()
    width = meta.width ?? null
    height = meta.height ?? null
  } else {
    const probe = await probeMedia(input.data)
    width = probe.width ?? null
    height = probe.height ?? null
    durationMs = probe.durationSec != null ? Math.round(probe.durationSec * 1000) : null
  }

  await deps.store.put(key, input.data, mime)
  const [row] = await deps.db.insert(assets).values({
    id,
    accountId: ctx.accountId,
    kind,
    storageKey: key,
    mime,
    bytes: input.data.length,
    width, height, durationMs,
    checksumSha256: createHash('sha256').update(input.data).digest('hex'),
    origin: input.origin,
    sourceJobId: input.sourceJobId ?? null,
    sourceUrl: input.sourceUrl ?? null,
    label: input.label ?? '',
    createdBy: ctx.userId,
  }).returning()
  return row!
}

export async function getAsset(deps: Deps, ctx: Ctx, id: string): Promise<AssetRow> {
  const [row] = await deps.db.select().from(assets).where(and(eq(assets.accountId, ctx.accountId), eq(assets.id, id)))
  if (!row) throw notFound('Asset')
  return row
}

export async function readAsset(deps: Deps, ctx: Ctx, id: string): Promise<{ row: AssetRow; data: Buffer }> {
  const row = await getAsset(deps, ctx, id)
  return { row, data: await deps.store.get(row.storageKey) }
}
