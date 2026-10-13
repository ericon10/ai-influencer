import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, RotateCcw } from 'lucide-react'
import { api } from '../api'
import { useCharacters, useRules } from '../hooks'
import { Callout, errorMessage, useToast } from '../ui'
import type { RuleRow } from '../types'

// Settings, Rules (owner ruling G1, "defaults, not locks"). Every rule in the
// Studio with its bucket. Fixed rules are always on. Defaults start on and can
// be switched off for every character or for one; a default only ever warns.

const ORDER = ['safety', 'realism', 'money', 'character', 'hero', 'sheet', 'scene', 'qa', 'edit', 'video', 'copy']

export default function Rules() {
  const chars = useCharacters()
  const [scope, setScope] = useState<string | null>(null)
  const q = useRules(scope)
  const list = q.data?.rules ?? []
  const name = chars.data?.characters.find(c => c.id === scope)?.name
  const fixed = list.filter(r => r.bucket === 'fixed')
  const defaults = list.filter(r => r.bucket === 'default')
  const off = defaults.filter(r => !(scope ? r.character?.on : r.global.on)).length

  return (
    <div className="st-page">
      <Link to="/studio/settings" className="st-btn ghost sm" style={{ marginBottom: 14 }}><ArrowLeft size={14} />Settings</Link>
      <div className="st-pagehead">
        <div className="grow">
          <div className="st-kicker">Settings</div>
          <h1 className="st-h1">Rules</h1>
          <p className="st-sub" style={{ margin: '6px 0 0' }}>Defaults, not locks. Only the fixed rules can stop a run; every default starts on, only ever warns, and can be switched off for all characters or just one.</p>
        </div>
      </div>

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
            <input className="st-input" value={value} maxLength={400} onChange={e => setValue(e.target.value)} placeholder={r.defaultValue} />
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
