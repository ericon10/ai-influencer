import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../config/load.js'
import { evaluateScene, sceneMirrorFix, type SceneQaInput } from './scene.js'
import type { Observation } from './perception.js'
import type { Mark } from '../marks.js'

// Scene QA (SPEC 6, Stage 7): what a one-change edit can fix is an edit,
// face drift and plastic skin regenerate, and the cuff on the wrong ear is
// mirrored for free when there is no text in the frame.

const { views } = loadConfig().pipeline
const marks: Mark[] = [
  { name: 'mole', description: 'small mole', side: 'LEFT', region: 'brow', kind: 'skin', subtle: true },
  { name: 'ear cuff', description: 'gold double-band ear cuff', side: 'LEFT', region: 'ear', kind: 'jewelry', subtle: false },
]

// Facing the camera: her LEFT ear is on the image right.
const base: Observation = {
  pose: 'frontal', nose: 'toward_camera', confidence: 0.9, framing: 'waist_up', standing: true,
  ears: [{ image_side: 'image_right', jewelry: true, jewelry_description: 'gold double-band ear cuff' }, { image_side: 'image_left', jewelry: false, jewelry_description: '' }],
  skin_marks: [], other_jewelry: [], eye_color: 'hazel', text_or_logos: [], artifacts: [],
  skin: { texture: 'real', flaws: ['visible pores', 'faint freckles'] }, notes: '',
}

const judge = (obs: Partial<Observation>, over: Partial<SceneQaInput> = {}) => {
  const input: SceneQaInput = { views, marks, jewelryAsked: 'a thin gold chain necklace', framing: 'waist_up', observation: { ...base, ...obs }, pronoun: 'her', ...over }
  const report = evaluateScene(input)
  return { report, input }
}

describe('scene QA', () => {
  it('posts a clean scene and keeps her natural flaws', () => {
    const { report } = judge({})
    expect(report.verdict).toBe('post')
    expect(report.findings.find(f => f.code === 'flaws_kept')?.message).toMatch(/visible pores/)
    expect(report.edits).toEqual([])
  })

  it('a logo is a one-change edit, never a regenerate (SPEC 5.3 rule 23)', () => {
    const { report } = judge({ text_or_logos: ['white swoosh logo on the cup in the hand at image_left'] })
    expect(report.verdict).toBe('edit')
    expect(report.edits).toEqual([{ code: 'logo', change: 'Remove the white swoosh logo on the cup in the hand at image_left, leaving that surface plain and unbranded', face: false }])
  })

  it('jewelry the scene asked for is fine; anything else is extra', () => {
    expect(judge({ other_jewelry: [{ image_side: 'center', description: 'thin gold chain necklace' }] }).report.verdict).toBe('post')
    const { report } = judge({ other_jewelry: [{ image_side: 'image_left', description: 'a chunky silver bracelet' }] })
    expect(report.verdict).toBe('edit')
    expect(report.edits![0]!.change).toBe('Remove the chunky silver bracelet, on the left of the image')
  })

  it('the cuff on the wrong ear: mirror for free without text, else one edit', () => {
    const flipped: Partial<Observation> = {
      ears: [{ image_side: 'image_left', jewelry: true, jewelry_description: 'gold double-band ear cuff' }, { image_side: 'image_right', jewelry: false, jewelry_description: '' }],
    }
    const { report, input } = judge(flipped)
    expect(report.verdict).toBe('edit')
    expect(report.findings.find(f => f.code === 'mark_wrong_side')!.message).toMatch(/RIGHT ear/)
    expect(sceneMirrorFix(input, report)).toMatchObject({ available: true })
    expect(report.edits![0]!.change).toMatch(/^Remove the gold double-band ear cuff from her RIGHT ear/)

    const withText = judge({ ...flipped, text_or_logos: ['CAFE sign above the door'] })
    expect(sceneMirrorFix(withText.input, withText.report)).toMatchObject({ available: false })
  })

  it('earrings asked for on both ears are not a wrong-side cuff', () => {
    const both: Partial<Observation> = {
      ears: [{ image_side: 'image_right', jewelry: true, jewelry_description: 'gold ear cuff and small gold hoop' }, { image_side: 'image_left', jewelry: true, jewelry_description: 'small gold hoop earring' }],
    }
    expect(judge(both, { jewelryAsked: 'small gold hoop earrings' }).report.verdict).toBe('post')
    expect(judge(both, { jewelryAsked: '' }).report.findings.map(f => f.code)).toContain('extra_jewelry')
  })

  it('face drift and plastic skin always regenerate, and offer no edits (rule 25, Realism)', () => {
    const drift = judge({ text_or_logos: ['logo on cap'] }, { extraFindings: [{ code: 'face_drift', severity: 'fail', message: 'The face does not match REF-00.' }] }).report
    expect(drift.verdict).toBe('regenerate')
    expect(drift.edits).toEqual([])
    expect(judge({ skin: { texture: 'plastic', flaws: [] } }).report.verdict).toBe('regenerate')
  })

  it('a framing mismatch and an unclear angle go to a person, not a fail', () => {
    const { report } = judge({ framing: 'chest_up' }, { framing: 'full_body' })
    expect(report.verdict).toBe('uncertain')
    expect(judge({ pose: 'unclear', nose: 'unclear', confidence: 0.3 }).report.verdict).toBe('post')
  })
})
