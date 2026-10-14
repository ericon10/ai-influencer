import { and, eq, inArray } from 'drizzle-orm'
import { brollClips, candidates, jobs } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { effectiveCut, type Cut } from '../core/cut.js'
import { planShots } from '../media/timeline.js'
import { getAsset } from '../storage/assets.js'
import { getContent, specSchemas, voicePhrases, type MemeSpec } from './content.js'
import { listSounds, soundView } from './sounds.js'
import { partsOf } from './chain.js'
import { toOpenCutProject, type EditorAudio, type EditorCaption, type EditorMedia, type EditorProjectInput, type EditorShot } from '../core/opencut.js'

// What the Finish step shows for a video post (UX-PLAN.md section 8): the
// rough cut as tracks (each shot with its title, picture, source length and
// place on the timeline; the captions with their text), and the sound bed
// with the sounds to pick from. The same numbers the renderer uses.

export interface CutShotView {
  id: string
  kind: 'clip' | 'broll'
  ref: string
  in: number
  out: number | null
  title: string
  // A picture for the block: a clip's poster (or the clip itself), the
  // B-roll's video.
  assetId: string | null
  posterId: string | null
  sourceSec: number | null
  // Where it lands in the video (null when it is not ready to measure).
  start: number | null
  durationSec: number | null
  hasSound: boolean
  ready: boolean
  takes: number
}

export async function postCutView(deps: Deps, ctx: Ctx, postId: string) {
  const row = await getContent(deps, ctx, postId)
  if (row.kind !== 'meme') throw new AppError('bad_request', 'Only a video post has a rough cut.')
  const spec = specSchemas.meme.parse(row.spec) as MemeSpec
  const cfg = deps.config.pipeline.content
  const cut: Cut = effectiveCut(spec, cfg.meme.max_broll_seconds, voicePhrases(deps))
  const clipIds = cut.shots.filter(s => s.kind === 'clip').map(s => s.ref)
  const brollIds = cut.shots.filter(s => s.kind === 'broll').map(s => s.ref)
  const [clipRows, brollRows] = await Promise.all([
    clipIds.length ? deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, clipIds))) : [],
    brollIds.length ? deps.db.select().from(brollClips).where(and(eq(brollClips.accountId, ctx.accountId), inArray(brollClips.id, brollIds))) : [],
  ])
  // A clone keeps its source's sound only when the owner asked for it.
  const cloneJobs = clipRows.filter(c => c.op === 'clone' && c.jobId).map(c => c.jobId!)
  const jobRows = cloneJobs.length ? await deps.db.select({ id: jobs.id, request: jobs.request }).from(jobs).where(inArray(jobs.id, cloneJobs)) : []
  const soundful = new Set(jobRows.filter(j => (j.request as { keepSourceSound?: boolean }).keepSourceSound).map(j => j.id))
  // A take's poster is the still it started from.
  const parentIds = clipRows.map(c => c.parentId).filter((x): x is string => !!x)
  const parents = parentIds.length ? await deps.db.select({ id: candidates.id, assetId: candidates.assetId, op: candidates.op, parentId: candidates.parentId }).from(candidates).where(inArray(candidates.id, parentIds)) : []
  const grand = parents.filter(p => p.op !== 'generate' && p.parentId).map(p => p.parentId!)
  const grandRows = grand.length ? await deps.db.select({ id: candidates.id, assetId: candidates.assetId, op: candidates.op }).from(candidates).where(inArray(candidates.id, grand)) : []
  const stillOf = (id: string | null): string | null => {
    const p = parents.find(x => x.id === id)
    if (!p) return null
    if (!['video', 'video_upscale', 'upload', 'clone', 'chain'].includes(p.op)) return p.assetId
    return grandRows.find(g => g.id === p.parentId && !['video', 'video_upscale', 'upload', 'clone', 'chain'].includes(g.op))?.assetId ?? null
  }

  const shots: CutShotView[] = []
  for (const s of cut.shots) {
    if (s.kind === 'clip') {
      const c = clipRows.find(x => x.id === s.ref)
      const asset = c?.assetId ? await getAsset(deps, ctx, c.assetId).catch(() => null) : null
      shots.push({
        ...s, title: c?.label || (c?.op === 'chain' ? 'Chained clip' : c?.op === 'clone' ? 'Clone' : c?.op === 'upload' ? 'Uploaded clip' : 'Take'),
        assetId: c?.assetId ?? null, posterId: c ? stillOf(c.parentId) : null, sourceSec: asset?.durationMs ? asset.durationMs / 1000 : null,
        start: null, durationSec: null, hasSound: !!c && (c.op === 'clone' ? !!c.jobId && soundful.has(c.jobId) : false), ready: !!c?.assetId && c.status === 'approved', takes: c ? partsOf(c).length : 1,
      })
    } else {
      const b = brollRows.find(x => x.id === s.ref)
      const asset = b?.assetId ? await getAsset(deps, ctx, b.assetId).catch(() => null) : null
      shots.push({
        ...s, title: b?.title || 'B-roll', assetId: b?.assetId ?? null, posterId: null, sourceSec: asset?.durationMs ? asset.durationMs / 1000 : null,
        start: null, durationSec: null, hasSound: false, ready: b?.status === 'ready' && !!b.assetId, takes: 1,
      })
    }
  }
  // Places on the timeline, from the same planner the renderer uses.
  const measurable = shots.filter(s => s.sourceSec != null)
  const plan = planShots(measurable.map(s => ({ in: s.in, out: s.out, maxSeconds: s.kind === 'clip' ? cfg.meme.max_clip_seconds : cfg.meme.max_broll_seconds })), measurable.map(s => ({ durationSec: s.sourceSec!, hasAudio: s.hasSound, width: 9, height: 16 })), cfg.cut.max_seconds)
  measurable.forEach((s, i) => { const p = plan[i]; if (p) { s.start = p.start; s.durationSec = p.durationSec; s.in = p.in; s.out = s.out == null ? null : p.out } })
  const total = plan.reduce((a, p) => a + p.durationSec, 0)

  const sounds = (await listSounds(deps, ctx)).map(soundView)
  return {
    auto: cut.auto,
    shots,
    captions: cut.captions.map(c => ({ ...c, shown: (c.text ?? spec.caption).trim(), linked: c.text == null })),
    totalSec: Math.round(total * 100) / 100,
    complete: shots.length > 0 && shots.every(s => s.ready),
    limits: { maxSeconds: cfg.cut.max_seconds, maxShots: cfg.cut.max_shots, maxCaptions: cfg.cut.max_captions },
    sound: {
      spec: { ...spec.sound, ambience: spec.sound.ambience ?? cfg.sound.default_ambience },
      sounds,
      hasClipSound: shots.some(s => s.hasSound),
      targetLufs: cfg.sound.target_lufs,
      levels: cfg.sound.levels,
      maxUploadMb: cfg.sound.max_upload_mb,
    },
  }
}

