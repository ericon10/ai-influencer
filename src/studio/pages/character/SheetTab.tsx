import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Eye, FlipHorizontal2, FolderOpen, Loader2, RotateCcw, ShieldAlert, Sparkles, Download } from 'lucide-react'
import { api } from '../../api'
import { useActiveJobs, useRefresh } from '../../hooks'
import { filesFromDrop, sheetRefOf, typeOf } from '../../files'
import { PriceButton } from '../../PriceButton'
import { Callout, Drawer, Img, ShotBadge, errorMessage, useToast } from '../../ui'
import type { Candidate, CharacterView, Shot } from '../../types'

// Stage 4: the reference sheet as one "next up" card at a time, with the
// right refs already attached (SPEC 11: no REF math).
export function SheetTab({ v, goHero, goFile }: { v: CharacterView; goHero: () => void; goFile: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const shots = v.sheet.shots
  const ref00 = shots[0]!
  const generating = shots.filter(s => s.status === 'generating')
  const nextShot = v.sheet.next ? shots.find(s => s.id === v.sheet.next!.refId)! : null

  if (!ref00.approved) {
    // An imported character usually has its sheet already; offer both paths.
    const imported = v.stage >= 5
    return (
      <div className="st-col" style={{ gap: 24 }}>
      <div className="st-empty">
        <h2 className="st-h1">{imported ? <>Bring in the <em>sheet</em></> : <>Pick a hero <em>first</em></>}</h2>
        <p className="st-sub" style={{ margin: 0 }}>{imported ? `Drop ${v.name}'s sheet folder (images named REF 00 to REF 11), or pick a new hero to build the sheet here.` : 'The sheet is built from REF-00, the hero you pick.'}</p>
        {imported && <SheetFolderDrop v={v} />}
        <div className="st-row" style={{ justifyContent: 'center' }}>
          <button className={`st-btn ${imported ? '' : 'primary'}`} onClick={goHero}>Go to hero<ArrowRight size={15} /></button>
          {imported && <button className="st-btn ghost" onClick={goFile}>Character file</button>}
        </div>
      </div>
      <ToCheck v={v} />
      </div>
    )
  }

  return (
    <div className="st-col" style={{ gap: 24 }}>
      {nextShot && <NextUp v={v} shot={nextShot} action={v.sheet.next!.action} />}
      {!nextShot && generating.length === 0 && v.sheet.progress.complete && (
        <div className="st-nextup" style={{ borderColor: 'rgba(63,209,143,0.45)' }}>
          <Img assetId={ref00.approved.assetId} width={360} />
          <div className="st-col" style={{ gap: 10 }}>
            <span className="st-badge ok">Sheet complete</span>
            <div className="st-nextup-title">All 12 shots approved</div>
            <p className="st-sub" style={{ margin: 0 }}>Export the character file. It records every approved shot.</p>
            <a className="st-btn primary" href={api.exportUrl(v.id)}><Download size={16} />Download character file</a>
          </div>
        </div>
      )}
      {generating.length > 0 && (
        <div className="st-card pad st-row" style={{ gap: 14 }}>
          <Loader2 className="st-spin" size={18} />
          <div className="grow"><div className="st-h3">Working on {generating.map(s => s.id).join(', ')}</div><div className="st-hint">Rendering, then automatic QA. Failed QA never reaches your review queue.</div></div>
        </div>
      )}

      <ImportCheck v={v} />
      <ToCheck v={v} />
      {!v.sheet.progress.complete && <SheetFolderDrop v={v} compact />}

      <section>
        <div className="st-section-head"><div className="st-h2">Reference sheet</div><span className="st-muted">{v.sheet.progress.approved} of {v.sheet.progress.total} approved{v.sheet.progress.stale ? `, ${v.sheet.progress.stale} to re-check` : ''}</span><span className="st-spacer" />{v.sheetLock && <span className="st-badge plain" title="One model for the whole sheet (SPEC 5.1 rule 7)">{v.sheetLock.model}</span>}</div>
        <div className="st-grid sheet">
          {shots.map(s => (
            <button key={s.id} className={`st-tile ${s.framing === 'full_body' ? 'full' : ''} ${nextShot?.id === s.id ? 'next' : ''}`} onClick={() => setOpen(s.id)}>
              <Img assetId={s.approved?.assetId ?? s.candidates.find(c => c.status === 'in_review')?.assetId ?? null} width={320} />
              <ShotBadge status={s.status} />
              <div><div className="st-tile-label">{s.label}</div><div className="st-tile-id">{s.id}</div></div>
            </button>
          ))}
        </div>
      </section>

      <ShotDrawer v={v} shot={shots.find(s => s.id === open) ?? null} onClose={() => setOpen(null)} />
    </div>
  )
}

// Drop the whole sheet folder: "REF 00" to "REF 11" become REF-00 to
// REF-11, go straight to storage, and are checked against REF-00 (face match
// and skin texture) on the worker.
function SheetFolderDrop({ v, compact = false }: { v: CharacterView; compact?: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  async function send(files: File[]) {
    const sheet = files.filter(f => typeOf(f).startsWith('image/') && sheetRefOf(f.name))
    if (!sheet.length) { toast({ tone: 'bad', text: 'No images named REF 00 to REF 11 in that drop.' }); return }
    setBusy(`Uploading 0 of ${sheet.length}...`)
    try {
      const r = await api.applyFile(v.id, sheet, (n, total) => setBusy(`Uploading ${n} of ${total}...`))
      refresh(v.id)
      toast({ tone: 'ok', text: `Added ${r.importedShots.join(', ')}.${r.checkJobId ? ' Checking faces and skin texture against REF-00 now.' : ''}` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  return (
    <label className={`st-drop ${over ? 'over' : ''}`} style={compact ? { padding: 14 } : { maxWidth: 520, margin: '0 auto', width: '100%' }}
      onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={async e => { e.preventDefault(); setOver(false); if (!busy) await send(await filesFromDrop(e.dataTransfer)) }}>
      {busy ? <Loader2 size={20} className="st-spin" /> : <FolderOpen size={20} />}
      <span>{busy ?? (compact ? 'Drop sheet images or the sheet folder here to add them' : 'Drop the sheet folder here, or choose it')}</span>
      <input type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={e => e.target.files && void send(Array.from(e.target.files))} />
    </label>
  )
}

// Results of the free check on imported images: face match against REF-00
// and skin texture. Only shots that need a look are listed.
function ImportCheck({ v }: { v: CharacterView }) {
  const active = useActiveJobs()
  const checking = (active.data?.jobs ?? []).some(j => j.purpose === 'import_check' && j.characterId === v.id)
  const flagged = v.sheet.shots.flatMap(s => {
    const c = s.approved ? s.candidates.find(x => x.id === s.approved!.candidateId) : undefined
    return c?.qaReport && c.qaReport.verdict !== 'post' ? [{ shot: s, report: c.qaReport }] : []
  })
  if (!checking && !flagged.length) return null
  return (
    <section className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">Import check</div><div className="st-hint">Each imported image against REF-00: face match and skin texture. Free; runs on the worker.</div></div>{checking && <Loader2 size={16} className="st-spin" />}</div>
      <div className="st-card-body st-col" style={{ gap: 10 }}>
        {checking && !flagged.length && <span className="st-hint">Checking the imported images...</span>}
        {flagged.map(({ shot, report }) => (
          <Callout key={shot.id} tone={report.verdict === 'regenerate' ? 'bad' : 'warn'} icon={<ShieldAlert size={16} />}>
            <b>{shot.id}</b> {shot.label}: {report.findings.filter(f => f.severity !== 'info').map(f => f.message).join(' ') || report.summary}
          </Callout>
        ))}
      </div>
    </section>
  )
}

function lastFailed(shot: Shot): Candidate | undefined {
  return shot.candidates.find(c => c.status === 'qa_failed')
}

function NextUp({ v, shot, action }: { v: CharacterView; shot: Shot; action: 'generate' | 'review' | 'recheck' }) {
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefresh()
  const [variations, setVariations] = useState(v.variationDefault)
  const [ref00Only, setRef00Only] = useState(false)
  const failed = lastFailed(shot)
  const fixReason = failed?.qaReport?.reasons[0]
  const attach = ref00Only ? ['REF-00'] : shot.attach
  const thumbs = attach.map(id => v.sheet.shots.find(s => s.id === id)!)
  const reviewing = shot.candidates.filter(c => c.status === 'in_review')

  async function keep() {
    try { await api.keepStale(v.id, shot.id); refresh(v.id); toast({ tone: 'ok', text: `${shot.id} kept.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <div className="st-nextup">
      <Img assetId={action === 'review' ? reviewing[0]?.assetId : action === 'recheck' ? shot.approved?.assetId : v.sheet.shots[0]!.approved?.assetId} width={360} />
      <div className="st-col" style={{ gap: 12, minWidth: 0 }}>
        <div className="st-row" style={{ gap: 8 }}><span className="st-kicker" style={{ margin: 0 }}>Next up · {shot.id}</span>{action === 'recheck' && <span className="st-badge warn">Re-check</span>}{action === 'review' && <span className="st-badge info">Ready for review</span>}</div>
        <div className="st-nextup-title">{shot.label}</div>

        {action === 'generate' && (
          <>
            <div className="st-row" style={{ gap: 8 }}>
              <span className="st-hint">Uses</span>
              <div className="st-refs">{thumbs.map(t => <Img key={t.id} assetId={t.approved?.assetId} width={80} />)}</div>
              <span className="st-hint">{attach.join(' + ')}</span>
            </div>
            {failed?.qaReport && (
              <Callout tone="bad" icon={<ShieldAlert size={16} />}>Last try failed QA: {failed.qaReport.summary.replace(/^Regenerate: /, '')}</Callout>
            )}
            {failed?.qaReport?.mirrorFix?.available && (
              <div className="st-row" style={{ gap: 10 }}>
                <MirrorButton v={v} candidate={failed} />
                <span className="st-hint">{failed.qaReport.mirrorFix.message}</span>
              </div>
            )}
            <div className="st-row">
              <span className="st-label">Variations</span>
              <div className="st-stepnum"><button onClick={() => setVariations(n => Math.max(1, n - 1))} aria-label="Fewer">-</button><span>{variations}</span><button onClick={() => setVariations(n => Math.min(4, n + 1))} aria-label="More">+</button></div>
              {shot.attach.length > 1 && <label className="st-row st-hint" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={ref00Only} onChange={e => setRef00Only(e.target.checked)} />From REF-00 only</label>}
            </div>
            <PriceButton
              size="big"
              label={failed ? 'Regenerate with the fix' : `Generate ${shot.id}`}
              action={{ type: 'sheet', characterId: v.id, refId: shot.id, variations, reason: failed ? fixReason : undefined, refsMode: ref00Only ? 'ref00_only' : 'graph', withQa: true }}
            />
            <span className="st-hint">Price includes automatic QA (mark sides, framing, jewelry) on every variation.</span>
          </>
        )}

        {action === 'review' && (
          <div className="st-row">
            <button className="st-btn primary big" onClick={() => nav(`/studio/c/${v.id}/review/${shot.id}`)}><Eye size={18} />Review {reviewing.length > 1 ? `${reviewing.length} results` : 'now'}</button>
            {reviewing[0]?.qaVerdict && <span className={`st-badge ${reviewing[0].qaVerdict === 'post' ? 'ok' : 'warn'}`}>QA: {reviewing[0].qaVerdict === 'post' ? 'looks right' : 'needs your eye'}</span>}
          </div>
        )}

        {action === 'recheck' && (
          <>
            <p className="st-sub" style={{ margin: 0 }}>{shot.staleReason || 'A shot it depends on changed'}. Check this one still matches.</p>
            {shot.approved && shot.candidates.find(c => c.id === shot.approved!.candidateId)?.qaReport && (
              <Callout tone={shot.candidates.find(c => c.id === shot.approved!.candidateId)!.qaVerdict === 'post' ? 'ok' : 'warn'}>{shot.candidates.find(c => c.id === shot.approved!.candidateId)!.qaReport!.summary}</Callout>
            )}
            <div className="st-row">
              <button className="st-btn ok" onClick={keep}><CheckCircle2 size={16} />Still right, keep it</button>
              {shot.approved && <PriceButton action={{ type: 'qa', characterId: v.id, candidateId: shot.approved.candidateId }} label="Run QA again" variant="secondary" />}
            </div>
            <PriceButton action={{ type: 'sheet', characterId: v.id, refId: shot.id, variations, refsMode: 'graph', withQa: true }} label="Regenerate" variant="secondary" />
          </>
        )}
      </div>
    </div>
  )
}

function ShotDrawer({ v, shot, onClose }: { v: CharacterView; shot: Shot | null; onClose: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefresh()
  const [reason, setReason] = useState<string>('')
  if (!shot) return null
  const blocked = shot.attach.filter(id => v.sheet.shots.find(s => s.id === id)?.status !== 'approved')

  async function restore(c: Candidate) {
    try { const r = await api.approve(c.id); refresh(v.id); toast({ tone: 'ok', text: r.invalidated.length ? `Restored. ${r.invalidated.join(' and ')} need a re-check.` : 'Restored.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <Drawer open onClose={onClose} title={<span>{shot.id} · {shot.label}</span>}>
      <div className="st-col" style={{ gap: 16 }}>
        <div className="st-row"><ShotBadge status={shot.status} /><span className="st-hint">{shot.framing === 'chest_up' ? 'Chest-up' : 'Full body'} · {shot.aspect} · uses {shot.attach.join(', ') || 'the hero'}</span></div>
        {shot.approved && <Img assetId={shot.approved.assetId} width={900} contain style={{ aspectRatio: shot.framing === 'full_body' ? '9/16' : '3/4' }} />}
        {shot.candidates.some(c => c.status === 'in_review') && <button className="st-btn primary" onClick={() => nav(`/studio/c/${v.id}/review/${shot.id}`)}><Eye size={16} />Review</button>}
        {shot.id !== 'REF-00' && (
          <div className="st-card" style={{ padding: 14, boxShadow: 'none' }}>
            <div className="st-h3" style={{ marginBottom: 8 }}>Regenerate this shot</div>
            {(
              <div className="st-col" style={{ gap: 10 }}>
                {blocked.length > 0 && <span className="st-hint">{blocked.join(' and ')} {blocked.length > 1 ? 'are' : 'is'} not approved yet, so this shot uses the approved shots it depends on.</span>}
                <select className="st-select" value={reason} onChange={e => setReason(e.target.value)}>
                  <option value="">No specific problem</option>
                  {v.reasons.filter(r => r.id !== 'talking').map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <PriceButton action={{ type: 'sheet', characterId: v.id, refId: shot.id, variations: 1, reason: reason || undefined, refsMode: 'graph', withQa: true }} label="Regenerate" variant="secondary" icon />
              </div>
            )}
          </div>
        )}
        <div className="st-h3">History</div>
        {shot.candidates.length === 0 && <span className="st-hint">Nothing generated for this shot yet.</span>}
        {shot.candidates.map(c => (
          <div key={c.id} className="st-row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <Img assetId={c.assetId} width={160} style={{ width: 72, aspectRatio: '3/4', flex: 'none' }} />
            <div className="st-col" style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <div className="st-row" style={{ gap: 6 }}><span className={`st-badge plain ${c.status === 'approved' ? 'ok' : c.status === 'qa_failed' || c.status === 'failed' ? 'bad' : c.status === 'rejected' ? 'warn' : ''}`}>{statusLabel(c.status)}</span><span className="st-hint">{new Date(c.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
              {c.qaReport && <span className="st-hint">{c.qaReport.summary}</span>}
              {c.rejectReasons.length > 0 && <span className="st-hint">Rejected: {c.rejectReasons.map(r => v.reasons.find(x => x.id === r)?.label ?? r).join(', ')}</span>}
              <div className="st-row" style={{ gap: 6 }}>
                {(['superseded', 'rejected', 'qa_failed'].includes(c.status) || (c.status === 'check' && c.qaVerdict === 'post')) && c.assetId && <button className="st-btn sm ghost" onClick={() => restore(c)}><RotateCcw size={13} />Approve this version</button>}
                {c.qaReport?.mirrorFix?.available && <MirrorButton v={v} candidate={c} small />}
              </div>
            </div>
          </div>
        ))}
        <span className="st-hint"><Sparkles size={12} style={{ verticalAlign: -2 }} /> Every version is kept. Rejected results are archived, never deleted.</span>
      </div>
    </Drawer>
  )
}

function statusLabel(s: string): string {
  return ({ generating: 'Generating', qa_pending: 'Checking', qa_failed: 'Failed QA', in_review: 'Needs review', approved: 'Approved', rejected: 'Rejected', superseded: 'Replaced', failed: 'Failed', check: 'To check' } as Record<string, string>)[s] ?? s
}

// The free fix QA offers when a shot came back mirrored: flip it. No
// provider call, no cost, and the face cannot drift.
function MirrorButton({ v, candidate, small }: { v: CharacterView; candidate: Candidate; small?: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [busy, setBusy] = useState(false)
  async function mirror() {
    setBusy(true)
    try {
      await api.mirror(candidate.id)
      refresh(v.id)
      toast({ tone: 'ok', text: `Mirrored ${candidate.refId}. No new generation, no cost.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <button className={`st-btn ${small ? 'sm ghost' : 'secondary'}`} disabled={busy} onClick={mirror} title={candidate.qaReport?.mirrorFix?.message}>
      {busy ? <Loader2 size={small ? 13 : 16} className="st-spin" /> : <FlipHorizontal2 size={small ? 13 : 16} />}Mirror it (free)
    </button>
  )
}

// Images brought in to be checked (for example a mirrored REF-04 kept as a
// negative test). They never join the sheet unless approved after a pass.
function ToCheck({ v }: { v: CharacterView }) {
  const items = v.sheet.shots.flatMap(s => s.candidates.filter(c => c.status === 'check').map(c => ({ shot: s, c })))
  if (!items.length) return null
  return (
    <section className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">To check</div><div className="st-hint">Uploaded for a QA check. Not part of the sheet.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        {items.map(({ shot, c }) => (
          <div key={c.id} className="st-row" style={{ gap: 14, alignItems: 'flex-start' }}>
            <Img assetId={c.assetId} width={200} style={{ width: 96, aspectRatio: '3/4', flex: 'none' }} />
            <div className="st-col" style={{ gap: 8, minWidth: 0, flex: 1 }}>
              <div className="st-row" style={{ gap: 8 }}><b>{c.rejectNote.replace(/^Uploaded to check: /, '') || 'Uploaded image'}</b><span className="st-hint">checked against {shot.id} · {shot.label}</span></div>
              {c.qaReport ? (
                <Callout tone={c.qaVerdict === 'post' ? 'ok' : c.qaVerdict === 'regenerate' ? 'bad' : 'warn'} icon={c.qaVerdict === 'post' ? undefined : <ShieldAlert size={16} />}>{c.qaReport.summary}</Callout>
              ) : (
                <span className="st-hint">QA reads the mark sides, the view and the framing. It is a paid vision call, so the price shows first.</span>
              )}
              <div className="st-row" style={{ gap: 8 }}>
                {!c.qaReport && <PriceButton action={{ type: 'qa', characterId: v.id, candidateId: c.id }} label="Run QA" variant="secondary" />}
                {c.qaReport?.mirrorFix?.available && <MirrorButton v={v} candidate={c} />}
                {c.qaReport?.mirrorFix && !c.qaReport.mirrorFix.available && <span className="st-hint">{c.qaReport.mirrorFix.message}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
