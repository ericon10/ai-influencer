import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { api } from '../../api'
import type { BatchSpec, EditorStyle } from '../../types'
import type { PostCtx } from './ctx'

// A batch's style (editor phase D, UX-PLAN section 12): one of the styles
// saved in the editor's Styles card. Every video gets its presets at its
// own payoff, cuts and beats, rendered on the worker. None keeps the
// batch's Format (Idea step) as before.

const anchorWords = (a: EditorStyle['items'][number]['at']) =>
  a.on === 'payoff' ? 'at the payoff' : a.on === 'cut' ? `on cut ${a.index + 1}` : a.on === 'beat' ? `on beat ${a.index + 1}` : a.on === 'end' ? `${a.offset.toFixed(1)} s from the end` : `at ${a.offset.toFixed(1)} s`
const summary = (s: { items: EditorStyle['items'] }) => s.items.map(i => `${i.preset.replace(/_/g, ' ')} ${anchorWords(i.at)}`).join(', ')

export function BatchStyle({ ctx }: { ctx: PostCtx }) {
  const { draft } = ctx
  const spec = draft.spec as unknown as BatchSpec
  const styles = useQuery({ queryKey: ['editor-styles'], queryFn: api.editorStyles, staleTime: 30_000 })
  const list = styles.data?.styles ?? []
  const current = spec.stack?.length ? spec.styleName ?? 'A style' : null
  const pick = (s: EditorStyle | null) => draft.setSpec({ stack: s ? s.items : null, styleName: s ? s.name : null } as never)
  return (
    <section className="st-card" data-field="batch-style">
      <div className="st-card-head"><Sparkles size={16} /><div className="grow"><div className="st-h3">Style</div><div className="st-hint">A style saved in the editor (its Styles card). Each video gets its presets at its own payoff, cuts and beats. Free, on the worker.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 10 }}>
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`st-chip ${!current ? 'on' : ''}`} onClick={() => pick(null)}>None</button>
          {list.map(s => <button key={s.id} type="button" className={`st-chip ${current === s.name ? 'on' : ''}`} title={summary(s)} onClick={() => pick(s)}>{s.name}</button>)}
          {styles.isLoading && <span className="st-hint">Loading your styles...</span>}
        </div>
        {current && spec.stack && <span className="st-hint">{current}: {summary({ items: spec.stack })}.</span>}
        {!styles.isLoading && !list.length && <span className="st-hint">No saved styles yet. Open a video post in the editor, place presets, and press Save as a style in its Styles card.</span>}
        {styles.isError && <span className="st-hint st-warntext">Your styles could not be loaded. Reload the page to try again.</span>}
      </div>
    </section>
  )
}
