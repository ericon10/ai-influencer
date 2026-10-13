import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, Circle, Clapperboard, Gauge, Loader2, Moon, Settings2, Sparkle, Sun, Users, XCircle } from 'lucide-react'
import { useTheme } from '../context/theme'
import { api } from './api'
import { useActiveJobs, useMe, useRefresh, useUsage } from './hooks'
import { Drawer, JobBadge, Meter, errorMessage, useToast } from './ui'
import type { JobView } from './types'

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe()
  const jobs = useActiveJobs()
  const usage = useUsage()
  const { isDark, toggle } = useTheme()
  const [activity, setActivity] = useState(false)
  const active = jobs.data?.jobs ?? []
  const needsYou = active.filter(j => j.status === 'needs_attention').length
  const running = active.length - needsYou

  return (
    <div className="st-shell">
      <aside className="st-side">
        <Link to="/studio" className="st-brand">
          <span className="st-brand-mark"><Sparkle size={17} strokeWidth={2.4} /></span>
          <span className="st-brand-name">Character <em>Studio</em></span>
        </Link>
        <nav className="st-nav">
          <NavLink to="/studio" end className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Users size={17} />Characters</NavLink>
          <NavLink to="/studio/content" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Clapperboard size={17} />Content</NavLink>
          <button className="st-nav-item" onClick={() => setActivity(true)}>
            <Activity size={17} />Activity
            {needsYou > 0 ? <span className="st-count">{needsYou}</span> : running > 0 ? <span className="st-count calm">{running}</span> : null}
          </button>
          <NavLink to="/studio/usage" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Gauge size={17} />Usage</NavLink>
          <NavLink to="/studio/settings" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Settings2 size={17} />Settings</NavLink>
        </nav>
        <div className="st-side-foot">
          {usage.data && (
            <div style={{ padding: '0 6px' }}>
              <Meter value={usage.data.month.spentMicros + usage.data.heldMicros} max={usage.data.month.capMicros} label="This month" sub={<><b>{usage.data.month.spent}</b> / {usage.data.month.cap}</>} />
            </div>
          )}
          {me.data && (
            <Link to="/studio/settings" className={`st-mode-card ${me.data.mode}`} style={{ textDecoration: 'none' }}>
              <strong>{me.data.mode === 'live' ? 'Live' : 'Demo mode'}</strong>
              {me.data.mode === 'live' ? 'Runs use your provider keys and cost money. Every run shows its price first.' : 'Free mock results so you can try every step. Add keys in Settings to go live.'}
            </Link>
          )}
          <div className="st-row" style={{ padding: '0 4px' }}>
            <button className="st-btn sm ghost" onClick={toggle} aria-label="Toggle theme">{isDark ? <Sun size={14} /> : <Moon size={14} />}{isDark ? 'Light' : 'Dark'}</button>
            <span className="st-spacer" />
            <Link to="/influencers" className="st-btn sm ghost" title="The original AI Influencer tools">Classic</Link>
          </div>
        </div>
      </aside>
      <main className="st-main">{children}</main>
      <Drawer open={activity} onClose={() => setActivity(false)} title="Activity">
        <ActivityList jobs={active} />
        {active.length === 0 && <p className="st-muted">Nothing is running. Finished jobs show on each character's page.</p>}
      </Drawer>
    </div>
  )
}

function JobIcon({ status }: { status: string }) {
  if (['queued', 'submitting', 'running', 'ingesting'].includes(status)) return <span className="st-job-icon run"><Loader2 size={15} className="st-spin" /></span>
  if (status === 'completed') return <span className="st-job-icon ok"><CheckCircle2 size={15} /></span>
  if (status === 'failed') return <span className="st-job-icon bad"><XCircle size={15} /></span>
  if (status === 'needs_attention') return <span className="st-job-icon warn"><AlertTriangle size={15} /></span>
  return <span className="st-job-icon"><Circle size={15} /></span>
}

export function ActivityList({ jobs }: { jobs: JobView[] }) {
  const toast = useToast()
  const refresh = useRefresh()
  async function act(fn: () => Promise<unknown>) {
    try { await fn(); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div>
      {jobs.map(j => (
        <div className="st-job" key={j.id}>
          <JobIcon status={j.status} />
          <div style={{ minWidth: 0 }}>
            <div className="st-job-title">{j.label}</div>
            <div className="st-job-sub">{j.model} · {j.actual ?? `est. ${j.estimate}`} · {new Date(j.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            {j.error && <div className="st-job-sub" style={{ color: j.status === 'needs_attention' ? 'var(--st-warn)' : 'var(--st-bad)' }}>{j.error}</div>}
            {j.status === 'needs_attention' && (
              <div className="st-row" style={{ marginTop: 8 }}>
                <button className="st-btn sm" onClick={() => act(() => api.resolveJob(j.id, { action: 'not_charged' }))}>Not charged, release</button>
                <button className="st-btn sm ghost" onClick={() => { const id = prompt('Provider job id from the provider console:'); if (id) act(() => api.resolveJob(j.id, { action: 'attach', providerJobId: id })) }}>Attach provider job</button>
              </div>
            )}
          </div>
          <div className="st-col" style={{ alignItems: 'flex-end', gap: 6 }}>
            <JobBadge status={j.status} />
            {['waiting', 'queued'].includes(j.status) && <button className="st-btn sm ghost" onClick={() => act(() => api.cancelJob(j.id))}>Cancel</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
