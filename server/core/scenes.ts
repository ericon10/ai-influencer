import { z } from 'zod'
import type { RulesConfig, ScenesConfig, SheetShot, TemplatesConfig, ViewsConfig } from '../config/pipeline.js'
import type { CharacterData } from './character.js'
import { cardPhrase, finishPrompt, markLines, pronounVars, type BuildOptions } from './prompts.js'
import { capitalize, fill, normalizePrompt } from './text.js'

// Scenes (Stage 7) and one-change edits (Stage 8). A scene is a set of
// fields: the owner's words or the planner fill them, and code builds the
// prompt from the scene template (SPEC 9: prompts are never written from
// scratch by an LLM). Rules from SPEC 5.2 and 5.3 live in config and in the
// checks below.

const text = (max: number) => z.string().trim().max(max)

// Every field is a default the owner can change (owner ruling G1); only the
// moment itself is needed to make a scene.
export const sceneFieldsSchema = z.object({
  title: text(80).default(''),
  momentType: z.string().min(1),
  moment: text(400).min(3, 'Describe the moment.'),
  setting: text(400).default(''),
  location: text(60).default(''),
  outfit: text(300).default(''),
  footwear: text(120).default(''),
  jewelry: text(200).default(''),
  makeup: z.enum(['bare', 'natural', 'soft_glam']).default('natural'),
  hair: text(160).default(''),
  pose: text(240).default(''),
  view: z.string().default('front'),
  expression: z.string().default('neutral'),
  camera: z.string().min(1),
  foreground: text(160).default(''),
  height: z.string().default('eye_level'),
  framing: z.string().default('waist_up'),
  light: z.string().min(1),
  destination: z.string().default('vertical'),
  // Brand deals and products: real logos and brand names allowed.
  brands: z.boolean().default(false),
  // The sheet refs to attach, chosen by the owner; empty picks by angle.
  refs: z.array(z.string().regex(/^REF-\d{2}$/)).max(8).default([]),
})

export type SceneFields = z.infer<typeof sceneFieldsSchema>

export interface FieldIssue { field: keyof SceneFields; message: string }

// Every preset field must name a preset that exists.
export function checkSceneFields(sc: ScenesConfig, views: ViewsConfig, f: SceneFields): FieldIssue[] {
  const out: FieldIssue[] = []
  const has = (list: Array<{ id: string }>, id: string) => list.some(x => x.id === id)
  if (!has(sc.moments, f.momentType)) out.push({ field: 'momentType', message: `Unknown moment type "${f.momentType}".` })
  if (!has(sc.cameras, f.camera)) out.push({ field: 'camera', message: `Unknown camera "${f.camera}".` })
  if (!has(sc.framings, f.framing)) out.push({ field: 'framing', message: `Unknown framing "${f.framing}".` })
  if (!has(sc.heights, f.height)) out.push({ field: 'height', message: `Unknown camera height "${f.height}".` })
  if (!has(sc.lights, f.light)) out.push({ field: 'light', message: `Unknown light "${f.light}".` })
  if (!has(sc.expressions, f.expression)) out.push({ field: 'expression', message: `Unknown expression "${f.expression}".` })
  if (!has(sc.makeup, f.makeup)) out.push({ field: 'makeup', message: `Unknown makeup "${f.makeup}".` })
  if (!has(sc.destinations, f.destination)) out.push({ field: 'destination', message: `Unknown destination "${f.destination}".` })
  if (!views.views[f.view]) out.push({ field: 'view', message: `Unknown angle "${f.view}".` })
  return out
}

const byId = <T extends { id: string }>(list: T[], id: string, what: string): T => {
  const hit = list.find(x => x.id === id)
  if (!hit) throw new Error(`Unknown ${what} "${id}".`)
  return hit
}

export const aspectFor = (sc: ScenesConfig, f: Pick<SceneFields, 'destination'>) => byId(sc.destinations, f.destination, 'destination').aspect

// ── Reference slot (SPEC 5.2 rule 14) ───────────────────────────────

