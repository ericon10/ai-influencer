import { describe, expect, it } from 'vitest'
import { DRAWN_SPECIAL_IDS, PATTERN_IDS, SPECIAL_IDS, backdropFor, cleanSpecial, ctaText, editSlides, fullSpecial, genericNames, guessPattern, postCaption, reorderMiddle, slideCountOf, slideList, vaultHooks, wordCount, emptySpecial } from './slides.js'
import { DEFAULT_POS, SAFE, adSvg, classicSizeFrac, productShotBox, slideOverlaySvg, specialSvg, textLayout, wordsNote, type Draw } from './slideSvg.js'
import { postExportJson } from './postExport.js'

// The slideshow power-up's pure parts (UX-PLAN.md section 27), shared by the
// browser preview and the worker's export.

// A stand-in for the font: every character half the font size wide.
const draw: Draw = {
  measure: (t, size) => t.length * size * 0.5,
  text: (t, x, y, o) => `<t x="${x.toFixed(0)}" y="${y.toFixed(0)}" s="${o.size.toFixed(0)}"${o.stroke ? ` k="${o.stroke.width.toFixed(1)}"` : ''}>${t}</t>`,
}
const TIKTOK = { width: 1080, height: 1920 }

describe('hooks', () => {
  it('reads the pattern of a hook from its words', () => {
    expect(guessPattern('POV: you finally got the offer')).toBe('pov')
    expect(guessPattern('My manager said I would never get promoted')).toBe('doubt')
    expect(guessPattern('Things nobody tells you about your first job')).toBe('nobody_tells')
    expect(guessPattern('Red flags in a job posting I ignored')).toBe('red_flags')
    expect(guessPattern('5 apps that saved my semester')).toBe('listicle')
    expect(guessPattern('Myth vs fact: cover letters')).toBe('myth_fact')
    expect(guessPattern('Ranking every interview tip I tried')).toBe('tier_list')
    expect(guessPattern('Storytime: I quit on day two')).toBe('storytime')
  })

  it('10 from the vault: the vault first, then every pattern recast, tagged, 4 to 12 words, deterministic, and another press shows others', () => {
    const vault = [{ text: 'I sent 200 applications and heard back from 3' }, { text: 'POV: the recruiter ghosted you after the final round' }, { text: 'Nobody tells you how lonely job hunting gets' }]
    const input = { vault, phrases: ['tailoring every resume by hand', 'hearing nothing back'], topic: 'job hunting after college' }
    const a = vaultHooks(input)
    expect(a).toHaveLength(10)
    expect(a.slice(0, 2).map(h => h.text)).toEqual(vault.slice(0, 2).map(h => h.text))
    expect(a.every(h => PATTERN_IDS.includes(h.pattern) && h.source === 'vault')).toBe(true)
    expect(a.every(h => wordCount(h.text) >= 4 && wordCount(h.text) <= 12)).toBe(true)
    expect(new Set(a.map(h => h.pattern)).size).toBeGreaterThanOrEqual(6)
    expect(vaultHooks(input)).toEqual(a)
    expect(vaultHooks({ ...input, offset: 1 })[0]!.text).toBe(vault[1]!.text)
    // A pattern chip: only that pattern.
    expect(vaultHooks({ ...input, patterns: ['red_flags'] }).every(h => h.pattern === 'red_flags')).toBe(true)
    // An empty vault still gives hooks from the topic.
    expect(vaultHooks({ vault: [], phrases: [], topic: 'office life' }).length).toBeGreaterThanOrEqual(8)
  })
})

