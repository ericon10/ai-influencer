import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../config/load.js'
import { evaluateSheetShot, checkMirrorConsistency, mirrorFixFor, mirrorObservation } from './marks.js'
import { parseObservation, type Observation } from './perception.js'
import type { Mark } from '../marks.js'

// Acceptance (SPEC 12.5, 14): QA must flag a mirrored mark, such as Callie's
// ear cuff showing on her RIGHT ear in the right-profile shot REF-04. This
// test was written before the QA logic.

const FIX = join(process.cwd(), 'fixtures', 'callie')
const callie = JSON.parse(readFileSync(join(FIX, 'appendix-a.json'), 'utf8')) as { marks: Mark[]; eyes: string }
const perception = (name: string): Observation => parseObservation(JSON.parse(readFileSync(join(FIX, 'perceptions', `${name}.json`), 'utf8')))
const config = loadConfig()
const shot = (id: string) => config.pipeline.sheet.shots.find(s => s.id === id)!

const judge = (refId: string, obs: Observation) =>
  evaluateSheetShot({ shot: shot(refId), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: obs })

describe('mirrored-mark QA (Callie acceptance)', () => {
  it('flags REF-04 with the ear cuff on the wrong ear and asks for a regenerate', () => {
    const report = judge('REF-04', perception('REF-04-mirrored'))
    expect(report.verdict).toBe('regenerate')
    const wrongSide = report.findings.find(f => f.code === 'mark_wrong_side')
    expect(wrongSide).toBeDefined()
    expect(wrongSide!.mark).toBe('ear cuff')
    expect(wrongSide!.message).toMatch(/RIGHT ear/)
    expect(wrongSide!.message).toMatch(/LEFT ear/)
    expect(report.reasons).toContain('mark_wrong_side')
  })

  it('flags a horizontally flipped REF-04 as the wrong (mirrored) side', () => {
    const report = judge('REF-04', perception('REF-04-flipped'))
    expect(report.verdict).toBe('regenerate')
    expect(report.findings.map(f => f.code)).toContain('wrong_view')
    expect(report.findings.find(f => f.code === 'wrong_view')!.message).toMatch(/mirror/i)
    expect(report.reasons).toContain('wrong_view')
  })

  it('passes a correct REF-04: the visible right ear is bare', () => {
    const report = judge('REF-04', perception('REF-04'))
    expect(report.findings.filter(f => f.severity === 'fail')).toEqual([])
    expect(report.verdict).toBe('post')
  })

  it('passes a correct REF-03: the cuff is on the visible left ear', () => {
    const report = judge('REF-03', perception('REF-03'))
    expect(report.findings.filter(f => f.severity === 'fail')).toEqual([])
    expect(report.verdict).toBe('post')
  })

  it('passes REF-00, where her LEFT side appears on the image right', () => {
    const report = judge('REF-00', perception('REF-00'))
    expect(report.findings.filter(f => f.severity === 'fail')).toEqual([])
    expect(report.verdict).toBe('post')
  })

  it('flags REF-00 when the cuff and mole sit on the image left (her RIGHT side)', () => {
    const report = judge('REF-00', mirrorObservation(perception('REF-00')))
    expect(report.verdict).toBe('regenerate')
    const codes = report.findings.filter(f => f.code === 'mark_wrong_side').map(f => f.mark).sort()
    expect(codes).toEqual(['ear cuff', 'mole'])
  })

  it('flags a missing cuff in a view where it must show', () => {
    const obs = perception('REF-03')
    obs.ears = [{ image_side: 'image_right', jewelry: false, jewelry_description: '' }]
    const report = judge('REF-03', obs)
    expect(report.findings.find(f => f.code === 'mark_missing')?.mark).toBe('ear cuff')
    expect(report.verdict).toBe('regenerate')
  })

  it('only warns when a subtle skin mark is not seen (presence, not prominence)', () => {
    const obs = perception('REF-03')
    obs.skin_marks = []
    const report = judge('REF-03', obs)
    const missing = report.findings.find(f => f.mark === 'mole')
    expect(missing).toMatchObject({ code: 'mark_missing', severity: 'warn' })
    expect(report.verdict).toBe('uncertain')
  })

  it('treats a chest-up shot that came back seated as wrong framing', () => {
    const obs = perception('REF-04')
    obs.framing = 'seated'
    const report = judge('REF-04', obs)
    expect(report.findings.map(f => f.code)).toContain('wrong_framing')
    expect(report.verdict).toBe('regenerate')
  })

  it('routes a logo on an otherwise correct shot to an edit, not a regenerate', () => {
    const obs = perception('REF-04')
    obs.text_or_logos = ['small brand logo on the t-shirt']
    const report = judge('REF-04', obs)
    expect(report.verdict).toBe('edit')
    expect(report.reasons).toContain('logo')
  })
})

describe('mirror consistency (catches inspector left/right confusion)', () => {
  it('accepts answers that mirror correctly', () => {
    const obs = perception('REF-04-mirrored')
    expect(checkMirrorConsistency(obs, mirrorObservation(obs)).consistent).toBe(true)
  })

  it('rejects answers that do not mirror', () => {
    const obs = perception('REF-04-mirrored')
    const notMirrored = structuredClone(obs)
    expect(checkMirrorConsistency(obs, notMirrored).consistent).toBe(false)
  })

  it('downgrades a verdict to uncertain when the inspector contradicts itself', () => {
    const obs = perception('REF-04')
    const report = evaluateSheetShot({
      shot: shot('REF-04'), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes,
      observation: obs, mirrored: structuredClone(obs),
    })
    expect(report.verdict).toBe('uncertain')
    expect(report.findings.map(f => f.code)).toContain('uncertain')
  })
})

