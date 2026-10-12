import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Eye, Loader2, RotateCcw, ShieldAlert, Sparkles, Download } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Drawer, Img, ShotBadge, errorMessage, useToast } from '../../ui'
import type { Candidate, CharacterView, Shot } from '../../types'

// Stage 4: the reference sheet as one "next up" card at a time, with the
// right refs already attached (SPEC 11: no REF math).
export function SheetTab({ v, goHero }: { v: CharacterView; goHero: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const shots = v.sheet.shots
  const ref00 = shots[0]!
  const generating = shots.filter(s => s.status === 'generating')
  const nextShot = v.sheet.next ? shots.find(s => s.id === v.sheet.next!.refId)! : null

  if (!ref00.approved) {
    return <div className="st-empty"><h2 className="st-h1">Pick a hero <em>first</em></h2><p className="st-sub" style={{ margin: 0 }}>The sheet is built from REF-00, the hero you pick.</p><button className="st-btn primary" onClick={goHero}>Go to hero<ArrowRight size={15} /></button></div>
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
            {blocked.length > 0 ? <span className="st-hint">Approve {blocked.join(' and ')} first.</span> : (
              <div className="st-col" style={{ gap: 10 }}>
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
              {['superseded', 'rejected', 'qa_failed'].includes(c.status) && c.assetId && <button className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => restore(c)}><RotateCcw size={13} />Approve this version</button>}
            </div>
          </div>
        ))}
        <span className="st-hint"><Sparkles size={12} style={{ verticalAlign: -2 }} /> Every version is kept. Rejected results are archived, never deleted.</span>
      </div>
    </Drawer>
  )
}

function statusLabel(s: string): string {
  return ({ generating: 'Generating', qa_pending: 'Checking', qa_failed: 'Failed QA', in_review: 'Needs review', approved: 'Approved', rejected: 'Rejected', superseded: 'Replaced', failed: 'Failed' } as Record<string, string>)[s] ?? s
}
