import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { lintPrompt } from './rules.js'
import { catalogWording, findRiskyWords, saferPrompt } from './wording.js'

// Catalog wording (owner, 2026-10-15; DECISIONS G46): only the words
// change, never what she wears, and the owner's own words go as typed.
const cfg = loadConfig()
const w = cfg.pipeline.wording
const clean = (text: string, own = '') => catalogWording(text, w, own).text

describe('catalog wording', () => {
  it('keeps the garment, its color, fabric, straps and style word', () => {
    const outfit = 'dark green ribbed tank top with thin straps, going-out look'
    expect(clean(outfit)).toBe(outfit)
    expect(clean('black satin slip dress, halter neck')).toBe('black satin slip dress, halter neck')
    expect(clean('cream cotton bodysuit and light wash jeans')).toBe('cream cotton bodysuit and light wash jeans')
  })

  it('takes fit words out where they stand', () => {
    expect(clean('dark green fitted ribbed tank top with thin straps')).toBe('dark green ribbed tank top with thin straps')
    expect(clean('a tight, low-cut black top and a sheer white shirt')).toBe('a black top and a white shirt')
    expect(clean('a skin-tight orange tank top')).toBe('an orange tank top')
    expect(clean('A black dress with a deep v-neck, going-out look')).toBe('A black dress, going-out look')
  })

  it('drops the phrase that names a body word, never the garment', () => {
    expect(clean('high-waisted linen trousers, fitted at the waist')).toBe('high-waisted linen trousers')
    expect(clean('a cropped tee showing off her toned midriff, light wash jeans')).toBe('a cropped tee, light wash jeans')
    expect(clean('a slip dress that skims her hips')).toBe('a slip dress')
    expect(clean('She sways her hips to the beat, then turns away.')).toBe('She sways to the beat, then turns away.')
  })

  it('keeps framing, camera height, hair length and furniture', () => {
    const text = 'Waist-up framing, the camera at waist height, waist-length hair, one hand on the table legs.'
    expect(clean(text)).toBe(text)
    expect(findRiskyWords(text, w)).toEqual([])
  })

  it('swaps names that sound like underwear for the everyday garment', () => {
    expect(clean('grey boy shorts and a white sports bra')).toBe('grey bike shorts and a white athletic crop top')
    expect(clean('Bralette in black lace')).toBe('Crop top in black lace')
  })

  it('a moment, not a pose', () => {
    expect(clean('Callie posing in a dark green tank top by the sink.')).toBe('Callie wearing a dark green tank top by the sink.')
    expect(clean('She is posing by the window.')).toBe('She is standing by the window.')
  })

  it('never touches a word the owner typed', () => {
    const r = catalogWording('A tight black tank top and boy shorts, fitted at the waist.', w, 'tight black tank, boy shorts')
    expect(r.text).toBe('A tight black tank top and boy shorts.')
    expect(r.changed.sort()).toEqual(['fitted', 'waist'])
  })

  it('leaves the AVOID block and every other word alone', () => {
    const text = 'She turns the light on. AVOID: no tight framing, no posing.'
    expect(clean(text)).toBe(text)
    expect(clean('A fitted tee. She turns the light on.\nAVOID: posing')).toBe('A tee. She turns the light on.\nAVOID: posing')
  })

  it('keeps labeled video lines one per line', () => {
    const text = 'FORMAT: 9:16\nSUBJECT: Callie in a fitted ribbed tank top.\nACTION: She refills her water bottle.'
    expect(clean(text)).toBe('FORMAT: 9:16\nSUBJECT: Callie in a ribbed tank top.\nACTION: She refills her water bottle.')
  })
})

describe('risky words and the safer retry', () => {
  it('names each risky word once, outside the AVOID block', () => {
    expect(findRiskyWords('A skin-tight black top with a deep v-neck and boy shorts, toned legs. AVOID: sheer', w).sort()).toEqual(['boy shorts', 'deep v-neck', 'legs', 'skin-tight', 'toned'])
  })

  it('warns on the owner\'s words and says they go as typed (a default, never blocking)', () => {
    const v = lintPrompt(cfg.pipeline.rules, 'Callie in a tight black tank top. REALISM: Natural skin texture, not retouched.', { stage: 'scene', kind: 'image' })
    const risky = v.find(x => x.ruleId === 'wording-risky')
    expect(risky).toMatchObject({ severity: 'warning', title: 'May be blocked by the provider\'s filter', message: 'tight. Your words go as typed.' })
    expect(lintPrompt(cfg.pipeline.rules, 'Callie in a tight black tank top.', { stage: 'scene', kind: 'image', switches: { on: id => id !== 'wording-risky', value: () => undefined } }).some(x => x.ruleId === 'wording-risky')).toBe(false)
  })

  it('rewords every risky word that was sent, by code (free)', () => {
    const r = saferPrompt('Callie in a tight black tank top and boy shorts by the sink. REALISM: Natural skin texture, not retouched.', w)
    expect(r.text).toBe('Callie in a black tank top and bike shorts by the sink. REALISM: Natural skin texture, not retouched.')
    expect(r.changed.sort()).toEqual(['boy shorts', 'tight'])
  })
})
