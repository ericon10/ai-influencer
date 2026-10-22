import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, CheckCircle2, FolderSync, RotateCcw, Sheet, X } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { PriceButton } from '../../PriceButton'
import { AsyncButton, Callout, errorMessage, useToast } from '../../ui'
import { HowTo } from '../../guide/Guide'
import type { CloneModel, MassRowView, MassView } from '../../types'
import type { PostCtx } from './ctx'

// Mass recreate (owner, 2026-10-22; UX-PLAN.md section 36, item 24): rows
// from a Google Sheet of TikTok links or a synced Drive folder, fetched one
// at a time, a free first pass (a clear adult, people, length, the price),
// then the ticked rows' stills in one click, Keep or Reject on each still,
// and the kept rows' videos. The review queue plays the source and the take
// side by side. Every step is priced before it runs.

const money = (t: { micros: number; credits: number | null }) => (t.credits != null && t.micros === 0 ? `${Math.round(t.credits * 100) / 100} credits` : `$${(t.micros / 1e6).toFixed(2)}`)

const STAGE: Record<MassRowView['stage'], string> = {
  fetch: 'To fetch', wait: 'Fetching and checking', stills: 'Next: stills', working: 'Working on it', call: 'Keep or reject the still',
  video: 'Kept: ready for the video', review: 'Take ready: review it', done: 'Done', out: 'Out',
}

