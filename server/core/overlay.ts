import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import opentype from 'opentype.js'
import sharp from 'sharp'
import type { ContentConfig } from '../config/pipeline.js'

// TikTok-style text overlays (owner, 2026-10-13): a white rounded box per
// line, black text, centered, inside TikTok's safe zones. Text is drawn as
// outlines from bundled fonts (TikTok Sans, Noto Emoji for emoji), so the
// worker needs no system fonts. The result is a transparent PNG the size of
// the frame, laid over a video (ffmpeg) or a still (sharp).

type Font = opentype.Font
const require = createRequire(import.meta.url)
const fontCache = new Map<string, Font[]>()

function parse(path: string): Font {
  const buf = readFileSync(path)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

// The caption fonts in fallback order: the text face (Latin, then Latin
// Extended), then the emoji subsets.
export function captionFonts(cfg: ContentConfig['caption']): Font[] {
  const key = `${cfg.font.file}:${cfg.font.weight}`
  const hit = fontCache.get(key)
  if (hit) return hit
  const textDir = dirname(require.resolve(`@fontsource/${cfg.font.file}/package.json`))
  const fonts = ['latin', 'latin-ext'].map(sub => parse(join(textDir, 'files', `${cfg.font.file}-${sub}-${cfg.font.weight}-normal.woff`)))
  try {
    const emojiDir = join(dirname(require.resolve('@fontsource/noto-emoji/package.json')), 'files')
    for (const f of readdirSync(emojiDir).filter(n => /-500-normal\.woff$/.test(n)).sort()) fonts.push(parse(join(emojiDir, f)))
  } catch { /* no emoji font: emoji are left out of the overlay */ }
  fontCache.set(key, fonts)
  return fonts
}

interface Run { font: Font; text: string }

// Splits text into runs by the first font that has each character. Variation
// selectors and joiners ride along with the emoji before them.
function runs(fonts: Font[], text: string, dropped: Set<string>): Run[] {
  const out: Run[] = []
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0)!
    if (cp === 0xfe0f || cp === 0x200d) continue
    const font = fonts.find(f => f.charToGlyphIndex(ch) > 0)
    if (!font) { if (ch.trim()) dropped.add(ch); continue }
    const last = out.at(-1)
    if (last && last.font === font) last.text += ch
    else out.push({ font, text: ch })
  }
  return out
}

const width = (rs: Run[], size: number) => rs.reduce((w, r) => w + r.font.getAdvanceWidth(r.text, size), 0)

// Word wrap within maxWidth, balanced: the narrowest width that needs no
// more lines than the plain wrap, so lines come out even and no word or
// emoji is left alone on the last line. The owner's own line breaks stay.
export function wrapLines(fonts: Font[], text: string, size: number, maxWidth: number): string[] {
  const greedy = wrapGreedy(fonts, text, size, maxWidth)
  if (greedy.length < 2) return greedy
  let lo = maxWidth * 0.4, hi = maxWidth
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (wrapGreedy(fonts, text, size, mid).length <= greedy.length) hi = mid
    else lo = mid
  }
  return wrapGreedy(fonts, text, size, hi)
}

function wrapGreedy(fonts: Font[], text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  const none = new Set<string>()
  for (const para of text.split(/\r?\n/)) {
    const words = para.trim().split(/\s+/).filter(Boolean)
    if (!words.length) continue
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (line && width(runs(fonts, next, none), size) > maxWidth) { lines.push(line); line = word }
      else line = next
    }
    if (line) lines.push(line)
  }
  return lines
}

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

export interface CaptionLayout { lines: string[]; size: number; box: { x: number; y: number; w: number; h: number }; dropped: string[] }

