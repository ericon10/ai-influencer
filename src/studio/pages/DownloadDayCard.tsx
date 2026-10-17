import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Package } from 'lucide-react'
import { api, downloadUrl } from '../api'
import { keys, useWorkerGate } from '../hooks'
import { Todo, errorMessage, scrollToField, useToast } from '../ui'
import { HowTo } from '../guide/Guide'
import { RunStatus } from '../runs'
import { DAY_KEY, browserTz, dayLabel } from '../posting'
import type { PostingDayView } from '../types'

// Posts home > Download day (owner, 2026-10-17; UX-PLAN.md section 33):
// pick a day (today by default, this browser's own day), see every post of
// it in posting order, each going in or left out with the reason (free),
// then one button makes the zip on the worker (free): a folder per account,
// a subfolder per slot, checklist.txt and left-out.txt. Works at phone
// width: the list stacks, the button is full width.

const KEY = 'st-day-open'
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function DownloadDayCard() {
  const [params, setParams] = useSearchParams()
  const linked = params.get('day')
  const [open, setOpen] = useState(() => { try { return !!linked || localStorage.getItem(KEY) === '1' } catch { return !!linked } })
  useEffect(() => { try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* private window */ } }, [open])
  const [date, setDate] = useState(() => (linked && /^\d{4}-\d{2}-\d{2}$/.test(linked) ? linked : today()))
  // A link from a post's Finish step opens the card on its day.
  useEffect(() => {
    if (!linked) return
    if (/^\d{4}-\d{2}-\d{2}$/.test(linked)) { setDate(linked); setOpen(true); window.setTimeout(() => scrollToField('download-day'), 300) }
    params.delete('day'); setParams(params, { replace: true })
  }, [linked]) // eslint-disable-line react-hooks/exhaustive-deps
  const [packed, setPacked] = useState(false)
  const tz = useMemo(() => browserTz(), [])
  const view = useQuery({
    queryKey: [...DAY_KEY, date, packed], queryFn: () => api.postingDay({ date, includePacked: packed, tz }), enabled: open && !!date,
    refetchInterval: q => ((q.state.data as PostingDayView | undefined)?.running ? 2500 : false),
  })
  const v = view.data
  return (
    <section className="st-card" data-field="download-day" style={{ marginBottom: 18 }}>
      <div className="st-card-head st-row" style={{ gap: 10 }}>
        <button type="button" className="st-row grow" style={{ flex: 1, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', gap: 10, color: 'inherit', font: 'inherit', padding: 0 }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Package size={16} />
          <div className="grow">
            <div className="st-h3">Download day</div>
            <div className="st-hint">One zip for a day's posts: a folder per account and slot, the slides or video, caption.txt and post.json, and checklist.txt in posting order. Free.</div>
          </div>
        </button>
        <HowTo id="download-day" label="How Download day works" />
      </div>
      {open && (
        <div className="st-card-body st-col" style={{ gap: 14 }}>
          <div className="st-row" style={{ gap: 10, alignItems: 'center' }}>
            <input className="st-input" style={{ width: 'auto' }} type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Day" />
            <button type="button" className="st-btn sm ghost" disabled={date === today()} onClick={() => setDate(today())}>Today</button>
            <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
              <button type="button" role="switch" aria-checked={packed} aria-label="Include packed posts" className={`st-switch ${packed ? 'on' : ''}`} onClick={() => setPacked(!packed)}><span /></button>
              <span className="st-hint">Include packed posts (pack them again)</span>
            </label>
          </div>
          {v && <SlotTimes slots={v.slots} />}
          {!v ? <div className="st-skel" style={{ height: 120, borderRadius: 14 }} /> : <DayList v={v} />}
          {v && <MakeZip v={v} date={date} packed={packed} tz={tz} />}
          {v && v.packs.length > 0 && (
            <details className="st-col" data-field="day-packs">
              <summary className="st-hint" style={{ cursor: 'pointer' }}>Zips made ({v.packs.length})</summary>
              <ul className="st-daypacks">
                {v.packs.map(p => (
                  <li key={p.id}>
                    <span><b>{dayLabel(p.date)}</b> · {p.posts} post{p.posts === 1 ? '' : 's'}{p.leftOut ? `, ${p.leftOut} left out` : ''} · made {when(p.createdAt)}</span>
                    {p.assetId ? <a className="st-btn xs secondary" href={downloadUrl(p.assetId, `download-day-${p.date}.zip`)}><Download size={12} />Download</a> : <span className="st-hint">{p.status === 'failed' ? `Failed: ${p.error ?? ''}` : 'Being made...'}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

// The slots as clock times, in order (a setting; the defaults are data).
function SlotTimes({ slots }: { slots: PostingDayView['slots'] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [edit, setEdit] = useState<Record<string, string> | null>(null)
  if (!edit) {
    return (
      <div className="st-row" style={{ gap: 6 }} data-field="slot-times">
        <span className="st-label">Slot times</span>
        {slots.map(s => <span key={s.slot} className="st-chip xs">{s.slot} {s.time}</span>)}
        <button type="button" className="st-btn xs ghost" onClick={() => setEdit(Object.fromEntries(slots.map(s => [s.slot, s.time])))}>Change</button>
      </div>
    )
  }
  return (
    <div className="st-row" style={{ gap: 8, alignItems: 'center' }} data-field="slot-times">
      <span className="st-label">Slot times</span>
      {Object.entries(edit).map(([slot, time]) => (
        <label key={slot} className="st-row" style={{ gap: 4 }}><span className="st-hint">{slot}</span><input className="st-input sm" style={{ width: 'auto' }} type="time" value={time} onChange={e => setEdit({ ...edit, [slot]: e.target.value })} aria-label={`${slot} time`} /></label>
      ))}
      <button type="button" className="st-btn xs" onClick={async () => {
        try { await api.savePostingSlots(edit); setEdit(null); await Promise.all([qc.invalidateQueries({ queryKey: DAY_KEY }), qc.invalidateQueries({ queryKey: ['posting-slots'] })]) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
      }}>Save</button>
      <button type="button" className="st-btn xs ghost" onClick={() => setEdit(null)}>Cancel</button>
    </div>
  )
}

function DayList({ v }: { v: PostingDayView }) {
  if (!v.rows.length) return <span className="st-hint" data-field="day-empty">No post is planned for {dayLabel(v.date)}. A post's day is its plan row's date, or the day set in its Finish step (Post on).</span>
  let n = 0
  return (
    <div className="st-col" style={{ gap: 6 }}>
      <span className="st-hint" data-field="day-counts"><b>{v.counts.in} go in</b>{v.counts.out ? `, ${v.counts.out} left out` : ''}{v.counts.exportFirst ? `. ${v.counts.exportFirst} will be exported first (free).` : '.'}</span>
      <ol className="st-daylist" data-field="day-list">
        {v.rows.map(r => (
          <li key={r.id} className={`st-dayrow ${r.in ? 'in' : 'out'}`} data-field={`day-row-${r.id}`}>
            <div className="st-dayrow-top">
              <b className="st-dayrow-n">{r.in ? ++n : '·'}</b>
              <span className="st-dayrow-when">{r.slot ? `${r.slot} · ` : ''}{r.time ?? (r.slot ? 'no time set' : 'Any time')}</span>
              <span className="st-dayrow-acc">{r.account || 'No account'}</span>
              {r.ad && <span className="st-chip xs">Ad</span>}
              <span className="st-spacer" />
              <Link className="st-btn xs ghost" to={`/studio/posts/${r.id}`} aria-label={`Open ${r.name}`}><ExternalLink size={12} /></Link>
            </div>
            <span className="st-clamp1 st-dayrow-hook" title={r.hook}>{r.hook || r.name}</span>
            <span className={`st-hint ${r.in ? '' : 'st-warntext'}`} data-field="day-row-status">
              {r.in ? `Goes in: ${r.folder}/${r.exportFirst ? ' (exported first, free)' : r.exportedAt ? ` (export of ${when(r.exportedAt)})` : ''}` : `Left out: ${r.reason}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function MakeZip({ v, date, packed, tz }: { v: PostingDayView; date: string; packed: boolean; tz: string | null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const worker = useWorkerGate()
  const [starting, setStarting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const running = !!v.running
  const last = v.packs.find(p => p.date === date && p.assetId)
  const todo = v.counts.in ? [] : [{ label: v.rows.length ? 'Approve a post of this day (its card or Finish), or switch on Include packed posts' : 'Pick a day with posts' }]
  async function go() {
    setStarting(true)
    try {
      const r = await api.postingPack({ date, includePacked: packed, tz })
      setJobId(r.jobId)
      await qc.invalidateQueries({ queryKey: DAY_KEY })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setStarting(false) }
  }
  // When the zip is done, the posts show as packed.
  useEffect(() => { if (!running && jobId) void qc.invalidateQueries({ queryKey: keys.content }) }, [running, jobId, qc])
  return (
    <div className="st-col" style={{ gap: 8 }} data-field="day-make">
      <Todo items={todo} />
      <button type="button" className="st-btn primary st-daybtn" disabled={!v.counts.in || running || starting || !worker.ready} onClick={() => void go()}>
        {starting || running ? <Loader2 size={16} className="st-spin" /> : <Package size={16} />}
        {starting ? 'Submitting...' : running ? 'Making the zip...' : `Make the zip · ${v.counts.in} post${v.counts.in === 1 ? '' : 's'}`}
        {!starting && !running && <span className="st-price">Free</span>}
      </button>
      {!worker.ready && <span className="st-hint st-warntext">{worker.reason}</span>}
      <RunStatus ids={jobId ? [jobId] : []} match={j => j.purpose === `posting_pack:${date}`} pending={starting} />
      {last && !running && <a className="st-btn secondary st-daybtn" href={downloadUrl(last.assetId!, `download-day-${date}.zip`)} data-field="day-download"><Download size={15} />Download the zip ({last.posts} post{last.posts === 1 ? '' : 's'}, made {when(last.createdAt)})</a>}
      <span className="st-hint">Made on the Studio's worker: no provider, no cost. Each post that goes in is marked Packed, so the next zip of this day leaves it out. Turn on the AI-generated content label on every post.</span>
    </div>
  )
}
