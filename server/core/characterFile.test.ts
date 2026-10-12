import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportCharacterFile, importCharacterFile, importFreeform } from './characterFile'
import type { CharacterData } from './character'

const fx = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/callie/appendix-a.json'), 'utf8'))
const callie: CharacterData = {
  name: fx.name, age: fx.age, card: fx.card, eyes: fx.eyes, marks: fx.marks, body: fx.body,
  style: { palette: ['honey', 'cream'] }, makeup: fx.makeup, persona: { vibe: 'sunny' }, pronouns: fx.pronouns,
  avoidModels: ['higgsfield/gpt-image-2.5-flare'], preferredModels: { sheet: 'higgsfield/gpt-image-2.5' },
  disclosure: 'Label all posts as AI-generated', notes: 'Soul 2.0 character queued, not required.',
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
    expect(r.character.marks.map(m => [m.name, m.side, m.region, m.kind])).toEqual([
      ['mole', 'LEFT', 'brow', 'skin'],
      ['ear cuff', 'LEFT', 'ear', 'jewelry'],
    ])
    expect(r.warnings[0]).toMatch(/Check every field/)
  })
})
