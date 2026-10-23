import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { candidates, contentItems, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { registerLocalJob, type JobRow } from '../jobs/hooks.js'
import { enqueueLocalJob } from '../jobs/runner.js'
import { dumpFrames, textFrames, type CardSpec } from '../core/cardRender.js'
import { ffmpeg, withTempDir } from '../media/ffmpeg.js'
import { renderSlide } from '../media/slideRender.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { getContent, type ContentOutputs, type ContentRow } from './content.js'
import { soundFile } from './sounds.js'

// Text-only and photo-dump posts (UX-PLAN.md section 42 A, B), made free on
// the worker: no generation, no quote. The frames are drawn with the
// slideshow's own text layout (the bundled fonts), cut one after the other
// (never crossfaded), 1080 x 1920 at 30 fps, with the post's uploaded sound
// when it has one, else silent (the sound is added in the app).

const W = 1080, H = 1920, FPS = 30
export const cardOf = (row: Pick<ContentRow, 'spec'>): CardSpec | null => ((row.spec as { card?: CardSpec | null } | null)?.card ?? null)
const lineOfPost = (row: ContentRow) => String((row.spec as { caption?: string }).caption ?? '').trim()

// The stills a photo dump uses: the ones named, else the character's newest
// approved stills (images, not takes), 5 or 6.
export async function dumpStills(deps: Deps, ctx: Ctx, characterId: string | null, named: string[]): Promise<string[]> {
  if (!characterId) return []
  const base = and(eq(candidates.accountId, ctx.accountId), eq(candidates.characterId, characterId), eq(candidates.status, 'approved'), inArray(candidates.op, ['generate', 'edit', 'upscale', 'crop', 'drift_lock', 'upload', 'clone']))
  if (named.length) {
    const rows = await deps.db.select({ id: candidates.id, assetId: candidates.assetId }).from(candidates).where(and(base, inArray(candidates.id, named)))
    return named.map(id => rows.find(r => r.id === id)?.assetId).filter((a): a is string => !!a).slice(0, 6)
  }
  const rows = await deps.db.select({ assetId: candidates.assetId }).from(candidates).where(and(base, eq(candidates.target, 'scene'))).orderBy(desc(candidates.createdAt)).limit(6)
  return rows.map(r => r.assetId).filter((a): a is string => !!a)
}

const solid = (hex: string) => sharp({ create: { width: W, height: H, channels: 3, background: hex } }).png().toBuffer()

async function backdrop(deps: Deps, ctx: Ctx, row: ContentRow, card: CardSpec): Promise<Buffer> {
  // A place's still already in the Studio, dimmed under the text ($0).
  const stillId = (row.spec as { stillId?: string | null }).stillId
  if (card.type === 'text_only' && stillId) {
    const [c] = await deps.db.select({ assetId: candidates.assetId }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, stillId)))
    if (c?.assetId) return sharp((await readAsset(deps, ctx, c.assetId)).data).rotate().resize(W, H, { fit: 'cover' }).modulate({ brightness: 0.4 }).png().toBuffer()
  }
  return solid(card.bgColor)
}

