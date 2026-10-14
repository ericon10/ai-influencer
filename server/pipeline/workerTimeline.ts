import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Ctx, Deps } from '../context.js'
import type { Cut } from '../core/cut.js'
import { anchorFor, type Places, type StyleItem } from '../core/editorStyle.js'
import { planFromProject, planFromStack, type EditStyleRef, type PresetInfo, type StudioProject, type WorkerPlan } from '../core/timelinePlan.js'
import { detectBeats } from '../media/edits.js'
import { ffmpeg } from '../media/ffmpeg.js'
import { normalizeForRender } from '../media/normalize.js'
import type { TimelineShot } from '../media/timeline.js'
import { getAsset, readAsset } from '../storage/assets.js'
import { candidateAsset, getBroll, type EditSpec, type RenderPlan, type SoundSpec } from './content.js'
import { soundFile } from './sounds.js'

// The timeline the worker renders (editor phase D, G32). In order:
//  1. The timeline saved by the editor's Done: its shots as trimmed, its
//     captions (text, look, place), its camera blocks, its music switch.
//  2. A stack carried by "Make another like this" (or a batch's style),
//     placed at this video's own payoff, cuts and beats.
//  3. Otherwise the cut and its Format exactly as before (the worker's
//     code edit, face-aware). The editor places the Format's preset on
//     first open; from then on the saved timeline is what renders.

export interface WorkerTimeline { plan?: RenderPlan; cut: Cut; sound: SoundSpec; notes: string[] }

const r3 = (n: number) => Math.round(n * 1000) / 1000

function library(deps: Deps): { presets: PresetInfo[]; styles: EditStyleRef[] } {
  return {
    presets: deps.config.pipeline.presets.presets as PresetInfo[],
    styles: deps.config.pipeline.edits.styles.map(s => ({ id: s.id, preset: s.preset })),
  }
}

// Where the cut's shots start and how long it runs.
async function cutPlaces(deps: Deps, ctx: Ctx, characterId: string, cut: Cut, payoff: number | null): Promise<Omit<Places, 'beats'>> {
  let at = 0
  const starts: number[] = []
  for (const sh of cut.shots) {
    const assetId = sh.kind === 'clip' ? await candidateAsset(deps, ctx, sh.ref, characterId, 'video') : (await getBroll(deps, ctx, sh.ref)).assetId
    const length = assetId ? ((await getAsset(deps, ctx, assetId)).durationMs ?? 0) / 1000 : 0
    starts.push(at)
    at += Math.max(0.1, (sh.out ?? length) - sh.in)
  }
  const duration = r3(at)
  const pay = Math.max(0, Math.min(duration, payoff ?? duration - deps.config.pipeline.edits.payoff_from_end))
  return { duration, payoff: r3(pay), cuts: starts.slice(1).map(r3) }
}

async function musicBeats(deps: Deps, ctx: Ctx, sound: SoundSpec, maxSec: number, dir: string): Promise<number[]> {
  if (!sound.music) return []
  return detectBeats(await soundFile(deps, ctx, sound.music, dir, 'beat-music.m4a'), maxSec).catch(() => [])
}

const toRenderPlan = (p: WorkerPlan): RenderPlan => ({ blocks: p.blocks, edit: p.edit, captionStyle: p.captionStyle })

// A stack on this cut (carried, a batch's style, or the Format's preset).
export async function stackPlan(deps: Deps, ctx: Ctx, a: { characterId: string; cut: Cut; stack: StyleItem[]; edit: EditSpec; sound: SoundSpec; dir: string }): Promise<{ plan: RenderPlan; notes: string[] }> {
  const places = await cutPlaces(deps, ctx, a.characterId, a.cut, a.edit.payoff)
  const needsBeats = a.stack.some(i => i.at.on === 'beat')
  const beats = needsBeats ? await musicBeats(deps, ctx, a.sound, places.duration, a.dir) : []
  const { presets, styles } = library(deps)
  const p = planFromStack(a.stack, { ...places, beats }, presets, styles)
  return { plan: toRenderPlan(p), notes: p.notes }
}

