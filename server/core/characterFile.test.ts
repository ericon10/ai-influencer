import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportCharacterFile, importCharacterFile, importFreeform, splitSections } from './characterFile.js'
import { validateCharacter, type CharacterData } from './character.js'
import { loadConfig } from '../config/load.js'

const fx = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/callie/appendix-a.json'), 'utf8'))
const callie: CharacterData = {
  name: fx.name, age: fx.age, card: fx.card, eyes: fx.eyes, marks: fx.marks, body: fx.body,
  style: { palette: ['honey', 'cream'] }, makeup: fx.makeup, persona: { vibe: 'sunny' }, pronouns: fx.pronouns,
  avoidModels: ['higgsfield/gpt-image-2.5-flare'], preferredModels: { sheet: 'higgsfield/gpt-image-2.5' },
  disclosure: 'Label all posts as AI-generated', notes: 'Soul 2.0 character queued, not required.',
  identities: [], sections: [],
  realism: { block: 'REALISM: Candid phone photo, natural skin texture with visible pores, no retouching.', avoid: 'AVOID: plastic skin, text, watermarks.' },
}
const sheet = [{ id: 'REF-00', label: 'Front, close-up', status: 'approved', checksum: 'abc123' }]

describe('character file', () => {
  it('round-trips: export, import, export is identical', () => {
    const md = exportCharacterFile(callie, sheet)
    const back = importCharacterFile(md)
    expect(back.character).toEqual(callie)
    expect(back.sheet).toEqual(sheet)
    expect(exportCharacterFile(back.character, back.sheet)).toBe(md)
  })

  it('is readable: wrapped sections, side-specific marks, disclosure', () => {
    const md = exportCharacterFile(callie)
    expect(md).toContain('# Callie')
    expect(md).toContain('- Subtle mole above her LEFT brow (subtle)')
    expect(md).toContain('- Gold double-band ear cuff on her LEFT ear')
    expect(md).toContain('> Label all posts as AI-generated')
    for (const line of md.split('\n').filter(l => !l.startsWith('card:') && !l.startsWith('body:') && !l.startsWith('notes:') && !l.startsWith('  description:'))) {
      expect(line.length, line).toBeLessThanOrEqual(120)
    }
  })

  it('applies human edits made in the Card section on import', () => {
    const full = exportCharacterFile(callie)
    const at = full.indexOf('## Card')
    const md = full.slice(0, at) + full.slice(at).replace(/full\s+lips,/, 'very full lips,')
    expect(importCharacterFile(md).character.card).toContain('very full lips')
  })

  it('reads a free-form file written outside the Studio', () => {
    const md = [
      '# Character: Callie', '',
      '**Card:** 24, long honey-blonde beachy waves with a deep side part, warm hazel-brown eyes, soft oval face.', '',
      '## Marks',
      '- Subtle mole above her LEFT brow',
      '- Gold double-band ear cuff on her LEFT ear',
    ].join('\n')
    const r = importFreeform(md)
    expect(r.character.name).toBe('Callie')
    expect(r.character.age).toBe(24)
    // The mole is the only fixed mark; jewelry is a style idea (a default).
    expect(r.character.marks.map(m => [m.name, m.side, m.region, m.kind])).toEqual([
      ['mole', 'LEFT', 'brow', 'skin'],
    ])
    expect(r.character.style.ideas).toContain('Gold double-band ear cuff on her LEFT ear')
    expect(r.warnings[0]).toMatch(/Check the fields/)
    expect(r.warnings.join(' ')).toMatch(/Jewelry is not a fixed mark/)
  })

  it('splits on level-two headings only, ignoring code fences', () => {
    const f = splitSections(['# Character: X', 'intro', '## One', 'a', '### Sub', 'b', '```', '## not a heading', '```', '## Two', 'c'].join('\n'))
    expect(f.title).toBe('Character: X')
    expect(f.sections.map(s => s.title)).toEqual(['One', 'Two'])
    expect(f.sections[0]!.body).toContain('### Sub')
    expect(f.sections[0]!.body).toContain('## not a heading')
    expect(f.sections[1]!.body).toBe('c')
  })
})

