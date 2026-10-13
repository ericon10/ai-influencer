import type { Side, ViewsConfig } from '../../config/pipeline.js'
import { otherSide, subjectSide, type ImageSide, type Mark } from '../marks.js'
import { describeFlaw, suggestsFixingFlaw, treatsFlawAsDefect } from '../realism.js'
import { checkMirrorConsistency, detectView, finalize, mirrorObservation, type MirrorFix, type QaCode, type QaFinding, type QaReport } from './marks.js'
import type { Observation } from './perception.js'

// QA for scene stills (SPEC 6, Stage 7). The vision model reports what it
// sees in image positions; this module turns that into the character's own
// sides and a plain verdict. QA is advice with one-click fixes (owner ruling
// G1): any angle is fine, jewelry varies freely, and nothing here blocks a
// pick. Face drift is a strong warning; plastic skin fails under the fixed
// Realism principle.

// The fix for each finding, ready to run as a one-change edit.
export interface EditSuggestion { code: QaCode; change: string; face: boolean }

export interface SceneReport extends QaReport {
  edits?: EditSuggestion[]
}

// QA advice switched on (default rules qa-logos, qa-extra-jewelry,
// qa-mirror). QA never blocks a pick; only fixed rules can.
export interface SceneQaRules { logos: boolean; jewelry: boolean; mirror: boolean }

export interface SceneQaInput {
  views: ViewsConfig
  marks: Mark[]
  // What the scene asked for, so requested jewelry is not "extra".
  jewelryAsked: string
  rules?: SceneQaRules
  framing: string
  eyeColor?: string
  observation: Observation
  mirrored?: Observation
  pronoun?: string
  extraFindings?: QaFinding[]
}

const SCENE_REGENERATE: QaCode[] = ['face_drift', 'too_similar', 'skin_smoothed', 'skin_plastic']
const JEWELRY_WORDS = ['necklace', 'chain', 'pendant', 'choker', 'bracelet', 'bangle', 'cuff', 'ring', 'earring', 'hoop', 'stud', 'anklet', 'watch', 'brooch', 'piercing']

function jewelryKind(text: string): string | null {
  const t = text.toLowerCase()
  return JEWELRY_WORDS.find(w => new RegExp(`\\b${w}s?\\b`).test(t)) ?? null
}

const where = (side: ImageSide | 'center') => (side === 'center' ? 'in the middle of the image' : `on the ${side.replace('image_', '')} of the image`)

