import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Activity, BookOpen, CalendarRange, FolderOpen, LayoutGrid, Loader2, Moon, Plus, Quote, Settings2, Smartphone, Sparkle, Sun, Users } from 'lucide-react'
import { useTheme } from '../context/theme'
import { api } from './api'
import { isActiveJob, useActiveJobs, useLiveJobs, useMe, useRefresh, useUsage, useWorker } from './hooks'
import { RunRow } from './runs'
import { Drawer, Meter, errorMessage, useToast } from './ui'
import type { JobView } from './types'
import { NEW_POST, useNewPost } from './pages/post/parts'
import { HowTo } from './guide/Guide'

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe()
  const jobs = useActiveJobs()
  const live = useLiveJobs()
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
          {/* The owner's order (2026-10-22, UX-PLAN.md section 37). */}
          <NavLink to="/studio/characters" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Users size={17} />Characters</NavLink>
          <NavLink to="/studio/weeks" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><CalendarRange size={17} />Weeks</NavLink>
          <NavLink to="/studio" end className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><LayoutGrid size={17} />Posts</NavLink>
          <NavLink to="/studio/line-bank" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Quote size={17} />Line bank</NavLink>
          <NavLink to="/studio/library" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><FolderOpen size={17} />Library</NavLink>
          <NavLink to="/studio/accounts" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Smartphone size={17} />Accounts</NavLink>
          <NavLink to="/studio/settings" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><Settings2 size={17} />Settings</NavLink>
          <NavLink to="/studio/guide" className={({ isActive }) => `st-nav-item ${isActive ? 'active' : ''}`}><BookOpen size={17} />Guide</NavLink>
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
        <ActivityList jobs={live.data?.jobs ?? []} />
        {(live.data?.jobs.length ?? 0) === 0 && <p className="st-muted">Nothing is running, and nothing finished in the last 15 minutes. Finished work shows in its post and in the Library.</p>}
        <div style={{ marginTop: 16 }}><HowTo id="feedback" label="How prices and live status work" /></div>
      </Drawer>
    </div>
  )
}

// Activity: the same live rows as in each step, running work first, then
// what finished in the last 15 minutes.
export function ActivityList({ jobs }: { jobs: JobView[] }) {
  const toast = useToast()
  const refresh = useRefresh()
  async function act(fn: () => Promise<unknown>) {
    try { await fn(); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const order = [...jobs].sort((a, b) => Number(isActiveJob(b)) - Number(isActiveJob(a)))
  return (
    <div className="st-col" style={{ gap: 8 }}>
      {order.map(j => (
        <div className="st-activity" key={j.id}>
          <div className="st-row" style={{ gap: 6 }}>
            <span className="st-job-title grow">{j.label}</span>
            <span className="st-hint">{j.modelName} · {j.actual ?? `est. ${j.estimate}`} · {new Date(j.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          <RunRow j={j} showLabel={false} />
          {j.status === 'needs_attention' && (
            <div className="st-row" style={{ marginTop: 4 }}>
              <button className="st-btn sm" onClick={() => act(() => api.resolveJob(j.id, { action: 'not_charged' }))}>Not charged, release</button>
              <button className="st-btn sm ghost" onClick={() => { const id = prompt('Provider job id from the provider console:'); if (id) act(() => api.resolveJob(j.id, { action: 'attach', providerJobId: id })) }}>Attach provider job</button>
            </div>
          )}
          {['waiting', 'queued'].includes(j.status) && <button className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => act(() => api.cancelJob(j.id))}>Cancel</button>}
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
          <button type="button" role="menuitem" onClick={() => { setOpen(false); void newPost.create('meme', { step: 'video' }, '?clone=1') }}>
            <b>Video post from a TikTok</b><span className="st-hint">Clone a saved TikTok or Reel with your character</span>
          </button>
        </div>
      )}
    </div>
  )
}
