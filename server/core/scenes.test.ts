import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { blocking, lintPrompt } from './rules.js'
import {
  appendCombo, buildEditPrompt, buildScenePrompt, checkSceneFields, comboConflict, comboEntryFor, hairColorFrom,
  oneChangeProblem, parseComboLog, pickSceneRefs, plannerRules, sceneFieldsSchema, scenePlanJsonSchema, scenePlanPrompt, type SceneFields,
} from './scenes.js'
import type { CharacterData } from './character.js'

// Stage 7 and 8 rules (SPEC 5.2 and 5.3), checked against Callie's real
// character file details.

const cfg = loadConfig()
const { templates, views, rules, sheet, scenes } = cfg.pipeline
const EM = String.fromCharCode(0x2014)

const callie: Pick<CharacterData, 'name' | 'card' | 'marks' | 'pronouns' | 'makeup' | 'realism' | 'persona' | 'style'> = {
  name: 'Callie',
  card: 'Callie, 24 years old. Long honey-blonde hair, loose beachy waves, deep side part. Warm hazel-brown eyes, soft oval face, full light-brown brows, full lips.',
  marks: [
    { name: 'mole', description: 'small mole', side: 'LEFT', region: 'brow', kind: 'skin', subtle: true },
    { name: 'ear cuff', description: 'gold double-band ear cuff', side: 'LEFT', region: 'ear', kind: 'jewelry', subtle: false },
  ],
  pronouns: { subj: 'she', obj: 'her', poss: 'her', noun: 'woman' },
  makeup: { default: 'natural (light skin, groomed brows, tinted lip)', glam: 'soft glam (bronzer, warm blush, glossy nude-pink lip)', glam_when: ['nights_out', 'events'] },
  realism: {
    block: 'REALISM: Candid phone photo, natural skin texture with visible pores, small imperfections, ordinary background clutter, no retouching, not a professional shoot.',
    avoid: 'AVOID: studio lighting, perfect symmetry, plastic skin, airbrushed or smoothed skin, beauty filter, heavy makeup, text, watermarks.',
  },
  persona: { vibe: 'sunny, approachable', settings: ['farmers markets', 'rooftops at golden hour'], never: ['heavy glam in daytime'] },
  style: { ideas: ['linen sets', 'white sandals or clean sneakers'], hair_options: ['claw clip or low bun'] },
}

const market: SceneFields = sceneFieldsSchema.parse({
  title: 'Peaches at the market',
  momentType: 'candid_laugh',
  moment: 'Callie picks out peaches at a farmers market stall, laughing at something the vendor said',
  setting: 'A busy Saturday farmers market under white canopies, other shoppers in the background',
  location: 'Farmers market',
  outfit: 'a cream linen button-up shirt with the sleeves rolled, light-wash straight jeans',
  footwear: 'white leather sandals',
  jewelry: 'a thin gold chain necklace',
  makeup: 'natural',
  hair: 'loose beachy waves with a deep side part',
  pose: 'holding a peach in one hand, eyes on the vendor',
  view: 'three_quarter_left',
  expression: 'laughing',
  camera: 'friend_phone',
  framing: 'waist_up',
  light: 'morning',
  destination: 'vertical',
})

const allApproved = new Set(sheet.shots.map(s => s.id))

