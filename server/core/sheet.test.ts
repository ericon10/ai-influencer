import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load'
import { dependentsOf, invalidationFor, nextUp, sheetProgress, validateGraph, type ShotState } from './sheet'

const shots = loadConfig().pipeline.sheet.shots
const all = (status: ShotState['status']): ShotState[] => shots.map(s => ({ refId: s.id, status }))
const set = (states: ShotState[], id: string, status: ShotState['status']) => states.map(s => (s.refId === id ? { ...s, status } : s))

describe('reference sheet graph', () => {
  it('is valid: every shot depends only on lower numbers', () => {
    expect(() => validateGraph(shots)).not.toThrow()
    const broken = shots.map(s => (s.id === 'REF-01' ? { ...s, attach: ['REF-02'] } : s))
    expect(() => validateGraph(broken)).toThrow(/earlier shot|lower-numbered/)
  })

  it('invalidates transitively: a regenerated REF-04 makes REF-05 and REF-08 stale (SPEC 4.1)', () => {
    expect(dependentsOf(shots, 'REF-04')).toEqual(['REF-05', 'REF-08'])
    expect(invalidationFor(shots, all('approved'), 'REF-04')).toEqual(['REF-05', 'REF-08'])
  })

  it('regenerating REF-00 touches every other shot', () => {
    expect(dependentsOf(shots, 'REF-00')).toEqual(shots.slice(1).map(s => s.id))
  })

  it('does not mark untouched pending shots stale', () => {
    const states = set(set(all('pending'), 'REF-00', 'approved'), 'REF-02', 'approved')
    expect(invalidationFor(shots, set(states, 'REF-04', 'approved'), 'REF-02')).toEqual(['REF-04'])
  })

  it('serves one next-up shot at a time, in order', () => {
    let states = set(all('pending'), 'REF-00', 'approved')
    expect(nextUp(shots, states)).toMatchObject({ shot: { id: 'REF-01' }, action: 'generate' })
    states = set(states, 'REF-01', 'in_review')
    expect(nextUp(shots, states)).toMatchObject({ shot: { id: 'REF-01' }, action: 'review' })
    states = set(states, 'REF-01', 'approved')
    expect(nextUp(shots, states)?.shot.id).toBe('REF-02')
  })

  it('skips blocked shots and resumes with stale rechecks', () => {
    let states = all('approved')
    states = set(set(set(states, 'REF-04', 'generating'), 'REF-05', 'stale'), 'REF-08', 'stale')
    // REF-05 and REF-08 wait for REF-04; nothing else needs work.
    expect(nextUp(shots, states)).toBeNull()
    states = set(states, 'REF-04', 'approved')
    expect(nextUp(shots, states)).toMatchObject({ shot: { id: 'REF-05' }, action: 'recheck' })
    expect(sheetProgress(shots, states)).toMatchObject({ approved: 10, stale: 2, complete: false })
  })
})
