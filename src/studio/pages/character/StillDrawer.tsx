import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, Crop, FlipHorizontal2, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { api, ApiError } from '../../api'
import { useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Drawer, Field, Img, PromptViewer, errorMessage, useToast } from '../../ui'
import type { CharacterView, QaReport, SceneStill, SceneView, ScenesData } from '../../types'
import { CropTool } from './CropTool'

// One still: compare with REF-00, the QA verdict in plain words, and every
// next step. A pick, a one-change fix (SPEC 5.3), a free mirror, a free crop
// closer and its 2x upscale, or a regenerate.

export const STILL_STATUS: Record<string, { label: string; tone: string }> = {
  qa_pending: { label: 'Checking', tone: 'accent live' },
  in_review: { label: 'Needs review', tone: 'info' },
  approved: { label: 'Picked', tone: 'ok' },
  qa_failed: { label: 'Failed QA', tone: 'bad' },
  rejected: { label: 'Rejected', tone: 'warn' },
  superseded: { label: 'Replaced', tone: '' },
  failed: { label: 'Failed', tone: 'bad' },
}

export const OP_LABEL: Record<SceneStill['op'], string> = {
  generate: 'Still', edit: 'Edit', crop: 'Crop', upscale: 'Upscale 2x', mirror: 'Mirrored', drift_lock: 'Drift lock',
  end_frame: 'End frame', video: 'Take', video_upscale: 'Upscaled take', upload: 'Uploaded clip', clone: 'Clone', chain: 'Chained clip', last_frame: 'Last frame',
}

export function wrap(text: string, width = 72): string {
  const out: string[] = []
  let line = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = w
    else if (line.length + 1 + w.length <= width) line += ` ${w}`
    else { out.push(line); line = w }
  }
  if (line) out.push(line)
  return out.join('\n')
}