describe('scene prompts (SPEC 5.2 and 10)', () => {
  const p = buildScenePrompt(templates, scenes, views, market, callie, 'refs')
  const request = { kind: 'image_edit' as const, model: 'higgsfield/nano-banana-2.1', prompt: p, refs: [{ assetId: 'a' }, { assetId: 'b' }], aspect: '9:16' }

  it('opens with the fixed REFERENCE line and replaces the sheet outfit (rules 14 and 15)', () => {
    expect(p.startsWith("Using the attached reference images, keep this woman's face, hair, and features exactly the same.")).toBe(true)
    expect(p).toContain('wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images')
  })

  it('names the outfit, the footwear and only the jewelry the scene asks for (rules 15 and 16, ruling G1)', () => {
    expect(p).toContain('She is wearing a cream linen button-up shirt with the sleeves rolled, light-wash straight jeans, with white leather sandals, a thin gold chain necklace, wearing this outfit instead of the white t-shirt, jeans and sneakers in the reference images.')
    // Signature jewelry is never forced into a scene.
    expect(p).not.toMatch(/ear cuff/)
    const cuff = buildScenePrompt(templates, scenes, views, { ...market, jewelry: 'her gold double-band ear cuff on her left ear' }, callie, 'refs')
    expect(cuff).toContain('her gold double-band ear cuff on her left ear')
  })

  it('is plain and unbranded by default, at the chosen height, with the face mark on its side (rules 17, 18 and 11)', () => {
    expect(p).toContain('plain and unbranded, with no logos or readable text')
    expect(p).toContain('Candid phone photo taken by a friend about 6 feet away, waist-up framing, eye level.')
    expect(p).toContain('The small mole above her LEFT brow is visible.')
    const front = buildScenePrompt(templates, scenes, views, { ...market, view: 'front' }, callie, 'refs')
    expect(front).toMatch(/it appears on the right side of the image/)
    expect(front).not.toMatch(/ear cuff|RIGHT ear|LEFT ear/)
    const high = buildScenePrompt(templates, scenes, views, { ...market, height: 'slightly_high', camera: 'over_shoulder' }, callie, 'refs')
    expect(high).toContain('over a friend\'s shoulder')
    expect(high).toContain('waist-up framing, from slightly above eye level.')
  })

  it('a brand deal drops the unbranded line, and every default can be switched off', () => {
    const deal = buildScenePrompt(templates, scenes, views, { ...market, brands: true }, callie, 'refs')
    expect(deal).not.toMatch(/unbranded/)
    const bare = buildScenePrompt(templates, scenes, views, market, callie, 'refs', { rules: { outfitOverride: false, brandFree: false, referenceLine: false } })
    expect(bare).not.toMatch(/instead of the white t-shirt|unbranded|Using the attached reference images/)
  })

  it('outfit, footwear and jewelry are each optional', () => {
    const none = buildScenePrompt(templates, scenes, views, { ...market, outfit: '', footwear: '', jewelry: '' }, callie, 'refs')
    expect(none).not.toMatch(/wearing/)
    const shoes = buildScenePrompt(templates, scenes, views, { ...market, outfit: '', jewelry: '' }, callie, 'refs')
    expect(shoes).toContain('She has white leather sandals.')
  })

  it('keeps the character\'s REALISM block as written, background clutter included', () => {
    expect(p).toContain(callie.realism.block)
    expect(p).toContain(callie.realism.avoid)
    expect(p).not.toContain('Bare face, no makeup')
    expect(p).toContain('Makeup: natural (light skin, groomed brows, tinted lip)')
  })

  it('passes every scene rule in the lint, and has no em-dash', () => {
    const v = lintPrompt(rules, p, { stage: 'scene', framing: 'waist_up', kind: 'image_edit', request, marks: callie.marks })
    expect(blocking(v)).toEqual([])
    expect(p).not.toContain(EM)
  })

  it('no footwear, a low angle or another shape is a warning, never a block (ruling G1)', () => {
    const ids = (prompt: string, req = request) => lintPrompt(rules, prompt, { stage: 'scene', kind: 'image_edit', request: { ...req, prompt } })
    const bare = buildScenePrompt(templates, scenes, views, { ...market, footwear: '' }, callie, 'refs')
    const low = buildScenePrompt(templates, scenes, views, { ...market, height: 'low', pose: 'shot from a low angle, looking up at her' }, callie, 'refs')
    expect(ids(bare).map(v => v.ruleId)).toContain('scene-names-footwear')
    expect(ids(low).map(v => v.ruleId)).toContain('scene-everyday-angles')
    expect(ids(p, { ...request, aspect: '16:9' }).map(v => v.ruleId)).toContain('scene-aspect')
    for (const v of [...ids(bare), ...ids(low), ...ids(p, { ...request, aspect: '16:9' })]) expect(v.severity).toBe('warning')
  })

  it('a trained character is named, carries no face description and attaches nothing (rule 14)', () => {
    const block = 'Honey-blonde hair, light brown brows, fair skin with a light sun-kissed tan.'
    const soul = buildScenePrompt(templates, scenes, views, market, callie, 'trained', { identityBlock: block })
    expect(soul.startsWith('Callie, the saved character.')).toBe(true)
    expect(soul).not.toContain('reference images')
    expect(soul).toContain(block)
    const v = lintPrompt(rules, soul, { stage: 'scene', kind: 'image', request: { kind: 'image', model: 'higgsfield/soul-2', prompt: soul, aspect: '9:16' }, identityBlock: block })
    expect(blocking(v)).toEqual([])
  })

  it('text only uses the full card', () => {
    const t = buildScenePrompt(templates, scenes, views, market, callie, 'text')
    expect(t).toContain('Photo of Callie, 24 years old. Long honey-blonde hair')
  })

  it('states the hair color when water, wind or harsh sun change how hair looks', () => {
    expect(p).not.toMatch(/hair stays/)
    const pool = buildScenePrompt(templates, scenes, views, { ...market, setting: 'At the edge of a pool, hair wet', momentType: 'in_the_water', footwear: 'barefoot' }, callie, 'refs')
    expect(pool).toContain('Her hair stays long honey-blonde and her skin tone is unchanged, even here.')
    expect(hairColorFrom(callie.card)).toBe('long honey-blonde')
  })

  it('soft glam keeps real skin underneath, and makeup words are fine in scenes', () => {
    const night = buildScenePrompt(templates, scenes, views, { ...market, makeup: 'soft_glam', light: 'night_practical' }, callie, 'refs')
    expect(night).toContain('soft glam (bronzer, warm blush, glossy nude-pink lip), with real skin texture still visible underneath')
    expect(blocking(lintPrompt(rules, night, { stage: 'scene', kind: 'image_edit', request: { ...request, prompt: night } }))).toEqual([])
  })

  it('strips smoothing words a field slipped in, and says why', () => {
    const warnings: Array<{ ruleId: string }> = []
    const out = buildScenePrompt(templates, scenes, views, { ...market, moment: 'Callie with flawless skin picks peaches' }, callie, 'refs', { warnings: warnings as never })
    expect(out).not.toMatch(/flawless/i)
    expect(warnings.map(w => w.ruleId)).toContain('realism-banned-words')
  })

  it('every preset field must name a preset', () => {
    expect(checkSceneFields(scenes, views, market)).toEqual([])
    expect(checkSceneFields(scenes, views, { ...market, camera: 'drone' }).map(i => i.field)).toEqual(['camera'])
  })
})

