import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkle } from 'lucide-react'
import { api } from '../api'
import { Field, errorMessage } from '../ui'

export function Login() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await api.login(email, passphrase); await qc.invalidateQueries() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <div className="st-login">
      <form className="st-card st-col" style={{ gap: 16 }} onSubmit={submit}>
        <span className="st-brand-mark" style={{ width: 40, height: 40 }}><Sparkle size={20} /></span>
        <div><h1 className="st-h1" style={{ fontSize: 34 }}>Character <em>Studio</em></h1><p className="st-sub">Sign in to your studio.</p></div>
        <Field id="login-email" label="Email" required done={/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)}><input className="st-input" type="email" autoComplete="username" value={email} placeholder="e.g. you@example.com" onChange={e => setEmail(e.target.value)} required /></Field>
        <Field id="login-passphrase" label="Passphrase" required done={passphrase.length > 0}><input className="st-input" type="password" autoComplete="current-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required /></Field>
        {error && <div className="st-callout bad">{error}</div>}
        <button className="st-btn primary big" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  )
}
