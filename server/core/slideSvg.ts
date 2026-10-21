import { threadLine, wordCount, type SlidePos, type SpecialSlide, type TextStyleId } from './slides.js'

// How a slideshow slide is drawn (UX-PLAN.md section 27): the text styles,
// the Ad label and the special slides (mock UI drawn by code). One layout
// for both places: the browser preview (text as SVG text in the bundled
// TikTok Sans) and the worker's export (the same text as outlines), so what
// is dragged in the preview is what is burned into the JPEG. Pure: the
// caller supplies how text is measured and drawn.

export interface Frame { width: number; height: number }

export interface TextOpts {
  size: number
  weight: number
  fill: string
  anchor?: 'start' | 'middle' | 'end'
  stroke?: { color: string; width: number }
  opacity?: number
}

export interface Draw {
  // The advance width of the text at this size and weight, in pixels.
  measure(text: string, size: number, weight: number): number
  // One line of text with its baseline at y, as SVG.
  text(text: string, x: number, y: number, o: TextOpts): string
}

// Nothing in the top 10% or the bottom 20% (the apps' own interface).
export const SAFE = { top: 0.1, bottom: 0.2, side: 0.04 } as const
export const DEFAULT_POS: SlidePos = { x: 0.5, y: 0.28 }
// Over a special slide the words sit above the mock screen.
export const SPECIAL_POS: SlidePos = { x: 0.5, y: 0.24 }

// The baseline sits this far (in font sizes) below the top of a line's
// em box so the ink (caps and ascenders down to descenders) is centered on
// the line: measured on TikTok Sans, where 0.93 drew every style low.
const ASCENT = 0.78
const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
const num = (n: number) => (Math.round(n * 10) / 10).toString()

// ── Text styles ───────────────────────────────────────────────────────

interface StyleDef {
  weight: number
  lineH: number
  align: 'center' | 'left'
  // Font size in pixels for this many words on a frame this wide.
  size(words: number, w: number): number
  maxWidth(w: number): number
  // Classic breaks by words (4 to 6 a line); the rest wrap by width.
  byWords: boolean
}

// Classic (owner, 2026-10-16): bold white, a black outline at 15% of the
// font size, the size scaled to the word count (7.5% of the width at 4
// words or fewer down to 5% at 12 or more), 4 to 6 words a line.
export function classicSizeFrac(words: number): number {
  if (words <= 4) return 0.075
  if (words >= 12) return 0.05
  return 0.075 - ((words - 4) * 0.025) / 8
}

export const STYLE_DEFS: Record<TextStyleId, StyleDef> = {
  classic: { weight: 800, lineH: 1.16, align: 'center', size: (n, w) => Math.round(classicSizeFrac(n) * w), maxWidth: w => w * 0.88, byWords: true },
  box: { weight: 600, lineH: 1.3, align: 'center', size: (_n, w) => Math.round(0.052 * w), maxWidth: w => w * 0.76, byWords: false },
  minimal: { weight: 500, lineH: 1.25, align: 'center', size: (n, w) => Math.round((n > 10 ? 0.038 : 0.042) * w), maxWidth: w => w * 0.8, byWords: false },
  note: { weight: 600, lineH: 1.3, align: 'left', size: (n, w) => Math.round((n > 10 ? 0.04 : 0.044) * w), maxWidth: w => w * 0.84 - 2 * w * 0.05, byWords: false },
}

// n words in `lines` lines, as even as possible (longer lines first).
function balanced(ws: string[], lines: number): string[] {
  const out: string[] = []
  const base = Math.floor(ws.length / lines), extra = ws.length % lines
  let at = 0
  for (let i = 0; i < lines; i++) {
    const k = base + (i < extra ? 1 : 0)
    out.push(ws.slice(at, at + k).join(' '))
    at += k
  }
  return out.filter(Boolean)
}

function wrapWidth(ws: string[], size: number, weight: number, maxW: number, draw: Draw): string[] {
  const lines: string[] = []
  let line = ''
  for (const w of ws) {
    const next = line ? `${line} ${w}` : w
    if (line && draw.measure(next, size, weight) > maxW) { lines.push(line); line = w } else line = next
  }
  if (line) lines.push(line)
  // Balance: the narrowest width that needs no more lines.
  if (lines.length < 2) return lines
  let lo = maxW * 0.45, hi = maxW
  const count = (mw: number) => wrapPlain(ws, size, weight, mw, draw).length
  for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (count(mid) <= lines.length) hi = mid; else lo = mid }
  return wrapPlain(ws, size, weight, hi, draw)
}
function wrapPlain(ws: string[], size: number, weight: number, maxW: number, draw: Draw): string[] {
  const lines: string[] = []
  let line = ''
  for (const w of ws) {
    const next = line ? `${line} ${w}` : w
    if (line && draw.measure(next, size, weight) > maxW) { lines.push(line); line = w } else line = next
  }
  if (line) lines.push(line)
  return lines
}

export interface TextLayout {
  style: TextStyleId
  lines: string[]
  size: number
  weight: number
  lineH: number
  // The text block (the card for Note), and the clamped center it sits at.
  block: { x: number; y: number; w: number; h: number }
  pos: SlidePos
  // The widest line, in pixels.
  textW: number
}

// Classic: up to 6 words a line, then 5, then 4, at the size the word
// count asks for; a line still too wide shrinks the text (never under 5%
// of the width), and only then do lines get shorter than 4 words.
function classicLines(ws: string[], w: number, draw: Draw, def: StyleDef): { lines: string[]; size: number } {
  const size = def.size(ws.length, w)
  const maxW = def.maxWidth(w)
  const min = Math.round(0.05 * w)
  const widest = (lines: string[], s: number) => Math.max(...lines.map(l => draw.measure(l, s, def.weight)))
  for (const per of [6, 5, 4]) {
    const lines = balanced(ws, Math.ceil(ws.length / per))
    if (widest(lines, size) <= maxW) return { lines, size }
  }
  for (const per of [4, 3, 2, 1]) {
    const lines = balanced(ws, Math.ceil(ws.length / per))
    const wide = widest(lines, size)
    const fit = Math.floor(size * Math.min(1, maxW / wide))
    if (fit >= min) return { lines, size: fit }
  }
  return { lines: balanced(ws, ws.length), size: min }
}