export type ReferenceMode = 'refs' | 'trained' | 'text'

export interface RefPick { refId: string; role: 'face' | 'angle' | 'body' | 'expression' }

// 2 to 4 sheet refs chosen by angle, always one chest-up face ref (REF-00).
// The table is the sheet graph itself (views, framings and expressions in
// sheet.yaml), so a character's "use when" table never needs REF math.
export function pickSceneRefs(shots: SheetShot[], views: ViewsConfig, approved: Set<string>, f: Pick<SceneFields, 'view' | 'framing' | 'expression'> & { refs?: string[] }, sc: ScenesConfig, byAngle = true): RefPick[] {
  const out: RefPick[] = []
  // The owner's own choice wins (any approved shots, in their order).
  const own = (f.refs ?? []).filter(id => approved.has(id))
  if (own.length) {
    const roleOf = (id: string): RefPick['role'] => {
      const s = shots.find(x => x.id === id)
      if (s?.source === 'hero') return 'face'
      if (s?.framing === 'full_body') return 'body'
      return s && s.expression !== 'neutral' && s.expression !== 'none' ? 'expression' : 'angle'
    }
    return own.slice(0, sc.settings.max_refs).map(id => ({ refId: id, role: roleOf(id) }))
  }
  const add = (shot: SheetShot | undefined, role: RefPick['role']) => {
    if (shot && approved.has(shot.id) && !out.some(p => p.refId === shot.id)) out.push({ refId: shot.id, role })
  }
  const face = shots.find(s => s.source === 'hero') ?? shots[0]
  add(face, 'face')
  // Default rule scene-refs-by-angle; switched off, only the face ref.
  if (!byAngle) return out
  const calm = (s: SheetShot) => s.expression === 'neutral' || s.expression === 'none'
  const view = views.views[f.view]
  // The closest angle: the same view, close up; else the same side turned less.
  const sameView = shots.find(s => s.framing === 'chest_up' && calm(s) && s.view === f.view && s.id !== face?.id)
  const sameSide = view && view.turn !== 'none'
    ? shots.find(s => s.framing === 'chest_up' && calm(s) && views.views[s.view]?.turn === view.turn && s.id !== face?.id && approved.has(s.id))
    : undefined
  add(sameView && approved.has(sameView.id) ? sameView : sameSide, 'angle')
  // A body ref when more than the head and shoulders shows.
  if (f.framing !== 'chest_up') {
    const full = shots.filter(s => s.framing === 'full_body' && approved.has(s.id))
    const facing = (s: SheetShot) => views.views[s.view]
    const body = full.find(s => s.view === f.view)
      ?? (view?.facing === 'away' ? full.find(s => facing(s)?.facing === 'away') : undefined)
      ?? (view && view.turn !== 'none' ? full.find(s => facing(s)?.turn !== 'none') : undefined)
      ?? full.find(s => facing(s)?.facing === 'camera' && facing(s)?.turn === 'none')
    add(body, 'body')
  }
  const wanted = sc.expressions.find(e => e.id === f.expression)?.ref_expression
  if (wanted) add(shots.find(s => s.expression === wanted && s.framing === 'chest_up'), 'expression')
  return out.slice(0, sc.settings.max_refs)
}

// ── Scene prompt (SPEC 10, scene) ───────────────────────────────────

// "Long honey-blonde hair, loose waves" gives "long honey-blonde".
export function hairColorFrom(card: string): string | null {
  const m = card.match(/([A-Za-z-]+(?:[ ,-]+[A-Za-z-]+){0,2})\s+hair\b/i)
  if (!m) return null
  return m[1]!.replace(/^(?:with|and|has|her|his|their)\s+/i, '').replace(/,/g, '').trim().toLowerCase() || null
}

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, '')

type SceneCharacter = Pick<CharacterData, 'name' | 'card' | 'marks' | 'pronouns' | 'makeup' | 'realism'>

// Which default rules shape the scene prompt (owner ruling G1). All on
// unless switched off; a scene that allows brands drops the brand-free line.
export interface SceneRuleOptions { outfitOverride?: boolean; brandFree?: boolean; colors?: boolean; referenceLine?: boolean }

