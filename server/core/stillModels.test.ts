import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { characterStill, cheapestStill, runsOn, stillPrice } from './stillModels.js'
import { editSlides, shotShowsCharacter, slidePerson, type SlidePerson } from './slides.js'

// Section 30: a slide's still model follows who is in it, on the path the
// owner picked. All data: the models, the price book, the levels.

const cfg = loadConfig()
const { models } = cfg.models
const sc = cfg.pipeline.scenes.settings
const level = (ref: string) => {
  const l = sc.still_levels[sc.still_level]!
  const own = l.models[ref] ?? {}
  return { quality: own.quality ?? l.quality, resolution: own.resolution ?? l.resolution }
}
const empty = cfg.pipeline.content.slideshow.empty_still_models
const FLARE = 'higgsfield/gpt-image-2.5-flare'
const NANO = 'higgsfield/nano-banana-2.1'
const entry = (ref: string) => models.find(m => m.ref === ref)!

describe('the paths a model runs on', () => {
  it('Flare runs on the plan and the API; Nano Banana 2.1 only on the plan', () => {
    expect(runsOn(entry(FLARE), 'account')).toBe(true)
    expect(runsOn(entry(FLARE), 'api')).toBe(true)
    expect(runsOn(entry(NANO), 'account')).toBe(true)
    expect(runsOn(entry(NANO), 'api')).toBe(false)
  })
})

describe('a slide with no one in it: the cheapest model from the price book', () => {
  it('is GPT Image 2.5 Flare at Standard today, on either path: 1 plan credit, or $0.0625 on the API', () => {
    const plan = cheapestStill(models, empty, cfg.pricebook, level, 'account')!
    expect(plan.ref).toBe(FLARE)
    expect(plan.price).toMatchObject({ credits: 1, micros: 0 })
    const api = cheapestStill(models, empty, cfg.pricebook, level, 'api')!
    expect(api.ref).toBe(FLARE)
    expect(api.price).toMatchObject({ credits: null, micros: 62_500 })
  })

  it('follows the price book, not a name: make Nano Banana 2.1 cheaper on the plan and it wins there; the API still cannot run it', () => {
    const pb = { ...cfg.pricebook, entries: cfg.pricebook.entries.map(e => (e.model === 'nano-banana-2.1' ? { ...e, credits: 0.5 } : e)) }
    expect(cheapestStill(models, empty, pb, level, 'account')!.ref).toBe(NANO)
    expect(cheapestStill(models, empty, pb, level, 'api')!.ref).toBe(FLARE)
  })

  it('prices a still in credits on the plan and dollars on the API', () => {
    expect(stillPrice(cfg.pricebook, FLARE, level(FLARE), 'account')).toEqual({ credits: 1, micros: 0, verified: true })
    expect(stillPrice(cfg.pricebook, FLARE, level(FLARE), 'api')).toEqual({ credits: null, micros: 62_500, verified: false })
    expect(stillPrice(cfg.pricebook, NANO, level(NANO), 'account')!.credits).toBe(1.5)
  })
})

describe('a slide that shows the character: the character file\'s stills default', () => {
  it('Callie\'s file (template v1.6: "Scene stills: GPT Image 2.5 Flare by default") runs Flare on both paths', () => {
    const callie = { scene_still: FLARE, scene_still_alt: NANO }
    expect(characterStill(models, callie, sc, 'account')).toMatchObject({ ref: FLARE, from: 'file' })
    expect(characterStill(models, callie, sc, 'api')).toMatchObject({ ref: FLARE, from: 'file' })
  })

  it('a file whose default the path cannot run uses its second choice there, and the default on the plan', () => {
    const file = { scene_still: NANO, scene_still_alt: FLARE }
    expect(characterStill(models, file, sc, 'account')).toMatchObject({ ref: NANO, from: 'file' })
    expect(characterStill(models, file, sc, 'api')).toMatchObject({ ref: FLARE, from: 'file' })
  })

  it('a file that names no stills model uses the Studio\'s default_still_model (Flare)', () => {
    expect(sc.default_still_model).toBe(FLARE)
    expect(characterStill(models, {}, sc, 'account')).toMatchObject({ ref: FLARE, from: 'studio' })
    expect(characterStill(models, { scene_still: NANO }, sc, 'api')).toMatchObject({ ref: FLARE, from: 'studio' })
  })
})

describe('who is in a slide', () => {
  const callie = { name: 'Callie', pronouns: { subj: 'she', obj: 'her', poss: 'her' } }
  it('reads the shot: the name, her pronoun, what she does, a selfie; a thing or a place is no one', () => {
    expect(shotShowsCharacter('typing fast on the laptop on the duvet', callie)).toBe(true)
    expect(shotShowsCharacter('Callie at a blue street mailbox', callie)).toBe(true)
    expect(shotShowsCharacter('close-up of her hands setting down a glass', callie)).toBe(true)
    expect(shotShowsCharacter('mirror selfie in the hallway', callie)).toBe(true)
    expect(shotShowsCharacter('', callie)).toBe(true)
    expect(shotShowsCharacter('a laptop balanced on a steel keg next to a stack of clean glass racks', callie)).toBe(false)
    expect(shotShowsCharacter('close-up of the lock screen preview, phone glow in a dark bedroom', callie)).toBe(false)
    expect(shotShowsCharacter("the window table, only a man's hand and a small closed notebook beside a glass, no face", callie)).toBe(false)
    expect(shotShowsCharacter('morning light on the empty desk', callie)).toBe(false)
  })

  it('a topic slideshow shows no one; the owner\'s pick on the slide card wins over the shot', () => {
    const s = { hook: 'H', slides: ['a', 'b'], stillIds: [], shots: ['typing at the desk', 'the laptop on the bed', 'the laptop on the bed'], people: ['', '', 'character'] as SlidePerson[] }
    expect(slidePerson({ ...s, mode: 'topic' }, 0, callie)).toBe('none')
    expect(slidePerson({ ...s, mode: 'character' }, 0, callie)).toBe('character')
    expect(slidePerson({ ...s, mode: 'character' }, 1, callie)).toBe('none')
    expect(slidePerson({ ...s, mode: 'character' }, 2, callie)).toBe('character')
    expect(slidePerson({ ...s, mode: 'character', people: ['none'] }, 0, callie)).toBe('none')
  })

  it('moving a slide moves its pick with it', () => {
    const s = { hook: 'H', slides: ['a', 'b'], stillIds: [], shots: ['s1', 's2', 's3'], people: ['', 'none', 'character'] as SlidePerson[] }
    expect(editSlides(s, { move: [1, 2] }).people).toEqual(['', 'character', 'none'])
    expect(editSlides(s, { remove: 0 }).people).toEqual(['none', 'character'])
    expect(editSlides(s, { add: 1 }).people).toEqual(['', '', 'none', 'character'])
  })
})