export function textLayout(style: TextStyleId, text: string, frame: Frame, pos: SlidePos | null | undefined, draw: Draw, fallback: SlidePos = DEFAULT_POS): TextLayout | null {
  const ws = text.trim().split(/\s+/).filter(Boolean)
  if (!ws.length) return null
  const def = STYLE_DEFS[style]
  const w = frame.width, h = frame.height
  let lines: string[], size: number
  if (def.byWords) ({ lines, size } = classicLines(ws, w, draw, def))
  else {
    size = def.size(ws.length, w)
    lines = wrapWidth(ws, size, def.weight, def.maxWidth(w), draw)
    // A long text shrinks until it fits 6 lines (down to 70%).
    while (lines.length > 6 && size > def.size(ws.length, w) * 0.7) { size = Math.round(size * 0.92); lines = wrapWidth(ws, size, def.weight, def.maxWidth(w), draw) }
  }
  const lineH = Math.round(size * def.lineH)
  const textW = Math.max(...lines.map(l => draw.measure(l, size, def.weight)))
  let bw: number, bh: number
  if (style === 'box') { const px = 26 * w / 1080, py = 12 * w / 1080; bw = textW + 2 * px; bh = lines.length * lineH + 2 * py }
  else if (style === 'note') { const pad = 0.05 * w; bw = 0.84 * w; bh = noteHeader(w) + lines.length * lineH + 2 * pad + NOTE_SHADOW.y * w }
  else { const p = 2 * inkPad(style, size); bw = textW + p; bh = lines.length * lineH + p }
  const want = pos ?? fallback
  const minY = SAFE.top * h + bh / 2, maxY = (1 - SAFE.bottom) * h - bh / 2
  const minX = SAFE.side * w + bw / 2, maxX = (1 - SAFE.side) * w - bw / 2
  const cy = minY > maxY ? (SAFE.top * h + (1 - SAFE.bottom) * h) / 2 : Math.min(maxY, Math.max(minY, want.y * h))
  const cx = minX > maxX ? w / 2 : Math.min(maxX, Math.max(minX, want.x * w))
  return {
    style, lines, size, weight: def.weight, lineH, textW,
    block: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh },
    pos: { x: Math.round((cx / w) * 1000) / 1000, y: Math.round((cy / h) * 1000) / 1000 },
  }
}

const noteHeader = (w: number) => Math.round(0.07 * w)
// What a style draws past its glyphs (Classic's outline, Minimal's
// shadow), kept inside the block so nothing is drawn outside the box.
const strokeW = (size: number) => size * 0.15
const shadowOff = (size: number) => Math.max(1.5, size * 0.05)
const inkPad = (style: TextStyleId, size: number) => (style === 'classic' ? strokeW(size) / 2 : style === 'minimal' ? shadowOff(size) : 0)
// The Note card's drop shadow, inside the block too (the card is that
// much smaller).
const NOTE_SHADOW = { x: 0.006, y: 0.01 } as const

// The text block as SVG over the whole frame.
export function textSvg(l: TextLayout, frame: Frame, draw: Draw): string {
  const w = frame.width
  const parts: string[] = []
  const cx = l.block.x + l.block.w / 2
  if (l.style === 'classic') {
    const top = l.block.y + inkPad('classic', l.size)
    l.lines.forEach((line, i) => {
      const y = top + i * l.lineH + (l.lineH - l.size) / 2 + l.size * ASCENT
      parts.push(draw.text(line, cx, y, { size: l.size, weight: l.weight, fill: '#ffffff', anchor: 'middle', stroke: { color: '#000000', width: strokeW(l.size) } }))
    })
  } else if (l.style === 'box') {
    const px = 26 * w / 1080, py = 12 * w / 1080, r = 18 * w / 1080
    l.lines.forEach((line, i) => {
      const lw = draw.measure(line, l.size, l.weight) + 2 * px
      const y = l.block.y + i * l.lineH
      parts.push(`<rect x="${num(cx - lw / 2)}" y="${num(y)}" width="${num(lw)}" height="${num(l.lineH + 2 * py)}" rx="${num(r)}" fill="#ffffff"/>`)
    })
    l.lines.forEach((line, i) => {
      const y = l.block.y + py + i * l.lineH + (l.lineH - l.size) / 2 + l.size * ASCENT
      parts.push(draw.text(line, cx, y, { size: l.size, weight: l.weight, fill: '#000000', anchor: 'middle' }))
    })
  } else if (l.style === 'minimal') {
    // The words sit a shadow's width in from the top left, the shadow
    // that much down and right, both inside the block.
    const off = shadowOff(l.size)
    l.lines.forEach((line, i) => {
      const y = l.block.y + off + i * l.lineH + (l.lineH - l.size) / 2 + l.size * ASCENT
      parts.push(draw.text(line, cx + off * 0.6, y + off, { size: l.size, weight: l.weight, fill: '#000000', anchor: 'middle', opacity: 0.38 }))
      parts.push(draw.text(line, cx - off * 0.3, y, { size: l.size, weight: l.weight, fill: '#ffffff', anchor: 'middle' }))
    })
  } else {
    const pad = 0.05 * w, r = 0.035 * w, head = noteHeader(w)
    const { x, y } = l.block, sx = NOTE_SHADOW.x * w, sy = NOTE_SHADOW.y * w
    const bw = l.block.w - sx, bh = l.block.h - sy
    parts.push(`<rect x="${num(x + sx)}" y="${num(y + sy)}" width="${num(bw)}" height="${num(bh)}" rx="${num(r)}" fill="#000000" fill-opacity="0.18"/>`)
    parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(bw)}" height="${num(bh)}" rx="${num(r)}" fill="#fffdf6"/>`)
    parts.push(`<rect x="${num(x)}" y="${num(y + head)}" width="${num(bw)}" height="1.5" fill="#e8e1cc"/>`)
    const hs = Math.round(0.03 * w)
    parts.push(draw.text('Notes', x + pad, y + head / 2 + hs * 0.36, { size: hs, weight: 600, fill: '#c99a06' }))
    l.lines.forEach((line, i) => {
      const ly = y + head + pad * 0.8 + i * l.lineH + (l.lineH - l.size) / 2 + l.size * ASCENT
      parts.push(draw.text(line, x + pad, ly, { size: l.size, weight: l.weight, fill: '#1d1d1f' }))
    })
  }
  return parts.join('')
}