// `action` is the post's next step for this still ("Use this still", or add
// it to a slideshow), shown at the top.
export function StillDrawer({ v, data, scene, still, onClose, onOpen, action }: { v: CharacterView; data: ScenesData; scene: SceneView; still: SceneStill | null; onClose: () => void; onOpen: (id: string) => void; action?: (c: SceneStill) => ReactNode }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [compare, setCompare] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reasons, setReasons] = useState<string[]>([])
  const [fixes, setFixes] = useState<Array<{ reason: string; action: string; label: string; available: boolean }> | null>(null)
  const [cropping, setCropping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDrift, setConfirmDrift] = useState(false)
  useEffect(() => { setRejecting(false); setReasons([]); setFixes(null); setCompare(false); setConfirmDrift(false) }, [still?.id])
  if (!still) return null

  const r = still.qaReport
  const ref00 = v.sheet.shots[0]!.approved?.assetId
  const parent = still.parentId ? scene.candidates.find(c => c.id === still.parentId) : undefined
  const drift = !!r?.findings.some(f => f.severity === 'fail' && f.code === 'face_drift')
  // Plastic or smoothed skin is the fixed Realism rule; face drift is a
  // strong warning you confirm (Settings, Rules).
  const plastic = !!r?.findings.some(f => f.severity === 'fail' && (f.code === 'skin_plastic' || f.code === 'skin_smoothed'))
  const canPick = !!still.assetId && ['in_review', 'qa_failed', 'rejected', 'superseded'].includes(still.status) && !plastic
  const s = STILL_STATUS[still.status] ?? { label: still.status, tone: '' }

  async function pick(acknowledge = false) {
    setBusy(true)
    try {
      const out = await api.approve(still!.id, acknowledge)
      setConfirmDrift(false)
      refresh(v.id)
      toast({ tone: 'ok', text: out.comboLogged ? 'Picked. Added to the combo log.' : 'Picked.' })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_required') setConfirmDrift(true)
      else toast({ tone: 'bad', text: errorMessage(e) })
    } finally { setBusy(false) }
  }
  async function reject() {
    setBusy(true)
    try {
      const out = await api.reject(still!.id, reasons, '')
      const id = still!.id
      setFixes(out.fixes)
      setRejecting(false)
      refresh(v.id)
      toast({ tone: '', text: 'Rejected and archived.', action: { label: 'Undo', run: async () => { await api.reopen(id); setFixes(null); refresh(v.id) } } })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  async function mirror() {
    setBusy(true)
    try {
      const out = await api.mirror(still!.id)
      refresh(v.id)
      onOpen(out.candidateId)
      toast({ tone: 'ok', text: 'Mirrored. No new generation, no cost.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  async function reopen() {
    try { await api.reopen(still!.id); refresh(v.id) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  const regenerateReason = fixes?.find(f => f.action !== 'edit_one_detail')?.reason
  return (
    <Drawer open onClose={onClose} wide title={<span>{OP_LABEL[still.op]} · <span className="st-muted">{scene.title || 'Scene'}</span></span>}>
      <div className="st-col" style={{ gap: 16 }}>
        <div className="st-row" style={{ gap: 8 }}>
          <span className={`st-badge ${s.tone}`}>{s.label}</span>
          {parent && <button className="st-btn sm ghost" onClick={() => onOpen(parent.id)}>Made from: {OP_LABEL[parent.op].toLowerCase()}</button>}
          <span className="st-spacer" />
          {ref00 && still.assetId && <button className={`st-btn sm ${compare ? 'secondary' : 'ghost'}`} onClick={() => setCompare(c => !c)}>{compare ? 'Hide' : 'Compare with'} REF-00</button>}
        </div>
        {still.assetId ? (
          <div className={compare ? 'st-grid two' : ''} style={{ gap: 10 }}>
            {compare && <Img assetId={ref00} width={700} contain style={{ aspectRatio: scene.aspect.replace(':', ' / '), maxHeight: '64vh' }} />}
            <Img assetId={still.assetId} width={1200} contain style={{ aspectRatio: scene.aspect.replace(':', ' / '), maxHeight: '64vh' }} />
          </div>
        ) : (
          <Callout tone="bad" icon={<AlertTriangle size={16} />}>This run did not finish{still.rejectNote ? `: ${still.rejectNote}` : '.'} Nothing was charged for it.</Callout>
        )}

        {still.status === 'qa_pending' ? <Callout tone="info" icon={<Loader2 size={16} className="st-spin" />}>Checking the face, marks, logos, jewelry and skin texture...</Callout> : <Verdict r={r} />}
        {still.assetId && still.status !== 'qa_pending' && (
          <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <PriceButton action={{ type: 'scene_qa', characterId: v.id, candidateId: still.id }} label={claudeChecked(r) ? 'Check again' : 'Check this'} variant="secondary" size="sm" icon={false} />
            <span className="st-hint">Claude looks at the face, the mole side, logos, jewelry and skin. On demand only.</span>
          </div>
        )}

        {still.assetId && !fixes && !rejecting && (
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {/* In a post, its next step ("Use this still") is the only way to
                pick: one button, which also writes the video prompt. */}
            {action ? (['failed', 'qa_pending', 'qa_failed', 'rejected'].includes(still.status) ? null : action(still))
              : still.status === 'approved' ? <span className="st-badge ok"><CheckCircle2 size={13} /> Picked</span> : (
                <button className="st-btn ok" disabled={!canPick || busy} onClick={() => pick()} title={plastic ? 'Real skin is a fixed rule: regenerate this one.' : undefined}><CheckCircle2 size={16} />Pick this still</button>
              )}
            {['in_review', 'qa_failed', 'approved'].includes(still.status) && <button className="st-btn bad" disabled={busy} onClick={() => setRejecting(true)}><XCircle size={16} />Reject</button>}
            {['rejected', 'superseded'].includes(still.status) && <button className="st-btn ghost" onClick={reopen}><RotateCcw size={14} />Back to review</button>}
            <button className={`st-btn ${r?.mirrorFix?.available ? 'secondary' : 'ghost'}`} disabled={busy} onClick={mirror} title={r?.mirrorFix?.available ? r.mirrorFix.message : 'Flip the still horizontally. Free; any text in the frame is mirrored too.'}><FlipHorizontal2 size={16} />Mirror (free)</button>
          </div>
        )}
        {confirmDrift && (
          <Callout tone="bad" icon={<AlertTriangle size={16} />}>
            <b>The face does not match REF-00.</b> QA usually suggests a regenerate here. Pick it anyway?
            <div className="st-row" style={{ gap: 8, marginTop: 8 }}>
              <button className="st-btn sm bad" disabled={busy} onClick={() => pick(true)}>Pick anyway</button>
              <button className="st-btn sm ghost" onClick={() => setConfirmDrift(false)}>Cancel</button>
            </div>
          </Callout>
        )}

        {rejecting && (
          <div className="st-card pad st-col" style={{ gap: 10, boxShadow: 'none' }}>
            <div className="st-h3">What is wrong? Each reason picks its fix.</div>
            <div className="st-reasons">
              {data.reasons.map(x => (
                <button key={x.id} className={`st-chip ${reasons.includes(x.id) ? 'on' : ''}`} onClick={() => setReasons(rs => (rs.includes(x.id) ? rs.filter(y => y !== x.id) : [...rs, x.id]))}>{reasons.includes(x.id) && <Check size={12} />}{x.label}</button>
              ))}
            </div>
            <div className="st-row">
              <button className="st-btn ghost" onClick={() => { setRejecting(false); setReasons([]) }}>Cancel</button>
              <button className="st-btn bad" disabled={!reasons.length || busy} onClick={reject}><XCircle size={16} />Reject</button>
            </div>
          </div>
        )}

        {fixes && (
          <div className="st-card pad st-col" style={{ gap: 10, boxShadow: 'none' }}>
            <div className="st-h3">Fix: {fixes.map(f => f.label).join(', ')}</div>
            {fixes.some(f => f.action === 'edit_one_detail') && !drift && <span className="st-hint">Use "Fix one thing" below: one change per pass, the rest of the still stays the same.</span>}
            {(regenerateReason || drift) && (
              <PriceButton label="Regenerate the scene with the fix" variant="secondary" action={{ type: 'scene', characterId: v.id, sceneId: scene.id, models: data.options.defaultModels, variations: 1, reason: regenerateReason, withQa: data.options.autoQa }} />
            )}
          </div>
        )}

        {still.assetId && <FixOne v={v} data={data} still={still} drift={drift} />}

        {still.assetId && (
          <div className="st-card pad st-col" style={{ gap: 10, boxShadow: 'none' }}>
            <div className="st-h3">Closer shot</div>
            <span className="st-hint">A closer shot of this scene is a crop of this still, never a new generation, so the place stays exactly the same. Free; then upscale it 2x.</span>
            <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="st-btn secondary" onClick={() => setCropping(true)}><Crop size={16} />Crop closer (free)</button>
              {(still.op === 'crop' || still.op === 'edit' || still.op === 'mirror') && (
                <PriceButton action={{ type: 'scene_upscale', characterId: v.id, candidateId: still.id }} label="Upscale 2x" variant={still.op === 'crop' ? 'primary' : 'secondary'} />
              )}
            </div>
          </div>
        )}

        {still.prompt && <PromptViewer label="Prompt sent" wrapped={wrap(still.prompt)} text={still.prompt} />}
      </div>
      {cropping && still.assetId && <CropTool assetId={still.assetId} aspect={scene.aspect} onClose={() => setCropping(false)} onCropped={id => { setCropping(false); refresh(v.id); onOpen(id) }} candidateId={still.id} />}
    </Drawer>
  )
}

// Stage 8: one change per pass. QA's suggested fixes come first, then the
// ready-made ones; the text says what changes and where.
function FixOne({ v, data, still, drift }: { v: CharacterView; data: ScenesData; still: SceneStill; drift: boolean }) {
  const suggestions = still.qaReport?.edits ?? []
  const [change, setChange] = useState(suggestions[0]?.change ?? '')
  const [face, setFace] = useState(suggestions[0]?.face ?? false)
  const [model, setModel] = useState(data.options.editModels.find(m => !(data.options.mode === 'live' && m.path === 'account' && !data.options.accountConnected))?.ref ?? data.options.editModels[0]?.ref)
  useEffect(() => { setChange(suggestions[0]?.change ?? ''); setFace(suggestions[0]?.face ?? false) }, [still.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const placeholder = /\{thing\}/.test(change)
  const ready = change.trim().length >= 3 && !placeholder
  const todo = change.trim().length < 3 ? [{ label: 'Say what to change, where, and on which side', target: 'fix-change' }]
    : placeholder ? [{ label: 'Replace {thing} with what to remove and where', target: 'fix-change' }] : []
  return (
    <div className="st-card pad st-col" style={{ gap: 10, boxShadow: 'none' }}>
      <div className="st-h3">Fix one thing</div>
      <span className="st-hint">Edit, don't regenerate, when the face is right and only a detail is wrong. One change per pass usually works best; the rest of the still stays the same.</span>
      {drift && <span className="st-hint" style={{ color: 'var(--st-warn)' }}>QA found face drift. An edit rarely fixes a face; a regenerate usually does. Your call.</span>}
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {suggestions.map((s, i) => <button key={`qa${i}`} className="st-chip on" onClick={() => { setChange(s.change); setFace(s.face) }}>QA: {s.change.length > 48 ? `${s.change.slice(0, 48)}...` : s.change}</button>)}
        {data.options.editPresets.filter(p => p.group !== 'diagnose').map(p => <button key={p.id} className="st-chip" onClick={() => { setChange(p.text); setFace(p.face) }}>{p.label}</button>)}
      </div>
      {data.options.editPresets.some(p => p.group === 'diagnose') && (
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="st-hint">Diagnose and revise:</span>
          {data.options.editPresets.filter(p => p.group === 'diagnose').map(p => <button key={p.id} className="st-chip" title={p.hint ? `First useful revision: ${p.hint}` : undefined} onClick={() => { setChange(p.text); setFace(p.face) }}>{p.label}</button>)}
        </div>
      )}
      <Field id="fix-change" label="The one change" required done={ready}>
        <textarea className="st-textarea" rows={2} style={{ minHeight: 0 }} maxLength={400} value={change} onChange={e => setChange(e.target.value)} placeholder="e.g. Remove the white logo on the cup in her right hand, leaving it plain" />
      </Field>
      <div className="st-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label className="st-row st-hint" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={face} onChange={e => setFace(e.target.checked)} />Attach REF-00 for the face (expression changes)</label>
        {data.options.editModels.length > 1 && (
          <select className="st-select" style={{ width: 'auto' }} value={model} onChange={e => setModel(e.target.value)}>
            {data.options.editModels.map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}
          </select>
        )}
      </div>
      <PriceButton
        label="Run this edit"
        todo={todo}
        action={todo.length ? null : { type: 'scene_edit', characterId: v.id, candidateId: still.id, change: change.trim(), face, model, withQa: data.options.autoQa }}
      />
    </div>
  )
}

// Whether Claude has looked at this still (the free checks say when not).
export const claudeChecked = (r: QaReport | null) => !!r && !r.findings.some(f => f.message.startsWith('Not checked by Claude'))

function Verdict({ r }: { r: (QaReport & { edits?: unknown }) | null }) {
  if (!r) return <Callout tone="warn" icon={<AlertTriangle size={16} />}>No automatic check for this still. Look at the face, the marks and the details yourself.</Callout>
  const title = { post: 'QA: looks right', edit: 'QA: a detail to fix', regenerate: 'QA: should be regenerated', uncertain: 'QA: needs your eye' }[r.verdict]
  const notes = r.findings.filter(f => f.severity !== 'info')
  const kept = r.findings.find(f => f.code === 'flaws_kept')
  const tone = r.verdict === 'post' ? 'ok' : r.verdict === 'regenerate' ? 'bad' : 'warn'
  return (
    <Callout tone={tone} icon={r.verdict === 'post' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}>
      <b>{title}</b>
      {notes.length > 0 ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{notes.slice(0, 5).map((f, i) => <li key={i}>{f.message}</li>)}</ul> : <div>Face, marks, jewelry and logos look right.</div>}
      {kept && <div className="st-hint" style={{ marginTop: 6 }}>{kept.message}</div>}
      {r.identity && <div className="st-hint" style={{ marginTop: 4 }}>Face match vs {r.identity.against}: {r.identity.score.toFixed(2)} (needs {r.identity.threshold.toFixed(2)})</div>}
      {r.texture && <div className="st-hint" style={{ marginTop: 4 }}>Skin detail kept: {Math.round(Math.min(1, r.texture.ratio) * 100)}%</div>}
    </Callout>
  )
}
