import { describe, expect, it } from 'vitest'
import {
  checklistText, emptyPosting, folderNames, isApproved, leftOutReason, leftOutText, orderDay, postingDay, postingSlot, readPosting, slideFile,
  slotList, slotTime, type DayPost,
} from './postingDay.js'

// Download day (UX-PLAN.md section 33): the posting order, why a post is
// left out, the folder and file names and the checklist's lines. Pure.

const TIMES = { AM: '09:00', Daily: '12:00', PM: '18:00' }
const post = (id: string, o: Partial<DayPost> = {}): DayPost => ({
  id, name: id, kind: 'slideshow', account: 'F2', slot: 'AM', hook: `${id} hook`, ad: false, approved: true, packed: null,
  exported: true, exportedAt: null, rendering: false, missing: null, problem: null, rowId: '', ...o,
})

describe('the day and the slot of a post', () => {
  it('its own day first, else the plan\'s, else the day it was posted', () => {
    const p = emptyPosting()
    expect(postingDay({ posting: p, planDate: '2026-10-19' })).toBe('2026-10-19')
    expect(postingDay({ posting: { ...p, date: '2026-10-21' }, planDate: '2026-10-19' })).toBe('2026-10-21')
    expect(postingDay({ posting: p, planDate: '', postedAt: '2026-10-22T21:14' })).toBe('2026-10-22')
    expect(postingDay({ posting: p })).toBe('')
    expect(postingSlot({ posting: p, planSlot: 'PM' })).toBe('PM')
    expect(postingSlot({ posting: { ...p, slot: 'AM' }, planSlot: 'PM' })).toBe('AM')
  })
  it('approved is the owner\'s switch, else a batch review\'s Approve', () => {
    expect(isApproved(emptyPosting(), null)).toBe(false)
    expect(isApproved(emptyPosting(), 'approved')).toBe(true)
    expect(isApproved({ ...emptyPosting(), approved: false }, 'approved')).toBe(false)
    expect(isApproved({ ...emptyPosting(), approved: true }, null)).toBe(true)
    expect(readPosting({ approved: 'yes' })).toEqual(emptyPosting())
  })
  it('slot times are data, any case; the slots in clock order', () => {
    expect(slotTime('am', TIMES)).toBe('09:00')
    expect(slotTime('Evening', TIMES)).toBeNull()
    expect(slotList({ PM: '18:00', AM: '09:00', Late: '23:30', Bad: '9am' })).toEqual([{ slot: 'AM', time: '09:00' }, { slot: 'PM', time: '18:00' }, { slot: 'Late', time: '23:30' }])
  })
})

describe('posting order', () => {
  it('by the slot\'s clock time (no time last), then account, then the plan\'s row', () => {
    const list = orderDay([
      post('a', { slot: 'PM', account: 'F2', rowId: 'P010' }),
      post('b', { slot: 'AM', account: 'F3', rowId: 'P002' }),
      post('c', { slot: 'AM', account: 'F2', rowId: 'P009' }),
      post('d', { slot: '', account: 'F1' }),
      post('e', { slot: 'Daily', account: 'CALLIE' }),
      post('f', { slot: 'AM', account: 'F2', rowId: 'P1' }),
    ], TIMES)
    expect(list.map(p => p.id)).toEqual(['f', 'c', 'b', 'e', 'a', 'd'])
  })
})

