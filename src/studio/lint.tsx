import { useCallback, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { lintCopy, type LintHit, type LintKind } from '../../server/core/copyLint'
import { useContent } from './hooks'

// The language lint as you type (UX-PLAN.md section 28): the same checks as
// the server, with the account's word lists and the checks switched off for
// this character (Settings > Rules). Free; warnings only, never a block.
// The em and en dash check runs on every post; the rest only when the
// post's product adds them (SideStep's rules; section 29), with the post's
// own product as the name never in a hook.

export type Lint = (text: string, kind: LintKind, o?: { product?: boolean; hashtags?: string[]; last?: boolean }) => LintHit[]

export function useLint(characterId?: string | null, productId?: string | null): Lint {
  const data = useContent().data
  const lint = data?.options.lint
  const product = (productId && data?.products.find(p => p.id === productId)) || null
  const standard = !!product?.lint
  const name = product?.name ?? ''
  return useCallback<Lint>((text, kind, o = {}) => {
    if (!lint) return lintCopy(text, { kind, standard: false, ...o })
    const off = [...lint.off, ...((characterId && lint.offFor[characterId]) || [])]
    return lintCopy(text, { kind, lists: { ...lint.lists, products: name ? [name] : [] }, off, standard, ...o })
  }, [lint, characterId, standard, name])
}

// Whether the post's product adds the language notes and the stop test
// (SideStep's rules), for the hints that only make sense there.
export function useProductRules(productId?: string | null): { lint: boolean; review: boolean; name: string } {
  const list = useContent().data?.products
  const p = (productId && list?.find(x => x.id === productId)) || null
  return { lint: !!p?.lint, review: !!p?.review, name: p?.name ?? '' }
}

// A notes badge that opens its list on a tap (owner, 2026-10-22, item 17:
// a hover title never shows on a phone). Tap again to close.
export function NotesBadge({ notes, label, field }: { notes: string[]; label?: string; field?: string }) {
  const [open, setOpen] = useState(false)
  if (!notes.length) return null
  return (
    <span className="st-notes" data-field={field ?? 'notes'}>
      <button type="button" className="st-lint compact" aria-expanded={open} title={notes.join('\n')} onClick={e => { e.stopPropagation(); setOpen(o => !o) }}>
        <AlertTriangle size={11} />{label ?? `${notes.length} note${notes.length === 1 ? '' : 's'}`}
      </button>
      {open && <span className="st-lint st-notes-list" role="note">{notes.map((n, i) => <span key={i}>{n}</span>)}</span>}
    </span>
  )
}

// One small amber line per warning, under the field it is about.
export function LintNote({ hits, compact = false, field }: { hits: LintHit[]; compact?: boolean; field?: string }) {
  if (!hits.length) return null
  if (compact) return <NotesBadge notes={hits.map(h => h.message)} label={hits.length === 1 ? hits[0]!.match : `${hits.length} language notes`} field={field ?? 'lint'} />
  return (
    <div className="st-lint" data-field={field ?? 'lint'} role="note">
      {hits.map(h => <span key={h.rule}><AlertTriangle size={11} />{h.message}</span>)}
    </div>
  )
}
