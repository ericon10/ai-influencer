import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../../server/config/load.js'
import type { EditSpec, EditStyleView } from '../../types'
import { editZones } from './editZones'

// The Fine-tune Edit lane: where each edit acts, from config/edits.yaml.

const styles = loadConfig().pipeline.edits.styles as unknown as EditStyleView[]
const style = (id: string) => styles.find(s => s.id === id)!
const edit = (over: Partial<EditSpec> = {}): EditSpec => ({ style: 'none', strength: 'normal', payoff: null, text: '', ...over })
const oneShot = [{ kind: 'clip', start: 0 }]
const twoShots = [{ kind: 'clip', start: 0 }, { kind: 'clip', start: 2 }]

describe('the Edit lane', () => {
  it('shows a zone for every edit in the yaml', () => {
    for (const s of styles) {
      const shots = s.shots === 2 ? twoShots : s.needs?.includes('background') ? [...oneShot, { kind: 'broll', start: 3 }] : oneShot
      const z = editZones(s, edit({ style: s.id }), shots, 4, 2, false)
      expect(z.problem, s.id).toBeNull()
      expect(z.zones.length, s.id).toBeGreaterThan(0)
      for (const x of z.zones) expect(x.end, s.id).toBeGreaterThan(x.start)
    }
  })

  it('a two-shot edit without shot B says what is missing', () => {
    expect(editZones(style('crash_zoom'), edit({ style: 'crash_zoom' }), oneShot, 3, 2, false).problem).toMatch(/needs shot B/)
  })

  it('the crash zoom acts at the end of shot A, up to the cut', () => {
    const z = editZones(style('crash_zoom'), edit({ style: 'crash_zoom' }), twoShots, 4, 2, false)
    expect(z.zones[0]).toMatchObject({ start: 1.4, end: 2 })
    expect(z.marker).toBe(2)
    expect(z.movable).toBe(false)
  })

  it('the payoff marker sits 2 s before the end until moved', () => {
    expect(editZones(style('speed_ramp'), edit({ style: 'speed_ramp' }), oneShot, 5, 2, false)).toMatchObject({ marker: 3, movable: true })
    expect(editZones(style('freeze_pop'), edit({ style: 'freeze_pop', payoff: 1.2 }), oneShot, 5, 2, false).marker).toBe(1.2)
  })

  it('flash and shake hits the first cut, unless the owner placed it', () => {
    expect(editZones(style('flash_shake'), edit({ style: 'flash_shake' }), twoShots, 4, 2, false).marker).toBe(2)
    expect(editZones(style('flash_shake'), edit({ style: 'flash_shake', payoff: 0.8 }), twoShots, 4, 2, false).marker).toBe(0.8)
  })

  it('the green screen asks for its background', () => {
    expect(editZones(style('green_screen'), edit({ style: 'green_screen' }), oneShot, 4, 2, false).problem).toMatch(/B-roll or a screenshot/)
  })

  it('the snap zoom and dolly zoom land at the payoff, and it moves', () => {
    expect(editZones(style('snap_zoom'), edit({ style: 'snap_zoom', payoff: 1 }), oneShot, 5, 2, false)).toMatchObject({ marker: 1, movable: true, zones: [{ start: 1, end: 2.25 }] })
    expect(editZones(style('dolly_zoom'), edit({ style: 'dolly_zoom' }), oneShot, 5, 2, false)).toMatchObject({ marker: 3, movable: true })
  })

  it('punch-ins follow the music when there is some, else a steady grid', () => {
    expect(editZones(style('punch_in'), edit({ style: 'punch_in' }), oneShot, 4, 2, true).zones).toHaveLength(1)
    expect(editZones(style('punch_in'), edit({ style: 'punch_in' }), oneShot, 4, 2, false).zones.length).toBeGreaterThan(1)
  })
})
