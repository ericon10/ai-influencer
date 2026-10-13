import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CreditCard, KeyRound, Link2, Loader2, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { api } from '../api'
import { keys, useHiggsfieldAccount, useSettings } from '../hooks'
import { Callout, PromptViewer, errorMessage, useToast } from '../ui'
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
          <ConnectionsCard d={d} />
          <StorageCard />
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
  const [editing, setEditing] = useState(!cred && !p.serverKey)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setEditing(!cred && !p.serverKey), [cred, p.serverKey])
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
        {!cred && p.serverKey && <span className="st-badge ok">Set on the server</span>}
        {!cred && p.serverKey && !editing && <button className="st-btn sm ghost" onClick={() => setEditing(true)}>Use another key</button>}
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
  const b = d.billing
  const account = useHiggsfieldAccount(b.accountConnected)
  const [busy, setBusy] = useState(false)
  const [creditUsd, setCreditUsd] = useState(String(b.creditUsd || ''))
  useEffect(() => setCreditUsd(String(b.creditUsd || '')), [b.creditUsd])
  const apiKey = d.credentials.find(c => c.provider === 'higgsfield')
  const apiOnly = d.models.filter(m => m.ref.startsWith('higgsfield/') && !b.accountModels.includes(m.ref)).map(m => m.label)

  async function choose(next: 'api' | 'account') {
    if (next === b.default) return
    setBusy(true)
    try {
      await api.setBilling({ default: next })
      invalidate()
      toast({ tone: 'ok', text: next === 'account' ? 'Higgsfield runs now use your plan credits. New estimates show credits.' : 'Higgsfield runs now use the API balance.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  async function saveCreditValue() {
    setBusy(true)
    try { await api.setBilling({ creditUsd: Number(creditUsd) || 0 }); invalidate(); toast({ tone: 'ok', text: 'Credit value saved.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  const a = account.data
  const balance = a?.credits != null ? `${a.plan ? `${a.plan} plan, ` : ''}${a.credits.toLocaleString('en-US')} credits` : null
  return (
    <div className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Higgsfield billing</div><div className="st-hint">Which Higgsfield balance pays for images and video on this account. Every run still shows its price first.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        <div className="st-choices" role="radiogroup" aria-label="Higgsfield billing">
          <button className={`st-choice ${b.default === 'api' ? 'on' : ''}`} role="radio" aria-checked={b.default === 'api'} disabled={busy} onClick={() => choose('api')}>
            <div className="st-row" style={{ flexWrap: 'nowrap' }}><KeyRound size={16} /><span className="st-h3" style={{ flex: 1 }}>Higgsfield API</span>{b.default === 'api' && <span className="st-badge accent plain">Default</span>}</div>
            <span className="st-hint">Pay-per-use dollars from the Higgsfield Console. For customers and production.</span>
            <span className="st-choice-status">{apiKey ? 'API key added' : 'Needs an API key (Provider keys, above)'}</span>
          </button>
          <button className={`st-choice ${b.default === 'account' ? 'on' : ''}`} role="radio" aria-checked={b.default === 'account'} disabled={!b.accountConnected || busy} onClick={() => choose('account')} title={b.accountConnected ? undefined : 'Connect your Higgsfield account first (Connected accounts, below)'}>
            <div className="st-row" style={{ flexWrap: 'nowrap' }}><UserRound size={16} /><span className="st-h3" style={{ flex: 1 }}>My Higgsfield account</span>{b.default === 'account' && <span className="st-badge accent plain">Default</span>}</div>
            <span className="st-hint">Spends your plan credits. For your own work.</span>
            <span className="st-choice-status">{!b.accountConnected ? 'Connect it under Connected accounts, below' : balance ?? (account.isLoading ? 'Checking credits...' : 'Connected')}</span>
          </button>
        </div>
        {b.accountConnected && (
          <label className="st-field">
            <span className="st-label">What one credit is worth to you</span>
            <div className="st-row" style={{ gap: 6, flexWrap: 'nowrap', maxWidth: 320 }}>
              <span className="st-muted">$</span>
              <input className="st-input" inputMode="decimal" placeholder="0.00" value={creditUsd} onChange={e => setCreditUsd(e.target.value.replace(/[^\d.]/g, ''))} />
              <button className="st-btn sm" onClick={saveCreditValue} disabled={busy || Number(creditUsd || 0) === b.creditUsd}><CreditCard size={14} />Save</button>
            </div>
            <span className="st-hint">Optional. Credit runs count toward budget caps at this value. Leave it empty to track credits only.</span>
          </label>
        )}
        <span className="st-hint">{apiOnly.length ? `${apiOnly.join(', ')} ${apiOnly.length === 1 ? 'runs' : 'run'} on the API only. ` : ''}Model tests always use the API, since they confirm API endpoints.</span>
      </div>
    </div>
  )
}

// Accounts on the owner's own plan, over MCP. One connection flow for every
// provider: Higgsfield today, Dzine AI coming soon.
function ConnectionsCard({ d }: { d: SettingsView }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()

  // Back from a provider's sign-in page.
  useEffect(() => {
    const ok = params.get('connected'), bad = params.get('connection_error')
    if (!ok && !bad) return
    const label = d.connections.find(c => c.id === (ok ?? bad))?.label ?? 'Account'
    if (ok) toast({ tone: 'ok', text: ok === 'higgsfield' ? 'Higgsfield account connected. Choose it under Higgsfield billing to run on plan credits.' : `${label} connected.` })
    else toast({ tone: 'bad', text: params.get('message') ?? `${label} sign-in failed.` })
    for (const k of ['connected', 'connection_error', 'message']) params.delete(k)
    setParams(params, { replace: true })
    invalidate()
    qc.invalidateQueries({ queryKey: keys.higgsfieldAccount })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Connected accounts</div><div className="st-hint">Your own plans, over MCP. Each sign-in happens on the provider's site and is stored encrypted for this account; your password never reaches the Studio.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        {d.connections.map(c => <ConnectionRow key={c.id} c={c} />)}
      </div>
    </div>
  )
}

function ConnectionRow({ c }: { c: SettingsView['connections'][number] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const isHiggsfield = c.id === 'higgsfield'
  const account = useHiggsfieldAccount(isHiggsfield && c.connected)
  const a = isHiggsfield ? account.data : undefined
  const soon = c.status === 'coming_soon'
  const failed = !!a?.error || c.verifyStatus === 'failed'

  async function connect() {
    setBusy('connect')
    try { window.location.assign((await api.connect(c.id)).url) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }); setBusy(null) }
  }
  async function disconnect() {
    if (!confirm(`Disconnect your ${c.label} account?${isHiggsfield ? ' Higgsfield runs go back to the API balance.' : ''}`)) return
    setBusy('disconnect')
    try { await api.disconnect(c.id); invalidate(); qc.removeQueries({ queryKey: keys.higgsfieldAccount }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  async function refreshBalance() {
    try { qc.setQueryData(keys.higgsfieldAccount, await api.higgsfieldAccount(true)) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  const detail = soon
    ? c.note
    : c.connected
      ? (a?.error ?? (a?.credits != null ? `${a.plan ? `${a.plan} plan, ` : ''}${a.credits.toLocaleString('en-US')} credits` : 'Signed in.'))
      : `Sign in on ${c.site.replace(/^https:\/\/(www\.)?/, '')} to use your plan credits.`
  return (
    <div className={`st-card st-connection ${soon ? 'soon' : ''}`} style={{ padding: 14, boxShadow: 'none' }}>
      <div className="st-row">
        <Link2 size={16} />
        <div className="grow" style={{ flex: 1, minWidth: 0 }}>
          <div className="st-row" style={{ gap: 8 }}><span className="st-h3">{c.label}</span>{soon && <span className="st-badge plain">Coming soon</span>}</div>
          <div className="st-hint">{detail}</div>
        </div>
        {c.connected && <span className={`st-badge ${failed ? 'bad' : 'ok'}`}>{failed ? 'Reconnect' : 'Connected'}</span>}
        {isHiggsfield && c.connected && <button className="st-btn sm icon ghost" onClick={refreshBalance} aria-label="Refresh credits"><RefreshCw size={14} /></button>}
        {soon
          ? <button className="st-btn sm" disabled title="Coming soon: nothing is connected or called yet."><Link2 size={14} />Connect</button>
          : (!c.connected || failed) && <button className="st-btn primary sm" onClick={connect} disabled={busy === 'connect'}>{busy === 'connect' ? <Loader2 size={14} className="st-spin" /> : <Link2 size={14} />}{c.connected ? 'Reconnect' : 'Connect'}</button>}
        {c.connected && <button className="st-btn sm icon ghost" onClick={disconnect} disabled={busy === 'disconnect'} aria-label={`Disconnect ${c.label}`}><Trash2 size={14} /></button>}
      </div>
    </div>
  )
}

// Where files live, and the bucket rules that let the browser upload
// straight to R2 (CORS).
function StorageCard() {
  const toast = useToast()
  const [info, setInfo] = useState<{ driver: string; bucket: string | null; origins: string[]; corsRules: unknown[] } | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.storage().then(setInfo).catch(() => undefined) }, [])
  async function check() {
    setBusy(true)
    try { setResult(await api.checkStorage()) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  if (!info) return null
  const r2 = info.driver === 's3'
  return (
    <div className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Storage</div><div className="st-hint">{r2 ? `Cloudflare R2, bucket ${info.bucket}. Uploads go from your browser straight to the bucket.` : 'Local disk (development). Uploads go through the Studio.'}</div></div>
        {r2 && <button className="st-btn sm" onClick={check} disabled={busy}>{busy ? <Loader2 size={14} className="st-spin" /> : <ShieldCheck size={14} />}Check uploads</button>}
      </div>
      {r2 && (
        <div className="st-card-body st-col" style={{ gap: 12 }}>
          {result && <Callout tone={result.ok ? 'ok' : 'warn'}>{result.message}</Callout>}
          <span className="st-hint">If the check says the key cannot set them, paste these rules in Cloudflare: R2, the bucket, Settings, CORS policy, Edit.</span>
          <PromptViewer label="CORS policy" text={JSON.stringify(info.corsRules, null, 2)} wrapped={JSON.stringify(info.corsRules, null, 2)} />
        </div>
      )}
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

function ModelSuiteCard({ d }: { d: SettingsView }) {
  const { tests, cap } = d.modelSuite
  const ready = tests.filter(t => t.endpoint || (t.path === 'account' && d.billing.accountConnected)).length
  const running = tests.some(t => t.testing)
  const result = (t: SettingsView['modelSuite']['tests'][number]) =>
    t.testing ? <span className="st-badge plain info">Running</span>
      : !t.lastTest ? <span className="st-badge plain">{t.path === 'account' ? (d.billing.accountConnected ? 'Not run yet' : 'Connect your account') : t.endpoint ? 'Not run yet' : 'Needs its path'}</span>
      : <span className={`st-badge ${t.lastTest.ok ? 'ok' : 'bad'}`}>{t.lastTest.ok ? 'Passed' : 'Failed'}</span>
  return (
    <div className="st-card">
      <div className="st-card-head">
        <div className="grow">
          <div className="st-h2">Model tests</div>
          <div className="st-hint">Each real model path once, with neutral test images (a mug and a plant, never a character). One estimate for the whole run, capped at {cap}. Models the API does not offer run on your Higgsfield account.</div>
        </div>
        {d.mode === 'live' && ready > 0 && !running && <PriceButton action={{ type: 'model_suite' }} label="Run model tests" />}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="st-table">
          <thead><tr><th>Model</th><th>Test</th><th>Result</th><th>Cost</th></tr></thead>
          <tbody>{tests.map(t => (
            <tr key={t.ref}>
              <td className="strong">{t.label}</td>
              <td><div className="st-col" style={{ gap: 2 }}><span>{t.what}</span><span className="st-hint">{t.path === 'account' ? 'On your Higgsfield account (plan credits); the API does not offer it' : 'On the Higgsfield API'}</span></div></td>
              <td><div className="st-col" style={{ gap: 4 }}>{result(t)}{t.lastTest && !t.testing && <span className={`st-hint ${t.lastTest.ok ? '' : 'bad'}`}>{t.lastTest.message}</span>}</div></td>
              <td className="st-mono">{t.cost ?? (t.estimate ? `about ${t.estimate}` : '')}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {d.mode !== 'live' && <div className="st-card-body"><Callout tone="info">Model tests are real, paid runs, so they need live mode and your Higgsfield key.</Callout></div>}
      {d.mode === 'live' && ready === 0 && <div className="st-card-body"><Callout tone="info">Enter each model's path from Higgsfield's official Model API Reference below, then run the tests.</Callout></div>}
    </div>
  )
}

function ModelsCard({ d }: { d: SettingsView }) {
  const hf = d.models.filter(m => m.ref.startsWith('higgsfield/'))
  const onApi = hf.filter(m => m.api)
  const confirmed = onApi.filter(m => m.verified).length
  return (
    <>
      <ModelSuiteCard d={d} />
      <div className="st-card">
        <div className="st-card-head">
          <div className="grow">
            <div className="st-h2">Higgsfield models</div>
            <div className="st-hint">A model runs live on the API once it is confirmed by its test. Paths come from Higgsfield's official Model API Reference (linked under each model). The test is the cheapest request the model takes, and its price shows first.</div>
          </div>
          <span className={`st-badge ${confirmed === onApi.length ? 'ok' : 'warn'}`}>{confirmed} of {onApi.length} on the API confirmed</span>
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
  const status = !m.api ? { tone: '', text: 'Account only' } : m.verified ? { tone: 'ok', text: 'Confirmed' } : m.testing ? { tone: 'info', text: 'Testing' } : m.endpoint ? { tone: 'warn', text: 'Ready to test' } : { tone: '', text: 'Needs its path' }
  return (
    <div className="st-modelrow">
      <div className="st-col" style={{ gap: 2, minWidth: 0 }}>
        <div className="st-row" style={{ gap: 8 }}><b>{m.label}</b><span className={`st-badge plain ${status.tone}`}>{status.text}</span></div>
        <span className="st-hint st-mono">{m.ref}</span>
        {m.lastTest && <span className={`st-hint ${m.lastTest.ok ? '' : 'bad'}`}>{m.lastTest.message}</span>}
        {m.reference && <a className="st-hint" href={m.reference} target="_blank" rel="noreferrer">Official API reference</a>}
      </div>
      {!m.api ? <span className="st-hint">Not on the Higgsfield API. It runs through your Higgsfield account.</span> : <div className="st-row" style={{ gap: 8, minWidth: 0 }}>
        <input className="st-input st-mono" style={{ flex: 1, minWidth: 0 }} placeholder="path from the official reference" value={endpoint} onChange={e => setEndpoint(e.target.value)} aria-label={`${m.label} endpoint`} />
        {dirty && <button className="st-btn sm" disabled={saving} onClick={save}>Save</button>}
        {!dirty && m.endpoint && live && !m.testing && <PriceButton action={{ type: 'model_test', model: m.ref }} label={m.verified ? 'Test again' : 'Test'} variant="secondary" size="sm" />}
      </div>}
    </div>
  )
}