// `addendum` is the fix line a review reason adds (config/review.yaml).
export function buildScenePrompt(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, f: SceneFields, ch: SceneCharacter, mode: ReferenceMode, o: BuildOptions & { addendum?: string; rules?: SceneRuleOptions } = {}): string {
  const rules = { outfitOverride: true, brandFree: true, colors: true, referenceLine: true, ...(o.rules ?? {}) }
  const pv = pronounVars(ch.pronouns)
  const view = views.views[f.view]
  if (!view) throw new Error(`Unknown angle "${f.view}".`)
  const camera = byId(sc.cameras, f.camera, 'camera')
  const framing = byId(sc.framings, f.framing, 'framing')
  const light = byId(sc.lights, f.light, 'light')
  const expression = byId(sc.expressions, f.expression, 'expression')
  const height = byId(sc.heights, f.height, 'camera height')
  const reference = mode === 'refs' ? (rules.referenceLine ? fill(t.scene.reference.refs, pv) : '')
    : mode === 'trained' ? fill(t.scene.reference.trained, { name: ch.name })
    : fill(t.scene.reference.text, { card: cardPhrase(ch.card, ch.pronouns.noun) })
  // Nothing is worn unless the scene says so: outfit, footwear and jewelry
  // (signature pieces such as an ear cuff included) are each optional.
  const items = [sentence(f.outfit), f.footwear ? (f.outfit ? `with ${sentence(f.footwear)}` : sentence(f.footwear)) : '', sentence(f.jewelry)].filter(Boolean)
  const override = mode === 'refs' && rules.outfitOverride && f.outfit ? fill(t.scene.outfit_override, { sheet_outfit: t.scene.sheet_outfit }) : ''
  const wearing = !items.length ? ''
    : fill(f.outfit ? t.scene.wearing : t.scene.wearing_only, { ...pv, items: items.join(', '), outfit_override: override })
  const makeup = f.makeup === 'bare' ? t.scene.makeup.bare
    : f.makeup === 'soft_glam' ? fill(t.scene.makeup.soft_glam, { glam: ch.makeup.glam?.trim() || 'soft glam' })
    : fill(t.scene.makeup.natural, { natural: ch.makeup.default?.trim() || 'natural' })
  const hairColor = hairColorFrom(ch.card)
  const triggers = new RegExp(sc.color_triggers, 'i')
  const colors = rules.colors && hairColor && triggers.test([f.moment, f.setting, f.hair, f.pose, light.text].join(' '))
    ? fill(t.scene.colors, { ...pv, hair_color: hairColor }) : ''
  // Marks that are part of the face (a mole) stay; worn pieces are optional.
  const faceMarks = ch.marks.filter(m => m.kind !== 'jewelry')
  const prompt = fill(t.scene.base, {
    ...pv,
    reference,
    moment: sentence(f.moment),
    setting: sentence(f.setting),
    wearing,
    makeup,
    hair: sentence(f.hair) || 'as usual',
    pose: capitalize(sentence(f.pose) || 'Natural, relaxed pose'),
    expression: fill(expression.text, pv),
    marks: markLines(t, view, faceMarks, ch.pronouns),
    camera: fill(camera.text, { ...pv, foreground: sentence(f.foreground) || camera.foreground || 'a blurred shoulder' }),
    framing: fill(framing.text, pv),
    height: height.text,
    light: light.text,
    colors,
    brand_line: rules.brandFree && !f.brands ? fill(t.scene.brand_free, pv) : '',
  })
  return finishPrompt(normalizePrompt(o.addendum ? `${prompt} ${o.addendum}` : prompt), 'scene', ch, o)
}

// ── One-change edits (SPEC 5.3) ─────────────────────────────────────

