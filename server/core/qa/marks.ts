import type { SheetShot, Side, ViewsConfig } from '../../config/pipeline.js'
import { markExpectation, otherSide, subjectSide, type ImageSide, type Mark } from '../marks.js'
import type { Observation } from './perception.js'
import { describeFlaw, suggestsFixingFlaw, treatsFlawAsDefect } from '../realism.js'

// Deterministic QA for sheet shots. The vision model only reports what it
// sees, in image positions. This module turns that into the character's own
// sides, checks every mark against what the requested view must show, and
// gives a plain-language verdict: Post, Edit, Regenerate, or Uncertain.

export type QaCode =
  | 'mark_wrong_side' | 'mark_missing' | 'extra_jewelry' | 'wrong_view' | 'wrong_framing'
  | 'eye_color' | 'logo' | 'artifact' | 'uncertain' | 'face_drift' | 'too_similar' | 'identity_skipped' | 'identity_match'
  // Realism principle: smoothed or plastic skin is a defect; natural flaws
  // are kept and never reported as one.
  | 'skin_smoothed' | 'skin_plastic' | 'skin_real' | 'flaws_kept'
  // Recreate (owner, 2026-10-15): a face pass that made a new picture, and
  // a take that misses the video rule (a warning, never a rejection).
  | 'scene_changed' | 'take_rule'

export interface QaFinding {
  code: QaCode
  severity: 'fail' | 'warn' | 'info'
  message: string
  mark?: string
}

export type Verdict = 'post' | 'edit' | 'regenerate' | 'uncertain'

// Face-embedding similarity against the closest reference (SPEC 6).
export interface IdentityScore {
  kind: 'identity' | 'distinctness'
  score: number
  threshold: number
  against: string
}

export interface QaReport {
  verdict: Verdict
  summary: string
  findings: QaFinding[]
  // Review reason ids (config/review.yaml) that match the findings, so the
  // same fix actions run whether a person or QA rejected the shot.
  reasons: string[]
  detectedView: string | null
  identity?: IdentityScore | null
  // Fine skin detail after an upscale or edit, against its input.
  texture?: { ratio: number; smoothed: boolean; region: string; message: string } | null
  // When the sides are swapped: whether flipping the image horizontally
  // fixes it (free, no new generation, the face cannot drift), and the
  // report the flipped image would get.
  mirrorFix?: MirrorFix | null
}

export interface MirrorFix {
  available: boolean
  message: string
  report?: QaReport
}

const MIRROR_VIEW: Record<string, string> = {
  three_quarter_left: 'three_quarter_right', three_quarter_right: 'three_quarter_left',
  profile_left: 'profile_right', profile_right: 'profile_left',
}

const REASON: Partial<Record<QaCode, string>> = {
  mark_wrong_side: 'mark_wrong_side', mark_missing: 'mark_missing', wrong_view: 'wrong_view', wrong_framing: 'wrong_framing',
  extra_jewelry: 'extra_jewelry', logo: 'logo', face_drift: 'face_drift', eye_color: 'face_drift', too_similar: 'other', artifact: 'other',
  skin_smoothed: 'skin_smoothed', skin_plastic: 'skin_smoothed',
}

const REGENERATE: QaCode[] = ['mark_wrong_side', 'mark_missing', 'wrong_view', 'wrong_framing', 'face_drift', 'too_similar', 'skin_smoothed', 'skin_plastic']
// Measured by face embeddings, not the vision model, so they stand even when
// the vision model contradicted itself. Smoothed or plastic skin stands too,
// even when the face matches (Realism principle).
const IDENTITY: QaCode[] = ['face_drift', 'too_similar', 'skin_smoothed', 'skin_plastic']

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

