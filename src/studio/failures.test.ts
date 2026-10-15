import { describe, expect, it } from 'vitest'
import { failureLine } from './failures'

describe('the gray line of earlier failures', () => {
  it('counts by reason, as the owner asked', () => {
    expect(failureLine([
      ...Array.from({ length: 4 }, () => ({ kind: 'blocked' as const })),
      { kind: 'not_run', facePass: true }, { kind: 'not_run', facePass: true },
    ])).toBe('4 blocked by the filter, refunded; 2 face passes not run. Nothing charged.')
  })
  it('says when a run may have been charged', () => {
    expect(failureLine([{ kind: 'failed', charged: 'maybe' }, { kind: 'failed', charged: 'no' }])).toBe('2 failed. 1 run may have been charged (see Activity).')
  })
  it('one of each, singular', () => {
    expect(failureLine([{ kind: 'blocked' }, { kind: 'not_run', facePass: true }, { kind: 'failed' }])).toBe('1 blocked by the filter, refunded; 1 face pass not run; 1 failed. Nothing charged.')
  })
})
