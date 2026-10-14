// The beat (overnight run, beat sync): pure math shared by the worker and
// the browser. The worker reads the music with ffmpeg, the browser with
// Web Audio; both hand mono samples to beatsFromSamples. A tapped or typed
// tempo makes a steady grid instead. Cuts, punch-ins, shakes and ramps
// snap to these times.

const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface BeatResult {
  beats: number[]
  bpm: number | null
}

// Onsets (rises in loudness), then the period where they repeat best (0.3
// to 1 s), then the phase where a grid of that period meets most onsets.
export function beatsFromSamples(samples: Float32Array, rate: number, maxSec = Number.POSITIVE_INFINITY): BeatResult {
  const n = Math.min(samples.length, Math.floor(maxSec * rate))
  const hop = Math.max(1, Math.round(128 * rate / 11025)), win = hop * 4
  const env: number[] = []
  for (let i = 0; i + win <= n; i += hop) {
    let s = 0
    for (let j = i; j < i + win; j++) s += samples[j]! * samples[j]!
    env.push(Math.log(1e-9 + s / win))
  }
  const raw = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)))
  // Smoothed, so a beat that falls between two analysis frames still lines up.
  const kernel = [1, 2, 3, 2, 1]
  const onset = raw.map((_, i) => kernel.reduce((a, k, j) => a + k * (raw[i + j - 2] ?? 0), 0) / 9)
  const frameSec = hop / rate
  let bestLag = 0, bestScore = -1
  for (let lag = Math.round(0.3 / frameSec); lag <= Math.round(1 / frameSec); lag++) {
    let s = 0
    for (let i = lag; i < onset.length; i++) s += onset[i]! * onset[i - lag]!
    if (s > bestScore) { bestScore = s; bestLag = lag }
  }
  if (!bestLag || bestScore <= 0) return { beats: [], bpm: null }
  // A beat at half the period that repeats almost as well is the real beat
  // (the longer lag only counts every other one).
  const halfLag = Math.round(bestLag / 2)
  if (halfLag * frameSec >= 0.25) {
    let s = 0
    for (let i = halfLag; i < onset.length; i++) s += onset[i]! * onset[i - halfLag]!
    if (s >= bestScore * 0.8) bestLag = halfLag
  }
  let bestPhase = 0, phaseScore = -1
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0
    for (let i = ph; i < onset.length; i += bestLag) s += onset[i]!
    if (s > phaseScore) { phaseScore = s; bestPhase = ph }
  }
  const beats: number[] = []
  for (let i = bestPhase; i < onset.length; i += bestLag) beats.push(r3(i * frameSec))
  return { beats, bpm: Math.round((60 / (bestLag * frameSec)) * 10) / 10 }
}

// A steady grid from a tempo: the first beat at `offset`.
export function beatGrid(bpm: number, offset: number, duration: number): number[] {
  if (!(bpm > 0)) return []
  const period = 60 / bpm
  const first = ((offset % period) + period) % period
  const out: number[] = []
  for (let t = first; t <= duration + 1e-6; t += period) out.push(r3(t))
  return out
}

// Tap tempo: the taps' times (seconds). The tempo is the median gap (a
// stray tap does not throw it), the offset the phase that fits the taps.
export function tapTempo(taps: number[]): { bpm: number; offset: number } | null {
  if (taps.length < 3) return null
  const gaps = taps.slice(1).map((t, i) => t - taps[i]!).filter(g => g > 0.2 && g < 2).sort((a, b) => a - b)
  if (gaps.length < 2) return null
  const period = gaps[Math.floor(gaps.length / 2)]!
  // The phase: the mean of the taps' positions on the period, on a circle.
  let sx = 0, sy = 0
  for (const t of taps) { const a = (2 * Math.PI * t) / period; sx += Math.cos(a); sy += Math.sin(a) }
  const phase = ((Math.atan2(sy, sx) / (2 * Math.PI)) * period + period) % period
  return { bpm: Math.round((60 / period) * 10) / 10, offset: r3(phase) }
}

// The nearest point within `tolerance` (seconds), else the time itself.
export function snapTo(t: number, points: number[], tolerance: number): number {
  let best = t, dist = tolerance
  for (const p of points) { const d = Math.abs(p - t); if (d <= dist) { dist = d; best = p } }
  return best
}
