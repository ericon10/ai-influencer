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

const ASCENT = 0.93
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
  else if (style === 'note') { const pad = 0.05 * w; bw = 0.84 * w; bh = noteHeader(w) + lines.length * lineH + 2 * pad }
  else { bw = textW; bh = lines.length * lineH }
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

// The text block as SVG over the whole frame.
export function textSvg(l: TextLayout, frame: Frame, draw: Draw): string {
  const w = frame.width
  const parts: string[] = []
  const cx = l.block.x + l.block.w / 2
  if (l.style === 'classic') {
    const top = l.block.y
    l.lines.forEach((line, i) => {
      const y = top + i * l.lineH + (l.lineH - l.size) / 2 + l.size * ASCENT
      parts.push(draw.text(line, cx, y, { size: l.size, weight: l.weight, fill: '#ffffff', anchor: 'middle', stroke: { color: '#000000', width: l.size * 0.15 } }))
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
    const off = Math.max(1.5, l.size * 0.05)
    l.lines.forEach((line, i) => {
      const y = l.block.y + i * l.lineH + (l.lineH - l.size) / 2 + l.size * ASCENT
      parts.push(draw.text(line, cx + off * 0.6, y + off, { size: l.size, weight: l.weight, fill: '#000000', anchor: 'middle', opacity: 0.38 }))
      parts.push(draw.text(line, cx, y, { size: l.size, weight: l.weight, fill: '#ffffff', anchor: 'middle' }))
    })
  } else {
    const pad = 0.05 * w, r = 0.035 * w, head = noteHeader(w)
    const { x, y, w: bw, h: bh } = l.block
    parts.push(`<rect x="${num(x + 0.006 * w)}" y="${num(y + 0.01 * w)}" width="${num(bw)}" height="${num(bh)}" rx="${num(r)}" fill="#000000" fill-opacity="0.18"/>`)
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
    const subject = wrapText(sp.title || 'Update on your application', 50 * u, 700, 0.88 * w, draw, 3)
    subject.forEach(l => { out.push(draw.text(l, 0.06 * w, y, { size: 50 * u, weight: 700, fill: '#1c1c1e' })); y += 62 * u })
    y += 26 * u
    out.push(circle(0.06 * w + 38 * u, y + 30 * u, 38 * u, hueFor(sp.from || 'R')))
    out.push(draw.text(initial(sp.from || 'R'), 0.06 * w + 38 * u, y + 46 * u, { size: 40 * u, weight: 600, fill: '#ffffff', anchor: 'middle' }))
    out.push(draw.text(sp.from || 'Recruiting Team', 0.06 * w + 96 * u, y + 22 * u, { size: 34 * u, weight: 600, fill: '#1c1c1e' }))
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
  } else {
    out.push(rect(0, 0, w, h, 0, '#000000', ' fill-opacity="0.22"'))
    const cw = 0.88 * w, cx = (w - cw) / 2, pad = 40 * u
    const bullets = sp.lines.slice(0, 5).flatMap(b => wrapText(b, 34 * u, 400, cw - 2 * pad - 30 * u, draw, 2).map((l, i) => ({ l, first: i === 0 })))
    const title = wrapText(sp.title || 'Open role', 48 * u, 700, cw - 2 * pad, draw, 2)
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
  }
  return out.join('')
}

// The whole overlay of one slide: its special slide, its words, and Ad on
// slide 1 when the post is an ad.
export function slideOverlaySvg(input: { style: TextStyleId; text: string; pos: SlidePos | null; special: SpecialSlide | null; ad: boolean }, frame: Frame, draw: Draw): { svg: string; layout: TextLayout | null } {
  const layout = textLayout(input.style, input.text, frame, input.pos, draw, input.special ? SPECIAL_POS : DEFAULT_POS)
  const body = [
    input.special ? specialSvg(input.special, frame, draw) : '',
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
