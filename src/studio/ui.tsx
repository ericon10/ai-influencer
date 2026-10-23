import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, Check, Copy, Loader2, User, X } from 'lucide-react'
import { assetUrl } from './api'
import type { ShotStatus } from './types'

// Small, consistent building blocks. Every visual choice lives in studio.css.

export function Img({ assetId, width, alt = '', contain = false, className = '', style }: { assetId: string | null | undefined; width?: number; alt?: string; contain?: boolean; className?: string; style?: React.CSSProperties }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(false), [assetId])
  if (!assetId) return <div className={`st-img ${className}`} style={style}><div className="st-placeholder"><User size={28} strokeWidth={1.4} /></div></div>
  return (
    <div className={`st-img ${contain ? 'contain' : ''} ${className}`} style={style}>
      {!loaded && <div className="st-skel" />}
      <img src={assetUrl(assetId, width)} alt={alt} loading="lazy" decoding="async" className={loaded ? 'loaded' : ''} onLoad={() => setLoaded(true)} />
    </div>
  )
}

const SHOT_BADGE: Record<ShotStatus, { label: string; tone: string }> = {
  pending: { label: 'Not started', tone: '' },
  generating: { label: 'Generating', tone: 'accent live' },
  in_review: { label: 'Needs review', tone: 'info' },
  approved: { label: 'Approved', tone: 'ok' },
  stale: { label: 'Re-check', tone: 'warn' },
}

export function ShotBadge({ status }: { status: ShotStatus }) {
  const b = SHOT_BADGE[status]
  return <span className={`st-badge ${b.tone}`}>{b.label}</span>
}

const JOB_BADGE: Record<string, { label: string; tone: string }> = {
  waiting: { label: 'Waiting', tone: '' },
  queued: { label: 'Queued', tone: 'info' },
  submitting: { label: 'Sending', tone: 'accent live' },
  running: { label: 'Running', tone: 'accent live' },
  ingesting: { label: 'Saving', tone: 'accent live' },
  completed: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  canceled: { label: 'Canceled', tone: '' },
  needs_attention: { label: 'Needs you', tone: 'warn' },
}

export function JobBadge({ status }: { status: string }) {
  const b = JOB_BADGE[status] ?? { label: status, tone: '' }
  return <span className={`st-badge ${b.tone}`}>{b.label}</span>
}

