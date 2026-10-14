import { describe, expect, it } from 'vitest'
import { TICKS_PER_SECOND, toOpenCutProject } from './opencut.js'

// The Fine-tune hand-off format: OpenCut's project layout in ticks.
describe('OpenCut project layout', () => {
  it('puts shots on the main track, captions over it and sounds under it, in 1/120000 s ticks', () => {
    const p = toOpenCutProject({
      id: 'cnt_1', name: 'Coffee', canvas: { width: 1080, height: 1920, fps: 30 }, totalSec: 7,
      shots: [
        { id: 's1', kind: 'clip', mediaId: 'ast_a', title: 'Take', start: 0, in: 0.5, out: 5.5, sourceSec: 6, sound: false },
        { id: 's2', kind: 'broll', mediaId: 'ast_b', title: 'Screen', start: 5, in: 1, out: 3, sourceSec: null, sound: false },
      ],
      captions: [{ id: 'main', text: 'me when it works', start: 0, end: 7 }],
      audio: [{ id: 'snd_1', mediaId: 'ast_m', name: 'Track', role: 'music', gainDb: 0, durationSec: 30 }],
      createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
    })
    expect(TICKS_PER_SECOND).toBe(120000)
    expect(p.settings).toMatchObject({ fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 } })
    const [scene] = p.scenes
    expect(scene!.tracks.main.elements[0]).toMatchObject({ type: 'video', mediaId: 'ast_a', startTime: 0, duration: 600000, trimStart: 60000, trimEnd: 60000, sourceDuration: 720000 })
    expect(scene!.tracks.main.elements[1]).toMatchObject({ startTime: 600000, duration: 240000, trimStart: 120000, trimEnd: 0 })
    expect(scene!.tracks.overlay[0]!.elements[0]).toMatchObject({ type: 'text', duration: 840000, params: { content: 'me when it works' } })
    // A sound runs at most the length of the post.
    expect(scene!.tracks.audio[0]!.elements[0]).toMatchObject({ type: 'audio', mediaId: 'ast_m', duration: 840000 })
    expect(p.metadata.duration).toBe(840000)
  })
})