// "Ad" on slide 1 (the #ad switch): a small pill above the words, or
// below them when there is no room above.
export function adSvg(l: TextLayout | null, frame: Frame, draw: Draw): string {
  const w = frame.width, h = frame.height
  const size = Math.round(0.03 * w)
  const pw = draw.measure('Ad', size, 700) + size * 1.1, ph = size * 1.55, gap = size * 0.6
  const cx = l ? l.block.x + l.block.w / 2 : w / 2
  let y = l ? l.block.y - ph - gap : SAFE.top * h
  if (y < SAFE.top * h && l) y = l.block.y + l.block.h + gap
  return `<rect x="${num(cx - pw / 2)}" y="${num(y)}" width="${num(pw)}" height="${num(ph)}" rx="${num(ph / 2)}" fill="#ffffff" fill-opacity="0.92"/>`
    + draw.text('Ad', cx, y + ph / 2 + size * 0.35, { size, weight: 700, fill: '#000000', anchor: 'middle' })
}

// ── Special slides (mock UI, drawn by code, generic) ───────────────────

const HUES = ['#34c759', '#0a84ff', '#ff9f0a', '#bf5af2', '#ff375f', '#64d2ff']
const hueFor = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]!
const initial = (s: string) => (s.trim().match(/[A-Za-z0-9]/)?.[0] ?? '•').toUpperCase()