export function Meter({ value, max, label, sub }: { value: number; max: number; label?: ReactNode; sub?: ReactNode }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : ''
  return (
    <div>
      {(label || sub) && <div className="st-meter-label"><span>{label}</span><span>{sub}</span></div>}
      <div className={`st-meter ${tone}`}><div style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

// `done` overrides the default "every step before the current one is done",
// for example an imported character whose sheet is not in yet.
export function Stepper({ steps, current, done }: { steps: string[]; current: number; done?: boolean[] }) {
  return (
    <div className="st-steps" aria-label="Progress">
      {steps.map((s, i) => {
        const n = i + 1
        const isDone = done ? !!done[i] && n !== current : n < current
        const state = isDone ? 'done' : n === current ? 'current' : ''
        return (
          <span key={s} className={`st-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="dot">{isDone ? <Check size={12} strokeWidth={3} /> : n}</span>{s}
          </span>
        )
      })}
    </div>
  )
}

// Prompts are shown hard-wrapped, never one long line, with one-click copy
// of the exact text sent to the provider (SPEC 5.7 rule 43).
export function PromptViewer({ label, wrapped, text }: { label: string; wrapped: string; text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { /* clipboard blocked */ }
  }
  return (
    <div className="st-prompt">
      <div className="st-prompt-bar">
        <span>{label}</span><span className="st-spacer" />
        <button className="st-btn sm ghost" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre>{wrapped}</pre>
    </div>
  )
}

export function Modal({ open, onClose, children, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="st-root" style={{ minHeight: 0, background: 'transparent' }}>
      <div className="st-overlay" onClick={onClose} />
      <div className={`st-modal ${className}`} role="dialog" aria-modal="true">{children}</div>
    </div>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="st-root" style={{ minHeight: 0, background: 'transparent' }}>
      <div className="st-overlay" onClick={onClose} />
      <aside className={`st-drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="st-drawer-head"><div className="st-h2" style={{ flex: 1 }}>{title}</div><button className="st-btn icon ghost" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="st-drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}

interface Toast { id: number; tone: 'ok' | 'bad' | ''; text: ReactNode; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts(ts => [...ts.slice(-3), { ...t, id }])
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), t.action ? 7000 : 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="st-root" style={{ minHeight: 0, background: 'transparent' }}>
          <div className="st-toasts" role="status" aria-live="polite">
            {toasts.map(t => (
              <div key={t.id} className={`st-toast ${t.tone}`}>
                <span>{t.text}</span>
                {t.action && <button className="st-btn sm" onClick={() => { t.action!.run(); setToasts(ts => ts.filter(x => x.id !== t.id)) }}>{t.action.label}</button>}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function Callout({ tone, icon, children }: { tone: 'info' | 'warn' | 'bad' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  return <div className={`st-callout ${tone}`}>{icon}<div>{children}</div></div>
}

export function MarkChip({ mark }: { mark: { name: string; side: string; region: string; description: string } }) {
  return <span className="st-chip" title={mark.description}>{mark.name}<span className="side">{mark.side}</span>{mark.region}</span>
}

export const STAGES = ['Inspiration', 'Concepts', 'Hero', 'Sheet', 'Character file']

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}

// ── Required fields (owner, 2026-10-13: impossible to miss) ──────────
// A required field carries a bold REQUIRED badge and a colored border until
// it is filled, then a green check. Example text in a field always starts
// with "e.g." and is light and italic, so it never looks filled in.

export function ReqBadge({ done }: { done: boolean }) {
  return done
    ? <span className="st-req-badge done"><Check size={11} strokeWidth={3} />Done</span>
    : <span className="st-req-badge">Required</span>
}

// One labeled field. `id` is what a checklist link scrolls to. `group` is for
// chips and other non-input controls (a div, so a click on the label text
// does not press the first chip).
export function Field({ id, label, required = false, done = false, hint, extra, group = false, className = '', children }: {
  id?: string; label: ReactNode; required?: boolean; done?: boolean; hint?: ReactNode; extra?: ReactNode; group?: boolean; className?: string; children: ReactNode
}) {
  const cls = `st-field ${required ? 'req' : ''} ${required && done ? 'done' : ''} ${className}`
  const inner = (
    <>
      <span className="st-label">{label}{required && <ReqBadge done={done} />}{extra}</span>
      <div className="st-field-body">{children}</div>
      {hint && <span className="st-hint">{hint}</span>}
    </>
  )
  return group ? <div className={cls} data-field={id}>{inner}</div> : <label className={cls} data-field={id}>{inner}</label>
}

// A section header's status: "2 of 3 required done", a green check, or
// "Optional" when nothing in it is required.
export function SectionProgress({ done, total }: { done: number; total: number }) {
  if (!total) return <span className="st-progress optional">Optional</span>
  if (done >= total) return <span className="st-progress done"><Check size={13} strokeWidth={3} />{total === 1 ? 'Done' : 'All required done'}</span>
  return <span className="st-progress">{done} of {total} required done</span>
}

export interface TodoItem {
  label: string
  // The data-field id to scroll to and highlight, or a custom action.
  target?: string
  onGo?: () => void
}

export function scrollToField(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(id)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('st-flash')
  void el.offsetWidth
  el.classList.add('st-flash')
  window.setTimeout(() => el.classList.remove('st-flash'), 1900)
  el.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true })
}

// What still stands between the owner and a button: never a silent gray
// button. Each item scrolls to its field.
export function Todo({ items }: { items: TodoItem[] }) {
  if (!items.length) return null
  return (
    <div className="st-todo" role="status">
      <CircleAlert size={16} />
      <b>{items.length === 1 ? '1 thing left:' : `${items.length} things left:`}</b>
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`}>
          {it.target || it.onGo
            ? <button type="button" className="st-todo-link" onClick={() => (it.onGo ? it.onGo() : scrollToField(it.target!))}>{it.label}</button>
            : <span>{it.label}</span>}
          {i < items.length - 1 ? ',' : ''}
        </span>
      ))}
    </div>
  )
}

// A button that starts work (feedback everywhere): it switches to a working
// state the moment it is pressed and cannot be pressed twice.
export function AsyncButton({ onClick, children, busyLabel = 'Submitting...', className = 'st-btn', disabled = false, title, icon, field }: {
  onClick: () => Promise<unknown> | void; children: ReactNode; busyLabel?: string; className?: string; disabled?: boolean; title?: string; icon?: ReactNode
  // data-field, for the browser tests.
  field?: string
}) {
  const [busy, setBusy] = useState(false)
  async function go() {
    if (busy) return
    setBusy(true)
    try { await onClick() } finally { setBusy(false) }
  }
  return (
    <button type="button" className={className} disabled={disabled || busy} onClick={() => void go()} title={title} aria-busy={busy} data-field={field}>
      {busy ? <Loader2 size={14} className="st-spin" /> : icon}{busy ? busyLabel : children}
    </button>
  )
}

// Made in the last half minute: shown with a short highlight when it arrives.
export const isFresh = (createdAt: string) => Date.now() - Date.parse(createdAt) < 30_000
