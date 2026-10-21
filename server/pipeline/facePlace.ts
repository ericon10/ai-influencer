import sharp from 'sharp'
import { and, eq } from 'drizzle-orm'
import type { Ctx, Deps } from '../context.js'
import { candidates, contentItems } from '../db/schema.js'
import { readAsset } from '../storage/assets.js'
import { placeText, type FaceBox, type Placed } from '../core/facePlace.js'
import { SPECIAL_POS, DEFAULT_POS } from '../core/slideSvg.js'
import { slideshowSpecSchema, type SlideshowSpec } from '../core/slideshowSpec.js'
import { fontDraw } from '../media/slideRender.js'
import { setAt, slideList } from '../core/slides.js'

// R1 on slide stills (owner, 2026-10-22; UX-PLAN.md section 35, item 8):
// each still's face boxes (found once, free, kept on its candidate), and
// the words of every slide moved off them. A place the owner dragged
// sticks; a slide with no face keeps its place (topic slides). Runs when a
// still lands, and on Auto-place all (the Slides step, a style change).

export async function stillFaces(deps: Deps, ctx: Ctx, candidateId: string): Promise<FaceBox[]> {
  const [c] = await deps.db.select().from(candidates).where(and(eq(candidates.accountId, ctx.accountId), eq(candidates.id, candidateId)))
  if (!c?.assetId) return []
  const meta = (c.meta ?? {}) as { faces?: FaceBox[] }
  if (Array.isArray(meta.faces)) return meta.faces
  if (!(await deps.faces.status()).available) return []
  const data = (await readAsset(deps, ctx, c.assetId)).data
  const size = await sharp(data).metadata()
  if (!size.width || !size.height) return []
  const found = await deps.faces.detect(data).catch(() => [])
  const faces = found.map(f => ({ x: f.box.x / size.width!, y: f.box.y / size.height!, w: f.box.w / size.width!, h: f.box.h / size.height! }))
  await deps.db.update(candidates).set({ meta: { ...meta, faces } }).where(eq(candidates.id, c.id))
  return faces
}

export interface AutoPlaced { slide: number; how: Placed['how'] | 'owner' }

export async function autoPlace(deps: Deps, ctx: Ctx, postId: string, o: { slides?: number[] } = {}): Promise<AutoPlaced[]> {
  const [row] = await deps.db.select().from(contentItems).where(and(eq(contentItems.accountId, ctx.accountId), eq(contentItems.id, postId)))
  if (!row || row.kind !== 'slideshow') return []
  const spec: SlideshowSpec = slideshowSpecSchema.parse(row.spec ?? {})
  const cfg = deps.config.pipeline.content
  const frame = { width: cfg.canvas.width, height: cfg.canvas.height }
  const draw = fontDraw(cfg.caption)
  const out: AutoPlaced[] = []
  let textPos = spec.textPos ?? []
  for (const s of slideList(spec)) {
    if (o.slides && !o.slides.includes(s.index)) continue
    if (!s.text || !s.stillId) continue
    if (s.pos?.by === 'owner') { out.push({ slide: s.index, how: 'owner' }); continue }
    const faces = await stillFaces(deps, ctx, s.stillId)
    const p = placeText(spec.textStyle, s.text, frame, faces, draw, s.pos, s.special ? SPECIAL_POS : DEFAULT_POS)
    out.push({ slide: s.index, how: p.how })
    if (p.how !== 'kept') textPos = setAt(textPos, s.index, p.pos, null)
  }
  if (out.some(x => x.how !== 'kept' && x.how !== 'owner')) {
    // Only the words' places change; the rest of the post stays as saved.
    const [now] = await deps.db.select({ spec: contentItems.spec }).from(contentItems).where(eq(contentItems.id, row.id))
    await deps.db.update(contentItems).set({ spec: { ...(now?.spec as object), textPos } }).where(eq(contentItems.id, row.id))
  }
  return out
}
