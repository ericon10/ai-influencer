import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { loadConfig } from '../config/load.js'
import { fontDraw } from './slideRender.js'
import { slideOverlaySvg } from '../core/slideSvg.js'
import { TEXT_STYLES } from '../core/slides.js'

// Every slideshow text style draws inside its box (owner, 2026-10-22): the
// box is what the preview drags and the Ad pill sits against, so Classic's
// outline, Minimal's shadow and the Note card's shadow stay inside it, and
// the words sit centered on their lines. Rendered with the bundled fonts.
describe('slide text stays inside its box', () => {
  const draw = fontDraw(loadConfig().pipeline.content.caption)
  const frame = { width: 1080, height: 1920 }
  const texts = ['Gypsy jog', 'my boss quietly gave my job to a spreadsheet', 'they replaced me with a spreadsheet macro and nobody even told me why, apparently joking']
  for (const style of TEXT_STYLES.map(s => s.id)) for (const text of texts) {
    it(`${style}: ${text.split(' ').length} words`, async () => {
      const { svg, layout } = slideOverlaySvg({ style, text, pos: { x: 0.5, y: 0.4 }, special: null, ad: false }, frame, draw)
      const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3]! > 20) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
      }
      const b = layout!.block
      // One pixel for the edge of an anti-aliased rect.
      expect(x0).toBeGreaterThanOrEqual(Math.floor(b.x) - 1)
      expect(y0).toBeGreaterThanOrEqual(Math.floor(b.y) - 1)
      expect(x1 + 1).toBeLessThanOrEqual(Math.ceil(b.x + b.w) + 1)
      expect(y1 + 1).toBeLessThanOrEqual(Math.ceil(b.y + b.h) + 1)
      // Centered on the lines: the gap above and below differ by little.
      if (style === 'classic' || style === 'minimal') expect(Math.abs((y0 - b.y) - (b.y + b.h - y1 - 1))).toBeLessThanOrEqual(0.1 * layout!.size)
    })
  }
})
