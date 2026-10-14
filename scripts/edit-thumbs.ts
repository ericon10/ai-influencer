// The Edit style thumbnails (Phase 5): each edit rendered by the real edit
// code (server/media/edits.ts) on two drawn demo shots, saved as small
// animated WebP files in public/studio-edits/<id>.webp. Free, local, no
// provider. Run again after an edit changes: npx tsx scripts/edit-thumbs.ts

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { loadConfig } from '../server/config/load.js'
import { captionPng } from '../server/core/overlay.js'
import { applyEdit, mapTime, overlayBehind, type EditStyle } from '../server/media/edits.js'
import { personMaskVideo } from '../server/media/segment.js'
import { ffmpeg } from '../server/media/ffmpeg.js'
import { renderTimeline, type TimelineCaption } from '../server/media/timeline.js'

const W = 360, H = 640, FPS = 24, SEC = 2
const canvas = { width: W, height: H, fps: FPS }
const OUT = resolve(process.cwd(), 'public', 'studio-edits')
const cfg = loadConfig()
const k = W / cfg.pipeline.content.canvas.width
// Captions drawn larger than on a real post, so they read at thumbnail size.
const big = k * 2.2
const c0 = cfg.pipeline.content.caption
const caption = { ...c0, size: c0.size * big, max_width: W - 40, box: { ...c0.box, radius: c0.box.radius * big, pad_x: c0.box.pad_x * big, pad_y: c0.box.pad_y * big }, safe: { top: c0.safe.top * k, bottom: c0.safe.bottom * k, left: c0.safe.left * k, right: c0.safe.right * k } }

// A drawn person in a room: a head, hair and shoulders that sway a little,
// like a handheld phone shot. Shot B is a closer shot in another light.
type Look = { wall: [string, string]; top: string; scale: number; headY: number; cover?: (t: number) => number }
function frameSvg(look: Look, t: number): string {
  const sway = Math.sin(t * 2.4) * 6 * look.scale, bob = Math.sin(t * 3.1) * 3
  const s = look.scale, cx = W / 2 + sway, hy = look.headY + bob
  const cover = look.cover?.(t) ?? 0
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${look.wall[0]}"/><stop offset="1" stop-color="${look.wall[1]}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect x="${36 - sway * 0.4}" y="70" width="110" height="160" rx="6" fill="#fff6dd" opacity="0.5"/>
  <rect x="${250 - sway * 0.4}" y="300" width="80" height="120" rx="4" fill="#00000022"/>
  <ellipse cx="${cx}" cy="${hy + 250 * s}" rx="${150 * s}" ry="${130 * s}" fill="${look.top}"/>
  <rect x="${cx - 26 * s}" y="${hy + 60 * s}" width="${52 * s}" height="${80 * s}" fill="#d9a07f"/>
  <ellipse cx="${cx}" cy="${hy - 6 * s}" rx="${78 * s}" ry="${96 * s}" fill="#5a3420"/>
  <ellipse cx="${cx}" cy="${hy}" rx="${62 * s}" ry="${80 * s}" fill="#e7b291"/>
  <circle cx="${cx - 22 * s}" cy="${hy - 6 * s}" r="${5 * s}" fill="#2b1a12"/>
  <circle cx="${cx + 22 * s}" cy="${hy - 6 * s}" r="${5 * s}" fill="#2b1a12"/>
  <circle cx="${cx + 30 * s}" cy="${hy + 22 * s}" r="${1.8 * s}" fill="#7a4a35"/>
  <path d="M ${cx - 18 * s} ${hy + 36 * s} Q ${cx} ${hy + 48 * s} ${cx + 18 * s} ${hy + 36 * s}" stroke="#a5534a" stroke-width="${3 * s}" fill="none"/>
  <path d="M ${cx - 70 * s} ${hy - 30 * s} Q ${cx - 40 * s} ${hy - 110 * s} ${cx + 10 * s} ${hy - 80 * s} Q ${cx + 60 * s} ${hy - 110 * s} ${cx + 72 * s} ${hy - 20 * s} Q ${cx + 40 * s} ${hy - 70 * s} ${cx - 70 * s} ${hy - 30 * s}" fill="#5a3420"/>
  ${cover > 0 ? `<ellipse cx="${W / 2 + (1 - cover) * W * 0.9}" cy="${H / 2}" rx="${W * 0.95}" ry="${H * 0.7}" fill="#c98f6f"/><ellipse cx="${W / 2 + (1 - cover) * W * 0.9}" cy="${H / 2}" rx="${W * 0.95}" ry="${H * 0.7}" fill="#000" opacity="${0.85 * cover}"/>` : ''}
</svg>`
}

async function drawShot(dir: string, name: string, look: Look): Promise<string> {
  const frames = join(dir, name)
  await mkdir(frames, { recursive: true })
  const n = SEC * FPS
  for (let i = 0; i < n; i++) await sharp(Buffer.from(frameSvg(look, i / FPS))).png().toFile(join(frames, `${String(i).padStart(3, '0')}.png`))
  const out = join(dir, `${name}.mp4`)
  await ffmpeg(['-framerate', String(FPS), '-i', join(frames, '%03d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out])
  return out
}

async function captionFile(dir: string, text: string, name: string, over: Partial<typeof caption> = {}, look: Parameters<typeof captionPng>[2] = {}): Promise<string> {
  const file = join(dir, name)
  await writeFile(file, (await captionPng(text, { canvas, caption: { ...caption, ...over } as typeof caption }, look)).png)
  return file
}

// A drawn "post" for the green screen's background: a card with an avatar,
// lines of text and a picture block.
async function postImage(out: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#eef1f5"/>
  <rect x="20" y="40" width="${W - 40}" height="${H * 0.55}" rx="18" fill="#ffffff"/>
  <circle cx="56" cy="80" r="18" fill="#7aa2e3"/><rect x="84" y="68" width="120" height="10" rx="5" fill="#c7cdd6"/><rect x="84" y="86" width="80" height="8" rx="4" fill="#dde1e7"/>
  <rect x="38" y="118" width="${W - 76}" height="12" rx="6" fill="#d0d5dc"/><rect x="38" y="140" width="${W - 120}" height="12" rx="6" fill="#d0d5dc"/>
  <rect x="38" y="168" width="${W - 76}" height="${H * 0.55 - 150}" rx="12" fill="#f3b562"/></svg>`
  await sharp(Buffer.from(svg)).png().toFile(out)
}

