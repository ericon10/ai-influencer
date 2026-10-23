import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { DOUG } from './faceless.js'
import { draftVisual } from './weeks.js'
import { newPostRowId, placeFit, postLine, postPlace, rankPlaces, themesOf } from './postRow.js'

// Line first, both doors (UX-PLAN.md section 43): a post's line and place
// read the same way for a New post and a Weeks row, and the place fit puts
// the places that suit a line first (a money line: the gas station).

const themes = loadConfig().pipeline.content.weeks.place_themes
const places = DOUG.file.places

describe('the line and place of a post', () => {
  it('a video post\'s caption, a slideshow\'s hook, its bank line and mode', () => {
    expect(postLine('meme', { caption: 'rent went up $400', week: { lineId: 'bl_1' } })).toEqual({ text: 'rent went up $400', lineId: 'bl_1', mode: 'bank' })
    expect(postLine('slideshow', { hook: 'my own words' })).toEqual({ text: 'my own words', lineId: null, mode: 'own' })
    expect(postLine('meme', { caption: '', lineMode: 'none' }).mode).toBe('none')
    expect(postLine('meme', {}).mode).toBeNull()
  })
  it('the place: a faceless post\'s, a text card\'s, or the plan row\'s', () => {
    expect(postPlace({ faceless: { placeId: 'IS044' } })).toBe('IS044')
    expect(postPlace({ card: { placeId: 'IS015' } })).toBe('IS015')
    expect(postPlace({ plan: { placeId: 'IS016' } })).toBe('IS016')
    expect(postPlace({})).toBeNull()
  })
  it('a New post\'s row id', () => {
    expect(newPostRowId('ci_01abcdef9z')).toMatch(/^NP[0-9A-Z]{4}$/)
  })
})

describe('the place fit', () => {
  it('a money line suggests the gas station first', () => {
    expect(themesOf('forty bucks of gas is my whole week', themes, 'line')).toContain('money')
    expect(themesOf('rent went up $400 and i have $12', themes, 'line')).toContain('money')
    const ranked = rankPlaces('rent went up $400 and i have $12', places, themes)
    expect(ranked[0]!.id).toBe('gas-station')
    expect(ranked[0]!.themes).toContain('money')
  })
  it('a night line suggests the kitchen table at night over the gas station', () => {
    const fit = new Map(placeFit('awake at 3am again, alone', places, themes).map(p => [p.id, p.score]))
    expect(fit.get('kitchen-table')!).toBeGreaterThan(fit.get('highway')!)
  })
  it('no line: every place scores 0 and the least used comes first', () => {
    const ranked = rankPlaces('', places, themes, new Map([['car-rain', 3]]))
    expect(ranked.every(r => r.score === 0)).toBe(true)
    expect(ranked.at(-1)!.id).toBe('car-rain')
  })
  it('Weeks Fill drafts with the same fit', () => {
    const v = draftVisual({ postType: 'faceless', line: 'paycheck gone in two days, rent due', storyBeat: '', name: 'Doug', places: places.map(p => ({ ...p, motion: p.motion ?? '' })), placeUse: new Map(), sounds: [], settings: [], seed: 7, themes })
    expect(v.placeId).toBe('gas-station')
  })
})
