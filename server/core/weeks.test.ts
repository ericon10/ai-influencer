import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  WEEK_COLUMNS, WEEK_COLUMN_NAMES, assignBlend, captionWithLabel, checkWeekRow, currentStep, draftMotion, draftVisual, drawLines, driveName,
  lineLint, nearDuplicate, readLines, readWeek, ruleBreaks, slotNumber, templateCsv, weekOf, type DrawSlot, type PoolLine, type WeekAccountInfo, type WeekCells,
} from './weeks.js'

describe('the plan CSV spec', () => {
  it('lists exactly the columns the reader reads, each marked required or optional as the reader does', () => {
    const doc = readFileSync('docs/PLAN-CSV-SPEC.md', 'utf8')
    const rows = [...doc.matchAll(/^\| `([a-z0-9_]+)` \| (required|optional) \|/gm)].map(m => ({ name: m[1]!, required: m[2] === 'required' }))
    expect(rows.map(r => r.name)).toEqual(WEEK_COLUMN_NAMES)
    for (const c of WEEK_COLUMNS) expect(rows.find(r => r.name === c.name)!.required, c.name).toBe(c.required)
    expect(WEEK_COLUMNS.filter(c => c.required).map(c => c.name)).toEqual(['row_id', 'account', 'date', 'slot'])
  })

  it('makes a template with one example row per post type that reads back clean', () => {
    const { rows, missing, unknown } = readWeek(templateCsv())
    expect(missing).toEqual([])
    expect(unknown).toEqual([])
    expect(rows.map(r => r.cells.post_type)).toEqual(['slideshow', 'clip', 'photo', 'faceless'])
    expect(rows[0]!.cells.slide_3).toBe('the email said "we went another direction"')
  })

  it('reads the launch plan\'s older names (hook, format) and names unknown columns', () => {
    const { rows, unknown } = readWeek('row_id,account,date,slot,format,hook,colour\nA1,f2,2026-10-26,AM,character clip,a line,red\n')
    expect(rows[0]!.cells.line).toBe('a line')
    expect(rows[0]!.cells.post_type).toBe('character clip')
    expect(unknown).toEqual(['colour'])
  })
})

