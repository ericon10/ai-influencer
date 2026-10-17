import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart3, ChevronDown, ChevronRight, ExternalLink, Upload } from 'lucide-react'
import { api } from '../api'
import { keys } from '../hooks'
import { AsyncButton, errorMessage, useToast } from '../ui'
import { HowTo } from '../guide/Guide'
import { HintLines, RESULTS_KEY, useResultsView } from '../results'
import { DIMENSION_LABEL, FIELD_LABEL, shortCount, type Dimension, type ResultField } from '../../../server/core/results'
import type { ResultRow, ResultsCsvPreview } from '../types'

// Posts home > Results (owner, 2026-10-17; UX-PLAN.md section 32): totals
// and follows per post by account, product, character and hook structure
// (sorted by follows per post, the playbook's measure), a date range on
// posted_at, the decision hints, and the CSV paste by row_id (a free
// preview, then Apply). Follows the Posts home filters. Collapsed by default.

const KEY = 'st-results-open'
const DIMS: Dimension[] = ['account', 'product', 'character', 'structure']
const n = (v: number | null) => (v == null ? 'n/a' : v.toLocaleString())

export function ResultsCard({ tag, character, product, filtered }: { tag: string | null; character: string | null; product: string | null; filtered: boolean }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* private window */ } }, [open])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [dim, setDim] = useState<Dimension>('account')
  const view = useResultsView({ from: from || null, to: to || null, tag, character, product })
  const v = view.data
  const t = v?.totals
  return (
    <section className="st-card" data-field="results-card" style={{ marginBottom: 18 }}>
      <div className="st-card-head st-row" style={{ gap: 10 }}>
        <button type="button" className="st-row grow" style={{ flex: 1, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', gap: 10, color: 'inherit', font: 'inherit', padding: 0 }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <BarChart3 size={16} />
          <div className="grow">
            <div className="st-h3">Results</div>
            <div className="st-hint">{v && v.withResults ? `${v.withResults} post${v.withResults === 1 ? '' : 's'} with results · ${n(v.totals.followsPerPost)} follows per post${filtered ? ' (filtered)' : ''}` : 'Type each post\'s numbers on its card, or paste them here from a CSV. Free.'}</div>
          </div>
        </button>
        <HowTo id="results" label="How results work" />
      </div>
      {open && (
        <div className="st-card-body st-col" style={{ gap: 16 }}>
          <div className="st-row" style={{ gap: 8, alignItems: 'center' }} data-field="results-range">
            <span className="st-label">Posted</span>
            <input className="st-input sm" style={{ width: 'auto' }} type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Posted from" />
            <span className="st-hint">to</span>
            <input className="st-input sm" style={{ width: 'auto' }} type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Posted to" />
            {(from || to) && <button type="button" className="st-btn xs ghost" onClick={() => { setFrom(''); setTo('') }}>Any date</button>}
            {filtered && <span className="st-hint">The Account, Character and Product filters above apply here too.</span>}
          </div>
          {t && (
            <div className="st-stats" data-field="results-totals">
              <div className="st-stat head"><span className="st-hint">Follows per post</span><b data-field="results-fpp">{n(t.followsPerPost)}</b></div>
              <div className="st-stat"><span className="st-hint">Posts with results</span><b data-field="results-posts">{t.posts}</b></div>
              <div className="st-stat"><span className="st-hint">Follows</span><b data-field="results-follows">{n(t.follows)}</b></div>
              <div className="st-stat"><span className="st-hint">Views</span><b data-field="results-views">{n(t.views)}</b></div>
              <div className="st-stat"><span className="st-hint">Saves</span><b>{n(t.saves)}</b></div>
              <div className="st-stat"><span className="st-hint">Shares</span><b>{n(t.shares)}</b></div>
            </div>
          )}
          {!!v?.undated && <span className="st-hint">{v.undated} post{v.undated === 1 ? ' has' : 's have'} results but no posted at, so {v.undated === 1 ? 'it is' : 'they are'} not in a date range.</span>}

          {!!v?.hinted.length && (
            <div className="st-col" style={{ gap: 8 }} data-field="results-hints">
              <span className="st-label">Hints (yours to decide: nothing happens on its own)</span>
              {v.hinted.slice(0, 12).map(p => (
                <div key={p.id} className="st-row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Link className="st-btn ghost xs" to={`/studio/posts/${p.id}`}><ExternalLink size={12} />{p.name.slice(0, 48)}</Link>
                  <span className="st-hint">{[p.accountTag, p.views != null && `${shortCount(p.views)} views`].filter(Boolean).join(' · ')}</span>
                  <HintLines hints={p.hints} item={p} />
                </div>
              ))}
            </div>
          )}

          <div className="st-col" style={{ gap: 8 }} data-field="results-breakdown">
            <div className="st-row" style={{ gap: 6 }}>
              <span className="st-label">By</span>
              {DIMS.map(d => <button key={d} type="button" className={`st-chip ${dim === d ? 'on' : ''}`} aria-pressed={dim === d} onClick={() => setDim(d)}>{DIMENSION_LABEL[d]}</button>)}
            </div>
            {v && <Breakdown rows={v.by[dim]} label={DIMENSION_LABEL[dim]} />}
            <span className="st-hint">Sorted by follows per post: decide by follows first, then saves and shares, never by views alone. Hook structure is the plan's code (or the hook's, from Use this hook).</span>
          </div>

          <PasteResults />
        </div>
      )}
    </section>
  )
}

