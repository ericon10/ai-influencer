import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, AudioLines, CheckSquare, File, Loader2, RotateCcw, Square, Star, Trash2, X } from 'lucide-react'
import { api, assetUrl } from './api'
import { keys } from './hooks'
import { Callout, Drawer, Img, Modal, errorMessage, useToast } from './ui'
import { HowTo } from './guide/Guide'
import type { AutoCleanItem, TrashItem, TrashRef } from './types'
import type { GuideId } from './guide/content'
import { Viewer, useViewer } from './viewer'

// Delete, Select and the Trash (owner, 2026-10-15; UX-PLAN.md section 22).
// Deleting moves an item to the Trash for 7 days, restorable; then the daily
// clean removes its files from storage for good, thumbnails included. An
// item that a post uses, or a character's sheet ref, asks first.

export interface Deletable extends TrashRef { label: string }
type Warning = { id: string; kind: TrashRef['kind']; text: string }

const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  for (const key of [['library'], keys.content, keys.characters, ['plan'], ['sounds'], ['trash'], ['scenes'], ['clones'], ['character'], ['voice-lines'], ['auto-clean-preview']]) void qc.invalidateQueries({ queryKey: key })
}

export function useDelete() {
  const qc = useQueryClient()
  const toast = useToast()
  const [pending, setPending] = useState<{ items: Deletable[]; warnings: Warning[]; done?: () => void } | null>(null)
  const [busy, setBusy] = useState(false)
  async function move(items: Deletable[], done?: () => void) {
    setBusy(true)
    try {
      const { moved, ids } = await api.trash(items.map(({ kind, id }) => ({ kind, id })))
      setPending(null)
      done?.()
      refresh(qc)
      toast({
        tone: 'ok',
        text: moved === 1 ? `Moved "${items[0]!.label}" to the Trash. It stays there 7 days.` : `Moved ${moved} items to the Trash. They stay there 7 days.`,
        action: ids.length ? { label: 'Undo', run: () => void api.restore(ids).then(() => refresh(qc)).catch(e => toast({ tone: 'bad', text: errorMessage(e) })) } : undefined,
      })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  // Nothing to warn about: straight to the Trash, with Undo. Otherwise ask.
  async function ask(items: Deletable[], done?: () => void) {
    if (!items.length || busy) return
    setBusy(true)
    let warnings: Warning[] = []
    try { warnings = (await api.trashCheck(items.map(({ kind, id }) => ({ kind, id })))).warnings } catch (e) { setBusy(false); toast({ tone: 'bad', text: errorMessage(e) }); return }
    setBusy(false)
    if (!warnings.length) return move(items, done)
    setPending({ items, warnings, done })
  }
  const label = (id: string) => pending?.items.find(i => i.id === id)?.label ?? 'This item'
  const dialog = (
    <Modal open={!!pending} onClose={() => !busy && setPending(null)}>
      {pending && (
        <div className="st-col" style={{ gap: 14, padding: 22, maxWidth: 520 }} data-field="trash-warn">
          <div className="st-row" style={{ gap: 10 }}><AlertTriangle size={18} style={{ color: 'var(--st-warn)' }} /><div className="st-h3 grow">{pending.items.length === 1 ? `Delete "${pending.items[0]!.label}"?` : `Delete ${pending.items.length} items?`}</div></div>
          <ul className="st-col st-trash-warnings" style={{ gap: 8 }}>
            {pending.warnings.map((w, i) => <li key={i}><b>{label(w.id)}</b>: {w.text}</li>)}
          </ul>
          <span className="st-hint">It goes to the Trash first: nothing changes for 7 days, and Restore puts it back. After that its files are removed from storage for good.</span>
          <div className="st-row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="st-btn ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
            <button type="button" className="st-btn bad" disabled={busy} onClick={() => void move(pending.items, pending.done)}>{busy ? <Loader2 size={15} className="st-spin" /> : <Trash2 size={15} />}Move to the Trash anyway</button>
          </div>
        </div>
      )}
    </Modal>
  )
  return { ask, dialog, busy }
}

// Select many: a Select button turns the grid's tiles into checkboxes; the
// bar below counts them, selects all, and deletes (or restores) them.
// A shift-click ticks or unticks the range from the last tile clicked, in
// the order the bar's list shows them (owner, 2026-10-22).
export function useSelection<T extends { id: string }>() {
  const [on, setOn] = useState(false)
  const [picked, setPicked] = useState<Map<string, T>>(new Map())
  const order = useRef<T[]>([])
  const last = useRef<string | null>(null)
  return {
    on,
    order,
    start: () => setOn(true),
    stop: () => { setOn(false); setPicked(new Map()); last.current = null },
    has: (id: string) => picked.has(id),
    toggle: (item: T, e?: { shiftKey?: boolean }) => {
      const list = order.current
      const a = last.current ? list.findIndex(x => x.id === last.current) : -1
      const b = list.findIndex(x => x.id === item.id)
      setPicked(m => {
        const n = new Map(m)
        const add = !n.has(item.id)
        const range = e?.shiftKey && a >= 0 && b >= 0 ? list.slice(Math.min(a, b), Math.max(a, b) + 1) : [item]
        for (const x of range) { if (add) n.set(x.id, x); else n.delete(x.id) }
        return n
      })
      last.current = item.id
    },
    setAll: (items: T[]) => setPicked(new Map(items.map(i => [i.id, i]))),
    clear: () => setPicked(new Map()),
    items: [...picked.values()],
  }
}
export type Selection<T extends { id: string }> = ReturnType<typeof useSelection<T>>

export function SelectToggle({ sel, disabled = false }: { sel: { on: boolean; start: () => void; stop: () => void }; disabled?: boolean }) {
  return sel.on
    ? <button type="button" className="st-btn sm ghost" onClick={sel.stop}><X size={14} />Done selecting</button>
    : <button type="button" className="st-btn sm" disabled={disabled} onClick={sel.start} data-field="library-select"><CheckSquare size={14} />Select</button>
}

export function SelectBar<T extends { id: string }>({ sel, all, children, help = 'library' }: { sel: Selection<T>; all: T[]; children: ReactNode; help?: GuideId }) {
  sel.order.current = all
  if (!sel.on) return null
  return (
    <div className="st-selectbar" role="toolbar" aria-label="Selected items" data-field="library-selectbar">
      <SelectAll sel={sel} all={all} />
      <b>{sel.items.length} selected</b>
      {sel.items.length > 0 && <button type="button" className="st-btn sm ghost" onClick={sel.clear}>Clear selection</button>}
      <span className="st-spacer" />
      {children}
      <button type="button" className="st-btn sm ghost" onClick={sel.stop}>Cancel</button>
      <HowTo id={help} label="About Select" />
    </div>
  )
}

// Select all (owner, 2026-10-22): one checkbox ticks every item the filters
// show, or unticks them; half-ticked when some are.
export function SelectAll<T extends { id: string }>({ sel, all }: { sel: Selection<T>; all: T[] }) {
  const ref = useRef<HTMLInputElement>(null)
  const n = all.filter(x => sel.has(x.id)).length
  const every = all.length > 0 && n === all.length
  useEffect(() => { if (ref.current) ref.current.indeterminate = n > 0 && !every }, [n, every])
  return (
    <label className="st-row" style={{ gap: 6, cursor: 'pointer' }}>
      <input ref={ref} type="checkbox" checked={every} disabled={!all.length} data-field="select-all"
        onChange={() => (every ? sel.setAll(sel.items.filter(x => !all.some(a => a.id === x.id))) : sel.setAll([...sel.items, ...all.filter(x => !sel.has(x.id))]))} />
      Select all {all.length}
    </label>
  )
}

// The checkbox on a tile in Select mode; the tile itself toggles it.
export function TileCheck({ on }: { on: boolean }) {
  return <span className={`st-check ${on ? 'on' : ''}`} aria-hidden>{on ? <CheckSquare size={14} /> : <Square size={14} />}</span>
}

export function DeleteButton({ onClick, label, text = false, disabled = false }: { onClick: () => void; label: string; text?: boolean; disabled?: boolean }) {
  return text
    ? <button type="button" className="st-btn sm ghost" disabled={disabled} onClick={onClick} aria-label={`Delete ${label}`}><Trash2 size={13} />Delete</button>
    : <button type="button" className="st-btn sm ghost icon" disabled={disabled} onClick={onClick} aria-label={`Delete ${label}`} title="Delete: it goes to the Trash for 7 days"><Trash2 size={14} /></button>
}

// A star on a take (owner, 2026-10-15): starred takes are never auto-cleaned.
export function StarButton({ id, on, size = 'sm' }: { id: string; on: boolean; size?: 'sm' | 'xs' }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [value, setValue] = useState(on)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setValue(on) }, [on])
  return (
    <button type="button" className={`st-btn ${size} ghost icon st-star ${value ? 'on' : ''}`} aria-pressed={value} aria-label={value ? 'Starred: never auto-cleaned' : 'Star: never auto-clean this take'} title={value ? 'Starred: never auto-cleaned. Press to unstar.' : 'Star it: Auto-clean never moves a starred take to the Trash.'} disabled={busy}
      onClick={async e => {
        e.stopPropagation()
        const next = !value
        setValue(next); setBusy(true)
        try { await api.favorite(id, next); refresh(qc) } catch (err) { setValue(!next); toast({ tone: 'bad', text: errorMessage(err) }) } finally { setBusy(false) }
      }}><Star size={14} fill={value ? 'currentColor' : 'none'} /></button>
  )
}

