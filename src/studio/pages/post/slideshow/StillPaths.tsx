import type { SlideStillModel, StillPathId } from '../../../types'

// The stills path (owner, 2026-10-17; UX-PLAN.md section 30): Your
// Higgsfield plan (credits) or the Higgsfield API (dollars), the owner's
// pick. The model follows who is in each slide: the character's slides use
// the character file's stills default, the slides with no one the cheapest
// model on that path. One line says which, with a still's price.

export interface PathOption { path: StillPathId; label: string; problem: string | null }
export interface PathModel { who: string; model: SlideStillModel | { label: string; perStill: string; from: SlideStillModel['from'] } }

const FROM: Record<SlideStillModel['from'], (name: string) => string> = {
  file: name => `${name}'s file`,
  studio: () => 'the Studio default',
  cheapest: () => 'the cheapest on this path',
}

export function modelLine(models: PathModel[], name = 'the character'): string {
  return models.map(m => `${m.who}: ${m.model.label} (${FROM[m.model.from](m.who.match(/^(.+)'s slides$/)?.[1] ?? name)}), ${m.model.perStill} a still`).join('. ')
}

export function StillPaths({ paths, value, onPick, models, name, field = 'still-paths' }: {
  paths: PathOption[]; value: StillPathId | null; onPick: (p: StillPathId) => void
  // What the picked path makes, in order (the character's slides first).
  models: PathModel[]; name?: string; field?: string
}) {
  return (
    <div className="st-col" style={{ gap: 6 }} data-field={field}>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="radiogroup" aria-label="Stills path">
        <span className="st-hint">Stills on:</span>
        {paths.map(p => (
          <button key={p.path} type="button" role="radio" aria-checked={value === p.path} disabled={!!p.problem} title={p.problem ?? (p.path === 'account' ? 'Plan credits, through your Higgsfield account' : 'Dollars, through your Higgsfield API key')}
            className={`st-chip ${value === p.path ? 'on' : ''}`} onClick={() => onPick(p.path)}>
            {p.label}<span className="st-muted"> · {p.path === 'account' ? 'credits' : 'dollars'}</span>
          </button>
        ))}
      </div>
      {models.length > 0 && <span className="st-hint" data-field="still-models">{modelLine(models, name)}.</span>}
      {paths.filter(p => p.problem).map(p => <span key={p.path} className="st-hint">{p.label}: {p.problem}</span>)}
    </div>
  )
}
