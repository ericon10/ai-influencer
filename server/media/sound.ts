import { join } from 'node:path'
import { ffmpeg, ffmpegVerbose, MediaError, probeFile } from './ffmpeg.js'

// The sound bed (Phase 3; SPEC 5.5): the clip's own sound when it has one,
// ambience (built-in Room tone or a recording the owner uploaded) and an
// optional music track the owner uploaded. Every layer is leveled from its
// measured loudness, the music dips under the clip's own sound (a sidechain
// compressor, "ducking"), and the finished mix is normalized to social
// loudness in two passes (measure, then a linear gain with a true-peak
// ceiling). Local and free; no AI audio anywhere.

export interface Loudness { i: number; tp: number; lra: number; thresh: number; offset: number }

const SILENT = -70
const num = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Integrated loudness (EBU R128, LUFS) and true peak of a file's audio, from
// loudnorm's measuring pass. Silence reads as -70 LUFS.
export async function measureLoudness(path: string, filter = ''): Promise<Loudness> {
  const { stderr } = await ffmpegVerbose(['-i', path, '-vn', '-af', `${filter ? `${filter},` : ''}loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-'])
  const start = stderr.lastIndexOf('{'), end = stderr.lastIndexOf('}')
  if (start < 0 || end < start) throw new MediaError('Could not measure the loudness.', stderr)
  const d = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>
  return { i: num(d.input_i, SILENT), tp: num(d.input_tp, SILENT), lra: num(d.input_lra, 0), thresh: num(d.input_thresh, SILENT - 10), offset: num(d.target_offset, 0) }
}

// Room tone: a quiet room, made by code (brown noise kept to the low hum of
// a room). Deterministic, so the same post always sounds the same.
export async function makeRoomTone(out: string, seconds: number): Promise<void> {
  await ffmpeg([
    '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.35:seed=11:sample_rate=48000:duration=${seconds.toFixed(3)}`,
    '-af', 'highpass=f=60,lowpass=f=450,aformat=sample_rates=48000:channel_layouts=stereo', '-c:a', 'pcm_s16le', out,
  ])
}

