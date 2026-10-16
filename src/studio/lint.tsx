import { useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import { lintCopy, type LintHit, type LintKind } from '../../server/core/copyLint'
import { useContent } from './hooks'

// The language lint as you type (UX-PLAN.md section 28): the same checks as
// the server, with the account's word lists and the checks switched off for
// this character (Settings > Rules). Free; warnings only, never a block.

export type Lint = (text: string, kind: LintKind, o?: { product?: boolean; hashtags?: string[]; last?: boolean }) => LintHit[]

export function useLint(characterId?: string | null): Lint {
  const lint = useContent().data?.options.lint
  return useCallback<Lint>((text, kind, o = {}) => {
    if (!lint) return lintCopy(text, { kind, ...o })
    const off = [...lint.off, ...((characterId && lint.offFor[characterId]) || [])]
    return lintCopy(text, { kind, lists: lint.lists, off, ...o })
  }, [lint, characterId])
}

// One small amber line per warning, under the field it is about.
export function LintNote({ hits, compact = false, field }: { hits: LintHit[]; compact?: boolean; field?: string }) {
  if (!hits.length) return null
  if (compact) {
    return <span className="st-lint compact" data-field={field ?? 'lint'} title={hits.map(h => h.message).join('\n')}><AlertTriangle size={11} />{hits.length === 1 ? hits[0]!.match : `${hits.length} language notes`}</span>
  }
  return (
    <div className="st-lint" data-field={field ?? 'lint'} role="note">
      {hits.map(h => <span key={h.rule}><AlertTriangle size={11} />{h.message}</span>)}
    </div>
  )
}