// Rule 24: one change per pass. Combined edits often skip the small one.
export function oneChangeProblem(change: string): string | null {
  const c = change.trim()
  if (c.length < 6) return 'Describe the one change, with where it is and which side.'
  const sentences = c.replace(/[.!?]+\s*$/, '').split(/[.!?;]\s+/).filter(Boolean)
  if (sentences.length > 1) return 'One change per edit (SPEC 5.3 rule 24). Run the second change as its own edit.'
  if (/\b(?:and also|as well as|then also|plus also)\b/i.test(c)) return 'One change per edit (SPEC 5.3 rule 24). Run the second change as its own edit.'
  return null
}

export function buildEditPrompt(t: TemplatesConfig, change: string, ch: Pick<CharacterData, 'card' | 'marks' | 'pronouns' | 'realism'>, face: boolean, o: BuildOptions = {}): string {
  const pv = pronounVars(ch.pronouns)
  const base = fill(t.edit.base, { change: capitalize(sentence(change)) })
  const prompt = face ? `${base} ${fill(t.edit.face_ref, pv)}` : base
  return finishPrompt(normalizePrompt(prompt), 'edit', ch, o)
}

// ── Combo log (SPEC 5.2 rule 21) ────────────────────────────────────

export interface ComboEntry { date: string; moment: string; camera: string; light: string; location: string }

export const COMBO_TITLE = 'Combo log (last 10)'
export const isComboSection = (title: string) => /^combo log\b/i.test(title.trim())

// Lines like "- 2026-10-12 Caught you / Friend shot / Golden hour / Rooftop".
export function parseComboLog(body: string): ComboEntry[] {
  const out: ComboEntry[] = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*[-*]\s*(\d{4}-\d{2}-\d{2})\s+(.+)$/)
    if (!m) continue
    const [moment = '', camera = '', light = '', location = ''] = m[2]!.split('/').map(p => p.trim())
    out.push({ date: m[1]!, moment, camera, light, location })
  }
  return out
}

export const formatComboEntry = (e: ComboEntry) => `- ${e.date} ${[e.moment, e.camera, e.light, e.location].map(p => p.replace(/\//g, '-').trim()).join(' / ')}`

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// A moment type and camera pair already used in the last `window` entries.
export function comboConflict(entries: ComboEntry[], moment: string, camera: string, window: number): ComboEntry | null {
  return entries.slice(-window).find(e => norm(e.moment) === norm(moment) && norm(e.camera) === norm(camera)) ?? null
}

// Adds an entry and keeps the newest `window` (oldest first, as written).
export function appendCombo(body: string, entry: ComboEntry, window: number): string {
  const lines = body.split('\n')
  const entries = lines.filter(l => /^\s*[-*]\s*\d{4}-\d{2}-\d{2}\s/.test(l))
  const others = lines.filter(l => !entries.includes(l) && l.trim())
  const kept = [...entries, formatComboEntry(entry)].slice(-window)
  return [...others, ...kept].join('\n')
}

export function comboEntryFor(sc: ScenesConfig, f: SceneFields, date: string): ComboEntry {
  return {
    date,
    moment: byId(sc.moments, f.momentType, 'moment type').label,
    camera: byId(sc.cameras, f.camera, 'camera').label,
    light: byId(sc.lights, f.light, 'light').label,
    location: f.location || f.setting.split(/[,.]/)[0]!.trim().slice(0, 40),
  }
}

// ── Planner (Claude fills the fields) ───────────────────────────────

// The planner fills the creative fields; brands and refs stay the owner's.
const PLANNED = ['title', 'momentType', 'moment', 'setting', 'location', 'outfit', 'footwear', 'jewelry', 'makeup', 'hair', 'pose', 'view', 'expression', 'camera', 'foreground', 'height', 'framing', 'light', 'destination'] as const
export const PLANNED_FIELDS: readonly string[] = PLANNED

