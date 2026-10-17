import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Lightbulb, Loader2, TrendingUp } from 'lucide-react'
import { api } from './api'
import { keys } from './hooks'
import { errorMessage } from './ui'
import {
  DECISIONS, DECISION_LABEL, DECISION_TONE, NUMBER_FIELDS, emptyResults, hasResults, readCount, readPostedAt, shortCount,
  type Decision, type NumberField, type PostResults, type ResultHint,
} from '../../server/core/results'
import type { ContentItem } from './types'

// Results (owner, 2026-10-17; UX-PLAN.md section 32): a post's results,
// typed on its card on Posts home or in its Finish step. Saved as typed
// ("Saving..." then "Saved"); numbers take "12.4K" and "1,203"; a phone
// gets the number pad. The decision is a small colored chip; the hints
// (never automatic) say when to make variations or drop a hook family.

export const RESULTS_KEY = ['results'] as const
type Q = { from?: string | null; to?: string | null; tag?: string | null; character?: string | null; product?: string | null }
export function useResultsView(q: Q = {}) {
  return useQuery({ queryKey: [...RESULTS_KEY, q], queryFn: () => api.results(q), staleTime: 10_000 })
}

export const resultsOf = (item: ContentItem): PostResults | null => (item.spec as { results?: PostResults | null }).results ?? null

export function DecisionChip({ decision }: { decision: Decision | null | undefined }) {
  if (!decision) return null
  return <span className={`st-badge ${DECISION_TONE[decision]}`} data-field="decision-chip">{DECISION_LABEL[decision]}</span>
}

// One line: the views and follows (follows first, the playbook's measure).
export function resultsSummary(r: PostResults | null): string {
  if (!r || !hasResults(r)) return r?.postUrl || r?.postedAt ? 'Posted, no numbers yet' : 'No results yet'
  return [r.follows72h != null && `${shortCount(r.follows72h)} follows`, r.views72h != null && `${shortCount(r.views72h)} views`, r.saves72h != null && `${shortCount(r.saves72h)} saves`].filter(Boolean).join(' · ')
}

// The hints on a post: 50K+ views (Make variations is the one-click way on
// a slideshow), or a hook family under 1K twice.
export function HintLines({ hints, item, link = true }: { hints: ResultHint[] | undefined; item: { id: string; kind: string }; link?: boolean }) {
  if (!hints?.length) return null
  return (
    <div className="st-col" style={{ gap: 4 }} data-field="result-hints">
      {hints.map(h => (
        <span key={h.kind} className={`st-hintline ${h.kind}`}>
          {h.kind === 'variations' ? <TrendingUp size={13} /> : <Lightbulb size={13} />}
          <span>{h.text}</span>
          {h.kind === 'variations' && item.kind === 'slideshow' && link && <Link className="st-hintline-go" to={`/studio/posts/${item.id}?step=finish&field=slideshow-variations`}>Make variations</Link>}
        </span>
      ))}
    </div>
  )
}

type Form = Record<'postUrl' | 'postedAt' | 'notes' | NumberField, string> & { decision: Decision | null }
const toForm = (r: PostResults | null): Form => {
  const x = r ?? emptyResults()
  // A day with no time shows as midnight in the picker (the day is what counts).
  const posted = x.postedAt && x.postedAt.length === 10 ? `${x.postedAt}T00:00` : x.postedAt
  return { postUrl: x.postUrl, postedAt: posted, notes: x.notes, decision: x.decision, views72h: x.views72h == null ? '' : String(x.views72h), follows72h: x.follows72h == null ? '' : String(x.follows72h), saves72h: x.saves72h == null ? '' : String(x.saves72h), shares72h: x.shares72h == null ? '' : String(x.shares72h) }
}
const LABEL: Record<NumberField, string> = { views72h: 'Views', follows72h: 'Follows', saves72h: 'Saves', shares72h: 'Shares' }

