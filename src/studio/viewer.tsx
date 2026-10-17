import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Expand, FolderOpen, X } from 'lucide-react'
import { api, assetUrl, downloadUrl } from './api'

// The viewer (owner, 2026-10-17; UX-PLAN.md section 34): any still or clip
// full size over the page, one component for the whole Studio (Library
// tabs, the Library drawer in a post, a post's stills and takes, a
// slideshow's slides and its batch review). A still fits the screen; a clip
// plays with its controls, sound off until the owner unmutes it. Arrow keys,
// the arrow buttons or a swipe go to the previous or next item of the list
// it was opened from; Esc, the X or a tap outside the picture closes it and
// puts the focus back where it was. Under the asset: name, date, character,
// model, cost, the posts that use it, Download and the place's own use
// button. Only the open item loads its full file; the ones next to it load
// their small copies.

export interface ViewerItem {
  // A still or a clip of the Library (a candidate id) for its facts, or any
  // other id (then only what the caller knows is shown).
  id: string
  // The candidate to read the facts of, when `id` is not one (a slide).
  infoId?: string | null
  assetId: string
  media: 'image' | 'video'
  name: string
  // A small picture shown at once: the still itself, or a clip's poster.
  thumbId?: string | null
  createdAt?: string | null
  characterName?: string | null
  // A line of the caller's own (a status, a check's verdict).
  note?: ReactNode
}

// Grids ask for this width; the viewer shows it while the full file loads.
export const THUMB_W = 480

export function useViewer() {
  const [openId, setOpenId] = useState<string | null>(null)
  return { openId, open: setOpenId, close: useCallback(() => setOpenId(null), []) }
}

const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file'
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export function Viewer({ items, openId, onOpen, onClose, actions }: {
  items: ViewerItem[]; openId: string | null; onOpen: (id: string) => void; onClose: () => void
  // The place's own buttons for the open item ("Use in a new post", "Use
  // this still"...); `close` closes the viewer first when the button moves on.
  actions?: (item: ViewerItem, close: () => void) => ReactNode
}) {
  const at = openId ? items.findIndex(x => x.id === openId) : -1
  // The item left the list (deleted, or filtered out): the viewer closes.
  useEffect(() => { if (openId && at < 0) onClose() }, [openId, at, onClose])
  if (at < 0) return null
  return createPortal(<ViewerDialog items={items} at={at} onOpen={onOpen} onClose={onClose} actions={actions} />, document.body)
}

