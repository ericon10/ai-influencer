import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { api } from '../api'
import { PriceButton } from '../PriceButton'
import { useProducts } from '../hooks'
import { AsyncButton, errorMessage, useToast } from '../ui'
import { HowTo } from '../guide/Guide'
import { ImportBox, RunBox } from './post/LineBank'
import type { BankPage, LinesImportResult } from '../types'

// The line bank's own page (owner, 2026-10-22; UX-PLAN.md section 37,
// items 6 to 8): every line with its text, source, likes, pain, emotion,
// format, voice fit, life or job and where it was used; Import lines (a CSV
// from the pain inventory, a transcript, the competitor research, or Claude
// in chat; near-matches dropped), Tag the bank (priced), the comment scrape
// import and run (as in the drawer), the filters and Download as CSV. The
// drawer in the post workspace stays.

const FITS: Record<string, string> = { first: 'First person', secondhand: 'Secondhand', both: 'Both' }

export default function LineBankPage() {
  const qc = useQueryClient()
  const [f, setF] = useState<Record<string, string | undefined>>({})
  const q = useQuery({ queryKey: ['bank-page', f], queryFn: () => api.bankPage({ ...f, limit: '500' }), staleTime: 5_000 })
  const old = useQuery({ queryKey: ['line-bank', {}], queryFn: () => api.lineBank({}), staleTime: 10_000 })
  const v: BankPage | undefined = q.data
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['bank-page'] }); void qc.invalidateQueries({ queryKey: ['line-bank'] }) }
  const set = (k: string, val: string) => setF(x => ({ ...x, [k]: val || undefined }))
  return (
    <div className="st-page wide" data-field="line-bank-page">
      <div className="st-pagehead" style={{ marginBottom: 14 }}>
        <div className="grow">
          <div className="st-kicker">Lines that hit, from real people</div>
          <div className="st-titlerow"><h1 className="st-h1">Line bank</h1><HowTo id="line-bank" /></div>
          {v && <p className="st-sub" style={{ margin: 0 }} data-field="line-bank-page-counts">{v.counts.lines.toLocaleString()} lines · {v.counts.life} life · {v.counts.job} job · {v.counts.untagged} not tagged life or job · {v.counts.used} used. Weeks draws from these (Fill).</p>}
        </div>
      </div>

      <div className="st-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 }}>
        <ImportLines onDone={refresh} />
        <section className="st-card"><div className="st-card-body st-col" style={{ gap: 8 }} data-field="line-bank-retag">
          <span className="st-h3">Tag the bank</span>
          <span className="st-hint">Every line that passed gets life or job, and its pain, emotion, format and voice fit checked again. One Claude call per 30 lines, priced on the button. Fill never puts a job line in a life slot: an untagged line counts as job.</span>
          <PriceButton label={v?.counts.untagged ? `Tag ${v.counts.untagged} line${v.counts.untagged === 1 ? '' : 's'}` : 'Tag every line again'} action={v ? { type: 'bank_retag', ...(v.counts.untagged ? {} : { all: true }) } : null} onDone={refresh} />
        </div></section>
      </div>

      <section className="st-card" style={{ marginBottom: 14 }}><div className="st-card-body st-col" style={{ gap: 10 }}>
        <span className="st-h3">Lines from a comment scrape</span>
        <ImportBox open={false} last={old.data?.imports[0] ?? null} onDone={refresh} />
        {(old.data?.counts.waiting ?? 0) > 0 && <RunBox waiting={old.data!.counts.waiting} onStarted={refresh} />}
      </div></section>

      <section className="st-card"><div className="st-card-body st-col" style={{ gap: 10 }}>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-field="line-bank-page-filters">
          <Pick label="Pain" value={f.pain} options={v?.options.pains ?? []} onChange={x => set('pain', x)} />
          <Pick label="Emotion" value={f.emotion} options={v?.options.emotions ?? []} onChange={x => set('emotion', x)} />
          <Pick label="Format" value={f.format} options={v?.options.formats ?? []} onChange={x => set('format', x)} />
          <Pick label="Voice fit" value={f.fits} options={['first', 'secondhand', 'both']} names={FITS} onChange={x => set('fits', x)} />
          <Pick label="Life or job" value={f.lifeOrJob} options={['life', 'job', 'untagged']} names={{ life: 'Life', job: 'Job', untagged: 'Not tagged' }} onChange={x => set('lifeOrJob', x)} />
          <Pick label="Source" value={f.source} options={v?.options.sources ?? []} onChange={x => set('source', x)} />
          <label className="st-row" style={{ gap: 6 }}><input type="checkbox" checked={f.unused === '1'} onChange={e => set('unused', e.target.checked ? '1' : '')} />Unused</label>
          <input className="st-input sm" style={{ width: 180 }} placeholder="Words in the line" value={f.q ?? ''} onChange={e => set('q', e.target.value)} aria-label="Search lines" />
          <span className="st-spacer" />
          <a className="st-btn sm secondary" href={api.bankCsvUrl(f)} download="line-bank.csv" data-field="line-bank-download"><Download size={13} />Download as CSV</a>
        </div>
        <span className="st-hint" role="status">{v ? `${v.total.toLocaleString()} line${v.total === 1 ? '' : 's'} shown${v.total > v.lines.length ? ` (the first ${v.lines.length}; the CSV has all of them)` : ''}.` : 'Reading the bank...'}</span>
        <div className="st-tablewrap" style={{ maxHeight: 600, overflow: 'auto' }}>
          <table className="st-table" data-field="line-bank-table">
            <thead><tr><th>Line</th><th>Source</th><th>Likes</th><th>Pain</th><th>Emotion</th><th>Format</th><th>Voice fit</th><th>Life or job</th><th>Used on</th></tr></thead>
            <tbody>
              {(v?.lines ?? []).map(l => (
                <tr key={l.id}>
                  <td style={{ maxWidth: 380 }} title={l.comment && l.comment !== l.text ? `From: ${l.comment}` : undefined}>{l.text}{l.fight ? <span className="st-chip xs warn" style={{ marginLeft: 6 }}>could start a fight</span> : null}</td>
                  <td>{l.source}</td><td>{l.likes.toLocaleString()}</td><td>{l.pain}</td><td>{l.emotion}</td><td>{l.format}</td><td>{FITS[l.fits]}</td>
                  <td>{l.lifeOrJob ?? <span className="st-muted">not tagged</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.usedAccount ? <>{l.usedPostId ? <Link to={`/studio/posts/${l.usedPostId}`}>{l.usedAccount}</Link> : l.usedAccount}{l.usedDate ? ` · ${l.usedDate}` : ''}</> : <span className="st-muted">unused</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div></section>
    </div>
  )
}

function Pick({ label, value, options, names, onChange }: { label: string; value: string | undefined; options: string[]; names?: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <select className="st-input sm" style={{ width: 'auto' }} value={value ?? ''} onChange={e => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}: all</option>
      {options.map(o => <option key={o} value={o}>{names?.[o] ?? o}</option>)}
    </select>
  )
}

// Import lines (item 7): a CSV with the line's fields; a dry run first
// shows what goes in and what is dropped as a near-match.
function ImportLines({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const products = useProducts().data?.products ?? []
  const file = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [productId, setProductId] = useState('')
  const [dry, setDry] = useState<LinesImportResult | null>(null)
  async function load(f: File | undefined) {
    if (!f) return
    const text = await f.text()
    setCsv(text); setName(f.name)
    try { setDry(await api.importLines({ csv: text, name: f.name, productId: productId || null, dryRun: true })) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <section className="st-card"><div className="st-card-body st-col" style={{ gap: 8 }} data-field="line-bank-import-lines">
      <span className="st-h3">Import lines</span>
      <span className="st-hint">A CSV of finished lines: text (required), source (comment, caption, transcript, inventory, competitor, claude), source_likes, pain, emotion, format, voice_fit (first, secondhand, both), life_or_job. Near-matches of a line already in the bank or earlier in the file are dropped. Free.</span>
      <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void load(f) }} data-field="line-bank-lines-file" />
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="st-btn sm secondary" onClick={() => file.current?.click()}><Upload size={13} />Choose the lines CSV</button>
        {products.length > 0 && <select className="st-input sm" style={{ width: 'auto' }} value={productId} onChange={e => setProductId(e.target.value)} aria-label="Product whose pains these are"><option value="">No product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </div>
      {dry && (
        <div className="st-col" style={{ gap: 6 }} data-field="line-bank-lines-preview">
          <span className="st-hint" role="status"><b>{name}</b>: {dry.rows} lines, <b>{dry.kept} new</b>, {dry.duplicatesInBank} already in the bank, {dry.duplicatesInFile} near-matches in the file.{dry.unknown.length ? ` Columns not used: ${dry.unknown.join(', ')}.` : ''}</span>
          {dry.problems.map(p => <span key={p} className="st-hint st-warntext">{p}</span>)}
          <AsyncButton className="st-btn sm" disabled={!dry.kept} busyLabel="Importing..." onClick={async () => {
            try { const r = await api.importLines({ csv, name, productId: productId || null }); setDry(null); setCsv(''); onDone(); toast({ tone: 'ok', text: `${r.kept} lines added to the bank.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
          }}>Import {dry.kept} line{dry.kept === 1 ? '' : 's'} (free)</AsyncButton>
        </div>
      )}
    </div></section>
  )
}
