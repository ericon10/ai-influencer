import type { SheetShot, Side, ViewsConfig } from '../../config/pipeline'
import { markExpectation, otherSide, subjectSide, type ImageSide, type Mark } from '../marks'
import type { Observation } from './perception'

// Deterministic QA for sheet shots. The vision model only reports what it
// sees, in image positions. This module turns that into the character's own
// sides, checks every mark against what the requested view must show, and
// gives a plain-language verdict: Post, Edit, Regenerate, or Uncertain.

export type QaCode =
  | 'mark_wrong_side' | 'mark_missing' | 'extra_jewelry' | 'wrong_view' | 'wrong_framing'
  | 'eye_color' | 'logo' | 'artifact' | 'uncertain' | 'face_drift' | 'too_similar' | 'identity_skipped'

export interface QaFinding {
  code: QaCode
  severity: 'fail' | 'warn' | 'info'
  message: string
  mark?: string
}

export type Verdict = 'post' | 'edit' | 'regenerate' | 'uncertain'

export interface QaReport {
  verdict: Verdict
  summary: string
  findings: QaFinding[]
  // Review reason ids (config/review.yaml) that match the findings, so the
  // same fix actions run whether a person or QA rejected the shot.
  reasons: string[]
  detectedView: string | null
}

const MIRROR_VIEW: Record<string, string> = {
  three_quarter_left: 'three_quarter_right', three_quarter_right: 'three_quarter_left',
  profile_left: 'profile_right', profile_right: 'profile_left',
}

const REASON: Partial<Record<QaCode, string>> = {
  mark_wrong_side: 'mark_wrong_side', mark_missing: 'mark_missing', wrong_view: 'wrong_view', wrong_framing: 'wrong_framing',
  extra_jewelry: 'extra_jewelry', logo: 'logo', face_drift: 'face_drift', eye_color: 'face_drift', too_similar: 'other', artifact: 'other',
}

const REGENERATE: QaCode[] = ['mark_wrong_side', 'mark_missing', 'wrong_view', 'wrong_framing', 'face_drift', 'too_similar']

const REGION_WORDS: Record<string, RegExp> = {
  brow: /brow/i, eye: /eye(?!brow)|lid|lash/i, cheek: /cheek/i, lip: /lip|mouth/i, jaw: /jaw/i, nose: /nose|nostril/i,
  chin: /chin/i, forehead: /forehead/i, temple: /temple/i, neck: /neck|throat/i,
}

export function detectView(obs: Observation): string | null {
  if (obs.pose === 'frontal') return 'front'
  if (obs.pose === 'back') return 'back'
  if (obs.pose === 'three_quarter' || obs.pose === 'profile') {
    if (obs.nose !== 'image_left' && obs.nose !== 'image_right') return null
    // A face pointing to the left edge of the frame shows the character's LEFT side.
    const side = obs.nose === 'image_left' ? 'left' : 'right'
    return obs.pose === 'profile' ? `profile_${side}` : `three_quarter_${side}`
  }
  return null
}

const flip = <T extends string>(s: T): T => (s === 'image_left' ? 'image_right' : s === 'image_right' ? 'image_left' : s) as T

// What a correct inspector would answer for the horizontally flipped image.
export function mirrorObservation(obs: Observation): Observation {
  return {
    ...structuredClone(obs),
    nose: flip(obs.nose),
    ears: obs.ears.map(e => ({ ...e, image_side: flip(e.image_side) })),
    skin_marks: obs.skin_marks.map(m => ({ ...m, image_side: flip(m.image_side) })),
    other_jewelry: obs.other_jewelry.map(j => ({ ...j, image_side: flip(j.image_side) })),
  }
}

// Vision models sometimes confuse image left and right. Asking again on a
// mirrored copy and requiring mirrored answers catches that.
export function checkMirrorConsistency(original: Observation, fromMirroredImage: Observation): { consistent: boolean; differences: string[] } {
  const expected = mirrorObservation(original)
  const differences: string[] = []
  if (expected.pose !== fromMirroredImage.pose) differences.push('head pose')
  if (expected.nose !== fromMirroredImage.nose) differences.push('facing direction')
  const ears = (o: Observation) => o.ears.map(e => `${e.image_side}:${e.jewelry}`).sort().join(',')
  if (ears(expected) !== ears(fromMirroredImage)) differences.push('ear jewelry sides')
  const marks = (o: Observation) => o.skin_marks.map(m => m.image_side).sort().join(',')
  if (marks(expected) !== marks(fromMirroredImage)) differences.push('skin mark sides')
  return { consistent: differences.length === 0, differences }
}

