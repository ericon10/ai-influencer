import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { hookCaptions, presetFor, presetLine, videoKbps } from './exportPresets.js'

// Export for TikTok, Reels or Shorts, and hook variants (long run part 4).

const cfg = loadConfig().pipeline.content
type C = { text: string; start: number; end: number | null }
const make = (text: string, start: number, end: number): C => ({ text, start, end })

describe('export presets', () => {
  it('TikTok, Reels and Shorts, with TikTok first; an unknown id falls back to it', () => {
    expect(cfg.export_presets.map(p => p.id)).toEqual(['tiktok', 'reels', 'shorts'])
    expect(presetFor(cfg.export_presets, 'shorts').max_seconds).toBe(60)
    expect(presetFor(cfg.export_presets, 'nope').id).toBe('tiktok')
    expect(presetFor(cfg.export_presets, null).id).toBe('tiktok')
    for (const p of cfg.export_presets) expect(p.max_seconds).toBeLessThanOrEqual(cfg.cut.max_seconds)
  })
  it('says the numbers on the chip', () => {
    expect(presetLine(presetFor(cfg.export_presets, 'tiktok'))).toBe('up to 90 s, 12 Mbps, -14 LUFS')
  })
  it('reads the video bitrate from the stream, else from the file size', () => {
    expect(videoKbps(8_000_000, 0, 0)).toBe(8000)
    expect(videoKbps(null, 10_000_000, 10)).toBe(8000 - 192)
    expect(videoKbps(null, 1, 0)).toBeNull()
  })
})

describe('hook variants: a different first 2 seconds', () => {
  const caps: C[] = [
    { text: 'opening line', start: 0, end: 1.5 },
    { text: 'runs over', start: 1, end: 4 },
    { text: 'the payoff', start: 4, end: 6 },
    { text: 'to the end', start: 0.5, end: null },
  ]
  it('the hook over 0 to 2 s; a caption inside goes, one running past starts at 2 s, the rest stays', () => {
    const out = hookCaptions(caps, 'nobody warned me', 2, make)
    expect(out).toEqual([
      { text: 'nobody warned me', start: 0, end: 2 },
      { text: 'runs over', start: 2, end: 4 },
      { text: 'the payoff', start: 4, end: 6 },
      { text: 'to the end', start: 2, end: null },
    ])
  })
  it('a blank hook changes nothing; a post with no caption gets only the hook', () => {
    expect(hookCaptions(caps, '  ', 2, make)).toBe(caps)
    expect(hookCaptions([], 'hi', 2, make)).toEqual([{ text: 'hi', start: 0, end: 2 }])
    expect(cfg.hook_variants).toEqual({ max: 3, seconds: 2 })
  })
})
