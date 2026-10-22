import { describe, expect, it } from 'vitest'
import { reelFilter, slideSeconds } from './platforms.js'

// Item 28: the reel's timing and its ffmpeg graph (the files themselves are
// checked in the browser suite with ffprobe).
describe('one post, three platforms', () => {
  it('a slide stays up 2 to 3 s, longer for more words', () => {
    expect(slideSeconds('')).toBe(2)
    expect(slideSeconds('ghosted after the final round')).toBe(2.4)
    expect(slideSeconds('one two three four five six seven eight nine ten eleven twelve thirteen fourteen')).toBe(3)
  })
  it('each slide a slow push-in from one frame, then cut together, no crossfade, no sound', () => {
    const f = reelFilter([2, 3])
    expect(f).toContain("[0:v]scale=2160:3840,zoompan=z='min(1+0.06*on/60,1.06)':d=60")
    expect(f).toContain(':d=90:')
    expect(f).toMatch(/\[v0\]\[v1\]concat=n=2:v=1:a=0\[out\]$/)
    expect(f).not.toMatch(/xfade|fade/)
  })
})