function wrapText(text: string, size: number, weight: number, maxW: number, draw: Draw, maxLines: number): string[] {
  const lines = wrapPlain(text.trim().split(/\s+/).filter(Boolean), size, weight, maxW, draw)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[.,;:]?$/, '')}...`
  return kept
}

// Whether a special slide draws its own full-frame background (a chat or
// an inbox) or sits over the slide's blurred photo.
export const specialOwnBackground = (t: SpecialSlide['type']) => t === 'text_thread' || t === 'rejection_email'

export function specialSvg(sp: SpecialSlide, frame: Frame, draw: Draw): string {
  const w = frame.width, h = frame.height
  const u = w / 1080
  const out: string[] = []
  const rect = (x: number, y: number, rw: number, rh: number, r: number, fill: string, extra = '') => `<rect x="${num(x)}" y="${num(y)}" width="${num(rw)}" height="${num(rh)}" rx="${num(r)}" fill="${fill}"${extra}/>`
  const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fill}"/>`
  if (sp.type === 'notification') {
    out.push(rect(0, 0, w, h, 0, '#000000', ' fill-opacity="0.28"'))
    const cw = 0.9 * w, cx = (w - cw) / 2, pad = 34 * u
    const bodySize = 40 * u, titleSize = 42 * u
    const body = wrapText(sp.body || ' ', bodySize, 400, cw - 2 * pad, draw, 4)
    const icon0 = 52 * u
    const ch = pad + icon0 + 22 * u + titleSize * 1.33 + body.length * bodySize * 1.3 + pad * 1.15
    const cy = Math.max(0.38 * h, Math.min(0.62 * h, 0.5 * h - ch / 2))
    out.push(rect(cx, cy, cw, ch, 44 * u, '#f2f2f7', ' fill-opacity="0.94"'))
    const icon = icon0
    out.push(rect(cx + pad, cy + pad, icon, icon, 13 * u, hueFor(sp.from || 'Messages')))
    out.push(draw.text(initial(sp.from || 'M'), cx + pad + icon / 2, cy + pad + icon * 0.7, { size: icon * 0.56, weight: 700, fill: '#ffffff', anchor: 'middle' }))
    out.push(draw.text((sp.from || 'Messages').toUpperCase(), cx + pad + icon + 20 * u, cy + pad + icon * 0.66, { size: 30 * u, weight: 500, fill: '#6e6e73' }))
    out.push(draw.text(sp.time || 'now', cx + cw - pad, cy + pad + icon * 0.66, { size: 30 * u, weight: 400, fill: '#6e6e73', anchor: 'end' }))
    let y = cy + pad + icon + 22 * u + titleSize * 0.93
    out.push(draw.text(sp.title || ' ', cx + pad, y, { size: titleSize, weight: 700, fill: '#1c1c1e' }))
    y += titleSize * 0.4
    body.forEach(line => { y += bodySize * 1.3; out.push(draw.text(line, cx + pad, y, { size: bodySize, weight: 400, fill: '#1c1c1e' })) })
  } else if (sp.type === 'text_thread') {
    out.push(rect(0, 0, w, h, 0, '#ffffff'))
    const headY = SAFE.top * h
    out.push(rect(0, 0, w, headY + 150 * u, 0, '#f6f6f6'))
    out.push(rect(0, headY + 150 * u, w, 2, 0, '#e2e2e2'))
    out.push(circle(w / 2, headY + 52 * u, 44 * u, '#a7a7ad'))
    out.push(draw.text(initial(sp.title || 'A'), w / 2, headY + 52 * u + 17 * u, { size: 46 * u, weight: 600, fill: '#ffffff', anchor: 'middle' }))
    out.push(draw.text(sp.title || 'Contact', w / 2, headY + 128 * u, { size: 30 * u, weight: 500, fill: '#1c1c1e', anchor: 'middle' }))
    const size = 40 * u, maxW = 0.66 * w, pad = 28 * u
    let y = 0.4 * h
    const bottom = (1 - SAFE.bottom) * h
    for (const raw of sp.lines.slice(0, 10)) {
      const m = threadLine(raw)
      if (!m.text) continue
      const lines = wrapText(m.text, size, 400, maxW - 2 * pad, draw, 5)
      const bw = Math.max(...lines.map(l => draw.measure(l, size, 400))) + 2 * pad
      const bh = lines.length * size * 1.25 + 2 * pad * 0.62
      if (y + bh > bottom) break
      const x = m.me ? w - 0.05 * w - bw : 0.05 * w
      out.push(rect(x, y, bw, bh, 38 * u, m.me ? '#1f8bff' : '#e9e9eb'))
      lines.forEach((l, i) => out.push(draw.text(l, x + pad, y + pad * 0.62 + (i + 1) * size * 1.25 - size * 0.28, { size, weight: 400, fill: m.me ? '#ffffff' : '#1c1c1e' })))
      y += bh + 16 * u
    }
  } else if (sp.type === 'rejection_email') {
    out.push(rect(0, 0, w, h, 0, '#ffffff'))
    const headY = SAFE.top * h
    out.push(draw.text('Inbox', 0.06 * w, headY + 50 * u, { size: 34 * u, weight: 500, fill: '#0a84ff' }))
    let y = 0.36 * h
    const subject = wrapText(sp.title || 'An update', 50 * u, 700, 0.88 * w, draw, 3)
    subject.forEach(l => { out.push(draw.text(l, 0.06 * w, y, { size: 50 * u, weight: 700, fill: '#1c1c1e' })); y += 62 * u })
    y += 26 * u
    out.push(circle(0.06 * w + 38 * u, y + 30 * u, 38 * u, hueFor(sp.from || 'R')))
    out.push(draw.text(initial(sp.from || 'R'), 0.06 * w + 38 * u, y + 46 * u, { size: 40 * u, weight: 600, fill: '#ffffff', anchor: 'middle' }))
    out.push(draw.text(sp.from || 'Mail', 0.06 * w + 96 * u, y + 22 * u, { size: 34 * u, weight: 600, fill: '#1c1c1e' }))
    out.push(draw.text(sp.time || '8:02 AM', 0.94 * w, y + 22 * u, { size: 28 * u, weight: 400, fill: '#8e8e93', anchor: 'end' }))
    out.push(draw.text('to me', 0.06 * w + 96 * u, y + 62 * u, { size: 28 * u, weight: 400, fill: '#8e8e93' }))
    y += 130 * u
    const bottom = (1 - SAFE.bottom) * h
    for (const para of (sp.body || '').split(/\n+/)) {
      for (const l of wrapText(para, 36 * u, 400, 0.88 * w, draw, 8)) {
        if (y > bottom) break
        out.push(draw.text(l, 0.06 * w, y, { size: 36 * u, weight: 400, fill: '#3a3a3c' }))
        y += 50 * u
      }
      y += 22 * u
    }
  } else if (sp.type === 'job_posting') {
    out.push(rect(0, 0, w, h, 0, '#000000', ' fill-opacity="0.22"'))
    const cw = 0.88 * w, cx = (w - cw) / 2, pad = 40 * u
    const bullets = sp.lines.slice(0, 5).flatMap(b => wrapText(b, 34 * u, 400, cw - 2 * pad - 30 * u, draw, 2).map((l, i) => ({ l, first: i === 0 })))
    const title = wrapText(sp.title || 'Open position', 48 * u, 700, cw - 2 * pad, draw, 2)
    const ch = pad * 2 + 90 * u + title.length * 58 * u + 110 * u + bullets.length * 46 * u + 120 * u
    const cy = Math.max(0.34 * h, Math.min((1 - SAFE.bottom) * h - ch, 0.56 * h - ch / 2))
    out.push(rect(cx, cy, cw, ch, 36 * u, '#ffffff'))
    out.push(rect(cx + pad, cy + pad, 76 * u, 76 * u, 18 * u, hueFor(sp.from || 'N')))
    out.push(draw.text(initial(sp.from || 'N'), cx + pad + 38 * u, cy + pad + 52 * u, { size: 40 * u, weight: 700, fill: '#ffffff', anchor: 'middle' }))
    out.push(draw.text(sp.from || 'Company', cx + pad + 96 * u, cy + pad + 34 * u, { size: 32 * u, weight: 600, fill: '#1c1c1e' }))
    out.push(draw.text(sp.time || 'Posted today', cx + pad + 96 * u, cy + pad + 70 * u, { size: 26 * u, weight: 400, fill: '#8e8e93' }))
    let y = cy + pad + 90 * u + 50 * u
    title.forEach(l => { out.push(draw.text(l, cx + pad, y, { size: 48 * u, weight: 700, fill: '#1c1c1e' })); y += 58 * u })
    out.push(draw.text(sp.body || ' ', cx + pad, y + 4 * u, { size: 32 * u, weight: 500, fill: '#3a3a3c' }))
    y += 50 * u
    out.push(rect(cx + pad, y, cw - 2 * pad, 2, 0, '#e5e5ea'))
    y += 56 * u
    bullets.forEach(b => {
      if (b.first) out.push(circle(cx + pad + 8 * u, y - 11 * u, 6 * u, '#3a3a3c'))
      out.push(draw.text(b.l, cx + pad + 30 * u, y, { size: 34 * u, weight: 400, fill: '#3a3a3c' }))
      y += 46 * u
    })
    const bw = 220 * u, bh = 76 * u
    out.push(rect(cx + cw - pad - bw, cy + ch - pad - bh, bw, bh, bh / 2, '#0a66ff'))
    out.push(draw.text('Apply', cx + cw - pad - bw / 2, cy + ch - pad - bh / 2 + 12 * u, { size: 32 * u, weight: 600, fill: '#ffffff', anchor: 'middle' }))
  } else {
    out.push(drawnScreen(sp, frame, draw))
  }
  return out.join('')
}

// ── Section 28: the launch plan's mock screens ───────────────────────

// Each on a card (or a phone screen) in the middle of the slide, under the
// words, out of the bottom 20%. Generic names only; amounts can be shown as
// gray bars (blur). Every field the slide leaves empty is left out.
const split = (line: string): [string, string] => { const i = line.lastIndexOf('·'); return i < 0 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()] }
const BANNERS: Record<string, string> = { blue: '#2f6fed', green: '#2e9e6b', purple: '#7a5af5', orange: '#ef7d32', gray: '#6b7280', pink: '#e2557f' }

