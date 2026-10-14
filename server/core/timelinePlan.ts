import type { CameraBlock, CameraKey, PresetStrength } from './camera.js'
import { placeStack, type Places, type StyleItem } from './editorStyle.js'

// What the worker renders for a post's timeline (editor phase D, G32).
// Camera presets become blocks for the worker's camera pass (the editor's
// own math). Time, text and layout presets map to the worker's code edits
// of the same name (G24, G26), one per video, and caption looks to the
// caption style. Anything only the editor draws is named in `notes`, so
// the owner knows to press Done in the editor for it. Pure.

export interface PresetInfo { id: string; label: string; kind: 'camera' | 'time' | 'text' | 'caption' | 'layout'; anchor: 'playhead' | 'cut'; duration: number; keys?: CameraKey[] }
export interface EditStyleRef { id: string; preset: string | null }

export interface WorkerPlan {
  blocks: CameraBlock[]
  // One code edit (the first time, text or layout preset), at its time.
  edit: { style: string; strength: PresetStrength; at: number } | null
  captionStyle: 'box' | 'outline' | null
  notes: string[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

// A stack placed on a post: its own duration, payoff, cuts and beats.
export function planFromStack(stack: StyleItem[], places: Places, presets: PresetInfo[], styles: EditStyleRef[]): WorkerPlan {
  const plan: WorkerPlan = { blocks: [], edit: null, captionStyle: null, notes: [] }
  const placed = placeStack(stack, places)
  for (const it of placed) {
    const def = presets.find(p => p.id === it.preset)
    if (!def) { plan.notes.push(`"${it.preset}" is not in this version of the presets`); continue }
    if (def.kind === 'camera') {
      const keys = it.keys ?? def.keys ?? []
      if (!keys.length) continue
      const duration = it.duration ?? def.duration
      // A transition is placed by its centre (the cut).
      const start = def.anchor === 'cut' ? it.time - duration / 2 : it.time
      plan.blocks.push({ start: r3(Math.max(0, start)), duration: r3(duration), strength: it.strength, keys: keys as CameraKey[], preset: def.id })
      continue
    }
    if (def.kind === 'caption') {
      plan.captionStyle = def.id === 'look_box' ? 'box' : 'outline'
      continue
    }
    const style = styles.find(s => s.preset === def.id)
    if (!style) { plan.notes.push(`${def.label} is drawn by the editor only`); continue }
    if (plan.edit) { plan.notes.push(`${def.label}: the worker draws one time, text or layout edit per video (${plan.edit.style.replace(/_/g, ' ')} is first)`); continue }
    plan.edit = { style: style.id, strength: it.strength, at: it.time }
  }
  plan.blocks.sort((a, b) => a.start - b.start)
  return plan
}

// ── A timeline saved by the editor (OpenReel project JSON) ──

interface ProjectClip { id: string; mediaId: string; startTime: number; duration: number; inPoint: number; outPoint: number; reversed?: boolean; speed?: number; transform?: { position?: { x: number; y: number }; scale?: { x: number; y: number }; rotation?: number; crop?: unknown }; effects?: unknown[] }
interface ProjectTrack { id: string; type: string; name?: string; role?: string; hidden?: boolean; muted?: boolean; clips: ProjectClip[]; transitions?: unknown[] }
interface ProjectText { id: string; trackId: string; startTime: number; duration: number; text: string; behindSubject?: boolean; animation?: { preset?: string } | null; style?: { backgroundColor?: string; color?: string; strokeWidth?: number }; transform?: { position?: { x: number; y: number } } }
interface ProjectLayer { trackId?: string; startTime: number; duration: number; enabled?: boolean; effects?: unknown[]; studio?: { preset: string; strength: PresetStrength; keys: CameraKey[] } }
export interface StudioProject {
  timeline: { tracks: ProjectTrack[]; subtitles?: unknown[]; markers?: Array<{ time: number; label?: string }> }
  textClips?: ProjectText[]
  adjustmentLayers?: ProjectLayer[]
  studioMedia?: Record<string, string>
  studioMusic?: string[]
  studioMusicInExport?: boolean
  studioCutouts?: string[]
  studioBeats?: { times: number[] } | null
}

export interface ProjectShot { assetId: string; start: number; in: number; out: number }
export interface ProjectCaption { text: string; start: number; end: number; look: 'box' | 'outline'; y: number }
export interface ProjectPlan {
  shots: ProjectShot[]
  // Black between shots where the timeline has a gap (start, length).
  gaps: Array<{ start: number; duration: number }>
  captions: ProjectCaption[]
  blocks: CameraBlock[]
  musicInExport: boolean
  duration: number
  notes: string[]
}

const isVideo = (t: ProjectTrack) => t.type === 'video' && !t.hidden

// The main track: the visible video track with the most shots.
function mainTrack(p: StudioProject): ProjectTrack | undefined {
  return [...p.timeline.tracks].filter(isVideo).sort((a, b) => b.clips.length - a.clips.length)[0]
}

function lightBackground(c: string | undefined): boolean {
  if (!c) return false
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i)
  if (m) return Number(m[4] ?? 1) > 0.5 && Number(m[1]) + Number(m[2]) + Number(m[3]) > 600
  const h = c.replace('#', '')
  if (/^[0-9a-f]{6}$/i.test(h)) return parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16) > 600
  return /^(#fff|white)$/i.test(c)
}

export function planFromProject(p: StudioProject): ProjectPlan {
  const notes = new Set<string>()
  const media = p.studioMedia ?? {}
  const main = mainTrack(p)
  const shots: ProjectShot[] = []
  const gaps: ProjectPlan['gaps'] = []
  let at = 0
  for (const c of [...(main?.clips ?? [])].sort((a, b) => a.startTime - b.startTime)) {
    const assetId = media[c.mediaId]
    if (!assetId) { notes.add('A clip added in the editor from this computer (only the editor\'s export has it)'); continue }
    if (c.startTime - at > 0.04) gaps.push({ start: r3(at), duration: r3(c.startTime - at) })
    shots.push({ assetId, start: r3(c.startTime), in: r3(c.inPoint), out: r3(c.outPoint) })
    at = Math.max(at, c.startTime + c.duration)
    if (c.reversed) notes.add('Rewind (reversed shot)')
    if (c.speed && c.speed !== 1) notes.add('Shot speed changes')
    if (c.effects?.length) notes.add('OpenReel effects on a shot')
    const tf = c.transform
    if (tf && ((tf.scale && (tf.scale.x !== 1 || tf.scale.y !== 1)) || (tf.position && (tf.position.x || tf.position.y)) || tf.rotation || tf.crop)) notes.add('A shot moved, scaled or cropped in the preview')
  }
  if (main?.transitions?.length) notes.add('OpenReel transitions between shots')
  for (const t of p.timeline.tracks) if (t !== main && isVideo(t) && t.clips.length) notes.add('A second video track (a layout, picture in picture or overlay)')
  if (p.studioCutouts?.length) notes.add('The person cutout')
  if (p.timeline.subtitles?.length) notes.add('Karaoke captions')
  const captionTracks = new Set(p.timeline.tracks.filter(t => t.type === 'text' && !t.hidden).map(t => t.id))
  const captions: ProjectCaption[] = []
  for (const t of p.textClips ?? []) {
    if (!captionTracks.has(t.trackId) || !t.text.trim()) continue
    if (t.behindSubject) notes.add('Text behind her')
    if (t.animation?.preset && t.animation.preset !== 'none') notes.add('Caption animations (word by word, slam)')
    captions.push({ text: t.text.trim(), start: r3(t.startTime), end: r3(t.startTime + t.duration), look: lightBackground(t.style?.backgroundColor) ? 'box' : 'outline', y: t.transform?.position?.y ?? 0.26 })
  }
  const trackIds = new Set(p.timeline.tracks.map(t => t.id))
  const hidden = new Set(p.timeline.tracks.filter(t => t.hidden).map(t => t.id))
  const blocks: CameraBlock[] = []
  for (const l of p.adjustmentLayers ?? []) {
    if (l.enabled === false) continue
    if (!l.studio) { if (l.effects?.length) notes.add('OpenReel adjustment layers'); continue }
    if (l.trackId && trackIds.has(l.trackId) && hidden.has(l.trackId)) continue
    blocks.push({ start: r3(l.startTime), duration: r3(l.duration), strength: l.studio.strength, keys: l.studio.keys, preset: l.studio.preset })
  }
  blocks.sort((a, b) => a.start - b.start)
  return { shots, gaps, captions, blocks, musicInExport: p.studioMusicInExport !== false, duration: r3(at), notes: [...notes] }
}
