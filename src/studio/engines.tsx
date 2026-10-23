import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { api } from './api'
import { errorMessage, useToast } from './ui'
import { HowTo } from './guide/Guide'
import type { EngineStep, PickView } from './types'

// The provider picker (owner, 2026-10-23; UX-PLAN.md section 40): every
// provider that runs this model on this step, its price side by side, the
// cheapest marked, "Add a key" when there is none. The pick is for the step
// (every character) or for this character on the step; the price buttons
// re-price at once. Hidden when only one provider runs the model.

// A model's provider in words, from its ref (the scene lists' path hints).
const NAMES: Record<string, string> = { higgsfield: 'Higgsfield API', google: 'Google AI Studio', fal: 'fal', kie: 'Kie.ai', wavespeed: 'WaveSpeed' }
export const pathName = (ref: string, path: string) => (path === 'account' ? 'Your Higgsfield plan' : NAMES[ref.split('/')[0] ?? ''] ?? 'API')

export function ProviderPick({ step, model, characterId, characterName, seconds, resolution, audio, compact = false, help = true }: {
  step: EngineStep; model: string | null | undefined; characterId?: string | null; characterName?: string
  seconds?: number; resolution?: string; audio?: boolean; compact?: boolean; help?: boolean
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const key = ['engine-pick', step, model, characterId ?? null, seconds ?? null, resolution ?? null, !!audio]
  const q = useQuery({ queryKey: key, queryFn: () => api.enginePick({ step, model: model!, characterId, seconds, resolution, audio }), enabled: !!model, staleTime: 15_000 })
  const v: PickView | undefined = q.data
  const [scope, setScope] = useState<'character' | 'step'>(characterId && v?.pick.character ? 'character' : 'step')
  const [busy, setBusy] = useState<string | null>(null)
  if (!v?.family || v.rows.length < 2) return null
  async function pick(provider: string, isDefault: boolean) {
    setBusy(provider)
    try {
      await api.setEnginePick({ step, family: v!.family!.id, provider: isDefault && scope === 'step' ? null : provider, characterId: scope === 'character' ? characterId : null })
      await Promise.all([qc.invalidateQueries({ queryKey: ['engine-pick'] }), qc.invalidateQueries({ queryKey: ['estimate'] }), qc.invalidateQueries({ queryKey: ['engines'] })])
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  const field = `provider-pick-${step}-${v.family.id}`
  return (
    <div className={`st-col st-provpick${compact ? ' compact' : ''}`} style={{ gap: 6 }} data-field={field} role="group" aria-label={`Who runs ${v.family.label}`}>
      <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="st-label" style={{ margin: 0 }}>{v.family.label}: who runs it</span>
        {help && <HowTo id="providers" label="How providers work" />}
        {characterId && (
          <span className="st-seg" role="radiogroup" aria-label="Whose pick">
            <button type="button" role="radio" aria-checked={scope === 'character'} className={scope === 'character' ? 'on' : ''} onClick={() => setScope('character')}>{characterName ? `${characterName} only` : 'This character'}</button>
            <button type="button" role="radio" aria-checked={scope === 'step'} className={scope === 'step' ? 'on' : ''} onClick={() => setScope('step')}>Every character</button>
          </span>
        )}
      </div>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {v.rows.map(r => (
          <button key={r.ref} type="button" className={`st-provider${r.chosen ? ' on' : ''}`} aria-pressed={r.chosen} disabled={!r.ready || busy !== null}
            title={!r.ready ? `Add your ${r.providerLabel} key in Settings > Provider keys first` : `${r.label} on ${r.providerLabel}: ${r.price} a ${v.per}${r.verified ? '' : ' (list price, not confirmed by a run yet)'}${r.checked ? `, checked ${r.checked}` : ''}`}
            onClick={() => void pick(r.provider, r.isDefault)} data-field={`${field}-${r.provider}`}>
            <b>{r.providerLabel}</b>
            <span className="st-mono">{r.price}{v.per === 'still' ? '' : ` / ${v.per}`}</span>
            {r.cheapest && <span className="st-cheapest"><Check size={12} aria-hidden />Cheapest</span>}
            {r.isDefault && <span className="st-chip xs">Default</span>}
            {!r.verified && r.micros !== null && <span className="st-muted" aria-label="not confirmed">*</span>}
          </button>
        ))}
      </div>
      {v.rows.some(r => !r.ready) && (
        <span className="st-hint">{v.rows.filter(r => !r.ready).map(r => r.providerLabel).join(' and ')}: <Link to="/studio/settings?tab=general">add a key</Link> to pick {v.rows.filter(r => !r.ready).length === 1 ? 'it' : 'them'}. * List price, not yet confirmed by a real run.</span>
      )}
      {v.pick.character && scope === 'step' && <span className="st-hint">{characterName ?? 'This character'} has its own pick ({v.rows.find(r => r.provider === v.pick.character)?.providerLabel}), which wins over this one.</span>}
    </div>
  )
}

// Settings > Providers: the whole table, step by step, each model's pick for
// every character.
export function EnginesCard() {
  const q = useQuery({ queryKey: ['engines'], queryFn: () => api.engines(), staleTime: 15_000 })
  return (
    <div className="st-card" data-field="settings-engines">
      <div className="st-card-head"><div className="grow"><div className="st-h2 st-row" style={{ gap: 8 }}>Providers<HowTo id="providers" label="How providers work" /></div><div className="st-hint">Who runs each model on each step. Higgsfield is the default where it runs the model; pick Kie.ai, WaveSpeed or another provider for the same model to change the price. A character can have its own pick (on its steps), and Weeks &gt; Make the week can pick one for a whole run.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        {!q.data ? <span className="st-hint">Reading...</span> : q.data.steps.map(s => (
          <div key={s.step} className="st-col" style={{ gap: 10 }} data-field={`engines-step-${s.step}`}>
            <span className="st-h3">{s.label}</span>
            {s.models.map(m => <ProviderPick key={m.family?.id} step={s.step} model={m.rows[0]?.ref} help={false} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