// Library > Trash: what was deleted, by you or by Auto-clean, with the days
// left before it is removed for good. Restore one or many.
const viewable = (t: TrashItem) => !!t.assetId && (t.media === 'image' || t.media === 'video')

export function TrashTab({ characterId }: { characterId: string | null }) {
  const view = useViewer()
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['trash'], queryFn: api.trashList })
  const sel = useSelection<TrashItem>()
  const [busy, setBusy] = useState(false)
  const list = (q.data?.items ?? []).filter(t => !characterId || t.characterId === characterId)
  async function restore(items: TrashItem[]) {
    setBusy(true)
    try {
      const { restored } = await api.restore(items.map(i => i.id))
      sel.stop()
      refresh(qc)
      toast({ tone: 'ok', text: restored === 1 ? `Restored "${items[0]!.label}".` : `Restored ${restored} items.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <div className="st-col" style={{ gap: 16 }} data-field="library-trash">
      <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <span className="st-hint grow">Deleted items wait here {q.data?.days ?? 7} days. Restore puts one back where it was. After that the daily clean removes its files from storage for good, thumbnails included. Auto-clean moves takes you never kept here too (Settings, Storage).</span>
        <SelectToggle sel={sel} disabled={!list.length} />
        <HowTo id="library" label="About the Trash" />
      </div>
      {!q.data ? <div className="st-skel" style={{ height: 200, borderRadius: 18 }} />
        : !list.length ? <Callout tone="info">The Trash is empty.</Callout>
        : (
          <div className="st-grid scenes">
            {list.map(t => {
              const on = sel.has(t.id)
              const media = (
                <>
                  {t.media === 'image' && t.assetId ? <Img assetId={t.assetId} width={320} style={{ aspectRatio: '9 / 16' }} />
                    : t.media === 'video' && t.assetId ? <video className="st-clip" src={`${assetUrl(t.assetId)}#t=0.1`} muted playsInline preload="metadata" style={{ aspectRatio: '9 / 16' }} />
                    : <div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}>{t.media === 'audio' ? <AudioLines size={20} /> : <File size={20} />}</div>}
                  {sel.on && <TileCheck on={on} />}
                  <span className={`st-badge ${t.daysLeft <= 1 ? 'bad' : 'warn'}`}>{t.daysLeft <= 0 ? 'Removed today' : t.daysLeft === 1 ? '1 day left' : `${t.daysLeft} days left`}</span>
                </>
              )
              return (
                <div key={t.id} className={`st-tile st-scene-tile ${on ? 'picked' : ''}`}>
                  {/* A tap opens it full size (the viewer, item 27); Select picks instead. */}
                  {sel.on ? <button type="button" className="st-tile-open" aria-pressed={on} aria-label={`Select ${t.label}`} onClick={e => sel.toggle(t, e)}>{media}</button>
                    : viewable(t) ? <button type="button" className="st-tile-open" aria-label={`View ${t.label} full size`} onClick={() => view.open(t.id)}>{media}</button>
                    : <div className="st-tile-open">{media}</div>}
                  <div className="st-col" style={{ gap: 2, padding: '0 4px 2px' }}>
                    <span className="st-tile-label">{t.label}</span>
                    <span className="st-hint">{t.reason === 'auto' ? 'Auto-clean' : 'Deleted by you'} · {new Date(t.deletedAt).toLocaleDateString()}</span>
                  </div>
                  {!sel.on && <div className="st-tile-action"><button type="button" className="st-btn sm" disabled={busy} onClick={() => void restore([t])}><RotateCcw size={13} />Restore</button></div>}
                </div>
              )
            })}
          </div>
        )}
      <SelectBar sel={sel} all={list}>
        <button type="button" className="st-btn sm primary" disabled={busy || !sel.items.length} onClick={() => void restore(sel.items)}><RotateCcw size={13} />Restore {sel.items.length || ''}</button>
      </SelectBar>
      <Viewer items={list.filter(viewable).map(t => ({ id: t.id, assetId: t.assetId!, media: t.media as 'image' | 'video', name: t.label, thumbId: t.media === 'image' ? t.assetId : null, createdAt: t.deletedAt }))}
        openId={view.openId} onOpen={view.open} onClose={view.close}
        actions={(x, close) => <button type="button" className="st-btn" disabled={busy} onClick={() => { const t = list.find(y => y.id === x.id); if (t) { close(); void restore([t]) } }}><RotateCcw size={15} />Restore</button>} />
    </div>
  )
}

