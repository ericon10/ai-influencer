import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Info, Loader2, PenLine, Sparkles, Wand2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useCharacters, useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Field, Img, Modal, SectionProgress, errorMessage, scrollToField, useToast, type TodoItem } from '../../ui'
import type { CharacterView, SceneFields, SceneStill, SceneView, ScenesData } from '../../types'
import { StillDrawer, STILL_STATUS, OP_LABEL, claudeChecked } from './StillDrawer'
import { PromptBox } from './PromptBox'

// The stills of a post (UX-PLAN.md, the Stills step): its scene's details
// (planned by Claude or filled in, all optional, saved as you type), the
// models and the prompt, Write and generate, and the stills it made, each
// with the post's next step ("Use this still", or add it to a slideshow).

const FIELD_LABEL: Record<string, string> = {
  momentType: 'Moment type', moment: 'The moment', setting: 'Setting', location: 'Place', outfit: 'Outfit', footwear: 'Footwear',
  jewelry: 'Extra jewelry', makeup: 'Makeup', hair: 'Hair', pose: 'Pose and gaze', view: 'Angle', expression: 'Expression',
  camera: 'Camera', foreground: 'Foreground', framing: 'Framing', light: 'Light', destination: 'Where it goes', title: 'Title',
  height: 'Camera height', brands: 'Brands and logos', refs: 'Sheet refs',
}

const ROLE: Record<string, string> = { face: 'Face', angle: 'Closest angle', body: 'Body', expression: 'Expression' }

// Only the moment itself is required (owner, 2026-10-13: keep required fields
// to the minimum). Moment type, camera and light start pre-filled, and the
// owner's own words (the post's idea) count as the moment until one is
// planned or written. A preset that no longer exists is flagged too, so it
// can be picked again.
const REQUIRED = new Set<keyof SceneFields>(['moment'])
const SECTIONS: Record<'moment' | 'wear' | 'camera', Array<keyof SceneFields>> = {
  moment: ['moment', 'setting', 'location', 'momentType'],
  wear: ['outfit', 'footwear', 'jewelry', 'makeup', 'hair'],
  camera: ['camera', 'light', 'height', 'foreground', 'framing', 'view', 'expression', 'pose', 'destination'],
}

function sceneChecks(data: ScenesData, draft: Partial<SceneFields>, missing: string[]) {
  const o = data.options
  const presets: Partial<Record<keyof SceneFields, Array<{ id: string }>>> = {
    momentType: o.moments, camera: o.cameras, light: o.lights, height: o.heights, framing: o.framings, view: o.views,
    expression: o.expressions, makeup: o.makeup, destination: o.destinations,
  }
  const required = (k: keyof SceneFields) => REQUIRED.has(k) || missing.includes(k)
  const done = (k: keyof SceneFields) => {
    const list = presets[k]
    if (list) return list.some(x => x.id === draft[k])
    return String(draft[k] ?? '').trim().length >= (k === 'moment' ? 3 : 1)
  }
  const progress = (keys: Array<keyof SceneFields>) => {
    const req = keys.filter(required)
    return { total: req.length, done: req.filter(done).length }
  }
  const left = (Object.keys(FIELD_LABEL) as Array<keyof SceneFields>).filter(k => required(k) && !done(k))
  return { required, done, progress, left }
}

