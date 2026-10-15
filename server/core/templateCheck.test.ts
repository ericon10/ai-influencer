import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkTemplate } from './templateCheck.js'
import { readBrand, writeBrand, winningStackLine, brandCheckLine } from './brand.js'
import { splitSections } from './characterFile.js'

// Character template v1.6 (owner, 2026-10-15, long run part 3): the free
// check of a character file, and the brand layer read from and written
// back into the file's own sections.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const CALLIE = read('fixtures/callie/character-callie.md')
const WREN = read('fixtures/template/character-wren.md')
const tpl = read('docs/character-template.md')
const BLANK = tpl.slice(tpl.indexOf('```markdown\n') + 12, tpl.lastIndexOf('```'))

describe('the template check', () => {
  it('Callie\'s current file: everything needed is there; the brand layer is optional and listed', () => {
    const r = checkTemplate(CALLIE)
    expect(r.complete).toBe(true)
    expect(r.needed.map(n => n.id)).toEqual(['realism', 'models', 'scene-rules', 'video-rules', 'recipe-candid', 'recipe-recreate', 'age', 'mark', 'refs', 'element'])
    expect(r.needed.find(n => n.id === 'scene-rules')!.detail).toBe('Found: "Scene rules learned".')
    expect(r.needed.find(n => n.id === 'mark')!.detail).toMatch(/mole, LEFT brow/)
    expect(r.needed.find(n => n.id === 'element')!.detail).toMatch(/^705d2b7d-596d-468e-bd2c-b171799cd7a6/)
    expect(r.missingOptional).toEqual(['Brand', 'Why people watch', 'Voice card', 'Build notes', 'Stress test', 'Identity fixes', 'Competitors', 'Accounts', 'Monetization', 'Winning stack', 'Growth log'])
    // Her saved identity is a line in Models, so it is not listed as missing.
    expect(r.missingOptional).not.toContain('Saved identity')
    expect(r.brackets).toEqual([])
  })

  it('a full v1.6 file: nothing missing', () => {
    const r = checkTemplate(WREN)
    expect(r.complete).toBe(true)
    expect(r.missingOptional).toEqual([])
    expect(r.brackets).toEqual([])
    expect(r.needed.find(n => n.id === 'element')!.detail).toBe('4b2a1c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d (in the saved identity).')
  })

  it('the blank template: no mark, an Element without its ID, and every [bracket] named; never throws', () => {
    const r = checkTemplate(BLANK)
    expect(r.complete).toBe(false)
    expect(r.needed.find(n => n.id === 'mark')!.ok).toBe(false)
    expect(r.needed.find(n => n.id === 'element')).toMatchObject({ ok: false, detail: expect.stringMatching(/without its ID/) })
    expect(r.brackets).toContain('Brand')
    expect(r.brackets).toContain('Realism principle (UNIVERSAL)')
  })

  it('a file missing a UNIVERSAL section and labels says what to add; an Element is only checked when named', () => {
    const cut = CALLIE.replace(/## Video rules[\s\S]*?(?=## Disclosure)/, '').replace('| REF-07 | Side, full body | Walking, full-body side shots |\n', '')
    const r = checkTemplate(cut.replace(/Saved identity: Higgsfield Elements[^\n]*\n/, ''))
    expect(r.needed.find(n => n.id === 'video-rules')).toMatchObject({ ok: false, detail: 'Missing. Copy the "Video rules" section from the template unchanged.' })
    expect(r.needed.find(n => n.id === 'refs')).toMatchObject({ ok: false, detail: 'Not labeled: REF-07.' })
    expect(r.needed.some(n => n.id === 'element')).toBe(false)
    expect(checkTemplate('# Character: Nobody\n').needed.find(n => n.id === 'age')!.ok).toBe(false)
    expect(checkTemplate('# Character: Kid\n\n## Card\nKid, 19 years old.\n').needed.find(n => n.id === 'age')!.detail).toBe('19 is under 21. Characters are 21 or older.')
  })
})

describe('the brand layer', () => {
  const sections = splitSections(WREN).sections
  it('reads the brand statement, series, running bits, cast, accounts, winning stack and growth log', () => {
    const b = readBrand(sections)
    expect(b.statement).toBe('Wren, the slow trail runner who shows the real side of getting outside on a budget')
    expect(b.series).toEqual(['Slow Mile Monday', 'Trip under $100', 'Gear I regret'])
    expect(b.cast).toEqual(['Jules the roommate', 'her dad on the phone'])
    expect(b.accounts).toMatch(/^- Main: @wren\.runs/)
    expect(b.winningStack).toEqual(['The mishap in the first second', 'Out-of-breath voiceover', 'Golden-hour trail'])
    expect(b.growthLog).toHaveLength(1)
    // The blank template's placeholders are not values.
    const blank = readBrand(splitSections(BLANK).sections)
    expect(blank).toMatchObject({ statement: '', series: [], accounts: '', winningStack: [], growthLog: [] })
  })
  it('writes each change back into its own bullet, keeping every other line as written', () => {
    const next = writeBrand(sections, { statement: 'Wren, the slow runner', series: ['Slow Mile Monday', 'Trail ratings'], growthLog: ['2026-09: first', '2026-10: second'] })
    const brand = next.find(s => s.title === 'Brand')!.body.split('\n')
    expect(brand).toContain('- Brand statement: Wren, the slow runner')
    expect(brand).toContain('- Sub-interest (optional): the slowest runner in every race')
    expect(next.find(s => s.title === 'Why people watch')!.body.split('\n')[0]).toBe('- Series: Slow Mile Monday; Trail ratings')
    expect(next.find(s => s.title === 'Growth log')!.body).toBe('- 2026-09: first\n- 2026-10: second')
    expect(next.map(s => s.title)).toEqual(sections.map(s => s.title))
    expect(readBrand(next).statement).toBe('Wren, the slow runner')
  })
  it('adds a missing section before Disclosure and the combo log, in the template\'s words', () => {
    const next = writeBrand([{ title: 'Card', body: 'x' }, { title: 'Disclosure', body: 'AI' }, { title: 'Combo log (last 10)', body: '' }], { statement: 'A line', winningStack: ['one', 'two'] })
    expect(next.map(s => s.title)).toEqual(['Card', 'Brand', 'Winning stack (from the last growth review)', 'Disclosure', 'Combo log (last 10)'])
    expect(next[1]!.body).toBe('- Brand statement: A line')
  })
  it('the lines the writers get', () => {
    const b = readBrand(sections)
    expect(winningStackLine(b)).toBe('Winning stack from the last growth review: every post carries these for the next 30 days, where they fit this shot and inside the fixed rules: The mishap in the first second; Out-of-breath voiceover; Golden-hour trail.')
    expect(brandCheckLine(b)).toMatch(/^Brand statement: Wren, the slow trail runner who shows the real side of getting outside on a budget\. Check each option against it/)
    expect(winningStackLine(readBrand([]))).toBe('')
  })
})
