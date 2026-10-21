import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { keys } from '../hooks'
import { PriceButton } from '../PriceButton'
import { AsyncButton, Todo, errorMessage, useToast, type TodoItem } from '../ui'
import { HowTo } from '../guide/Guide'
import { SelectAllBox, SelectBox, SelectionCount, useSelection } from '../select'
import type { Incoming } from '../importDoor'
import type { FacelessImportResult, FacelessPreview } from '../types'

// A faceless account's plan CSV in the Launch plan card (owner, 2026-10-22;
// UX-PLAN.md section 35, item 4g): the rows go to the faceless character
// its account links to; a row with still_job_id lands with that Higgsfield
// still attached; matches ask Replace or Add; the next step is Generate.
export function FacelessImport({ incoming, onImported }: { incoming: Incoming; onImported: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [characterId, setCharacterId] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [preview, setPreview] = useState<FacelessPreview | null>(null)
  const [existing, setExisting] = useState<'replace' | 'add' | null>(null)
  const [done, setDone] = useState<FacelessImportResult | null>(null)
  const good = (preview?.rows ?? []).filter(r => r.state !== 'problem')
  const sel = useSelection(useMemo(() => good.map(r => r.rowId), [good.map(r => r.rowId).join('|')])) // eslint-disable-line react-hooks/exhaustive-deps
  async function check(o: { characterId?: string | null; accountTag?: string | null } = {}) {
    try { setPreview(await api.facelessPreview(incoming.text, { characterId: o.characterId ?? characterId, accountTag: o.accountTag ?? tag })) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  useEffect(() => { void check() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ticked = good.filter(r => sel.has(r.rowId))
  const matching = ticked.filter(r => r.state !== 'new')
  const todo: TodoItem[] = [
    ...(!preview?.character ? [{ label: 'Pick the faceless account' }] : []),
    ...(!ticked.length ? [{ label: 'Tick the rows to import' }] : []),
    ...(matching.length && !existing ? [{ label: 'Pick Replace them or Add as new posts' }] : []),
  ]
  const next = done ? done.posts.filter(p => !p.still).map(p => p.id) : []
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="faceless-import">
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}><b>{incoming.name}: a faceless account's plan</b><HowTo id="faceless" label="About faceless posts" /></div>
      {preview?.problems.map(p => <span key={p} className="st-hint st-warntext">{p}</span>)}
      {preview && (
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="st-select" style={{ width: 'auto' }} aria-label="Faceless account" value={preview.character?.id ?? ''} onChange={e => { setCharacterId(e.target.value || null); void check({ characterId: e.target.value || null }) }}>
            <option value="">Pick the faceless character...</option>
            {preview.faceless.map(c => <option key={c.id} value={c.id}>{c.name}{c.tags.length ? ` (${c.tags.join(', ')})` : ''}</option>)}
          </select>
          <input className="st-input" style={{ width: 200 }} aria-label="Account tag" placeholder="account tag" defaultValue={preview.accountTag} onBlur={e => { setTag(e.target.value || null); void check({ accountTag: e.target.value || null }) }} />
        </div>
      )}
      {preview && (
        <div className="st-tablewrap" style={{ maxHeight: 380, overflow: 'auto' }} data-field="faceless-rows">
          <SelectionCount sel={sel} />
          <table className="st-table">
            <thead><tr><th><SelectAllBox sel={sel} label={`Tick the ${good.length} rows shown`} disabled={!good.length} /></th><th>Row</th><th>On-screen line</th><th>Still</th><th>Notes</th></tr></thead>
            <tbody>
              {preview.rows.map(r => (
                <tr key={r.line} className={r.state === 'problem' ? 'st-warnrow' : undefined}>
                  <td>{r.state !== 'problem' && <SelectBox sel={sel} id={r.rowId} label={`Import ${r.rowId}`} />}</td>
                  <td>{r.rowId}</td>
                  <td style={{ maxWidth: 360 }}><span className="st-clamp1" title={r.hook}>{r.hook}</span></td>
                  <td>{r.still === 'job' ? 'From Higgsfield' : r.still === 'url' ? 'From its link' : 'Made from the scene'}</td>
                  <td>{r.errors.length ? <span className="st-warntext">{r.errors.join('; ')}</span> : r.state === 'update' ? 'Matches a draft you have' : r.state === 'kept' ? 'Matches a post with a still' : null}{r.lint.length ? <span className="st-lint compact" title={r.lint.join('\n')}>{r.lint.length} note{r.lint.length === 1 ? '' : 's'}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {matching.length > 0 && (
        <div className="st-col st-callout" style={{ gap: 8 }} data-field="faceless-existing">
          <b>{matching.length} row{matching.length === 1 ? ' matches posts' : 's match posts'} you already have.</b>
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={`st-btn sm ${existing === 'replace' ? '' : 'secondary'}`} aria-pressed={existing === 'replace'} onClick={() => setExisting('replace')}>Replace them (their pictures go to Trash)</button>
            <button type="button" className={`st-btn sm ${existing === 'add' ? '' : 'secondary'}`} aria-pressed={existing === 'add'} onClick={() => setExisting('add')}>Add as new posts</button>
          </div>
        </div>
      )}
      <AsyncButton className="st-btn" disabled={todo.length > 0} busyLabel={`Importing ${ticked.length} rows...`} onClick={async () => {
        try {
          const r = await api.facelessImport(incoming.text, { characterId: preview?.character?.id ?? null, accountTag: preview?.accountTag ?? null, rows: ticked.map(x => x.rowId), ...(matching.length && existing ? { existing } : {}) })
          sel.clear(); setExisting(null)
          await qc.invalidateQueries({ queryKey: keys.content })
          onImported()
          await check()
          setDone(r)
        } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
      }}>Import {ticked.length || ''} row{ticked.length === 1 ? '' : 's'} (free)</AsyncButton>
      <Todo items={todo} />
      {done && (
        <div className="st-col" style={{ gap: 8 }} data-field="faceless-done">
          <span className="st-hint" role="status">{done.created + done.replaced} drafts made{done.replaced ? ` (${done.replaced} replaced)` : ''}{done.stills ? `, ${done.stills} with their Higgsfield still` : ''}.{done.stillProblems.length ? ` Not pulled: ${done.stillProblems.join('; ')}.` : ''} Next: the stills the others need, in the list below (Generate), or open a post.</span>
          {next.length > 0 && <PriceButton label={`Generate ${next.length} post${next.length === 1 ? '' : 's'}`} action={{ type: 'plan_generate', postIds: next.slice(0, 100) }} onStarted={onImported} onDone={onImported} />}
        </div>
      )}
    </div>
  )
}