export function scenePlanJsonSchema(sc: ScenesConfig, views: ViewsConfig): Record<string, unknown> {
  const ids = (list: Array<{ id: string }>) => list.map(x => x.id)
  const str = (description: string) => ({ type: 'string', description })
  return {
    type: 'object',
    additionalProperties: false,
    required: [...PLANNED],
    properties: {
      title: str('A short name for the scene, 2 to 5 words.'),
      momentType: { type: 'string', enum: ids(sc.moments) },
      moment: str('What is happening, present tense, one sentence, naming the character by name.'),
      setting: str('Where, with a few concrete details of the place and the people around.'),
      location: str('The place in 1 to 3 words, for the combo log.'),
      outfit: str('The full outfit, top to bottom, without footwear or jewelry.'),
      footwear: str('The footwear, "barefoot", or an empty string when the feet do not matter.'),
      jewelry: str('Jewelry for this scene, with its side when it matters, or an empty string.'),
      makeup: { type: 'string', enum: ids(sc.makeup) },
      hair: str('Hair styling for this moment.'),
      pose: str('Pose and gaze in a few words. Not looking at the camera unless the moment is "Caught you".'),
      view: { type: 'string', enum: Object.keys(views.views) },
      expression: { type: 'string', enum: ids(sc.expressions) },
      camera: { type: 'string', enum: ids(sc.cameras) },
      height: { type: 'string', enum: ids(sc.heights) },
      foreground: str('Blurred foreground objects for a long-lens shot, or an empty string.'),
      framing: { type: 'string', enum: ids(sc.framings) },
      light: { type: 'string', enum: ids(sc.lights) },
      destination: { type: 'string', enum: ids(sc.destinations) },
    },
  }
}

// The planner's defaults: the `planner` line of every rule switched on.
export function plannerRules(rules: RulesConfig, on: (id: string) => boolean, brands: boolean): string {
  const lines = rules.rules
    .filter(r => r.planner && (r.bucket === 'fixed' || on(r.id)))
    .filter(r => !(brands && r.id === 'scene-brand-free'))
    .map(r => `- ${r.planner}`)
  if (brands) lines.push('- This scene allows real brands and logos (a brand deal or a product).')
  return lines.join('\n') || '- None. Follow the owner.'
}

export function scenePlanPrompt(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, ch: Pick<CharacterData, 'name' | 'persona' | 'style' | 'makeup' | 'pronouns' | 'marks'>, brief: string, combos: ComboEntry[], o: { persona?: boolean } = {}): string {
  const list = (items: Array<{ id: string; label: string; hint?: string }>) => items.map(i => `${i.id} (${i.label}${i.hint ? `: ${i.hint}` : ''})`).join(', ')
  const join = (xs?: string[]) => (xs?.length ? xs.join('; ') : 'none given')
  return fill(t.scene_plan.prompt, {
    ...pronounVars(ch.pronouns),
    name: ch.name,
    brief: brief.trim() || 'Surprise me with an everyday moment that fits the persona.',
    vibe: ch.persona.vibe ?? 'not given',
    settings: join(ch.persona.settings),
    defaults: ch.persona.defaults?.trim() || 'none given',
    never: o.persona === false ? 'none' : join(ch.persona.never),
    style: join([...(ch.style.ideas ?? []), ...(ch.style.pieces ?? []), ...(ch.style.palette ?? [])]),
    style_notes: ch.style.notes?.trim() || 'none',
    jewelry_marks: join(ch.marks.filter(m => m.kind === 'jewelry').map(m => `${m.description} (${m.side} ${m.region})`)),
    hair_options: join(ch.style.hair_options),
    natural: ch.makeup.default || 'natural',
    glam: ch.makeup.glam || 'soft glam',
    glam_when: ch.makeup.glam_when.length ? ch.makeup.glam_when.join(', ').replace(/_/g, ' ') : 'nights out and events',
    combos: combos.length ? combos.map(c => `- ${c.moment} / ${c.camera} / ${c.light} / ${c.location}`).join('\n') : '(none yet)',
    moment_types: list(sc.moments),
    cameras: list(sc.cameras),
    heights: list(sc.heights),
    framings: list(sc.framings),
    lights: list(sc.lights),
    expressions: list(sc.expressions),
    views: Object.entries(views.views).map(([id, v]) => `${id} (${v.label})`).join(', '),
    makeups: list(sc.makeup),
    destinations: list(sc.destinations),
  })
}