// The fields. Saves 0.7 s after the last keystroke; follows the server only
// while nothing in it has focus, so a save never rewrites what is typed.
export function ResultsFields({ item, compact = false }: { item: ContentItem; compact?: boolean }) {
  const qc = useQueryClient()
  const saved = resultsOf(item)
  const [form, setForm] = useState<Form>(() => toForm(saved))
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [bad, setBad] = useState<Partial<Record<NumberField | 'postedAt', string>>>({})
  const dirty = useRef<Partial<Form>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focused = useRef(false)
  const savedKey = JSON.stringify(saved)
  useEffect(() => { if (!focused.current && !Object.keys(dirty.current).length) setForm(toForm(saved)) }, [savedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const d = dirty.current
    dirty.current = {}
    const patch: Partial<Omit<PostResults, 'updatedAt'>> = {}
    const problems: typeof bad = {}
    for (const f of NUMBER_FIELDS) {
      if (d[f] === undefined) continue
      const v = readCount(d[f]!)
      if ('error' in v) problems[f] = 'Not a number (e.g. 12.4K or 1,203)'
      else patch[f] = v.value ?? null
    }
    if (d.postedAt !== undefined) {
      const v = d.postedAt.trim() ? readPostedAt(d.postedAt) : ''
      if (v === null) problems.postedAt = 'Not a date and time'
      else patch.postedAt = v
    }
    if (d.postUrl !== undefined) patch.postUrl = d.postUrl.trim()
    if (d.notes !== undefined) patch.notes = d.notes
    if (d.decision !== undefined) patch.decision = d.decision
    setBad(b => {
      const next = { ...b }
      for (const k of Object.keys(d)) delete next[k as keyof typeof next]
      return { ...next, ...problems }
    })
    if (!Object.keys(patch).length) { setState('idle'); return }
    setState('saving'); setError(null)
    try {
      await api.setResults(item.id, patch)
      setState(Object.keys(dirty.current).length ? 'saving' : 'saved')
      await Promise.all([qc.invalidateQueries({ queryKey: keys.content }), qc.invalidateQueries({ queryKey: RESULTS_KEY })])
    } catch (e) { setError(errorMessage(e)); setState('idle') }
  }
  function set<K extends keyof Form>(k: K, v: Form[K], now = false) {
    setForm(f => ({ ...f, [k]: v }))
    dirty.current = { ...dirty.current, [k]: v }
    setState('saving')
    if (timer.current) clearTimeout(timer.current)
    if (now) void flush()
    else timer.current = setTimeout(() => void flush(), 700)
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush() } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const id = (k: string) => `res-${item.id}-${k}`
  return (
    <div className={`st-resultsform ${compact ? 'compact' : ''}`} data-field="results-fields"
      onFocus={() => { focused.current = true }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { focused.current = false; if (dirty.current && Object.keys(dirty.current).length) void flush() } }}>
      <div className="st-resultsgrid">
        {NUMBER_FIELDS.map(f => (
          <label key={f} className="st-field" htmlFor={id(f)}>
            <span className="st-label">{LABEL[f]} <span className="st-hint">72h</span></span>
            <input id={id(f)} className={`st-input sm ${bad[f] ? 'bad' : ''}`} inputMode="numeric" autoComplete="off" value={form[f]} placeholder="e.g. 12.4K" onChange={e => set(f, e.target.value)} aria-label={`${LABEL[f]} in 72 hours`} aria-invalid={!!bad[f]} />
            {bad[f] && <span className="st-hint bad">{bad[f]}</span>}
          </label>
        ))}
        <label className="st-field wide" htmlFor={id('url')}>
          <span className="st-label">Post URL</span>
          <input id={id('url')} className="st-input sm" type="url" inputMode="url" autoComplete="off" value={form.postUrl} placeholder="e.g. https://www.tiktok.com/@you/photo/..." onChange={e => set('postUrl', e.target.value)} aria-label="Post URL" />
        </label>
        <label className="st-field wide" htmlFor={id('posted')}>
          <span className="st-label">Posted at</span>
          <input id={id('posted')} className={`st-input sm ${bad.postedAt ? 'bad' : ''}`} type="datetime-local" value={form.postedAt} onChange={e => set('postedAt', e.target.value)} aria-label="Posted at" />
          {bad.postedAt && <span className="st-hint bad">{bad.postedAt}</span>}
        </label>
      </div>
      <div className="st-col" style={{ gap: 6 }}>
        <span className="st-label">Decision</span>
        <div className="st-row" style={{ gap: 6 }} role="group" aria-label="Decision">
          <button type="button" className={`st-chip ${!form.decision ? 'on' : ''}`} aria-pressed={!form.decision} onClick={() => set('decision', null, true)}>None</button>
          {DECISIONS.map(d => <button key={d} type="button" className={`st-chip ${form.decision === d ? 'on' : ''}`} aria-pressed={form.decision === d} onClick={() => set('decision', d, true)}>{DECISION_LABEL[d]}</button>)}
        </div>
      </div>
      <label className="st-field" htmlFor={id('notes')}>
        <span className="st-label">Notes</span>
        <textarea id={id('notes')} className="st-textarea" rows={2} style={{ minHeight: 56 }} value={form.notes} placeholder="e.g. why it worked: the structure, the effect, the first slide" onChange={e => set('notes', e.target.value)} aria-label="Notes" />
      </label>
      <span className="st-hint" role="status" data-field="results-status">
        {state === 'saving' ? <><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> Saving...</> : state === 'saved' ? <><Check size={12} style={{ verticalAlign: -2 }} /> Saved</> : 'Saves as you type. Free.'}
        {error && <span className="st-warntext"> {error}</span>}
      </span>
    </div>
  )
}

// The card's Results row: one line (the numbers and the decision chip) that
// opens to the fields.
export function ResultsRow({ item, hints }: { item: ContentItem; hints?: ResultHint[] }) {
  const [open, setOpen] = useState(false)
  const r = resultsOf(item)
  return (
    <div className="st-col" style={{ gap: 6 }} data-field="post-results">
      <div className="st-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button type="button" className="st-results-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<b>Results</b><span className="st-hint st-clamp1">{resultsSummary(r)}</span>
        </button>
        <DecisionChip decision={r?.decision} />
      </div>
      <HintLines hints={hints} item={item} />
      {open && <ResultsFields item={item} compact />}
    </div>
  )
}
