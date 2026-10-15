import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { anchorFor } from './editorStyle.js'
import { planFromProject, planFromStack, type PresetInfo, type StudioProject } from './timelinePlan.js'

// What the worker renders for a timeline (editor phase D, G32).

const cfg = loadConfig()
const presets = cfg.pipeline.presets.presets as PresetInfo[]
const styles = cfg.pipeline.edits.styles.map(s => ({ id: s.id, preset: s.preset }))
const places = { duration: 10, payoff: 7, cuts: [4], beats: [] as number[] }

describe('the preset library on the worker', () => {
  it('is the pinned editor commit\'s (run npm run presets:sync after a bump)', () => {
    const pin = JSON.parse(readFileSync(join(process.cwd(), 'editor/openreel.json'), 'utf8')) as { commit: string }
    expect(cfg.pipeline.presets.source.commit).toBe(pin.commit)
    for (const p of presets) if (p.kind === 'camera') expect(p.keys?.length, p.id).toBeGreaterThan(1)
  })
})

describe('a stack placed on a post', () => {
  it('turns camera presets into blocks (a transition centred on its cut), with the library\'s keys', () => {
    const plan = planFromStack([
      { preset: 'snap_zoom', strength: 'strong', at: anchorFor(7, places), duration: null, keys: null },
      { preset: 'glitch', strength: 'normal', at: anchorFor(4, places), duration: null, keys: null },
    ], places, presets, styles)
    const glitch = presets.find(p => p.id === 'glitch')!
    expect(plan.blocks.map(b => b.preset)).toEqual(['glitch', 'snap_zoom'])
    expect(plan.blocks[0]!.start).toBeCloseTo(4 - glitch.duration / 2)
    expect(plan.blocks[1]).toMatchObject({ start: 7, strength: 'strong' })
    expect(plan.blocks[1]!.keys).toEqual(presets.find(p => p.id === 'snap_zoom')!.keys)
    expect(plan.notes).toEqual([])
  })

  it('keeps edited keys and length, sets the caption look, and maps one time preset to the code edit', () => {
    const keys = [{ t: 0, scale: 1 }, { t: 1, scale: 2 }]
    const plan = planFromStack([
      { preset: 'push_in', strength: 'normal', at: anchorFor(1, places), duration: 3, keys },
      { preset: 'look_outline', strength: 'normal', at: anchorFor(0, places), duration: null, keys: null },
      { preset: 'speed_ramp', strength: 'subtle', at: anchorFor(7, places), duration: null, keys: null },
      { preset: 'freeze_pop', strength: 'normal', at: anchorFor(8, places), duration: null, keys: null },
      { preset: 'pip', strength: 'normal', at: anchorFor(2, places), duration: null, keys: null },
    ], places, presets, styles)
    expect(plan.blocks[0]).toMatchObject({ preset: 'push_in', duration: 3, keys })
    expect(plan.captionStyle).toBe('outline')
    expect(plan.edit).toEqual({ style: 'speed_ramp', strength: 'subtle', at: 7 })
    expect(plan.notes.join(' | ')).toMatch(/one time, text or layout edit per video/)
    expect(plan.notes.join(' | ')).toMatch(/Picture-in-picture|picture/i)
  })
})

describe('a timeline saved by the editor', () => {
  const project: StudioProject = {
    timeline: {
      tracks: [
        { id: 'cap', type: 'text', name: 'Captions', clips: [] },
        { id: 'pre', type: 'graphics', name: 'Presets', role: 'effects', clips: [] },
        { id: 'v1', type: 'video', name: 'Track 1', clips: [
          { id: 'a', mediaId: 'm1', startTime: 0, duration: 3, inPoint: 1, outPoint: 4 },
          { id: 'b', mediaId: 'm2', startTime: 3.5, duration: 2, inPoint: 0, outPoint: 2 },
        ] },
        { id: 'v2', type: 'video', name: 'Overlay', hidden: true, clips: [{ id: 'c', mediaId: 'm1', startTime: 0, duration: 1, inPoint: 0, outPoint: 1 }] },
      ],
      subtitles: [],
    },
    textClips: [
      { id: 't1', trackId: 'cap', startTime: 0, duration: 5.5, text: 'when the drop hits', style: { backgroundColor: 'rgba(0,0,0,0)' }, transform: { position: { x: 0.5, y: 0.26 } } },
      { id: 't2', trackId: 'cap', startTime: 2, duration: 1, text: 'boxed', style: { backgroundColor: '#ffffff' }, transform: { position: { x: 0.5, y: 0.7 } } },
    ],
    adjustmentLayers: [
      { trackId: 'pre', startTime: 4, duration: 1.2, enabled: true, studio: { preset: 'snap_zoom', strength: 'strong', keys: [{ t: 0, scale: 1 }, { t: 1, scale: 1.4 }] } },
      { trackId: 'pre', startTime: 1, duration: 1, enabled: false, studio: { preset: 'shake', strength: 'normal', keys: [{ t: 0, shake: 0.02 }] } },
    ],
    studioMedia: { m1: 'ast_one', m2: 'ast_two' },
    studioMusicInExport: false,
  }

  it('reads the shots as trimmed, the gap, the captions with look and place, and the presets', () => {
    const p = planFromProject(project)
    expect(p.shots).toEqual([{ assetId: 'ast_one', start: 0, in: 1, out: 4 }, { assetId: 'ast_two', start: 3.5, in: 0, out: 2 }])
    expect(p.gaps).toEqual([{ start: 3, duration: 0.5 }])
    expect(p.captions).toEqual([
      { text: 'when the drop hits', start: 0, end: 5.5, look: 'outline', y: 0.26 },
      { text: 'boxed', start: 2, end: 3, look: 'box', y: 0.7 },
    ])
    expect(p.blocks).toEqual([{ start: 4, duration: 1.2, strength: 'strong', keys: [{ t: 0, scale: 1 }, { t: 1, scale: 1.4 }], preset: 'snap_zoom' }])
    expect(p.musicInExport).toBe(false)
    expect(p.duration).toBe(5.5)
    expect(p.notes).toEqual([])
  })

  it('names what only the editor draws', () => {
    const p = planFromProject({
      ...project,
      timeline: { ...project.timeline, subtitles: [{}], tracks: project.timeline.tracks.map(t => (t.id === 'v2' ? { ...t, hidden: false } : t)) },
      studioCutouts: ['a'],
      textClips: [{ ...project.textClips![0]!, behindSubject: true }],
    })
    expect(p.notes).toEqual(expect.arrayContaining(['A second video track (a layout, picture in picture or overlay)', 'The person cutout', 'Karaoke captions', 'Text behind her']))
  })

  it('names karaoke set on a caption (the editor lights its words)', () => {
    const cap = project.textClips![0]!
    const p = planFromProject({ ...project, textClips: [{ ...cap, style: { ...cap.style, highlightColor: '#ffd60a' } }] })
    expect(p.notes).toEqual(['Karaoke captions'])
  })
})
