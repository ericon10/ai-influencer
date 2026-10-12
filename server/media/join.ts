import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpeg, MediaError, probeFile } from './ffmpeg'
import { colorStats, extractFirstFrame, frameDifference } from './frames'
import { clipFrames, encodeArgs, trimClip } from './edit'

export interface JoinOptions {
  // Largest difference across a seam (1 - SSIM) that still cuts cleanly.
  maxSeamDiff?: number
  // A camera moving across the seam carries a larger jump, as long as the
  // jump looks like an ordinary frame step: at most motionRatio times the
  // motion around it, and never above motionMaxSeamDiff.
  motionMaxSeamDiff?: number
  motionRatio?: number
  // Average frame-to-frame difference near the seam that counts as camera
  // motion.
  motionThreshold?: number
  // Grade the incoming clip toward the outgoing one before failing a seam.
  // A grade, never a blend.
  colorMatch?: boolean
  dropFirstFrame?: boolean
}

export type SeamReason = 'clean' | 'camera_motion' | 'color_matched' | 'no_match'

export interface SeamReport {
  index: number
  diffBefore: number
  // Average frame-to-frame difference across the frames around the seam.
  motion: number
  action: 'cut' | 'failed'
  reason: SeamReason
  colorMatched: boolean
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

// Average frame-to-frame difference over a few frames: how much the picture
// is moving (camera motion shows up as large differences everywhere).
async function meanStepDifference(video: string, startSec: number, frames: number, dir: string, tag: string): Promise<number> {
  const pattern = join(dir, `${tag}_%04d.png`)
  await ffmpeg(['-ss', Math.max(0, startSec).toFixed(4), '-i', video, '-frames:v', String(frames), '-fps_mode', 'passthrough', pattern])
  const diffs: number[] = []
  for (let i = 1; i < frames; i++) {
    const a = join(dir, `${tag}_${String(i).padStart(4, '0')}.png`)
    const b = join(dir, `${tag}_${String(i + 1).padStart(4, '0')}.png`)
    try { diffs.push(await frameDifference(a, b)) } catch { break }
  }
  return diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : 0
}

// Joins normalized clips (SPEC 4.3 step 3). Never crossfades: a blend ghosts
// when the subject moved. For each seam: drop the duplicated first frame of
// the incoming clip, then cut if the seam is clean, or if the camera is moving
// across it (the motion carries the jump), or if grading the incoming clip
// toward the outgoing one makes it clean. Otherwise the seam fails and there
// is no output. The better path is no seam at all: one take with a start and
// an end frame.
export async function joinClips(clips: string[], out: string, workDir: string, opts: JoinOptions = {}): Promise<JoinResult> {
  const { maxSeamDiff = 0.18, motionMaxSeamDiff = 0.35, motionRatio = 1.5, motionThreshold = 0.10, colorMatch = true, dropFirstFrame = true } = opts
  if (clips.length === 0) throw new MediaError('Nothing to join.')

  const probes = await Promise.all(clips.map(c => probeFile(c)))
  const p0 = probes[0]!
  for (const [i, p] of probes.entries()) {
    if (p.width !== p0.width || p.height !== p0.height || Math.abs((p.fps ?? 0) - (p0.fps ?? 0)) > 0.01 || p.pixFmt !== p0.pixFmt) {
      throw new MediaError(`Clip ${i + 1} does not match clip 1 (size, fps or pixel format). Normalize clips before joining.`)
    }
  }
  const fps = p0.fps ?? 30
  const window = 4
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
    const { durationSec: durA } = await clipFrames(current)
    const motion = Math.min(
      await meanStepDifference(current, durA - window / fps, window, workDir, `motion_${i}_a`),
      await meanStepDifference(incoming, 0, window, workDir, `motion_${i}_b`),
    )
    const next = join(workDir, `joined_${i}.mp4`)
    const cut = async (source: string, reason: SeamReason, colorMatched: boolean, diffAfter: number) => {
      await concatPair(current, source, next, fps)
      seams.push({ index: i, diffBefore, motion, action: 'cut', reason, colorMatched, diffAfter, passed: true })
      current = next
    }

    if (diffBefore <= maxSeamDiff) { await cut(incoming, 'clean', false, diffBefore); continue }
    const motionLimit = Math.min(motionMaxSeamDiff, Math.max(maxSeamDiff, motion * motionRatio))
    if (motion >= motionThreshold && diffBefore <= motionLimit) { await cut(incoming, 'camera_motion', false, diffBefore); continue }
    if (colorMatch) {
      const matched = join(workDir, `in_${i}_matched.mp4`)
      const matchedFirst = join(workDir, `seam_${i}_b_matched.png`)
      await colorMatchClip(incoming, lastA, firstB, matched, fps)
      await extractFirstFrame(matched, matchedFirst)
      const diffAfter = await frameDifference(lastA, matchedFirst)
      if (diffAfter <= maxSeamDiff) { await cut(matched, 'color_matched', true, diffAfter); continue }
      seams.push({ index: i, diffBefore, motion, action: 'failed', reason: 'no_match', colorMatched: true, diffAfter, passed: false })
    } else {
      seams.push({ index: i, diffBefore, motion, action: 'failed', reason: 'no_match', colorMatched: false, diffAfter: diffBefore, passed: false })
    }
    return { passed: false, outputPath: null, seams }
  }

  await copyFile(current, out)
  const { durationSec } = await clipFrames(out)
  return { passed: true, outputPath: out, seams, durationSec }
}