describe('the slides of a post', () => {
  it('an older post with fewer stills than slides repeats them; empty slots and special slides do not', () => {
    const legacy = slideList({ hook: 'Hook', slides: ['a', 'b', 'c'], stillIds: ['s1', 's2'] })
    expect(legacy.map(s => s.stillId)).toEqual(['s1', 's2', 's1', 's2'])
    const slots = slideList({ hook: 'Hook', slides: ['a', 'b'], stillIds: ['s1', '', 's3'], specials: [null, emptySpecial('notification')] })
    expect(slots.map(s => [s.stillId, s.special?.type ?? null])).toEqual([['s1', null], [null, 'notification'], ['s3', null]])
    // No words: one slide per still.
    expect(slideCountOf({ hook: '', slides: [], stillIds: ['a', 'b', 'c'] })).toBe(3)
  })

  it('a special slide sits over the nearest slide\'s photo, earlier first', () => {
    const list = slideList({ hook: 'H', slides: ['a', 'b', 'c'], stillIds: ['p1', '', '', 'p4'], specials: [null, emptySpecial('notification'), emptySpecial('job_posting')] })
    expect(backdropFor(list, 1)).toBe('p1')
    expect(backdropFor(list, 2)).toBe('p4')
    expect(backdropFor(list, 3)).toBe('p4')
    expect(backdropFor(slideList({ hook: 'H', slides: [], stillIds: [''], specials: [emptySpecial('text_thread')] }), 0)).toBeNull()
  })

  it('moving, removing and adding a slide keeps its words, picture, shot, special slide and place together', () => {
    const s = { hook: 'H', slides: ['two', 'three'], stillIds: ['p1', 'p2', ''], shots: ['s1', 's2', 's3'], specials: [null, null, emptySpecial('job_posting')], textPos: [null, { x: 0.5, y: 0.6 }, null] }
    const moved = editSlides(s, { move: [1, 2] })
    expect([moved.hook, ...moved.slides]).toEqual(['H', 'three', 'two'])
    expect(moved.stillIds).toEqual(['p1', '', 'p2'])
    expect(moved.shots).toEqual(['s1', 's3', 's2'])
    expect(moved.specials.map(x => x?.type ?? null)).toEqual([null, 'job_posting', null])
    expect(moved.textPos[2]).toEqual({ x: 0.5, y: 0.6 })
    const removed = editSlides(s, { remove: 0 })
    expect([removed.hook, ...removed.slides]).toEqual(['two', 'three'])
    const added = editSlides(s, { add: 3 })
    expect(slideCountOf(added)).toBe(4)
    // A repeated picture of an older post becomes its own slot.
    const legacy = editSlides({ hook: 'H', slides: ['a', 'b'], stillIds: ['x'] }, { move: [0, 2] })
    expect(legacy.stillIds).toEqual(['x', 'x', 'x'])
  })

  it('variations of a list post reorder the middle slides, never the hook or the last slide', () => {
    const items = [0, 1, 2, 3, 4, 5]
    const a = reorderMiddle(items, 1), b = reorderMiddle(items, 2)
    expect(a[0]).toBe(0)
    expect(a.at(-1)).toBe(5)
    expect(a).not.toEqual(items)
    expect([...a].sort()).toEqual(items)
    expect(reorderMiddle(items, 1)).toEqual(a)
    expect(b[0]).toBe(0)
  })
})

