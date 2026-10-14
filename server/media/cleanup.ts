import { spawn } from 'node:child_process'
import { copyFile } from 'node:fs/promises'
import { ffmpeg, ffmpegVerbose, MediaError, probeFile } from './ffmpeg.js'

// Clone source cleanup (overnight item 3): a saved TikTok ends on its end
// card (the logo and the handle on black) and carries burned-in captions
// and the bouncing handle watermark. The clone model would copy all of it,
// so before cloning: the end card is trimmed, and text that sits still
// over a moving picture is found and filled in from around it (ffmpeg's
// delogo). Free, on the worker. Detection is a heuristic; the owner can
// undo the cleanup in the Clone panel.

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

// The end card: a mostly black stretch that runs to the end and starts in
// the last 6 seconds. Returns where to cut, or null.
export async function detectEndCard(video: string): Promise<number | null> {
  const info = await probeFile(video)
  const total = info.durationSec ?? 0
  if (total < 3) return null
  const from = Math.max(0, total - 6)
  const { stderr } = await ffmpegVerbose(['-ss', String(from), '-i', video, '-an', '-vf', 'blackdetect=d=0.8:pic_th=0.82:pix_th=0.12', '-f', 'null', '-'], 120_000)
  let cut: number | null = null
  for (const m of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    const start = from + Number(m[1]), end = from + Number(m[2])
    if (end >= total - 0.35 && start > 1) cut = start
  }
  return cut == null ? null : Math.round(Math.max(1, cut - 0.05) * 100) / 100
}

export interface OverlayBox { x: number; y: number; w: number; h: number; start: number; end: number }

// Text over the picture: pixels that stay sharp and still across a 2 s
// window while the rest of the picture moves, and TikTok's still white
// caption box around such text. Boxes in the source's pixels, with the
// time they show. Small grey frames (270 wide) keep it quick.
// `until`: the end card's start, so the card's own logo is not counted.
export async function detectOverlays(video: string, opts: { fps?: number; window?: number; merge?: boolean; until?: number | null } = {}): Promise<OverlayBox[]> {
  const info = await probeFile(video)
  if (!info.width || !info.height) return []
  const fps = opts.fps ?? 4, win = opts.window ?? 8
  const W = 270, H = Math.max(2, Math.round((W * info.height) / info.width / 2) * 2)
  const all = await grayFrames(video, W, H, fps)
  const frames = opts.until != null ? all.slice(0, Math.max(0, Math.floor(opts.until * fps))) : all
  if (frames.length < 4) return []
  const sx = info.width / W, sy = info.height / H
  const boxes: OverlayBox[] = []
  for (let s = 0; s < frames.length; s += win / 2) {
    const group = frames.slice(s, s + win)
    if (group.length < 4) break
    const found = windowBoxes(group, W, H)
    const start = s / fps, end = (s + group.length) / fps
    for (const b of found) boxes.push({ x: Math.round(b.x * sx), y: Math.round(b.y * sy), w: Math.round(b.w * sx), h: Math.round(b.h * sy), start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 })
  }
  return opts.merge === false ? boxes : mergeBoxes(boxes)
}