function Breakdown({ rows, label }: { rows: ResultRow[]; label: string }) {
  if (!rows.length) return <span className="st-hint">No results yet{label ? '' : ''}. Type them on a post's card, or paste a CSV below.</span>
  return (
    <div className="st-tablewrap">
      <table className="st-table st-resultstable" data-field="results-table">
        <thead><tr><th>{label}</th><th className="num">Posts</th><th className="num">Follows per post</th><th className="num">Follows</th><th className="num">Views</th><th className="num">Saves</th><th className="num">Shares</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key || `none-${i}`} className={i === 0 ? 'lead' : undefined}>
              <td><b>{r.label}</b></td><td className="num" data-label="Posts">{r.posts}</td><td className="num lead" data-label="Follows per post"><b>{n(r.followsPerPost)}</b></td><td className="num" data-label="Follows">{n(r.follows)}</td><td className="num" data-label="Views">{n(r.views)}</td><td className="num" data-label="Saves">{n(r.saves)}</td><td className="num" data-label="Shares">{n(r.shares)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Paste or upload a CSV by row_id (or post_id): a free preview of what
// changes, then Apply.
function PasteResults() {
  const toast = useToast()
  const qc = useQueryClient()
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<ResultsCsvPreview | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  async function load(f: File | undefined) {
    if (!f) return
    if (f.size > 400_000) { toast({ tone: 'bad', text: `${f.name} is over 400 KB. Split it.` }); return }
    setCsv(await f.text()); setName(f.name); setPreview(null); setDone(null)
  }
  const changing = preview?.rows.filter(r => r.state === 'change') ?? []
  const problems = preview?.rows.filter(r => r.state === 'error' || r.state === 'ambiguous') ?? []
  return (
    <div className="st-col" style={{ gap: 10 }} data-field="results-paste">
      <span className="st-label">Paste results from a CSV</span>
      <span className="st-hint">Columns, by name in any order: row_id (the plan's; or post_id, the Studio's id, for a post with no plan row), post_url, posted_at, views_72h, follows_72h, saves_72h, shares_72h, decision (Make 3 variations, Keep, One more try, Drop or none), notes. Add an account column when two posts share a row_id. 12.4K and 1,203 work; a blank cell leaves that field as it is.</span>
      <input ref={file} type="file" accept=".csv,.tsv,text/csv,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void load(f) }} />
      <div className="st-row" style={{ gap: 8 }}>
        <button type="button" className="st-btn sm secondary" onClick={() => file.current?.click()}><Upload size={13} />Upload the CSV</button>
        {name && <span className="st-hint">{name}</span>}
      </div>
      <textarea className="st-textarea" rows={4} value={csv} onChange={e => { setCsv(e.target.value); setName(''); setPreview(null); setDone(null) }} placeholder={'e.g.\nrow_id,views_72h,follows_72h,saves_72h,shares_72h,decision\nP001,12.4K,31,1203,88,Make 3 variations'} aria-label="Results CSV" />
      <div className="st-row" style={{ gap: 8 }}>
        <AsyncButton className="st-btn sm" disabled={!csv.trim()} title={csv.trim() ? undefined : 'Paste or upload the CSV first'} busyLabel="Reading..." onClick={async () => {
          try { setPreview(await api.resultsCsvPreview(csv)); setDone(null) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
        }}>Preview (free)</AsyncButton>
        {preview && (
          <AsyncButton className="st-btn sm primary" disabled={!changing.length} title={changing.length ? undefined : 'No row changes a post'} busyLabel="Applying..." onClick={async () => {
            try {
              const r = await api.resultsCsvApply(csv)
              setDone(`${r.updated} post${r.updated === 1 ? '' : 's'} updated${r.same ? `, ${r.same} already the same` : ''}${r.skipped ? `, ${r.skipped} left out` : ''}.`)
              setPreview(await api.resultsCsvPreview(csv))
              await Promise.all([qc.invalidateQueries({ queryKey: keys.content }), qc.invalidateQueries({ queryKey: RESULTS_KEY })])
            } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
          }}>Apply {changing.length || ''} change{changing.length === 1 ? '' : 's'}</AsyncButton>
        )}
      </div>
      {done && <span className="st-hint" role="status" data-field="results-applied">{done}</span>}
      {preview && (
        <div className="st-col" style={{ gap: 8 }} data-field="results-preview">
          {preview.problems.map(p => <span key={p} className="st-hint st-warntext">{p}</span>)}
          <span className="st-hint" data-field="results-preview-totals">{preview.totals.rows} rows: {preview.totals.matched} matched a post, {preview.totals.change} change something, {preview.totals.same} already the same{preview.totals.unmatched ? `, ${preview.totals.unmatched} not found` : ''}{preview.totals.ambiguous ? `, ${preview.totals.ambiguous} match more than one post` : ''}{preview.totals.error ? `, ${preview.totals.error} with a problem` : ''}.</span>
          {preview.unmatched.length > 0 && <span className="st-hint st-warntext" data-field="results-unmatched">Not found: {preview.unmatched.slice(0, 30).join(', ')}{preview.unmatched.length > 30 ? ` and ${preview.unmatched.length - 30} more` : ''}</span>}
          {problems.map(r => <span key={r.line} className="st-hint st-warntext">Line {r.line} ({r.key || 'no id'}): {r.errors.join('; ')}</span>)}
          {changing.length > 0 && (
            <div className="st-tablewrap" style={{ maxHeight: 320, overflow: 'auto' }}>
              <table className="st-table st-resultstable">
                <thead><tr><th>Row</th><th>Post</th><th>Account</th><th>Changes</th></tr></thead>
                <tbody>
                  {changing.map(r => (
                    <tr key={r.line} data-field={`results-row-${r.key}`}>
                      <td><b>{r.key}</b></td>
                      <td style={{ maxWidth: 260 }}><span className="st-clamp1" title={r.postName}>{r.postName}</span></td>
                      <td data-label="Account">{r.account}</td>
                      <td className="wide">{r.changes.map(c => <div key={c.field} className="st-hint"><b>{FIELD_LABEL[c.field as ResultField]}</b>: {c.from || 'empty'} to {c.to || 'empty'}</div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
