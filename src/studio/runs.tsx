import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Info, Loader2, X, XCircle } from 'lucide-react'
import { clearedRuns, clearRuns, failureLine, jobFailureKind } from './failures'
import { useLiveJobs } from './hooks'
import { useToast } from './ui'
import { PriceButton } from './PriceButton'
import { SentButton } from './pages/character/SentPanel'
import { HowTo } from './guide/Guide'
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

export function RunStatus({ ids = [], match, pending = false, className = '', hideEarlier = false }: {
  // Runs started from here (shown even before the list catches up).
  ids?: string[]
  // Runs that belong here, started from anywhere (they survive a reload).
  match?: (j: JobView) => boolean
  // The click is being sent ("Submitting...").
  pending?: boolean
  className?: string
  // Earlier failures are folded elsewhere on screen (a stills grid).
  hideEarlier?: boolean
}) {
  const live = useLiveJobs()
  const toast = useToast()
  const box = useRef<HTMLDivElement | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [cleared, setCleared] = useState(() => clearedRuns())
  const [showOld, setShowOld] = useState(false)
  const all = live.data?.jobs ?? []
  const list = all.filter(j => (ids.includes(j.id) || match?.(j)) && !dismissed.includes(j.id)).reverse()
  // Earlier failures in one gray line (owner, 2026-10-15): only the run just
  // started from here, or the newest run, can show its failures red.
  const newestAt = Math.max(0, ...list.map(j => Date.parse(j.createdAt)))
  const fresh = (j: JobView) => ids.includes(j.id) || newestAt - Date.parse(j.createdAt) < 5000
  const failedOld = (j: JobView) => (j.phase === 'failed' || j.phase === 'canceled') && !fresh(j) && !notNeeded(j)
  const old = hideEarlier ? [] : list.filter(j => failedOld(j) && !cleared.has(j.id))
  const current = list.filter(j => !failedOld(j))
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

  if (!current.length && !old.length && !missing.length && !pending) return null
  // Many runs of one kind (a batch, several stills) read as one line.
  const groups = new Map<string, JobView[]>()
  for (const j of current) groups.set(j.purpose, [...(groups.get(j.purpose) ?? []), j])
  return (
    <div className={`st-runs ${className}`} ref={box} aria-live="polite">
      {(pending || missing.length > 0) && !list.length && <div className="st-run live" data-live="true"><Loader2 size={15} className="st-spin" /><span className="st-run-text"><b>Submitting...</b></span></div>}
      {[...groups.values()].map(g => (g.length > 3
        ? <RunGroup key={g[0]!.purpose} jobs={g} onDismiss={() => setDismissed(d => [...d, ...g.map(x => x.id)])} />
        : g.map(j => <RunRow key={j.id} j={j} onDismiss={() => setDismissed(d => [...d, j.id])} />)))}
      {old.length > 0 && (
        <FailureLine
          text={`Earlier: ${failureLine(old.map(j => ({ kind: jobFailureKind(j), facePass: /^Face pass/.test(j.label), charged: j.charged })))}`}
          open={showOld}
          onToggle={() => setShowOld(v => !v)}
          onClear={() => { clearRuns(old.map(j => j.id)); setCleared(clearedRuns()); setShowOld(false) }}
        />
      )}
      {showOld && old.map(j => <RunRow key={j.id} j={j} />)}
    </div>
  )
}

// After a refusal by the provider's filter (owner, 2026-10-15; G46): the
// likely trigger words in what was sent, and the same run with only those
// words reworded by code. The rewording is free; the run is priced.
export function Triggers({ words }: { words: string[] }) {
  return <span className="st-triggers" data-field="trigger-words">Likely trigger words: {words.join(', ')}. <HowTo id="feedback" label="Why" /></span>
}

export function SaferRetry({ jobId, onStarted }: { jobId: string; onStarted?: (ids: string[]) => void }) {
  return <PriceButton action={{ type: 'retry_safer', jobId }} label="Retry with safer wording" size="sm" variant="secondary" icon={false} compact onStarted={onStarted} />
}

// A run released before it started because it was not needed (a slideshow
// slide that became a special slide): neither done nor failed, never red.
export const notNeeded = (j: JobView) => j.phase === 'canceled' && j.charged !== 'yes' && /^Not needed:/.test(j.error ?? '')

