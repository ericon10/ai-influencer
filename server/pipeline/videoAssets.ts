import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { and, eq, isNull } from 'drizzle-orm'
import type { Ctx, Deps } from '../context.js'
import { assets } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import { headBox, headMaskPng } from '../media/mask.js'
import { extractFrameAt } from '../media/frames.js'
import { withTempDir } from '../media/ffmpeg.js'
import { readAsset, saveAsset } from '../storage/assets.js'

// Media helpers for the video step: the head mask for the end frame helper,
// and frames sampled from a clip for its local QA.

const maskLabel = (assetId: string) => `head mask for ${assetId}`

// The head mask for a still, made once and reused (the same mask keeps the
// quote and the run identical). Needs a visible face.
export async function headMaskAsset(deps: Deps, ctx: Ctx, imageAssetId: string): Promise<string> {
  const [existing] = await deps.db.select({ id: assets.id }).from(assets)
    .where(and(eq(assets.accountId, ctx.accountId), eq(assets.label, maskLabel(imageAssetId)), isNull(assets.archivedAt)))
  if (existing) return existing.id
  const { data } = await readAsset(deps, ctx, imageAssetId)
  const status = await deps.faces.status()
  if (!status.available) throw new AppError('bad_request', `The end frame helper needs face detection, which is not set up here (${status.reason ?? 'face models missing'}).`)
  const faces = await deps.faces.detect(data)
  const face = [...faces].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0]
  if (!face) throw new AppError('bad_request', 'No face found in this still. The end frame helper changes only the head, so it needs a visible face.')
  const meta = await sharp(data).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const png = await headMaskPng(headBox(face.box, width, height), width, height)
  const row = await saveAsset(deps, ctx, { data: png, mime: 'image/png', origin: 'derived', label: maskLabel(imageAssetId) })
  return row.id
}

// Fails early when a still has no visible face (the end frame helper needs one).
export async function assertFace(deps: Deps, ctx: Ctx, imageAssetId: string): Promise<void> {
  const { data } = await readAsset(deps, ctx, imageAssetId)
  if (!(await deps.faces.detect(data)).length) throw new AppError('bad_request', 'No face found in this still. The end frame helper changes only the head, so it needs a visible face.')
}

// Frames at fractions of a clip's length (0.5 is the middle), as PNG.
export async function clipFrames(deps: Deps, ctx: Ctx, videoAssetId: string, fractions: number[]): Promise<Buffer[]> {
  const { row, data } = await readAsset(deps, ctx, videoAssetId)
  const duration = (row.durationMs ?? 5000) / 1000
  return withTempDir(async dir => {
    const input = join(dir, 'clip.mp4')
    await writeFile(input, data)
    const out: Buffer[] = []
    for (const [i, f] of fractions.entries()) {
      const png = join(dir, `frame${i}.png`)
      await extractFrameAt(input, Math.max(0, Math.min(duration - 0.05, duration * f)), png)
      out.push(await readFile(png))
    }
    return out
  })
}