// When the inspector contradicts itself on mark sides, say exactly where
// each mark belongs, in image terms, so a person can check it in a second.
export function sideCheckMessage(marks: Mark[], differences: string[], poss = 'their', o: { jewelry?: boolean } = {}): string {
  const skin = differences.includes('skin mark sides')
  const ears = differences.includes('ear jewelry sides') && o.jewelry !== false
  const named = marks.filter(m => (m.kind === 'jewelry' ? ears : skin))
  if (!named.length) return `The inspector gave inconsistent answers on a mirrored copy (${differences.join(', ')}), so a person should check the sides.`
  const where = named.map(m => `the ${m.name} belongs on ${poss} ${m.side} ${m.region}, the ${m.side === 'LEFT' ? 'right' : 'left'} side of the image when facing the camera`)
  return `Check the side yourself: ${where.join('; ')}. The automatic check gave different answers on a mirrored copy. If it is on the wrong side and nothing in the frame has text, Mirror fixes it for free.`
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
  // Findings from other checks (face identity), judged together.
  extraFindings?: QaFinding[]
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
  // Natural flaws (pores, freckles, redness, shine, flyaways, smile lines,
  // asymmetry, the mole) are required, never defects: an inspector that
  // lists one as an artifact, or suggests fixing one, is ignored on it.
  const kept: string[] = []
  for (const a of obs.artifacts) {
    if (treatsFlawAsDefect(a) || suggestsFixingFlaw(a)) kept.push(describeFlaw(a))
    else findings.push({ code: 'artifact', severity: 'warn', message: `Looks unreal: ${a}.` })
  }
  const flaws = [...(obs.skin?.flaws ?? []).map(describeFlaw), ...kept].filter(Boolean)
  if (flaws.length) findings.push({ code: 'flaws_kept', severity: 'info', message: `Natural flaws kept, as they should be: ${[...new Set(flaws)].join(', ')}.` })

  // 7b. Skin texture: plastic, waxy, airbrushed or porcelain skin fails even
  // when the face embedding matches.
  if (obs.skin?.texture === 'plastic') {
    findings.push({ code: 'skin_plastic', severity: 'fail', message: 'The skin looks plastic or airbrushed. Real skin texture with visible pores is required.' })
  } else if (obs.skin?.texture === 'slightly_smooth') {
    findings.push({ code: 'skin_smoothed', severity: 'warn', message: 'The skin looks slightly smoothed. Check for visible pores and texture before approving.' })
  } else if (obs.skin?.texture === 'real') {
    findings.push({ code: 'skin_real', severity: 'info', message: 'Real skin texture.' })
  }

  // 8. Did the inspector contradict itself on the mirrored copy?
  let contradicted = false
  if (input.mirrored) {
    const c = checkMirrorConsistency(obs, input.mirrored)
    if (!c.consistent) {
      contradicted = true
      findings.push({ code: 'uncertain', severity: 'warn', message: sideCheckMessage(input.marks, c.differences, input.pronoun) })
    }
  }

  findings.push(...(input.extraFindings ?? []))
  return finalize(findings, detectedId, contradicted)
}

// `regenerate` overrides which failures call for a new generation; scenes fix
// more with a one-change edit than sheet shots do.
export function finalize(findings: QaFinding[], detectedView: string | null, forceUncertain = false, opts: { regenerate?: QaCode[] } = {}): QaReport {
  const fails = findings.filter(f => f.severity === 'fail')
  const warns = findings.filter(f => f.severity === 'warn')
  const regenerateCodes = opts.regenerate ?? REGENERATE
  let verdict: Verdict
  if (fails.some(f => IDENTITY.includes(f.code))) verdict = 'regenerate'
  else if (forceUncertain) verdict = 'uncertain'
  else if (fails.some(f => regenerateCodes.includes(f.code))) verdict = 'regenerate'
  else if (fails.length) verdict = 'edit'
  else if (warns.length) verdict = 'uncertain'
  else verdict = 'post'

  const summary = {
    post: 'Looks right. Ready to approve.',
    regenerate: `Regenerate: ${(fails.find(f => IDENTITY.includes(f.code)) ?? fails.find(f => regenerateCodes.includes(f.code)))?.message ?? ''}`,
    edit: `Fix with an edit: ${fails.map(f => f.message).join(' ')}`,
    // A side or angle doubt comes first: marks are the identity.
    uncertain: `Needs your eye: ${(warns.find(f => f.code === 'uncertain') ?? warns.find(f => f.code.startsWith('mark')) ?? warns[0] ?? fails[0])?.message ?? ''}`,
  }[verdict].trim()

  const reasons = [...new Set(findings.filter(f => f.severity !== 'info').map(f => REASON[f.code]).filter((r): r is string => !!r))]
  return { verdict, summary, findings, reasons, detectedView }
}

// A shot whose marks came back on the wrong side can often be fixed by
// flipping it horizontally (Callie's file: "mirror the image horizontally if
// there is no text in frame"). The flip is checked by re-evaluating the
// mirrored inspection: every mark must land on its own side, the view must
// match, and nothing else may still call for a regenerate.
const SIDE_CODES: QaCode[] = ['mark_wrong_side', 'wrong_view']

export function mirrorFixFor(input: EvaluateInput, report: QaReport): MirrorFix | null {
  if (!report.findings.some(f => f.severity === 'fail' && SIDE_CODES.includes(f.code))) return null
  if (input.observation.text_or_logos.length) {
    return { available: false, message: 'Flipping would mirror the text in the frame, so this needs a one-change edit or a regenerate.' }
  }
  const flipped = evaluateSheetShot({ ...input, observation: mirrorObservation(input.observation), mirrored: undefined })
  if (flipped.findings.some(f => f.severity === 'fail' && (SIDE_CODES.includes(f.code) || f.code === 'mark_missing'))) {
    return { available: false, message: 'Flipping would not put every mark on its own side.' }
  }
  if (flipped.verdict === 'regenerate') {
    return { available: false, message: `Flipping fixes the sides, but the shot still needs a regenerate: ${flipped.summary.replace(/^Regenerate: /, '')}` }
  }
  return {
    available: true,
    message: 'Flipping the image horizontally puts every mark on its own side. Free, no new generation, and the face cannot drift.',
    report: flipped,
  }
}
