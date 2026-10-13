import sharp from 'sharp'

// The end frame helper (owner, 2026-10-13): only the head and face of the
// start frame change, so the mask covers the head and nothing else. Full
// edits re-compose the whole scene; a masked inpaint keeps it.

export interface Box { x: number; y: number; w: number; h: number }

// The head from a detected face box: wide enough for hair and ears, from
// above the hairline to just under the chin, kept inside the image.
export function headBox(face: Box, width: number, height: number): Box {
  const cx = face.x + face.w / 2
  const half = (face.w * 1.9) / 2
  const x0 = Math.max(0, Math.round(cx - half))
  const x1 = Math.min(width, Math.round(cx + half))
  const y0 = Math.max(0, Math.round(face.y - face.h * 0.75))
  const y1 = Math.min(height, Math.round(face.y + face.h * 1.25))
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

// White where the edit may change the image (an ellipse over the head),
// black everywhere else, at the image's own size.
export async function headMaskPng(box: Box, width: number, height: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + '<rect width="100%" height="100%" fill="black"/>'
    + `<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" fill="white"/>`
    + '</svg>'
  return sharp(Buffer.from(svg)).flatten({ background: '#000' }).toColourspace('b-w').png().toBuffer()
}
