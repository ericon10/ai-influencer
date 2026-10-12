import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpeg, MediaError, probeFile } from './ffmpeg'
import { colorStats, extractFirstFrame, frameDifference } from './frames'
import { clipFrames, encodeArgs, trimClip } from './edit'

export interface JoinOptions {
  // Largest allowed difference across a seam (1 - SSIM). Above it, the seam
  // is blended; if still above after blending, the seam fails.
  maxSeamDiff?: number
  crossfadeFrames?: number
  colorMatch?: boolean
  dropFirstFrame?: boolean
}

export interface SeamReport {
  index: number
  diffBefore: number
  action: 'cut' | 'blend'
  colorMatched: boolean
  crossfadeFrames: number
  diffAfter: number
  passed: boolean
}

export interface JoinResult {
  passed: boolean
  // Null when any seam failed: a failed seam is never exported (SPEC 4.3).
  outputPath: string | null
  seams: SeamReport[]
  durationSec?: number
}

async function lastFrameExact(video: string, out: string): Promise<void> {
  await ffmpeg(['-sseof', '-0.5', '-i', video, '-update', '1', out])
}

async function concatPair(a: string, b: string, out: string, fps: number): Promise<void> {
  await ffmpeg(['-i', a, '-i', b, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', ...encodeArgs(fps), out])
}

async function crossfadePair(a: string, b: string, out: string, fps: number, frames: number): Promise<number> {
  const { durationSec } = await clipFrames(a)
  const d = frames / fps
  const offset = Math.max(0, durationSec - d)
  const fc = `[0:v]settb=AVTB,fps=${fps}[a];[1:v]settb=AVTB,fps=${fps}[b];[a][b]xfade=transition=fade:duration=${d.toFixed(4)}:offset=${offset.toFixed(4)},format=yuv420p[v]`
  await ffmpeg(['-i', a, '-i', b, '-filter_complex', fc, '-map', '[v]', ...encodeArgs(fps), out])
  return offset
}

// Shifts clip B's per-channel mean and contrast to match the reference frame
// (the last frame of clip A). Deterministic, no model involved.
export async function colorMatchClip(input: string, referenceFrame: string, inputFirstFrame: string, out: string, fps: number): Promise<void> {
  const ref = await colorStats(referenceFrame)
  const cur = await colorStats(inputFirstFrame)
  const expr = (i: 0 | 1 | 2) => {
    const k = Math.min(2, Math.max(0.5, ref.std[i] / Math.max(1, cur.std[i])))
    return `'clip((val-${cur.mean[i].toFixed(3)})*${k.toFixed(4)}+${ref.mean[i].toFixed(3)},0,255)'`
  }
  const vf = `lutrgb=r=${expr(0)}:g=${expr(1)}:b=${expr(2)},format=yuv420p`
  await ffmpeg(['-i', input, '-an', '-vf', vf, ...encodeArgs(fps), out])
}

// Largest frame-to-frame difference in a window of the joined clip: the
// re-score after blending.
async function maxStepDifference(video: string, startSec: number, frames: number, fps: number, dir: string, tag: string): Promise<number> {
  const pattern = join(dir, `${tag}_%04d.png`)
  await ffmpeg(['-ss', Math.max(0, startSec).toFixed(4), '-i', video, '-frames:v', String(frames), '-fps_mode', 'passthrough', pattern])
  let worst = 0
  for (let i = 1; i < frames; i++) {
    const a = join(dir, `${tag}_${String(i).padStart(4, '0')}.png`)
    const b = join(dir, `${tag}_${String(i + 1).padStart(4, '0')}.png`)
    try { worst = Math.max(worst, await frameDifference(a, b)) } catch { break }
  }
  return worst
}

// Joins normalized clips (SPEC 4.3 step 3): drop the duplicated first frame of
// each incoming clip, score the seam, blend if needed, re-score, and refuse to
// produce output when a seam still fails.
export async function joinClips(clips: string[], out: string, workDir: string, opts: JoinOptions = {}): Promise<JoinResult> {
  const { maxSeamDiff = 0.18, crossfadeFrames = 3, colorMatch = true, dropFirstFrame = true } = opts
  if (clips.length === 0) throw new MediaError('Nothing to join.')
  if (crossfadeFrames < 2 || crossfadeFrames > 4) throw new MediaError('Crossfade must be 2 to 4 frames.')

  const probes = await Promise.all(clips.map(c => probeFile(c)))
  const p0 = probes[0]!
  for (const [i, p] of probes.entries()) {
    if (p.width !== p0.width || p.height !== p0.height || Math.abs((p.fps ?? 0) - (p0.fps ?? 0)) > 0.01 || p.pixFmt !== p0.pixFmt) {
      throw new MediaError(`Clip ${i + 1} does not match clip 1 (size, fps or pixel format). Normalize clips before joining.`)
    }
  }
  const fps = p0.fps ?? 30
  const seams: SeamReport[] = []
  let current = clips[0]!

  for (let i = 1; i < clips.length; i++) {
    let incoming = clips[i]!
    if (dropFirstFrame) {
      const trimmed = join(workDir, `in_${i}_trim.mp4`)
      await trimClip(incoming, trimmed, { dropFirstFrames: 1 })
      incoming = trimmed
    }
    const lastA = join(workDir, `seam_${i}_a.png`)
    const firstB = join(workDir, `seam_${i}_b.png`)
    await lastFrameExact(current, lastA)
    await extractFirstFrame(incoming, firstB)
    const diffBefore = await frameDifference(lastA, firstB)
    const next = join(workDir, `joined_${i}.mp4`)

    if (diffBefore <= maxSeamDiff) {
      await concatPair(current, incoming, next, fps)
      seams.push({ index: i, diffBefore, action: 'cut', colorMatched: false, crossfadeFrames: 0, diffAfter: diffBefore, passed: true })
      current = next
      continue
    }

    let blendSource = incoming
    if (colorMatch) {
      const matched = join(workDir, `in_${i}_matched.mp4`)
      await colorMatchClip(incoming, lastA, firstB, matched, fps)
      blendSource = matched
    }
    const offset = await crossfadePair(current, blendSource, next, fps, crossfadeFrames)
    const diffAfter = await maxStepDifference(next, offset - 1 / fps, crossfadeFrames + 3, fps, workDir, `rescore_${i}`)
    const passed = diffAfter <= maxSeamDiff
    seams.push({ index: i, diffBefore, action: 'blend', colorMatched: colorMatch, crossfadeFrames, diffAfter, passed })
    if (!passed) return { passed: false, outputPath: null, seams }
    current = next
  }

  await copyFile(current, out)
  const { durationSec } = await clipFrames(out)
  return { passed: true, outputPath: out, seams, durationSec }
}
