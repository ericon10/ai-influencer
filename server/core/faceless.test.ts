import { describe, expect, it } from 'vitest'
import { DOUG, FACELESS_ENDING, facelessProductPrompt, facelessStillPrompt, readFaceless } from './faceless.js'

// Faceless still rules (owner, 2026-10-22; UX-PLAN.md section 35, item 4c).
describe('faceless stills', () => {
  it('a place from the bank: upright portrait, level, the fixed ending, no people', () => {
    const { prompt, warnings } = facelessStillPrompt({ place: DOUG.file.places[0]!, look: DOUG.file.look })
    expect(prompt).toMatch(/^the inside of a parked used sedan, rain streaming down the windshield/)
    expect(prompt).toContain('upright portrait, level.')
    expect(prompt.endsWith(FACELESS_ENDING)).toBe(true)
    expect(prompt).toContain('Muted, rainy Midwest color.')
    // The look rules about people and text are the Studio's own lines, not repeated.
    expect(prompt).not.toContain('hands read as AI')
    expect(warnings).toEqual([])
  })

  it('takes "slightly tilted" out (Soul rotated the frame); warns on hands and on objects that carry text', () => {
    const r = facelessStillPrompt({ line: 'a kitchen table, slightly tilted, his hands around a mug, a cereal box and the mail' })
    expect(r.prompt).not.toMatch(/tilt/i)
    expect(r.warnings.map(w => w.id)).toEqual(['faceless-tilt', 'faceless-person', 'faceless-text'])
  })

  it('a product post: the edit model keeps the label as in the photo', () => {
    expect(facelessProductPrompt(facelessStillPrompt({ line: 'a car cup holder in the rain' }).prompt, 'Gatorade bottle')).toMatch(/label and packaging unchanged.*No people\.$/)
  })

  it('a stored file reads back with its fields, missing ones empty', () => {
    expect(readFaceless(DOUG.file)).toEqual(DOUG.file)
    expect(readFaceless({ persona: { who: 'x' } }).places).toEqual([])
  })
})

describe('the sound to add in the app (2026-10-22)', () => {
  it('names the music and the voiceover words; nothing when neither is set', async () => {
    const { soundToAdd, soundLine } = await import('./faceless.js')
    expect(soundToAdd({ musicName: 'Sad piano bed', voiceover: { search: 'it is what it is' } })).toEqual({ music: 'Sad piano bed', voiceover: 'it is what it is' })
    expect(soundLine(soundToAdd({ musicName: 'Sad piano bed' }))).toBe('Add this sound in the app: music "Sad piano bed"')
    expect(soundToAdd({})).toBeNull()
  })
})
