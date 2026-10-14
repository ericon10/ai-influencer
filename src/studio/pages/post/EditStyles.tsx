import { Check, Film, Sparkles } from 'lucide-react'
import type { EditSpec, EditStrength, EditStyleView } from '../../types'
import type { PostCtx } from './ctx'
export { editZones, type EditZones } from './editZones'

// Amazing Edits (Phase 5; UX-PLAN.md section 10): edits made by code on the
// worker, free, never by a video model. The Idea step's Format and the
// Finish step's Edit style set the same field; Fine-tune changes it too.

export const EDIT_DEFAULT: EditSpec = { style: 'none', strength: 'normal', payoff: null, text: '' }
export const editOf = (spec: unknown): EditSpec => ({ ...EDIT_DEFAULT, ...((spec as { edit?: Partial<EditSpec> } | null)?.edit ?? {}) })
export const thumbUrl = (id: string) => `/studio-edits/${id}.webp`

export function editStyles(ctx: PostCtx): EditStyleView[] {
  const all = ctx.data.options.edits?.styles ?? []
  // A batch video has one clip, so only the one-shot edits fit.
  return ctx.item.kind === 'batch' ? all.filter(s => s.shots === 1) : all
}

export function EditStylePicker({ ctx, mode }: { ctx: PostCtx; mode: 'format' | 'finish' }) {
  const { draft } = ctx
  const edit = editOf(draft.spec)
  const styles = editStyles(ctx)
  const set = (patch: Partial<EditSpec>) => draft.setSpec({ edit: { ...edit, ...patch } } as never)
  const pick = (style: EditSpec['style']) => set({ style, payoff: style === edit.style ? edit.payoff : null })
  const chosen = styles.find(s => s.id === edit.style) ?? null
  const groups: Array<[string, EditStyleView[]]> = mode === 'format' && ctx.item.kind === 'meme'
    ? [['One shot', styles.filter(s => s.shots === 1)], ['Two shots (planned in the Video step)', styles.filter(s => s.shots === 2)]]
    : [['', styles]]
  return (
    <div className="st-col" style={{ gap: 10 }}>
      {groups.map(([title, list], gi) => (
        <div key={title} className="st-col" style={{ gap: 6 }}>
          {title && <span className="st-label">{title}</span>}
          <div className="ed-styles" role="radiogroup" aria-label={title || (mode === 'format' ? 'Format' : 'Edit style')}>
            {gi === 0 && (
              <button type="button" role="radio" aria-checked={edit.style === 'none'} className={`ed-style ${edit.style === 'none' ? 'on' : ''}`} onClick={() => pick('none')}>
                <span className="ed-style-thumb none"><Film size={20} /></span>
                <span className="ed-style-text"><b>{mode === 'format' ? 'Single take' : 'None'}</b><span className="st-hint">{mode === 'format' ? 'One shot, no edit.' : 'Exports as it is.'}</span></span>
                {edit.style === 'none' && <Check size={14} className="ed-style-check" />}
              </button>
            )}
            {list.map(s => (
              <button key={s.id} type="button" role="radio" aria-checked={edit.style === s.id} className={`ed-style ${edit.style === s.id ? 'on' : ''}`} onClick={() => pick(s.id)} title={s.line}>
                <span className="ed-style-thumb"><img src={thumbUrl(s.id)} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} /><Sparkles size={16} /></span>
                <span className="ed-style-text"><b>{s.label}{s.shots === 2 && <span className="st-badge plain ed-style-badge">2 shots</span>}</b><span className="st-hint">{s.line}</span></span>
                {edit.style === s.id && <Check size={14} className="ed-style-check" />}
              </button>
            ))}
          </div>
        </div>
      ))}
      {chosen && (
        <div className="st-row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <div className="st-seg sm" role="radiogroup" aria-label="Strength">
            {(['subtle', 'normal', 'strong'] as EditStrength[]).map(k => <button key={k} type="button" role="radio" aria-checked={edit.strength === k} className={edit.strength === k ? 'on' : ''} onClick={() => set({ strength: k })}>{k === 'subtle' ? 'Subtle' : k === 'normal' ? 'Normal' : 'Strong'}</button>)}
          </div>
          {mode === 'finish' && ['payoff', 'cut_or_payoff'].includes(chosen.anchor) && (
            <label className="st-row" style={{ gap: 6 }}>Lands at
              <input className="st-input st-num" type="number" min={0} step={0.1} value={edit.payoff ?? ''} placeholder="auto" onChange={e => set({ payoff: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} aria-label="Where the edit lands, in seconds" /> s
              <span className="st-hint">{edit.payoff == null ? `Auto: ${ctx.data.options.edits?.payoffFromEnd ?? 2} s before the end${chosen.anchor === 'cut_or_payoff' ? ' (or the cut, with two shots)' : ''}.` : ''}</span>
            </label>
          )}
          {chosen.id === 'freeze_pop' && (
            <input className="st-input" style={{ maxWidth: 260 }} maxLength={120} value={edit.text} onChange={e => set({ text: e.target.value })} placeholder="Pop text, e.g. NO WAY (else the caption)" aria-label="Pop text" />
          )}
        </div>
      )}
      {mode === 'finish' && <span className="st-hint">Made by code on the worker, free. Cuts stay hard cuts; nothing is ever crossfaded.</span>}
    </div>
  )
}

