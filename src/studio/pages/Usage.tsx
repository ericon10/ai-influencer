import { Link } from 'react-router-dom'
import { useUsage } from '../hooks'
import { Meter } from '../ui'

// Money is always visible (SPEC 9 and 11). The ledger is append-only and
// detailed enough to become metering and billing later.
export default function Usage() {
  const u = useUsage()
  const d = u.data
  return (
    <div className="st-page">
      <div className="st-pagehead"><div className="grow"><div className="st-kicker">Usage</div><h1 className="st-h1">Spend</h1><p className="st-sub">Estimates are reserved when a run starts and settled when it finishes. Failed runs cost nothing.</p></div></div>
      {!d ? <div className="st-skel" style={{ height: 160, borderRadius: 18 }} /> : (
        <div className="st-col" style={{ gap: 20 }}>
          <div className="st-card pad">
            <div className="st-row" style={{ alignItems: 'baseline', marginBottom: 14 }}>
              <span className="st-serif" style={{ fontSize: 52, lineHeight: 1 }}>{d.month.spent}</span>
              <span className="st-muted">spent this month of {d.month.cap}</span>
              <span className="st-spacer" />
              {d.heldMicros > 0 && <span className="st-badge accent">{d.held} reserved by running jobs</span>}
            </div>
            <Meter value={d.month.spentMicros + d.heldMicros} max={d.month.capMicros} />
            <div className="st-row" style={{ marginTop: 10 }}><span className="st-hint">Caps block runs before they reach a provider.</span><span className="st-spacer" /><Link to="/studio/settings" className="st-btn sm ghost">Edit budgets</Link></div>
          </div>
          <div className="st-grid two">
            <div className="st-card">
              <div className="st-card-head"><div className="st-h2">By character</div></div>
              <table className="st-table"><tbody>
                {d.byCharacter.length === 0 && <tr><td className="st-muted">No spend yet this month.</td></tr>}
                {d.byCharacter.map(c => <tr key={c.characterId ?? 'acct'}><td className="strong">{c.characterId ? <Link to={`/studio/c/${c.characterId}`}>{c.name}</Link> : c.name}</td><td style={{ textAlign: 'right' }}>{c.amount}</td></tr>)}
              </tbody></table>
            </div>
            <div className="st-card">
              <div className="st-card-head"><div className="st-h2">By model</div></div>
              <table className="st-table"><thead><tr><th>Model</th><th>Runs</th><th style={{ textAlign: 'right' }}>Spent</th></tr></thead><tbody>
                {d.byModel.map(m => <tr key={m.model}><td className="strong st-mono">{m.model}</td><td>{m.runs}</td><td style={{ textAlign: 'right' }}>{m.amount}</td></tr>)}
              </tbody></table>
            </div>
          </div>
          <div className="st-card">
            <div className="st-card-head"><div className="st-h2">Ledger</div><span className="st-hint">Latest 50 entries</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="st-table"><thead><tr><th>When</th><th>Entry</th><th>Stage</th><th>Model</th><th>Note</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>
                {d.recent.map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td><span className={`st-badge plain ${r.type === 'charge' ? 'accent' : r.type === 'hold' ? 'info' : ''}`}>{r.type}</span></td>
                    <td>{r.stage}</td><td className="st-mono">{r.model}</td><td>{r.note}</td>
                    <td style={{ textAlign: 'right' }} className="strong">{r.amount}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