describe('the planner\'s defaults come from the rules switched on', () => {
  it('lists each rule\'s line while it is on, and says when brands are allowed', () => {
    const on = plannerRules(rules, () => true, false)
    expect(on).toContain('Name the footwear, or say barefoot.')
    expect(on).toContain('plain and unbranded')
    const off = plannerRules(rules, id => id !== 'scene-names-footwear', true)
    expect(off).not.toContain('Name the footwear')
    expect(off).not.toContain('plain and unbranded')
    expect(off).toContain('This scene allows real brands and logos')
  })
})

describe('reference picker by angle (SPEC 5.2 rule 14)', () => {
  it('uses the owner\'s own refs when chosen, and only the face when picking by angle is off', () => {
    expect(pickSceneRefs(sheet.shots, views, allApproved, { ...market, refs: ['REF-06', 'REF-00'] }, scenes).map(r => r.refId)).toEqual(['REF-06', 'REF-00'])
    expect(pickSceneRefs(sheet.shots, views, allApproved, market, scenes, false).map(r => r.refId)).toEqual(['REF-00'])
  })

  it('always has the chest-up face ref, then the closest angle, the body and the expression', () => {
    expect(pickSceneRefs(sheet.shots, views, allApproved, market, scenes).map(r => r.refId)).toEqual(['REF-00', 'REF-01', 'REF-07', 'REF-10'])
    expect(pickSceneRefs(sheet.shots, views, allApproved, { view: 'front', framing: 'chest_up', expression: 'neutral' }, scenes).map(r => r.refId)).toEqual(['REF-00'])
    expect(pickSceneRefs(sheet.shots, views, allApproved, { view: 'back', framing: 'full_body', expression: 'neutral' }, scenes).map(r => r.refId)).toEqual(['REF-00', 'REF-05', 'REF-08'])
    expect(pickSceneRefs(sheet.shots, views, allApproved, { view: 'front', framing: 'full_body', expression: 'open_smile' }, scenes).map(r => r.refId)).toEqual(['REF-00', 'REF-06', 'REF-09'])
  })

  it('uses only approved shots and never more than 4', () => {
    const some = new Set(['REF-00', 'REF-02'])
    expect(pickSceneRefs(sheet.shots, views, some, { view: 'profile_right', framing: 'waist_up', expression: 'laughing' }, scenes).map(r => r.refId)).toEqual(['REF-00', 'REF-02'])
    for (const v of Object.keys(views.views)) {
      for (const f of scenes.framings) {
        for (const e of scenes.expressions) {
          const picked = pickSceneRefs(sheet.shots, views, allApproved, { view: v, framing: f.id, expression: e.id }, scenes)
          expect(picked.length).toBeLessThanOrEqual(4)
          expect(picked[0]!.refId).toBe('REF-00')
        }
      }
    }
  })
})

