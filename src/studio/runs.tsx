import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Loader2, X, XCircle } from 'lucide-react'
import { useLiveJobs } from './hooks'
import { useToast } from './ui'
import { PriceButton } from './PriceButton'
import type { JobView } from './types'

// Feedback everywhere (owner, 2026-10-13; UX-PLAN.md shared patterns): every
// run shows what it is doing now, from the runner's real state (Submitting,
// Queued at the provider, Generating with the elapsed and the usual time,
// Downloading, Checking, Done), and a failure in plain words with whether
// anything was charged, a Retry, and the provider's message under Details.
// The same rows show in each step and in Activity.

const ACTIVE = ['waiting', 'queued', 'submitting', 'running', 'ingesting']
const TIMED = ['submitting', 'working', 'sent', 'provider_queued', 'generating', 'downloading', 'checking']

export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [on, ms])
  return now
}

export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const usual = (sec: number) => (sec < 90 ? `about ${Math.max(5, Math.round(sec / 5) * 5)} s` : `about ${Math.round(sec / 60)} min`)

// Each finished run is announced once, even when two lists show it.
const announced = new Set<string>()

export function RunStatus({ ids = [], match, pending = false, className = '' }: {
  // Runs started from here (shown even before the list catches up).
  ids?: string[]
  // Runs that belong here, started from anywhere (they survive a reload).
  match?: (j: JobView) => boolean
  // The click is being sent ("Submitting...").
  pending?: boolean
  className?: string
}) {
  const live = useLiveJobs()
  const toast = useToast()
  const box = useRef<HTMLDivElement | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const all = live.data?.jobs ?? []
  const list = all.filter(j => (ids.includes(j.id) || match?.(j)) && !dismissed.includes(j.id)).reverse()
  const missing = ids.filter(id => !all.some(j => j.id === id))
  const seen = useRef(new Map<string, string>())

  // Done or failed while scrolled away: a small toast that brings it back.
  useEffect(() => {
    for (const j of list) {
      const before = seen.current.get(j.id)
      seen.current.set(j.id, j.status)
      if (!before || !ACTIVE.includes(before) || ACTIVE.includes(j.status) || announced.has(j.id)) continue
      announced.add(j.id)
      const r = box.current?.getBoundingClientRect()
      const visible = !!r && r.bottom > 0 && r.top < window.innerHeight
      if (visible) continue
      const ok = j.status === 'completed'
      toast({ tone: ok ? 'ok' : 'bad', text: `${j.label}: ${ok ? 'done' : 'failed'}.`, action: { label: 'Show', run: () => box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } })
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  if (!list.length && !missing.length && !pending) return null
  // Many runs of one kind (a batch, several stills) read as one line.
  const groups = new Map<string, JobView[]>()
  for (const j of list) groups.set(j.purpose, [...(groups.get(j.purpose) ?? []), j])
  return (
    <div className={`st-runs ${className}`} ref={box} aria-live="polite">
      {(pending || missing.length > 0) && !list.length && <div className="st-run"><Loader2 size={15} className="st-spin" /><span className="st-run-text"><b>Submitting...</b></span></div>}
      {[...groups.values()].map(g => (g.length > 3
        ? <RunGroup key={g[0]!.purpose} jobs={g} onDismiss={() => setDismissed(d => [...d, ...g.map(x => x.id)])} />
        : g.map(j => <RunRow key={j.id} j={j} onDismiss={() => setDismissed(d => [...d, j.id])} />)))}
    </div>
  )
}

export function RunRow({ j, onDismiss, showLabel = true }: { j: JobView; onDismiss?: () => void; showLabel?: boolean }) {
  const active = ACTIVE.includes(j.status)
  const now = useNow(active)
  const elapsed = (now - Date.parse(j.since)) / 1000
  if (j.phase === 'failed' || j.phase === 'canceled' || j.phase === 'needs_attention') {
    const attention = j.phase === 'needs_attention'
    return (
      <div className={`st-run ${attention ? 'warn' : 'bad'}`} role="alert">
        {attention ? <AlertTriangle size={15} /> : <XCircle size={15} />}
        <div className="st-run-text">
          <b>{showLabel ? `${j.label}: ` : ''}{j.phase === 'canceled' ? 'canceled' : attention ? 'needs you' : 'failed'}.</b>{' '}
          {j.error}{' '}
          {j.charged === 'no' ? 'Nothing was charged.' : j.charged === 'maybe' ? 'The provider may have charged it; the amount stays reserved until you check (Activity).' : ''}
          {j.detail && <details className="st-run-details"><summary>Details</summary><pre>{j.detail}</pre></details>}
        </div>
        {j.retry && <PriceButton action={{ type: 'retry', jobId: j.id }} label="Retry" size="sm" variant="secondary" icon={false} compact />}
        {onDismiss && <button type="button" className="st-btn icon ghost sm" aria-label="Hide" onClick={onDismiss}><X size={13} /></button>}
      </div>
    )
  }
  if (j.phase === 'done') {
    const took = j.completedAt ? (Date.parse(j.completedAt) - Date.parse(j.createdAt)) / 1000 : null
    return (
      <div className="st-run ok">
        <CheckCircle2 size={15} />
        <span className="st-run-text">{showLabel ? <b>{j.label}: </b> : null}done{took != null ? ` in ${clock(took)}` : ''}.</span>
        {onDismiss && <button type="button" className="st-btn icon ghost sm" aria-label="Hide" onClick={onDismiss}><X size={13} /></button>}
      </div>
    )
  }
  const timed = TIMED.includes(j.phase)
  const showUsual = j.typicalSec != null && ['sent', 'provider_queued', 'generating', 'working', 'submitting'].includes(j.phase)
  return (
    <div className="st-run">
      {j.phase === 'waiting' ? <Circle size={15} /> : <Loader2 size={15} className="st-spin" />}
      <span className="st-run-text">
        {showLabel && <b>{j.label}: </b>}
        {j.phaseLabel}{j.phase === 'submitting' || j.phase === 'queued' ? '...' : ''}
        {timed && <span className="st-muted"> · {clock(elapsed)}{showUsual ? ` (usually ${usual(j.typicalSec!)})` : ''}</span>}
        {showUsual && elapsed > j.typicalSec! * 2.5 && <span className="st-muted"> Slower than usual; it keeps going.</span>}
      </span>
    </div>
  )
}

function RunGroup({ jobs, onDismiss }: { jobs: JobView[]; onDismiss: () => void }) {
  const done = jobs.filter(j => j.phase === 'done').length
  const failed = jobs.filter(j => ['failed', 'canceled', 'needs_attention'].includes(j.phase))
  const running = jobs.filter(j => ACTIVE.includes(j.status))
  const label = jobs[0]!.label.replace(/\s*\d+\s+of\s+\d+.*$|,\s*still\s+\d+$/i, '')
  const lead = running.find(j => j.phase === 'generating') ?? running[0]
  return (
    <div className="st-col" style={{ gap: 6 }}>
      <div className={`st-run ${running.length ? '' : failed.length ? 'bad' : 'ok'}`}>
        {running.length ? <Loader2 size={15} className="st-spin" /> : failed.length ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
        <span className="st-run-text"><b>{label}: </b>{done} of {jobs.length} done{failed.length ? `, ${failed.length} failed` : ''}{lead ? `; ${lead.phaseLabel.toLowerCase()}` : ''}.</span>
        {!running.length && <button type="button" className="st-btn icon ghost sm" aria-label="Hide" onClick={onDismiss}><X size={13} /></button>}
      </div>
      {failed.map(j => <RunRow key={j.id} j={j} />)}
    </div>
  )
}