function drawnScreen(sp: SpecialSlide, frame: Frame, draw: Draw): string {
  const w = frame.width, h = frame.height
  const u = w / 1080
  const out: string[] = []
  const rect = (x: number, y: number, rw: number, rh: number, r: number, fill: string, extra = '') => `<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(0, rw))}" height="${num(Math.max(0, rh))}" rx="${num(r)}" fill="${fill}"${extra}/>`
  const circle = (cx: number, cy: number, r: number, fill: string, extra = '') => `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fill}"${extra}/>`
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, extra = '') => `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${stroke}" stroke-width="${num(sw)}"${extra}/>`
  const t = (text: string, x: number, y: number, size: number, weight: number, fill: string, anchor?: 'middle' | 'end') => draw.text(text, x, y, { size: size * u, weight, fill, ...(anchor ? { anchor } : {}) })
  const wrap = (text: string, size: number, weight: number, maxW: number, lines: number) => wrapText(text, size * u, weight, maxW, draw, lines)
  const bottom = (1 - SAFE.bottom) * h
  const cw = 0.88 * w, cx = (w - cw) / 2, pad = 40 * u
  // A card of a known height, centered a little below the middle, kept out
  // of the bottom 20% (and never above a third of the frame).
  const place = (ch: number) => Math.max(0.33 * h, Math.min(bottom - ch, 0.56 * h - ch / 2))
  const dim = (o: number) => out.push(rect(0, 0, w, h, 0, '#000000', ` fill-opacity="${o}"`))
  const bar = (x: number, y: number, bw: number, size: number) => rect(x, y - size * u * 0.8, bw, size * u * 0.9, size * u * 0.3, '#c7c7cc')

  if (sp.type === 'application_form') {
    dim(0.22)
    const fields = sp.lines.filter(Boolean).slice(0, 5).map(l => { const i = l.indexOf(':'); return sp.variant === 'filled' && i > 0 ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { label: l.replace(/:\s*$/, '').trim(), value: '' } })
    const total = Math.max(sp.count, fields.length)
    const ch = pad * 2 + 40 * u + 64 * u + 70 * u + fields.length * 132 * u + 110 * u
    const y0 = place(ch)
    out.push(rect(cx, y0, cw, ch, 32 * u, '#ffffff'))
    let y = y0 + pad + 26 * u
    out.push(t(sp.from || 'Form', cx + pad, y, 28, 500, '#8e8e93'))
    y += 58 * u
    out.push(t(wrap(sp.title || 'Your details', 44, 700, cw - 2 * pad, 1)[0] ?? '', cx + pad, y, 44, 700, '#1c1c1e'))
    y += 40 * u
    if (total) {
      const done = sp.variant === 'filled' ? total : 0
      out.push(rect(cx + pad, y, cw - 2 * pad, 12 * u, 6 * u, '#e5e5ea'))
      if (done) out.push(rect(cx + pad, y, (cw - 2 * pad) * (done / total), 12 * u, 6 * u, '#34c759'))
      out.push(t(`${done} of ${total} fields`, cx + cw - pad, y + 46 * u, 26, 500, '#8e8e93', 'end'))
    }
    y += 70 * u
    fields.forEach((f, i) => {
      out.push(t(f.label, cx + pad, y + 28 * u, 28, 600, '#3a3a3c'))
      const by = y + 44 * u, bh = 70 * u
      out.push(rect(cx + pad, by, cw - 2 * pad, bh, 14 * u, sp.variant === 'filled' ? '#f2f8ff' : '#ffffff', ` stroke="${sp.variant === 'filled' ? '#8fb8ff' : '#c7c7cc'}" stroke-width="${num(2 * u)}"`))
      if (f.value) out.push(t(wrap(f.value, 32, 400, cw - 2 * pad - 40 * u, 1)[0] ?? '', cx + pad + 22 * u, by + bh / 2 + 12 * u, 32, 400, '#1c1c1e'))
      else if (i === 0 && sp.variant !== 'filled') out.push(rect(cx + pad + 22 * u, by + 16 * u, 4 * u, bh - 32 * u, 2 * u, '#0a84ff'))
      y += 132 * u
    })
    const bw = 200 * u, bh = 72 * u
    out.push(rect(cx + cw - pad - bw, y0 + ch - pad - bh, bw, bh, bh / 2, sp.variant === 'filled' ? '#0a84ff' : '#d1d1d6'))
    out.push(t('Next', cx + cw - pad - bw / 2, y0 + ch - pad - bh / 2 + 11 * u, 30, 600, '#ffffff', 'middle'))
  } else if (sp.type === 'portal_status') {
    dim(0.22)
    const steps = sp.lines.filter(Boolean).slice(0, 6).map(split)
    const ch = pad * 2 + 150 * u + steps.length * 112 * u + 10 * u
    const y0 = place(ch)
    out.push(rect(cx, y0, cw, ch, 32 * u, '#ffffff'))
    let y = y0 + pad + 26 * u
    out.push(t(sp.from || 'Status', cx + pad, y, 28, 500, '#8e8e93'))
    y += 56 * u
    out.push(t(wrap(sp.title || 'Your request', 42, 700, cw - 2 * pad - 260 * u, 1)[0] ?? '', cx + pad, y, 42, 700, '#1c1c1e'))
    if (sp.body) {
      const pw = Math.min(300 * u, draw.measure(sp.body, 26 * u, 600) + 40 * u)
      out.push(rect(cx + cw - pad - pw, y - 38 * u, pw, 50 * u, 25 * u, '#fff4d6'))
      out.push(t(sp.body, cx + cw - pad - pw / 2, y - 4 * u, 26, 600, '#a15c00', 'middle'))
    }
    y += 70 * u
    const lx = cx + pad + 18 * u
    if (steps.length > 1) out.push(line(lx, y, lx, y + (steps.length - 1) * 112 * u, '#d1d1d6', 4 * u))
    steps.forEach(([label, when], i) => {
      const last = i === steps.length - 1
      out.push(circle(lx, y, 16 * u, last ? '#ffffff' : '#34c759', last ? ` stroke="#ff9f0a" stroke-width="${num(6 * u)}"` : ''))
      out.push(t(label || ' ', lx + 44 * u, y + 10 * u, 32, last ? 700 : 600, '#1c1c1e'))
      if (when) out.push(t(when, lx + 44 * u, y + 52 * u, 26, 400, '#8e8e93'))
      y += 112 * u
    })
  } else if (sp.type === 'calendar_invite') {
    dim(0.22)
    const title = wrap(sp.title || 'Quick chat', 46, 700, cw - 2 * pad - 20 * u, 2)
    const people = sp.lines.filter(Boolean).slice(0, 8)
    const ch = pad * 2 + title.length * 56 * u + 60 * u + (sp.body ? 50 * u : 0) + (sp.from ? 50 * u : 0) + (people.length ? 110 * u : 0) + 110 * u
    const y0 = place(ch)
    out.push(rect(cx, y0, cw, ch, 32 * u, '#ffffff'))
    out.push(rect(cx, y0, 14 * u, ch, 7 * u, '#5e5ce6'))
    let y = y0 + pad + 40 * u
    title.forEach(l => { out.push(t(l, cx + pad + 10 * u, y, 46, 700, '#1c1c1e')); y += 56 * u })
    if (sp.time) { out.push(t(sp.time, cx + pad + 10 * u, y + 4 * u, 30, 500, '#3a3a3c')); y += 54 * u } else y += 10 * u
    if (sp.body) { out.push(t(wrap(sp.body, 28, 400, cw - 2 * pad, 1)[0] ?? '', cx + pad + 10 * u, y, 28, 400, '#6e6e73')); y += 50 * u }
    if (sp.from) { out.push(t(`Organizer: ${sp.from}`, cx + pad + 10 * u, y, 28, 400, '#6e6e73')); y += 50 * u }
    if (people.length) {
      people.forEach((p, i) => {
        const px = cx + pad + 10 * u + 36 * u + i * 62 * u
        out.push(circle(px, y + 34 * u, 30 * u, hueFor(p), ` stroke="#ffffff" stroke-width="${num(4 * u)}"`))
        out.push(t(p.slice(0, 2).toUpperCase(), px, y + 44 * u, 24, 700, '#ffffff', 'middle'))
      })
      y += 100 * u
    }
    const labels = ['Yes', 'Maybe', 'No']
    const bw = (cw - 2 * pad - 30 * u) / 3
    labels.forEach((l, i) => {
      const bx = cx + pad + i * (bw + 15 * u)
      out.push(rect(bx, y, bw, 66 * u, 33 * u, '#f2f2f7'))
      out.push(t(l, bx + bw / 2, y + 44 * u, 28, 600, '#1c1c1e', 'middle'))
    })
  } else if (sp.type === 'receipt') {
    dim(0.22)
    const items = sp.lines.filter(Boolean).slice(0, 7).map(split)
    const receipt = sp.variant === 'receipt'
    const rw = receipt ? 0.72 * w : cw, rx = (w - rw) / 2
    const ch = pad * 2 + 140 * u + items.length * 66 * u + 140 * u
    const y0 = place(ch)
    out.push(rect(rx, y0, rw, ch, receipt ? 6 * u : 18 * u, '#fbfaf6'))
    let y = y0 + pad + 46 * u
    out.push(t(sp.title || (receipt ? 'RECEIPT' : 'INVOICE'), receipt ? w / 2 : rx + pad, y, 44, 800, '#1c1c1e', receipt ? 'middle' : undefined))
    y += 50 * u
    if (sp.from) out.push(t(sp.from, receipt ? w / 2 : rx + pad, y, 28, 500, '#6e6e73', receipt ? 'middle' : undefined))
    if (sp.time && !receipt) out.push(t(sp.time, rx + rw - pad, y, 26, 500, '#6e6e73', 'end'))
    y += 44 * u
    out.push(line(rx + pad, y, rx + rw - pad, y, '#b9b5aa', 2 * u, ` stroke-dasharray="${num(10 * u)} ${num(8 * u)}"`))
    y += 56 * u
    items.forEach(([item, amount]) => {
      const iw = rw - 2 * pad - (amount ? draw.measure(amount, 30 * u, 600) + 30 * u : 0)
      out.push(t(wrap(item, 30, 400, iw, 1)[0] ?? '', rx + pad, y, 30, 400, '#1c1c1e'))
      if (amount) out.push(sp.blur ? bar(rx + rw - pad - 130 * u, y, 130 * u, 30) : t(amount, rx + rw - pad, y, 30, 600, '#1c1c1e', 'end'))
      y += 66 * u
    })
    out.push(line(rx + pad, y - 30 * u, rx + rw - pad, y - 30 * u, '#1c1c1e', 3 * u))
    y += 34 * u
    const [label, amount] = split(sp.body || 'Total')
    out.push(t(label, rx + pad, y, 34, 800, '#1c1c1e'))
    if (amount) out.push(sp.blur ? bar(rx + rw - pad - 170 * u, y, 170 * u, 34) : t(amount, rx + rw - pad, y, 34, 800, '#1c1c1e', 'end'))
    if (sp.time && receipt) out.push(t(sp.time, w / 2, y + 56 * u, 24, 500, '#8e8e93', 'middle'))
  } else if (sp.type === 'bank_app') {
    dim(0.22)
    const rows = sp.lines.filter(Boolean).slice(0, 5).map(split)
    const ch = 150 * u + 190 * u + rows.length * 96 * u + pad
    const y0 = place(ch)
    out.push(rect(cx, y0, cw, ch, 36 * u, '#ffffff'))
    out.push(`<path d="M${num(cx)} ${num(y0 + 36 * u)} a${num(36 * u)} ${num(36 * u)} 0 0 1 ${num(36 * u)} ${num(-36 * u)} h${num(cw - 72 * u)} a${num(36 * u)} ${num(36 * u)} 0 0 1 ${num(36 * u)} ${num(36 * u)} v${num(114 * u)} h${num(-cw)} z" fill="#1f7a5c"/>`)
    out.push(t(sp.from || 'Everyday Bank', cx + pad, y0 + 64 * u, 28, 600, '#d6f5e9'))
    out.push(t(sp.title || 'Savings', cx + pad, y0 + 112 * u, 38, 700, '#ffffff'))
    let y = y0 + 150 * u + 56 * u
    out.push(t(sp.time || 'Available balance', cx + pad, y, 26, 500, '#8e8e93'))
    y += 88 * u
    out.push(sp.blur ? bar(cx + pad, y, 360 * u, 76) : t(sp.body || '$0.00', cx + pad, y, 76, 800, '#1c1c1e'))
    y += 46 * u
    rows.forEach(([label, amount]) => {
      out.push(line(cx + pad, y, cx + cw - pad, y, '#e5e5ea', 2 * u))
      y += 62 * u
      out.push(t(wrap(label, 30, 500, cw - 2 * pad - 260 * u, 1)[0] ?? '', cx + pad, y, 30, 500, '#1c1c1e'))
      if (amount) out.push(sp.blur ? bar(cx + cw - pad - 150 * u, y, 150 * u, 30) : t(amount, cx + cw - pad, y, 30, 600, /^\s*\+/.test(amount) ? '#1f7a5c' : /^\s*[-−]/.test(amount) ? '#d70015' : '#1c1c1e', 'end'))
      y += 34 * u
    })
  } else if (sp.type === 'museum_placard') {
    dim(0.18)
    const pw = 0.78 * w, px = (w - pw) / 2, ppad = 52 * u
    const title = wrap(sp.title || 'Untitled', 50, 800, pw - 2 * ppad, 3)
    const body = wrap(sp.body || '', 32, 400, pw - 2 * ppad, 7)
    const ch = ppad * 2 + title.length * 62 * u + (sp.from ? 52 * u : 0) + (sp.time ? 46 * u : 0) + (body.length ? 34 * u + body.length * 46 * u : 0)
    const y0 = place(ch)
    out.push(rect(px + 10 * u, y0 + 14 * u, pw, ch, 4 * u, '#000000', ' fill-opacity="0.25"'))
    out.push(rect(px, y0, pw, ch, 4 * u, '#f6f3ec', ` stroke="#d8d2c4" stroke-width="${num(2 * u)}"`))
    let y = y0 + ppad + 44 * u
    title.forEach(l => { out.push(t(l, px + ppad, y, 50, 800, '#1c1c1e')); y += 62 * u })
    if (sp.from) { out.push(t(sp.from, px + ppad, y, 34, 600, '#3a3a3c')); y += 52 * u }
    if (sp.time) { out.push(t(sp.time, px + ppad, y - 6 * u, 28, 400, '#6e6e73')); y += 46 * u }
    if (body.length) { y += 20 * u; body.forEach(l => { out.push(t(l, px + ppad, y, 32, 400, '#2c2c2e')); y += 46 * u }) }
  } else if (sp.type === 'survey') {
    dim(0.22)
    const q = wrap(sp.title || 'How likely are you to recommend us to a friend?', 40, 700, cw - 2 * pad, 4)
    const ch = pad * 2 + 50 * u + q.length * 52 * u + 40 * u + 90 * u + 60 * u + 100 * u
    const y0 = place(ch)
    out.push(rect(cx, y0, cw, ch, 32 * u, '#ffffff'))
    let y = y0 + pad + 26 * u
    out.push(t(sp.from || 'Survey', cx + pad, y, 26, 500, '#8e8e93'))
    y += 64 * u
    q.forEach(l => { out.push(t(l, cx + pad, y, 40, 700, '#1c1c1e')); y += 52 * u })
    y += 20 * u
    const gap = 8 * u, bw = (cw - 2 * pad - 10 * gap) / 11
    for (let k = 0; k <= 10; k++) {
      const bx = cx + pad + k * (bw + gap), on = sp.count === k
      out.push(rect(bx, y, bw, 80 * u, 12 * u, on ? '#0a84ff' : '#f2f2f7', on ? '' : ` stroke="#d1d1d6" stroke-width="${num(2 * u)}"`))
      out.push(t(String(k), bx + bw / 2, y + 52 * u, 30, 700, on ? '#ffffff' : '#3a3a3c', 'middle'))
    }
    y += 80 * u + 40 * u
    out.push(t('Not at all likely', cx + pad, y, 24, 500, '#8e8e93'))
    out.push(t('Extremely likely', cx + cw - pad, y, 24, 500, '#8e8e93', 'end'))
    const bw2 = 220 * u, bh = 70 * u
    out.push(rect(cx + cw - pad - bw2, y0 + ch - pad - bh, bw2, bh, bh / 2, sp.count >= 0 ? '#0a84ff' : '#d1d1d6'))
    out.push(t('Submit', cx + cw - pad - bw2 / 2, y0 + ch - pad - bh / 2 + 11 * u, 30, 600, '#ffffff', 'middle'))
  } else if (sp.type === 'lock_screen') {
    dim(0.42)
    // The clock sits under the slide's words (they are near the top).
    const clockY = 0.455 * h
    if (sp.from) out.push(t(sp.from, w / 2, clockY - 132 * u, 32, 600, '#ffffff', 'middle'))
    out.push(t(sp.time || '9:41', w / 2, clockY, 140, 700, '#ffffff', 'middle'))
    let y = clockY + 44 * u
    for (const raw of sp.lines.filter(Boolean).slice(0, 4)) {
      const parts = raw.split('·').map(x => x.trim())
      const [app, who, msg] = parts.length >= 3 ? [parts[0]!, parts[1]!, parts.slice(2).join(' · ')] : parts.length === 2 ? [parts[0]!, '', parts[1]!] : ['', '', parts[0]!]
      const body = wrap(msg, 32, 400, cw - 2 * pad, 2)
      const nh = pad * 1.2 + (app ? 36 * u : 0) + (who ? 42 * u : 0) + body.length * 40 * u
      if (y + nh > bottom) break
      out.push(rect(cx, y, cw, nh, 34 * u, '#f2f2f7', ' fill-opacity="0.88"'))
      let ny = y + pad * 0.6 + 26 * u
      if (app) { out.push(t(app.toUpperCase(), cx + pad, ny, 24, 600, '#6e6e73')); ny += 40 * u }
      if (who) { out.push(t(who, cx + pad, ny, 32, 700, '#1c1c1e')); ny += 40 * u }
      body.forEach(l => { out.push(t(l, cx + pad, ny, 32, 400, '#1c1c1e')); ny += 40 * u })
      y += nh + 14 * u
    }
  } else if (sp.type === 'profile_card') {
    dim(0.22)
    const stats = sp.lines.filter(Boolean).slice(0, 3).map(split)
    const about = wrap(sp.body || '', 30, 400, cw - 2 * pad, 3)
    const ch = 170 * u + 90 * u + 60 * u + (sp.from ? 48 * u : 0) + about.length * 42 * u + (stats.length ? 120 * u : 30 * u) + pad
    const y0 = place(ch)
    out.push(rect(cx, y0, cw, ch, 32 * u, '#ffffff'))
    const color = BANNERS[sp.variant] ?? BANNERS.blue!
    out.push(`<path d="M${num(cx)} ${num(y0 + 32 * u)} a${num(32 * u)} ${num(32 * u)} 0 0 1 ${num(32 * u)} ${num(-32 * u)} h${num(cw - 64 * u)} a${num(32 * u)} ${num(32 * u)} 0 0 1 ${num(32 * u)} ${num(32 * u)} v${num(138 * u)} h${num(-cw)} z" fill="${color}"/>`)
    const ar = 74 * u, ax = cx + pad + ar, ay = y0 + 170 * u
    const open = /open to work/i.test(sp.from)
    out.push(circle(ax, ay, ar + 8 * u, open ? '#2e9e6b' : '#ffffff'))
    out.push(circle(ax, ay, ar, hueFor(sp.title || 'A')))
    out.push(t(initial(sp.title || 'A'), ax, ay + 26 * u, 70, 700, '#ffffff', 'middle'))
    let y = ay + ar + 64 * u
    out.push(t(sp.title || 'Name', cx + pad, y, 44, 800, '#1c1c1e'))
    y += 48 * u
    if (sp.from) { out.push(t(wrap(sp.from, 30, 500, cw - 2 * pad, 1)[0] ?? '', cx + pad, y, 30, 500, '#3a3a3c')); y += 48 * u }
    about.forEach(l => { out.push(t(l, cx + pad, y, 30, 400, '#6e6e73')); y += 42 * u })
    if (stats.length) {
      y += 30 * u
      const sw = (cw - 2 * pad) / stats.length
      stats.forEach(([label, value], i) => {
        const sx = cx + pad + i * sw
        out.push(t(value || label, sx, y + 20 * u, 36, 800, '#1c1c1e'))
        if (value) out.push(t(wrap(label, 22, 500, sw - 10 * u, 1)[0] ?? '', sx, y + 58 * u, 22, 500, '#8e8e93'))
      })
    }
  }
  return out.join('')
}

