import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, Circle, FolderOpen, LayoutGrid, Loader2, Moon, Plus, Settings2, Sparkle, Sun, Users, XCircle } from 'lucide-react'
import { useTheme } from '../context/theme'
import { api } from './api'
import { useActiveJobs, useMe, useRefresh, useUsage, useWorker } from './hooks'
import { Drawer, JobBadge, Meter, errorMessage, useToast } from './ui'
import type { JobView } from './types'
import { NEW_POST, useNewPost } from './pages/post/parts'

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
        <WorkerLight />
        <nav className="st-nav">
          <NewPostButton />
          <NavLink to="/studio" end className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><LayoutGrid size={17} />Posts</NavLink>
          <NavLink to="/studio/characters" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Users size={17} />Characters</NavLink>
          <NavLink to="/studio/library" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><FolderOpen size={17} />Library</NavLink>
          <NavLink to="/studio/settings" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Settings2 size={17} />Settings</NavLink>
        </nav>
        <div className="st-side-foot">
          <button className="st-nav-item" onClick={() => setActivity(true)}>
            <Activity size={17} />Activity
            {needsYou > 0 ? <span className="st-count">{needsYou}</span> : running > 0 ? <span className="st-count calm">{running}</span> : null}
          </button>
          {usage.data && (
            <Link to="/studio/settings?tab=usage" style={{ padding: '0 6px', textDecoration: 'none', color: 'inherit' }} title="Budgets and usage">
              <Meter value={usage.data.month.spentMicros + usage.data.heldMicros} max={usage.data.month.capMicros} label="This month" sub={<><b>{usage.data.month.spent}</b> / {usage.data.month.cap}</>} />
            </Link>
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
        {active.length === 0 && <p className="st-muted">Nothing is running. Finished work shows in its post and in the Library.</p>}
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

// Green "Worker ready" with the code version, yellow "Worker restarting"
// after a push, red "Worker down". The message says what it means.
function WorkerLight() {
  const w = useWorker()
  const s = w.data
  if (!s) return null
  const label = s.state === 'ready' ? 'Worker ready' : s.state === 'restarting' ? 'Worker restarting' : 'Worker down'
  const version = s.inProcess ? 'local' : s.commit ?? s.version ?? ''
  return (
    <div className={`st-worker ${s.state}`} title={`${s.message}${s.version ? ` Code version ${s.version}${s.commit ? ` (commit ${s.commit})` : ''}.` : ''}`} role="status">
      <span className="st-worker-dot" />
      <span className="grow">{label}</span>
      {s.state === 'ready' && version && <span className="st-worker-ver">{version}</span>}
      {s.state !== 'ready' && <span className="st-worker-msg">{s.message}</span>}
    </div>
  )
}


// "New post": a video post, a slideshow or a batch, with the character and
// account used last. It opens at once.
function NewPostButton() {
  const newPost = useNewPost()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="st-newpost" ref={box}>
      <button type="button" className="st-nav-item st-nav-new" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} disabled={!!newPost.busy}>
        {newPost.busy ? <Loader2 size={17} className="st-spin" /> : <Plus size={17} />}New post
      </button>
      {open && (
        <div className="st-newpost-menu" role="menu">
          {NEW_POST.map(([kind, label, hint]) => (
            <button key={kind} type="button" role="menuitem" onClick={() => { setOpen(false); void newPost.create(kind) }}>
              <b>{label}</b><span className="st-hint">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
