import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle2, Columns2, FileText, FlipHorizontal2, Maximize, ScanFace, SplitSquareHorizontal, X, XCircle } from 'lucide-react'
import { api, assetUrl } from '../api'
import { useCharacter, useRefresh } from '../hooks'
import { PriceButton } from '../PriceButton'
import { Drawer, PromptViewer, errorMessage, useToast } from '../ui'
import type { Candidate, CharacterView, QaReport, Shot } from '../types'

// The human gate (SPEC 6 and 11): one candidate at a time beside REF-00 at
// full size, synced zoom on face and sides, the QA verdict in plain words,
// and big Approve / Reject buttons. Works on a phone.

interface View { s: number; x: number; y: number }
const FIT: View = { s: 1, x: 0, y: 0 }

function wrap(text: string, width = 72): string {
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

export default function Review() {
  const { id = '', refId } = useParams()
  const q = useCharacter(id)
  const nav = useNavigate()
  const v = q.data
  if (!v) return <div className="st-review" style={{ display: 'grid', placeItems: 'center' }}>Loading...</div>
  const shot = (refId ? v.sheet.shots.find(s => s.id === refId) : undefined) ?? v.sheet.shots.find(s => s.candidates.some(c => c.status === 'in_review'))
  if (!shot) {
    return (
      <div className="st-review" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div className="st-col" style={{ alignItems: 'center', gap: 14 }}>
          <CheckCircle2 size={40} color="#3fd18f" />
          <div className="st-h1" style={{ fontSize: 36 }}>Nothing waiting for review</div>
          <button className="st-btn primary" onClick={() => nav(`/studio/c/${id}`)}>Back to {v.data.name}</button>
        </div>
      </div>
    )
  }
  return <ReviewShot key={shot.id} v={v} shot={shot} />
}

function ReviewShot({ v, shot }: { v: CharacterView; shot: Shot }) {
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefresh()
  const queue = shot.candidates.filter(c => c.status === 'in_review')
  const [index, setIndex] = useState(0)
  const cand: Candidate | undefined = queue[Math.min(index, queue.length - 1)]
  const ref00 = v.sheet.shots[0]!.approved?.assetId
  const [mode, setMode] = useState<'side' | 'slider'>('side')
  const [split, setSplit] = useState(50)
  const [view, setView] = useState<View>(FIT)
  const [showRef, setShowRef] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [fixes, setFixes] = useState<Array<{ reason: string; action: string; label: string; available: boolean }> | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const shotNumber = v.sheet.shots.findIndex(s => s.id === shot.id) + 1

  useEffect(() => { setView(FIT) }, [cand?.id])

  const back = () => nav(`/studio/c/${v.id}`)

  async function approve() {
    if (!cand || busy) return
    setBusy(true)
    try {
      const r = await api.approve(cand.id)
      refresh(v.id)
      toast({ tone: 'ok', text: r.sheetComplete ? 'Sheet complete. All 12 shots approved.' : r.invalidated.length ? `${shot.id} approved. ${r.invalidated.join(' and ')} need a re-check.` : `${shot.id} approved.` })
      const nextReview = v.sheet.shots.find(s => s.id !== shot.id && s.candidates.some(c => c.status === 'in_review'))
      nav(nextReview ? `/studio/c/${v.id}/review/${nextReview.id}` : `/studio/c/${v.id}`)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  async function reject() {
    if (!cand || !reasons.length || busy) return
    setBusy(true)
    try {
      const r = await api.reject(cand.id, reasons, note)
      const rejectedId = cand.id
      setFixes(r.fixes)
      setRejecting(false)
      refresh(v.id)
      toast({ tone: '', text: `${shot.id} rejected and archived.`, action: { label: 'Undo', run: async () => { await api.reopen(rejectedId); setFixes(null); refresh(v.id) } } })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  // Keyboard: A approve, R reject, F fit, 1-3 zoom, S compare mode, Esc back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'a' || e.key === 'A') approve()
      else if (e.key === 'r' || e.key === 'R') setRejecting(true)
      else if (e.key === 'f' || e.key === 'F') setView(FIT)
      else if (e.key === 's' || e.key === 'S') setMode(m => (m === 'side' ? 'slider' : 'side'))
      else if (e.key === '1') setView(zoomTo(0.5, 0.3, 2.2))
      else if (e.key === '2') setView(zoomTo(0.3, 0.32, 3))
      else if (e.key === '3') setView(zoomTo(0.7, 0.32, 3))
      else if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="st-root" style={{ minHeight: 0 }}>
      <div className="st-review">
        <div className="st-review-top">
          <button className="st-btn icon ghost" onClick={back} aria-label="Close review"><X size={18} /></button>
          <div style={{ minWidth: 0 }}>
            <div className="st-kicker" style={{ margin: 0 }}>{v.data.name} · shot {shotNumber} of 12</div>
            <div className="st-h2">{shot.id} · {shot.label}</div>
          </div>
          <span className="st-spacer" />
          {queue.length > 1 && (
            <div className="st-thumbs">{queue.map((c, i) => <button key={c.id} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} aria-label={`Variation ${i + 1}`}><img src={assetUrl(c.assetId!, 120)} alt="" /></button>)}</div>
          )}
          {cand && <button className="st-btn sm ghost" onClick={() => setPromptOpen(true)}><FileText size={14} />Prompt</button>}
        </div>

        <div className="st-review-tools">
          <div className="st-seg">
            <button className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}><Columns2 size={13} style={{ verticalAlign: -2 }} /> Side by side</button>
            <button className={mode === 'slider' ? 'on' : ''} onClick={() => setMode('slider')}><SplitSquareHorizontal size={13} style={{ verticalAlign: -2 }} /> Slider</button>
          </div>
          <div className="st-seg">
            <button onClick={() => setView(FIT)}><Maximize size={13} style={{ verticalAlign: -2 }} /> Fit</button>
            <button onClick={() => setView(zoomTo(0.5, 0.3, 2.2))}><ScanFace size={13} style={{ verticalAlign: -2 }} /> Face</button>
            <button onClick={() => setView(zoomTo(0.3, 0.32, 3))}>Left of image</button>
            <button onClick={() => setView(zoomTo(0.7, 0.32, 3))}>Right of image</button>
            {shot.framing === 'full_body' && <button onClick={() => setView(zoomTo(0.5, 0.58, 2.4))}>Hands</button>}
          </div>
          <button className="st-btn sm ghost st-only-phone" onClick={() => setShowRef(s => !s)}>{showRef ? 'Hide' : 'Show'} REF-00</button>
          <span className="st-hint" style={{ color: '#827a70' }}>Scroll to zoom, drag to pan. Keys: A approve, R reject, 1-3 zoom.</span>
        </div>

        {mode === 'side' ? (
          <div className={`st-review-stage ${showRef ? 'show-ref' : ''}`}>
            <ZoomPane assetId={ref00} tag="REF-00 reference" view={view} setView={setView} className="ref" />
            <ZoomPane assetId={cand?.assetId} tag={queue.length > 1 ? `Candidate ${index + 1} of ${queue.length}` : 'Candidate'} view={view} setView={setView} />
          </div>
        ) : (
          <div className="st-review-stage slider">
            <SliderPane under={cand?.assetId} over={ref00} split={split} setSplit={setSplit} view={view} setView={setView} />
          </div>
        )}

        <div className="st-review-bottom">
          {fixes ? (
            <div className="st-col" style={{ gap: 10 }}>
              <div className="st-verdict-title">Fix: {fixes.map(f => f.label).join(', ')}</div>
              <div className="st-row">
                <PriceButton action={{ type: 'sheet', characterId: v.id, refId: shot.id, variations: 1, reason: fixes.find(f => f.available)?.reason ?? reasons[0], refsMode: 'graph', withQa: true }} label="Regenerate with the fix" onStarted={() => nav(`/studio/c/${v.id}`)} />
                <button className="st-btn ghost" onClick={back}>Later</button>
              </div>
            </div>
          ) : rejecting ? (
            <div className="st-col" style={{ gap: 10 }}>
              <div className="st-verdict-title">What is wrong? Each reason picks its fix.</div>
              <div className="st-reasons">
                {v.reasons.filter(r => r.id !== 'talking').map(r => (
                  <button key={r.id} className={`st-chip ${reasons.includes(r.id) ? 'on' : ''}`} onClick={() => setReasons(rs => (rs.includes(r.id) ? rs.filter(x => x !== r.id) : [...rs, r.id]))}>{reasons.includes(r.id) && <Check size={12} />}{r.label}</button>
                ))}
              </div>
              <input className="st-input" placeholder="Anything else? (optional)" value={note} onChange={e => setNote(e.target.value)} style={{ background: '#11100f', color: '#f6f2ec' }} />
            </div>
          ) : (
            <Verdict cand={cand} onMirror={cand?.qaReport?.mirrorFix?.available ? async () => {
              try { await api.mirror(cand.id); refresh(v.id); toast({ tone: 'ok', text: `Mirrored ${cand.refId}. No new generation, no cost.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
            } : undefined} />
          )}
          <div className="st-review-actions">
            {rejecting ? (
              <>
                <button className="st-btn big ghost" onClick={() => { setRejecting(false); setReasons([]) }}>Cancel</button>
                <button className="st-btn big bad" disabled={!reasons.length || busy} onClick={reject}><XCircle size={18} />Reject</button>
              </>
            ) : !fixes && (
              <>
                <button className="st-btn big bad" disabled={!cand || busy} onClick={() => setRejecting(true)}><XCircle size={18} />Reject</button>
                <button className="st-btn big ok" disabled={!cand || busy} onClick={approve}><CheckCircle2 size={18} />Approve</button>
              </>
            )}
          </div>
        </div>
      </div>
      {cand && (
        <Drawer open={promptOpen} onClose={() => setPromptOpen(false)} title="Prompt sent">
          <PromptViewer label={`${shot.id} prompt`} wrapped={wrap(cand.prompt)} text={cand.prompt} />
        </Drawer>
      )}
    </div>
  )
}

function zoomTo(cx: number, cy: number, s: number): View {
  // Pan offsets are fractions of the pane, so every pane zooms to the same spot.
  return { s, x: (0.5 - cx) * s, y: (0.5 - cy) * s }
}

function Verdict({ cand, onMirror }: { cand: Candidate | undefined; onMirror?: () => void }) {
  const r = cand?.qaReport
  if (!r) return <div className="st-verdict uncertain"><span className="st-verdict-icon"><AlertTriangle size={18} /></span><div><div className="st-verdict-title">No automatic QA for this result</div><ul><li>Check the marks, framing and face yourself.</li></ul></div></div>
  const title = { post: 'QA: looks right', edit: 'QA: a small detail to fix', regenerate: 'QA: should be regenerated', uncertain: 'QA: needs your eye' }[r.verdict]
  const notes = r.findings.filter(f => f.severity !== 'info')
  return (
    <div className={`st-verdict ${r.verdict}`}>
      <span className="st-verdict-icon">{r.verdict === 'post' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span>
      <div style={{ minWidth: 0 }}>
        <div className="st-verdict-title">{title}</div>
        {notes.length ? <ul>{notes.slice(0, 4).map((f, i) => <li key={i}>{f.message}</li>)}</ul> : <ul><li>Marks on the right sides, framing as asked, no extra jewelry or logos.</li></ul>}
        {r.identity && <FaceMatch score={r.identity} />}
        {onMirror && <button className="st-btn sm secondary" style={{ marginTop: 8 }} onClick={onMirror} title={r.mirrorFix?.message}><FlipHorizontal2 size={13} />Mirror it (free)</button>}
      </div>
    </div>
  )
}

// Face-embedding similarity as a small meter: the tick is the threshold.
function FaceMatch({ score }: { score: NonNullable<QaReport['identity']> }) {
  const pct = (x: number) => `${Math.round(Math.min(1, Math.max(0, x)) * 100)}%`
  const ok = score.kind === 'identity' ? score.score >= score.threshold : score.score < score.threshold
  return (
    <div className="st-facematch" title={score.kind === 'identity' ? `Same person at ${score.threshold.toFixed(2)} or higher.` : `Must stay under ${score.threshold.toFixed(2)}.`}>
      <span>{score.kind === 'identity' ? `Face match vs ${score.against}` : `Similarity to ${score.against}`}</span>
      <span className="st-facematch-bar"><span className={ok ? 'ok' : 'bad'} style={{ width: pct(score.score) }} /><i style={{ left: pct(score.threshold) }} /></span>
      <b className={ok ? 'ok' : 'bad'}>{score.score.toFixed(2)}</b>
    </div>
  )
}

function usePanZoom(view: View, setView: (v: View) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = (e.clientX - rect.left) / rect.width - 0.5
      const py = (e.clientY - rect.top) / rect.height - 0.5
      const s = Math.min(6, Math.max(1, view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      const k = s / view.s
      setView(s === 1 ? FIT : { s, x: px - (px - view.x) * k, y: py - (py - view.y) * k })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view, setView])
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current || !ref.current || view.s === 1) return
      const rect = ref.current.getBoundingClientRect()
      setView({ ...view, x: drag.current.vx + (e.clientX - drag.current.x) / rect.width, y: drag.current.vy + (e.clientY - drag.current.y) / rect.height })
    },
    onPointerUp: () => { drag.current = null },
    onDoubleClick: (e: React.MouseEvent) => {
      if (!ref.current) return
      if (view.s > 1) { setView(FIT); return }
      const rect = ref.current.getBoundingClientRect()
      setView(zoomTo((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, 2.5))
    },
  }
  return { ref, handlers }
}

const transform = (v: View) => ({ transform: `translate(${v.x * 100}%, ${v.y * 100}%) scale(${v.s})`, transformOrigin: '50% 50%', transition: 'transform 0.18s ease-out' })

function ZoomPane({ assetId, tag, view, setView, className = '' }: { assetId: string | null | undefined; tag: string; view: View; setView: (v: View) => void; className?: string }) {
  const { ref, handlers } = usePanZoom(view, setView)
  return (
    <div ref={ref} className={`st-pane ${className}`} {...handlers}>
      <span className="st-badge plain st-pane-tag" style={{ background: 'rgba(0,0,0,0.55)', color: '#f6f2ec' }}>{tag}</span>
      {assetId && <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', ...transform(view) }}><img src={assetUrl(assetId)} alt={tag} draggable={false} /></div>}
    </div>
  )
}

function SliderPane({ under, over, split, setSplit, view, setView }: { under: string | null | undefined; over: string | null | undefined; split: number; setSplit: (n: number) => void; view: View; setView: (v: View) => void }) {
  const { ref, handlers } = usePanZoom(view, setView)
  const layer = useMemo(() => ({ position: 'absolute' as const, inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }), [])
  return (
    <div ref={ref} className="st-pane" {...handlers}>
      <span className="st-badge plain st-pane-tag" style={{ background: 'rgba(0,0,0,0.55)', color: '#f6f2ec' }}>REF-00 left · Candidate right</span>
      {under && <div style={{ ...layer, ...transform(view) }}><img src={assetUrl(under)} alt="Candidate" draggable={false} /></div>}
      {over && <div style={{ ...layer, clipPath: `inset(0 ${100 - split}% 0 0)` }}><div style={{ ...layer, ...transform(view) }}><img src={assetUrl(over)} alt="REF-00" draggable={false} /></div></div>}
      <div className="st-split-handle" style={{ left: `${split}%` }} />
      <input type="range" min={0} max={100} value={split} onChange={e => setSplit(Number(e.target.value))} aria-label="Compare slider" style={{ position: 'absolute', bottom: 14, left: '10%', width: '80%', zIndex: 4 }} onPointerDown={e => e.stopPropagation()} />
    </div>
  )
}