describe('CTA, caption and brand names', () => {
  it('the CTA line, with a typed handle', () => {
    expect(ctaText('handle', { handle: '@callie.jobs' })).toBe('Follow @callie.jobs for more')
    expect(ctaText('handle', { handle: '' })).toBe('Follow for more')
    expect(ctaText('comment', { word: 'guide' })).toBe('Comment "guide" and I\'ll send it')
    expect(ctaText('own')).toBeNull()
  })

  it('"Ad:" goes first in the caption; at most 5 hashtags; no ad tag; the CTA line after the caption', () => {
    const c = postCaption('My first week was wild.', ['jobs', '#careertok', 'ad', 'a', 'b', 'c', 'd'], { ad: true, max: 5 })
    expect(c).toBe('Ad: My first week was wild.\n\n#jobs #careertok #a #b #c')
    expect(postCaption('#ad already there', [], { ad: true, max: 5 })).toBe('#ad already there')
    expect(postCaption('Ad: SideStep shows how you match.', [], { ad: true, max: 5 })).toBe('Ad: SideStep shows how you match.')
    expect(postCaption('Our first acquisition.', ['jobtok'], { ad: false, max: 5, cta: 'What time did yours arrive?' })).toBe('Our first acquisition.\n\nWhat time did yours arrive?\n\n#jobtok')
    expect(postCaption('Want the day 7 count? Link in bio', [], { ad: false, max: 5, cta: 'Want the day 7 count?' })).toBe('Want the day 7 count? Link in bio')
    expect(postCaption('Plain.', ['x'], { ad: false, max: 5 })).toBe('Plain.\n\n#x')
  })

  it('a real brand on a mock screen becomes a generic name; ordinary words stay', () => {
    const brands = ['Google', 'Target', 'Indeed'], generic = ['Northwind', 'Bullseye Goods', 'Jobfinder']
    expect(genericNames('Your Google interview', brands, generic)).toBe('Your Northwind interview')
    expect(genericNames('GOOGLE CAREERS', brands, generic)).toBe('Northwind CAREERS')
    expect(genericNames('my target role, indeed', brands, generic)).toBe('my target role, indeed')
    expect(genericNames('Googlers', brands, generic)).toBe('Googlers')
  })
})