// Each frame a still image; zoom makes a slow push-in, else it holds.
function segment(input: string, seconds: number, zoom: boolean, out: string): string[] {
  const frames = Math.max(1, Math.round(seconds * FPS))
  const vf = zoom
    ? `scale=${W * 2}:${H * 2},zoompan=z='min(1+0.06*on/${frames},1.06)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p`
    : `scale=${W}:${H},setsar=1,format=yuv420p,fps=${FPS}`
  return zoom
    ? ['-y', '-i', input, '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', out]
    : ['-y', '-loop', '1', '-i', input, '-vf', vf, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', out]
}

export async function renderCard(deps: Deps, ctx: Ctx, row: ContentRow, jobId: string | null): Promise<{ assetId: string; seconds: number }> {
  const card = cardOf(row)
  if (!card) throw new AppError('bad_request', 'This post is not a text-only or photo-dump post.')
  const line = lineOfPost(row)
  if (!line) throw new AppError('bad_request', 'No line yet: Fill or write one first.')
  const content = deps.config.pipeline.content
  const frame = { width: W, height: H }
  const frames: Array<{ png: Buffer; seconds: number }> = []
  if (card.type === 'text_only') {
    const bg = await backdrop(deps, ctx, row, card)
    for (const f of textFrames(line, card.textStyle)) frames.push({ png: await renderSlide({ still: bg, text: f.text, style: 'classic', pos: { x: 0.5, y: 0.42 }, special: null, ad: false }, frame, content), seconds: f.seconds })
  } else {
    const ids = await dumpStills(deps, ctx, row.characterId, card.stillIds)
    if (ids.length < 5) throw new AppError('bad_request', `A photo dump needs 5 or 6 approved stills; ${ids.length} found.`)
    const secs = dumpFrames(ids.length)
    for (const [i, id] of ids.entries()) frames.push({ png: await renderSlide({ still: (await readAsset(deps, ctx, id)).data, text: line, style: 'classic', pos: null, special: null, ad: false }, frame, content), seconds: secs[i]! })
  }
  const sound = (row.spec as { sound?: { music?: string | null } | null }).sound?.music ?? null
  const data = await withTempDir(async dir => {
    const parts: string[] = []
    for (const [i, f] of frames.entries()) {
      const img = join(dir, `f${i}.jpg`), seg = join(dir, `s${i}.mp4`)
      await writeFile(img, f.png)
      await ffmpeg(segment(img, f.seconds, card.motion === 'zoom', seg), 120_000)
      parts.push(seg)
    }
    const list = join(dir, 'list.txt')
    await writeFile(list, parts.map(p => `file '${p}'`).join('\n'))
    const silent = join(dir, 'video.mp4')
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', silent], 120_000)
    if (!sound) return readFile(silent)
    const music = await soundFile(deps, ctx, sound, dir, 'sound.audio')
    const out = join(dir, 'out.mp4')
    await ffmpeg(['-y', '-i', silent, '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], 120_000)
    return readFile(out)
  })
  const seconds = frames.reduce((a, f) => a + f.seconds, 0)
  const asset = await saveAsset(deps, ctx, { data, mime: 'video/mp4', origin: 'derived', label: `${card.type === 'text_only' ? 'Text post' : 'Photo dump'}: ${line.slice(0, 60)}`, sourceJobId: jobId ?? undefined })
  const now = await getContent(deps, ctx, row.id)
  await deps.db.update(contentItems).set({ outputs: { ...(now.outputs as ContentOutputs), videoAssetId: asset.id } }).where(and(eq(contentItems.id, row.id), eq(contentItems.accountId, ctx.accountId)))
  return { assetId: asset.id, seconds }
}

// "Render N $0 posts": one free worker job per post, never two at once.
export async function startCardRenders(deps: Deps, ctx: Ctx, postIds: string[]): Promise<{ started: number }> {
  let started = 0
  for (const id of postIds) {
    const row = await getContent(deps, ctx, id)
    if (!cardOf(row)) continue
    const busy = await deps.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.accountId, ctx.accountId), eq(jobs.purpose, `week_render:${id}`), inArray(jobs.status, ['queued', 'running']))).limit(1)
    if (busy.length) continue
    await enqueueLocalJob(deps, ctx, { stage: 'content', purpose: `week_render:${id}`, label: `Render ${cardOf(row)!.type === 'text_only' ? 'the text post' : 'the photo dump'} ($0)`, characterId: row.characterId, request: {} })
    started++
  }
  return { started }
}

async function runCardRender(deps: Deps, ctx: Ctx, job: JobRow): Promise<unknown> {
  const row = await getContent(deps, ctx, job.purpose.split(':')[1]!)
  return renderCard(deps, ctx, row, job.id)
}

let registered = false
export function registerCardRenders(): void {
  if (registered) return
  registered = true
  registerLocalJob('week_render', runCardRender)
}