// Callie's file: "Ear cuff on the wrong ear: mirror the image horizontally if
// there is no text in frame (free, no drift)." The flip is offered only when
// it actually fixes every side.
describe('free mirror fix', () => {
  const input = (refId: string, obs: Observation) => ({ shot: shot(refId), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: obs })
  const fixFor = (refId: string, obs: Observation) => mirrorFixFor(input(refId, obs), evaluateSheetShot(input(refId, obs)))

  it('offers the flip for a REF-04 that came back mirrored, and the flipped shot passes', () => {
    const fix = fixFor('REF-04', perception('REF-04-flipped'))
    expect(fix?.available).toBe(true)
    expect(fix!.report!.verdict).toBe('post')
    expect(fix!.report!.detectedView).toBe('profile_right')
  })

  it('offers the flip for a front shot with both marks on her RIGHT side', () => {
    const fix = fixFor('REF-00', mirrorObservation(perception('REF-00')))
    expect(fix?.available).toBe(true)
    expect(fix!.report!.findings.filter(f => f.code === 'mark_wrong_side')).toEqual([])
  })

  it('does not offer it when only the cuff is wrong: flipping would move the mole', () => {
    const obs = perception('REF-00')
    obs.ears = obs.ears.map(e => ({ ...e, jewelry: !e.jewelry, jewelry_description: e.jewelry ? '' : 'gold double-band ear cuff' }))
    const report = evaluateSheetShot(input('REF-00', obs))
    expect(report.findings.some(f => f.code === 'mark_wrong_side' && f.mark === 'ear cuff')).toBe(true)
    expect(mirrorFixFor(input('REF-00', obs), report)).toMatchObject({ available: false })
  })

  it('does not offer it for a right profile with the cuff on the visible right ear', () => {
    // Flipping that image would turn it into a left profile.
    expect(fixFor('REF-04', perception('REF-04-mirrored'))).toMatchObject({ available: false })
  })

  it('does not offer it when there is text in the frame, and not for a correct shot', () => {
    const obs = perception('REF-04-flipped')
    obs.text_or_logos = ['a shop sign']
    expect(fixFor('REF-04', obs)).toMatchObject({ available: false, message: expect.stringMatching(/text/) })
    expect(fixFor('REF-04', perception('REF-04'))).toBeNull()
  })
})

// Rule zero, the Realism principle: natural flaws are required, never
// defects; plastic skin fails even when the face matches.
describe('QA and real skin', () => {
  const correct = () => perception('REF-00')
  const match = [{ code: 'identity_match' as const, severity: 'info' as const, message: 'Same person as REF-00 (0.71).' }]

  it('never reports pores, freckles, redness, shine, flyaways, smile lines, asymmetry or the mole as defects', () => {
    const obs = { ...correct(), artifacts: ['visible pores on the nose', 'freckles across the cheeks', 'slight redness', 'shine on the forehead', 'flyaway hairs', 'smile lines', 'slight facial asymmetry', 'remove the small mole above the brow'] }
    const report = evaluateSheetShot({ shot: shot('REF-00'), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: obs })
    expect(report.findings.filter(f => f.code === 'artifact')).toEqual([])
    expect(report.verdict).toBe('post')
    expect(report.findings.find(f => f.code === 'flaws_kept')?.severity).toBe('info')
    // No finding ever suggests fixing a flaw.
    for (const f of report.findings) expect(f.message).not.toMatch(/\b(remove|smooth|fix|even out)\b.*\b(pores?|freckles?|mole|redness|lines)\b/i)
  })

  it('still reports things a real camera never captures', () => {
    const obs = { ...correct(), artifacts: ['melted left ear', 'six fingers on the right hand'] }
    const report = evaluateSheetShot({ shot: shot('REF-00'), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: obs })
    expect(report.findings.filter(f => f.code === 'artifact')).toHaveLength(2)
  })

  it('rejects plastic, waxy, airbrushed or porcelain skin even when the face embedding matches', () => {
    const obs = { ...correct(), skin: { texture: 'plastic' as const, flaws: [] } }
    const report = evaluateSheetShot({ shot: shot('REF-00'), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: obs, extraFindings: match })
    expect(report.verdict).toBe('regenerate')
    expect(report.reasons).toContain('skin_smoothed')
    // It stands even when the inspector contradicted itself on the mirror.
    const contradicted = evaluateSheetShot({ shot: shot('REF-00'), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: obs, mirrored: obs, extraFindings: match })
    expect(contradicted.verdict).toBe('regenerate')
  })

  it('asks a person to check slightly smoothed skin, and passes real skin', () => {
    const smooth = evaluateSheetShot({ shot: shot('REF-00'), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: { ...correct(), skin: { texture: 'slightly_smooth', flaws: [] } } })
    expect(smooth.verdict).toBe('uncertain')
    const real = evaluateSheetShot({ shot: shot('REF-00'), views: config.pipeline.views, marks: callie.marks, eyeColor: callie.eyes, observation: { ...correct(), skin: { texture: 'real', flaws: ['visible pores', 'light freckles'] } } })
    expect(real.verdict).toBe('post')
  })

  it('tells the vision model that flaws are required and plastic skin is the defect', () => {
    const t = config.pipeline.templates.qa_perception
    expect(t.system).toMatch(/Pores, freckles, slight redness, uneven tone,\s+shine, flyaway hairs, smile lines, asymmetry and small moles are expected\s+and required/)
    expect(t.system).toMatch(/never\s+suggest removing, fixing or smoothing them/)
    expect(t.prompt).toMatch(/Skin texture/)
  })
})