function ViewerDialog({ items, at, onOpen, onClose, actions }: { items: ViewerItem[]; at: number; onOpen: (id: string) => void; onClose: () => void; actions?: (item: ViewerItem, close: () => void) => ReactNode }) {
  const item = items[at]!
  const titleId = useId()
  const box = useRef<HTMLDivElement | null>(null)
  const closeBtn = useRef<HTMLButtonElement | null>(null)
  const opener = useRef<Element | null>(null)
  if (opener.current === null) opener.current = document.activeElement
  const go = useCallback((d: -1 | 1) => { const next = items[at + d]; if (next) onOpen(next.id) }, [items, at, onOpen])
  const latest = useRef({ go, onClose })
  latest.current = { go, onClose }

  // Focus moves in on open and back to where it was on close; the page
  // under it does not scroll.
  useEffect(() => {
    closeBtn.current?.focus()
    const was = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const back = opener.current
    return () => {
      document.body.style.overflow = was
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true })
    }
  }, [])

  // Keys, only while this is the top dialog: Esc closes (and nothing under
  // it), the arrows move, Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]')
      if (!box.current || dialogs[dialogs.length - 1] !== box.current) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); latest.current.onClose(); return }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing) { e.preventDefault(); e.stopPropagation(); latest.current.go(e.key === 'ArrowLeft' ? -1 : 1); return }
      if (e.key === 'Tab') {
        const f = [...box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), video[controls], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement)
        if (!f.length) return
        const first = f[0]!, last = f[f.length - 1]!
        const inside = box.current.contains(document.activeElement)
        if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // The ones next to it load their small copies, so the next one shows at once.
  useEffect(() => {
    for (const n of [items[at - 1], items[at + 1]]) {
      const thumb = n ? (n.media === 'image' ? n.assetId : n.thumbId) : null
      if (thumb) { const img = new Image(); img.src = assetUrl(thumb, THUMB_W) }
    }
  }, [items, at])

  // A swipe left or right on a phone.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { const p = e.touches[0]; touch.current = p && e.touches.length === 1 ? { x: p.clientX, y: p.clientY } : null }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current
    touch.current = null
    const p = e.changedTouches[0]
    if (!s || !p) return
    const dx = p.clientX - s.x, dy = p.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
  }

  const infoId = item.infoId ?? item.id
  const facts = useQuery({ queryKey: ['library-item', infoId], queryFn: () => api.libraryItem(infoId), enabled: infoId.startsWith('cand_'), staleTime: 30_000, retry: false })
  const info = facts.data
  const created = info?.createdAt ?? item.createdAt ?? null
  const character = info?.characterName || item.characterName || null
  const outside = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose() }

  return (
    <div className="st-root" style={{ minHeight: 0, background: 'transparent' }}>
      <div ref={box} className="st-viewer" role="dialog" aria-modal="true" aria-labelledby={titleId} data-field="viewer" onClick={outside}>
        <div className="st-viewer-top" onClick={outside}>
          <span className="st-viewer-count" aria-live="polite">{items.length > 1 ? `${at + 1} of ${items.length}` : ''}</span>
          <button ref={closeBtn} type="button" className="st-btn icon st-viewer-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="st-viewer-stage" onClick={outside} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-field="viewer-stage">
          {item.media === 'image' ? <FullImage key={item.id} item={item} /> : <FullVideo key={item.id} item={item} />}
          {at > 0 && <button type="button" className="st-viewer-nav prev" onClick={() => go(-1)} aria-label="Previous"><ChevronLeft size={24} /></button>}
          {at < items.length - 1 && <button type="button" className="st-viewer-nav next" onClick={() => go(1)} aria-label="Next"><ChevronRight size={24} /></button>}
        </div>
        <div className="st-viewer-info" data-field="viewer-info">
          <h2 id={titleId} className="st-h2 st-viewer-name">{item.name}</h2>
          {item.note && <div className="st-hint">{item.note}</div>}
          <dl className="st-viewer-facts">
            {created && <div><dt>Date</dt><dd>{when(created)}</dd></div>}
            {character && <div><dt>Character</dt><dd>{character}</dd></div>}
            {info && <div><dt>Model</dt><dd data-field="viewer-model">{info.model}</dd></div>}
            {info && <div><dt>Cost</dt><dd><span data-field="viewer-cost">{info.cost}</span>{info.costNote && <span className="st-muted"> · {info.costNote}</span>}</dd></div>}
            {info?.width && info.height ? <div><dt>Size</dt><dd>{info.width} x {info.height}{info.durationSec ? ` · ${info.durationSec} s` : ''}</dd></div> : null}
          </dl>
          {info && (
            <div className="st-viewer-used" data-field="viewer-used">
              <span className="st-label">{info.usedIn.length ? `Used in ${info.usedIn.length === 1 ? '1 post' : `${info.usedIn.length} posts`}` : 'Not used in a post yet'}</span>
              {info.usedIn.map(p => <Link key={p.id} className="st-chip" to={`/studio/posts/${p.id}`} onClick={onClose}>{p.name}</Link>)}
            </div>
          )}
          {info && info.collections.length > 0 && (
            <div className="st-viewer-used" data-field="viewer-collections">
              <span className="st-label"><FolderOpen size={13} style={{ verticalAlign: -2 }} /> In</span>
              {info.collections.map(c => <span key={c.id} className="st-chip">{c.name}</span>)}
            </div>
          )}
          {facts.isError && <span className="st-hint">The details did not load. The file itself is fine.</span>}
          <div className="st-viewer-actions">
            <a className="st-btn" href={downloadUrl(item.assetId, fileSlug(item.name))} download data-field="viewer-download"><Download size={15} />Download</a>
            {actions?.(item, onClose)}
          </div>
        </div>
      </div>
    </div>
  )
}

// The small copy at once, the full file over it when it has loaded.
function FullImage({ item }: { item: ViewerItem }) {
  const [loaded, setLoaded] = useState(false)
  const thumb = item.thumbId ?? item.assetId
  return (
    <div className="st-viewer-media">
      {/* Kept in the page once hidden: a swipe that started on it still counts. */}
      <img className={`st-viewer-thumb ${loaded ? 'gone' : ''}`} src={assetUrl(thumb, THUMB_W)} alt="" aria-hidden draggable={false} />
      <img className={`st-viewer-full ${loaded ? 'on' : ''}`} src={assetUrl(item.assetId)} alt={item.name} draggable={false} onLoad={() => setLoaded(true)} data-field="viewer-image" />
    </div>
  )
}

// Sound off to start (the owner can unmute); the controls are the
// browser's own.
function FullVideo({ item }: { item: ViewerItem }) {
  const mute = useCallback((el: HTMLVideoElement | null) => { if (el && !el.dataset.muted) { el.muted = true; el.defaultMuted = true; el.dataset.muted = '1' } }, [])
  return (
    <div className="st-viewer-media">
      <video ref={mute} className="st-viewer-full on" src={assetUrl(item.assetId)} poster={item.thumbId ? assetUrl(item.thumbId, THUMB_W) : undefined}
        controls muted playsInline autoPlay loop preload="auto" aria-label={item.name} data-field="viewer-video" />
    </div>
  )
}

// The view button on a tile whose tap does something else (picking it in a
// post's Library drawer).
export function ViewButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" className="st-tile-view" onClick={e => { e.stopPropagation(); onClick() }} aria-label={`View ${label} full size`} title="View full size"><Expand size={14} /></button>
}
