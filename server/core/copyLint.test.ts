import { describe, expect, it } from 'vitest'
import { hashtagCount, lintCopy, lintPost } from './copyLint.js'
import { readCode, readEffect } from './playbook.js'

// The language lint (UX-PLAN.md section 28): free warnings, never a block.
const rules = (text: string, kind: 'hook' | 'slide' | 'caption' = 'slide', o: Parameters<typeof lintCopy>[1] extends infer T ? Partial<T> : never = {}) => lintCopy(text, { kind, ...o }).map(h => h.rule)

describe('copy lint', () => {
  it('long dashes, values words, hustle words', () => {
    expect(rules(`Rent is due ${String.fromCharCode(8212)} again`)).toContain('lint-dashes')
    expect(rules(`Week 3 ${String.fromCharCode(8211)} week 9`)).toContain('lint-dashes')
    expect(rules('Every resume should sound like you')).toContain('lint-values')
    expect(rules('Recruiters need to call back')).toContain('lint-values')
    expect(rules('I thought it was a great fit')).not.toContain('lint-values')
    expect(rules('Land your dream job this week')).toContain('lint-hype')
    expect(rules('A real game-changer for applications')).toContain('lint-hype')
    expect(rules('Level up your resume')).toContain('lint-hype')
  })

  it('"just" before an instruction, but not "I just applied"', () => {
    expect(rules('Just apply in the first hour')).toContain('lint-just')
    expect(rules('Easy. You can just ask the recruiter')).toContain('lint-just')
    expect(rules('I just applied at 11:52pm')).not.toContain('lint-just')
    expect(rules('It was just a quick chat')).not.toContain('lint-just')
  })

  it('a sentence that starts with "You", but "POV:" and "Your" are fine', () => {
    expect(rules('You will never guess what round 5 was')).toContain('lint-you-start')
    expect(rules('Round 4 ended. You\'re next.')).toContain('lint-you-start')
    expect(rules('POV: you finally get a callback')).not.toContain('lint-you-start')
    expect(rules('Your resume isn\'t bad. It just doesn\'t match.')).not.toContain('lint-you-start')
  })

  it('the product in a hook; more than 5 hashtags; a product caption without "Ad:"', () => {
    expect(rules('SideStep filled the form in one click', 'hook')).toContain('lint-product-hook')
    expect(rules('SideStep filled the form in one click', 'slide')).not.toContain('lint-product-hook')
    expect(rules('Caption #a #b #c', 'caption', { hashtags: ['d', 'e', 'f'] })).toContain('lint-hashtags')
    expect(hashtagCount('Caption #a #b', ['c'])).toBe(3)
    expect(rules('SideStep shows how you match.', 'caption', { product: true })).toContain('lint-ad-caption')
    expect(rules('Ad: SideStep shows how you match.', 'caption', { product: true })).not.toContain('lint-ad-caption')
  })

  it('a check switched off says nothing; lintPost names the slide', () => {
    expect(rules('Every resume should sound like you', 'slide', { off: ['lint-values'] })).toEqual([])
    const hits = lintPost({ texts: ['Hook', 'Slide two should land'], caption: 'Caption', hashtags: [], product: false })
    expect(hits.map(h => [h.rule, h.slide])).toEqual([['lint-values', 1]])
  })

  it('the launch plan\'s own hooks read clean or close to it', () => {
    expect(rules('Exhibit 1: a rejection received at 2:14am. Artist unknown.', 'hook')).toEqual([])
    expect(rules("Entry level role. Requirement 4: 'experience mentoring junior staff.' I am the junior staff.", 'hook')).toEqual([])
  })
})

describe('playbook codes', () => {
  it('reads codes as the plan writes them', () => {
    expect(readCode('S11 Contrast pair')).toBe('S11')
    expect(readCode('L14 Museum exhibit')).toBe('L14')
    expect(readCode('Museum exhibit')).toBe('L14')
    expect(readCode('S4 Is It Worth It?')).toBe('S4')
    expect(readCode('S13')).toBeNull()
    expect(readEffect('E1 That\'s literally me')).toBe('E1')
    expect(readEffect('E9 nothing')).toBeNull()
  })
})