export function RunRow({ j, onDismiss, showLabel = true }: { j: JobView; onDismiss?: () => void; showLabel?: boolean }) {
  const active = ACTIVE.includes(j.status)
  const now = useNow(active)
  const elapsed = (now - Date.parse(j.since)) / 1000
  if (notNeeded(j)) {
    return (
      <div className="st-run">
        <Info size={15} />
        <span className="st-run-text">{showLabel ? <b>{j.label}: </b> : null}{(j.error ?? '').replace(/^Not needed:\s*/, 'not needed, ')}</span>
        {onDismiss && <button type="button" className="st-btn icon ghost sm" aria-label="Hide" onClick={onDismiss}><X size={13} /></button>}
      </div>
    )
  }
  if (j.phase === 'failed' || j.phase === 'canceled' || j.phase === 'needs_attention') {
    const attention = j.phase === 'needs_attention'
    return (
      <div className={`st-run ${attention ? 'warn' : 'bad'}`} role="alert">
        {attention ? <AlertTriangle size={15} /> : <XCircle size={15} />}
        <div className="st-run-text">
          <b>{showLabel ? `${j.label}: ` : ''}{j.phase === 'canceled' ? 'canceled' : attention ? 'needs you' : 'failed'}.</b>{' '}
          {j.error}{' '}
          {j.charged === 'no' ? 'Nothing was charged.' : j.charged === 'maybe' ? 'The provider may have charged it; the amount stays reserved until you check (Activity).' : ''}
          {j.triggers?.length > 0 && <Triggers words={j.triggers} />}
          {j.detail && <details className="st-run-details"><summary>Details</summary><pre>{j.detail}</pre></details>}
          {/* The actions sit under the words, so the words keep the width. */}
          <div className="st-run-actions">
            {/* What was sent, failed runs included (owner, 2026-10-15). */}
            {j.kind !== 'llm' && j.kind !== 'local' && <SentButton jobId={j.id} size="xs" />}
            {j.safer && <SaferRetry jobId={j.id} />}
            {j.retry && <PriceButton action={{ type: 'retry', jobId: j.id }} label="Retry" size="sm" variant="secondary" icon={false} compact />}
          </div>
        </div>
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
    <div className="st-run live" data-live="true">
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

// Earlier failures, one gray line: Show opens them, Clear puts them away.
export function FailureLine({ text, open, onToggle, onClear }: { text: string; open: boolean; onToggle: () => void; onClear: () => void }) {
  return (
    <div className="st-failline" role="status" data-field="failure-line">
      <Info size={14} />
      <span className="grow">{text}</span>
      <button type="button" className="st-btn xs ghost" onClick={onToggle} aria-expanded={open}>{open ? 'Hide them' : 'Show'}</button>
      <button type="button" className="st-btn xs ghost" onClick={onClear}>Clear</button>
      <HowTo id="feedback" label="About failed runs" />
    </div>
  )
}

function RunGroup({ jobs, onDismiss }: { jobs: JobView[]; onDismiss: () => void }) {
  const done = jobs.filter(j => j.phase === 'done').length
  const released = jobs.filter(notNeeded).length
  const failed = jobs.filter(j => ['failed', 'canceled', 'needs_attention'].includes(j.phase) && !notNeeded(j))
  const running = jobs.filter(j => ACTIVE.includes(j.status))
  const label = jobs[0]!.label.replace(/\s*\d+\s+of\s+\d+.*$|,\s*still\s+\d+$/i, '')
  const lead = running.find(j => j.phase === 'generating') ?? running[0]
  // A queued group waiting on the daily cap says why, as written (section 31).
  const capWait = running.find(j => j.phase === 'waiting' && /^Waits:/.test(j.phaseLabel))
  return (
    <div className="st-col" style={{ gap: 6 }}>
      <div className={`st-run ${running.length ? 'live' : failed.length ? 'bad' : 'ok'}`} data-live={running.length ? 'true' : undefined}>
        {running.length ? <Loader2 size={15} className="st-spin" /> : failed.length ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
        <span className="st-run-text"><b>{label}: </b>{done} of {jobs.length - released} done{released ? ` (${released} not needed)` : ''}{failed.length ? `, ${failed.length} failed` : ''}{capWait ? '.' : lead ? `; ${lead.phaseLabel.toLowerCase()}.` : '.'}{capWait && <span data-field="cap-wait"> {capWait.phaseLabel}</span>}</span>
        {!running.length && <button type="button" className="st-btn icon ghost sm" aria-label="Hide" onClick={onDismiss}><X size={13} /></button>}
      </div>
      {failed.map(j => <RunRow key={j.id} j={j} />)}
    </div>
  )
}
