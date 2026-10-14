// A post's layers in OpenCut's project layout (Phase 4; DECISIONS G13 and
// G23). OpenCut keeps one main video track, overlay tracks over it (text)
// and audio tracks under it, with every time in integer ticks of 1/120000
// s. The Studio's Fine-tune editor works on the same layers today, and this
// is the hand-off format for the OpenCut engine once it is embedded: the
// project, plus the media list with streaming URLs (nothing downloaded).
// Pure and deterministic, so it is unit-tested.

export const TICKS_PER_SECOND = 120_000
export const OPENCUT_PROJECT_VERSION = 31

const ticks = (sec: number) => Math.round(Math.max(0, sec) * TICKS_PER_SECOND)

export interface EditorMedia { id: string; kind: 'video' | 'audio'; name: string; url: string; durationSec: number | null }
export interface EditorShot { id: string; kind: 'clip' | 'broll'; mediaId: string; title: string; start: number; in: number; out: number; sourceSec: number | null; sound: boolean }
export interface EditorCaption { id: string; text: string; start: number; end: number }
export interface EditorAudio { id: string; mediaId: string; name: string; role: 'ambience' | 'music'; gainDb: number; durationSec: number }

export interface EditorProjectInput {
  id: string
  name: string
  canvas: { width: number; height: number; fps: number }
  totalSec: number
  shots: EditorShot[]
  captions: EditorCaption[]
  audio: EditorAudio[]
  createdAt: string
  updatedAt: string
}

export function toOpenCutProject(p: EditorProjectInput) {
  const base = (id: string, name: string, start: number, duration: number) => ({ id, name, startTime: ticks(start), duration: ticks(duration), params: {} as Record<string, unknown> })
  const main = {
    id: 'main', name: 'Main', type: 'video' as const, muted: false, hidden: false,
    elements: p.shots.map(s => ({
      ...base(s.id, s.title, s.start, s.out - s.in), type: 'video' as const, mediaId: s.mediaId,
      trimStart: ticks(s.in), trimEnd: s.sourceSec == null ? 0 : ticks(Math.max(0, s.sourceSec - s.out)),
      ...(s.sourceSec == null ? {} : { sourceDuration: ticks(s.sourceSec) }), isSourceAudioEnabled: s.sound,
    })),
  }
  const text = {
    id: 'captions', name: 'Captions', type: 'text' as const, hidden: false,
    elements: p.captions.map(c => ({ ...base(c.id, c.text.slice(0, 40), c.start, Math.max(0, c.end - c.start)), type: 'text' as const, trimStart: 0, trimEnd: 0, params: { content: c.text } })),
  }
  const audio = p.audio.map(a => ({
    id: `audio-${a.id}`, name: a.role === 'music' ? 'Music' : 'Ambience', type: 'audio' as const, muted: false,
    elements: [{ ...base(a.id, a.name, 0, Math.min(a.durationSec, p.totalSec)), type: 'audio' as const, sourceType: 'upload' as const, mediaId: a.mediaId, trimStart: 0, trimEnd: 0, params: { volumeDb: a.gainDb } }],
  }))
  return {
    version: OPENCUT_PROJECT_VERSION,
    metadata: { id: p.id, name: p.name, duration: ticks(p.totalSec), createdAt: p.createdAt, updatedAt: p.updatedAt },
    settings: { fps: { numerator: p.canvas.fps, denominator: 1 }, canvasSize: { width: p.canvas.width, height: p.canvas.height }, background: { type: 'color' as const, color: '#000000' } },
    currentSceneId: 'main-scene',
    scenes: [{ id: 'main-scene', name: 'Main scene', isMain: true, bookmarks: [], tracks: { main, overlay: [text], audio }, createdAt: p.createdAt, updatedAt: p.updatedAt }],
  }
}

export type OpenCutProject = ReturnType<typeof toOpenCutProject>
