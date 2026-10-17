import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { assetUrl } from '../../../api'
import { slideOverlaySvg, specialOwnBackground, SAFE } from '../../../../../server/core/slideSvg'
import { cleanSpecial, type Slide, type SlidePos, type TextStyleId } from '../../../../../server/core/slides'
import { browserDraw } from './draw'
import type { ViewerItem } from '../../../viewer'

// One slide as it will be exported (UX-PLAN.md section 27): the picture,
// a special slide over it, the words in the post's text style at their
// place, Ad on slide 1 of an ad. The safe zones (the apps' top bar and
// the caption and buttons) shade the top 10% and bottom 20%. With onMove,
// the words can be dragged; they stay inside the safe area.

export const FRAMES = { tiktok: { width: 1080, height: 1920 }, instagram: { width: 1080, height: 1440 } } as const
export type FrameId = keyof typeof FRAMES

export function SlideFrame({ slide, assetId, style, ad, width, frame = 'tiktok', safe = false, onMove, brands, label }: {
  slide: Slide; assetId: string | null | undefined; style: TextStyleId; ad: boolean; width: number; frame?: FrameId
  safe?: boolean; onMove?: (pos: SlidePos) => void; brands?: { names: string[]; generic: string[] }; label?: string
}) {
  const f = FRAMES[frame]
  const k = width / f.width
  const box = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ pos: SlidePos; dx: number; dy: number } | null>(null)
  const special = useMemo(() => (slide.special && brands ? cleanSpecial(slide.special, brands.names, brands.generic) : slide.special), [slide.special, brands])
  const pos = drag?.pos ?? slide.pos
  const shotHref = special?.type === 'product_shot' && special.assetId ? assetUrl(special.assetId, width > 300 ? 960 : 480) : null
  const { svg, layout } = useMemo(() => slideOverlaySvg({ style, text: slide.text, pos, special, ad, shotHref }, f, browserDraw), [style, slide.text, pos, special, ad, f, shotHref])
  const own = special ? specialOwnBackground(special.type) : false

  const at = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (!onMove || !layout) return
    const p = at(e)
    const b = layout.block
    const inside = p.x * f.width >= b.x && p.x * f.width <= b.x + b.w && p.y * f.height >= b.y && p.y * f.height <= b.y + b.h
    const dx = inside ? p.x - layout.pos.x : 0, dy = inside ? p.y - layout.pos.y : 0
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ pos: { x: p.x - dx, y: p.y - dy }, dx, dy })
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return
    const p = at(e)
    setDrag({ ...drag, pos: { x: clamp(p.x - drag.dx), y: clamp(p.y - drag.dy) } })
  }
  function up() {
    if (!drag) return
    // The clamped place (inside the safe area) is what is kept.
    const kept = layout?.pos ?? drag.pos
    setDrag(null)
    onMove?.({ x: Math.round(kept.x * 1000) / 1000, y: Math.round(kept.y * 1000) / 1000 })
  }
  // Keyboard: arrows nudge the words.
  function key(e: React.KeyboardEvent) {
    if (!onMove || !layout) return
    const step = e.shiftKey ? 0.05 : 0.01
    const d = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key]
    if (!d) return
    e.preventDefault()
    onMove({ x: clamp(layout.pos.x + d[0]!), y: clamp(layout.pos.y + d[1]!) })
  }

  return (
    <div ref={box} className={`st-slideframe ${onMove ? 'movable' : ''} ${drag ? 'dragging' : ''}`} style={{ width, height: width * f.height / f.width }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      tabIndex={onMove ? 0 : undefined} onKeyDown={key} role={onMove ? 'application' : undefined}
      aria-label={label ?? (onMove ? `Slide ${slide.index + 1}: drag the words to move them, or use the arrow keys` : `Slide ${slide.index + 1}`)} data-field={`slide-frame-${slide.index}`}>
      {!own && assetId && <img src={assetUrl(assetId, width > 300 ? 960 : 480)} alt="" draggable={false} style={special ? { filter: `blur(${Math.max(2, 28 * k)}px) brightness(0.8)`, transform: 'scale(1.06)' } : undefined} />}
      {!own && !assetId && (special ? <div className="st-slideframe-plain" /> : <div className="st-slideframe-empty">No picture yet</div>)}
      <div className="st-slideframe-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      {safe && (
        <>
          <div className="st-safe top" style={{ height: `${SAFE.top * 100}%` }}><span>App top bar</span></div>
          <div className="st-safe bottom" style={{ height: `${SAFE.bottom * 100}%` }}><span>Caption and buttons</span></div>
        </>
      )}
      <span className="st-slideframe-n">{slide.index + 1}</span>
    </div>
  )
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

// The slides with a photo, for the viewer (UX-PLAN.md section 34): each
// opens its photo full size; drawn slides are left out.
export function slideViewerItems(list: Slide[], assetOf: (stillId: string) => string | null | undefined): ViewerItem[] {
  return list.flatMap(s => {
    const assetId = !s.special && s.stillId ? assetOf(s.stillId) : null
    return assetId ? [{ id: `slide-${s.index}`, infoId: s.stillId, assetId, media: 'image' as const, name: `Slide ${s.index + 1}${s.text ? `: ${s.text.length > 60 ? `${s.text.slice(0, 60)}...` : s.text}` : ''}`, thumbId: assetId }] : []
  })
}
