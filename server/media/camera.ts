import { spawn } from 'node:child_process'
import { copyFile } from 'node:fs/promises'
import { blockFrameAt, isIdentity, shakeOffset, type CameraBlock, type CameraFrame } from '../core/camera.js'
import { MediaError, probeFile } from './ffmpeg.js'

// Camera presets on the worker (editor phase D): the picture goes through
// frame by frame and every frame inside a preset block is moved the way the
// editor's canvas moves it (OpenReel fork, packages/core/src/studio/
// camera.ts): scale, shift and rotate around the centre over black, blur,
// colour and brightness, a motion streak, the RGB split, vignette, dark
// and flash, in that order. Frames outside the blocks pass through. The
// sound is copied. Free (ffmpeg and plain JavaScript on the worker).

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

export interface CameraPassResult { frames: number; moved: number }

export async function applyCameraBlocks(video: string, out: string, blocks: CameraBlock[], opts: { width: number; height: number; fps: number }): Promise<CameraPassResult> {
  const live = blocks.filter(b => b.duration > 0 && b.keys.length)
  if (!live.length) { await copyFile(video, out); return { frames: 0, moved: 0 } }
  const { width: W, height: H, fps } = opts
  const info = await probeFile(video)
  const dec = spawn(FFMPEG, ['-v', 'error', '-i', video, '-vf', `scale=${W}:${H},setsar=1,fps=${fps}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const encArgs = ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0']
  if (info.hasAudio) encArgs.push('-i', video, '-map', '0:v', '-map', '1:a', '-c:a', 'copy')
  encArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', '-shortest', out)
  const enc = spawn(FFMPEG, encArgs, { stdio: ['pipe', 'ignore', 'pipe'] })
  let decErr = '', encErr = ''
  dec.stderr.on('data', d => { decErr += d })
  enc.stderr.on('data', d => { encErr += d })
  const decDone = new Promise<number>(res => dec.on('close', code => res(code ?? 1)))
  const encDone = new Promise<number>(res => enc.on('close', code => res(code ?? 1)))
  enc.stdin.on('error', () => undefined)

  const frameBytes = W * H * 3
  let pending: Buffer = Buffer.alloc(0)
  let frames = 0, moved = 0
  const write = (buf: Uint8Array) => new Promise<void>((res, rej) => enc.stdin.write(buf, e => (e ? rej(e) : res())))
  for await (const chunk of dec.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    while (pending.length >= frameBytes) {
      let frame: Uint8Array = Buffer.from(pending.subarray(0, frameBytes))
      pending = pending.subarray(frameBytes)
      const time = frames / fps
      let touched = false
      for (const b of live) {
        const f = blockFrameAt(b, time)
        if (!f || isIdentity(f)) continue
        frame = moveFrame(frame, W, H, f, time)
        touched = true
      }
      if (touched) moved++
      frames++
      await write(frame)
    }
  }
  enc.stdin.end()
  const [dc, ec] = await Promise.all([decDone, encDone])
  if (dc !== 0) throw new MediaError(`The picture could not be read for the presets: ${decErr.trim().slice(-300)}`)
  if (ec !== 0) throw new MediaError(`The presets could not be written: ${encErr.trim().slice(-300)}`)
  if (!frames) throw new MediaError('No frames came out of the picture.')
  return { frames, moved }
}

// One frame (rgb24) moved by a camera frame. Exported for the tests.
export function moveFrame(src: Uint8Array, W: number, H: number, f: CameraFrame, time: number): Uint8Array {
  const px = W / 1080
  const sh = shakeOffset(time, f.shake)
  const cx = W / 2 + (f.x + sh.dx) * W, cy = H / 2 + (f.y + sh.dy) * H
  const th = ((f.rotation + sh.rot) * Math.PI) / 180
  const cos = Math.cos(th), sin = Math.sin(th), inv = 1 / f.scale
  // The picture, placed over black (bilinear).
  const base = new Float32Array(W * H * 3)
  for (let Y = 0; Y < H; Y++) {
    const dy = Y + 0.5 - cy
    for (let X = 0; X < W; X++) {
      const dx = X + 0.5 - cx
      const qx = (cos * dx + sin * dy) * inv + W / 2 - 0.5
      const qy = (-sin * dx + cos * dy) * inv + H / 2 - 0.5
      const o = (Y * W + X) * 3
      if (qx < -0.5 || qy < -0.5 || qx > W - 0.5 || qy > H - 0.5) continue
      const x0 = Math.max(0, Math.min(W - 1, Math.floor(qx))), y0 = Math.max(0, Math.min(H - 1, Math.floor(qy)))
      const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1)
      const ax = Math.max(0, Math.min(1, qx - x0)), ay = Math.max(0, Math.min(1, qy - y0))
      const i00 = (y0 * W + x0) * 3, i10 = (y0 * W + x1) * 3, i01 = (y1 * W + x0) * 3, i11 = (y1 * W + x1) * 3
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c]! + (src[i10 + c]! - src[i00 + c]!) * ax
        const bot = src[i01 + c]! + (src[i11 + c]! - src[i01 + c]!) * ax
        base[o + c] = top + (bot - top) * ay
      }
    }
  }
  if (f.blur > 0.05) boxBlur3(base, W, H, f.blur * px)
  if (f.saturation !== 1 || f.brightness !== 1) colour(base, f.saturation, f.brightness)
  let img = base
  // The motion streak: faint copies either side, along the frame.
  if (f.motionBlur > 0.02) {
    const out = Float32Array.from(base)
    const spread = f.motionBlur * 0.06 * W
    for (let i = 1; i <= 4; i++) {
      const off = Math.round((i / 4) * spread), a = (0.22 * f.motionBlur) / i
      for (const d of [off, -off]) blendShifted(out, base, W, H, d, a)
    }
    img = out
  }
  // RGB split: red then cyan copies, screened over the picture.
  if (f.rgb > 0.2) {
    const d = Math.round(f.rgb * px)
    screenChannels(img, W, H, -d, [0])
    screenChannels(img, W, H, d, [1, 2])
  }
  const r0 = Math.min(W, H) * 0.3, r1 = Math.max(W, H) * 0.75
  const out = new Uint8Array(W * H * 3)
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let keep = 1
      if (f.vignette > 0) {
        const r = Math.hypot(X + 0.5 - W / 2, Y + 0.5 - H / 2)
        keep *= 1 - 0.85 * f.vignette * Math.max(0, Math.min(1, (r - r0) / (r1 - r0)))
      }
      if (f.dark > 0) keep *= 1 - f.dark
      const o = (Y * W + X) * 3
      for (let c = 0; c < 3; c++) {
        let v = img[o + c]! * keep
        if (f.flash > 0) v += (255 - v) * f.flash
        out[o + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
      }
    }
  }
  return out
}

// CSS saturate() and brightness(), as the canvas filter does them.
function colour(a: Float32Array, s: number, b: number): void {
  const m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]
  for (let i = 0; i < a.length; i += 3) {
    const r = a[i]!, g = a[i + 1]!, bl = a[i + 2]!
    a[i] = Math.max(0, Math.min(255, (m[0]! * r + m[1]! * g + m[2]! * bl) * b))
    a[i + 1] = Math.max(0, Math.min(255, (m[3]! * r + m[4]! * g + m[5]! * bl) * b))
    a[i + 2] = Math.max(0, Math.min(255, (m[6]! * r + m[7]! * g + m[8]! * bl) * b))
  }
}

function blendShifted(dst: Float32Array, src: Float32Array, W: number, H: number, d: number, a: number): void {
  for (let Y = 0; Y < H; Y++) {
    for (let X = Math.max(0, d); X < Math.min(W, W + d); X++) {
      const o = (Y * W + X) * 3, s = (Y * W + X - d) * 3
      for (let c = 0; c < 3; c++) dst[o + c] = dst[o + c]! * (1 - a) + src[s + c]! * a
    }
  }
}

// Screen a copy of some channels, shifted by d, at 55 percent.
function screenChannels(img: Float32Array, W: number, H: number, d: number, channels: number[]): void {
  const copy = Float32Array.from(img)
  for (let Y = 0; Y < H; Y++) {
    for (let X = Math.max(0, d); X < Math.min(W, W + d); X++) {
      const o = (Y * W + X) * 3, s = (Y * W + X - d) * 3
      for (const c of channels) {
        const cb = img[o + c]!, cs = copy[s + c]!
        img[o + c] = cb + 0.55 * cs * (1 - cb / 255)
      }
    }
  }
}

// A Gaussian blur of standard deviation sigma, as three box passes.
function boxBlur3(a: Float32Array, W: number, H: number, sigma: number): void {
  const w = Math.max(1, Math.round(Math.sqrt(4 * sigma * sigma + 1)))
  const r = Math.max(1, Math.floor(w / 2))
  const tmp = new Float32Array(a.length)
  for (let pass = 0; pass < 3; pass++) {
    boxLine(a, tmp, W, H, r, true)
    boxLine(tmp, a, W, H, r, false)
  }
}

function boxLine(src: Float32Array, dst: Float32Array, W: number, H: number, r: number, horizontal: boolean): void {
  const lines = horizontal ? H : W, len = horizontal ? W : H
  const idx = (line: number, i: number) => (horizontal ? line * W + i : i * W + line) * 3
  const n = 2 * r + 1
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let i = -r; i <= r; i++) sum += src[idx(line, Math.max(0, Math.min(len - 1, i))) + c]!
      for (let i = 0; i < len; i++) {
        dst[idx(line, i) + c] = sum / n
        const add = Math.min(len - 1, i + r + 1), drop = Math.max(0, i - r)
        sum += src[idx(line, add) + c]! - src[idx(line, drop) + c]!
      }
    }
  }
}
