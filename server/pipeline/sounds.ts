import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { sounds } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { transcodeSound } from '../media/sound.js'
import { withTempDir } from '../media/ffmpeg.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { uploadKey } from '../storage/uploads.js'

// The sound library (Phase 3 sound bed; UX-PLAN.md section 8): ambience
// recordings and music tracks the owner uploads, from the Finish step or
// Library > Sounds. The worker converts each to AAC and measures its
// loudness, so the mix can level it. Room tone is built in and needs no
// upload. There is no AI music.

export type SoundRow = typeof sounds.$inferSelect
export type SoundKind = 'ambience' | 'music'

export async function listSounds(deps: Deps, ctx: Ctx): Promise<SoundRow[]> {
  return deps.db.select().from(sounds).where(and(eq(sounds.accountId, ctx.accountId), isNull(sounds.archivedAt))).orderBy(desc(sounds.createdAt))
}

export async function getSound(deps: Deps, ctx: Ctx, soundId: string): Promise<SoundRow> {
  const [row] = await deps.db.select().from(sounds).where(and(eq(sounds.accountId, ctx.accountId), eq(sounds.id, soundId)))
  if (!row || row.archivedAt) throw notFound('Sound')
  return row
}

const cleanTag = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 60)

export async function addSound(deps: Deps, ctx: Ctx, input: { uploadId: string; name: string; kind: SoundKind; title?: string; tag?: string }): Promise<SoundRow> {
  if (!/^upl_[a-z0-9]{20}$/.test(input.uploadId)) throw new AppError('bad_request', 'That upload id is not valid.')
  if (!(await deps.store.exists(uploadKey(ctx.accountId, input.uploadId)))) throw new AppError('bad_request', `${input.name} did not finish uploading. Try again.`)
  const id = newId('snd')
  const [row] = await deps.db.insert(sounds).values({
    id, accountId: ctx.accountId, kind: input.kind, title: (input.title?.trim() || input.name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 120),
    tag: cleanTag(input.tag ?? ''), status: 'processing', createdBy: ctx.userId,
  }).returning()
  await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `sound_ingest:${id}`, label: `Prepare ${input.kind === 'music' ? 'music' : 'ambience'}: ${row!.title}`, characterId: null, request: { uploadId: input.uploadId } })
  return row!
}

export async function updateSound(deps: Deps, ctx: Ctx, soundId: string, patch: { title?: string; tag?: string; kind?: SoundKind }): Promise<SoundRow> {
  const row = await getSound(deps, ctx, soundId)
  const [out] = await deps.db.update(sounds).set({
    title: patch.title !== undefined ? patch.title.trim().slice(0, 120) : row.title,
    tag: patch.tag !== undefined ? cleanTag(patch.tag) : row.tag,
    kind: patch.kind ?? row.kind,
    updatedAt: deps.clock.now(),
  }).where(eq(sounds.id, row.id)).returning()
  return out!
}

export async function archiveSound(deps: Deps, ctx: Ctx, soundId: string): Promise<void> {
  const row = await getSound(deps, ctx, soundId)
  await deps.db.update(sounds).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(sounds.id, row.id))
}

async function runSoundIngest(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const soundId = job.purpose.split(':')[1]!
  const { uploadId } = job.request as { uploadId: string }
  const key = uploadKey(ctx.accountId, uploadId)
  const cfg = deps.config.pipeline.content.sound
  try {
    const row = await getSound(deps, ctx, soundId)
    const result = await withTempDir(async dir => {
      const input = join(dir, 'upload.bin'), out = join(dir, 'sound.m4a')
      await writeFile(input, await deps.store.get(key))
      const t = await transcodeSound(input, out, { maxSeconds: cfg.max_seconds })
      const asset = await saveAsset(deps, ctx, { data: await readFile(out), mime: 'audio/mp4', origin: 'upload', label: `${row.kind === 'music' ? 'Music' : 'Ambience'}: ${row.title}`, sourceJobId: job.id })
      return { assetId: asset.id, ...t }
    })
    await deps.db.update(sounds).set({ assetId: result.assetId, durationMs: Math.round(result.durationSec * 1000), loudness: result.loudness, status: 'ready', error: null, updatedAt: deps.clock.now() }).where(eq(sounds.id, soundId))
    await deps.store.delete(key).catch(() => undefined)
    return result
  } catch (e) {
    await deps.db.update(sounds).set({ status: 'failed', error: `This file could not be read as sound (${(e as Error).message.slice(0, 200)}).`, updatedAt: deps.clock.now() }).where(eq(sounds.id, soundId))
    throw e
  }
}

// A ready sound's file, written into a render's work folder.
export async function soundFile(deps: Deps, ctx: Ctx, soundId: string, dir: string, name: string): Promise<string> {
  const row = await getSound(deps, ctx, soundId)
  if (row.status !== 'ready' || !row.assetId) throw new AppError('bad_request', `The sound "${row.title}" is not ready yet.`)
  const path = join(dir, name)
  await writeFile(path, (await readAsset(deps, ctx, row.assetId)).data)
  return path
}

export function soundView(r: SoundRow) {
  return {
    id: r.id, kind: r.kind as SoundKind, title: r.title, tag: r.tag, status: r.status, error: r.error, assetId: r.assetId,
    durationSec: r.durationMs ? Math.round(r.durationMs / 100) / 10 : null, loudness: r.loudness == null ? null : Math.round(r.loudness * 10) / 10,
    createdAt: r.createdAt.toISOString(),
  }
}

let registered = false
export function registerSounds(): void {
  if (registered) return
  registered = true
  registerLocalJob('sound_ingest', runSoundIngest)
}