// Callie's real character file, written by hand outside the Studio.
describe("Callie's character file", () => {
  const md = readFileSync(join(process.cwd(), 'fixtures/callie/character-callie.md'), 'utf8')
  const models = loadConfig().models.models
  const r = importCharacterFile(md, { models })
  const c = r.character

  it('reads her card, age, eyes and body, with marks and style moved out of the card', () => {
    expect(c.name).toBe('Callie')
    expect(c.age).toBe(24)
    expect(c.eyes).toBe('warm hazel-brown')
    expect(c.card).toMatch(/^24 years old\. Long honey-blonde hair, loose beachy waves, deep side part\./)
    expect(c.card).not.toMatch(/Distinguishing marks|Style:|Callie/)
    expect(c.body).toBe('Fit, athletic build, toned legs, defined waist, naturally curvy hips')
    expect(r.warnings.join(' ')).toMatch(/Moved "Distinguishing mark" and "Style" out of the card/)
    expect(validateCharacter(c)).toEqual([])
  })

  it('reads her one fixed mark with its side; the ear cuff is optional styling, not a mark', () => {
    expect(c.marks).toEqual([
      { name: 'mole', description: 'small, subtle mole', side: 'LEFT', region: 'brow', kind: 'skin', subtle: true },
    ])
    expect(c.style.notes).toMatch(/She sometimes wears a gold double-band ear cuff/)
  })

  it('reads style, makeup, persona, pronouns and disclosure', () => {
    expect(c.pronouns).toEqual({ subj: 'she', obj: 'her', poss: 'her', noun: 'woman' })
    // Style is optional ideas only: no palette, no default outfit.
    expect(c.style.palette).toBeUndefined()
    expect(c.style.pieces).toBeUndefined()
    expect(c.style.ideas).toContain('a butter-yellow ribbed one-piece swimsuit')
    expect(c.style.ideas).toContain('dainty gold jewelry')
    expect(c.style.hair_options).toContain('anything new she tries')
    expect(c.style.notes).toMatch(/^Look: a regular girl whose style evolves; natural glow\./)
    expect(c.style.notes).toMatch(/Jewelry varies freely\./)
    expect(r.warnings.join(' ')).toMatch(/Style is kept as optional ideas only; it never goes into a prompt/)
    expect(c.persona.settings).toContain('tropical coves')
    expect(c.makeup).toEqual({ default: 'natural (light skin, groomed brows, tinted lip)', glam_when: ['nights_out', 'events'], glam: 'soft glam (bronzer, warm blush, glossy nude-pink lip)' })
    expect(c.persona.vibe).toMatch(/^sunny, approachable/)
    // "Usual defaults (overridable, never locks)" is read as defaults.
    expect(c.persona.never).toBeUndefined()
    expect(c.persona.defaults).toMatch(/^light makeup in daytime, real-moment feel over staged ad shoot/)
    expect(c.disclosure).toBe("Label all posted content as AI-generated per each platform's rules.")
  })

  it('reads her trained Soul character with its prompt block and drift lock, and her Element', () => {
    expect(c.identities).toHaveLength(2)
    const [soul, element] = c.identities
    expect(soul).toMatchObject({ provider: 'higgsfield', kind: 'trained', name: 'Callie', externalId: '0fdc33c0-7a1a-40a9-9b12-0dc35f44e29e', status: 'ready', model: 'higgsfield/soul-2' })
    expect(soul!.promptBlock).toMatch(/^Honey-blonde hair, light brown brows, fair skin with a light sun-kissed tan/)
    expect(soul!.promptBlock).toContain('but still clearly blonde.')
    expect(soul!.followUp).toMatchObject({ name: 'Drift lock', model: 'higgsfield/nano-banana-2.1' })
    expect(soul!.followUp!.text).toMatch(/face-only pass/)
    // The owner's file of 2026-10-14 names the "Callie" element first.
    expect(element).toMatchObject({ kind: 'element', name: 'Callie', externalId: '705d2b7d-596d-468e-bd2c-b171799cd7a6', status: 'ready' })
    expect(element!.model).toBeUndefined()
    expect(r.warnings.join(' ')).toMatch(/Soul 2.0 character "Callie", with its prompt block and with a drift lock pass/)
  })

  it('reads her model choices, with Flare as a second choice for stills and nothing avoided', () => {
    expect(c.preferredModels).toEqual({
      scene_still: 'higgsfield/nano-banana-2.1',
      scene_still_alt: 'higgsfield/gpt-image-2.5-flare',
      edit: 'higgsfield/nano-banana-2.1',
      video_final: 'higgsfield/seedance-2.5',
      // "Video, cheap default: Kling 3.0 Pro" (2026-10-14).
      video_test: 'higgsfield/kling-3.0-pro',
      sheet: 'higgsfield/gpt-image-2.5',
    })
    expect(c.avoidModels).toEqual([])
  })

  it('keeps every section it does not model, word for word', () => {
    expect(c.sections.map(s => s.title)).toEqual([
      'Realism principle (most important rule)', 'Style (evolves over time, never a uniform)', 'Voice', 'Persona', 'Reference sheet', 'Fixed blocks', 'Models', 'Scene rules learned',
      'Proven recipe: the candid "caught you" shot', 'Proven recipe: recreate from a real clip (Oct 14, rave)', 'Video rules', 'Combo log (last 10)',
    ])
    const original = splitSections(md).sections
    for (const kept of c.sections) expect(kept.body).toBe(original.find(s => s.title === kept.title)!.body)
  })

  it('reads her REALISM and AVOID blocks, which go into every image prompt, and her Realism principle', () => {
    expect(c.realism.block).toMatch(/^REALISM: Candid iPhone photo, neutral natural light\. Real skin texture: visible pores, soft peach fuzz catching the light on her cheeks and jaw/)
    expect(c.realism.block).toMatch(/no skin smoothing\. Ordinary background, not a professional shoot\.$/)
    expect(c.realism.avoid).toBe('AVOID: studio lighting, perfect symmetry, plastic skin, airbrushed or smoothed skin, beauty filter, heavy makeup, text, watermarks.')
    expect(c.realism.notes?.[0]).toMatch(/^Callie looks real because she is not perfect/)
    expect(c.realism.notes).toContain('Hero and sheet: always bare-faced, no makeup, no retouching.')
    expect(r.warnings.some(w => /REALISM block and AVOID block read/.test(w))).toBe(true)
  })

  it('exports and re-imports without losing anything', () => {
    const sheet = [{ id: 'REF-00', label: 'Front, close-up', status: 'approved', checksum: null }]
    const out = exportCharacterFile(c, sheet)
    expect(out).toContain('## Scene rules learned')
    expect(out).toContain('## Sheet status')
    expect(out).toContain('| REF-04 | Right profile, chest-up | Side shots from her right, driver\'s seat views |')
    const back = importCharacterFile(out, { models })
    expect(back.character).toEqual(c)
    expect(exportCharacterFile(back.character, back.sheet)).toBe(out)
  })
})