export function evaluateScene(input: SceneQaInput): SceneReport {
  const { observation: obs, marks } = input
  const poss = input.pronoun ?? 'their'
  const findings: QaFinding[] = []
  const edits: EditSuggestion[] = []
  const detectedId = detectView(obs)
  const view = detectedId ? input.views.views[detectedId] : undefined

  // Ear jewelry by the character's own side, when the angle is clear.
  const sideOf = (img: ImageSide | 'center'): Side | null => {
    if (img === 'center' || !view || obs.confidence < 0.5) return null
    if (obs.pose === 'profile' && view.turn !== 'none') return view.turn
    return subjectSide(img, view.facing)
  }
  const earJewelry = new Map<Side, { desc: string; image: ImageSide }>()
  for (const ear of obs.ears) {
    const side = sideOf(ear.image_side)
    if (side && ear.jewelry) earJewelry.set(side, { desc: ear.jewelry_description || 'earring', image: ear.image_side })
  }
  const explained = new Set<Side>()
  const asked = input.jewelryAsked.toLowerCase()
  const rules: SceneQaRules = { logos: true, jewelry: true, mirror: true, ...(input.rules ?? {}) }

  // Signature jewelry (a jewelry mark such as an ear cuff) is optional per
  // scene (owner ruling G1): never flagged as missing or added. When the
  // scene asks for it and it lands only on the other ear, that is advice
  // with a free mirror or a one-click edit.
  for (const mark of marks) {
    if (mark.kind !== 'jewelry' || mark.region !== 'ear') continue
    const markKind = jewelryKind(mark.description)
    for (const [side, j] of earJewelry) if (markKind && jewelryKind(j.desc) === markKind) explained.add(side)
    const worn = !!markKind && asked.includes(markKind)
    if (!worn || !rules.jewelry) continue
    const other = otherSide(mark.side)
    const wrong = earJewelry.get(other)
    const onOwn = earJewelry.get(mark.side)
    if (wrong && jewelryKind(wrong.desc) === markKind && !(onOwn && jewelryKind(onOwn.desc) === markKind) && !marks.some(m => m !== mark && m.region === 'ear' && m.side === other)) {
      findings.push({ code: 'mark_wrong_side', severity: 'warn', mark: mark.name, message: `The ${mark.description} shows on ${poss} ${other} ear; it usually sits on ${poss} ${mark.side} ear. Leave it, mirror the still, or move it with an edit.` })
      edits.push({ code: 'mark_wrong_side', change: `Remove the ${wrong.desc} from ${poss} ${other} ear, ${where(wrong.image)}`, face: false })
    }
  }

  // Jewelry the scene did not ask for: a note with a one-click edit, never
  // a fail (jewelry varies freely).
  if (rules.jewelry) {
    for (const [side, j] of earJewelry) {
      if (explained.has(side)) continue
      const kind = jewelryKind(j.desc)
      if (kind && asked.includes(kind)) continue
      findings.push({ code: 'extra_jewelry', severity: 'info', message: `Jewelry the scene did not ask for: ${j.desc} on ${poss} ${side} ear.` })
      edits.push({ code: 'extra_jewelry', change: `Remove the ${j.desc} from ${poss} ${side} ear, ${where(j.image)}`, face: false })
    }
    for (const j of obs.other_jewelry) {
      const kind = jewelryKind(j.description)
      if (kind && asked.includes(kind)) continue
      findings.push({ code: 'extra_jewelry', severity: 'info', message: `Jewelry the scene did not ask for: ${j.description}.` })
      edits.push({ code: 'extra_jewelry', change: `Remove the ${j.description.replace(/^(?:a|an|the)\s+/i, '')}, ${where(j.image_side)}`, face: false })
    }
  }

  // Logos and readable text in a brand-free scene (SPEC 5.2 rule 17): a
  // detail to fix with one edit, never a block. Off when the scene allows
  // brands or the rule is switched off.
  if (rules.logos) {
    for (const t of obs.text_or_logos) {
      findings.push({ code: 'logo', severity: 'fail', message: `Logo or readable text: ${t}.` })
      edits.push({ code: 'logo', change: `Remove the ${t.replace(/^(?:a|an|the)\s+/i, '')}, leaving that surface plain and unbranded`, face: false })
    }
  }

  // Framing: scenes are flexible, so a mismatch is for a person to judge.
  const wide = ['full_body', 'knees_up', 'wide_small'].includes(input.framing)
  if (input.framing === 'chest_up' && ['full_body', 'three_quarter_length'].includes(obs.framing)) {
    findings.push({ code: 'wrong_framing', severity: 'warn', message: `Asked for a close, chest-up shot; this reads as ${obs.framing.replace(/_/g, ' ')}.` })
  } else if (wide && obs.framing === 'chest_up') {
    findings.push({ code: 'wrong_framing', severity: 'warn', message: 'Asked for a wider shot; this reads as a chest-up close-up.' })
  }

  // Natural flaws are kept; artifacts a camera could never capture are not.
  const kept: string[] = []
  for (const a of obs.artifacts) {
    if (treatsFlawAsDefect(a) || suggestsFixingFlaw(a)) kept.push(describeFlaw(a))
    else findings.push({ code: 'artifact', severity: 'warn', message: `Looks unreal: ${a}.` })
  }
  const flaws = [...(obs.skin?.flaws ?? []).map(describeFlaw), ...kept].filter(Boolean)
  if (flaws.length) findings.push({ code: 'flaws_kept', severity: 'info', message: `Natural flaws kept, as they should be: ${[...new Set(flaws)].join(', ')}.` })
  if (obs.skin?.texture === 'plastic') {
    findings.push({ code: 'skin_plastic', severity: 'fail', message: 'The skin looks plastic or airbrushed. Real skin texture with visible pores is required.' })
  } else if (obs.skin?.texture === 'slightly_smooth') {
    findings.push({ code: 'skin_smoothed', severity: 'warn', message: 'The skin looks slightly smoothed. Check for visible pores and texture before approving.' })
  } else if (obs.skin?.texture === 'real') {
    findings.push({ code: 'skin_real', severity: 'info', message: 'Real skin texture.' })
  }

  let contradicted = false
  if (input.mirrored) {
    const c = checkMirrorConsistency(obs, input.mirrored)
    if (!c.consistent) {
      contradicted = true
      findings.push({ code: 'uncertain', severity: 'warn', message: `The inspector gave inconsistent answers on a mirrored copy (${c.differences.join(', ')}), so a person should check the sides.` })
    }
  }

  findings.push(...(input.extraFindings ?? []))
  const report: SceneReport = finalize(findings, detectedId, contradicted, { regenerate: SCENE_REGENERATE })
  report.edits = report.verdict === 'regenerate' ? [] : edits
  return report
}

// Callie's scene rule: a cuff on the wrong ear is mirrored when there is no
// text in the frame (free, no drift), otherwise removed with one edit.
export function sceneMirrorFix(input: SceneQaInput, report: SceneReport): MirrorFix | null {
  if (input.rules?.mirror === false) return null
  if (!report.findings.some(f => f.severity !== 'info' && f.code === 'mark_wrong_side')) return null
  if (input.observation.text_or_logos.length) {
    return { available: false, message: 'Flipping would mirror the text in the frame, so this needs a one-change edit.' }
  }
  const flipped = evaluateScene({ ...input, observation: mirrorObservation(input.observation), mirrored: undefined })
  if (flipped.findings.some(f => f.severity !== 'info' && f.code === 'mark_wrong_side')) {
    return { available: false, message: 'Flipping would not put every mark on its own side.' }
  }
  return {
    available: true,
    message: 'Flipping the image horizontally puts the marks on their own side. Free, no new generation, and the face cannot drift.',
    report: flipped,
  }
}