describe('a row checked', () => {
  const accounts = new Map<string, WeekAccountInfo>([
    ['callie_tt_01', { tag: 'callie_tt_01', kind: 'person', characterId: 'chr_c', characterName: 'Callie', slotsPerDay: 2 }],
    ['doug_tt_01', { tag: 'doug_tt_01', kind: 'faceless', characterId: 'chr_d', characterName: 'Doug', slotsPerDay: 3 }],
  ])
  const row = (cells: Record<string, string>) => ({ line: 2, cells: Object.fromEntries(WEEK_COLUMN_NAMES.map(c => [c, cells[c] ?? ''])) as WeekCells })

  it('needs only row_id, account, date and slot', () => {
    const r = checkWeekRow(row({ row_id: 'C1', account: 'callie_tt_01', date: '2026-10-26', slot: '1' }), accounts)
    expect(r.errors).toEqual([])
    expect(r.postType).toBe('clip')
    expect(checkWeekRow(row({ row_id: 'D1', account: 'doug_tt_01', date: '2026-10-26', slot: '2' }), accounts).postType).toBe('faceless')
    const bad = checkWeekRow(row({ account: 'callie_tt_01', date: '10/26/2026', slot: 'noon' }), accounts)
    expect(bad.errors).toEqual(['No row_id', 'Date "10/26/2026" is not YYYY-MM-DD', 'Slot "noon" is not a number (1, 2, 3...)'])
  })

  it('never puts a faceless row on a person\'s account; notes a slot past the account\'s slots', () => {
    expect(checkWeekRow(row({ row_id: 'C1', account: 'callie_tt_01', date: '2026-10-26', slot: '3', post_type: 'faceless' }), accounts).errors[0]).toMatch(/faceless row goes on a faceless account/)
    expect(checkWeekRow(row({ row_id: 'C1', account: 'callie_tt_01', date: '2026-10-26', slot: '3' }), accounts).warnings[0]).toMatch(/past callie_tt_01's 2 slots/)
  })

  it('reads slots and weeks', () => {
    expect([slotNumber('2'), slotNumber('AM'), slotNumber('PM'), slotNumber('x')]).toEqual([2, 1, 3, null])
    expect(weekOf('2026-10-29')).toBe('2026-10-26')
    expect(weekOf('2026-10-26')).toBe('2026-10-26')
    expect(weekOf('2026-11-01')).toBe('2026-10-26')
  })
})

// A bank of lines across pains, emotions and formats, life and job.
function bank(n: number, o: { life?: number } = {}): PoolLine[] {
  const pains = ['ghosted', 'lowball', 'unpaid test', 'layoff', 'no reply', 'entry level', 'rent', 'family'], emotions = ['angry', 'sad', 'frustrated', 'crying', 'infuriated'], formats = ['finished damage', 'meme setup', 'question', 'list']
  return Array.from({ length: n }, (_, i) => ({
    id: `bl_${i}`, text: `line ${i}`, pain: pains[i % pains.length]!, emotion: emotions[(i * 3) % emotions.length]!, format: formats[(i * 7) % formats.length]!,
    fits: (['both', 'secondhand', 'first'] as const)[i % 3]!, lifeOrJob: i % 10 < (o.life ?? 5) ? 'life' : 'job', usedAccount: null, fight: false,
  }))
}
function week(account: string, stance: 'first' | 'secondhand', perDay: number): DrawSlot[] {
  return Array.from({ length: 7 * perDay }, (_, i) => ({ postId: `${account}-${i}`, account, date: `2026-10-${String(26 + Math.floor(i / perDay)).padStart(2, '0')}`.replace('2026-10-32', '2026-11-01'), slot: (i % perDay) + 1, lifeOrJob: null, voiceFit: null, stance, keep: null }))
}

describe('Fill empty slots', () => {
  it('keeps the blend: Callie 70/30 over a week of 14 slots, the row\'s own life_or_job counted', () => {
    const slots = week('callie', 'secondhand', 2).map((s, i) => ({ postId: s.postId, lifeOrJob: i === 0 ? 'job' as const : null }))
    const b = assignBlend(slots, 70, 4)
    expect([...b.values()].filter(v => v === 'life')).toHaveLength(10)
    expect(b.get('callie-0')).toBe('job')
    expect([...assignBlend(slots, 0, 1).values()].filter(v => v === 'life')).toHaveLength(0)
  })

  it('holds rules a to e on every seed: no pain twice in 7, one account per line, no 3 alike in a row, the voice fits, never a job line in a life slot', () => {
    const pool = bank(400)
    for (let seed = 1; seed <= 40; seed++) {
      const slots = [...week('callie', 'secondhand', 2), ...week('dani', 'secondhand', 2), ...week('doug', 'first', 3)]
      const blend = new Map([...assignBlend(slots.filter(s => s.account === 'callie'), 70, seed), ...assignBlend(slots.filter(s => s.account === 'dani'), 80, seed), ...assignBlend(slots.filter(s => s.account === 'doug'), 0, seed)])
      const draws = drawLines({ slots, pool, history: new Map(), blend, seed })
      const byId = new Map(pool.map(l => [l.id, l]))
      const rows = draws.map(d => { const s = slots.find(x => x.postId === d.postId)!; return { postId: d.postId, account: s.account, date: s.date, slot: s.slot, line: d.lineId ? byId.get(d.lineId)! : null, lifeOrJob: d.lifeOrJob } })
      expect(ruleBreaks(rows), `seed ${seed}`).toEqual([])
      expect(new Set(draws.filter(d => d.lineId).map(d => d.lineId)).size).toBe(draws.filter(d => d.lineId).length)
      for (const d of draws.filter(x => x.lineId)) {
        const s = slots.find(x => x.postId === d.postId)!
        const l = byId.get(d.lineId!)!
        expect(l.fits === 'both' || l.fits === s.stance, `${l.id} on ${s.account}`).toBe(true)
      }
      expect(draws.filter(d => d.lineId).length).toBeGreaterThan(slots.length * 0.9)
    }
  })

  it('is random per slot: another seed draws other lines; the same seed the same', () => {
    const slots = week('callie', 'secondhand', 2)
    const blend = assignBlend(slots, 70, 1)
    const a = drawLines({ slots, pool: bank(200), history: new Map(), blend, seed: 1 })
    expect(drawLines({ slots, pool: bank(200), history: new Map(), blend, seed: 1 })).toEqual(a)
    const b = drawLines({ slots, pool: bank(200), history: new Map(), blend, seed: 2 })
    expect(a.filter((d, i) => d.lineId !== b[i]!.lineId).length).toBeGreaterThan(slots.length / 2)
  })

  it('leaves a life slot empty and flags it when no life line is left; never fills it with a job line', () => {
    const slots = week('callie', 'secondhand', 2)
    const draws = drawLines({ slots, pool: bank(60, { life: 0 }), history: new Map(), blend: assignBlend(slots, 70, 3), seed: 3 })
    const life = draws.filter(d => d.lifeOrJob === 'life')
    expect(life.length).toBe(10)
    expect(life.every(d => d.lineId === null && /No life line left/.test(d.flag ?? ''))).toBe(true)
  })

  it('never uses a line already used on any account, keeps a locked slot, and counts the week before for rule a', () => {
    const pool = bank(40).map((l, i) => (i < 20 ? { ...l, usedAccount: 'dani' } : l))
    const slots = week('callie', 'secondhand', 1)
    slots[0] = { ...slots[0]!, keep: { lineId: 'bl_25', pain: pool[25]!.pain, emotion: pool[25]!.emotion, format: pool[25]!.format } }
    const history = new Map([['callie', [{ pain: 'rent', emotion: 'sad', format: 'list' }]]])
    const draws = drawLines({ slots, pool, history, blend: new Map(slots.map(s => [s.postId, 'job' as const])), seed: 9 })
    expect(draws[0]).toMatchObject({ lineId: 'bl_25', kept: true })
    expect(draws.every(d => !d.lineId || Number(d.lineId.slice(3)) >= 20)).toBe(true)
    const firstNew = pool.find(l => l.id === draws[1]!.lineId)
    expect(firstNew?.pain).not.toBe('rent')
  })

  it('follows a row\'s voice_fit over the character\'s', () => {
    const slots = week('callie', 'secondhand', 1).map(s => ({ ...s, voiceFit: 'first' as const }))
    const pool = bank(90)
    const draws = drawLines({ slots, pool, history: new Map(), blend: new Map(slots.map(s => [s.postId, 'job' as const])), seed: 5 })
    for (const d of draws.filter(x => x.lineId)) expect(['first', 'both']).toContain(pool.find(l => l.id === d.lineId)!.fits)
  })
})

describe('the line drives the visual', () => {
  const places = [
    { id: 'IS015', name: 'Mailbox in the rain', line: 'a rusty black mailbox at the end of a gravel driveway in steady rain', motion: 'Rain falls, the mailbox door sways. 6 seconds, 9:16.' },
    { id: 'IS016', name: 'Fridge at night', line: 'an open refrigerator in a dark kitchen at night', motion: '' },
  ]
  it('a faceless post takes the place its words point at, with its motion line and a music bed', () => {
    const v = draftVisual({ postType: 'faceless', line: 'no mail again. 41 days', storyBeat: 'checking the mailbox in the rain', name: 'Doug', places, placeUse: new Map(), sounds: [{ name: 'Sad piano bed', search: 'piano', kind: 'music' }], settings: [], seed: 1 })
    expect(v).toMatchObject({ placeId: 'IS015', scene: places[0]!.line, videoPrompt: places[0]!.motion, soundName: 'Sad piano bed' })
  })
  it('drafts a motion line for a place with none, and the least used place when the words point nowhere', () => {
    const v = draftVisual({ postType: 'faceless', line: 'they said 2 weeks. it has been 9', storyBeat: '', name: 'Doug', places, placeUse: new Map([['IS015', 3]]), sounds: [], settings: [], seed: 2 })
    expect(v.placeId).toBe('IS016')
    expect(v.videoPrompt).toBe(draftMotion(places[1]!.line))
    expect(draftMotion('rain on the window of a parked car')).toMatch(/^Rain keeps falling.*9:16\.$/)
  })
  it('a person clip gets a scene from its story beat and a video prompt; a photo no video prompt', () => {
    const v = draftVisual({ postType: 'clip', line: 'x', storyBeat: 'Monday: the rejection email at 7am', name: 'Callie', places: [], placeUse: new Map(), sounds: [], settings: ['her bedroom'], seed: 1 })
    expect(v.scene).toBe('Monday: the rejection email at 7am. her bedroom')
    expect(v.videoPrompt).toMatch(/^Callie reacts to it for real/)
    expect(draftVisual({ postType: 'photo', line: 'x', storyBeat: '', name: 'Callie', places: [], placeUse: new Map(), sounds: [], settings: [], seed: 1 }).videoPrompt).toBe('')
  })
})

describe('the 9-point line lint', () => {
  it('passes a line with the hit first, a feeling, one detail, 12 words or fewer', () => {
    expect(lineLint('got rejected at 7:02am and cried in the shower').filter(p => !p.ok)).toEqual([])
  })
  it('names each failed point', () => {
    const bad = lineLint('So you should really unlock your dream job potential #grind with SideStep and never stop trying ever', { products: ['SideStep'] })
    expect(bad.filter(p => !p.ok).map(p => p.n)).toEqual([1, 2, 3, 4, 7, 8, 9])
    expect(lineLint('You \u2014 sad').filter(p => !p.ok).map(p => p.n)).toEqual(expect.arrayContaining([4, 5, 6]))
    expect(lineLint('sad', { off: ['lint-line-detail'] }).find(p => p.n === 4)!.ok).toBe(true)
  })
})

describe('imported lines', () => {
  it('drops near-matches: the same words, or 80% of the words shared', () => {
    expect(nearDuplicate('They ghosted me after 3 rounds!!', 'they ghosted me after 3 rounds')).toBe(true)
    expect(nearDuplicate('they ghosted me after three rounds of interviews', 'they ghosted me after three rounds of interviews lol')).toBe(true)
    expect(nearDuplicate('they ghosted me after three rounds', 'my landlord raised the rent by 400')).toBe(false)
  })
  it('reads the columns by name, text required', () => {
    const r = readLines('text,source,source_likes,pain,emotion,format,voice_fit,life_or_job\n"my rent went up $400",inventory,1203,rent,angry,finished damage,secondhand,life\n', { emotions: ['angry', 'sad'], formats: ['finished damage'] })
    expect(r.rows[0]).toMatchObject({ text: 'my rent went up $400', source: 'inventory', likes: 1203, pain: 'rent', emotion: 'angry', fits: 'secondhand', lifeOrJob: 'life', problems: [] })
    expect(readLines('likes\n3\n', { emotions: [], formats: [] }).missing).toEqual(['text'])
  })
})

describe('the step bar and Drive', () => {
  it('lights the first step with work left', () => {
    const c = { posts: 10, noLine: 0, flagged: 0, unchecked: 0, toMake: 0, making: 0, toReview: 0, approved: 0, killed: 0, toSend: 0, sent: 0 }
    expect(currentStep({ ...c, posts: 0 })).toBe('import')
    expect(currentStep({ ...c, noLine: 3 })).toBe('fill')
    expect(currentStep({ ...c, unchecked: 1 })).toBe('check')
    expect(currentStep({ ...c, toMake: 2 })).toBe('make')
    expect(currentStep({ ...c, toReview: 2 })).toBe('review')
    expect(currentStep({ ...c, toSend: 2 })).toBe('drive')
  })
  it('names files date_slot_account_rowid and adds the AI label line once', () => {
    expect(driveName({ date: '2026-10-26', slot: 2, account: 'callie_tt_01', rowId: 'C 002', ext: 'mp4' })).toBe('2026-10-26_2_callie_tt_01_C-002.mp4')
    expect(captionWithLabel('day 41', 'AI-generated')).toBe('day 41\n\nAI-generated')
    expect(captionWithLabel('day 41 (AI-generated)', 'AI-generated')).toBe('day 41 (AI-generated)')
  })
})