describe('left out, and why', () => {
  it('the first reason that applies', () => {
    const o = { includePacked: false, tz: 'UTC' }
    expect(leftOutReason(post('a', { account: '' }), o)?.kind).toBe('no-account')
    expect(leftOutReason(post('a', { approved: false }), o)).toEqual({ kind: 'not-approved', text: 'Not approved for posting' })
    const packed = post('a', { packed: { at: '2026-10-19T13:14:00.000Z', packId: 'job_1', date: '2026-10-19', assetId: 'ast_1' } })
    expect(leftOutReason(packed, o)).toEqual({ kind: 'packed', text: 'Already packed (Oct 19, 1:14 PM, Download day 2026-10-19)' })
    expect(leftOutReason(packed, { includePacked: true })).toBeNull()
    expect(leftOutReason(post('a', { rendering: true }), o)?.kind).toBe('rendering')
    expect(leftOutReason(post('a', { exported: false, missing: 'Slides 3, 5 need a picture (Stills step)' }), o)).toEqual({ kind: 'missing', text: 'Missing pictures: Slides 3, 5 need a picture (Stills step)' })
    expect(leftOutReason(post('a', { exported: false, problem: 'Add shot B' }), o)?.kind).toBe('cannot-render')
    // Approved, never exported, nothing missing: it goes in (exported first).
    expect(leftOutReason(post('a', { exported: false }), o)).toBeNull()
    // An exported post with a problem since still goes in as exported.
    expect(leftOutReason(post('a', { exported: true, missing: 'x' }), o)).toBeNull()
  })
})

describe('folders, files and the text files', () => {
  it('<account>/<n>-<SLOT>-<HHMM>, numbered in posting order within each account; names made safe and kept apart', () => {
    const ordered = orderDay([post('a', { slot: 'AM' }), post('b', { slot: 'PM' }), post('c', { account: 'F3', slot: 'AM' }), post('d', { account: 'F 2', slot: 'AM' }), post('e', { account: 'F2', slot: '' }), post('f', { account: 'Callie TikTok', slot: 'Evening' })], TIMES)
    const f = folderNames(ordered, TIMES)
    expect(f.get('a')).toBe('F2/1-AM-0900')
    expect(f.get('b')).toBe('F2/2-PM-1800')
    expect(f.get('e')).toBe('F2/3-ANY')
    expect(f.get('c')).toBe('F3/1-AM-0900')
    expect(f.get('d')).toBe('F-2/1-AM-0900')
    expect(f.get('f')).toBe('Callie-TikTok/1-EVENING')
    const clash = folderNames([post('x', { account: 'a/b' }), post('y', { account: 'a b' })], TIMES)
    expect([clash.get('x'), clash.get('y')]).toEqual(['a-b/1-AM-0900', 'a-b-2/1-AM-0900'])
    expect(slideFile(0)).toBe('01.jpg')
    expect(slideFile(9)).toBe('10.jpg')
  })
  it('checklist.txt: one line per post in posting order with account, slot time, hook, Ad yes or no and the AI-generated label', () => {
    const ordered = orderDay([post('b', { slot: 'PM', hook: 'second', ad: true }), post('a', { slot: 'AM', hook: 'first "one"' })], TIMES)
    const text = checklistText('2026-10-19', ordered, folderNames(ordered, TIMES), TIMES, 'Oct 18, 9:00 PM')
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe('Download day: Monday, October 19, 2026')
    expect(lines[1]).toBe('2 posts, in posting order. Made Oct 18, 9:00 PM.')
    const posts = lines.filter(l => l.startsWith('[ ]'))
    expect(posts).toEqual([
      '[ ] 1. F2 | 09:00 (AM) | Hook: "first "one"" | Ad: no | AI-generated label: on | F2/1-AM-0900/',
      '[ ] 2. F2 | 18:00 (PM) | Hook: "second" | Ad: yes | AI-generated label: on | F2/2-PM-1800/',
    ])
    expect(posts.every(l => l.includes('AI-generated label: on'))).toBe(true)
  })
  it('left-out.txt: each post left out and why, or that nothing was', () => {
    expect(leftOutText('2026-10-19', [], TIMES)).toBe('Download day 2026-10-19: nothing was left out.\n')
    const t = leftOutText('2026-10-19', [{ account: 'F3', slot: 'AM', hook: 'a hook', name: 'P002', reason: 'Not approved for posting' }, { account: '', slot: '', hook: '', name: 'Untitled', reason: 'No account' }], TIMES)
    expect(t.split('\n')).toEqual([
      'Left out of Download day 2026-10-19: 2 posts.', '',
      'F3 | 09:00 (AM) | Hook: "a hook" | Not approved for posting',
      'No account | Any time | Hook: "Untitled" | No account', '',
    ])
  })
})