export async function workerTimeline(deps: Deps, ctx: Ctx, a: { characterId: string; cut: Cut; sound: SoundSpec; edit: EditSpec; editor: { projectAssetId: string | null; stack: StyleItem[] | null } | null; dir: string }): Promise<WorkerTimeline> {
  const { presets, styles } = library(deps)
  if (a.editor?.projectAssetId) {
    const saved = await readAsset(deps, ctx, a.editor.projectAssetId).catch(() => null)
    if (saved) {
      const project = JSON.parse(saved.data.toString('utf8')) as StudioProject & { studioApplied?: Array<{ preset: string; strength: EditSpec['strength']; at: number }> }
      const p = planFromProject(project)
      if (p.shots.length) return projectTimeline(deps, ctx, a, project, p, presets, styles)
    }
  }
  if (a.editor?.stack?.length) {
    const { plan, notes } = await stackPlan(deps, ctx, { characterId: a.characterId, cut: a.cut, stack: a.editor.stack, edit: a.edit, sound: a.sound, dir: a.dir })
    return { plan, cut: a.cut, sound: a.sound, notes }
  }
  return { cut: a.cut, sound: a.sound, notes: [] }
}

const position = (y: number): 'top' | 'upper_third' | 'middle' | 'bottom' => (y < 0.2 ? 'top' : y < 0.4 ? 'upper_third' : y < 0.62 ? 'middle' : 'bottom')

async function projectTimeline(deps: Deps, ctx: Ctx, a: { characterId: string; sound: SoundSpec; dir: string }, project: StudioProject & { studioApplied?: Array<{ preset: string; strength: EditSpec['strength']; at: number }> }, p: ReturnType<typeof planFromProject>, presets: PresetInfo[], styles: EditStyleRef[]): Promise<WorkerTimeline> {
  const canvas = deps.config.pipeline.content.canvas
  // Each shot as a plain file, black where the timeline has a gap.
  const items = [...p.shots.map(s => ({ kind: 'shot' as const, at: s.start, s })), ...p.gaps.map(g => ({ kind: 'gap' as const, at: g.start, g }))].sort((x, y) => x.at - y.at)
  const shots: TimelineShot[] = []
  for (const [i, it] of items.entries()) {
    const path = join(a.dir, `tl${i}.mp4`)
    if (it.kind === 'gap') {
      await ffmpeg(['-y', '-f', 'lavfi', '-i', `color=black:s=${canvas.width}x${canvas.height}:r=${canvas.fps}:d=${it.g.duration}`, '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${it.g.duration}`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path])
      shots.push({ path, in: 0, out: null })
      continue
    }
    const raw = join(a.dir, `tl${i}.raw`)
    await writeFile(raw, (await readAsset(deps, ctx, it.s.assetId)).data)
    await normalizeForRender(raw, path, { canvas, keepSound: a.sound.clipSound })
    shots.push({ path, in: it.s.in, out: it.s.out })
  }
  // Presets that changed shots or captions in the editor (time, text,
  // layouts) map to the worker's code edit of the same name.
  const applied: StyleItem[] = (project.studioApplied ?? []).map(x => ({ preset: x.preset, strength: x.strength, at: anchorFor(x.at, { duration: p.duration, payoff: null, cuts: [], beats: [] }), duration: null, keys: null }))
  const extra = planFromStack(applied.filter(x => presets.find(d => d.id === x.preset)?.kind !== 'caption'), { duration: p.duration, payoff: null, cuts: [], beats: [] }, presets, styles)
  const plan: RenderPlan = {
    blocks: p.blocks,
    edit: extra.edit,
    captionStyle: p.captions[0]?.look ?? null,
    prepared: { shots, captions: p.captions.map(c => ({ text: c.text, start: c.start, end: c.end, position: position(c.y) })) },
  }
  // The cut the code edits read (shot places and caption texts).
  const cut: Cut = {
    auto: false,
    shots: p.shots.map((s, i) => ({ id: `s${i}`, kind: 'clip' as const, ref: s.assetId, in: s.in, out: s.out })),
    captions: p.captions.map((c, i) => ({ id: `c${i}`, text: c.text, start: c.start, end: c.end })),
  }
  const sound: SoundSpec = p.musicInExport ? a.sound : { ...a.sound, music: null }
  const notes = [...p.notes, ...extra.notes]
  return { plan, cut, sound, notes }
}
