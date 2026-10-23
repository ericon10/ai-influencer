import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, RefreshCw, Search } from 'lucide-react'
import { api } from '../../api'
import { AsyncButton, Callout, errorMessage, useToast } from '../../ui'
import type { ResyncPlan, SheetPreview, WeekImportResult } from '../../types'

// Weeks from Google Sheets (owner, 2026-10-23; UX-PLAN.md section 39): pick
// a sheet from Drive (the Plans folders first) or paste its link; its first
// tab goes through the same preview and import as a CSV. Linked sheets
// Re-sync with a free preview first; a post with pictures is never changed
// unless it is ticked.

const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export function SheetPicker({ onRead, onClose }: { onRead: (p: SheetPreview) => void; onClose: () => void }) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [link, setLink] = useState('')
  const q = useQuery({ queryKey: ['week-sheets', search], queryFn: () => api.weekSheets(search || undefined), staleTime: 10_000, retry: false })
  const drive = useQuery({ queryKey: ['drive'], queryFn: api.drive, staleTime: 30_000 })
  async function read(sheet: string) {
    try { onRead(await api.sheetPreview(sheet)) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  if (drive.data && !drive.data.connected) return (
    <Callout tone="info"><span data-field="weeks-sheets-connect">Connect Google Drive first: <Link to="/studio/settings?tab=general#drive">Settings, General, Google Drive</Link>.</span></Callout>
  )
  return (
    <section className="st-card" data-field="weeks-sheets"><div className="st-card-body st-col" style={{ gap: 10 }}>
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
        <FileSpreadsheet size={16} />
        <b className="grow">From Google Sheets</b>
        <button type="button" className="st-btn xs ghost" onClick={onClose}>Close</button>
      </div>
      <span className="st-hint">The sheet's first tab is read as the plan CSV (docs/PLAN-CSV-SPEC.md columns), with the same free preview. Its posts remember the sheet, so Re-sync can pull later edits.</span>
      {q.data && !q.data.readable && (
        <Callout tone="warn"><span data-field="weeks-sheets-reconnect">The Studio may only read the files it made. To read your sheets, reconnect Google Drive once: <Link to="/studio/settings?tab=general#drive">Settings, General, Google Drive, Reconnect</Link>.</span></Callout>
      )}
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="st-input sm grow" style={{ minWidth: 240 }} value={link} onChange={e => setLink(e.target.value)} placeholder="Paste the sheet's link (docs.google.com/spreadsheets/d/...)" aria-label="Google Sheets link" onKeyDown={e => { if (e.key === 'Enter' && link.trim()) void read(link) }} />
        <AsyncButton className="st-btn sm" disabled={!link.trim()} busyLabel="Reading..." field="weeks-sheets-read-link" onClick={() => read(link)}>Read this sheet (free)</AsyncButton>
      </div>
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
        <Search size={13} className="st-muted" />
        <input className="st-input sm" style={{ maxWidth: 260 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Or search your sheets" aria-label="Search your Google Sheets" />
        {q.data?.plans && <span className="st-hint">Plans live in {q.data.plans.root} / Plans / {q.data.plans.folders.length === 1 ? q.data.plans.folders[0] : 'CHARACTER'}.</span>}
      </div>
      {q.isError && <span className="st-hint st-warntext" role="alert">{errorMessage(q.error)}</span>}
      {q.data && (
        <div className="st-col" style={{ gap: 4, maxHeight: 280, overflow: 'auto' }} data-field="weeks-sheets-list">
          {!q.data.sheets.length && <span className="st-hint">{search ? 'No sheet with those words.' : 'No sheets yet. Make one in a Plans folder, or paste a link above.'}</span>}
          {q.data.sheets.map(s => (
            <div key={s.id} className="st-row st-sheetrow" style={{ gap: 8, alignItems: 'center' }}>
              <span className="grow st-clamp1"><b>{s.name}</b>{s.character ? <span className="st-chip xs" style={{ marginLeft: 6 }}>Plans / {s.character}</span> : null}</span>
              <span className="st-hint" style={{ whiteSpace: 'nowrap' }}>{when(s.modifiedTime)}</span>
              <AsyncButton className="st-btn xs secondary" busyLabel="Reading..." onClick={() => read(s.id)}>Read</AsyncButton>
            </div>
          ))}
        </div>
      )}
    </div></section>
  )
}

// The sheets weeks were imported from, each with Re-sync.
export function LinkedSheets({ onSynced }: { onSynced: (r: WeekImportResult) => void }) {
  const q = useQuery({ queryKey: ['week-sheets', ''], queryFn: () => api.weekSheets(), staleTime: 10_000, retry: false })
  const [open, setOpen] = useState<string | null>(null)
  const linked = q.data?.linked ?? []
  if (!linked.length) return null
  return (
    <div className="st-col" style={{ gap: 6 }} data-field="weeks-linked-sheets">
      <span className="st-label">Linked sheets</span>
      {linked.map(s => (
        <div key={s.id} className="st-col" style={{ gap: 6 }}>
          <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <FileSpreadsheet size={14} />
            <span className="grow"><b>{s.name}</b> <span className="st-hint">{s.rows} rows · synced {when(s.syncedAt)}</span></span>
            <button type="button" className="st-btn xs secondary" onClick={() => setOpen(o => (o === s.id ? null : s.id))} aria-expanded={open === s.id} data-field={`weeks-resync-${s.id}`}><RefreshCw size={12} />Re-sync</button>
          </div>
          {open === s.id && <Resync id={s.id} onDone={r => { setOpen(null); onSynced(r) }} />}
        </div>
      ))}
    </div>
  )
}

function Resync({ id, onDone }: { id: string; onDone: (r: WeekImportResult) => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['resync', id], queryFn: () => api.resyncPlan(id), staleTime: 0, gcTime: 0, retry: false })
  const [ok, setOk] = useState<Set<string>>(new Set())
  if (q.isError) return <span className="st-hint st-warntext" role="alert">{errorMessage(q.error)}</span>
  const p: ResyncPlan | undefined = q.data
  if (!p) return <span className="st-hint">Reading the sheet's latest edits...</span>
  const todo = p.added.length + p.changed.length + ok.size
  const toggle = (rowId: string) => setOk(s => { const n = new Set(s); if (n.has(rowId)) n.delete(rowId); else n.add(rowId); return n })
  return (
    <div className="st-col st-callout" style={{ gap: 8 }} data-field="weeks-resync">
      <span role="status"><b>{p.sheet.name}</b>, edited {when(p.sheet.modifiedTime)}: {p.added.length} new row{p.added.length === 1 ? '' : 's'}, {p.changed.length} changed draft{p.changed.length === 1 ? '' : 's'}, {p.changedWithPictures.length} changed post{p.changedWithPictures.length === 1 ? '' : 's'} with pictures, {p.unchanged} unchanged{p.gone.length ? `, ${p.gone.length} gone from the sheet` : ''}.</span>
      {p.added.length > 0 && <span className="st-hint">Added as drafts: {p.added.map(r => r.rowId).join(', ')}.</span>}
      {p.changed.length > 0 && <span className="st-hint">Drafted again from the sheet (no pictures yet): {p.changed.map(r => r.rowId).join(', ')}.</span>}
      {p.changedWithPictures.length > 0 && (
        <div className="st-col" style={{ gap: 4 }} data-field="weeks-resync-pictures">
          <b>These posts already have pictures. They stay as they are unless you tick them (their pictures go to Trash):</b>
          {p.changedWithPictures.map(r => (
            <label key={r.rowId} className="st-row" style={{ gap: 6 }}>
              <input type="checkbox" checked={ok.has(r.rowId)} onChange={() => toggle(r.rowId)} aria-label={`Update ${r.rowId} too`} />
              <span>{r.rowId} · {r.account} · {r.title}</span>
            </label>
          ))}
        </div>
      )}
      {p.gone.length > 0 && <span className="st-hint">Gone from the sheet, kept here (delete them on the grid if you want): {p.gone.map(r => r.rowId).join(', ')}.</span>}
      {p.problems.map(x => <span key={x.rowId} className="st-hint st-warntext">{x.rowId}: {x.errors.join('; ')}</span>)}
      <AsyncButton className="st-btn sm" disabled={!todo} title={!todo ? 'Nothing to change: the sheet matches the drafts' : undefined} busyLabel="Syncing..." field="weeks-resync-apply" onClick={async () => {
        try {
          const r = await api.resync(id, [...ok])
          await qc.invalidateQueries({ queryKey: ['week-sheets'] })
          toast({ tone: 'ok', text: `${r.created} added, ${r.replaced} updated${r.kept ? `, ${r.kept} with pictures kept` : ''}.` })
          onDone(r)
        } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
      }}>{todo ? `Apply: ${todo} row${todo === 1 ? '' : 's'} (free)` : 'Nothing to change'}</AsyncButton>
    </div>
  )
}
