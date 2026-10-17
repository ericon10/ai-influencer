import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, filterChips, filterFromParams, filterParams, isFiltered, libraryQueryString, parseLibraryQuery, rangeOf, type LibraryFilter } from './libraryFilter.js'

// The Library's filters (UX-PLAN.md section 34): kept per tab in the page's
// address, turned into the API query in the browser's own day, read back on
// the server, and shown as chips.

const params = (s: string) => new URLSearchParams(s)
const f = (x: Partial<LibraryFilter>): LibraryFilter => ({ ...EMPTY_FILTER, ...x })

describe('the address, per tab', () => {
  it('each tab reads only its own keys', () => {
    const p = params('tab=clips&c=chr_01abcdefgh&stills.model=higgsfield/nano-banana-2&stills.used=unused&clips.date=7d&clips.set=col_01abcdefgh')
    expect(filterFromParams(p, 'stills')).toEqual(f({ model: 'higgsfield/nano-banana-2', used: 'unused' }))
    expect(filterFromParams(p, 'clips')).toEqual(f({ date: '7d', set: 'col_01abcdefgh' }))
  })

  it('a value that does not read is dropped, never an error', () => {
    const p = params('stills.model=%3Cscript%3E&stills.date=yesterday&stills.used=maybe&stills.set=nope&stills.product=x')
    expect(filterFromParams(p, 'stills')).toEqual(EMPTY_FILTER)
    expect(isFiltered(filterFromParams(p, 'stills'))).toBe(false)
  })

  it('a custom range keeps its days; a range with no day is no filter', () => {
    expect(filterFromParams(params('stills.date=range&stills.from=2026-10-01&stills.to=2026-10-05'), 'stills')).toEqual(f({ date: 'range', from: '2026-10-01', to: '2026-10-05' }))
    expect(filterFromParams(params('stills.date=range&stills.from=2026-13-45'), 'stills').date).toBeNull()
    // Days without the range preset are ignored.
    expect(filterFromParams(params('stills.from=2026-10-01'), 'stills').from).toBeNull()
  })

  it('a change writes only that tab\'s keys; leaving the range clears its days', () => {
    expect(filterParams('clips', { used: 'used' })).toEqual({ 'clips.used': 'used' })
    expect(filterParams('stills', { model: null })).toEqual({ 'stills.model': null })
    expect(filterParams('stills', { date: '30d' })).toEqual({ 'stills.date': '30d', 'stills.from': null, 'stills.to': null })
    expect(filterParams('stills', { date: 'range', from: '2026-10-01' })).toEqual({ 'stills.date': 'range', 'stills.from': '2026-10-01' })
  })
})

describe('the API query, in the browser\'s own day', () => {
  const now = new Date(2026, 9, 17, 15, 30) // local time
  it('Today starts at local midnight; 7 and 30 days count back from now', () => {
    expect(rangeOf(f({ date: 'today' }), now)).toEqual({ from: new Date(2026, 9, 17), to: null })
    expect(rangeOf(f({ date: '7d' }), now).from!.getTime()).toBe(now.getTime() - 7 * 86_400_000)
    expect(rangeOf(f({ date: '30d' }), now).from!.getTime()).toBe(now.getTime() - 30 * 86_400_000)
    expect(rangeOf(EMPTY_FILTER, now)).toEqual({ from: null, to: null })
  })

  it('a custom range runs from the start of its first day to the end of its last', () => {
    expect(rangeOf(f({ date: 'range', from: '2026-10-01', to: '2026-10-05' }), now)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 6) })
    expect(rangeOf(f({ date: 'range', to: '2026-10-31' }), now)).toEqual({ from: null, to: new Date(2026, 10, 1) })
  })

  it('the query names the type by the tab and carries every filter', () => {
    const s = libraryQueryString('clips', 'chr_01abcdefgh', f({ model: 'upload', date: 'today', used: 'unused', product: 'prd_01abcdefgh', set: 'col_01abcdefgh' }), now)
    const back = new URLSearchParams(s)
    expect(Object.fromEntries(back)).toEqual({ type: 'clip', characterId: 'chr_01abcdefgh', model: 'upload', from: new Date(2026, 9, 17).toISOString(), used: 'unused', product: 'prd_01abcdefgh', set: 'col_01abcdefgh' })
    expect(libraryQueryString('stills', null, EMPTY_FILTER, now)).toBe('type=still')
  })

  it('the server reads back what the browser sends', () => {
    const s = libraryQueryString('stills', null, f({ date: 'range', from: '2026-10-01', to: '2026-10-05', used: 'used' }), now)
    const q = parseLibraryQuery(Object.fromEntries(new URLSearchParams(s)))
    expect(q).toEqual({ type: 'still', characterId: null, model: null, from: new Date(2026, 9, 1), to: new Date(2026, 9, 6), used: 'used', product: null, set: null })
  })

  it('the server refuses what does not read, in plain words', () => {
    expect(() => parseLibraryQuery({ characterId: 'x' })).toThrow('That character is not one of yours.')
    expect(() => parseLibraryQuery({ model: 'a b' })).toThrow('That model name does not read.')
    expect(() => parseLibraryQuery({ to: 'soon' })).toThrow('The end date does not read.')
    expect(() => parseLibraryQuery({ product: 'prd_' })).toThrow('That product does not exist.')
    // Empty values are no filter.
    expect(parseLibraryQuery({ type: '', model: '' })).toMatchObject({ type: null, model: null })
  })
})

describe('chips', () => {
  const names = { model: (id: string) => (id === 'upload' ? 'Uploaded' : id), product: () => 'SideStep', set: () => 'Launch week' }
  it('one chip for each active filter, the date and its range as one', () => {
    expect(filterChips(f({ model: 'upload', date: '7d', used: 'unused', product: 'prd_01abcdefgh', set: 'col_01abcdefgh' }), names)).toEqual([
      { key: 'model', label: 'Model: Uploaded' },
      { key: 'date', label: 'Last 7 days' },
      { key: 'used', label: 'Not used' },
      { key: 'product', label: 'Product: SideStep' },
      { key: 'set', label: 'Collection: Launch week' },
    ])
    expect(filterChips(f({ date: 'range', from: '2026-10-01', to: '2026-10-05' }), names)).toEqual([{ key: 'date', label: 'Oct 1 to Oct 5' }])
    expect(filterChips(f({ date: 'range', from: '2026-10-01' }), names)[0]!.label).toBe('From Oct 1')
    expect(filterChips(EMPTY_FILTER, names)).toEqual([])
  })
})