describe('text styles and the safe zones', () => {
  it('Classic: 7.5% of the width at 4 words or fewer, 5% at 12 or more, between in steps', () => {
    expect(classicSizeFrac(3)).toBe(0.075)
    expect(classicSizeFrac(12)).toBe(0.05)
    expect(classicSizeFrac(8)).toBeCloseTo(0.0625, 4)
  })

  it('Classic: 4 to 6 words a line, centered about 28% from the top, a black outline at 15% of the font size', () => {
    const l = textLayout('classic', 'My manager said I would never get promoted', TIKTOK, null, draw)!
    expect(l.lines.every(x => wordCount(x) >= 3 && wordCount(x) <= 6)).toBe(true)
    expect(l.size).toBeGreaterThanOrEqual(0.05 * 1080 - 1)
    expect(l.size).toBeLessThanOrEqual(0.075 * 1080)
    expect((l.block.y + l.block.h / 2) / 1920).toBeCloseTo(DEFAULT_POS.y, 2)
    const svg = slideOverlaySvg({ style: 'classic', text: 'Four words right here', pos: null, special: null, ad: false }, TIKTOK, draw).svg
    const size = Number(svg.match(/s="(\d+)"/)![1]), stroke = Number(svg.match(/k="([\d.]+)"/)![1])
    expect(stroke / size).toBeCloseTo(0.15, 2)
  })

  it('dragged words stay out of the top 10% and the bottom 20%, in every style and size', () => {
    for (const style of ['classic', 'box', 'minimal', 'note'] as const) {
      for (const frame of [TIKTOK, { width: 1080, height: 1440 }]) {
        const low = textLayout(style, 'Then this landed in my inbox at nine', frame, { x: 0.5, y: 0.99 }, draw)!
        expect(low.block.y + low.block.h).toBeLessThanOrEqual((1 - SAFE.bottom) * frame.height + 0.5)
        const high = textLayout(style, 'Then this landed in my inbox at nine', frame, { x: 0.02, y: 0 }, draw)!
        expect(high.block.y).toBeGreaterThanOrEqual(SAFE.top * frame.height - 0.5)
        expect(high.block.x).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('Ad sits above the words (below them when there is no room), and the slide words get a hint outside 4 to 12', () => {
    const l = textLayout('classic', 'Hook words go here', TIKTOK, null, draw)!
    expect(adSvg(l, TIKTOK, draw)).toContain('>Ad<')
    const top = textLayout('classic', 'Hook words go here', TIKTOK, { x: 0.5, y: 0 }, draw)!
    const y = Number(adSvg(top, TIKTOK, draw).match(/<rect x="[\d.]+" y="([\d.]+)"/)![1])
    expect(y).toBeGreaterThan(top.block.y)
    expect(wordsNote('Too short')).toMatch(/4 to 12/)
    expect(wordsNote('one two three four five')).toBeNull()
  })

  it('every special slide draws inside the frame, in both sizes', () => {
    for (const t of DRAWN_SPECIAL_IDS) {
      for (const frame of [TIKTOK, { width: 1080, height: 1440 }]) {
        const svg = specialSvg(emptySpecial(t), frame, draw)
        expect(svg.length, t).toBeGreaterThan(100)
        for (const m of svg.matchAll(/ y="(-?[\d.]+)"/g)) expect(Number(m[1]), t).toBeLessThanOrEqual(frame.height)
        for (const m of svg.matchAll(/ x="(-?[\d.]+)"/g)) expect(Number(m[1]), t).toBeLessThanOrEqual(frame.width)
      }
    }
  })

  it('the launch plan screens (section 28): the form empty or filled with its field count, blurred amounts, the picked score, the notification stack', () => {
    // Application form: empty shows the labels only; filled shows the values and every field done.
    const form = emptySpecial('application_form')
    expect(specialSvg(form, TIKTOK, draw)).toContain('0 of 40 fields')
    const filled = { ...form, variant: 'filled', lines: ['Job title: Intern', 'Company: Northwind'], count: 12 }
    const fsvg = specialSvg(filled, TIKTOK, draw)
    expect(fsvg).toContain('12 of 12 fields')
    expect(fsvg).toContain('>Intern<')
    expect(fsvg).toContain('>Job title<')
    // Portal status: every step and its timestamp.
    const portal = specialSvg(emptySpecial('portal_status'), TIKTOK, draw)
    expect(portal).toContain('Still in review')
    expect(portal).toContain('day 41')
    // Bank app and receipt: blur hides the amounts, never the labels.
    const bank = emptySpecial('bank_app')
    expect(specialSvg(bank, TIKTOK, draw)).toContain('$1,204.18')
    const hidden = specialSvg({ ...bank, blur: true }, TIKTOK, draw)
    expect(hidden).not.toContain('$1,204.18')
    expect(hidden).not.toContain('1,450.00')
    expect(hidden).toContain('>Rent<')
    expect(specialSvg({ ...emptySpecial('receipt'), blur: true }, TIKTOK, draw)).not.toContain('$640.00')
    expect(specialSvg({ ...emptySpecial('receipt'), variant: 'receipt' }, TIKTOK, draw)).toContain('$640.00')
    // Survey: 0 to 10, the picked score highlighted.
    const none = specialSvg(emptySpecial('survey'), TIKTOK, draw)
    const seven = specialSvg({ ...emptySpecial('survey'), count: 7 }, TIKTOK, draw)
    for (const k of ['0', '5', '10']) expect(none).toContain(`>${k}<`)
    expect(seven).not.toEqual(none)
    // Lock screen: the clock and each notification in the stack.
    const lock = specialSvg(emptySpecial('lock_screen'), TIKTOK, draw)
    expect(lock).toContain('>2:14<')
    expect(lock).toContain('did you hear back??')
    expect(lock).toContain('Rent due in 9 days')
    // Placard, invite and profile card show their own words.
    expect(specialSvg(emptySpecial('museum_placard'), TIKTOK, draw)).toContain('Autoresponder')
    expect(specialSvg(emptySpecial('calendar_invite'), TIKTOK, draw)).toContain('Quick chat')
    expect(specialSvg(emptySpecial('profile_card'), TIKTOK, draw)).toContain('Jordan Lee')
    // A real brand on any of them becomes a generic name.
    const branded = cleanSpecial({ ...emptySpecial('calendar_invite'), from: 'Google Talent' }, ['Google'], ['Northwind'])
    expect(branded.from).toBe('Northwind Talent')
  })

  it('a product screenshot is only ever the owner\'s upload: never drawn, never suggested, placed as uploaded and out of the bottom 20%', () => {
    expect(SPECIAL_IDS).toContain('product_shot')
    expect(DRAWN_SPECIAL_IDS).not.toContain('product_shot')
    const shot = { ...emptySpecial('product_shot'), assetId: 'ast_1', ratio: 0.46 }
    // Nothing drawn without the upload.
    expect(slideOverlaySvg({ style: 'classic', text: '', pos: null, special: shot, ad: false }, TIKTOK, draw).svg).not.toContain('<image')
    const { svg } = slideOverlaySvg({ style: 'classic', text: 'This is the app', pos: null, special: shot, ad: false, shotHref: 'data:image/png;base64,AAAA' }, TIKTOK, draw)
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"')
    for (const variant of ['middle', 'top']) for (const scale of [0.3, 0.72, 1]) for (const ratio of [0.3, 0.46, 1, 2]) {
      const b = productShotBox({ scale, variant, ratio }, TIKTOK)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(1080)
      expect(b.y + b.h).toBeLessThanOrEqual(1920 * (1 - SAFE.bottom) + 0.01)
      // Its own shape: never stretched.
      expect(b.w / b.h).toBeCloseTo(ratio, 5)
    }
    expect(productShotBox({ scale: 0.72, variant: 'top', ratio: 0.46 }, TIKTOK).y).toBeLessThan(productShotBox({ scale: 0.72, variant: 'middle', ratio: 0.46 }, TIKTOK).y)
    // An older special slide reads with the new fields.
    expect(fullSpecial({ type: 'notification', from: 'Mail' } as never)).toMatchObject({ lines: [], blur: false, assetId: null, scale: 0.72 })
  })
})

describe('post.json', () => {
  it('maps every field in one place', () => {
    const j = postExportJson({
      post: { id: 'cnt_1', kind: 'slideshow', title: '', idea: 'jobs', accountTag: 'callie.jobs', characterId: 'chr_1', characterName: 'Callie', variationOf: 'cnt_0', batchOf: null, createdAt: 'a', updatedAt: 'b' },
      slideshow: { mode: 'character', pattern: 'doubt', hook: 'Hook', textStyle: 'classic', made: 'tiktok', caption: 'Cap', postCaption: 'Ad: Cap', hashtags: ['x'], ad: true, cta: { kind: 'handle', handle: 'c', word: '', text: 'Follow @c for more' }, scene: { place: 'office', light: 'window', camera: 'friend_phone', phone: '', outfit: 'tee', details: ['mug'], savedId: null } },
      slides: [{ index: 0, text: 'Hook', shot: 'desk', picture: 'still', stillId: 'cand_1', special: null, position: { x: 0.5, y: 0.3 }, files: { tiktok: 'tiktok/01.jpg', instagram: 'instagram/01.jpg' } }],
      files: { caption: 'caption.txt', tiktok: ['tiktok/01.jpg'], instagram: ['instagram/01.jpg'] },
      sizes: { tiktok: { width: 1080, height: 1920 }, instagram: { width: 1080, height: 1440 } },
      aiLabel: 'Label all posts as AI-generated', exportedAt: 'now',
    }) as Record<string, any>
    expect(j.format).toBe('character-studio.post')
    expect(j.post).toMatchObject({ account: 'callie.jobs', variation_of: 'cnt_0', character: { name: 'Callie' } })
    expect(j.slideshow.hook_pattern).toEqual({ id: 'doubt', label: 'Someone doubts or reacts' })
    expect(j.caption).toMatchObject({ ad: true, as_posted: 'Ad: Cap', hashtags: ['x'] })
    expect(j.slides[0]).toMatchObject({ number: 1, picture: 'still', text_position: { x: 0.5, y: 0.3 } })
    expect(j.sizes.instagram).toEqual({ width: 1080, height: 1440 })
  })
})
