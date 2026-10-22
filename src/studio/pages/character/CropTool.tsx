import { useRef, useState } from 'react'
import { Crop, Loader2 } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { Modal, errorMessage, useToast } from '../../ui'

// A closer shot is a crop of the wide still (Callie's scene rules): drag the
// frame, size it with the slider. The frame keeps the scene's aspect so the
// crop is ready to post. Free; no provider call.

interface Rect { x: number; y: number; w: number; h: number }

export function CropTool({ assetId, candidateId, aspect, onClose, onCropped }: { assetId: string; candidateId: string; aspect: string; onClose: () => void; onCropped: (id: string) => void }) {
  const toast = useToast()
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [busy, setBusy] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const [aw, ah] = aspect.split(':').map(Number) as [number, number]
  const ratio = aw / ah

  // Height as a share of the image for a given width share, keeping the aspect.
  const heightFor = (w: number, img: { w: number; h: number }) => (w * img.w) / ratio / img.h
  function sized(w: number, img = size!, around?: Rect): Rect {
    let width = w
    let height = heightFor(width, img)
    if (height > 1) { height = 1; width = (ratio * img.h) / img.w }
    const cx = around ? around.x + around.w / 2 : 0.5
    const cy = around ? around.y + around.h / 2 : 0.4
    return clamp({ x: cx - width / 2, y: cy - height / 2, w: width, h: height })
  }
  const clamp = (r: Rect): Rect => ({ ...r, x: Math.min(1 - r.w, Math.max(0, r.x)), y: Math.min(1 - r.h, Math.max(0, r.y)) })

  function onLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }
    setSize(img)
    setRect(sized(0.55, img))
  }
  async function save() {
    if (!rect) return
    setBusy(true)
    try {
      const out = await api.crop(candidateId, rect)
      toast({ tone: 'ok', text: `Cropped to ${out.width} x ${out.height} px. Upscale it 2x for full detail.` })
      onCropped(out.candidateId)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  const maxWidth = size ? Math.min(1, (ratio * size.h) / size.w) : 1
  return (
    <Modal open onClose={onClose} className="st-crop">
      <div className="st-col" style={{ gap: 14 }}>
        <div className="st-row"><Crop size={16} /><div className="st-h2">Crop closer</div><span className="st-spacer" /><span className="st-badge plain">{aspect}</span></div>
        <div
          ref={stage}
          className="st-crop-stage"
          onPointerMove={e => {
            if (!drag.current || !rect || !stage.current) return
            const box = stage.current.getBoundingClientRect()
            setRect(clamp({ ...rect, x: drag.current.x + (e.clientX - drag.current.px) / box.width, y: drag.current.y + (e.clientY - drag.current.py) / box.height }))
          }}
          onPointerUp={() => { drag.current = null }}
          onPointerLeave={() => { drag.current = null }}
        >
          <img src={assetUrl(assetId)} alt="Still to crop" onLoad={onLoad} draggable={false} />
          {rect && (
            <div
              className="st-crop-frame"
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
              onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y } }}
            />
          )}
        </div>
        {rect && size && (
          <label className="st-field">
            <span className="st-label">Size of the crop</span>
            <input type="range" min={0.2} max={maxWidth} step={0.01} value={rect.w} onChange={e => setRect(sized(Number(e.target.value), size, rect))} />
            <span className="st-hint">{Math.round(rect.w * size.w)} x {Math.round(rect.h * size.h)} px. Drag the frame to move it.</span>
          </label>
        )}
        <div className="st-row">
          <button className="st-btn ghost" onClick={onClose}>Cancel</button>
          <span className="st-spacer" />
          <button className="st-btn primary" disabled={!rect || busy} onClick={save}>{busy ? <Loader2 size={16} className="st-spin" /> : <Crop size={16} />}Crop (free)</button>
        </div>
      </div>
    </Modal>
  )
}
