import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkle } from 'lucide-react'
import { api } from '../api'
import { errorMessage } from '../ui'

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
        <label className="st-field"><span className="st-label">Email</span><input className="st-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label className="st-field"><span className="st-label">Passphrase</span><input className="st-input" type="password" autoComplete="current-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required /></label>
        {error && <div className="st-callout bad">{error}</div>}
        <button className="st-btn primary big" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  )
}
