import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'

// Select all everywhere there are tick boxes (owner, 2026-10-22; UX-PLAN.md
// section 35, item 2e): a header checkbox that ticks every item the filters
// show (and unticks them), "12 selected" with Clear selection, and a
// shift-click that ticks or unticks the range from the last box clicked.
// `shown` is the list as filtered, in the order it is shown.

export interface Selection {
  picked: Set<string>
  has: (id: string) => boolean
  // Use as the box's onClick (it reads the shift key) or call with no event.
  toggle: (id: string, e?: { shiftKey?: boolean }) => void
  set: (ids: Iterable<string>) => void
  clear: () => void
  allShown: boolean
  someShown: boolean
  toggleShown: () => void
}

export function useSelection(shown: string[]): Selection {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const last = useRef<string | null>(null)
  const toggle = useCallback((id: string, e?: { shiftKey?: boolean }) => {
    // Read before the update runs: React may run it after last moves on.
    const a = last.current ? shown.indexOf(last.current) : -1
    const b = shown.indexOf(id)
    setPicked(prev => {
      const next = new Set(prev)
      const on = !prev.has(id)
      if (e?.shiftKey && a >= 0 && b >= 0) {
        for (const x of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) { if (on) next.add(x); else next.delete(x) }
      } else if (on) next.add(id)
      else next.delete(id)
      return next
    })
    last.current = id
  }, [shown])
  const inShown = shown.filter(id => picked.has(id)).length
  const allShown = shown.length > 0 && inShown === shown.length
  return {
    picked,
    has: id => picked.has(id),
    toggle,
    set: ids => setPicked(new Set(ids)),
    clear: () => { setPicked(new Set()); last.current = null },
    allShown,
    someShown: inShown > 0 && !allShown,
    toggleShown: () => setPicked(prev => {
      const next = new Set(prev)
      if (allShown) for (const id of shown) next.delete(id)
      else for (const id of shown) next.add(id)
      return next
    }),
  }
}

// The header checkbox: ticks every item shown; half-ticked when some are.
export function SelectAllBox({ sel, label = 'Select all shown', disabled }: { sel: Selection; label?: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = sel.someShown }, [sel.someShown])
  return <input ref={ref} type="checkbox" checked={sel.allShown} disabled={disabled} onChange={sel.toggleShown} aria-label={label} data-field="select-all" />
}

// A row's box: a click ticks it, a shift-click ticks the range.
export function SelectBox({ sel, id, label, disabled }: { sel: Selection; id: string; label: string; disabled?: boolean }) {
  return (
    <input type="checkbox" checked={sel.has(id)} disabled={disabled} aria-label={label}
      onChange={() => undefined} onClick={(e: MouseEvent<HTMLInputElement>) => sel.toggle(id, e)} />
  )
}

// "12 selected · Clear selection".
export function SelectionCount({ sel, noun = 'selected' }: { sel: Selection; noun?: string }) {
  if (!sel.picked.size) return null
  return (
    <span className="st-row" style={{ gap: 6, alignItems: 'center' }} data-field="selection-count">
      <b className="st-hint" style={{ color: 'inherit' }}>{sel.picked.size} {noun}</b>
      <button type="button" className="st-btn xs ghost" onClick={sel.clear}>Clear selection</button>
    </span>
  )
}
