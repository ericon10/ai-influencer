import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Clapperboard, History, Loader2, Plus } from 'lucide-react'
import { api } from '../../api'
import { useRefresh, useScenes } from '../../hooks'
import { Field, Img, Todo, errorMessage, useToast } from '../../ui'
import { PriceButton } from '../../PriceButton'
import type { CharacterView, SceneView, ScenesData } from '../../types'
import { SceneEditor } from './SceneEditor'

// Stage 7: scenes. One moment at a time, in plain words: describe it, let
// Claude plan the details (or fill them in), see the price, generate. The
// character's rules (outfit, footwear, refs by angle, no logos, the combo
// log) are applied for you.
export function ScenesTab({ v, goSheet, openScene = null }: { v: CharacterView; goSheet: () => void; openScene?: string | null }) {
  const q = useScenes(v.id)
  const [open, setOpen] = useState<string | null>(openScene)
  const ready = !!v.sheet.shots[0]?.approved

  if (!ready) {
    return (
      <div className="st-empty">
        <h2 className="st-h1">The sheet comes <em>first</em></h2>
        <p className="st-sub" style={{ margin: 0 }}>Every scene attaches {v.data.name}'s sheet images, chosen by angle. Approve REF-00 to start.</p>
        <button className="st-btn primary" onClick={goSheet}>Go to the sheet<ArrowRight size={15} /></button>
      </div>
    )
  }
  if (q.isLoading || !q.data) return <div className="st-col" style={{ gap: 16 }}><div className="st-skel" style={{ height: 180, borderRadius: 26 }} /><div className="st-skel" style={{ height: 240, borderRadius: 26 }} /></div>
  const data = q.data
  const scene = open ? data.scenes.find(s => s.id === open) : undefined
  if (scene) return <SceneEditor v={v} data={data} scene={scene} onBack={() => setOpen(null)} />

  const sheetMissing = v.sheet.shots.filter(s => !s.approved).length
  return (
    <div className="st-col" style={{ gap: 26 }}>
      <NewScene v={v} onCreated={setOpen} />
      {sheetMissing > 0 && <span className="st-hint">{sheetMissing} sheet {sheetMissing === 1 ? 'shot is' : 'shots are'} not approved yet; scenes use the angles that are.</span>}
      {data.scenes.length > 0 && (
        <section>
          <div className="st-section-head"><div className="st-h2">Scenes</div><span className="st-muted">{data.scenes.length}</span></div>
          <div className="st-grid scenes">
            {data.scenes.map(s => <SceneCard key={s.id} s={s} data={data} onOpen={() => setOpen(s.id)} />)}
          </div>
        </section>
      )}
      <ComboLog data={data} />
    </div>
  )
}

function NewScene({ v, onCreated }: { v: CharacterView; onCreated: (id: string) => void }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [ideasJob, setIdeasJob] = useState<string | null>(null)
  // The rough idea the price is for, settled while typing.
  const [rough, setRough] = useState('')
  useEffect(() => { const t = setTimeout(() => setRough(brief.trim()), 500); return () => clearTimeout(t) }, [brief])
  const ideas = ((v.data.persona as { settings?: string[] }).settings ?? []).slice(0, 8)
  async function start() {
    if (!brief.trim() || busy) return
    setBusy(true)
    try {
      const { id } = await api.createScene(v.id, { brief: brief.trim() })
      refresh(v.id)
      setBrief('')
      onCreated(id)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <div className="st-scene-new">
      <div className="st-col" style={{ gap: 4 }}>
        <span className="st-kicker" style={{ margin: 0 }}><Clapperboard size={13} style={{ verticalAlign: -2 }} /> New scene</span>
        <div className="st-nextup-title">What is {v.data.name} doing?</div>
      </div>
      <Field id="new-scene-brief" label="In your own words" required done={!!brief.trim()}>
        <textarea
          className="st-textarea" rows={3} maxLength={2000} value={brief} onChange={e => setBrief(e.target.value)}
          placeholder={`e.g. ${v.data.name} picking out peaches at the farmers market, a friend snaps it on their phone`}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void start() }}
        />
      </Field>
      <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {rough.length >= 3
          ? <PriceButton action={{ type: 'scene_ideas', characterId: v.id, idea: rough }} label="Punch it up" variant="secondary" size="sm" onStarted={ids => setIdeasJob(ids[0] ?? null)} />
          : null}
        <span className="st-hint">{rough.length >= 3 ? 'Turns your rough idea into 3 specific moments to pick from. You can still edit the one you pick.' : 'Write a rough idea, then Punch it up turns it into 3 specific moments to pick from.'}</span>
      </div>
      {ideasJob && <IdeaOptions jobId={ideasJob} current={brief} onPick={text => setBrief(text)} onClose={() => setIdeasJob(null)} />}
      {ideas.length > 0 && (
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="st-hint">Ideas:</span>
          {ideas.map(i => <button key={i} className="st-chip" onClick={() => setBrief(b => (b.trim() ? `${b.trim()}, ${i}` : `${v.data.name} at ${i}`))}>{i}</button>)}
        </div>
      )}
      {!brief.trim() && <Todo items={[{ label: `What is ${v.data.name} doing?`, target: 'new-scene-brief' }]} />}
      <div className="st-row">
        <button className="st-btn primary" disabled={!brief.trim() || busy} onClick={start}>{busy ? <Loader2 size={16} className="st-spin" /> : <Plus size={16} />}Start this scene</button>
        <span className="st-hint">Free. Next you plan the details and see the price before anything runs.</span>
      </div>
    </div>
  )
}