// The caption as SVG over the whole frame: a rounded box per line (TikTok's
// "background" text style), then the text outlines.
export function captionSvg(text: string, content: Pick<ContentConfig, 'canvas' | 'caption'>): { svg: string; layout: CaptionLayout } {
  const { canvas: c, caption: cap } = content
  const fonts = captionFonts(cap)
  const clean = text.trim().slice(0, cap.max_chars)
  const area = { left: cap.safe.left, right: c.width - cap.safe.right, top: cap.safe.top, bottom: c.height - cap.safe.bottom }
  // Centered on the frame like TikTok's own text, and narrow enough that
  // both sides stay inside the safe margins.
  const centerX = c.width / 2
  const half = Math.min(centerX - area.left, area.right - centerX)
  const maxText = Math.min(cap.max_width, 2 * half - 2 * cap.box.pad_x)
  // Shrink a long caption until it fits the line limit (down to 60%).
  let size = cap.size
  let lines = wrapLines(fonts, clean, size, maxText)
  while (lines.length > cap.max_lines && size > cap.size * 0.6) {
    size = Math.round(size * 0.92)
    lines = wrapLines(fonts, clean, size, maxText)
  }
  lines = lines.slice(0, cap.max_lines)
  const dropped = new Set<string>()
  const lineRuns = lines.map(l => runs(fonts, l, dropped))
  const lineH = Math.round(size * cap.line_height)
  const blockH = lines.length * lineH + 2 * cap.box.pad_y
  const top = cap.position === 'top' ? area.top
    : cap.position === 'bottom' ? area.bottom - blockH
    : Math.round((area.top + area.bottom - blockH) / 2)
  const main = fonts[0]!
  const scale = size / main.unitsPerEm
  const textH = (main.ascender - main.descender) * scale
  const parts: string[] = []
  const glyphs: string[] = []
  let maxW = 0
  lineRuns.forEach((rs, i) => {
    const w = width(rs, size)
    maxW = Math.max(maxW, w)
    const boxW = w + 2 * cap.box.pad_x
    const y = top + i * lineH
    // Boxes overlap their neighbors by the padding, so the lines read as one shape.
    parts.push(`<rect x="${(centerX - boxW / 2).toFixed(1)}" y="${y}" width="${boxW.toFixed(1)}" height="${lineH + 2 * cap.box.pad_y}" rx="${cap.box.radius}" ry="${cap.box.radius}" fill="${esc(cap.box.fill)}"/>`)
    let x = centerX - w / 2
    const baseline = y + cap.box.pad_y + (lineH - textH) / 2 + main.ascender * scale
    for (const r of rs) {
      glyphs.push(r.font.getPath(r.text, x, baseline, size).toPathData(2))
      x += r.font.getAdvanceWidth(r.text, size)
    }
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}">${parts.join('')}<path d="${glyphs.join(' ')}" fill="${esc(cap.box.text)}"/></svg>`
  const boxW = maxW + 2 * cap.box.pad_x
  return { svg, layout: { lines, size, box: { x: Math.round(centerX - boxW / 2), y: top, w: Math.round(boxW), h: blockH }, dropped: [...dropped] } }
}

// The caption overlay as a transparent PNG the size of the frame.
export async function captionPng(text: string, content: Pick<ContentConfig, 'canvas' | 'caption'>): Promise<{ png: Buffer; layout: CaptionLayout }> {
  const { svg, layout } = captionSvg(text, content)
  return { png: await sharp(Buffer.from(svg)).png().toBuffer(), layout }
}

// A slideshow image: the still filling the 9:16 frame (center crop), with
// the caption on top. JPEG, ready to post.
export async function slideImage(still: Buffer, text: string, content: Pick<ContentConfig, 'canvas' | 'caption' | 'slideshow'>): Promise<Buffer> {
  const { canvas: c } = content
  const base = sharp(still).rotate().resize(c.width, c.height, { fit: 'cover', position: 'centre' })
  const layers = text.trim() ? [{ input: (await captionPng(text, content)).png, top: 0, left: 0 }] : []
  return base.composite(layers).jpeg({ quality: content.slideshow.image.quality, mozjpeg: true }).toBuffer()
}
