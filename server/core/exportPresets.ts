// Export for TikTok, Reels or Shorts, and hook variants (long run part 4,
// owner 2026-10-15). The presets are data (config/content.yaml).

export interface ExportPreset { id: string; label: string; max_seconds: number; video_kbps: number; lufs: number; true_peak: number }

// The post's preset, or the first one (TikTok) when it names none we know.
export function presetFor(list: ExportPreset[], id: string | null | undefined): ExportPreset {
  return list.find(p => p.id === id) ?? list[0]!
}

// "up to 90 s, 12 Mbps, -14 LUFS", for the chip.
export function presetLine(p: ExportPreset): string {
  return `up to ${p.max_seconds} s, ${Math.round(p.video_kbps / 100) / 10} Mbps, ${p.lufs} LUFS`
}

// One hook over the first `seconds`: a caption that ends inside them goes,
// one that runs past them starts where the hook ends, and every other
// caption stays as it is. A blank hook changes nothing.
export function hookCaptions<T extends { text?: string | null; start: number; end: number | null }>(list: T[], hook: string, seconds: number, make: (text: string, start: number, end: number) => T): T[] {
  const h = hook.trim()
  if (!h) return list
  const rest = list
    .filter(c => !(c.end != null && c.end <= seconds))
    .map(c => (c.start < seconds ? { ...c, start: seconds } : c))
  return [make(h, 0, seconds), ...rest]
}

// A hook variant's first shot: the first `seconds` of picture come from
// another shot, and the timeline carries on from there (same length, same
// captions and presets). Each shot is given with its length on the timeline;
// a shot that ends inside those seconds goes, the one that runs past them
// starts later in its source.
export function replaceHead<T extends { in: number; out: number | null }>(shots: Array<{ shot: T; length: number }>, seconds: number, head: T): T[] {
  const out: T[] = [{ ...head, in: 0, out: seconds }]
  let at = 0
  for (const { shot, length } of shots) {
    const start = at, end = at + length
    at = end
    if (end <= seconds + 1e-6) continue
    if (start < seconds) {
      const cut = seconds - start
      out.push({ ...shot, in: Math.round((shot.in + cut) * 1000) / 1000, out: Math.round((shot.in + length) * 1000) / 1000 })
    } else out.push(shot)
  }
  return out
}

// A hook variant's first edit: a camera preset at 0 s, in place of any
// camera preset that started inside the first seconds.
export function headBlocks<B extends { start: number }>(blocks: B[], seconds: number, first: B | null): B[] {
  if (!first) return blocks
  return [first, ...blocks.filter(b => b.start >= seconds)]
}

// The video bitrate (kbps) from a probe: the stream's own, else the file's
// size over its length minus the sound.
export function videoKbps(streamBitRate: number | null, sizeBytes: number, durationSec: number, audioKbps = 192): number | null {
  if (streamBitRate && Number.isFinite(streamBitRate)) return Math.round(streamBitRate / 1000)
  if (!durationSec) return null
  return Math.max(0, Math.round((sizeBytes * 8) / durationSec / 1000 - audioKbps))
}