describe('combo log (SPEC 5.2 rule 21)', () => {
  const body = [
    '- 2026-10-12 Caught mid-action / Friend shot / Golden hour / Rooftop',
    '- 2026-10-12 POV / Event photographer, long lens / Golden hour / Rooftop',
    '- 2026-10-12 Caught you / Phone from inside, model zoom / Overcast daylight / Lakeside terrace',
  ].join('\n')

  it('reads Callie\'s entries and finds a repeated moment and camera pair', () => {
    const entries = parseComboLog(body)
    expect(entries).toHaveLength(3)
    expect(entries[1]).toEqual({ date: '2026-10-12', moment: 'POV', camera: 'Event photographer, long lens', light: 'Golden hour', location: 'Rooftop' })
    expect(comboConflict(entries, 'Caught mid-action', 'Friend shot', 10)?.location).toBe('Rooftop')
    expect(comboConflict(entries, 'caught mid action', 'friend SHOT', 10)).not.toBeNull()
    expect(comboConflict(entries, 'Candid laugh', 'Friend shot', 10)).toBeNull()
    expect(comboConflict(entries, 'Caught mid-action', 'Friend shot', 2)).toBeNull()
  })

  it('appends in the same format and keeps the last 10', () => {
    const entry = comboEntryFor(scenes, market, '2026-10-13')
    expect(entry).toEqual({ date: '2026-10-13', moment: 'Candid laugh', camera: 'Friend shot', light: 'Morning light', location: 'Farmers market' })
    let b = body
    for (let i = 0; i < 12; i++) b = appendCombo(b, { ...entry, date: `2026-10-${String(13 + i).padStart(2, '0')}` }, 10)
    const out = parseComboLog(b)
    expect(out).toHaveLength(10)
    expect(out.at(-1)!.date).toBe('2026-10-24')
    expect(b.split('\n').at(-1)).toBe('- 2026-10-24 Candid laugh / Friend shot / Morning light / Farmers market')
  })
})

describe('one-change edits (SPEC 5.3)', () => {
  it('builds the edit template with REALISM and AVOID, and REF-00 only for face edits', () => {
    const p = buildEditPrompt(templates, 'Remove the white logo on the cup in her right hand, leaving that surface plain and unbranded', callie, false)
    expect(p.startsWith('Remove the white logo on the cup in her right hand, leaving that surface plain and unbranded. Keep everything else in the image exactly the same.')).toBe(true)
    expect(p).toContain(callie.realism.block)
    expect(blocking(lintPrompt(rules, p, { stage: 'edit', kind: 'image_edit' }))).toEqual([])
    expect(buildEditPrompt(templates, 'Turn her head toward the lens', callie, true)).toContain('Use the attached reference image only for her face.')
  })

  it('one change per pass (rule 24)', () => {
    expect(oneChangeProblem('Remove the logo on her cap')).toBeNull()
    expect(oneChangeProblem('Remove the logo on her cap. Then close her mouth.')).toMatch(/One change per edit/)
    expect(oneChangeProblem('Remove the logo and also the extra ring')).toMatch(/One change per edit/)
  })
})

describe('the planner', () => {
  it('asks for every field with the preset lists, and its schema matches the field parser', () => {
    const prompt = scenePlanPrompt(templates, scenes, views, callie, 'Something at the farmers market', parseComboLog('- 2026-10-12 POV / Friend shot / Golden hour / Rooftop'))
    expect(prompt).toContain('POV / Friend shot / Golden hour / Rooftop')
    expect(prompt).toContain('friend_phone (Friend shot)')
    expect(prompt).not.toContain(EM)
    const schema = scenePlanJsonSchema(scenes, views) as { required: string[] }
    // The planner fills every creative field; brands and refs are the owner's.
    expect(new Set([...schema.required, 'brands', 'refs'])).toEqual(new Set(Object.keys(sceneFieldsSchema.shape)))
    expect(prompt).toContain('Signature jewelry (optional; add it to jewelry only when it fits, on its')
  })
})
