import type { SkinDetail } from './realism.js'
import { z } from 'zod'
import type { RulesConfig, ScenesConfig, SheetShot, TemplatesConfig, ViewsConfig } from '../config/pipeline.js'
import type { CharacterData } from './character.js'
import { cardPhrase, finishPrompt, markLines, pronounVars, type BuildOptions } from './prompts.js'
import { capitalize, fill, normalizePrompt } from './text.js'
import { looksLikePrompt, readShot } from './shotParse.js'

// Scenes (Stage 7) and one-change edits (Stage 8). A scene is a set of
// fields: the owner's words or the planner fill them. The prompt writer
// (DECISIONS G10) turns them into natural sentences, or the scene template
// builds the prompt when it is switched off; either way code adds the
// reference line, the mark sides and the REALISM block. Rules from SPEC 5.2
// and 5.3 live in config and in the checks below.

const text = (max: number) => z.string().trim().max(max)

// Every field is a default the owner can change (owner ruling G1); only the
// moment itself is needed to make a scene.
export const sceneFieldsSchema = z.object({
  title: text(80).default(''),
  momentType: z.string().min(1),
  moment: text(400).min(3, 'Describe the moment.'),
  // The ordinary task the character is busy with, and the one small thing
  // that catches their attention (owner, 2026-10-13, from the ultra-realism
  // guide: task, trigger, small reaction, back to the task). Optional.
  task: text(200).default(''),
  trigger: text(200).default(''),
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
  // How far the camera is, and the phone's front or rear camera. Optional.
  distance: text(60).default(''),
  phone: z.enum(['', 'rear', 'front']).default(''),
  foreground: text(160).default(''),
  height: z.string().default('eye_level'),
  framing: z.string().default('waist_up'),
  light: z.string().min(1),
  destination: z.string().default('vertical'),
  // Brand deals and products: real logos and brand names allowed.
  brands: z.boolean().default(false),
  // The sheet refs to attach, chosen by the owner; empty picks by angle.
  refs: z.array(z.string().regex(/^REF-\d{2}$/)).max(8).default([]),
  // A pasted prompt goes as written (owner, 2026-10-14): the owner's text
  // plus only the fixed blocks (reference line, 21+, REALISM and AVOID).
  asWritten: z.boolean().default(false),
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
  // A body ref only for a framing that shows the body (scenes.yaml
  // body_ref_framings): a full-body sheet shot drags the sheet outfit into
  // a closer shot, so chest-up and waist-up get face refs only.
  if (sc.settings.body_ref_framings.includes(f.framing)) {
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

// Men get no makeup words, only grooming (character template v1.6).
export const isMan = (p: CharacterData['pronouns']) => /^(?:man|guy|boy)$/i.test(p.noun.trim()) || p.subj.trim().toLowerCase() === 'he'

// The makeup line. Out in public it is soft everyday makeup: the
// character's own everyday line when the file has one, or the template's
// (light coverage that still shows skin texture, a matte nude lip), always
// with "the same lip shape, nose and jaw as the references" so makeup never
// reshapes the face.
export function makeupLine(t: TemplatesConfig, makeup: string, ch: Pick<CharacterData, 'makeup' | 'pronouns'>): string {
  if (isMan(ch.pronouns)) return t.scene.makeup.groomed
  if (makeup === 'bare') return t.scene.makeup.bare
  if (makeup === 'soft_glam') return fill(t.scene.makeup.soft_glam, { glam: ch.makeup.glam?.trim() || 'soft glam' })
  const own = ch.makeup.default?.trim() ?? ''
  // A file whose grooming default is "none" (template v1.6) goes bare-faced.
  if (/^(?:none|no makeup|bare)$/i.test(own)) return t.scene.makeup.bare
  return fill(t.scene.makeup.natural, { natural: own && !/^(?:natural|light|minimal|soft|everyday)$/i.test(own) ? own : t.scene.makeup.everyday })
}

// ── Makeup by setting and hair rotation (character template v1.6) ──

const phraseRe = (list: string[]) => (list.length ? new RegExp(`\\b(?:${[...list].sort((a, b) => b.length - a.length).map(w => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i') : null)

// Default rule makeup-by-setting: no makeup at home, the gym, an early beach
// or waking up; soft everyday makeup anywhere else. Null when the words say
// nothing about the place.
export function makeupForSetting(sc: ScenesConfig, words: string): 'bare' | 'natural' | null {
  if (!words.trim()) return null
  return phraseRe(sc.makeup_by_setting.bare)?.test(words) ? 'bare' : 'natural'
}

const HAIR_STYLE = /\b(?:(?:messy|high|low|sleek|loose|top|half[- ]up|side|french|fishtail|twin|space|slick(?:ed)?(?:[- ]back)?)\s+){0,2}(?:bun|buns|ponytail|pony|braid|braids|plait|plaits|pigtails|updo|claw clip|hair clip|scrunchie|headband|bandana)\b|\bhair\s+(?:up|down|back|tucked|pulled|loose|wet|damp|blowing|in\s+a\s+\w+(?:\s+\w+)?)\b(?:\s+(?:behind|off|over|into)\s+(?:her|his|their|one|both)?\s*\w+)?|\b(?:wet|damp|slicked[- ]back|air[- ]dried)\s+hair\b|\btucked\s+behind\s+(?:her|his|their|one)\s+ear\b/i

// A hair styling the owner's words name ("a messy bun", "hair tucked behind
// her ear"), so the rotation leaves it alone.
export function hairFromWords(words: string): string | null {
  const m = words.match(HAIR_STYLE)
  return m ? m[0].trim().slice(0, 80) : null
}

const hairKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// A styling straight from the bank (the rotation's own pick).
export function isBankHair(sc: ScenesConfig, hair: string | undefined | null): boolean {
  return !!hair && sc.hair_bank.some(b => hairKey(b) === hairKey(hair))
}

// The next styling in the bank, never one in `recent` (newest last). After
// the newest bank styling used, in bank order; when every one was used,
// the one used longest ago.
export function nextHair(bank: string[], recent: string[]): string | null {
  if (!bank.length) return null
  const used = recent.map(hairKey)
  const lastAt = (() => { for (let i = used.length - 1; i >= 0; i--) { const at = bank.findIndex(b => hairKey(b) === used[i]); if (at >= 0) return at } return -1 })()
  for (let k = 1; k <= bank.length; k++) {
    const b = bank[(lastAt + k + bank.length) % bank.length]!
    if (!used.includes(hairKey(b))) return b
  }
  // Every one used: the one used longest ago.
  let best = bank[0]!, bestAt = Infinity
  for (const b of bank) { const at = used.lastIndexOf(hairKey(b)); if (at < bestAt) { best = b; bestAt = at } }
  return best
}

// Which default rules shape the scene prompt (owner ruling G1). All on
// unless switched off; a scene that allows brands drops the brand-free line.
export interface SceneRuleOptions { outfitOverride?: boolean; brandFree?: boolean; colors?: boolean; referenceLine?: boolean }

// The pieces a scene prompt is made of, shared by the template and the
// prompt writer. The reference line, the mark sides, the colors and the
// brand-free line are the Studio's own lines; they never depend on writing.
export function sceneParts(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, f: SceneFields, ch: SceneCharacter, mode: ReferenceMode, o: { rules?: SceneRuleOptions } = {}) {
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
  const makeup = makeupLine(t, f.makeup, ch)
  const hairColor = hairColorFrom(ch.card)
  const triggers = new RegExp(sc.color_triggers, 'i')
  const colors = rules.colors && hairColor && triggers.test([f.moment, f.setting, f.hair, f.pose, light.text].join(' '))
    ? fill(t.scene.colors, { ...pv, hair_color: hairColor }) : ''
  // Marks that are part of the face (a mole) stay; worn pieces are optional.
  const faceMarks = ch.marks.filter(m => m.kind !== 'jewelry')
  return {
    pv, reference, makeup,
    momentType: sc.moments.find(m => m.id === f.momentType)?.label ?? '',
    expression: fill(expression.text, pv),
    camera: fill(camera.text, { ...pv, foreground: sentence(f.foreground) || camera.foreground || 'a blurred shoulder' }),
    framing: fill(framing.text, pv),
    height: height.text,
    light: light.text,
    marks: markLines(t, view, faceMarks, ch.pronouns),
    colors,
    brand_line: rules.brandFree && !f.brands ? fill(t.scene.brand_free, pv) : '',
    // The scene's outfit replaces the sheet outfit in the reference images;
    // with no outfit named, the sheet clothes are still dropped.
    override: mode === 'refs' && rules.outfitOverride && !!f.outfit,
    dropSheet: mode === 'refs' && rules.outfitOverride && !f.outfit,
    // Fixed: characters are 21 or older.
    adult: fill(t.scene.adult, pv),
  }
}

type Parts = ReturnType<typeof sceneParts>

// "She is wearing ..." from the outfit, footwear and jewelry fields (each
// optional). The prompt writer path adds jewelry on its own line.
function wearingLine(t: TemplatesConfig, f: SceneFields, p: Parts, o: { jewelry: boolean; override: boolean }): string {
  const items = [sentence(f.outfit), f.footwear ? (f.outfit ? `with ${sentence(f.footwear)}` : sentence(f.footwear)) : '', o.jewelry ? sentence(f.jewelry) : ''].filter(Boolean)
  const override = o.override && p.override ? fill(t.scene.outfit_override, { sheet_outfit: t.scene.sheet_outfit }) : ''
  const free = o.override && p.dropSheet ? fill(t.scene.outfit_free, { ...p.pv, sheet_outfit: t.scene.sheet_outfit }) : ''
  const wearing = !items.length ? '' : fill(f.outfit ? t.scene.wearing : t.scene.wearing_only, { ...p.pv, items: items.join(', '), outfit_override: override })
  return [wearing, free].filter(Boolean).join(' ')
}

// "Busy choosing a pastry. A bicycle bell catches her attention." (both optional).
function taskLine(f: SceneFields, pv: Record<string, string>): string {
  const task = sentence(f.task), trigger = sentence(f.trigger)
  return [task ? `${capitalize(task)}.` : '', trigger ? `${capitalize(trigger)} catches ${pv.poss} attention.` : ''].filter(Boolean).join(' ')
}

// ", on the rear camera, about 1 metre away" (both optional).
function cameraExtra(f: SceneFields): string {
  const distance = sentence(f.distance).replace(/\s+away$/i, '')
  return [f.phone ? `, on the ${f.phone} camera` : '', distance ? `, ${distance} away` : ''].join('')
}

function fillSceneBase(t: TemplatesConfig, f: SceneFields, p: Parts, o: { scaffold: boolean }): string {
  return fill(t.scene.base, {
    ...p.pv,
    reference: o.scaffold ? p.reference : '',
    adult: o.scaffold ? p.adult : '',
    // Each starts its own sentence in the template.
    moment: capitalize(sentence(f.moment)),
    task_line: taskLine(f, p.pv),
    setting: capitalize(sentence(f.setting)),
    wearing: wearingLine(t, f, p, { jewelry: o.scaffold, override: o.scaffold }),
    makeup: p.makeup,
    hair: sentence(f.hair) || 'as usual',
    // A moment, not a pose (owner, 2026-10-15).
    pose: capitalize(sentence(f.pose) || 'Relaxed, caught mid-moment'),
    expression: p.expression,
    marks: o.scaffold ? p.marks : '',
    camera: p.camera,
    camera_extra: cameraExtra(f),
    framing: p.framing,
    height: p.height,
    light: p.light,
    colors: o.scaffold ? p.colors : '',
    brand_line: o.scaffold ? p.brand_line : '',
  })
}

// `addendum` is the fix line a review reason adds (config/review.yaml).
export function buildScenePrompt(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, f: SceneFields, ch: SceneCharacter, mode: ReferenceMode, o: BuildOptions & { addendum?: string; rules?: SceneRuleOptions } = {}): string {
  const prompt = fillSceneBase(t, f, sceneParts(t, sc, views, f, ch, mode, o), { scaffold: true })
  return finishPrompt(normalizePrompt(o.addendum ? `${prompt} ${o.addendum}` : prompt), 'scene', ch, { ...o, makeup: f.makeup, skin: skinFor(sc, f.framing) })
}

// The template's own text without the Studio's lines: what "Use the
// template" puts in the prompt box while the prompt writer is on.
export function templateBody(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, f: SceneFields, ch: SceneCharacter): string {
  return normalizePrompt(fillSceneBase(t, f, sceneParts(t, sc, views, f, ch, 'refs'), { scaffold: false }))
}

// The details the prompt writer gets, one per line. The Studio's own lines
// (reference, the exact outfit sentence with jewelry, mark sides, colors,
// brand-free) are added after the writing; jewelry is left out here so its
// side is never reworded.
export function writerFacts(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, f: SceneFields, ch: SceneCharacter): string {
  const p = sceneParts(t, sc, views, f, ch, 'refs')
  const line = (label: string, value: string) => (value.trim() ? `- ${label}: ${sentence(value)}.` : '')
  return [
    line('The moment', f.moment),
    line(`${capitalize(ch.pronouns.poss)} ordinary task`, f.task),
    line(`What catches ${ch.pronouns.poss} attention`, f.trigger),
    line('Kind of moment', p.momentType),
    line('Setting', f.setting),
    line('Place', f.location),
    line('Outfit', f.outfit),
    line('Footwear', f.footwear),
    line('Makeup', p.makeup),
    line('Hair styling', f.hair),
    line('Position and gaze', f.pose),
    line('Expression', p.expression),
    line('Who takes the photo and from where', p.camera),
    line('Camera distance', f.distance),
    line('Phone camera', f.phone === 'front' ? 'the front camera (a selfie)' : f.phone === 'rear' ? 'the rear camera' : ''),
    line('Framing and camera height', `${p.framing}, ${p.height}`),
    line('Light', p.light),
    line('In the foreground', f.foreground),
    `- Brands: ${f.brands ? 'brands and logos may show' : 'everything is plain and unbranded'}.`,
  ].filter(Boolean).join('\n')
}

// What the video writer gets from the scene: the task and trigger, who
// records and from how far, and the light. The start frame shows the rest.
export function videoWriterFacts(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, f: SceneFields, ch: SceneCharacter): string {
  const p = sceneParts(t, sc, views, f, ch, 'refs')
  const line = (label: string, value: string) => (value.trim() ? `- ${label}: ${sentence(value)}.` : '')
  return [
    line(`${capitalize(ch.pronouns.poss)} ordinary task`, f.task),
    line(`What catches ${ch.pronouns.poss} attention`, f.trigger),
    line('Who records and from where', p.camera),
    line('Camera distance', f.distance),
    line('Phone camera', f.phone === 'front' ? 'the front camera (a selfie)' : f.phone === 'rear' ? 'the rear camera' : ''),
    line('Framing', p.framing),
    line('Light', p.light),
  ].filter(Boolean).join('\n') || '- Nothing more; use the start frame.'
}

// Text the writer or the owner wrote, made safe to wrap: a REALISM or AVOID
// block in it is dropped (the Studio adds the character's own), and so are
// quotes around the whole and extra space.
export function cleanWritten(text: string): string {
  return text.split('\n').filter(l => !/^\s*(?:REALISM|AVOID):/i.test(l)).join(' ')
    .replace(/\s+/g, ' ').trim().replace(/^["\u201c]+|["\u201d]+$/g, '').trim()
}

// The final still prompt from written text: the reference line for this
// model, the text, then the Studio's lines (the outfit sentence, the mark
// sides, colors, brand-free), then REALISM and AVOID (rule zero, added by
// finishPrompt and impossible to leave out).
export function assembleStillPrompt(t: TemplatesConfig, sc: ScenesConfig, views: ViewsConfig, f: SceneFields, ch: SceneCharacter, mode: ReferenceMode, body: string, o: BuildOptions & { addendum?: string; rules?: SceneRuleOptions } = {}): string {
  const p = sceneParts(t, sc, views, f, ch, mode, o)
  // The template's exact outfit sentence (outfit, footwear, jewelry with its
  // side, and the sheet outfit replaced): Callie's rule "always write the
  // full outfit" holds whatever the writing says.
  const wearing = wearingLine(t, f, p, { jewelry: true, override: true })
  const text = [p.reference, p.adult, cleanWritten(body), wearing, p.marks, p.colors, p.brand_line, o.addendum ?? ''].filter(Boolean).join('\n')
  return finishPrompt(normalizePrompt(text), 'scene', ch, { ...o, makeup: f.makeup, skin: skinFor(sc, f.framing) })
}

// A pasted prompt sent as written (owner, 2026-10-14): the owner's text
// unchanged, plus only the fixed blocks: the reference line (refs for the
// face only), the 21+ line, then REALISM and AVOID (finishPrompt, which also
// takes out banned skin words and says so). No camera, light or outfit line.
export function assembleAsWritten(t: TemplatesConfig, sc: ScenesConfig, f: SceneFields, ch: SceneCharacter, mode: ReferenceMode, text: string, o: BuildOptions = {}): string {
  const pv = pronounVars(ch.pronouns)
  const reference = mode === 'refs' ? fill(t.scene.reference.as_written, pv)
    : mode === 'trained' ? fill(t.scene.reference.trained, { name: ch.name })
    : fill(t.scene.reference.text, { card: cardPhrase(ch.card, ch.pronouns.noun) })
  const body = [reference, fill(t.scene.adult, pv), cleanWritten(text)].filter(Boolean).join('\n')
  return finishPrompt(normalizePrompt(body), 'scene', ch, { ...o, makeup: f.makeup, skin: skinFor(sc, f.framing) })
}

// What the owner's words already say about the shot (shotParse.ts), as
// scene fields: layered over the defaults and under the owner's own
// choices, so a selfie in a black tank stays one.
export function fieldsFromWords(sc: ScenesConfig, words: string): Partial<SceneFields> {
  const r = readShot(words)
  const out: Partial<SceneFields> = {}
  const has = (list: Array<{ id: string }>, id?: string) => !!id && list.some(x => x.id === id)
  if (has(sc.cameras, r.camera)) out.camera = r.camera!
  if (has(sc.moments, r.camera)) out.momentType = r.camera!
  if (r.phone) out.phone = r.phone
  if (has(sc.framings, r.framing)) out.framing = r.framing!
  if (r.outfit) out.outfit = r.outfit.slice(0, 300)
  if (r.makeup) out.makeup = r.makeup
  if (r.place) out.location = r.place.slice(0, 60)
  const hair = hairFromWords(words)
  if (hair) out.hair = hair
  if (r.ownLight && has(sc.lights, 'as_written')) out.light = 'as_written'
  if (looksLikePrompt(words)) out.asWritten = true
  return out
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

// How much skin detail the REALISM block names at a framing (scenes.yaml).
export function skinFor(sc: ScenesConfig, framing: string | undefined): SkinDetail {
  return sc.framings.find(x => x.id === framing)?.skin ?? 'full'
}

export function buildEditPrompt(t: TemplatesConfig, change: string, ch: Pick<CharacterData, 'card' | 'marks' | 'pronouns' | 'realism'>, face: boolean, o: BuildOptions = {}): string {
  const pv = pronounVars(ch.pronouns)
  const base = fill(t.edit.base, { change: capitalize(sentence(change)) })
  const prompt = face ? `${base} ${fill(t.edit.face_ref, pv)}` : base
  return finishPrompt(normalizePrompt(prompt), 'edit', ch, o)
}

// ── Combo log (SPEC 5.2 rule 21) ────────────────────────────────────

export interface ComboEntry { date: string; moment: string; camera: string; light: string; location: string; hair?: string }

export const COMBO_TITLE = 'Combo log (last 10)'
export const isComboSection = (title: string) => /^combo log\b/i.test(title.trim())

// Lines like "- 2026-10-12 Caught you / Friend shot / Golden hour / Rooftop
// / low loose ponytail" (the hair styling is the fifth part, template
// v1.6; older lines have four). A line wrapped onto the next one, as the
// template writes it, is read as one.
export function parseComboLog(body: string): ComboEntry[] {
  const out: ComboEntry[] = []
  const lines: string[] = []
  for (const line of body.split('\n')) {
    if (/^\s*[-*]\s*\d{4}-\d{2}-\d{2}\s/.test(line)) lines.push(line)
    else if (lines.length && /^\s{2,}\S/.test(line) && !/^\s*[-*]\s/.test(line)) lines[lines.length - 1] += ` ${line.trim()}`
  }
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s*(\d{4}-\d{2}-\d{2})\s+(.+)$/)
    if (!m) continue
    const [moment = '', camera = '', light = '', location = '', hair = ''] = m[2]!.split('/').map(p => p.trim())
    out.push({ date: m[1]!, moment, camera, light, location, ...(hair ? { hair } : {}) })
  }
  return out
}

export const formatComboEntry = (e: ComboEntry) => `- ${e.date} ${[e.moment, e.camera, e.light, e.location, ...(e.hair?.trim() ? [e.hair] : [])].map(p => p.replace(/\//g, '-').trim()).join(' / ')}`

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// A moment type and camera pair already used in the last `window` entries.
export function comboConflict(entries: ComboEntry[], moment: string, camera: string, window: number): ComboEntry | null {
  return entries.slice(-window).find(e => norm(e.moment) === norm(moment) && norm(e.camera) === norm(camera)) ?? null
}

// Adds an entry and keeps the newest `window` (oldest first, as written).
export function appendCombo(body: string, entry: ComboEntry, window: number): string {
  const entries: string[] = []
  const others: string[] = []
  for (const l of body.split('\n')) {
    if (/^\s*[-*]\s*\d{4}-\d{2}-\d{2}\s/.test(l)) entries.push(l)
    // A wrapped entry ("  / low loose ponytail") is joined into one line.
    else if (entries.length && /^\s{2,}\S/.test(l) && !/^\s*[-*]\s/.test(l)) entries[entries.length - 1] += ` ${l.trim()}`
    else if (l.trim()) others.push(l)
  }
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
    ...(f.hair.trim() ? { hair: sentence(f.hair).slice(0, 60) } : {}),
  }
}

// ── Planner (Claude fills the fields) ───────────────────────────────

// The planner fills the creative fields; brands and refs stay the owner's.
const PLANNED = ['title', 'momentType', 'moment', 'task', 'trigger', 'setting', 'location', 'outfit', 'footwear', 'jewelry', 'makeup', 'hair', 'pose', 'view', 'expression', 'camera', 'distance', 'phone', 'foreground', 'height', 'framing', 'light', 'destination'] as const
export const PLANNED_FIELDS: readonly string[] = PLANNED

// "Punch it up": three specific moments from a rough idea.
export interface SceneIdea { moment: string; action: string; shooter: string; place: string; detail: string; other_person: string; fits_brand?: boolean; brand_note?: string }

export function sceneIdeasJsonSchema(o: { brand?: boolean } = {}): Record<string, unknown> {
  const str = (description: string) => ({ type: 'string', description })
  // The brand check (default rule brand-check): whether each moment fits
  // the brand statement, and why not when it does not.
  const brand = o.brand ? {
    fits_brand: { type: 'boolean', description: 'Whether this moment fits the brand statement.' },
    brand_note: str('When it does not fit, why, in a few plain words; otherwise an empty string.'),
  } : {}
  return {
    type: 'object',
    additionalProperties: false,
    required: ['options'],
    properties: {
      options: {
        type: 'array',
        description: 'Exactly three options.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['moment', 'action', 'shooter', 'place', 'detail', 'other_person', ...Object.keys(brand)],
          properties: {
            moment: str('The whole moment in one or two sentences, starting with the character\'s name. This is what fills the scene box.'),
            action: str('The one action caught mid-motion.'),
            shooter: str('Who takes the photo and from where.'),
            place: str('The specific place, the time of day and the light.'),
            detail: str('One small real-life detail.'),
            other_person: str('The other person and their look (hair color and cut), or an empty string when nobody else is in it.'),
            ...brand,
          },
        },
      },
    },
  }
}

// Demo mode: three plain options made from the owner's words.
export function mockSceneIdeas(name: string, idea: string, poss: string, o: { brand?: boolean } = {}): { options: SceneIdea[] } {
  const what = idea.trim().replace(/[.!?]+$/, '').replace(new RegExp(`^${name}\\s+`, 'i'), '') || 'out for the day'
  const out = {
    options: [
      { moment: `${name} ${what}, caught mid-laugh as she turns back toward a friend who snaps it on a phone from a few steps behind, late-morning sun on a busy sidewalk, a paper coffee cup in ${poss} hand.`, action: 'turning back mid-laugh', shooter: 'a friend on a phone, a few steps behind', place: 'a busy sidewalk, late morning, bright sun', detail: 'a paper coffee cup', other_person: '' },
      { moment: `${name} ${what}, reaching up to tuck hair behind ${poss} ear as a stranger she asked takes the shot from across a small cafe table, soft window light at 4 p.m., a half-eaten croissant on the plate.`, action: 'tucking hair behind an ear', shooter: 'a stranger across the table', place: 'a small cafe, 4 p.m., soft window light', detail: 'a half-eaten croissant', other_person: '' },
      { moment: `${name} ${what}, mid-step down a few stone stairs while a friend with a short black bob films from the landing below, golden hour by the water, sunglasses pushed up on ${poss} head.`, action: 'stepping down the stairs', shooter: 'a friend on the landing below', place: 'stone stairs by the water, golden hour', detail: 'sunglasses pushed up on her head', other_person: 'A friend with a short black bob' },
    ] as SceneIdea[],
  }
  return o.brand ? { options: out.options.map(x => ({ ...x, fits_brand: true, brand_note: '' })) } : out
}

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
      task: str('The ordinary task the character is busy with in this moment (choosing a pastry, folding a sleeve), a few words, present tense.'),
      trigger: str('The one small real thing that catches their attention (a friend\'s voice, a bicycle bell, a breeze lifting a napkin), a few words.'),
      setting: str('Where, with a few concrete details of the place and the people around.'),
      location: str('The place in 1 to 3 words, for the combo log.'),
      outfit: str('The full outfit, top to bottom, without footwear or jewelry, the way a shop catalog says it: garment, color and fabric, plus a style word when it is clear ("dark green ribbed tank top with thin straps, high-waisted light wash jeans, going-out look"). Always name the garment, never just "top". No fit or body words.'),
      footwear: str('The footwear, "barefoot", or an empty string when the feet do not matter.'),
      jewelry: str('Jewelry for this scene, with its side when it matters, or an empty string.'),
      makeup: { type: 'string', enum: ids(sc.makeup) },
      hair: str('Hair styling for this moment.'),
      pose: str('Where the hands are and where the eyes go in this moment, in a few words (one hand on the counter, eyes on the kettle), never a pose for the camera. Not looking at the camera unless the moment is "Caught you".'),
      view: { type: 'string', enum: Object.keys(views.views) },
      expression: { type: 'string', enum: ids(sc.expressions) },
      camera: { type: 'string', enum: ids(sc.cameras) },
      distance: str('How far the camera is from the character, for example "about 1 metre" or "3 metres".'),
      phone: { type: 'string', enum: ['rear', 'front'], description: 'The phone camera: rear (someone else films, or a mirror shot) or front (a selfie).' },
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