async function grayFrames(video: string, W: number, H: number, fps: number): Promise<Uint8Array[]> {
  const dec = spawn(FFMPEG, ['-v', 'error', '-i', video, '-vf', `fps=${fps},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  dec.stderr.on('data', d => { err += d })
  const done = new Promise<number>(res => dec.on('close', c => res(c ?? 1)))
  const size = W * H
  const out: Uint8Array[] = []
  let pending: Buffer = Buffer.alloc(0)
  for await (const chunk of dec.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    while (pending.length >= size) { out.push(new Uint8Array(pending.subarray(0, size))); pending = pending.subarray(size) }
  }
  if ((await done) !== 0) throw new MediaError(`The clip could not be read for cleanup: ${err.trim().slice(-200)}`)
  return out
}

// One window: strong edges in every frame, near-white and near-black side by
// side (text with an outline or a box), not moving, where the picture
// around it does move. Then boxes around the clusters.
function windowBoxes(group: Uint8Array[], W: number, H: number): Array<{ x: number; y: number; w: number; h: number }> {
  const n = group.length
  // Text pixels (sharp, still, light against dark) and still white fill
  // (a caption box); a cluster counts only with text in it.
  const still = new Uint8Array(W * H)
  const fill = new Uint8Array(W * H)
  let movingPixels = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      let minEdge = 255, sum = 0, sum2 = 0, bright = 0
      for (const f of group) {
        const gx = Math.abs(f[i + 1]! - f[i - 1]!), gy = Math.abs(f[i + W]! - f[i - W]!)
        minEdge = Math.min(minEdge, Math.max(gx, gy))
        sum += f[i]!; sum2 += f[i]! * f[i]!
        const hi = Math.max(f[i - 1]!, f[i + 1]!, f[i - W]!, f[i + W]!, f[i]!), lo = Math.min(f[i - 1]!, f[i + 1]!, f[i - W]!, f[i + W]!, f[i]!)
        if (hi > 185 && lo < 110) bright++
      }
      const sd = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2))
      if (sd > 12) movingPixels++
      if (minEdge > 40 && sd < 10 && bright >= n - 1) still[i] = 1
      else if (sum / n > 236 && sd < 4) fill[i] = 1
    }
  }
  // A still picture (nothing moves) gives no contrast to tell text from the scene.
  if (movingPixels < W * H * 0.04) return []
  // Grow the text pixels into words and lines, then box them.
  const grown = dilate(dilate(still, W, H, 3, 1), W, H, 1, 2)
  // White fill joins only right around text (a caption box), never far away.
  const near = dilate(grown, W, H, 4, 4)
  for (let i = 0; i < W * H; i++) if (fill[i] && near[i]) grown[i] = 1
  const seen = new Uint8Array(W * H)
  const out: Array<{ x: number; y: number; w: number; h: number }> = []
  for (let i = 0; i < W * H; i++) {
    if (!grown[i] || seen[i]) continue
    let x0 = W, y0 = H, x1 = 0, y1 = 0, count = 0, core = 0
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!
      const x = j % W, y = (j - x) / W
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      count++
      if (still[j]) core++
      for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && grown[k] && !seen[k] && Math.abs((k % W) - x) <= 1) { seen[k] = 1; stack.push(k) }
    }
    // A cluster taller than a caption block is split into its text bands
    // (rows with text, split at empty rows), each judged on its own.
    const parts = y1 - y0 + 1 > H * 0.2 ? bands(still, W, x0, x1, y0, y1) : [{ x0, x1, y0, y1, core }]
    for (const b of parts) {
      const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1
      // Text is wider than tall, not tiny, not most of the frame, and dense.
      if (b.core < 12 || w < 8 || h < 3 || h > H * 0.25 || w * h > W * H * 0.35 || w < h * 1.2) continue
      const pad = 2
      out.push({ x: Math.max(1, b.x0 - pad), y: Math.max(1, b.y0 - pad), w: Math.min(W - 2, b.x1 + pad) - Math.max(1, b.x0 - pad), h: Math.min(H - 2, b.y1 + pad) - Math.max(1, b.y0 - pad) })
    }
  }
  return out
}

// Rows of text inside a box: runs of rows with text pixels, split where at
// least 4 rows in a row have none, then the text's own left and right.
function bands(still: Uint8Array, W: number, x0: number, x1: number, y0: number, y1: number): Array<{ x0: number; x1: number; y0: number; y1: number; core: number }> {
  const out: Array<{ x0: number; x1: number; y0: number; y1: number; core: number }> = []
  let start = -1, gap = 0
  const close = (end: number) => {
    let bx0 = x1, bx1 = x0, core = 0
    for (let y = start; y <= end; y++) for (let x = x0; x <= x1; x++) if (still[y * W + x]) { core++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x) }
    if (core) out.push({ x0: bx0, x1: bx1, y0: start, y1: end, core })
  }
  for (let y = y0; y <= y1; y++) {
    let any = false
    for (let x = x0; x <= x1 && !any; x++) any = !!still[y * W + x]
    if (any) { if (start < 0) start = y; gap = 0 } else if (start >= 0 && ++gap >= 4) { close(y - gap); start = -1; gap = 0 }
  }
  if (start >= 0) close(y1 - gap)
  // Lines of one caption sit close together: join bands less than a line apart.
  const joined: typeof out = []
  for (const b of out) {
    const last = joined[joined.length - 1]
    if (last && b.y0 - last.y1 <= Math.max(3, (last.y1 - last.y0 + 1) * 0.8)) { last.y1 = b.y1; last.x0 = Math.min(last.x0, b.x0); last.x1 = Math.max(last.x1, b.x1); last.core += b.core } else joined.push({ ...b })
  }
  return joined
}

function dilate(src: Uint8Array, W: number, H: number, rx: number, ry: number): Uint8Array {
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!src[y * W + x]) continue
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const X = x + dx, Y = y + dy
      if (X >= 0 && X < W && Y >= 0 && Y < H) out[Y * W + X] = 1
    }
  }
  return out
}

// Boxes in the same place in back-to-back windows become one, longer box.
export function mergeBoxes(boxes: OverlayBox[]): OverlayBox[] {
  const out: OverlayBox[] = []
  for (const b of [...boxes].sort((a, c) => a.start - c.start)) {
    const same = out.find(o => o.end >= b.start - 0.01 && overlap(o, b) > 0.5)
    if (same) {
      const x0 = Math.min(same.x, b.x), y0 = Math.min(same.y, b.y)
      same.w = Math.max(same.x + same.w, b.x + b.w) - x0; same.h = Math.max(same.y + same.h, b.y + b.h) - y0
      same.x = x0; same.y = y0; same.end = Math.max(same.end, b.end)
    } else out.push({ ...b })
  }
  return out
}

function overlap(a: OverlayBox, b: OverlayBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / Math.min(a.w * a.h, b.w * b.h)
}

// The end card cut off and the text filled in from around it. The sound is
// kept (cut with the picture).
export async function cleanClip(video: string, out: string, a: { endAt: number | null; boxes: OverlayBox[] }): Promise<void> {
  if (a.endAt == null && !a.boxes.length) { await copyFile(video, out); return }
  const info = await probeFile(video)
  const W = info.width ?? 0, H = info.height ?? 0
  const filters = a.boxes.map(b => {
    const x = Math.max(1, Math.min(W - 3, b.x)), y = Math.max(1, Math.min(H - 3, b.y))
    const w = Math.max(2, Math.min(W - x - 2, b.w)), h = Math.max(2, Math.min(H - y - 2, b.h))
    return `delogo=x=${x}:y=${y}:w=${w}:h=${h}:enable='between(t,${b.start},${b.end})'`
  })
  await ffmpeg(['-y', '-i', video, ...(a.endAt != null ? ['-t', String(a.endAt)] : []), ...(filters.length ? ['-vf', filters.join(',')] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']), '-movflags', '+faststart', out], 600_000)
}