export function SceneStills({ v, data, scene, action, picked = [], onStarted }: {
  v: CharacterView; data: ScenesData; scene: SceneView
  // Called when a run starts (the post moves to this step).
  onStarted?: () => void
  // The post's next step for a still, on its tile and in its drawer.
  action?: (c: SceneStill) => ReactNode
  // Stills the post already uses (marked on their tiles).
  picked?: string[]
}) {
  const toast = useToast()
  const refresh = useRefresh()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Partial<SceneFields>>(scene.fields)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [open, setOpen] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [details, setDetails] = useState(false)
  const dirty = useRef<Partial<SceneFields>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // New fields from the planner (or another tab) replace untouched ones.
  const serverKey = JSON.stringify(scene.fields)
  useEffect(() => {
    setDraft(d => ({ ...scene.fields, ...Object.fromEntries(Object.entries(d).filter(([k]) => k in dirty.current)) }))
  }, [serverKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    const patch = dirty.current
    if (!Object.keys(patch).length) return
    dirty.current = {}
    setSaving('saving')
    try {
      await api.updateScene(scene.id, { fields: patch })
      setSaving('saved')
      refresh(v.id)
      qc.invalidateQueries({ queryKey: ['estimate'] })
    } catch (e) {
      dirty.current = { ...patch, ...dirty.current }
      setSaving('idle')
      toast({ tone: 'bad', text: errorMessage(e) })
    }
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush() } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof SceneFields>(key: K, value: SceneFields[K]) {
    setDraft(d => ({ ...d, [key]: value }))
    dirty.current = { ...dirty.current, [key]: value }
    setSaving('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void flush() }, 600)
  }

  const checks = sceneChecks(data, draft, scene.missing)
  const todo: TodoItem[] = checks.left.map(k => ({ label: FIELD_LABEL[k] ?? k, target: `scene-${k}`, onGo: () => { setDetails(true); window.setTimeout(() => scrollToField(`scene-${k}`), 120) } }))
  const still = scene.candidates.find(c => c.id === open && c.media !== 'video') ?? null
  const tiles = scene.candidates.filter(c => c.media !== 'video' && (c.assetId || c.status === 'failed'))
  const summary = [data.options.moments.find(m => m.id === draft.momentType)?.label, data.options.cameras.find(m => m.id === draft.camera)?.label, data.options.lights.find(m => m.id === draft.light)?.label, draft.outfit].filter(Boolean).join(' · ')

  return (
    <div className="st-col" style={{ gap: 18 }}>
      <section className="st-card">
        <div className="st-card-head">
          <Wand2 size={16} />
          <div className="grow"><div className="st-h3">Details <span className="st-muted" style={{ fontWeight: 400 }}>(optional)</span></div><div className="st-hint">{scene.planned ? summary || 'Planned.' : `Outfit, place, camera and light. Claude can plan them from your idea, following ${v.data.name}'s rules, or leave them to the prompt writer.`}</div></div>
          <SaveState state={saving} />
          <button className="st-btn sm ghost" onClick={() => setDetails(d => !d)} aria-expanded={details}>{details ? 'Hide' : 'Show'} the details</button>
        </div>
        <div className="st-card-body st-col" style={{ gap: 12 }}>
          <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {scene.brief && <PriceButton action={{ type: 'scene_plan', characterId: v.id, sceneId: scene.id }} label={scene.planned ? 'Plan it again' : 'Plan the details'} variant="secondary" size="sm" onStarted={() => setDetails(true)} />}
            <button className="st-btn sm ghost" onClick={async () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; await flush() } setCopying(true) }} title="Copy this scene to other characters"><Copy size={14} />Use for other characters</button>
          </div>
          {details && <SceneForm data={data} draft={draft} set={set} checks={checks} v={v} />}
        </div>
      </section>

      <GenerateCard v={v} data={data} scene={scene} todo={todo} saving={saving === 'saving' || Object.keys(dirty.current).length > 0} setRefs={refs => set('refs', refs)} onStarted={onStarted} />

      <section>
        <div className="st-section-head"><div className="st-h2">Stills</div><span className="st-muted">{tiles.filter(c => c.assetId).length}</span></div>
        {scene.busy && (
          <div className="st-card pad st-row" style={{ gap: 14, marginBottom: 14 }}>
            <Loader2 className="st-spin" size={18} />
            <div className="grow"><div className="st-h3">Working on these stills</div><div className="st-hint">Writing the prompt or rendering, then the free checks: face match against REF-00 and skin texture. Look each still over yourself; Check this asks Claude.</div></div>
          </div>
        )}
        {tiles.length === 0 && !scene.busy && <span className="st-hint">No stills yet. Generate to see them here.</span>}
        <div className="st-grid scenes">
          {tiles.map(c => <StillTile key={c.id} c={c} aspect={scene.aspect} onOpen={() => setOpen(c.id)} action={action} picked={picked.indexOf(c.id)} />)}
        </div>
      </section>

      <StillDrawer v={v} data={data} scene={scene} still={still} onClose={() => setOpen(null)} onOpen={setOpen} action={action} />
      <CopyScene v={v} scene={scene} open={copying} onClose={() => setCopying(false)} />
    </div>
  )
}

