import { describe, expect, it } from 'vitest'
import { batchProgress } from './batchProgress'

describe('batch progress on Posts home', () => {
  it('reads "12 of 50 done", with failures apart', () => {
    expect(batchProgress({ total: 50, done: 12, failed: 0 })).toEqual({ text: '12 of 50 done', share: 0.24 })
    expect(batchProgress({ total: 50, done: 47, failed: 3 })).toEqual({ text: '47 of 50 done, 3 failed', share: 1 })
  })
  it('shows nothing before a batch starts', () => {
    expect(batchProgress({})).toBeNull()
  })
})
