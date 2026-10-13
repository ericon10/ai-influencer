import { ffmpeg, MediaError, probeFile } from './ffmpeg.js'

export interface AudioLayer {
  path: string
  gainDb?: number
  loop?: boolean
  startSec?: number
  fadeInSec?: number
  fadeOutSec?: number
}

// Lays one continuous sound bed under a finished video (SPEC 5.5): layers
// are trimmed to the video length, delayed, gain-adjusted and mixed without
// automatic normalization, so the requested levels are the real levels.
export async function mixOntoVideo(video: string, layers: AudioLayer[], out: string): Promise<void> {
  if (!layers.length) throw new MediaError('At least one audio layer is required.')
  const probe = await probeFile(video)
  const dur = probe.durationSec
  if (!probe.hasVideo || !dur) throw new MediaError('The video has no duration.')

  const inputs: string[] = ['-i', video]
  const chains: string[] = []
  layers.forEach((l, j) => {
    if (l.loop) inputs.push('-stream_loop', '-1')
    inputs.push('-i', l.path)
    const startMs = Math.round((l.startSec ?? 0) * 1000)
    const parts = [
      `atrim=0:${dur.toFixed(3)}`,
      'asetpts=PTS-STARTPTS',
      'aresample=48000',
      'aformat=channel_layouts=stereo',
      startMs ? `adelay=${startMs}|${startMs}` : '',
      `volume=${(l.gainDb ?? 0).toFixed(2)}dB`,
      l.fadeInSec ? `afade=t=in:st=0:d=${l.fadeInSec}` : '',
      l.fadeOutSec ? `afade=t=out:st=${Math.max(0, dur - l.fadeOutSec).toFixed(3)}:d=${l.fadeOutSec}` : '',
    ].filter(Boolean)
    chains.push(`[${j + 1}:a]${parts.join(',')}[a${j}]`)
  })
  const labels = layers.map((_, j) => `[a${j}]`).join('')
  const mix = layers.length > 1
    ? `${labels}amix=inputs=${layers.length}:normalize=0:duration=longest,atrim=0:${dur.toFixed(3)}[aout]`
    : `${labels}atrim=0:${dur.toFixed(3)}[aout]`
  await ffmpeg([
    ...inputs,
    '-filter_complex', [...chains, mix].join(';'),
    '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out,
  ])
}
