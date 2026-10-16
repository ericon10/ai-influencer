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
    expect(rules('You should just unlock it')).toContain('lint-just')
    expect(rules('Honestly you\'ll just send it')).toContain('lint-just')
    expect(rules('It will just sit there')).toContain('lint-just')
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

  it('THE STANDARD on a hook: 15 words or fewer, no label or timestamp to open, one quoted phrase at most', () => {
    // The owner's example reads clean.
    expect(rules('man, uggh, 300 apps already since grad.....is it me fam?', 'hook')).toEqual([])
    // Labels and stage directions from the launch plan's own hooks.
    expect(rules('Exhibit 1: a rejection received at 2:14am. Artist unknown.', 'hook')).toEqual(['lint-hook-label'])
    expect(rules('Levels of ghosted after a final round. Level 5 asks for feedback.', 'hook')).toEqual(['lint-hook-label'])
    expect(rules("Calendar invite, 4:55pm Thursday: 'Round 7: Final conversation (part 2).'", 'hook')).toContain('lint-hook-label')
    expect(rules('Previously on my job hunt: two CEOs, one reorg, zero offers.', 'hook')).toContain('lint-hook-label')
    // A timestamp or a date to open.
    for (const t of ['2:14am. Rejected again, before I was even awake.', 'Sunday 9:40pm, page 4 of 6 wants my resume again.', '11:52 PM and the portal logged me out.', 'Oct 19: still in review.', '"6am" and the recruiter already said no.']) expect(rules(t, 'hook'), t).toContain('lint-hook-label')
    // Not a timestamp: a number that is not a time.
    expect(rules('300 apps and not one human email back.', 'hook')).not.toContain('lint-hook-label')
    expect(rules('5 rounds for a job that pays less. Why.', 'hook')).not.toContain('lint-hook-label')
    // Quotes: two quoted phrases warn; one, or apostrophes, do not.
    expect(rules("Recruiter: 'talk Friday.' Me: 'which Friday?'", 'hook')).toContain('lint-hook-quotes')
    expect(rules('They said "fast-paced" and meant "understaffed".', 'hook')).toContain('lint-hook-quotes')
    expect(rules("Entry level role. 5 years required. Then I scrolled to 'About us.'", 'hook')).not.toContain('lint-hook-quotes')
    expect(rules("It's 2am and I'm still applying. It's fine. I'm fine.", 'hook')).not.toContain('lint-hook-quotes')
    // Over 15 words.
    expect(rules('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', 'hook')).toContain('lint-hook-long')
    expect(rules('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen', 'hook')).not.toContain('lint-hook-long')
    expect(lintCopy('one two three four five six seven eight nine ten', { kind: 'hook', lists: { hookMaxWords: 8 } }).map(h => h.match)).toEqual(['10 words'])
    // Only on a hook: a slide may open with a label.
    expect(rules('Exhibit 2: the follow-up that never came. 2:14am. "a" "b"', 'slide')).toEqual([])
    // Each is a default: switched off, it says nothing.
    expect(rules('Exhibit 1: a rejection.', 'hook', { off: ['lint-hook-label'] })).toEqual([])
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
