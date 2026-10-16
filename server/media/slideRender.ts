import sharp, { type Sharp } from 'sharp'
import type opentype from 'opentype.js'
import type { ContentConfig } from '../config/pipeline.js'
import { captionFonts } from '../core/overlay.js'
import { escapeSvg, slideOverlaySvg, specialOwnBackground, type Draw, type Frame, type TextOpts } from '../core/slideSvg.js'
import type { SlidePos, SpecialSlide, TextStyleId } from '../core/slides.js'

// A slideshow slide as a JPEG (UX-PLAN.md section 27): the still filling
// the frame, or a special slide (a mock phone screen over the blurred
// photo, or on its own background), then the words in the post's text
// style where they were dragged, and Ad on slide 1 of an ad. The words are
// drawn as outlines from the bundled TikTok Sans (Noto Emoji for emoji), so
// the worker needs no system fonts and the export matches the preview.

type Font = opentype.Font

const fontsFor = (cap: ContentConfig['caption'], weight: number): Font[] => captionFonts({ ...cap, font: { ...cap.font, weight } })
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900]
const nearest = (w: number) => WEIGHTS.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a))

interface Run { font: Font; text: string }
function runs(fonts: Font[], text: string): Run[] {
  const out: Run[] = []
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0)!
    if (cp === 0xfe0f || cp === 0x200d) continue
    const font = fonts.find(f => f.charToGlyphIndex(ch) > 0) ?? (ch.trim() ? null : fonts[0]!)
    if (!font) continue
    const last = out.at(-1)
    if (last && last.font === font) last.text += ch
    else out.push({ font, text: ch })
  }
  return out
}

// The Draw the shared layout uses, with the fonts of the caption config.
export function fontDraw(cap: ContentConfig['caption']): Draw {
  const cache = new Map<number, Font[]>()
  const fonts = (weight: number) => {
    const w = nearest(weight)
    let f = cache.get(w)
    if (!f) { f = fontsFor(cap, w); cache.set(w, f) }
    return f
  }
  const measure = (text: string, size: number, weight: number) => runs(fonts(weight), text).reduce((a, r) => a + r.font.getAdvanceWidth(r.text, size), 0)
  return {
    measure,
    text(text: string, x: number, y: number, o: TextOpts) {
      const w = measure(text, o.size, o.weight)
      let gx = o.anchor === 'middle' ? x - w / 2 : o.anchor === 'end' ? x - w : x
      const d = runs(fonts(o.weight), text).map(r => { const p = r.font.getPath(r.text, gx, y, o.size).toPathData(2); gx += r.font.getAdvanceWidth(r.text, o.size); return p }).join(' ')
      if (!d.trim()) return ''
      const op = o.opacity != null ? ` fill-opacity="${o.opacity}"` : ''
      const stroke = o.stroke ? `<path d="${d}" fill="none" stroke="${escapeSvg(o.stroke.color)}" stroke-width="${o.stroke.width.toFixed(1)}" stroke-linejoin="round"/>` : ''
      return `${stroke}<path d="${d}" fill="${escapeSvg(o.fill)}"${op}/>`
    },
  }
}

export interface SlideInput {
  still: Buffer | null
  text: string
  style: TextStyleId
  pos: SlidePos | null
  special: SpecialSlide | null
  ad: boolean
}

// One slide at one size, as JPEG.
export async function renderSlide(input: SlideInput, frame: Frame, content: Pick<ContentConfig, 'caption' | 'slideshow'>, draw = fontDraw(content.caption)): Promise<Buffer> {
  const { width: w, height: h } = frame
  let base: Sharp
  if (input.special && specialOwnBackground(input.special.type)) base = sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
  else if (input.still) {
    const fit = sharp(input.still).rotate().resize(w, h, { fit: 'cover', position: 'centre' })
    // A mock screen sits over the blurred photo.
    base = input.special ? sharp(await fit.blur(28).modulate({ brightness: 0.8 }).toBuffer()) : fit
  } else {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3a55"/><stop offset="1" stop-color="#0f1626"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`
    base = sharp(Buffer.from(svg))
  }
  const { svg } = slideOverlaySvg({ style: input.style, text: input.text, pos: input.pos, special: input.special, ad: input.ad }, frame, draw)
  const overlay = await sharp(Buffer.from(svg)).png().toBuffer()
  return base.composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: content.slideshow.image.quality, mozjpeg: true }).toBuffer()
}