// An uploaded ambience recording or music track made lean: AAC, 48 kHz,
// stereo, cut at the length limit, with its loudness measured.
export async function transcodeSound(input: string, out: string, o: { maxSeconds: number }): Promise<{ durationSec: number; loudness: number }> {
  const p = await probeFile(input)
  if (!p.hasAudio) throw new MediaError('That file has no sound.')
  await ffmpeg(['-i', input, '-t', String(o.maxSeconds), '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out], 600_000)
  const done = await probeFile(out)
  return { durationSec: done.durationSec ?? 0, loudness: (await measureLoudness(out)).i }
}

export interface SoundLevels {
  // The finished post with music or the clip's own sound, and with
  // ambience only.
  target: number
  truePeak: number
  ambienceAlone: number
  // Where each layer sits before the mix.
  ambience: number
  music: number
  duck: { threshold: number; ratio: number; attackMs: number; releaseMs: number }
}

export interface SoundBedInput {
  // The picture, possibly carrying the clips' own sound.
  video: string
  out: string
  workDir: string
  clipSound: boolean
  ambience?: { path: string } | { builtin: 'room' } | null
  ambienceDb?: number
  music?: { path: string } | null
  musicDb?: number
  duck?: boolean
  levels: SoundLevels
}

export interface SoundBedResult {
  hasSound: boolean
  layers: Array<'clip' | 'ambience' | 'music'>
  // The finished loudness target, and whether the music was ducked.
  targetLufs: number | null
  ducked: boolean
}

// Lays the sound bed under the picture. The picture is copied untouched.
export async function applySoundBed(s: SoundBedInput): Promise<SoundBedResult> {
  const probe = await probeFile(s.video)
  const dur = probe.durationSec
  if (!probe.hasVideo || !dur) throw new MediaError('The video has no duration.')
  const d = dur.toFixed(3)
  const inputs: string[] = []
  const chains: string[] = []
  const labels: string[] = []
  const layers: SoundBedResult['layers'] = []
  let n = 0

  // The clip's own sound (a clone with its original sound, an upload):
  // left at its own level; it is the foreground when it is really there.
  let clipLabel: string | null = null
  if (s.clipSound && probe.hasAudio) {
    const clipWav = join(s.workDir, 'clip-sound.wav')
    await ffmpeg(['-i', s.video, '-vn', '-map', '0:a:0', '-af', `aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${d},atrim=0:${d}`, '-c:a', 'pcm_s16le', clipWav])
    const l = await measureLoudness(clipWav)
    if (l.i > -50) {
      inputs.push('-i', clipWav)
      chains.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo[clip]`)
      clipLabel = 'clip'
      layers.push('clip')
      n++
    }
  }

  if (s.ambience) {
    let path: string
    if ('builtin' in s.ambience) {
      path = join(s.workDir, 'room-tone.wav')
      await makeRoomTone(path, dur)
    } else path = s.ambience.path
    const l = await measureLoudness(path)
    if (l.i > -60) {
      const gain = s.levels.ambience - l.i + (s.ambienceDb ?? 0)
      inputs.push('-stream_loop', '-1', '-i', path)
      const fadeOut = Math.min(0.8, dur / 4)
      chains.push(`[${n}:a]atrim=0:${d},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${gain.toFixed(2)}dB,afade=t=in:st=0:d=${Math.min(0.5, dur / 4).toFixed(3)},afade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[amb]`)
      labels.push('[amb]')
      layers.push('ambience')
      n++
    }
  }

  let ducked = false
  if (s.music) {
    const l = await measureLoudness(s.music.path)
    if (l.i > -60) {
      const gain = s.levels.music - l.i + (s.musicDb ?? 0)
      inputs.push('-i', s.music.path)
      const fadeOut = Math.min(1.2, dur / 3)
      chains.push(`[${n}:a]atrim=0:${d},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${gain.toFixed(2)}dB,afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[mus0]`)
      if (s.duck !== false && clipLabel) {
        // The clip's own sound keys the compressor on the music.
        const k = s.levels.duck
        chains.push(`[clip]asplit=2[clipmix][clipkey]`)
        chains.push(`[mus0][clipkey]sidechaincompress=threshold=${k.threshold}:ratio=${k.ratio}:attack=${k.attackMs}:release=${k.releaseMs}:makeup=1[mus]`)
        clipLabel = 'clipmix'
        ducked = true
      } else chains.push('[mus0]anull[mus]')
      labels.push('[mus]')
      layers.push('music')
      n++
    }
  }
  if (clipLabel) labels.unshift(`[${clipLabel}]`)

  if (!labels.length) {
    // Nothing to hear: a silent post.
    await ffmpeg(['-i', s.video, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', s.out])
    return { hasSound: false, layers: [], targetLufs: null, ducked: false }
  }

  // Pass 1: the mix, kept in float so nothing clips before the gain.
  const mixWav = join(s.workDir, 'mix.wav')
  const mix = labels.length > 1
    ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,atrim=0:${d}[mix]`
    : `${labels[0]}atrim=0:${d}[mix]`
  await ffmpeg([...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '[mix]', '-c:a', 'pcm_f32le', '-ar', '48000', mixWav], 600_000)

  // Pass 2: one linear gain to the target, with a true-peak ceiling.
  const foreground = layers.includes('clip') || layers.includes('music')
  const target = foreground ? s.levels.target : s.levels.ambienceAlone
  const m = await measureLoudness(mixWav)
  const norm = `loudnorm=I=${target}:TP=${s.levels.truePeak}:LRA=11:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true,aresample=48000`
  await ffmpeg(['-i', s.video, '-i', mixWav, '-map', '0:v:0', '-map', '1:a:0', '-af', norm, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', s.out], 600_000)
  return { hasSound: true, layers, targetLufs: target, ducked }
}
