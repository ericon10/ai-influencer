import { describe, expect, it } from 'vitest'
import { hashtagCount, lintCopy, lintPost } from './copyLint.js'
import { readCode, readEffect } from './playbook.js'

// The language lint (UX-PLAN.md section 28): free warnings, never a block.
// These checks are SideStep's rules (section 29): `standard` on, with the
// post's product (SideStep) as the name never in a hook.
// The line lint (setup first, no clear emotion) has its own tests below and
// is left out of these.
const LINE = ['lint-hit-first', 'lint-emotion']
const rules = (text: string, kind: 'hook' | 'slide' | 'caption' = 'slide', o: Parameters<typeof lintCopy>[1] extends infer T ? Partial<T> : never = {}) => lintCopy(text, { kind, standard: true, lists: { products: ['SideStep'] }, ...o, off: [...(o.off ?? []), ...LINE] }).map(h => h.rule)

describe('copy lint', () => {
  it('long dashes, values words, hustle words', () => {
    expect(rules(`Rent is due ${String.fromCharCode(8212)} again`)).toContain('lint-dashes')
    expect(rules(`Week 3 ${String.fromCharCode(8211)} week 9`)).toContain('lint-dashes')
    expect(rules('Every resume should sound like you')).toContain('lint-values')
    // Only lines aimed at "you" (owner, 2026-10-22, item 17).
    expect(rules('You need to call them back')).toContain('lint-values')
    expect(rules('Recruiters need to call back')).not.toContain('lint-values')
    expect(rules('I need to sleep. Then I apply again')).not.toContain('lint-values')
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
    const hits = lintPost({ texts: ['the job app hook', 'Then your boss should call'], caption: 'Caption', hashtags: [], product: false, standard: true }, { off: LINE })
    expect(hits.map(h => [h.rule, h.slide])).toEqual([['lint-values', 1]])
  })

  it('THE STANDARD on a hook: 22 words at most, no label or timestamp to open, one quoted phrase at most', () => {
    // The owner's examples that pass (THE STANDARD v1.2, 14 to 22 words)
    // read clean: they are the bar for the length note (owner, 2026-10-16).
    expect(rules("man 54 f'ing boxes to fill on that job app fam?????????? 54!!!!!! that wuz AFTER i gave the resume", 'hook')).toEqual([])
    expect(rules('a guy at my bar is on round 6 for a job that pays less than my tips', 'hook')).toEqual([])
    expect(rules('this job\'s been "actively hiring" since JANUARY. i applied 3 times. hiring WHO bro', 'hook')).toEqual([])
    expect(rules('4 rounds of job interviews and they ghosted me. FOUR. not even a "no thx" ngl i\'m tight', 'hook')).toEqual([])
    expect(rules('took a job offer for 9k less than i wanted bc i had like 5 weeks of $ left. i hate it here', 'hook')).toEqual([])
    // Labels and stage directions from the launch plan's own hooks.
    // (Both also name no job situation: THE STANDARD v1.2's note too.)
    expect(rules('Exhibit 1: a rejection received at 2:14am. Artist unknown.', 'hook')).toEqual(['lint-hook-label', 'lint-hook-nojob'])
    expect(rules('Levels of ghosted after a final round. Level 5 asks for feedback.', 'hook')).toEqual(['lint-hook-label', 'lint-hook-nojob'])
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
    // Over 22 words.
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ')
    expect(rules(`${words(22)} job`, 'hook')).toContain('lint-hook-long')
    expect(rules(`${words(21)} job`, 'hook')).not.toContain('lint-hook-long')
    expect(lintCopy('one two three four five six seven eight nine job', { kind: 'hook', standard: true, lists: { hookMaxWords: 8 }, off: LINE }).map(h => h.match)).toEqual(['10 words'])
    // Only on a hook: a slide may open with a label.
    expect(rules('Exhibit 2: the follow-up that never came. 2:14am. "a" "b"', 'slide')).toEqual([])
    // Each is a default: switched off, it says nothing.
    expect(rules('Exhibit 1: a rejection for the job.', 'hook', { off: ['lint-hook-label'] })).toEqual([])
  })

  it('THE STANDARD v1.2: a hook names the job situation; a product post\'s last slide never promises replies or applying', () => {
    // The owner's failing example: apply for what?
    expect(rules('set a 6am alarm to apply in the first hour. 100+ people already beat me', 'hook')).toContain('lint-hook-nojob')
    expect(rules('5 months since i graduated and i still haven\'t told my family how bad it is', 'hook')).toContain('lint-hook-nojob')
    for (const t of ['the recruiter ghosted me', 'my resume got rejected', 'the salary was 41k', 'got the offer then it vanished', 'they are hiring WHO', '300 job applications, 2 replies', 'interviews for 6 weeks', "jobs that don't fit"]) expect(rules(t, 'hook'), t).not.toContain('lint-hook-nojob')
    // Only on a hook.
    expect(rules('set a 6am alarm', 'slide')).not.toContain('lint-hook-nojob')
    // The product ending: on a product post's last slide only.
    const ending = (t: string, o: { product?: boolean; last?: boolean } = { product: true, last: true }) => rules(t, 'slide', o)
    expect(ending('my friend told me about SideStep fr fr. no more getting ghosted')).toContain('lint-product-ending')
    expect(ending('SideStep so u stop getting passed over')).toContain('lint-product-ending')
    expect(ending('it literally applies for you while u sleep')).toContain('lint-product-ending')
    expect(ending('my friend told me about SideStep fr fr. one click fills the whole app')).toEqual([])
    expect(ending('it shows how u match before u apply')).toEqual([])
    expect(ending('they ghosted me after round 4', { product: true, last: false })).toEqual([])
    expect(ending('they ghosted me after round 4', { product: false, last: true })).toEqual([])
    // lintPost marks the last slide.
    const hits = lintPost({ texts: ['the job app wanted my resume typed out AGAIN', 'two', 'three', 'and SideStep applies for you'], caption: 'Ad: it fills the app', hashtags: [], product: true, standard: true }, { lists: { products: ['SideStep'] }, off: LINE })
    expect(hits.map(h => [h.rule, h.slide])).toEqual([['lint-product-ending', 3]])
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

  it('every other post (no product, or a product that adds no rules): the long dash check only (section 29)', () => {
    const general = (text: string, kind: 'hook' | 'slide' | 'caption' = 'hook') => lintCopy(text, { kind, off: LINE }).map(h => h.rule)
    // The Callie video post the owner saw "No job word" on.
    expect(general('Do boys even know what it\'s like to be a girl?')).toEqual([])
    expect(general('Every resume should sound like you', 'slide')).toEqual([])
    expect(general('You will never guess. Land your dream job', 'slide')).toEqual([])
    expect(general('Caption #a #b #c #d #e #f', 'caption')).toEqual([])
    expect(general(`Rent is due ${String.fromCharCode(8212)} again`)).toEqual(['lint-dashes'])
    expect(general(`Week 3 ${String.fromCharCode(8211)} week 9`, 'caption')).toEqual(['lint-dashes'])
    // The dash check can be switched off like any default.
    expect(lintCopy(`a ${String.fromCharCode(8212)} b`, { kind: 'slide', off: ['lint-dashes'] })).toEqual([])
    expect(lintPost({ texts: ['the hook', 'two should land'], caption: 'Caption', hashtags: [], product: true }, { off: LINE })).toEqual([])
  })
})

describe('line lint (owner, 2026-10-22; UX-PLAN.md section 35, item 5)', () => {
  const rules = (t: string, kind: 'hook' | 'slide' = 'hook') => lintCopy(t, { kind }).map(h => h.rule)
  it('flags a line that opens on the setup, on every post (no product rules needed)', () => {
    expect(rules('So I applied to 40 jobs this week and heard nothing')).toContain('lint-hit-first')
    expect(rules('Story time: my manager called me into a meeting')).toContain('lint-hit-first')
    expect(rules('When the recruiter said circle back I was furious')).toContain('lint-hit-first')
    // A setup word with the feeling right there is a hit.
    expect(rules('So angry I folded the rejection letter into a swan')).not.toContain('lint-hit-first')
    expect(rules('Infuriated: the recruiter said circle back in March')).not.toContain('lint-hit-first')
  })
  it('flags a line with no clear emotion; a word starting with one counts', () => {
    expect(rules('The recruiter said they would circle back in March')).toContain('lint-emotion')
    expect(rules('I was so infuriated I closed the laptop')).not.toContain('lint-emotion')
    expect(rules('Frustrating does not cover the third interview')).not.toContain('lint-emotion')
    expect(rules('Sad girl hours at the bus stop')).not.toContain('lint-emotion')
  })
  it('runs on slide 1 and on-screen lines only, never blocks, and can be switched off', () => {
    expect(rules('The recruiter said they would circle back', 'slide')).not.toContain('lint-emotion')
    expect(lintCopy('So the recruiter called', { kind: 'hook', off: ['lint-hit-first', 'lint-emotion'] })).toEqual([])
  })
})
