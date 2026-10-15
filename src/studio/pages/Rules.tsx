import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gauge, Lock, RotateCcw } from 'lucide-react'
import { api } from '../api'
import { useCharacters, useRules } from '../hooks'
import { Callout, errorMessage, useToast } from '../ui'
import type { GateNumbers, GateSample, RuleRow, TakeScore, VideoGateView } from '../types'
import { HowTo } from '../guide/Guide'

// Settings, Rules (owner ruling G1, "defaults, not locks"). Every rule in the
// Studio with its bucket. Fixed rules are always on. Defaults start on and can
// be switched off for every character or for one; a default only ever warns.

const ORDER = ['safety', 'realism', 'money', 'character', 'hero', 'sheet', 'scene', 'qa', 'edit', 'video', 'copy']

export function RulesPanel() {
  const chars = useCharacters()
  const [scope, setScope] = useState<string | null>(null)
  const q = useRules(scope)
  const list = q.data?.rules ?? []
  const name = chars.data?.characters.find(c => c.id === scope)?.name
  const fixed = list.filter(r => r.bucket === 'fixed')
  const defaults = list.filter(r => r.bucket === 'default')
  const off = defaults.filter(r => !(scope ? r.character?.on : r.global.on)).length

  return (
    <div>
      <p className="st-sub" style={{ margin: '0 0 16px' }}>Defaults, not locks. Only the fixed rules can stop a run; every default starts on, only ever warns, and can be switched off for all characters or just one.</p>
      <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <span className="st-label">Rules for</span>
        <select className="st-select" style={{ width: 'auto', minWidth: 220 }} value={scope ?? ''} onChange={e => setScope(e.target.value || null)}>
          <option value="">All characters</option>
          {(chars.data?.characters ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="st-hint">{scope ? `A setting here applies to ${name ?? 'this character'} only and wins over "All characters".` : 'These apply to every character unless a character has its own setting.'}</span>
        <span className="st-spacer" />
        {q.data && <span className="st-badge plain">{defaults.length - off} of {defaults.length} defaults on</span>}
      </div>

      {!q.data ? <div className="st-skel" style={{ height: 320, borderRadius: 18 }} /> : (
        <div className="st-col" style={{ gap: 20 }}>
          <section className="st-card">
            <div className="st-card-head"><Lock size={16} /><div className="grow"><div className="st-h2">Fixed</div><div className="st-hint">Always on, for every character. These are the only rules that can stop a run.</div></div></div>
            <div className="st-card-body st-col" style={{ gap: 2 }}>
              {fixed.map(r => <RuleLine key={r.id} r={r} scope={scope} />)}
            </div>
          </section>
          <GateCheckCard />
          {ORDER.filter(a => defaults.some(r => r.area === a)).map(area => (
            <section key={area} className="st-card">
              <div className="st-card-head"><div className="grow"><div className="st-h2">{q.data.areas[area] ?? area}</div><div className="st-hint">Defaults. Pre-filled and editable; a warning at most.</div></div></div>
              <div className="st-card-body st-col" style={{ gap: 2 }}>
                {defaults.filter(r => r.area === area).map(r => <RuleLine key={r.id} r={r} scope={scope} />)}
              </div>
            </section>
          ))}
          <Callout tone="info">Turning a default off changes what the Studio suggests and checks; it never removes anything you write yourself. Realism, adults 21 and over, no explicit content, a new person rather than a copy, the AI-generated label on posts, the price first, budget caps and server-side keys stay on.</Callout>
        </div>
      )}
    </div>
  )
}

function RuleLine({ r, scope }: { r: RuleRow; scope: string | null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const state = scope ? r.character! : r.global
  const own = scope ? r.character!.set : r.global.set
  const [value, setValue] = useState(state.value ?? '')
  useEffect(() => setValue(state.value ?? ''), [state.value])

  async function save(patch: { on?: boolean | null; value?: string | null }) {
    setBusy(true)
    try {
      const view = await api.setRule({ ruleId: r.id, characterId: scope, ...patch })
      qc.setQueryData(['rules', scope ?? 'all'], view)
      qc.invalidateQueries({ queryKey: ['rules'] })
      qc.invalidateQueries({ queryKey: ['estimate'] })
      qc.invalidateQueries({ queryKey: ['scenes'] })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="st-rule">
      <div className="st-col" style={{ gap: 3, minWidth: 0, flex: 1 }}>
        <div className="st-row" style={{ gap: 8 }}>
          <b>{r.title}</b>
          {scope && r.bucket === 'default' && (own
            ? <button className="st-btn sm ghost" disabled={busy} onClick={() => save({ on: null })} title="Follow the setting for all characters"><RotateCcw size={12} />Set here</button>
            : <span className="st-hint">same as all characters</span>)}
        </div>
        <span className="st-hint">{r.message}</span>
        {r.defaultValue !== null && r.bucket === 'default' && state.on && (
          <div className="st-row" style={{ gap: 8, marginTop: 4 }}>
            <input className="st-input" value={value} maxLength={400} onChange={e => setValue(e.target.value)} placeholder={`Default: ${r.defaultValue}`} />
            <button className="st-btn sm secondary" disabled={busy || value === (state.value ?? '')} onClick={() => save({ value })}>Save</button>
            <button className="st-btn sm ghost" disabled={busy} onClick={() => save({ value: null })} title="Back to the default">Reset</button>
          </div>
        )}
      </div>
      {r.bucket === 'fixed' ? (
        <span className="st-badge plain" title="A fixed rule is always on"><Lock size={12} />Always on</span>
      ) : (
        <button role="switch" aria-checked={state.on} aria-label={r.title} className={`st-switch ${state.on ? 'on' : ''}`} disabled={busy} onClick={() => save({ on: !state.on })}><span /></button>
      )}
    </div>
  )
}

// The Recreate gate check (owner, round 18): after every 10 real recreates,
// the face match and margin of the stills the videos were made from next to
// the stills passed over, and suggested numbers. Suggest only; the owner
// approves.
const n2 = (v: number | null) => (v == null ? 'none' : v.toFixed(2))
const nums = (g: GateNumbers) => `face ${n2(g.face_min)} or more, margin ${n2(g.margin)} or more, likeness under ${n2(g.source_max)}`

function GateCheckCard() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['gate-check'], queryFn: api.gateCheck, retry: false })
  const [busy, setBusy] = useState(false)
  const v = q.data
  if (!v) return null
  async function answer(use: boolean) {
    setBusy(true)
    try { await api.answerGateCheck(use); await qc.invalidateQueries({ queryKey: ['gate-check'] }); toast({ tone: 'ok', text: use ? 'The new gate numbers are in use.' : 'Kept the current numbers until the next 10.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  const stats = (list: GateSample[]) => {
    const f = list.map(x => x.face).filter((x): x is number => x != null)
    const m = list.map(x => x.margin).filter((x): x is number => x != null)
    const range = (a: number[]) => (a.length ? `${Math.min(...a).toFixed(2)} to ${Math.max(...a).toFixed(2)}` : 'no scores')
    return `${list.length} still${list.length === 1 ? '' : 's'}; face ${range(f)}; margin ${range(m)}`
  }
  return (
    <section className="st-card" id="gate-check" data-field="gate-check">
      <div className="st-card-head"><Gauge size={16} /><div className="grow"><div className="st-h2">Recreate gate check</div><div className="st-hint">Every {v.every} real recreates: the stills you made videos from next to the ones you passed over, and suggested numbers. Nothing changes until you approve.</div></div><HowTo id="post-clone" label="How the gates work" /></div>
      <div className="st-card-body st-col" style={{ gap: 10 }}>
        <span>{v.count} real recreate{v.count === 1 ? '' : 's'} so far. {v.due ? <b>A check is ready.</b> : <>The next check is at {v.nextAt}.</>}</span>
        <span className="st-hint">Now: {nums(v.current)}.</span>
        {v.picked.length > 0 && (
          <div className="st-col" style={{ gap: 4 }}>
            <span><b>Picked</b>: {stats(v.picked)}</span>
            <span><b>Passed over</b>: {stats(v.passedOver)}</span>
            <table className="st-table">
              <thead><tr><th>Still</th><th>Face</th><th>Likeness</th><th>Margin</th><th>Model</th></tr></thead>
              <tbody>
                {[...v.picked.map(x => ({ ...x, picked: true })), ...v.passedOver.map(x => ({ ...x, picked: false }))].map(x => (
                  <tr key={x.candidateId}><td>{x.picked ? 'Picked' : 'Passed over'}{x.pass === 'face' ? ' (face pass)' : ''}</td><td>{n2(x.face)}</td><td>{n2(x.likeness)}</td><td>{n2(x.margin)}</td><td className="st-muted">{x.model?.replace('higgsfield/', '') ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {v.suggested ? (
          <Callout tone="info">
            <b>Suggested: {nums(v.suggested)}.</b> With these, {v.effect.suggested!.pickedPass} of {v.picked.length} picked stills pass and {v.effect.suggested!.passedOverHeld} of {v.passedOver.length} passed-over stills are held (now: {v.effect.current.pickedPass} and {v.effect.current.passedOverHeld}).
            <ul style={{ margin: '6px 0 0 18px' }}>{v.why.map(w => <li key={w}>{w}</li>)}</ul>
          </Callout>
        ) : <span className="st-hint">{v.why[0]}</span>}
        {v.due && (
          <div className="st-row" style={{ gap: 8 }}>
            {v.suggested && <button type="button" className="st-btn primary sm" disabled={busy} onClick={() => void answer(true)}>Use these numbers</button>}
            <button type="button" className="st-btn sm" disabled={busy} onClick={() => void answer(false)}>Keep the current numbers</button>
          </div>
        )}
        <VideoGateSection v={v.video} />
      </div>
    </section>
  )
}

// Video takes get their own numbers (owner, 2026-10-15): the takes you kept
// next to the ones you tried again on, every 10 real takes. A take that
// misses is only ever a warning.
function VideoGateSection({ v }: { v: VideoGateView }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function answer(use: boolean) {
    setBusy(true)
    try { await api.answerGateCheck(use, 'video'); await qc.invalidateQueries({ queryKey: ['gate-check'] }); toast({ tone: 'ok', text: use ? 'The new video numbers are in use.' : 'Kept the current video numbers until the next 10.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  const range = (list: TakeScore[], k: 'face' | 'margin' | 'likeness') => {
    const a = list.map(x => x[k]).filter((x): x is number => x != null)
    return a.length ? `${Math.min(...a).toFixed(2)} to ${Math.max(...a).toFixed(2)}` : 'no scores'
  }
  return (
    <div className="st-col" style={{ gap: 8, borderTop: '1px solid var(--st-line)', paddingTop: 10 }} data-field="video-gate-check">
      <b>Video takes</b>
      <span className="st-hint">A take is read over the whole clip: the middle face match, the middle margin and the highest likeness. Now: {nums(v.current)} (a take that misses is a warning, never rejected).</span>
      <span>{v.count} real take{v.count === 1 ? '' : 's'} with scores. {v.due ? <b>A video check is ready.</b> : <>The next video check is at {v.nextAt}.</>}</span>
      {(v.kept.length > 0 || v.triedAgain.length > 0) && (
        <div className="st-col" style={{ gap: 4 }}>
          <span><b>Kept</b>: {v.kept.length}; face {range(v.kept, 'face')}; margin {range(v.kept, 'margin')}; likeness {range(v.kept, 'likeness')}</span>
          <span><b>Tried again</b>: {v.triedAgain.length}; face {range(v.triedAgain, 'face')}; margin {range(v.triedAgain, 'margin')}; likeness {range(v.triedAgain, 'likeness')}</span>
        </div>
      )}
      {v.suggested ? (
        <Callout tone="info">
          <b>Suggested for video: {nums(v.suggested)}.</b> With these, {v.effect.suggested!.keptPass} of {v.kept.length} kept takes pass and {v.effect.suggested!.triedAgainHeld} of {v.triedAgain.length} tried-again takes would be flagged (now: {v.effect.current.keptPass} and {v.effect.current.triedAgainHeld}).
          <ul style={{ margin: '6px 0 0 18px' }}>{v.why.map(w => <li key={w}>{w}</li>)}</ul>
        </Callout>
      ) : <span className="st-hint">{v.why[0]}</span>}
      {v.due && (
        <div className="st-row" style={{ gap: 8 }}>
          {v.suggested && <button type="button" className="st-btn primary sm" disabled={busy} onClick={() => void answer(true)}>Use these video numbers</button>}
          <button type="button" className="st-btn sm" disabled={busy} onClick={() => void answer(false)}>Keep the current video numbers</button>
        </div>
      )}
    </div>
  )
}