export function MassRecreate({ ctx, models }: { ctx: PostCtx; models: CloneModel[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const view = useQuery({
    queryKey: ['mass', ctx.item.id], queryFn: () => api.massView(ctx.item.id),
    refetchInterval: q => (q.state.data?.rows.some(r => r.status === 'fetching' || r.status === 'checking' || r.stage === 'working') ? 4000 : false),
  })
  const v: MassView | undefined = view.data
  const [sheet, setSheet] = useState('')
  const [folder, setFolder] = useState('')
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['mass', ctx.item.id] }); void qc.invalidateQueries({ queryKey: ['estimate'] }) }
  async function rows(body: Parameters<typeof api.massRows>[1]) {
    try { await api.massRows(ctx.item.id, body); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const list = v?.rows ?? []
  const ready = list.filter(r => r.status === 'ready')
  const atStills = ready.filter(r => r.ticked && r.stage === 'stills')
  const atVideo = ready.filter(r => r.ticked && r.stage === 'video')
  const total = v ? { micros: v.total.stills.micros + v.total.video.micros, credits: v.total.stills.credits != null && v.total.video.credits != null ? v.total.stills.credits + v.total.video.credits : null } : null
  return (
    <section className="st-card st-col st-mass" style={{ gap: 12, padding: 14 }} data-field="mass-recreate">
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b className="grow">Mass recreate</b>
        <HowTo id="post-mass" label="How mass recreate works" />
      </div>
      <span className="st-hint">A Google Sheet of TikTok links (columns: link, character, keep place or new set, motion model, notes) or a Drive folder of clips. Each clip is fetched one at a time, cleaned, and checked for free before anything is spent.</span>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="st-input sm" style={{ flex: '1 1 260px', minWidth: 0 }} value={sheet} onChange={e => setSheet(e.target.value)} placeholder={v?.sheet ?? 'Google Sheet link (shared: anyone with the link)'} aria-label="Google Sheet link" />
        <AsyncButton className="st-btn sm" icon={<Sheet size={13} />} disabled={!sheet.trim() && !v?.sheet} onClick={async () => {
          try { const r = await api.massSheet(ctx.item.id, { link: sheet.trim() || v?.sheet || '' }); setSheet(''); refresh(); toast({ tone: 'ok', text: `${r.added} new row${r.added === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped (each says why)` : ''}${r.already ? `; ${r.already} already here` : ''}.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
        }}>Read the sheet</AsyncButton>
        <label className="st-btn sm ghost" style={{ cursor: 'pointer' }}>
          Or choose its CSV
          <input type="file" accept=".csv,text/csv" hidden aria-label="The sheet as a CSV file" onChange={async e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try { const r = await api.massSheet(ctx.item.id, { csv: await f.text() }); refresh(); toast({ tone: 'ok', text: `${r.added} new row${r.added === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped (each says why)` : ''}${r.already ? `; ${r.already} already here` : ''}.` }) } catch (err) { toast({ tone: 'bad', text: errorMessage(err) }) }
          }} />
        </label>
      </div>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="st-input sm" style={{ flex: '1 1 260px', minWidth: 0 }} value={folder} onChange={e => setFolder(e.target.value)} placeholder={v?.folder ?? 'Google Drive folder link'} aria-label="Google Drive folder link" />
        <AsyncButton className="st-btn sm" icon={<FolderSync size={13} />} disabled={!folder.trim() && !v?.folder} onClick={async () => {
          try { const r = await api.massFolder(ctx.item.id, { link: folder.trim() || v?.folder || undefined }); setFolder(''); refresh(); toast({ tone: 'ok', text: `${r.added} new clip${r.added === 1 ? '' : 's'} from the folder${r.already ? `; ${r.already} already here` : ''}. They are fetched one at a time (free).` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
        }}>{v?.folder ? 'Sync the folder' : 'Read the folder'}</AsyncButton>
        {v?.syncedAt && <span className="st-hint">Synced {new Date(v.syncedAt).toLocaleString()}</span>}
      </div>
      {v && v.toFetch > 0 && (
        <PriceButton label={`Fetch ${v.toFetch} TikTok clip${v.toFetch === 1 ? '' : 's'}, one at a time`} variant="secondary" size="sm" action={{ type: 'mass_fetch', contentId: ctx.item.id }} onStarted={refresh} watch={j => j.purpose.startsWith(`mass_fetch:${ctx.item.id}:`)} />
      )}
      {v && list.length > 0 && (
        <>
          <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="st-row" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={ready.length > 0 && ready.every(r => r.ticked)} onChange={e => void rows({ all: e.target.checked })} aria-label="Tick every row" />
              <span className="st-hint">{v.counts.all} rows: {v.counts.ready} ready, {v.counts.skipped} skipped{v.counts.fetching ? `, ${v.counts.fetching} being fetched or checked` : ''}</span>
            </label>
          </div>
          <div className="st-col" style={{ gap: 8 }}>
            {list.map(r => <MassRowCard key={r.id} r={r} ctx={ctx} models={models} onRows={rows} refresh={refresh} />)}
          </div>
          {total && v.total.ticked > 0 && (
            <div className="st-mass-total" data-field="mass-total">
              <b>Ticked: {v.total.ticked} row{v.total.ticked === 1 ? '' : 's'}</b>
              <span>Stills {money(v.total.stills)} + videos {money(v.total.video)} = <b>{money(total)}</b></span>
              <span className="st-hint">Stills first; only the rows you keep go to video. Each row runs on its own, so a long run goes on overnight at your daily cap.</span>
            </div>
          )}
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {atStills.length > 0 && <PriceButton label={`Make stills for ${atStills.length} ticked row${atStills.length === 1 ? '' : 's'}`} action={{ type: 'mass_recreate', contentId: ctx.item.id, step: 'stills' }} onStarted={refresh} />}
            {atVideo.length > 0 && <PriceButton label={`Make videos for ${atVideo.length} kept row${atVideo.length === 1 ? '' : 's'}`} variant={atStills.length ? 'secondary' : 'primary'} action={{ type: 'mass_recreate', contentId: ctx.item.id, step: 'video' }} onStarted={refresh} />}
          </div>
        </>
      )}
      {view.error && <Callout tone="bad">{errorMessage(view.error)}</Callout>}
    </section>
  )
}

function MassRowCard({ r, ctx, models, onRows, refresh }: { r: MassRowView; ctx: PostCtx; models: CloneModel[]; onRows: (body: Parameters<typeof api.massRows>[1]) => Promise<void>; refresh: () => void }) {
  const toast = useToast()
  const motion = models.filter(m => m.mode === 'motion')
  const out = r.stage === 'out'
  return (
    <div className={`st-massrow ${out ? 'out' : ''}`} data-field="mass-row" data-stage={r.stage}>
      {r.frameId ? <img src={assetUrl(r.frameId, 160)} alt={`First frame of ${r.source.name}`} /> : r.status === 'skipped' ? <div /> : <div className="st-skel st-massrow-frame" />}
      <div className="st-col" style={{ gap: 6, minWidth: 0 }}>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {r.status === 'ready' && !out && <input type="checkbox" checked={r.ticked} onChange={e => void onRows({ tick: { id: r.id, on: e.target.checked } })} aria-label={`Tick ${r.source.name}`} />}
          <b style={{ overflowWrap: 'anywhere' }}>{r.characterNames.join(' + ') || 'No character'}</b>
          {r.characters.length === 2 && r.stage !== 'done' && <button type="button" className="st-btn xs ghost" onClick={() => void onRows({ swap: r.id })} title="Left and right trade places" aria-label={`Swap ${r.characterNames.join(' and ')}`}><ArrowLeftRight size={12} />Swap</button>}
          <span className="st-muted" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{r.source.name}{r.check?.seconds ? `, ${r.check.seconds} s` : ''}</span>
          <span className="st-spacer" />
          <span className={`st-badge ${r.status === 'skipped' || out ? 'bad' : r.stage === 'done' ? 'ok' : 'plain'}`}>{r.status === 'skipped' ? 'Skipped' : STAGE[r.stage]}</span>
        </div>
        {r.reason && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>{r.reason}</span>}
        {r.check && (
          <span className="st-hint">
            {r.check.adult === true ? 'Clear adult' : r.check.adult === false ? 'No clear adult' : 'Adult not checked'}
            {r.check.people != null ? ` · ${r.check.people} ${r.check.people === 1 ? 'person' : 'people'}` : ''}
            {r.check.notes.length ? ` · ${r.check.notes.join(' ')}` : ''}
          </span>
        )}
        {/* The place and the model, until the stills are made. */}
        {(r.stage === 'fetch' || r.stage === 'wait' || r.stage === 'stills') && r.status !== 'skipped' && (
          <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="st-seg sm" role="radiogroup" aria-label={`Place for ${r.source.name}`}>
              {(['keep', 'new'] as const).map(p => <button key={p} type="button" role="radio" aria-checked={r.place === p} className={r.place === p ? 'on' : ''} onClick={() => void onRows({ place: { id: r.id, place: p } })}>{p === 'keep' ? 'Keep place' : 'New set'}</button>)}
            </div>
            <select className="st-input sm" style={{ width: 'auto', maxWidth: '100%' }} aria-label={`Motion model for ${r.source.name}`} value={r.model ?? ''} onChange={e => void onRows({ model: { id: r.id, ref: e.target.value || null } })}>
              <option value="">Default ({motion.find(m => m.ref === r.model)?.label ?? r.modelLabel})</option>
              {motion.map(m => <option key={m.ref} value={m.ref} disabled={!!m.problem}>{m.label} ({m.pathLabel}){m.problem ? `: ${m.problem}` : ''}</option>)}
            </select>
            {(r.price.stills || r.price.video) && <span className="st-hint" data-field="mass-row-price">{r.price.stills ? `Stills ${r.price.stills.display}` : ''}{r.price.stills && r.price.video ? ' + ' : ''}{r.price.video ? `video ${r.price.video.display}` : ''}</span>}
          </div>
        )}
        {r.notes && <span className="st-hint">Notes: {r.notes}</span>}
        {r.stage !== 'fetch' && r.stage !== 'wait' && r.stage !== 'stills' && r.status === 'ready' && <span className="st-hint">{r.place === 'new' ? 'New set' : 'Keep place'} · {r.modelLabel}{r.price.video && r.stage === 'video' ? ` · video ${r.price.video.display}` : ''}</span>}
        {/* Stills first: keep or reject (only kept rows go to video). */}
        {r.still?.assetId && (r.stage === 'call' || r.stage === 'video') && (
          <div className="st-row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }} data-field="mass-still">
            <img src={assetUrl(r.still.assetId, 240)} alt={`Best still for ${r.source.name}`} style={{ width: 90, aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 8 }} />
            <div className="st-col" style={{ gap: 6, minWidth: 0, flex: '1 1 160px' }}>
              <span className={`st-gate ${r.still.gateOk ? 'ok' : 'held'}`}>{r.still.gateOk ? 'Passes the face checks' : `Held: ${r.still.reasons.join(' ')}`}</span>
              {r.stage === 'call' ? (
                <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <AsyncButton className="st-btn sm" icon={<CheckCircle2 size={13} />} onClick={() => onRows({ call: { id: r.id, call: 'kept', stillId: r.still!.id } })}>Keep</AsyncButton>
                  <AsyncButton className="st-btn sm ghost" icon={<X size={13} />} onClick={() => onRows({ call: { id: r.id, call: 'rejected' } })}>Reject</AsyncButton>
                  {r.postId && <a className="st-btn sm ghost" href={`/studio/posts/${r.postId}`}>Open the row</a>}
                </div>
              ) : <span className="st-hint">Kept. <button type="button" className="st-linkbtn" onClick={() => void onRows({ call: { id: r.id, call: null } })}>Undo</button></span>}
            </div>
          </div>
        )}
        {/* The review queue: the source and the take side by side. */}
        {r.take?.assetId && r.sourceAssetId && (r.stage === 'review' || r.stage === 'done') && (
          <div className="st-col" style={{ gap: 8 }} data-field="mass-review">
            <div className="st-mass-pair">
              <figure><video src={`/api/v1/assets/${r.sourceAssetId}/content`} poster={r.frameId ? assetUrl(r.frameId, 480) : undefined} muted playsInline controls preload="metadata" /><figcaption>Source</figcaption></figure>
              <figure><video src={`/api/v1/assets/${r.take.assetId}/content`} poster={r.still?.assetId ? assetUrl(r.still.assetId, 480) : undefined} muted playsInline controls preload="metadata" /><figcaption>Result</figcaption></figure>
            </div>
            {r.stage === 'review' ? (
              <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <AsyncButton className="st-btn sm" icon={<CheckCircle2 size={13} />} onClick={async () => { try { await api.keepClone(r.take!.id, true); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}>Keep the take</AsyncButton>
                <AsyncButton className="st-btn sm ghost" icon={<RotateCcw size={13} />} onClick={async () => { try { await api.tryCloneAgain(r.postId!, r.take!.id); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}>Reject the take</AsyncButton>
              </div>
            ) : <span className="st-hint">{r.take.decision === 'kept' ? 'You kept this take.' : 'You rejected this take.'}</span>}
          </div>
        )}
        {(r.status === 'skipped' || out) && <div className="st-row"><button type="button" className="st-btn xs ghost" onClick={() => void onRows({ remove: r.id })}><X size={12} />Take out</button></div>}
      </div>
    </div>
  )
}
