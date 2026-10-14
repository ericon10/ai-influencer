import { describe, expect, it } from 'vitest'
import { parseTakeName, phrases, transcript, voiceCaptions, type Word } from './voiceLines.js'
import { cleanVoiceCard, parseVoiceSection, voiceCardText } from './voiceCard.js'
import { effectiveCut } from './cut.js'

const w = (text: string, start: number, end: number): Word => ({ text, start, end })

describe('take names', () => {
  it('reads the hook number and the line from a take file name', () => {
    expect(parseTakeName('047_check-my-match-score.wav')).toEqual({ hook: 47, line: 'check my match score', title: 'Check my match score' })
    expect(parseTakeName('C:\\takes\\003 entry_level.WAV')).toEqual({ hook: 3, line: 'entry level', title: 'Entry level' })
    expect(parseTakeName('hook-12_why-easy-apply.mp3').hook).toBe(12)
  })

  it('keeps the words of a name without a number', () => {
    expect(parseTakeName('ghosted-after-the-final-round.wav')).toEqual({ hook: null, line: 'ghosted after the final round', title: 'Ghosted after the final round' })
    expect(parseTakeName('050.wav')).toEqual({ hook: 50, line: '', title: 'Hook 50' })
  })
})

describe('captions from a voice line', () => {
  const words = [
    w('Entry', 0.2, 0.5), w('level.', 0.55, 0.9),
    w('Five', 1.4, 1.6), w('years', 1.65, 1.9), w('experience.', 1.95, 2.6),
    w('Pick', 3.2, 3.4), w('one', 3.45, 3.7), w('😭', 3.75, 3.9),
  ]

  it('breaks the words into short phrases where the speaker breaks', () => {
    const p = phrases(words)
    expect(p.map(x => x.text)).toEqual(['Entry level.', 'Five years experience.', 'Pick one 😭'])
    expect(p[1]).toMatchObject({ start: 1.4, end: 2.6 })
    expect(p[1]!.words).toHaveLength(3)
  })

  it('caps a phrase at a few words and seconds', () => {
    const long = Array.from({ length: 14 }, (_, i) => w(`w${i}`, i * 0.3, i * 0.3 + 0.25))
    const p = phrases(long, { maxWords: 6, maxSec: 2.4, pauseSec: 0.35, maxPhrases: 8 })
    expect(p.every(x => x.words.length <= 6)).toBe(true)
    expect(p.flatMap(x => x.words)).toHaveLength(14)
  })

  it('joins the shortest neighbors when there are more phrases than captions allowed', () => {
    const many = Array.from({ length: 12 }, (_, i) => w(`w${i}.`, i, i + 0.4))
    const p = phrases(many, { maxWords: 6, maxSec: 2.4, pauseSec: 0.35, maxPhrases: 4 })
    expect(p).toHaveLength(4)
    expect(p.flatMap(x => x.words.map(y => y.text)).join(' ')).toBe(transcript(many))
  })

  it('times captions on the video: shifted by where the line starts, held until the next phrase', () => {
    const c = voiceCaptions(words, 1.5)
    expect(c.map(x => x.id)).toEqual(['voice0', 'voice1', 'voice2'])
    expect(c[0]).toMatchObject({ text: 'Entry level.', start: 1.7, end: 2.9 })
    expect(c[2]!.end).toBeCloseTo(3.9 + 1.5 + 0.6, 3)
    expect(c[1]!.words[0]).toEqual({ text: 'Five', start: 2.9, end: 3.1 })
  })

  it('the cut uses the voice line\'s captions only when its switch is on', () => {
    const base = { clipId: 'cand_a', brollId: null, order: 'clip_first' as const, brollStart: 0, brollSeconds: 6 }
    expect(effectiveCut({ ...base, sound: { voice: { at: 0, captions: true, words } } }).captions.map(x => x.text)).toEqual(['Entry level.', 'Five years experience.', 'Pick one 😭'])
    expect(effectiveCut({ ...base, sound: { voice: { at: 0, captions: false, words } } }).captions).toEqual([{ id: 'main', text: null, start: 0, end: null }])
    expect(effectiveCut({ ...base, sound: { voice: null } }).captions[0]!.id).toBe('main')
  })
})

describe('the voice card', () => {
  // Callie's card from the SideStep script kit, as a "## Voice" section.
  const callie = [
    { key: 'Who', value: '24, recently graduated, figuring out the job market, sunny and a little chaotic.' },
    { key: 'POV', value: '"my friend / my roommate / me" storytime. Relatable, never preachy.' },
    { key: 'Talks like', value: 'casual, short sentences, a bit dramatic for laughs. "be so for real," "I\'m crying," "not me doing..."' },
    { key: 'Humor', value: 'self-roasting, laughing at how absurd the job market is.' },
    { key: 'Emoji', value: '😭 💀 🥲, one per caption, at the end.' },
    { key: 'Never', value: 'corporate words ("leverage," "synergy"), hard selling, lecturing.' },
    { key: 'Pillars', value: 'storytime, relatable pain, small wins, soft product.' },
    { key: 'Example (hook 3)', value: '"entry level but they want 5 years experience. I\'m 24. Be so for real 😭"' },
    { key: 'ElevenLabs voice ID', value: '`21m00Tcm4TlvDq8ikWAM`' },
  ]

  it('reads a script-kit voice card', () => {
    const v = parseVoiceSection(callie)
    expect(v.elevenlabsId).toBe('21m00Tcm4TlvDq8ikWAM')
    expect(v.uses).toEqual(['be so for real', 'I\'m crying', 'not me doing...'])
    expect(v.never).toEqual(['corporate words', 'leverage', 'synergy', 'hard selling', 'lecturing'])
    expect(v.pillars).toEqual(['storytime', 'relatable pain', 'small wins', 'soft product'])
    expect(v.example).toBe('entry level but they want 5 years experience. I\'m 24. Be so for real 😭')
    expect(v.emoji).toMatch(/one per caption/)
  })

  it('writes the card as plain lines for a writer, and nothing when there is no card', () => {
    const text = voiceCardText('Callie', parseVoiceSection(callie))
    expect(text).toMatch(/^Callie's voice card/)
    expect(text).toMatch(/- Never: corporate words; leverage; synergy; hard selling; lecturing/)
    expect(text).not.toMatch(/21m00/)
    expect(voiceCardText('Callie', {})).toBe('')
    expect(voiceCardText('Callie', { elevenlabsId: 'abc' })).toBe('')
  })

  it('cleans a stored card of any shape', () => {
    expect(cleanVoiceCard({ talks: '  dry ', uses: 'no cap, lowkey', never: ['', 'hustle'], bogus: 1 })).toEqual({ talks: 'dry', uses: ['no cap', 'lowkey'], never: ['hustle'] })
    expect(cleanVoiceCard(null)).toEqual({})
  })
})
