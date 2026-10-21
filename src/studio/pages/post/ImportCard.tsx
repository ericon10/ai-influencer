import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import type { ImportPreview } from '../../types'
import { AsyncButton, errorMessage, useToast } from '../../ui'
import type { PostCtx } from './ctx'
import { takeBatchSheet } from '../../importDoor'

// Spreadsheet import (overnight item 3, UX-PLAN section 11): one CSV row
// per post. Preview first (free): each row's status and the total price.
// Then "Make N posts" creates the video posts; the rows that reuse a clip
// can export at once (free). New stills and takes are generated in each
// post, with their own price, as always.

const TEMPLATE = 'character,account,clip,video,caption,style\nCallie,callie.tiktok,dance-take.mp4,,me when the playlist finally hits,Crash zoom cut\nCallie,callie.tiktok,"still: at her desk at night, laptop open",she sighs and looks up at the camera,one more episode they said,\n'

const usd = (n: number) => `$${n.toFixed(2)}`

export function ImportCard({ ctx }: { ctx: PostCtx }) {
  const { item } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  // A batch sheet sent by Import on Posts home waits here (one import door).
  const [csv, setCsv] = useState(() => takeBatchSheet()?.text ?? '')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [exportFree, setExportFree] = useState(true)
  const [done, setDone] = useState<{ created: Array<{ line: number; id: string; status: string }>; exporting: number; skipped: number; notExported: Array<{ line: number; id: string; reason: string }> } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const good = preview ? preview.totals.reuse + preview.totals.generate : 0

  async function load(f: File | undefined) {
    if (!f) return
    if (f.size > 200_000) { toast({ tone: 'bad', text: `${f.name} is over 200 KB. Split it.` }); return }
    setCsv(await f.text())
    setPreview(null)
    setDone(null)
  }

  return (
    <section className="st-card" data-field="batch-import">
      <div className="st-card-head"><FileSpreadsheet size={16} /><div className="grow"><div className="st-h3">Import a spreadsheet</div><div className="st-hint">One row per post: character, account, clip (a clip to reuse, or "still: your prompt"), video (optional), caption (optional), style (optional). Each row becomes its own video post.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 10 }}>
        <textarea className="st-textarea" rows={4} value={csv} onChange={e => { setCsv(e.target.value); setPreview(null); setDone(null) }} placeholder="Paste the rows (with the header line), or upload a CSV" aria-label="Spreadsheet rows" />
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void load(f) }} />
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="st-btn sm secondary" onClick={() => file.current?.click()}><Upload size={13} />Upload a CSV</button>
          <a className="st-btn sm ghost" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="batch-template.csv">Download a template</a>
          <AsyncButton className="st-btn sm" disabled={!csv.trim()} title={csv.trim() ? undefined : 'Paste rows or upload a CSV first'} busyLabel="Checking the rows..." onClick={async () => {
            try { setPreview(await api.importPreview(item.id, csv)); setDone(null) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
          }}>Preview (free)</AsyncButton>
        </div>
        {preview && (
          <div className="st-col" style={{ gap: 8 }}>
            {preview.problems.map(p => <span key={p} className="st-hint st-warntext">{p}</span>)}
            <div style={{ overflowX: 'auto' }}>
              <table className="st-table">
                <thead><tr><th>Row</th><th>Character</th><th>Account</th><th>Clip or still</th><th>Caption</th><th>Style</th><th>What happens</th></tr></thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.line} className={r.status === 'problem' ? 'st-warnrow' : undefined}>
                      <td>{r.line}</td>
                      <td>{r.characterName || '?'}</td>
                      <td>{r.accountTag || <span className="st-hint">the batch's</span>}</td>
                      <td>{r.clipTitle ?? (r.stillPrompt ? `New still: ${r.stillPrompt.slice(0, 60)}` : '')}</td>
                      <td>{r.caption ? r.caption.slice(0, 80) : <span className="st-hint">No caption</span>}</td>
                      <td>{r.style?.replace(/_/g, ' ') ?? ''}</td>
                      <td>{r.status === 'reuse' ? 'Reuses the clip, free' : r.status === 'generate' ? `New still and take, about ${usd(r.priceUsd)}` : <span className="st-warntext">Skipped: {r.problems.join('; ')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="st-hint" role="status"><b>{good} posts</b>: {preview.totals.reuse} reuse a clip (free), {preview.totals.generate} new (about {usd(preview.totals.usd)} in total){preview.totals.problem ? `, ${preview.totals.problem} skipped` : ''}. {preview.priceNote} Nothing paid runs here: each new post shows its price before it generates.</span>
            <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
              <button type="button" role="switch" aria-checked={exportFree} className={`st-switch ${exportFree ? 'on' : ''}`} onClick={() => setExportFree(!exportFree)}><span /></button>
              <span className="st-hint">Export the ones that reuse a clip now (free, on the worker)</span>
            </label>
            <AsyncButton className="st-btn" disabled={!good} title={good ? undefined : 'Fix the rows above first'} busyLabel={`Making ${good} posts...`} onClick={async () => {
              try {
                const r = await api.importRun(item.id, csv, exportFree)
                setDone(r)
                await qc.invalidateQueries({ queryKey: keys.content })
                toast({ tone: 'ok', text: `Made ${r.created.length} posts${r.exporting ? `; exporting ${r.exporting}` : ''}.` })
              } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
            }}>Make {good} posts</AsyncButton>
          </div>
        )}
        {done && (
          <div className="st-col" style={{ gap: 4 }} role="status">
            <span className="st-hint">Made {done.created.length} posts{done.exporting ? `, ${done.exporting} exporting now` : ''}{done.skipped ? `, ${done.skipped} skipped` : ''}. They are on <Link to="/studio">Posts</Link>, tagged with their accounts.</span>
            {done.notExported.map(n => <span key={n.id} className="st-hint st-warntext">Row {n.line} is not exported yet: {n.reason} <Link to={`/studio/posts/${n.id}`}>Open it</Link></span>)}
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {done.created.slice(0, 12).map(c => <Link key={c.id} className="st-chip" to={`/studio/posts/${c.id}`}>Row {c.line}{c.status === 'generate' ? ': make the still' : ''}</Link>)}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