// The next Auto-clean, before it runs (owner, 2026-10-15): every item it
// would move to the Trash, with a star to keep one. The first Auto-clean
// waits for Start Auto-clean here.
export function AutoCleanPreview({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const toast = useToast()
  const q = useQuery({ queryKey: ['auto-clean-preview'], queryFn: api.autoCleanPreview, enabled: open })
  const [busy, setBusy] = useState(false)
  const d = q.data
  const items = d?.items ?? []
  async function start() {
    setBusy(true)
    try {
      await api.startAutoClean()
      toast({ tone: 'ok', text: 'Auto-clean is on. From the next daily clean, items like these go to the Trash, where they wait 7 days.' })
      onStarted()
      onClose()
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Drawer open={open} onClose={onClose} wide title={<span>Next auto-clean <span className="st-muted">{d ? `${items.length} item${items.length === 1 ? '' : 's'}` : ''}</span></span>}>
      <div className="st-col" style={{ gap: 14 }} data-field="auto-clean-preview">
        {!d ? <div className="st-skel" style={{ height: 200, borderRadius: 18 }} /> : (
          <>
            <span className="st-hint">{d.days ? `Only takes you never kept and stills you never picked, from posts finished more than ${d.days} days ago. They go to the Trash, where they wait 7 days and can be restored. Star one to keep it.` : 'Auto-clean is Off: nothing moves. Pick a number of days to turn it on.'}</span>
            <details className="st-autoclean-never">
              <summary>Never touched, whatever their age</summary>
              <ul>
                <li>Sheet refs (REF-00 to REF-11), heroes and anything in a character file</li>
                <li>A take you kept (Keep this take or Use this take) or starred</li>
                <li>Anything a post uses: live, posted, exported or archived, its render and its saved editor timeline</li>
                <li>The stills, start and end frames a kept take was made from</li>
                <li>Saved clips and images in the Library (uploads, kept clips, kept clones)</li>
              </ul>
            </details>
            <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {!d.started && !!d.days && <button type="button" className="st-btn primary" disabled={busy} onClick={() => void start()}>{busy ? <Loader2 size={15} className="st-spin" /> : <CheckSquare size={15} />}Start Auto-clean</button>}
              <span className="st-hint">{d.started ? 'Auto-clean is on: it runs with the daily clean, once a day.' : 'Auto-clean has not run yet. It waits until you press Start Auto-clean.'}</span>
              <span className="st-spacer" />
              <HowTo id="settings" label="About Auto-clean" />
            </div>
            {!items.length ? <Callout tone="info">Nothing to clean right now.</Callout> : (
              <div className="st-grid scenes">
                {items.map(x => <PreviewTile key={x.id} x={x} />)}
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  )
}

function PreviewTile({ x }: { x: AutoCleanItem }) {
  return (
    <div className="st-tile st-scene-tile">
      <div className="st-tile-open">
        {x.media === 'image' ? <Img assetId={x.assetId} width={320} style={{ aspectRatio: '9 / 16' }} />
          : x.assetId ? <video className="st-clip" src={`${assetUrl(x.assetId)}#t=0.1`} muted playsInline preload="metadata" style={{ aspectRatio: '9 / 16' }} />
          : <div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}><File size={18} /></div>}
        <span className="st-badge plain">{x.kind === 'take' ? 'Take never kept' : 'Still never picked'}</span>
      </div>
      <div className="st-tile-meta">
        <div className="st-col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
          <span className="st-tile-label">{x.postName}</span>
          <span className="st-hint">Finished {new Date(x.finishedAt).toLocaleDateString()}</span>
        </div>
        <StarButton id={x.id} on={false} />
      </div>
    </div>
  )
}