const COLOR_FAMILIES: Record<string, string[]> = {
  brown: ['brown', 'hazel', 'amber', 'chestnut', 'chocolate', 'dark'],
  blue: ['blue', 'steel'],
  green: ['green', 'hazel', 'emerald'],
  gray: ['gray', 'grey', 'steel'],
}

function colorFamilies(text: string): Set<string> {
  const t = text.toLowerCase()
  const out = new Set<string>()
  for (const [family, words] of Object.entries(COLOR_FAMILIES)) if (words.some(w => t.includes(w))) out.add(family)
  return out
}

export interface EvaluateInput {
  shot: SheetShot
  views: ViewsConfig
  marks: Mark[]
  eyeColor?: string
  observation: Observation
  // The inspector's answer for the mirrored image (optional second pass).
  mirrored?: Observation
  pronoun?: string // possessive, for messages: "her", "his", "their"
}

export function evaluateSheetShot(input: EvaluateInput): QaReport {
  const { shot, views, marks, observation: obs } = input
  const poss = input.pronoun ?? 'their'
  const findings: QaFinding[] = []
  const expected = views.views[shot.view]!
  const detectedId = detectView(obs)
  const detected = detectedId ? views.views[detectedId] : undefined

  // 1. Is it the requested angle, or a mirrored copy of it?
  if (!detectedId || obs.confidence < 0.5) {
    findings.push({ code: 'uncertain', severity: 'warn', message: 'The head angle is unclear, so the mark sides could not be checked reliably.' })
  } else if (detectedId !== shot.view) {
    const mirrored = MIRROR_VIEW[shot.view] === detectedId
    findings.push({
      code: 'wrong_view', severity: 'fail',
      message: mirrored
        ? `Expected "${expected.label}", but the image shows "${detected!.label}". It looks mirrored.`
        : `Expected "${expected.label}", but the image shows "${detected!.label}".`,
    })
  }

  // 2. Translate observed positions into the character's own sides, using
  // the angle the image actually shows.
  const view = detected ?? expected
  const sideOf = (img: ImageSide | 'center'): Side | null => {
    if (img === 'center') return null
    if (obs.pose === 'profile' && view.turn !== 'none') return view.turn
    return subjectSide(img, view.facing)
  }
  const earJewelry = new Map<Side, string>()
  for (const ear of obs.ears) {
    const side = sideOf(ear.image_side)
    if (side && ear.jewelry) earJewelry.set(side, ear.jewelry_description || 'jewelry')
  }
  const explainedEars = new Set<Side>()

  // 3. Check every mark against what this view must, may, or must not show.
  for (const mark of marks) {
    const expectation = markExpectation(view, mark)
    const other = otherSide(mark.side)
    if (mark.kind === 'jewelry' && mark.region === 'ear') {
      const otherHasOwnMark = marks.some(m => m !== mark && m.kind === 'jewelry' && m.region === 'ear' && m.side === other)
      if (earJewelry.has(other) && !otherHasOwnMark) {
        explainedEars.add(other)
        findings.push({ code: 'mark_wrong_side', severity: 'fail', mark: mark.name, message: `The ${mark.description} shows on ${poss} ${other} ear. It belongs on ${poss} ${mark.side} ear only.` })
      } else if (expectation === 'required' && !earJewelry.has(mark.side)) {
        findings.push({ code: 'mark_missing', severity: 'fail', mark: mark.name, message: `The ${mark.description} should show on ${poss} ${mark.side} ear but is not visible.` })
      }
      if (earJewelry.has(mark.side)) explainedEars.add(mark.side)
      continue
    }
    const words = REGION_WORDS[mark.region] ?? new RegExp(mark.region, 'i')
    const seen = obs.skin_marks.filter(m => words.test(m.location) || words.test(m.description)).map(m => sideOf(m.image_side))
    const onOwn = seen.includes(mark.side)
    const otherHasOwnMark = marks.some(m => m !== mark && m.kind === mark.kind && m.region === mark.region && m.side === other)
    if (!onOwn && seen.includes(other) && !otherHasOwnMark) {
      findings.push({ code: 'mark_wrong_side', severity: 'fail', mark: mark.name, message: `The ${mark.description} shows by ${poss} ${other} ${mark.region}. It belongs by ${poss} ${mark.side} ${mark.region} only.` })
    } else if (expectation === 'required' && !onOwn) {
      // Marks are subtle by design; QA confirms presence, not prominence
      // (SPEC 5.1 rule 12), so a subtle mark not seen goes to a person.
      findings.push({
        code: 'mark_missing', severity: mark.subtle === false ? 'fail' : 'warn', mark: mark.name,
        message: `The ${mark.description} by ${poss} ${mark.side} ${mark.region} was not seen. It is subtle, so check it yourself.`,
      })
    }
  }

  // 4. Jewelry the character file does not have.
  for (const [side, desc] of earJewelry) {
    if (!explainedEars.has(side)) findings.push({ code: 'extra_jewelry', severity: 'fail', message: `Extra jewelry on ${poss} ${side} ear (${desc}) that is not in the character file.` })
  }
  const hasOtherJewelryMark = marks.some(m => m.kind === 'jewelry' && m.region !== 'ear')
  if (!hasOtherJewelryMark) {
    for (const j of obs.other_jewelry) findings.push({ code: 'extra_jewelry', severity: 'fail', message: `Extra jewelry: ${j.description}.` })
  }

  // 5. Framing (SPEC 6: "seated when chest-up asked").
  if (shot.framing === 'chest_up') {
    if (['seated', 'three_quarter_length', 'full_body'].includes(obs.framing)) {
      findings.push({ code: 'wrong_framing', severity: 'fail', message: `Asked for chest-up, got ${obs.framing.replace(/_/g, ' ')}.` })
    } else if (obs.framing === 'waist_up') {
      findings.push({ code: 'wrong_framing', severity: 'warn', message: 'Asked for chest-up; this is closer to waist-up.' })
    }
  } else if (shot.framing === 'full_body' && (obs.framing !== 'full_body' || !obs.standing)) {
    findings.push({ code: 'wrong_framing', severity: 'fail', message: `Asked for a standing full-body shot, got ${obs.framing.replace(/_/g, ' ')}${obs.standing ? '' : ', not standing'}.` })
  }

  // 6. Eye color drift (lighting fools models, so a person decides).
  if (input.eyeColor && view.facing === 'camera' && obs.eye_color && !/unknown|not visible|unclear/i.test(obs.eye_color)) {
    const want = colorFamilies(input.eyeColor), got = colorFamilies(obs.eye_color)
    if (want.size && got.size && ![...want].some(f => got.has(f))) {
      findings.push({ code: 'eye_color', severity: 'warn', message: `Eye color reads as ${obs.eye_color}; the card says ${input.eyeColor}.` })
    }
  }

  // 7. Logos, printed text, impossible details.
  for (const t of obs.text_or_logos) findings.push({ code: 'logo', severity: 'fail', message: `Logo or readable text: ${t}.` })
  for (const a of obs.artifacts) findings.push({ code: 'artifact', severity: 'warn', message: `Looks unreal: ${a}.` })

  // 8. Did the inspector contradict itself on the mirrored copy?
  let contradicted = false
  if (input.mirrored) {
    const c = checkMirrorConsistency(obs, input.mirrored)
    if (!c.consistent) {
      contradicted = true
      findings.push({ code: 'uncertain', severity: 'warn', message: `The inspector gave inconsistent answers on a mirrored copy (${c.differences.join(', ')}), so a person should check the sides.` })
    }
  }

  return finalize(findings, detectedId, contradicted)
}

export function finalize(findings: QaFinding[], detectedView: string | null, forceUncertain = false): QaReport {
  const fails = findings.filter(f => f.severity === 'fail')
  const warns = findings.filter(f => f.severity === 'warn')
  let verdict: Verdict
  if (forceUncertain) verdict = 'uncertain'
  else if (fails.some(f => REGENERATE.includes(f.code))) verdict = 'regenerate'
  else if (fails.length) verdict = 'edit'
  else if (warns.length) verdict = 'uncertain'
  else verdict = 'post'

  const summary = {
    post: 'Looks right. Ready to approve.',
    regenerate: `Regenerate: ${fails.find(f => REGENERATE.includes(f.code))?.message ?? ''}`,
    edit: `Fix with an edit: ${fails.map(f => f.message).join(' ')}`,
    uncertain: `Needs your eye: ${(warns[0] ?? fails[0])?.message ?? ''}`,
  }[verdict].trim()

  const reasons = [...new Set(findings.filter(f => f.severity !== 'info').map(f => REASON[f.code]).filter((r): r is string => !!r))]
  return { verdict, summary, findings, reasons, detectedView }
}
