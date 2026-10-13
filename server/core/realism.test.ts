import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { buildHeroPrompts, buildSheetPrompt } from './prompts.js'
import { blocking, lintPrompt } from './rules.js'
import {
  BARE_FACE_LINE, DEFAULT_REALISM_BLOCK, finalizeImagePrompt, findBannedTerms, forceBeautifyOff,
  hasRealismBlock, realismForReference, stripBannedTerms, suggestsFixingFlaw, treatsFlawAsDefect,
} from './realism.js'
import { mapInput } from '../providers/higgsfield.js'
import { accountModel, accountParams } from '../providers/higgsfieldAccount.js'
import type { ModelEntry } from '../config/load.js'

// Rule zero, the Realism principle: real skin, visible flaws and a bare face
// are the product, and nothing in the pipeline smooths them away.

const cfg = loadConfig()
const { templates, views, rules, sheet } = cfg.pipeline
const callie = {
  card: '24, long honey-blonde hair in loose beachy waves with a deep side part, warm hazel-brown eyes, soft oval face, full lips',
  marks: [
    { name: 'mole', description: 'small subtle mole', side: 'LEFT' as const, region: 'brow' as const, kind: 'skin' as const, subtle: true },
    { name: 'cuff', description: 'gold double-band ear cuff', side: 'LEFT' as const, region: 'ear' as const, kind: 'jewelry' as const, subtle: false },
  ],
  pronouns: { subj: 'she', obj: 'her', poss: 'her', noun: 'woman' },
  body: 'fit, athletic build, defined waist',
  realism: {
    block: 'REALISM: Candid phone photo, natural skin texture with visible pores, small imperfections, ordinary background clutter, no retouching, not a professional shoot.',
    avoid: 'AVOID: studio lighting, perfect symmetry, plastic skin, airbrushed skin, smooth skin, beauty filter, text, watermarks.',
  },
}

describe('REALISM block', () => {
  it('a prompt without it fails the lint for every image kind, and cannot be configured away', () => {
    const p = 'A woman at a farmers market, wearing a white linen shirt.'
    for (const kind of ['image', 'image_edit']) {
      expect(blocking(lintPrompt(rules, p, { kind, stage: 'scene' })).map(v => v.ruleId)).toContain('realism-block')
      expect(blocking(lintPrompt({ ...rules, rules: [] }, p, { kind })).map(v => v.ruleId)).toContain('realism-block')
    }
    // Video and LLM prompts are not image prompts.
    expect(blocking(lintPrompt(rules, p, { kind: 'video' })).map(v => v.ruleId)).not.toContain('realism-block')
  })

  it('is added to every hero and sheet prompt, using the character\'s own block', () => {
    const prompts = [
      ...buildHeroPrompts(templates, views, callie),
      ...sheet.shots.filter(s => s.source !== 'hero').map(s => buildSheetPrompt(templates, views, s, callie)),
    ]
    expect(prompts).toHaveLength(3 + 11)
    // Reference images keep their plain gray background, so the block's
    // background clause is left out of hero and sheet prompts only.
    const reference = 'REALISM: Candid phone photo, natural skin texture with visible pores, small imperfections, no retouching, not a professional shoot.'
    for (const p of prompts) {
      expect(p).toContain(reference)
      expect(p).not.toMatch(/clutter/)
      expect(p).toContain('Plain light gray background')
      expect(p).toContain(callie.realism.avoid)
      expect(hasRealismBlock(p)).toBe(true)
    }
    const plain = buildHeroPrompts(templates, views, { ...callie, realism: {} })[0]!
    expect(plain).toContain(DEFAULT_REALISM_BLOCK)
  })

  it('keeps the background clause in scenes, where the clutter belongs', () => {
    const scene = finalizeImagePrompt('Callie at a farmers market, wearing a white linen shirt.', { stage: 'scene', realism: callie.realism.block }).prompt
    expect(scene).toContain(callie.realism.block)
    expect(realismForReference('REALISM: ordinary background clutter')).toBe(DEFAULT_REALISM_BLOCK)
  })

  it('is added once by the builder, never twice', () => {
    const once = finalizeImagePrompt('A woman reading, wearing a gray sweater.').prompt
    expect(finalizeImagePrompt(once).prompt).toBe(once)
    expect(once.match(/REALISM:/g)).toHaveLength(1)
  })
})

