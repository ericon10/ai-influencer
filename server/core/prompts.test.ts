import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load'
import { buildHeroPrompts, buildSheetPrompt } from './prompts'
import { lintPrompt, blocking } from './rules'
import { hardWrap, normalizePrompt } from './text'
import { validateCharacter, type CharacterData } from './character'

const cfg = loadConfig()
const { templates, views, rules, sheet } = cfg.pipeline
const fx = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/callie/appendix-a.json'), 'utf8'))
const ch: Pick<CharacterData, 'card' | 'marks' | 'pronouns' | 'body'> = { card: fx.card, marks: fx.marks, pronouns: fx.pronouns, body: fx.body }
const shot = (id: string) => sheet.shots.find(s => s.id === id)!
const aspectByFraming = sheet.settings.aspect
const EM = String.fromCharCode(0x2014)

describe('sheet prompts', () => {
  it('states hidden marks for the opposite profile (SPEC 5.1 rule 11)', () => {
    const p = buildSheetPrompt(templates, views, shot('REF-04'), ch)
    expect(p).toContain('RIGHT side faces the camera')
    expect(p).toMatch(/LEFT side faces away from the camera, so the subtle mole above her LEFT brow and the gold double-band ear cuff on her LEFT ear are hidden/)
    expect(p).toMatch(/Her RIGHT ear has no jewelry; the ear cuff is only on her LEFT ear/)
    expect(p).toMatch(/Her RIGHT brow has no mark; the mole is only on her LEFT brow/)
  })

  it('tells the front view which side of the image each mark appears on', () => {
    const p = buildSheetPrompt(templates, views, shot('REF-06'), ch)
    expect(p).toMatch(/subtle mole above her LEFT brow and the gold double-band ear cuff on her LEFT ear are visible \(they appear on the right side of the image/)
    expect(p).toMatch(/Her RIGHT ear has no jewelry/)
  })

  it('never mentions legwear or shoes in chest-up shots, and names them for full body', () => {
    for (const s of sheet.shots.filter(x => x.framing === 'chest_up')) {
      const p = buildSheetPrompt(templates, views, s, ch)
      expect(p, s.id).not.toMatch(/jeans|shoes|sneakers|boots/i)
    }
    expect(buildSheetPrompt(templates, views, shot('REF-06'), ch)).toMatch(/high-rise blue jeans and plain white sneakers/)
    expect(buildSheetPrompt(templates, views, shot('REF-06'), ch)).toContain('Build: fit, athletic build')
  })

  it('passes the rules lint for every shot with the right request', () => {
    for (const s of sheet.shots) {
      const p = buildSheetPrompt(templates, views, s, ch)
      const v = lintPrompt(rules, p, {
        stage: 'sheet', framing: s.framing, kind: 'image_edit', marks: ch.marks, aspectByFraming,
        sheetLock: { model: 'mock/image' },
        request: { model: 'mock/image', kind: 'image_edit', aspect: aspectByFraming[s.framing], quality: 'high', resolution: '2k', refs: s.attach.map(a => ({ assetId: a })) },
      })
      expect(blocking(v), s.id).toEqual([])
      expect(p).not.toMatch(/\{[a-zA-Z_]+\}/)
      expect(p).not.toContain(EM)
    }
  })
})

describe('hero prompts', () => {
  it('builds three text-only variants that state both marks', () => {
    const prompts = buildHeroPrompts(templates, views, ch)
    expect(prompts).toHaveLength(3)
    for (const p of prompts) {
      expect(p).toMatch(/^Chest-up portrait of a woman, 24, long honey-blonde/)
      expect(p).toContain('Bare face, no makeup, no retouching.')
      expect(p).toMatch(/\nREALISM: /)
      expect(p).toContain('gold double-band ear cuff on her LEFT ear')
      expect(blocking(lintPrompt(rules, p, { stage: 'hero', framing: 'chest_up', kind: 'image', marks: ch.marks, request: { kind: 'image', model: 'mock/image' } }))).toEqual([])
    }
    expect(new Set(prompts).size).toBe(3)
  })
})

describe('rules engine', () => {
  const lint = (p: string, ctx: Parameters<typeof lintPrompt>[2]) => blocking(lintPrompt(rules, p, ctx)).map(v => v.ruleId)

  it('rejects attachments on the hero run (5.1.1)', () => {
    expect(lint('Chest-up portrait', { stage: 'hero', request: { refs: [{ assetId: 'insp' }] } })).toContain('hero-text-only')
  })
  it('rejects glam on hero and sheet (5.1.3)', () => {
    expect(lint('soft glam with a bold lip', { stage: 'sheet' })).toContain('natural-baseline')
  })
  it('rejects jeans in a chest-up prompt (5.1.8)', () => {
    expect(lint('white tee and jeans', { framing: 'chest_up' })).toContain('chest-up-no-legwear')
  })
  it('rejects cup sizes and measurements (5.1.9)', () => {
    expect(lint('a C cup', {})).toContain('neutral-body-cups')
    expect(lint('measurements 34-24-36', {})).toContain('neutral-body-measurements')
    expect(lint('holding a cup of coffee', {})).toEqual([])
  })
  it('rejects a model switch mid-sheet (5.1.7)', () => {
    expect(lint('x', { stage: 'sheet', sheetLock: { model: 'higgsfield/gpt-image-2.5' }, request: { model: 'higgsfield/nano-banana-2' } })).toContain('sheet-one-model')
  })
  it('enforces audio off and silent phrasing for video (5.4.27-29)', () => {
    const ok = 'listens, nods. Style: silent, no audio, no dialogue. Avoid: talking, singing, exaggerated mouth movement'
    expect(lint(ok, { kind: 'video', request: { kind: 'video', audio: false, startFrame: { assetId: 's' } } })).toEqual([])
    expect(lint(ok, { kind: 'video', request: { kind: 'video', startFrame: { assetId: 's' } } })).toContain('video-audio-off')
    expect(lint('her mouth moving as she talks. silent, no audio, no dialogue', { kind: 'video', request: { kind: 'video', audio: false, startFrame: { assetId: 's' } } })).toContain('video-no-talking')
    expect(lint('silent, no audio, no dialogue', { kind: 'video', request: { kind: 'video', audio: false } })).toContain('video-image-only')
  })
  it('rejects em-dashes in generated copy (5.7.42)', () => {
    expect(lint(`calm ${EM} warm`, {})).toContain('no-em-dash')
  })
})

describe('text helpers', () => {
  it('normalizes prompts and removes em-dashes', () => {
    expect(normalizePrompt(`  a  .  b ${EM} c ,  d .`)).toBe('a. b, c, d.')
  })
  it('hard-wraps long prompts for display', () => {
    const long = buildSheetPrompt(templates, views, shot('REF-04'), ch)
    const wrapped = hardWrap(long, 72)
    for (const line of wrapped.split('\n')) expect(line.length).toBeLessThanOrEqual(72)
    expect(wrapped.replace(/\n/g, ' ')).toBe(long.replace(/\n/g, ' '))
  })
})

describe('character validation', () => {
  it('requires adults, sided marks and neutral body terms', () => {
    expect(validateCharacter({ age: 24, card: fx.card, marks: fx.marks, body: fx.body })).toEqual([])
    const bad = validateCharacter({ age: 17, card: 'x', marks: [], body: 'a DD cup' })
    expect(bad.map(i => i.field)).toEqual(expect.arrayContaining(['age', 'marks', 'body']))
  })
})

// Callie's file: style is optional suggestions, never put into a prompt;
// only the left-ear cuff is constant.
describe("a character's style never reaches a prompt", () => {
  it('keeps every style idea out of the hero and all twelve sheet prompts', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { importCharacterFile } = await import('./characterFile')
    const { buildHeroPrompts, buildSheetPrompt } = await import('./prompts')
    const { loadConfig } = await import('../config/load')
    const cfg = loadConfig()
    const c = importCharacterFile(readFileSync(join(process.cwd(), 'fixtures/callie/character-callie.md'), 'utf8'), { models: cfg.models.models }).character
    const prompts = [
      ...buildHeroPrompts(cfg.pipeline.templates, cfg.pipeline.views, c),
      ...cfg.pipeline.sheet.shots.map(shot => buildSheetPrompt(cfg.pipeline.templates, cfg.pipeline.views, shot, c)),
    ]
    expect(c.style.ideas?.length).toBeGreaterThan(5)
    for (const p of prompts) {
      for (const idea of [...(c.style.ideas ?? []), ...(c.style.hair_options ?? [])]) expect(p.toLowerCase()).not.toContain(idea.toLowerCase())
      expect(p).not.toMatch(/butter-yellow|linen|sundress|pastel/i)
    }
    // The cuff is the one constant, stated with its side in every sheet prompt.
    for (const p of prompts.slice(3)) expect(p).toMatch(/gold double-band ear cuff/)
  })

  it('requires every scene to name its own outfit and never carry one over', async () => {
    const { lintPrompt, blocking } = await import('./rules')
    const { loadConfig } = await import('../config/load')
    const rules = loadConfig().pipeline.rules
    const ids = (p: string) => blocking(lintPrompt(rules, p, { stage: 'scene' })).map(v => v.ruleId)
    expect(ids('She laughs at a cafe table, same outfit as before.')).toEqual(expect.arrayContaining(['scene-names-outfit', 'scene-no-carried-outfit']))
    expect(ids('She laughs at a cafe table, wearing a cream linen shirt, light jeans and white sandals.')).not.toContain('scene-names-outfit')
  })
})
