import { useEffect, useState } from 'react'
import '@fontsource/tiktok-sans/400.css'
import '@fontsource/tiktok-sans/500.css'
import '@fontsource/tiktok-sans/600.css'
import '@fontsource/tiktok-sans/700.css'
import '@fontsource/tiktok-sans/800.css'
import { escapeSvg, type Draw, type TextOpts } from '../../../../../server/core/slideSvg'

// The browser's half of the slide renderer (UX-PLAN.md section 27): the
// same layout as the worker's export (server/core/slideSvg.ts), measured
// with the same bundled TikTok Sans in a canvas and drawn as SVG text, so
// the preview and the exported JPEG break lines and place words alike.

const FAMILY = '"TikTok Sans", system-ui, sans-serif'
let canvas: HTMLCanvasElement | null = null

export const browserDraw: Draw = {
  measure(text: string, size: number, weight: number) {
    canvas ??= document.createElement('canvas')
    const c = canvas.getContext('2d')
    if (!c) return text.length * size * 0.55
    c.font = `${weight} ${size}px ${FAMILY}`
    return c.measureText(text).width
  },
  text(text: string, x: number, y: number, o: TextOpts) {
    const anchor = o.anchor ?? 'start'
    const stroke = o.stroke ? ` stroke="${escapeSvg(o.stroke.color)}" stroke-width="${o.stroke.width.toFixed(1)}" stroke-linejoin="round" paint-order="stroke"` : ''
    const op = o.opacity != null ? ` fill-opacity="${o.opacity}"` : ''
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family='${FAMILY}' font-weight="${o.weight}" font-size="${o.size.toFixed(1)}" text-anchor="${anchor}" fill="${escapeSvg(o.fill)}"${op}${stroke} style="white-space:pre">${escapeSvg(text)}</text>`
  },
}

// True once the TikTok Sans weights the slides use are loaded (measuring
// before that would break lines with a fallback font's widths).
export function useSlideFonts(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (!fonts) { setReady(true); return }
    Promise.all([400, 500, 600, 700, 800].map(w => fonts.load(`${w} 40px "TikTok Sans"`, 'Aa'))).catch(() => undefined).finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [])
  return ready
}