describe('hero and sheet are bare-faced', () => {
  it('every hero and sheet prompt contains the no-makeup line', () => {
    for (const p of buildHeroPrompts(templates, views, callie)) expect(p).toContain(BARE_FACE_LINE)
    for (const s of sheet.shots.filter(x => x.source !== 'hero')) expect(buildSheetPrompt(templates, views, s, callie)).toContain(BARE_FACE_LINE)
  })

  it('keeps the line even when someone edits the template to remove it or add makeup', () => {
    const edited = {
      ...templates,
      hero: { ...templates.hero, base: 'Chest-up portrait of {card}. {variant} Soft glam makeup with red lipstick. {marks}' },
      sheet: { ...templates.sheet, base: 'Keep this {noun} the same. {framing}. {view}. {marks} {expression}{body}{outfit}, full makeup.' },
    }
    const warnings: Parameters<typeof buildHeroPrompts>[3] = { warnings: [] }
    const hero = buildHeroPrompts(edited, views, callie, warnings)[0]!
    expect(hero).toContain(BARE_FACE_LINE)
    expect(hero).not.toMatch(/soft glam|lipstick/i)
    expect(warnings.warnings!.some(w => w.ruleId === 'realism-makeup')).toBe(true)
    const sh = buildSheetPrompt(edited, views, sheet.shots.find(s => s.id === 'REF-01')!, callie)
    expect(sh).toContain(BARE_FACE_LINE)
    expect(sh).not.toMatch(/full makeup/i)
  })

  it('a sheet regenerate note cannot put makeup back', () => {
    const p = buildSheetPrompt(templates, views, sheet.shots.find(s => s.id === 'REF-02')!, callie, 'Add a smoky eye and bold lips.')
    expect(p).toContain(BARE_FACE_LINE)
    expect(p).not.toMatch(/smoky eye|bold lips/i)
    expect(blocking(lintPrompt(rules, p, { stage: 'sheet', kind: 'image_edit' })).filter(v => v.ruleId.startsWith('realism'))).toEqual([])
  })
})

describe('banned-words lint', () => {
  const ALL = ['flawless', 'perfect skin', 'smooth skin', 'airbrushed', 'retouched', 'porcelain', 'beautify', 'glamour retouch', 'skin smoothing', 'beauty filter', 'enhance face']

  it('catches every banned word and phrase', () => {
    for (const term of ALL) {
      const p = `A candid photo of her, ${term}, wearing a denim jacket.`
      expect(findBannedTerms(p).map(h => h.term)).toEqual([term])
      expect(blocking(lintPrompt(rules, p, { stage: 'scene' })).map(v => v.ruleId)).toContain('realism-banned-words')
    }
    expect(findBannedTerms('Flawless, Porcelain-like SMOOTH  SKIN').map(h => h.term)).toEqual(['flawless', 'porcelain', 'smooth skin'])
  })

  it('strips them in the builder and says why', () => {
    const out = finalizeImagePrompt('Close-up of her laughing, flawless glowing skin, airbrushed look, wearing a yellow sundress.')
    // The AVOID block may name them; the description must not.
    expect(out.prompt.split('\n')[0]).not.toMatch(/flawless|airbrushed/i)
    expect(out.prompt).toMatch(/^Close-up of her laughing, glowing skin, wearing a yellow sundress\./)
    expect(stripBannedTerms('full lips, flawless porcelain skin, fit build.').prompt).toBe('full lips, fit build.')
    expect(out.warnings[0]).toMatchObject({ ruleId: 'realism-banned-words', severity: 'warning' })
    expect(out.warnings[0]!.message).toMatch(/"flawless", "airbrushed".*smooth skin away/)
    expect(blocking(lintPrompt(rules, out.prompt, { kind: 'image', stage: 'scene' })).filter(v => v.ruleId.startsWith('realism'))).toEqual([])
  })

  it('leaves negated words and the AVOID block alone', () => {
    expect(findBannedTerms('No airbrushed look, not retouched, without skin smoothing.')).toEqual([])
    expect(findBannedTerms(callie.realism.avoid)).toEqual([])
    // The "no" belongs to the clause before, so this one is caught.
    expect(findBannedTerms('No retouching, flawless glow.').map(h => h.term)).toEqual(['flawless'])
    expect(stripBannedTerms(`Her at the beach.\n${callie.realism.avoid}`).removed).toEqual([])
  })

  it('applies to video prompts too', () => {
    expect(blocking(lintPrompt(rules, 'She turns to the lens, beauty filter, silent, no audio, no dialogue', { kind: 'video' })).map(v => v.ruleId)).toContain('realism-banned-words')
  })
})