interface Idea { moment: string; shooter: string; place: string; detail: string; other_person: string }
const DONE = ['completed', 'failed', 'canceled', 'needs_attention']
// No em-dashes in anything shown or saved (SPEC 5.7 rule 42).
const clean = (s: string) => s.replace(/\s*\u2014\s*/g, ', ').trim()

// The three options from "Punch it up". Picking one fills the box; it stays
// editable, and another option can still be picked.
function IdeaOptions({ jobId, current, onPick, onClose }: { jobId: string; current: string; onPick: (text: string) => void; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId),
    refetchInterval: query => (DONE.includes(query.state.data?.job.status ?? '') ? false : 1500),
  })
  const status = q.data?.job.status
  const options = ((q.data?.result as { options?: Idea[] } | null)?.options ?? []).slice(0, 3)
  if (!status || !DONE.includes(status)) {
    return <div className="st-row st-hint" style={{ gap: 8 }}><Loader2 size={14} className="st-spin" />Writing 3 specific moments...</div>
  }
  if (status !== 'completed' || !options.length) {
    return <div className="st-price-error" role="alert"><span className="msg">{q.data?.job.error?.message ?? 'No options came back.'} Press Punch it up to try again; a failed run is not charged.</span><button className="st-btn sm ghost" onClick={onClose}>Close</button></div>
  }
  return (
    <div className="st-col" style={{ gap: 8 }}>
      <div className="st-row"><span className="st-label">Pick one</span><span className="st-spacer" /><button className="st-btn sm ghost" onClick={onClose}>Hide</button></div>
      <div className="st-ideas">
        {options.map((o, i) => {
          const text = clean(o.moment)
          const on = current.trim() === text
          return (
            <button key={i} type="button" className={`st-choice ${on ? 'on' : ''}`} onClick={() => onPick(text)}>
              <span className="st-row" style={{ gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 1 }}>{text}</span>{on && <Check size={14} />}</span>
              <span className="st-hint">{[o.shooter, o.place, o.detail].map(clean).filter(Boolean).join(' · ')}</span>
              {o.other_person && <span className="st-hint">Also in it: {clean(o.other_person)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const STATUS: Record<SceneView['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '' },
  generating: { label: 'Generating', tone: 'accent live' },
  in_review: { label: 'Pick a still', tone: 'info' },
  approved: { label: 'Picked', tone: 'ok' },
}

function SceneCard({ s, data, onOpen }: { s: SceneView; data: ScenesData; onOpen: () => void }) {
  const best = s.candidates.find(c => c.status === 'approved') ?? s.candidates.find(c => c.status === 'in_review') ?? s.candidates.find(c => c.assetId && c.status !== 'failed')
  const label = (list: Array<{ id: string; label: string }>, id?: string) => list.find(x => x.id === id)?.label
  const status = STATUS[s.busy ? 'generating' : s.status] ?? STATUS.draft
  const picks = s.candidates.filter(c => c.status === 'approved').length
  const waiting = s.candidates.filter(c => c.status === 'in_review').length
  return (
    <button className="st-tile st-scene-tile" onClick={onOpen}>
      <Img assetId={best?.assetId} width={420} style={{ aspectRatio: s.aspect.replace(':', ' / ') }} />
      <span className={`st-badge ${status.tone}`}>{status.label}</span>
      <div className="st-col" style={{ gap: 3, padding: '2px 4px 4px' }}>
        <div className="st-tile-label">{s.title || s.brief.slice(0, 60) || 'Untitled scene'}</div>
        <div className="st-tile-id" style={{ fontFamily: 'inherit' }}>
          {[label(data.options.moments, s.fields.momentType), label(data.options.cameras, s.fields.camera)].filter(Boolean).join(' · ') || 'Not planned yet'}
        </div>
        {(picks > 0 || waiting > 0) && <div className="st-hint">{[picks ? `${picks} picked` : '', waiting ? `${waiting} to review` : ''].filter(Boolean).join(', ')}</div>}
      </div>
    </button>
  )
}

// SPEC 5.2 rule 21: the last entries, so the next scene picks something new.
function ComboLog({ data }: { data: ScenesData }) {
  if (!data.combos.length) return null
  return (
    <section className="st-card">
      <div className="st-card-head"><History size={16} /><div className="grow"><div className="st-h3">Combo log</div><div className="st-hint">The last {data.combos.length} picked scenes, as a history. Repeats are fine; every still comes out different.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 6 }}>
        {[...data.combos].reverse().map((c, i) => (
          <div key={i} className="st-combo"><span className="st-mono st-muted">{c.date}</span><b>{c.moment}</b><span>{c.camera}</span><span className="st-muted">{c.light}</span><span className="st-muted">{c.location}</span></div>
        ))}
      </div>
    </section>
  )
}