// The product screenshot's box (section 28): the owner's upload as it is,
// `scale` of the frame's width, centered under the words and kept out of
// the bottom 20%; `ratio` is the screenshot's width over its height.
export function productShotBox(sp: Pick<SpecialSlide, 'scale' | 'variant'> & { ratio?: number }, frame: Frame): { x: number; y: number; w: number; h: number } {
  const ratio = sp.ratio && sp.ratio > 0 ? sp.ratio : 0.5
  const top = (sp.variant === 'top' ? 0.12 : 0.33) * frame.height
  const room = (1 - SAFE.bottom) * frame.height - top
  let bw = Math.max(0.2, Math.min(1, sp.scale || 0.72)) * frame.width * 0.92
  let bh = bw / ratio
  if (bh > room) { bh = room; bw = bh * ratio }
  return { x: (frame.width - bw) / 2, y: top, w: bw, h: bh }
}

export function productShotSvg(href: string, box: { x: number; y: number; w: number; h: number }, frame: Frame): string {
  const r = 28 * (frame.width / 1080)
  const id = 'ps'
  return `<defs><clipPath id="${id}"><rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${num(r)}"/></clipPath></defs>`
    + `<rect x="${num(box.x + 6)}" y="${num(box.y + 14)}" width="${num(box.w)}" height="${num(box.h)}" rx="${num(r)}" fill="#000000" fill-opacity="0.35"/>`
    + `<image href="${esc(href)}" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
}

// The whole overlay of one slide: its special slide, its words, and Ad on
// slide 1 when the post is an ad.
export function slideOverlaySvg(input: { style: TextStyleId; text: string; pos: SlidePos | null; special: SpecialSlide | null; ad: boolean; shotHref?: string | null }, frame: Frame, draw: Draw): { svg: string; layout: TextLayout | null } {
  const layout = textLayout(input.style, input.text, frame, input.pos, draw, input.special ? SPECIAL_POS : DEFAULT_POS)
  const shot = input.special?.type === 'product_shot' && input.shotHref ? productShotSvg(input.shotHref, productShotBox(input.special, frame), frame) : ''
  const body = [
    input.special ? specialSvg(input.special, frame, draw) : '',
    shot,
    layout ? textSvg(layout, frame, draw) : '',
    input.ad ? adSvg(layout, frame, draw) : '',
  ].join('')
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">${body}</svg>`, layout }
}

// Words a slide should have (4 to 12), for the hint beside each slide.
export function wordsNote(text: string): string | null {
  const n = wordCount(text)
  if (!n) return null
  if (n < 4) return `${n} word${n === 1 ? '' : 's'}: 4 to 12 reads best`
  if (n > 12) return `${n} words: 12 at most reads best`
  return null
}

export { esc as escapeSvg }