describe('adapters force beautify off', () => {
  it('turns off any beautify, face-enhance or skin-smoothing option, nested or not', () => {
    expect(forceBeautifyOff({ beautify: true, face_enhance: 'on', skin_smoothing: 0.8, enhance_prompt: true, prompt: 'x', opts: { restore_faces: true, seed: 1 } }))
      .toEqual({ beautify: false, face_enhance: 'off', skin_smoothing: 0, enhance_prompt: false, prompt: 'x', opts: { restore_faces: false, seed: 1 } })
  })

  it('the REST adapter sends them off, whatever the model config says', () => {
    const soul = cfg.models.models.find(m => m.ref === 'higgsfield/soul-2')!
    expect(mapInput(soul, { kind: 'image', model: soul.ref, prompt: 'p' })).toMatchObject({ enhance_prompt: false })
    const rigged: ModelEntry = { ...soul, force_off: { face_enhancement: true, beauty_mode: 'auto' } }
    expect(mapInput(rigged, { kind: 'image', model: soul.ref, prompt: 'p' })).toMatchObject({ face_enhancement: false, beauty_mode: 'off', enhance_prompt: false })
  })

  it('the account adapter sends them off, even when a fixed value turns one on', () => {
    const nano = cfg.models.models.find(m => m.ref === 'higgsfield/nano-banana-2.1')!
    const rigged = { ...cfg, models: { ...cfg.models, models: cfg.models.models.map(m => m.ref === nano.ref ? { ...m, mcp: { ...m.mcp!, fixed: { beautify: true, face_enhance: 'on' } } } : m) } }
    const params = accountParams(accountModel(rigged, nano.ref), { kind: 'image', model: nano.ref, prompt: 'p' })
    expect(params).toMatchObject({ beautify: false, face_enhance: 'off' })
  })
})

describe('QA keeps the flaws', () => {
  it('knows the natural flaws and suggestions to remove them', () => {
    for (const t of ['visible pores on the nose', 'light freckles', 'slight redness on the cheeks', 'uneven skin tone', 'shine on the forehead', 'flyaway hairs', 'smile lines', 'slight asymmetry', 'small mole above the brow']) {
      expect(treatsFlawAsDefect(t)).toBe(true)
    }
    expect(suggestsFixingFlaw('remove the freckles')).toBe(true)
    expect(suggestsFixingFlaw('smooth the skin texture')).toBe(true)
    expect(suggestsFixingFlaw('the left ear is melted')).toBe(false)
  })
})

// The hero imperfection dose: a real person on a good day, never stacked.
describe('imperfection dose', () => {
  it('removes heavy flaw words the character does not have, and keeps ones the card asks for', async () => {
    const { finalizeImagePrompt: fin } = await import('./realism.js')
    const out = fin('Portrait, slight acne, rough skin and blemishes, wearing a gray tee.', { stage: 'hero' })
    expect(out.prompt.split('\n')[0]).not.toMatch(/acne|rough skin|blemish/i)
    expect(out.warnings.find(w => w.ruleId === 'realism-flaw-dose')!.message).toMatch(/real person on a good day/)
    const asked = fin('Portrait, small scar on her chin, wearing a gray tee.', { stage: 'hero', allowedFlaws: 'small scar on her chin' })
    expect(asked.prompt).toContain('small scar on her chin')
    expect(asked.warnings).toEqual([])
  })

  it('the hero prompts carry one light imperfection line, not a stack', () => {
    for (const p of buildHeroPrompts(templates, views, callie)) {
      expect(p).toContain('natural skin with visible pores and small believable imperfections')
      expect(p).not.toMatch(/\b(acne|blemish|scar|rough skin|freckles)\b/i)
      expect(p).toMatch(/relaxed neutral expression/)
    }
  })
})
