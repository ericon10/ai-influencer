import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CreditCard, KeyRound, Link2, Loader2, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { api } from '../api'
import { keys, useHiggsfieldAccount, useSettings } from '../hooks'
import { Callout, errorMessage, useToast } from '../ui'
import { PriceButton } from '../PriceButton'
import type { SettingsView } from '../types'

export default function Settings() {
  const s = useSettings()
  const d = s.data
  return (
    <div className="st-page">
      <div className="st-pagehead"><div className="grow"><div className="st-kicker">Settings</div><h1 className="st-h1">Studio settings</h1></div></div>
      {!d ? <div className="st-skel" style={{ height: 240, borderRadius: 18 }} /> : (
        <div className="st-col" style={{ gap: 20 }}>
          <ModeCard d={d} />
          <KeysCard d={d} />
          <BillingCard d={d} />
          <BudgetsCard d={d} />
          <ModelsCard d={d} />
        </div>
      )}
    </div>
  )
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => { qc.invalidateQueries({ queryKey: keys.settings }); qc.invalidateQueries({ queryKey: keys.me }); qc.invalidateQueries({ queryKey: ['estimate'] }) }
}

function ModeCard({ d }: { d: SettingsView }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  async function set(mode: 'demo' | 'live') {
    try { await api.setMode(mode); invalidate(); toast({ tone: 'ok', text: mode === 'live' ? 'Live mode on. Every run still shows its price first.' : 'Demo mode on. Runs are free mock results.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Mode</div><div className="st-hint">Demo runs every step with free mock providers. Live uses your keys.</div></div>
        <div className="st-seg"><button className={d.mode === 'demo' ? 'on' : ''} onClick={() => set('demo')}>Demo</button><button className={d.mode === 'live' ? 'on' : ''} onClick={() => set('live')}>Live</button></div>
      </div>
      <div className="st-card-body">
        {d.mode === 'live'
          ? <Callout tone="ok" icon={<ShieldCheck size={16} />}>Live. Nothing runs without an estimate you saw, and budget caps block anything over the limit.</Callout>
          : <Callout tone="info">Demo. Images are placeholders and QA answers are simulated, so you can try the whole flow at no cost.</Callout>}
      </div>
    </div>
  )
}

function KeysCard({ d }: { d: SettingsView }) {
  return (
    <div className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Provider keys</div><div className="st-hint">Stored encrypted for this account. Only the last 4 characters are ever shown.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        {d.providers.map(p => <KeyRow key={p.id} p={p} cred={d.credentials.find(c => c.provider === p.id)} />)}
      </div>
    </div>
  )
}

function KeyRow({ p, cred }: { p: SettingsView['providers'][number]; cred?: SettingsView['credentials'][number] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState(!cred)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setEditing(!cred), [cred])
  async function save() {
    setBusy(true)
    try {
      const r = await api.saveKey(p.id, secret)
      setSecret('')
      invalidate()
      toast({ tone: r.verify.ok ? 'ok' : 'bad', text: r.verify.ok ? `${p.label} key saved and verified.` : `${p.label} key saved, but the check failed: ${r.verify.message}` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm(`Remove the ${p.label} key?`)) return
    try { await api.removeKey(p.id); invalidate() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-card" style={{ padding: 14, boxShadow: 'none' }}>
      <div className="st-row">
        <KeyRound size={16} />
        <div className="grow" style={{ flex: 1 }}><div className="st-h3">{p.label}</div><div className="st-hint">{p.usedFor}</div></div>
        {cred && <span className="st-mono">{'*'.repeat(8)}{cred.last4}</span>}
        {cred && <span className={`st-badge ${cred.verifyStatus === 'ok' ? 'ok' : cred.verifyStatus === 'failed' ? 'bad' : ''}`}>{cred.verifyStatus === 'ok' ? 'Verified' : cred.verifyStatus === 'failed' ? 'Check failed' : 'Not checked'}</span>}
        {cred && !editing && <button className="st-btn sm" onClick={() => setEditing(true)}>Replace</button>}
        {cred && <button className="st-btn sm icon ghost" onClick={remove} aria-label="Remove key"><Trash2 size={14} /></button>}
      </div>
      {editing && (
        <div className="st-col" style={{ gap: 8, marginTop: 12 }}>
          <input className="st-input st-mono" type="password" autoComplete="off" placeholder={p.placeholder} value={secret} onChange={e => setSecret(e.target.value)} />
          <div className="st-row"><span className="st-hint" style={{ flex: 1 }}>{p.hint}</span><button className="st-btn primary sm" disabled={secret.length < 8 || busy} onClick={save}>Save and verify</button></div>
        </div>
      )}
    </div>
  )
}

// Which Higgsfield balance pays on this account: the pay-per-use API
// (customers, production) or the owner's own account (plan credits).
function BillingCard({ d }: { d: SettingsView }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const b = d.billing
  const account = useHiggsfieldAccount(b.accountConnected)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'save' | null>(null)
  const [creditUsd, setCreditUsd] = useState(String(b.creditUsd || ''))
  useEffect(() => setCreditUsd(String(b.creditUsd || '')), [b.creditUsd])
  const apiKey = d.credentials.find(c => c.provider === 'higgsfield')
  const apiOnly = d.models.filter(m => m.ref.startsWith('higgsfield/') && !b.accountModels.includes(m.ref)).map(m => m.label)

  // Back from the Higgsfield sign-in page.
  useEffect(() => {
    const result = params.get('higgsfield')
    if (!result) return
    if (result === 'connected') toast({ tone: 'ok', text: 'Higgsfield account connected. Choose it below to run on plan credits.' })
    else toast({ tone: 'bad', text: params.get('message') ?? 'Higgsfield sign-in failed.' })
    params.delete('higgsfield'); params.delete('message')
    setParams(params, { replace: true })
    invalidate()
    qc.invalidateQueries({ queryKey: keys.higgsfieldAccount })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(next: 'api' | 'account') {
    if (next === b.default) return
    setBusy('save')
    try {
      await api.setBilling({ default: next })
      invalidate()
      toast({ tone: 'ok', text: next === 'account' ? 'Higgsfield runs now use your plan credits. New estimates show credits.' : 'Higgsfield runs now use the API balance.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  async function connect() {
    setBusy('connect')
    try { window.location.assign((await api.connectHiggsfieldAccount()).url) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }); setBusy(null) }
  }
  async function disconnect() {
    if (!confirm('Disconnect your Higgsfield account? Runs go back to the API balance.')) return
    setBusy('disconnect')
    try { await api.disconnectHiggsfieldAccount(); invalidate(); qc.removeQueries({ queryKey: keys.higgsfieldAccount }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  async function saveCreditValue() {
    setBusy('save')
    try { await api.setBilling({ creditUsd: Number(creditUsd) || 0 }); invalidate(); toast({ tone: 'ok', text: 'Credit value saved.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  async function refreshBalance() {
    try { qc.setQueryData(keys.higgsfieldAccount, await api.higgsfieldAccount(true)) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  const a = account.data
  const balance = a?.credits != null ? `${a.plan ? `${a.plan} plan, ` : ''}${a.credits.toLocaleString('en-US')} credits` : null
  return (
    <div className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Higgsfield billing</div><div className="st-hint">Which Higgsfield balance pays for images and video on this account. Every run still shows its price first.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        <div className="st-choices" role="radiogroup" aria-label="Higgsfield billing">
          <button className={`st-choice ${b.default === 'api' ? 'on' : ''}`} role="radio" aria-checked={b.default === 'api'} disabled={busy === 'save'} onClick={() => choose('api')}>
            <div className="st-row" style={{ flexWrap: 'nowrap' }}><KeyRound size={16} /><span className="st-h3" style={{ flex: 1 }}>Higgsfield API</span>{b.default === 'api' && <span className="st-badge accent plain">Default</span>}</div>
            <span className="st-hint">Pay-per-use dollars from the Higgsfield Console. For customers and production.</span>
            <span className="st-choice-status">{apiKey ? 'API key added' : 'Needs an API key (Provider keys, above)'}</span>
          </button>
          <button className={`st-choice ${b.default === 'account' ? 'on' : ''}`} role="radio" aria-checked={b.default === 'account'} disabled={!b.accountConnected || busy === 'save'} onClick={() => choose('account')} title={b.accountConnected ? undefined : 'Connect your Higgsfield account first'}>
            <div className="st-row" style={{ flexWrap: 'nowrap' }}><UserRound size={16} /><span className="st-h3" style={{ flex: 1 }}>My Higgsfield account</span>{b.default === 'account' && <span className="st-badge accent plain">Default</span>}</div>
            <span className="st-hint">Spends your plan credits. For your own work.</span>
            <span className="st-choice-status">{!b.accountConnected ? 'Not connected' : balance ?? (account.isLoading ? 'Checking credits...' : 'Connected')}</span>
          </button>
        </div>

        <div className="st-card" style={{ padding: 14, boxShadow: 'none' }}>
          <div className="st-row">
            <Link2 size={16} />
            <div className="grow" style={{ flex: 1 }}>
              <div className="st-h3">Higgsfield account</div>
              <div className="st-hint">{b.accountConnected ? (a?.error ? a.error : 'Signed in through Higgsfield. The sign-in is stored encrypted for this account; your password never reaches the Studio.') : 'Sign in on higgsfield.ai to run on your plan credits. Your password never reaches the Studio.'}</div>
            </div>
            {b.accountConnected && <span className={`st-badge ${a?.error || b.accountStatus === 'failed' ? 'bad' : 'ok'}`}>{a?.error || b.accountStatus === 'failed' ? 'Reconnect' : 'Connected'}</span>}
            {b.accountConnected && <button className="st-btn sm icon ghost" onClick={refreshBalance} aria-label="Refresh credits"><RefreshCw size={14} /></button>}
            {(!b.accountConnected || a?.error || b.accountStatus === 'failed') && (
              <button className="st-btn primary sm" onClick={connect} disabled={busy === 'connect'}>{busy === 'connect' ? <Loader2 size={14} className="st-spin" /> : <Link2 size={14} />}{b.accountConnected ? 'Reconnect' : 'Connect'}</button>
            )}
            {b.accountConnected && <button className="st-btn sm icon ghost" onClick={disconnect} disabled={busy === 'disconnect'} aria-label="Disconnect Higgsfield account"><Trash2 size={14} /></button>}
          </div>
        </div>

        {b.accountConnected && (
          <label className="st-field">
            <span className="st-label">What one credit is worth to you</span>
            <div className="st-row" style={{ gap: 6, flexWrap: 'nowrap', maxWidth: 320 }}>
              <span className="st-muted">$</span>
              <input className="st-input" inputMode="decimal" placeholder="0.00" value={creditUsd} onChange={e => setCreditUsd(e.target.value.replace(/[^\d.]/g, ''))} />
              <button className="st-btn sm" onClick={saveCreditValue} disabled={busy === 'save' || Number(creditUsd || 0) === b.creditUsd}><CreditCard size={14} />Save</button>
            </div>
            <span className="st-hint">Optional. Credit runs count toward budget caps at this value. Leave it empty to track credits only.</span>
          </label>
        )}
        <span className="st-hint">{apiOnly.length ? `${apiOnly.join(', ')} ${apiOnly.length === 1 ? 'runs' : 'run'} on the API only. ` : ''}Model tests always use the API, since they confirm API endpoints.</span>
      </div>
    </div>
  )
}

function BudgetsCard({ d }: { d: SettingsView }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [b, setB] = useState(d.budgets)
  useEffect(() => setB(d.budgets), [d.budgets])
  const field = (k: keyof typeof b, label: string, hint: string, pct = false) => (
    <label className="st-field">
      <span className="st-label">{label}</span>
      <div className="st-row" style={{ gap: 6, flexWrap: 'nowrap' }}>{!pct && <span className="st-muted">$</span>}<input className="st-input" inputMode="decimal" value={String(b[k])} onChange={e => setB({ ...b, [k]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />{pct && <span className="st-muted">%</span>}</div>
      <span className="st-hint">{hint}</span>
    </label>
  )
  async function save() {
    try { await api.saveBudgets(b); invalidate(); toast({ tone: 'ok', text: 'Budgets saved.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Budget caps</div><div className="st-hint">Runs that would cross a cap are blocked before they reach a provider.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        <div className="st-grid two">
          {field('job', 'Per run', 'One run, all its variations and QA.')}
          {field('character', 'Per character', 'Lifetime spend on one character.')}
          {field('month', 'Per month', 'Everything in a calendar month.')}
          {field('confirmAbove', 'Ask me to confirm above', 'An extra tap for any run costing more.')}
          {field('warnPct', 'Warn at', 'Show a warning when a cap is this full.', true)}
        </div>
        <div className="st-row"><span className="st-spacer" /><button className="st-btn primary" onClick={save}><CheckCircle2 size={15} />Save budgets</button></div>
      </div>
    </div>
  )
}

function ModelsCard({ d }: { d: SettingsView }) {
  const hf = d.models.filter(m => m.ref.startsWith('higgsfield/'))
  const confirmed = hf.filter(m => m.verified).length
  return (
    <>
      <div className="st-card">
        <div className="st-card-head">
          <div className="grow">
            <div className="st-h2">Higgsfield models</div>
            <div className="st-hint">A model runs live once it is confirmed: enter its path from Higgsfield's official Model API Reference, then run its test. The test is the cheapest request the model takes, and its price shows first.</div>
          </div>
          <span className={`st-badge ${confirmed === hf.length ? 'ok' : 'warn'}`}>{confirmed} of {hf.length} confirmed</span>
        </div>
        <div className="st-card-body st-col" style={{ gap: 10 }}>
          {d.mode !== 'live' && <Callout tone="info">Tests are real, paid runs, so they need live mode and your Higgsfield key.</Callout>}
          {hf.map(m => <ModelRow key={m.ref} m={m} live={d.mode === 'live'} />)}
        </div>
      </div>
      <div className="st-card">
        <div className="st-card-head"><div className="grow"><div className="st-h2">Routing and prices</div><div className="st-hint">Price book {d.priceVersion}. Higgsfield USD prices come from open.higgsfield.ai/pricing; a "from" price stays unconfirmed until a test shows which tier the requests use.</div></div></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="st-table">
            <thead><tr><th>Task</th><th>Model</th><th>Runs on now</th></tr></thead>
            <tbody>{d.routing.map(r => <tr key={r.task}><td className="strong">{r.task.replace(/_/g, ' ')}</td><td className="st-mono">{r.configured}</td><td className="st-mono">{r.effective}</td></tr>)}</tbody>
          </table>
          <div className="st-divider" style={{ margin: 0 }} />
          <table className="st-table">
            <thead><tr><th>Model</th><th>Unit</th><th>Price</th><th title="As charged in the Higgsfield web app, for reference">Credits</th><th>Status</th></tr></thead>
            <tbody>{d.prices.map(p => (
              <tr key={p.model + p.unit + p.when} title={p.source || undefined}>
                <td className="st-mono strong">{p.model}</td><td>{p.unit.replace('mtok_', 'million tokens, ').replace('_', ' ')}{p.when ? `, ${p.when}` : ''}</td><td>{p.source.includes(': from') ? `from ${p.price}` : p.price}</td>
                <td className="st-mono">{p.credits ?? ''}</td>
                <td><span className={`st-badge ${p.verified ? 'ok' : 'warn'}`}>{p.verified ? 'Confirmed' : p.source.startsWith('Official') ? 'Official, from' : 'Placeholder'}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function ModelRow({ m, live }: { m: SettingsView['models'][number]; live: boolean }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [endpoint, setEndpoint] = useState(m.endpoint)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setEndpoint(m.endpoint) }, [m.endpoint])
  const dirty = endpoint.trim() !== m.endpoint
  async function save() {
    setSaving(true)
    try { await api.setModelEndpoint(m.ref, endpoint.trim()); invalidate(); toast({ tone: 'ok', text: endpoint.trim() ? `${m.label}: path saved. Run its test to confirm it.` : `${m.label}: path cleared.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setSaving(false) }
  }
  const status = m.verified ? { tone: 'ok', text: 'Confirmed' } : m.testing ? { tone: 'info', text: 'Testing' } : m.endpoint ? { tone: 'warn', text: 'Ready to test' } : { tone: '', text: 'Needs its path' }
  return (
    <div className="st-modelrow">
      <div className="st-col" style={{ gap: 2, minWidth: 0 }}>
        <div className="st-row" style={{ gap: 8 }}><b>{m.label}</b><span className={`st-badge plain ${status.tone}`}>{status.text}</span></div>
        <span className="st-hint st-mono">{m.ref}</span>
        {m.lastTest && <span className={`st-hint ${m.lastTest.ok ? '' : 'bad'}`}>{m.lastTest.message}</span>}
      </div>
      <div className="st-row" style={{ gap: 8, minWidth: 0 }}>
        <input className="st-input st-mono" style={{ flex: 1, minWidth: 0 }} placeholder="path from the official reference" value={endpoint} onChange={e => setEndpoint(e.target.value)} aria-label={`${m.label} endpoint`} />
        {dirty && <button className="st-btn sm" disabled={saving} onClick={save}>Save</button>}
        {!dirty && m.endpoint && live && !m.testing && <PriceButton action={{ type: 'model_test', model: m.ref }} label={m.verified ? 'Test again' : 'Test'} variant="secondary" size="sm" />}
      </div>
    </div>
  )
}