// Rule zero: a file's Realism section feeds the REALISM and AVOID blocks.
describe('a Realism section', () => {
  const md = [
    '# Character: Test', '', '## Card', 'Test, 30 years old. Short dark hair.', '',
    '## Fixed blocks', '- REALISM: an older block that the Realism section replaces.', '',
    '## Realism', '- Freckles, pores and the slight redness on her nose always stay.',
    '- REALISM block: Candid phone photo, real skin texture with visible pores and freckles, no retouching.',
    '- AVOID: airbrushed skin, beauty filters, smooth skin, porcelain skin.', '',
  ].join('\n')
  const r = importCharacterFile(md)

  it('reads the block and AVOID line from it, and keeps the rest as notes', () => {
    expect(r.character.realism).toEqual({
      block: 'REALISM: Candid phone photo, real skin texture with visible pores and freckles, no retouching.',
      avoid: 'AVOID: airbrushed skin, beauty filters, smooth skin, porcelain skin.',
      notes: ['Freckles, pores and the slight redness on her nose always stay.'],
    })
  })

  it('keeps the section as written so the file round-trips', () => {
    expect(r.character.sections.map(x => x.title)).toContain('Realism')
  })

  it('says when a file has no REALISM block, and the default is used', () => {
    const plain = importCharacterFile('# Character: Plain\n\n## Card\nPlain, 30.\n')
    expect(plain.character.realism).toEqual({})
    expect(plain.warnings.some(w => /No REALISM block/.test(w))).toBe(true)
  })
})
