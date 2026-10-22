import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { zipSync } from 'fflate'
import { contentItems, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { presetFor } from '../core/exportPresets.js'
import { slideList } from '../core/slides.js'
import { slideshowSpecSchema } from '../core/slideshowSpec.js'
import { ffmpeg, probeFile, withTempDir } from '../media/ffmpeg.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { getContent, type ContentOutputs } from './content.js'
import { renderInstagramSet } from './slideshow.js'

// One post, three platforms (owner, 2026-10-22; UX-PLAN.md section 36, item
// 28): from a finished slideshow, one free click on the worker makes the
// Instagram carousel (1080 x 1440, the same slides in 3:4), a reel (the
// 1080 x 1920 slides, 2 to 3 s each by how much they say, a slow zoom, cut
// from one to the next, silent: the sound is added in the app) and a Shorts
// copy of the reel within Shorts' length and bitrate. Everything in one zip
// with a caption for each.

export interface PlatformSet { carouselIds: string[]; reelId: string; shortsId: string; zipId: string; slideSec: number[]; reelSec: number; madeAt: string }

// How long a slide stays up: 2 s, plus a little for its words, never past 3.
export function slideSeconds(text: string): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return Math.round(Math.min(3, Math.max(2, 2 + words * 0.08)) * 10) / 10
}

// The ffmpeg graph for the reel: each slide a slow push-in (1.00 to 1.06),
// 30 fps, then the slides one after another, cut (never crossfaded).
export function reelFilter(seconds: number[], fps = 30): string {
  const parts = seconds.map((s, i) => {
    const frames = Math.round(s * fps)
    return `[${i}:v]scale=2160:3840,zoompan=z='min(1+0.06*on/${frames},1.06)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${fps},setsar=1,format=yuv420p[v${i}]`
  })
  return `${parts.join(';')};${seconds.map((_, i) => `[v${i}]`).join('')}concat=n=${seconds.length}:v=1:a=0[out]`
}

export async function startPlatforms(deps: Deps, ctx: Ctx, postId: string): Promise<{ ok: true }> {
  const post = await getContent(deps, ctx, postId)
  if (post.kind !== 'slideshow') throw new AppError('bad_request', 'Three platforms is for a finished slideshow.')
  if (!(post.outputs as ContentOutputs).imageAssetIds?.length) throw new AppError('bad_request', 'Export the slideshow first; the three platforms are made from its slides.')
  const busy = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.purpose, `platforms:${post.id}`), inArray(jobs.status, ['queued', 'running']))).limit(1)
  if (!busy.length) await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `platforms:${post.id}`, label: 'Instagram carousel, reel and Shorts', characterId: post.characterId, request: {} })
  return { ok: true }
}

async function runPlatforms(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const postId = job.purpose.split(':')[1]!
  const row = await getContent(deps, ctx, postId)
  const out = row.outputs as ContentOutputs
  const ids = out.imageAssetIds ?? []
  if (!ids.length) throw new Error('Export the slideshow first.')
  const spec = slideshowSpecSchema.parse(row.spec)
  const list = slideList(spec)
  const presets = deps.config.pipeline.content.export_presets
  const reels = presetFor(presets, 'reels'), shorts = presetFor(presets, 'shorts')
  // The carousel: the Instagram set from the export when it was made, else
  // drawn now from the same slides.
  const carouselIds = out.instagramAssetIds?.length === ids.length ? out.instagramAssetIds : await renderInstagramSet(deps, ctx, row, job.id)
  const slideSec = ids.map((_, i) => slideSeconds(list[i]?.text ?? ''))
  const name = (row.title || 'slideshow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'slideshow'
  const made = await withTempDir(async dir => {
    const inputs: string[] = []
    for (const [i, id] of ids.entries()) {
      const p = join(dir, `s${i}.jpg`)
      await writeFile(p, (await readAsset(deps, ctx, id)).data)
      // One frame each: zoompan makes the slide's frames from it (a looped
      // input would give every frame its own full zoom).
      inputs.push('-i', p)
    }
    const reel = join(dir, 'reel.mp4')
    await ffmpeg([...inputs, '-filter_complex', reelFilter(slideSec), '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', `${reels.video_kbps}k`, '-bufsize', `${reels.video_kbps * 2}k`, '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-t', String(reels.max_seconds), reel], 300_000)
    // Shorts: the same reel within Shorts' length and bitrate.
    const short = join(dir, 'shorts.mp4')
    await ffmpeg(['-i', reel, '-t', String(shorts.max_seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', `${shorts.video_kbps}k`, '-bufsize', `${shorts.video_kbps * 2}k`, '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', short], 300_000)
    const { readFile } = await import('node:fs/promises')
    return { reel: await readFile(reel), short: await readFile(short), seconds: (await probeFile(reel)).durationSec ?? slideSec.reduce((a, b) => a + b, 0) }
  })
  const reelId = (await saveAsset(deps, ctx, { data: made.reel, mime: 'video/mp4', origin: 'derived', label: `Reel: ${row.title || 'slideshow'}`, sourceJobId: job.id })).id
  const shortsId = (await saveAsset(deps, ctx, { data: made.short, mime: 'video/mp4', origin: 'derived', label: `Shorts: ${row.title || 'slideshow'}`, sourceJobId: job.id })).id
  const caption = spec.caption.trim()
  const files: Record<string, Uint8Array> = {
    'reel.mp4': made.reel, 'shorts.mp4': made.short,
    'caption.txt': Buffer.from(`${caption}\n\nInstagram: post the carousel/ images in order (1080 x 1440). Reels: reel.mp4 (1080 x 1920, silent: add the sound in the app). YouTube Shorts: shorts.mp4. Turn on each app's AI-generated content label.\n`),
  }
  for (const [i, id] of carouselIds.entries()) files[`carousel/${String(i + 1).padStart(2, '0')}-${name}.jpg`] = (await readAsset(deps, ctx, id)).data
  const zipId = (await saveAsset(deps, ctx, { data: Buffer.from(zipSync(files, { level: 0 })), mime: 'application/zip', origin: 'derived', label: `Three platforms: ${row.title || 'slideshow'} (zip)`, sourceJobId: job.id })).id
  const platforms: PlatformSet = { carouselIds, reelId, shortsId, zipId, slideSec, reelSec: Math.round(made.seconds * 10) / 10, madeAt: deps.clock.now().toISOString() }
  // Only the outputs move (the post's own spec stays as it is).
  const now = await getContent(deps, ctx, postId)
  await deps.db.update(contentItems).set({ outputs: { ...(now.outputs as ContentOutputs), platforms } }).where(and(eq(contentItems.id, postId), eq(contentItems.accountId, ctx.accountId)))
  return { reelSec: platforms.reelSec, slides: ids.length }
}

let registered = false
export function registerPlatforms(): void {
  if (registered) return
  registered = true
  registerLocalJob('platforms', runPlatforms)
}
