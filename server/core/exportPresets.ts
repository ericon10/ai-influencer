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

// The video bitrate (kbps) from a probe: the stream's own, else the file's
// size over its length minus the sound.
export function videoKbps(streamBitRate: number | null, sizeBytes: number, durationSec: number, audioKbps = 192): number | null {
  if (streamBitRate && Number.isFinite(streamBitRate)) return Math.round(streamBitRate / 1000)
  if (!durationSec) return null
  return Math.max(0, Math.round((sizeBytes * 8) / durationSec / 1000 - audioKbps))
}