async function toWebp(video: string, out: string) {
  // Small, 12 fps, looping; quality kept low so each stays light.
  await ffmpeg(['-i', video, '-vf', 'fps=12,scale=144:256:flags=lanczos', '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '55', '-compression_level', '6', '-loop', '0', '-an', out])
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'edit-thumbs-'))
  await mkdir(OUT, { recursive: true })
  const A: Look = { wall: ['#d8b48f', '#8a6a52'], top: '#3f5b7a', scale: 1, headY: 300 }
  const B: Look = { wall: ['#7f9bb3', '#3d4f63'], top: '#a2443c', scale: 2.1, headY: 360 }
  const a = await drawShot(dir, 'a', A)
  const b = await drawShot(dir, 'b', B)
  const one = await drawShot(dir, 'one', { ...A, wall: ['#e2c19a', '#9c7b5e'] })
  // Hand over the lens: A ends covered, B starts covered and pulls away.
  const ha = await drawShot(dir, 'ha', { ...A, cover: t => Math.max(0, Math.min(1, (t - 1.45) / 0.3)) })
  const hb = await drawShot(dir, 'hb', { ...B, scale: 1, headY: 300, top: '#e0c04a', cover: t => Math.max(0, Math.min(1, 1 - (t - 0.25) / 0.35)) })
  const join2 = async (x: string, y: string, name: string) => {
    const out = join(dir, `${name}.mp4`)
    await renderTimeline({ shots: [{ path: x, in: 0, out: null }, { path: y, in: 0, out: null }], captions: [], canvas, out, keepSound: false })
    return out
  }
  const two = await join2(a, b, 'two')
  const hand = await join2(ha, hb, 'hand')
  const face = { x: 0.5, y: 300 / H }
  const styles = cfg.pipeline.edits.styles.filter(s => !process.env.ONLY || process.env.ONLY.split(',').includes(s.id))
  const masks = new Map<string, string>()
  const maskOf = async (src: string) => {
    if (!masks.has(src)) { const m = `${src}.mask.mp4`; await personMaskVideo(src, m, { modelsDir: process.env.STUDIO_MODELS_DIR || '.data/models', fps: FPS }); masks.set(src, m) }
    return masks.get(src)!
  }
  const post = join(dir, 'post.png')
  await postImage(post)
  for (const s of styles) {
    const params = s.params.normal
    const atCut = s.shots === 2 || s.id === 'flash_shake' || s.id === 'glitch'
    const src = s.id === 'hand_lens' ? hand : atCut ? two : one
    const edited = join(dir, `${s.id}.mp4`)
    const payoff = s.id === 'dolly_zoom' ? 0.3 : s.id === 'snap_zoom' ? 0.6 : 0.9
    const mask = s.needs.includes('mask') ? await maskOf(src) : undefined
    const r = await applyEdit({ style: s.id as EditStyle, video: src, out: edited, workDir: dir, canvas, params: { ...params, ...(s.id === 'punch_in' ? { every: 0.5 } : {}) }, cuts: atCut ? [SEC] : [], payoff, face, mask, background: s.id === 'green_screen' ? post : undefined })
    let final = edited
    // The caption edits show their captions.
    if (s.id === 'karaoke' || s.id === 'record_scratch') {
      const caps: TimelineCaption[] = []
      if (s.id === 'karaoke') {
        const words = 'wait for the end'.split(' ')
        for (let i = 0; i < words.length; i++) caps.push({ png: await captionFile(dir, words.join(' '), `kk${i}.png`, {}, { highlight: i, pill: true }), start: 0.1 + i * 0.45, end: i < words.length - 1 ? 0.1 + (i + 1) * 0.45 : null })
      } else {
        const held = mapTime(r.timeMap, payoff + 0.0001) - payoff
        caps.push({ png: await captionFile(dir, "Yep, that's me.", 'rs.png', { position: 'upper_third' }), start: payoff, end: payoff + held })
      }
      final = join(dir, `${s.id}-cap.mp4`)
      await renderTimeline({ shots: [{ path: edited, in: 0, out: null }], captions: caps, canvas, out: final, keepSound: false })
    }
    if (s.id === 'text_behind') {
      final = join(dir, `${s.id}-cap.mp4`)
      await overlayBehind({ video: edited, mask: mask!, out: final, canvas, captions: [{ png: await captionFile(dir, 'WAIT', 'tb.png', { style: 'plain', size: caption.size * 3, position: 'middle' }), start: 0, end: null }] })
    }
    if (s.id === 'word_pop' || s.id === 'freeze_pop') {
      const caps: TimelineCaption[] = []
      if (s.id === 'word_pop') {
        const words = 'wait for the end'.split(' ')
        const per = params.per_word ?? 0.3
        for (let i = 1; i <= words.length; i++) caps.push({ png: await captionFile(dir, words.slice(0, i).join(' '), `wp${i}.png`), start: (i - 1) * per + 0.1, end: i < words.length ? i * per + 0.1 : null })
      } else {
        const held = mapTime(r.timeMap, payoff + 0.0001) - payoff
        caps.push({ png: await captionFile(dir, 'NO WAY', 'pop.png', { size: caption.size * 1.25, position: 'upper_third' }), start: payoff, end: payoff + held })
      }
      final = join(dir, `${s.id}-cap.mp4`)
      await renderTimeline({ shots: [{ path: edited, in: 0, out: null }], captions: caps, canvas, out: final, keepSound: false })
    }
    await toWebp(final, join(OUT, `${s.id}.webp`))
    console.log(`${s.id}: ${r.durationSec.toFixed(2)} s${r.note ? `, ${r.note}` : ''}`)
  }
  if (process.env.KEEP) console.log(`Kept ${dir}`)
  else await rm(dir, { recursive: true, force: true })
}

main().catch(e => { console.error(e); process.exit(1) })