export type CutView = Awaited<ReturnType<typeof postCutView>>

// The Fine-tune editor's project (Phase 4): the cut as layers, with every
// clip, B-roll and sound streamed from storage by URL (same origin, same
// login; nothing is downloaded), and the same project in OpenCut's layout
// for the OpenCut engine (DECISIONS G23).
export async function postEditorProject(deps: Deps, ctx: Ctx, postId: string) {
  const row = await getContent(deps, ctx, postId)
  const view = await postCutView(deps, ctx, postId)
  const cfg = deps.config.pipeline.content
  const url = (assetId: string) => `/api/v1/assets/${assetId}/content`
  const media: EditorMedia[] = []
  const shots: EditorShot[] = []
  for (const s of view.shots) {
    if (!s.assetId || s.start == null || s.durationSec == null) continue
    if (!media.some(m => m.id === s.assetId)) media.push({ id: s.assetId, kind: 'video', name: s.title, url: url(s.assetId), durationSec: s.sourceSec })
    shots.push({ id: s.id, kind: s.kind, mediaId: s.assetId, title: s.title, start: s.start, in: s.in, out: s.in + s.durationSec, sourceSec: s.sourceSec, sound: s.hasSound })
  }
  const total = view.totalSec
  const captions: EditorCaption[] = view.captions.filter(c => c.shown).map(c => ({ id: c.id, text: c.shown, start: c.start, end: c.end == null ? total : Math.min(total, c.end) }))
  const audio: EditorAudio[] = []
  const levels = cfg.sound.levels
  const s = view.sound.spec
  for (const [role, id, level] of [['ambience', s.ambience, s.ambienceLevel], ['music', s.music, s.musicLevel]] as const) {
    const snd = id ? view.sound.sounds.find(x => x.id === id && x.assetId) : null
    if (!snd?.assetId) continue
    media.push({ id: snd.assetId, kind: 'audio', name: snd.title, url: url(snd.assetId), durationSec: snd.durationSec })
    audio.push({ id: snd.id, mediaId: snd.assetId, name: snd.title, role, gainDb: levels[level], durationSec: snd.durationSec ?? total })
  }
  const input: EditorProjectInput = {
    id: row.id, name: row.title || row.idea.slice(0, 60) || 'Video post', canvas: cfg.canvas, totalSec: total, shots, captions, audio,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
  return { media, opencut: toOpenCutProject(input), builtInAmbience: s.ambience === 'room' ? 'Room tone' : null }
}