// Reuse this scene for other characters: their own sheet refs and signature
// pieces apply, and each copy is a free draft until it is generated.
function CopyScene({ v, scene, open, onClose }: { v: CharacterView; scene: SceneView; open: boolean; onClose: () => void }) {
  const chars = useCharacters()
  const toast = useToast()
  const nav = useNavigate()
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Array<{ characterId: string; sceneId: string; name: string }>>([])
  useEffect(() => { if (open) { setPicked([]); setDone([]) } }, [open])
  const others = (chars.data?.characters ?? []).filter(c => c.id !== v.id)
  async function copy() {
    setBusy(true)
    try { setDone((await api.copyScene(scene.id, picked)).copies) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  // Each copy opens as a new video post of that character, at its stills.
  async function openCopy(d: { characterId: string; sceneId: string }) {
    try {
      const { id } = await api.createContent({ kind: 'meme', characterId: d.characterId, sceneId: d.sceneId, idea: scene.brief, step: 'stills' })
      onClose()
      nav(`/studio/posts/${id}`)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        <div><div className="st-kicker">Use for other characters</div><div className="st-h2">{scene.title || 'This scene'}</div><p className="st-sub" style={{ margin: '6px 0 0' }}>The words and choices carry over with the name swapped. Each character uses their own sheet and signature pieces. Free; nothing runs until you generate.</p></div>
        {done.length ? (
          <div className="st-col" style={{ gap: 8 }}>
            {done.map(d => (
              <div key={d.sceneId} className="st-row" style={{ gap: 8 }}><Check size={14} style={{ color: 'var(--st-ok)' }} /><span className="grow">Copied to {d.name}</span><button className="st-btn sm" onClick={() => void openCopy(d)}>Open as a post</button></div>
            ))}
            <div className="st-row"><span className="st-spacer" /><button className="st-btn primary" onClick={onClose}>Done</button></div>
          </div>
        ) : others.length === 0 ? (
          <p className="st-hint" style={{ margin: 0 }}>No other characters yet. Create or import one, then come back.</p>
        ) : (
          <>
            <Field id="copy-characters" label="Characters" required done={picked.length > 0} group>
              <div className="st-col" style={{ gap: 6 }}>
                {others.map(c => (
                  <label key={c.id} className="st-row" style={{ gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked.includes(c.id)} onChange={e => setPicked(p => (e.target.checked ? [...p, c.id] : p.filter(x => x !== c.id)))} />
                    <span>{c.name}</span>
                    {c.progress.approved === 0 && <span className="st-hint">no sheet yet; the copy waits until REF-00 is approved</span>}
                  </label>
                ))}
              </div>
            </Field>
            <div className="st-row"><span className="st-spacer" /><button className="st-btn ghost" onClick={onClose}>Cancel</button><button className="st-btn primary" disabled={!picked.length || busy} onClick={copy}>{busy ? <Loader2 size={15} className="st-spin" /> : <Copy size={15} />}{picked.length > 1 ? `Copy to ${picked.length} characters` : 'Copy'}</button></div>
          </>
        )}
      </div>
    </Modal>
  )
}

function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'saving') return <span className="st-hint"><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> Saving</span>
  if (state === 'saved') return <span className="st-hint"><Check size={12} style={{ verticalAlign: -2 }} /> Saved</span>
  return null
}

function StillTile({ c, aspect, onOpen, action, picked }: { c: SceneStill; aspect: string; onOpen: () => void; action?: (c: SceneStill) => ReactNode; picked: number }) {
  const s = STILL_STATUS[c.status] ?? { label: c.status, tone: '' }
  const usable = !!c.assetId && !['failed', 'qa_pending', 'qa_failed', 'rejected'].includes(c.status)
  return (
    <div className={`st-tile st-scene-tile ${picked >= 0 ? 'picked' : ''}`}>
      <button type="button" className="st-tile-open" onClick={onOpen} aria-label={`Open ${OP_LABEL[c.op]}`}>
        <Img assetId={c.assetId} width={420} style={{ aspectRatio: aspect.replace(':', ' / ') }} />
        <span className={`st-badge ${s.tone}`}>{picked >= 0 ? `Used${picked > 0 ? ` ${picked + 1}` : ''}` : s.label}</span>
      </button>
      <div className="st-row" style={{ gap: 6, padding: '0 4px 2px' }}>
        <span className="st-tile-label">{OP_LABEL[c.op]}</span>
        <span className="st-spacer" />
        {c.qaVerdict && c.status !== 'qa_pending' && <span className={`st-badge plain ${c.qaVerdict === 'post' ? 'ok' : c.qaVerdict === 'regenerate' ? 'bad' : 'warn'}`}>{c.qaVerdict === 'post' ? (claudeChecked(c.qaReport) ? 'QA ok' : 'Free checks ok') : c.qaVerdict === 'edit' ? 'Fixable' : c.qaVerdict === 'regenerate' ? 'Redo' : 'Look'}</span>}
      </div>
      {c.status === 'failed' && c.rejectNote && <span className="st-hint" style={{ padding: '0 4px' }}>{c.rejectNote}</span>}
      {action && usable && <div className="st-tile-action">{action(c)}</div>}
    </div>
  )
}

// ── The fields ────────────────────────────────────────────────────────

function SceneForm({ v, data, draft, set, checks }: { v: CharacterView; data: ScenesData; draft: Partial<SceneFields>; set: <K extends keyof SceneFields>(k: K, value: SceneFields[K]) => void; checks: ReturnType<typeof sceneChecks> }) {
  const o = data.options
  const field = (k: keyof SceneFields) => ({ id: `scene-${k}`, label: FIELD_LABEL[k], required: checks.required(k), done: checks.done(k) })
  const text = (k: keyof SceneFields, opts: { rows?: number; placeholder?: string; hint?: string } = {}) => (
    <Field {...field(k)} hint={opts.hint}>
      {opts.rows ? (
        <textarea className="st-textarea" rows={opts.rows} style={{ minHeight: 0 }} value={(draft[k] as string) ?? ''} placeholder={opts.placeholder} onChange={e => set(k, e.target.value as never)} />
      ) : (
        <input className="st-input" value={(draft[k] as string) ?? ''} placeholder={opts.placeholder} onChange={e => set(k, e.target.value as never)} />
      )}
    </Field>
  )
  const chips = (k: keyof SceneFields, list: Array<{ id: string; label: string; hint?: string }>) => (
    <Field {...field(k)} group>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {list.map(x => <button key={x.id} type="button" title={x.hint} className={`st-chip ${draft[k] === x.id ? 'on' : ''}`} onClick={() => set(k, x.id as never)}>{draft[k] === x.id && <Check size={12} />}{x.label}</button>)}
      </div>
    </Field>
  )
  const select = (k: keyof SceneFields, list: Array<{ id: string; label: string }>) => (
    <Field {...field(k)}>
      <select className="st-select" value={(draft[k] as string) ?? ''} onChange={e => set(k, e.target.value as never)}>
        <option value="" disabled>Choose</option>
        {list.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </Field>
  )
  const head = (title: ReactNode, keys: Array<keyof SceneFields>, hint?: ReactNode) => {
    const p = checks.progress(keys)
    return <div className="st-card-head"><div className="grow"><div className="st-h3">{title}</div>{hint && <div className="st-hint">{hint}</div>}</div><SectionProgress done={p.done} total={p.total} /></div>
  }
  const hairIdeas = ((v.data.style as { hair_options?: string[] }).hair_options ?? []).slice(0, 5)
  const cuff = data.options.signatureJewelry
  return (
    <div className="st-col" style={{ gap: 16 }}>
      <section className="st-card">
        {head('The moment', SECTIONS.moment, 'Only the moment is required. Your own words count as the moment until you plan or write one.')}
        <div className="st-card-body st-form">
          <div className="wide">{text('moment', { rows: 2, placeholder: `e.g. ${v.data.name} picks out peaches at a market stall, laughing at something the vendor said` })}</div>
          <div className="wide">{text('setting', { rows: 2, placeholder: 'e.g. A busy farmers market, striped awnings, a few shoppers behind her' })}</div>
          {text('location', { placeholder: 'e.g. Farmers market', hint: 'A short name for the combo log.' })}
          {select('momentType', o.moments)}
        </div>
      </section>

      <section className="st-card">
        {head(`What ${v.data.pronouns.subj} wears`, SECTIONS.wear, 'Anything goes, and every field is optional. Nothing from the sheet or the style notes is put in for you.')}
        <div className="st-card-body st-form">
          <div className="wide">{text('outfit', { rows: 2, placeholder: 'e.g. A cream linen button-up with the sleeves rolled, light-wash straight jeans' })}</div>
          {text('footwear', { placeholder: 'e.g. White leather sandals, or barefoot' })}
          <div className="st-col" style={{ gap: 6 }}>
            {text('jewelry', { placeholder: 'e.g. A thin gold chain necklace' })}
            {cuff.length > 0 && <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="st-hint">Signature pieces (optional):</span>{cuff.map(c => <button key={c} type="button" className="st-chip" onClick={() => set('jewelry', [draft.jewelry, c].filter(Boolean).join(', '))}>{c}</button>)}</div>}
          </div>
          {chips('makeup', o.makeup)}
          <div className="st-col" style={{ gap: 6 }}>
            {text('hair', { placeholder: 'e.g. Loose beachy waves with a deep side part' })}
            {hairIdeas.length > 0 && <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>{hairIdeas.map(h => <button key={h} type="button" className="st-chip" onClick={() => set('hair', h)}>{h}</button>)}</div>}
          </div>
        </div>
      </section>

      <section className="st-card">
        {head('Camera', SECTIONS.camera, 'Starting points. Any angle, height, distance or shape works; the planner picks what fits the moment.')}
        <div className="st-card-body st-form">
          {select('camera', o.cameras)}
          {select('light', o.lights)}
          <div className="wide">{chips('height', o.heights)}</div>
          {draft.camera === 'event_long_lens' && <div className="wide">{text('foreground', { placeholder: 'e.g. A door frame and the shoulder of someone at the next table', hint: 'Blurred things in front of the lens sell "across the room".' })}</div>}
          <div className="wide">{chips('framing', o.framings)}</div>
          {select('view', o.views)}
          {select('expression', o.expressions)}
          <div className="wide">{text('pose', { placeholder: 'e.g. Holding a peach, eyes on the vendor' })}</div>
          <div className="wide">{chips('destination', o.destinations.map(d => ({ ...d, label: `${d.label} · ${d.aspect}` })))}</div>
        </div>
      </section>

      <section className="st-card">
        <div className="st-card-body">
          <label className="st-row" style={{ gap: 12, cursor: 'pointer', alignItems: 'flex-start' }}>
            <button type="button" role="switch" aria-checked={!!draft.brands} className={`st-switch ${draft.brands ? 'on' : ''}`} onClick={() => set('brands', !draft.brands)}><span /></button>
            <span className="st-col" style={{ gap: 2 }}>
              <b>Brands and logos</b>
              <span className="st-hint">{draft.brands ? 'On for this scene: real brands, logos and product names are welcome, and QA does not point them out.' : 'Off: clothes and props stay plain and unbranded. Turn on for brand deals and products.'}</span>
            </span>
          </label>
        </div>
      </section>
    </div>
  )
}

// ── Generate ──────────────────────────────────────────────────────────

function GenerateCard({ v, data, scene, todo, saving, setRefs, onStarted }: { v: CharacterView; data: ScenesData; scene: SceneView; todo: TodoItem[]; saving: boolean; setRefs: (refs: string[]) => void; onStarted?: () => void }) {
  const o = data.options
  const usable = (m: (typeof o.stillModels)[number]) => !(o.mode === 'live' && m.path === 'account' && !o.accountConnected)
  const [models, setModels] = useState<string[]>(() => o.defaultModels.filter(r => usable(o.stillModels.find(m => m.ref === r)!)).slice(0, 1))
  const [variations, setVariations] = useState(2)
  const [choosing, setChoosing] = useState(false)
  const chosen = useMemo(() => o.stillModels.filter(m => models.includes(m.ref)), [o.stillModels, models])
  function toggle(ref: string) {
    setModels(ms => (ms.includes(ref) ? ms.filter(x => x !== ref) : [...ms, ref].slice(-o.maxModels)))
  }
  // The prompt writer (default on): the prompt box must hold a prompt,
  // written by Claude, typed, or the template's, before Generate runs.
  const pw = o.promptWriter
  const [promptDirty, setPromptDirty] = useState(false)
  // With nothing written yet, Generate writes the prompt first ("Write and
  // generate", one price); the box stays for typing or writing it first.
  const needsPrompt = pw.on && !(scene.prompts.still?.text ?? '').trim()
  const [showBox, setShowBox] = useState(false)
  const left: TodoItem[] = [
    ...todo,
    ...(!models.length ? [{ label: 'Pick a model', target: 'scene-models' }] : []),
  ]
  const count = chosen.length > 1 ? variations * chosen.length : variations
  const trained = chosen.find(m => m.trained)
  const picked = scene.refs.map(r => r.refId)
  function toggleRef(id: string) {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id].slice(0, o.maxRefs)
    if (next.length) setRefs(next)
  }
  return (
    <section className="st-card st-generate">
      <div className="st-card-head"><Sparkles size={16} /><div className="grow"><div className="st-h3">Generate</div><div className="st-hint">{o.autoQa ? 'Claude checks every still before it reaches you; the price includes the checks.' : 'You review each still. Free checks (face match, skin) run on every still; press Check this on a still when you want Claude to look.'}</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        {scene.comboProblem && <span className="st-hint"><Info size={12} style={{ verticalAlign: -2 }} /> Variety note: {scene.comboProblem.replace(/ A different moment or camera keeps the feed fresh, or use it anyway\.$/, '')}</span>}
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="st-label">Attaches</span>
          {scene.refs.map(r => (
            <div key={r.refId} className="st-refpick" title={`${r.refId}: ${ROLE[r.role]}`}>
              <Img assetId={r.assetId} width={120} />
              <span>{ROLE[r.role]}</span>
            </div>
          ))}
          <span className="st-hint">{picked.join(' + ')}{scene.refsChosen ? ', chosen by you' : ', chosen by angle'}</span>
          <button className="st-btn sm ghost" onClick={() => setChoosing(c => !c)}>{choosing ? 'Done' : 'Change'}</button>
          {scene.refsChosen && <button className="st-btn sm ghost" onClick={() => setRefs([])}>Pick by angle</button>}
        </div>
        {choosing && (
          <div className="st-col" style={{ gap: 8 }}>
            <span className="st-hint">Pick up to {o.maxRefs} sheet shots. The face shot keeps the face locked; the rest guide angle, body and expression.</span>
            <div className="st-refgrid">
              {data.sheetRefs.map(r => (
                <button key={r.refId} type="button" className={`st-refchoice ${picked.includes(r.refId) ? 'on' : ''}`} onClick={() => toggleRef(r.refId)} title={r.label}>
                  <Img assetId={r.assetId} width={160} />
                  <span>{r.refId}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="st-field" data-field="scene-models">
          <span className="st-label">Models <span className="st-muted">(pick up to {o.maxModels} to compare)</span></span>
          <div className="st-choices">
            {o.stillModels.map(m => {
              const ok = usable(m)
              const on = models.includes(m.ref)
              return (
                <button key={m.ref} type="button" className={`st-choice ${on ? 'on' : ''}`} disabled={!ok} onClick={() => toggle(m.ref)} title={m.note}>
                  <span className="st-row" style={{ gap: 8 }}><b>{m.label}</b><span className="st-spacer" />{on && <Check size={14} />}</span>
                  <span className="st-hint">{m.path === 'account' ? 'Your Higgsfield plan' : 'Higgsfield API'}{m.trained ? ' · saved character + drift lock' : m.refs > 0 ? ` · up to ${m.refs} refs` : ''}</span>
                  {!ok && <span className="st-hint" style={{ color: 'var(--st-warn)' }}>Connect your Higgsfield account in Settings</span>}
                </button>
              )
            })}
          </div>
          {trained && <span className="st-hint">{trained.label} uses {v.data.name}'s saved character: no attachments, then a face-only drift lock to REF-00 on every still.</span>}
        </div>
        <div className="st-row">
          <span className="st-label">Stills per model</span>
          <div className="st-stepnum"><button onClick={() => setVariations(n => Math.max(1, n - 1))} aria-label="Fewer">-</button><span>{variations}</span><button onClick={() => setVariations(n => Math.min(o.maxVariations, n + 1))} aria-label="More">+</button></div>
        </div>
        {pw.on && needsPrompt && !showBox ? (
          <button type="button" className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowBox(true)}><PenLine size={14} />See or type the prompt first</button>
        ) : pw.on ? (
          <PromptBox
            id="scene-prompt" characterId={v.id} sceneId={scene.id} target="still"
            written={scene.prompts.still} templateText={scene.templateText} words={pw.words.still} model={pw.model} realism={pw.realism}
            writeTodo={todo}
            writeAction={todo.length || saving ? null : { type: 'scene_prompt', characterId: v.id, sceneId: scene.id, target: 'still' }}
            addedNote="Added for each model when it runs: the reference line, the jewelry and mark sides, and the REALISM block (always)."
            changedNote={scene.prompts.still?.stale ? 'You changed the details after this was written. Rewrite to include them, or keep it as it is.' : null}
            onDirty={setPromptDirty}
          />
        ) : (
          <span className="st-hint"><Info size={12} style={{ verticalAlign: -2 }} /> The prompt writer is off, so the template builds the prompt (see Details). Switch it on in Settings, Claude models.</span>
        )}
        <PriceButton
          size="big"
          label={`${needsPrompt ? 'Write and generate' : 'Generate'} ${count} still${count > 1 ? 's' : ''}`}
          todo={left}
          waiting={saving || promptDirty ? 'Saving your changes...' : undefined}
          action={left.length || saving || promptDirty ? null : { type: 'scene', characterId: v.id, sceneId: scene.id, models, variations, withQa: o.autoQa, allowRepeat: true, ...(needsPrompt ? { write: true } : {}) }}
          onStarted={() => onStarted?.()}
        />
        {needsPrompt && <span className="st-hint">Claude writes the prompt from your idea and the details, then the stills run on it. One price for both; the prompt shows here after, editable for the next run.</span>}
        {scene.combo && <span className="st-hint">Logged on your first pick as: {[scene.combo.moment, scene.combo.camera, scene.combo.light, scene.combo.location].filter(Boolean).join(' / ')}</span>}
      </div>
    </section>
  )
}
