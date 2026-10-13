import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Loader2, ShieldAlert, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Img, errorMessage, useToast } from '../../ui'
import type { CharacterView, SceneFields, SceneStill, SceneView, ScenesData } from '../../types'
import { StillDrawer, STILL_STATUS, OP_LABEL } from './StillDrawer'

// One scene: the owner's words, the planned fields (all editable, saved as
// you type), the refs it will attach, and the stills it made.

const FIELD_LABEL: Record<string, string> = {
  momentType: 'Moment type', moment: 'The moment', setting: 'Setting', location: 'Place', outfit: 'Outfit', footwear: 'Footwear',
  jewelry: 'Extra jewelry', makeup: 'Makeup', hair: 'Hair', pose: 'Pose and gaze', view: 'Angle', expression: 'Expression',
  camera: 'Camera', foreground: 'Foreground', framing: 'Framing', light: 'Light', destination: 'Where it goes', title: 'Title',
  height: 'Camera height', brands: 'Brands and logos', refs: 'Sheet refs',
}

const ROLE: Record<string, string> = { face: 'Face', angle: 'Closest angle', body: 'Body', expression: 'Expression' }

export function SceneEditor({ v, data, scene, onBack }: { v: CharacterView; data: ScenesData; scene: SceneView; onBack: () => void }) {
  const toast = useToast()
  const refresh = useRefresh()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Partial<SceneFields>>(scene.fields)
  const [title, setTitle] = useState(scene.title)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [open, setOpen] = useState<string | null>(null)
  const dirty = useRef<Partial<SceneFields>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // New fields from the planner (or another tab) replace untouched ones.
  const serverKey = JSON.stringify(scene.fields)
  useEffect(() => {
    setDraft(d => ({ ...scene.fields, ...Object.fromEntries(Object.entries(d).filter(([k]) => k in dirty.current)) }))
  }, [serverKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!title) setTitle(scene.title) }, [scene.title]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function saveTitle() {
    if (title === scene.title) return
    try { await api.updateScene(scene.id, { title }); refresh(v.id) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  async function archive() {
    try { await api.archiveScene(scene.id); refresh(v.id); onBack(); toast({ tone: '', text: 'Scene archived. Its stills are kept.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  const planned = Object.keys(scene.fields).length > 2
  const missing = scene.missing.map(m => FIELD_LABEL[m] ?? m)
  const still = scene.candidates.find(c => c.id === open) ?? null

  return (
    <div className="st-col" style={{ gap: 22 }}>
      <div className="st-row" style={{ gap: 10 }}>
        <button className="st-btn ghost sm" onClick={async () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; await flush() } onBack() }}><ArrowLeft size={14} />Scenes</button>
        <span className="st-spacer" />
        <SaveState state={saving} />
        <button className="st-btn ghost sm" onClick={archive} title="Archive this scene (its stills are kept)"><Trash2 size={14} />Archive</button>
      </div>

      <input className="st-input st-scene-title" value={title} placeholder="Name this scene" maxLength={80} onChange={e => setTitle(e.target.value)} onBlur={saveTitle} aria-label="Scene name" />

      <section className="st-card">
        <div className="st-card-head"><Wand2 size={16} /><div className="grow"><div className="st-h3">Your words</div><div className="st-hint">Claude plans every detail from this, following {v.data.name}'s rules. Change anything after.</div></div></div>
        <div className="st-card-body st-col" style={{ gap: 12 }}>
          <p className="st-cardtext" style={{ margin: 0 }}>{scene.brief || <span className="st-muted">No description. Fill in the details below yourself.</span>}</p>
          {scene.brief && (
            <PriceButton action={{ type: 'scene_plan', characterId: v.id, sceneId: scene.id }} label={planned ? 'Plan it again' : 'Plan the details'} variant={planned ? 'secondary' : 'primary'} />
          )}
        </div>
      </section>

      <SceneForm data={data} draft={draft} set={set} missing={scene.missing} v={v} />

      <GenerateCard v={v} data={data} scene={scene} missing={missing} saving={saving === 'saving' || Object.keys(dirty.current).length > 0} setRefs={refs => set('refs', refs)} />

      <section>
        <div className="st-section-head"><div className="st-h2">Stills</div><span className="st-muted">{scene.candidates.filter(c => c.assetId).length}</span></div>
        {scene.busy && (
          <div className="st-card pad st-row" style={{ gap: 14, marginBottom: 14 }}>
            <Loader2 className="st-spin" size={18} />
            <div className="grow"><div className="st-h3">Working on this scene</div><div className="st-hint">Rendering, then automatic QA: face match, marks, logos, jewelry and skin texture. Failed QA waits with its fix.</div></div>
          </div>
        )}
        {scene.candidates.length === 0 && !scene.busy && <span className="st-hint">No stills yet. Generate to see them here.</span>}
        <div className="st-grid scenes">
          {scene.candidates.filter(c => c.assetId || c.status === 'failed').map(c => <StillTile key={c.id} c={c} aspect={scene.aspect} onOpen={() => setOpen(c.id)} />)}
        </div>
      </section>

      <StillDrawer v={v} data={data} scene={scene} still={still} onClose={() => setOpen(null)} onOpen={setOpen} />
    </div>
  )
}

function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'saving') return <span className="st-hint"><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> Saving</span>
  if (state === 'saved') return <span className="st-hint"><Check size={12} style={{ verticalAlign: -2 }} /> Saved</span>
  return null
}

function StillTile({ c, aspect, onOpen }: { c: SceneStill; aspect: string; onOpen: () => void }) {
  const s = STILL_STATUS[c.status] ?? { label: c.status, tone: '' }
  return (
    <button className="st-tile st-scene-tile" onClick={onOpen}>
      <Img assetId={c.assetId} width={420} style={{ aspectRatio: aspect.replace(':', ' / ') }} />
      <span className={`st-badge ${s.tone}`}>{s.label}</span>
      <div className="st-row" style={{ gap: 6, padding: '0 4px 2px' }}>
        <span className="st-tile-label">{OP_LABEL[c.op]}</span>
        <span className="st-spacer" />
        {c.qaVerdict && c.status !== 'qa_pending' && <span className={`st-badge plain ${c.qaVerdict === 'post' ? 'ok' : c.qaVerdict === 'regenerate' ? 'bad' : 'warn'}`}>{c.qaVerdict === 'post' ? 'QA ok' : c.qaVerdict === 'edit' ? 'Fixable' : c.qaVerdict === 'regenerate' ? 'Redo' : 'Look'}</span>}
      </div>
    </button>
  )
}

// ── The fields ────────────────────────────────────────────────────────

function SceneForm({ v, data, draft, set, missing }: { v: CharacterView; data: ScenesData; draft: Partial<SceneFields>; set: <K extends keyof SceneFields>(k: K, value: SceneFields[K]) => void; missing: string[] }) {
  const o = data.options
  const need = (k: keyof SceneFields) => missing.includes(k)
  const text = (k: keyof SceneFields, opts: { rows?: number; placeholder?: string; hint?: string } = {}) => (
    <label className="st-field">
      <span className="st-label">{FIELD_LABEL[k]}{need(k) && <span className="st-need"> needed</span>}</span>
      {opts.rows ? (
        <textarea className="st-textarea" rows={opts.rows} style={{ minHeight: 0 }} value={(draft[k] as string) ?? ''} placeholder={opts.placeholder} onChange={e => set(k, e.target.value as never)} />
      ) : (
        <input className="st-input" value={(draft[k] as string) ?? ''} placeholder={opts.placeholder} onChange={e => set(k, e.target.value as never)} />
      )}
      {opts.hint && <span className="st-hint">{opts.hint}</span>}
    </label>
  )
  const chips = (k: keyof SceneFields, list: Array<{ id: string; label: string; hint?: string }>) => (
    <div className="st-field">
      <span className="st-label">{FIELD_LABEL[k]}{need(k) && <span className="st-need"> needed</span>}</span>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {list.map(x => <button key={x.id} type="button" title={x.hint} className={`st-chip ${draft[k] === x.id ? 'on' : ''}`} onClick={() => set(k, x.id as never)}>{draft[k] === x.id && <Check size={12} />}{x.label}</button>)}
      </div>
    </div>
  )
  const select = (k: keyof SceneFields, list: Array<{ id: string; label: string }>) => (
    <label className="st-field">
      <span className="st-label">{FIELD_LABEL[k]}{need(k) && <span className="st-need"> needed</span>}</span>
      <select className="st-select" value={(draft[k] as string) ?? ''} onChange={e => set(k, e.target.value as never)}>
        <option value="" disabled>Choose</option>
        {list.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </label>
  )
  const hairIdeas = ((v.data.style as { hair_options?: string[] }).hair_options ?? []).slice(0, 5)
  const cuff = data.options.signatureJewelry
  return (
    <div className="st-col" style={{ gap: 16 }}>
      <section className="st-card">
        <div className="st-card-head"><div className="grow"><div className="st-h3">The moment</div></div></div>
        <div className="st-card-body st-form">
          <div className="wide">{text('moment', { rows: 2, placeholder: `${v.data.name} picks out peaches at a market stall, laughing at something the vendor said` })}</div>
          <div className="wide">{text('setting', { rows: 2, placeholder: 'Where, with a few real details and people around' })}</div>
          {text('location', { placeholder: 'Farmers market', hint: 'A short name for the combo log.' })}
          {select('momentType', o.moments)}
        </div>
      </section>

      <section className="st-card">
        <div className="st-card-head"><div className="grow"><div className="st-h3">What {v.data.pronouns.subj} wears</div><div className="st-hint">Anything goes, and every field is optional. Nothing from the sheet or the style notes is put in for you.</div></div></div>
        <div className="st-card-body st-form">
          <div className="wide">{text('outfit', { rows: 2, placeholder: 'A cream linen button-up with the sleeves rolled, light-wash straight jeans' })}</div>
          {text('footwear', { placeholder: 'White leather sandals, barefoot, or leave empty' })}
          <div className="st-field">
            {text('jewelry', { placeholder: 'A thin gold chain necklace, or leave empty' })}
            {cuff.length > 0 && <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="st-hint">Signature pieces (optional):</span>{cuff.map(c => <button key={c} type="button" className="st-chip" onClick={() => set('jewelry', [draft.jewelry, c].filter(Boolean).join(', '))}>{c}</button>)}</div>}
          </div>
          {chips('makeup', o.makeup)}
          <div className="st-field">
            {text('hair', { placeholder: 'Loose beachy waves with a deep side part' })}
            {hairIdeas.length > 0 && <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>{hairIdeas.map(h => <button key={h} type="button" className="st-chip" onClick={() => set('hair', h)}>{h}</button>)}</div>}
          </div>
        </div>
      </section>

      <section className="st-card">
        <div className="st-card-head"><div className="grow"><div className="st-h3">Camera</div><div className="st-hint">Starting points. Any angle, height, distance or shape works; the planner picks what fits the moment.</div></div></div>
        <div className="st-card-body st-form">
          {select('camera', o.cameras)}
          {select('light', o.lights)}
          <div className="wide">{chips('height', o.heights)}</div>
          {draft.camera === 'event_long_lens' && <div className="wide">{text('foreground', { placeholder: 'A door frame and the shoulder of someone at the next table', hint: 'Blurred things in front of the lens sell "across the room".' })}</div>}
          <div className="wide">{chips('framing', o.framings)}</div>
          {select('view', o.views)}
          {select('expression', o.expressions)}
          <div className="wide">{text('pose', { placeholder: 'Holding a peach, eyes on the vendor' })}</div>
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

function GenerateCard({ v, data, scene, missing, saving, setRefs }: { v: CharacterView; data: ScenesData; scene: SceneView; missing: string[]; saving: boolean; setRefs: (refs: string[]) => void }) {
  const o = data.options
  const usable = (m: (typeof o.stillModels)[number]) => !(o.mode === 'live' && m.path === 'account' && !o.accountConnected)
  const [models, setModels] = useState<string[]>(() => o.defaultModels.filter(r => usable(o.stillModels.find(m => m.ref === r)!)).slice(0, 1))
  const [variations, setVariations] = useState(2)
  const [anyway, setAnyway] = useState(false)
  const [choosing, setChoosing] = useState(false)
  useEffect(() => setAnyway(false), [scene.comboProblem])
  const chosen = useMemo(() => o.stillModels.filter(m => models.includes(m.ref)), [o.stillModels, models])
  function toggle(ref: string) {
    setModels(ms => (ms.includes(ref) ? ms.filter(x => x !== ref) : [...ms, ref].slice(-o.maxModels)))
  }
  const repeat = !!scene.comboProblem && !anyway
  const disabledReason = saving ? 'Saving your changes...'
    : missing.length ? `Fill in: ${missing.join(', ')}.`
    : repeat ? 'This repeats a recent combo. Change it, or press "Use anyway".'
    : !models.length ? 'Pick a model.' : undefined
  const trained = chosen.find(m => m.trained)
  const picked = scene.refs.map(r => r.refId)
  function toggleRef(id: string) {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id].slice(0, o.maxRefs)
    if (next.length) setRefs(next)
  }
  return (
    <section className="st-card st-generate">
      <div className="st-card-head"><Sparkles size={16} /><div className="grow"><div className="st-h3">Generate</div><div className="st-hint">{o.autoQa ? 'Every still is checked automatically before it reaches you; the price includes the checks. QA only ever advises.' : 'Automatic QA is off in Rules; check each still yourself.'}</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        {scene.comboProblem && (
          <Callout tone="warn" icon={<ShieldAlert size={16} />}>
            {scene.comboProblem}
            <div className="st-row" style={{ gap: 8, marginTop: 8 }}>
              {anyway ? <span className="st-hint">Using it anyway for this run.</span> : <button className="st-btn sm secondary" onClick={() => setAnyway(true)}>Use anyway</button>}
            </div>
          </Callout>
        )}
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
        <div className="st-field">
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
        <PriceButton
          size="big"
          label={chosen.length > 1 ? `Generate ${variations * chosen.length} stills` : `Generate ${variations} still${variations > 1 ? 's' : ''}`}
          disabledReason={disabledReason}
          action={disabledReason ? null : { type: 'scene', characterId: v.id, sceneId: scene.id, models, variations, withQa: o.autoQa, ...(anyway ? { allowRepeat: true } : {}) }}
        />
        {scene.combo && <span className="st-hint">Logged on your first pick as: {[scene.combo.moment, scene.combo.camera, scene.combo.light, scene.combo.location].filter(Boolean).join(' / ')}</span>}
      </div>
    </section>
  )
}
