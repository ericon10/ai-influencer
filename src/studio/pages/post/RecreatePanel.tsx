import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, CheckCircle2, Copy, Pause, Play, Plus, RotateCcw, Scissors, ShieldAlert, ShieldCheck, Sparkles, Users, X } from 'lucide-react'
import { api, ApiError, assetUrl } from '../../api'
import { uploadFiles } from '../../files'
import { keys, useClones, useCloneStills } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { FailureLine, RunStatus } from '../../runs'
import { failureLine, FRESH_MS } from '../../failures'
import { AsyncButton, Callout, Field, errorMessage, isFresh, useToast, type TodoItem } from '../../ui'
import type { CloneModel, CloneOptions, CloneResult, CloneSource, CloneStill, TakeGate } from '../../types'
import type { PostCtx } from './ctx'
import { HowTo } from '../../guide/Guide'
import { SentButton } from '../character/SentPanel'

// Recreate from a real clip (owner, 2026-10-14; UX-PLAN.md sections 15 and
// 16), in the Video step. Step 2: what to keep from the frame and the traits
// to drop (chips), the outfit, what happens in the clip. Step 3: four stills,
// each with its face match and likeness; "Fix this face" picks a still and
// runs the face pass in one click. Step 4: the gates (fixed): no video spend
// until a still matches REF-00 and does not look like the clip's person.
// Step 5: the motion model (Genjutsu, Wan 3.0, Wan 3.0 Prime, Kling 3.0
// Motion Control) with its price and billing path, grey with why when it
// cannot run; the last one used is pre-selected. Step 6: the take next to the
// clip, in sync, the face every half second, text found, cuts; "Use this
// take" opens the Text step.

const pct = (n: number | null) => (n == null ? '?' : n.toFixed(2))

export function RecreatePanel({ ctx, source, o, takes }: { ctx: PostCtx; source: CloneSource; o: CloneOptions | undefined; takes: { still: number; face: number } }) {
  const { item } = ctx
  const cid = item.characterId ?? ''
  const stills = useCloneStills(item.id)
  const list = (stills.data?.stills ?? []).filter(x => x.characterId === cid)
  const kept = source.stills?.[cid] ?? null
  const [model, setModel] = useState<string | null>(null)
  const motion = (o?.models ?? []).filter(m => m.mode === 'motion')
  const picked = motion.find(m => m.ref === (model ?? o?.defaults.motion)) ?? null
  const name = ctx.v?.data.name ?? 'your character'
  function pick(ref: string) {
    setModel(ref)
    api.setCloneModel(ref).catch(() => undefined)
  }
  const keptStill = list.find(x => x.id === kept) ?? null
  const ready = picked && !picked.problem
  const videoTodo: TodoItem[] = [
    ...(!keptStill ? [{ label: 'Make the stills and pick one', target: 'recreate-stills' }] : keptStill.gate.ok ? [] : [{ label: 'A still that passes the face checks', target: 'recreate-stills' }]),
    ...(!ready ? [{ label: picked?.problem ?? 'Pick a motion model', target: 'recreate-model' }] : []),
  ]
  return (
    <div className="st-col" style={{ gap: 18 }}>
      <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="grow"><CapLine ctx={ctx} source={source} /></div>
        <HowTo id="post-clone" label="How Recreate works" />
      </div>
      <GateCheckNotice />
      <Field id="recreate-keep" label="2. What to keep, what to drop" group hint="Read from the frame; every chip is yours to change.">
        <StepTwo ctx={ctx} source={source} />
      </Field>
      <Field id="recreate-stills" label={`3. ${takes.still} stills of ${name} and the face pass`} group done={!!keptStill?.gate.ok} hint="Pick the stills model: Nano Banana 2.1 on your plan or GPT Image 2.5 on the API, with the same prompts, face pass and gates. One price for the stills and the face pass on the best one (switch it off to skip; it is also skipped, and not charged, when the best still already beats the clip's person by 0.30 or more). The face pass edits the still: outside the face it must still match it, or it is marked not usable. Each shows its face match to REF-00, its likeness to the person in the clip, and the margin between them. Fix this face redoes only the face on any other still.">
        <StillsStep ctx={ctx} list={list} kept={kept} takes={takes} picked={picked} opts={o} />
      </Field>
      <Field id="recreate-model" label="5. The motion model" group hint={`The still as the image, the cleaned clip as the motion, 720p, 9:16, audio off. Price for this ${source.durationSec ?? ''} s clip; your last pick is selected.`}>
        <MotionPicker models={motion} picked={picked?.ref ?? null} onPick={pick} loading={!o} />
      </Field>
      <div className="st-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <PriceButton
          label="Make the video"
          todo={videoTodo}
          action={keptStill && picked ? { type: 'clone', contentId: item.id, characterIds: [cid], mode: 'motion', model: picked.ref, looks: {}, keepSound: false, stills: { [cid]: keptStill.id } } : null}
          watch={j => j.purpose.startsWith(`clone:${item.id}:`)}
        />
        {keptStill && <span className="st-hint">From the picked still{keptStill.pass === 'face' ? ' (face pass)' : ''}.</span>}
      </div>
      <Takes ctx={ctx} />
    </div>
  )
}

// The post's credit cap (the Recreate link's cap), with what is used.
function CapLine({ ctx, source }: { ctx: PostCtx; source: CloneSource }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(String(source.capCredits ?? ''))
  const cap = source.capCredits ?? null
  const spent = source.spentCredits ?? 0
  async function save(next: number | null) {
    try { await api.setCloneChoices(ctx.item.id, { capCredits: next }); await qc.invalidateQueries({ queryKey: keys.content }); qc.invalidateQueries({ queryKey: ['estimate'] }); setEdit(false) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  if (!cap && !edit) return <div className="st-row" style={{ gap: 8 }}><span className="st-hint">No spend cap on this post.</span><button type="button" className="st-btn xs ghost" onClick={() => setEdit(true)}>Set a cap</button></div>
  if (edit) {
    return (
      <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="st-hint">Spend cap</span>
        <input className="st-input sm" style={{ width: 90 }} inputMode="decimal" value={v} onChange={e => setV(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Spend cap in credits" /> <span className="st-hint">credits</span>
        <AsyncButton className="st-btn xs primary" onClick={() => save(Number(v) > 0 ? Number(v) : null)}>Save</AsyncButton>
        {cap && <AsyncButton className="st-btn xs ghost" onClick={() => save(null)}>No cap</AsyncButton>}
        <button type="button" className="st-btn xs ghost" onClick={() => setEdit(false)}>Cancel</button>
      </div>
    )
  }
  const left = Math.max(0, (cap ?? 0) - spent)
  return (
    <div className="st-row st-cap" style={{ gap: 10, alignItems: 'center' }}>
      <span className="st-badge plain">Cap {cap} credits</span>
      <div className="st-cap-bar" aria-hidden><span style={{ width: `${Math.min(100, (spent / (cap || 1)) * 100)}%` }} /></div>
      <span className="st-hint">{Math.round(spent * 100) / 100} used, {Math.round(left * 100) / 100} left. A step past the cap is refused before it spends.</span>
      <button type="button" className="st-btn xs ghost" onClick={() => setEdit(true)}>Change</button>
    </div>
  )
}

// Step 2: the chips (what to keep, the traits to drop), the outfit, and
// what happens in the clip. "Read them for me" fills all of it (priced).
function StepTwo({ ctx, source }: { ctx: PostCtx; source: CloneSource }) {
  const qc = useQueryClient()
  const toast = useToast()
  const keep = source.keep ?? []
  const drop = (source.notLike ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const outfit = source.outfit ?? { choice: 'source' as const, text: '', lookId: null }
  const [motion, setMotion] = useState(source.motion ?? '')
  const [outfitText, setOutfitText] = useState(outfit.text)
  useEffect(() => setMotion(source.motion ?? ''), [source.motion])
  useEffect(() => setOutfitText(outfit.text), [outfit.text])
  async function save(body: Parameters<typeof api.setCloneChoices>[1]) {
    try { await api.setCloneChoices(ctx.item.id, body); await qc.invalidateQueries({ queryKey: keys.content }); qc.invalidateQueries({ queryKey: ['estimate'] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const frame = source.rawFrameId ?? source.firstFrameId ?? null
  const stillId = (ctx.draft.spec as { stillId?: string | null }).stillId ?? null
  const name = ctx.v?.data.name ?? 'your character'
  return (
    <div className="st-row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {frame && <img className="st-clonepreview-still" src={assetUrl(frame)} alt="The clip's frame the stills are made from" />}
      <div className="st-col grow" style={{ gap: 12, minWidth: 260 }}>
        <ChipList label="Scene to keep" items={keep} placeholder="Add: the place, the light, the angle, the pose" onChange={next => save({ keep: next })} tone="keep" />
        <ChipList label="Source traits to drop" items={drop} placeholder="Add: hair color, eye color, piercings, winged liner" onChange={next => save({ notLike: next.join(', ') })} tone="drop" />
        <div className="st-col" style={{ gap: 6 }}>
          <span className="st-label">Outfit</span>
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`st-chip ${outfit.choice === 'source' ? 'on' : ''}`} aria-pressed={outfit.choice === 'source'} onClick={() => save({ outfit: { choice: 'source' } })}>{outfit.choice === 'source' && <Check size={12} />}Keep the clip's outfit</button>
            <button type="button" className={`st-chip ${outfit.choice === 'hers' ? 'on' : ''}`} aria-pressed={outfit.choice === 'hers'} onClick={() => save({ outfit: { choice: 'hers' } })}>{outfit.choice === 'hers' && <Check size={12} />}Pick {name}'s</button>
          </div>
          <input className="st-input" value={outfitText} maxLength={160} onChange={e => setOutfitText(e.target.value)} onBlur={() => { if (outfitText.trim() !== outfit.text) void save({ outfit: { text: outfitText.trim() } }) }}
            placeholder={outfit.choice === 'source' ? "Name it (optional), e.g. dark green sleeveless dress" : `What ${name} wears instead, e.g. black ribbed tank and jeans`} aria-label="The outfit" />
          {outfit.choice === 'hers' && stillId && (
            <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={outfit.lookId === stillId} onChange={e => void save({ outfit: { lookId: e.target.checked ? stillId : null } })} />
              <span className="st-hint">Use the outfit from this post's still</span>
            </label>
          )}
        </div>
        <div className="st-col" style={{ gap: 6 }}>
          <span className="st-label">What happens in the clip <span className="st-muted">(for the motion prompt)</span></span>
          <input className="st-input" value={motion} maxLength={400} onChange={e => setMotion(e.target.value)} onBlur={() => { if (motion.trim() !== (source.motion ?? '')) void save({ motion: motion.trim() }) }} placeholder="e.g. she looks into the lens, turns to glance over her shoulder, turns back" aria-label="What happens in the clip" />
        </div>
        {ctx.item.characterId && (
          <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <PriceButton action={{ type: 'clone_traits', contentId: ctx.item.id, characterId: ctx.item.characterId }} label="Read them for me" variant="secondary" size="sm" watch={j => j.purpose === `clone_traits:${ctx.item.id}`} />
            <span className="st-hint">Claude reads the frame and a few more through the clip.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ChipList({ label, items, placeholder, onChange, tone }: { label: string; items: string[]; placeholder: string; onChange: (next: string[]) => Promise<void> | void; tone: 'keep' | 'drop' }) {
  const [v, setV] = useState('')
  const add = () => { const t = v.trim().replace(/,+$/, ''); if (!t) return; setV(''); void onChange([...items.filter(x => x.toLowerCase() !== t.toLowerCase()), t]) }
  return (
    <div className="st-col" style={{ gap: 6 }}>
      <span className="st-label">{label}</span>
      <div className={`st-row st-chiplist ${tone}`} style={{ gap: 6, flexWrap: 'wrap' }}>
        {items.map(x => (
          <span key={x} className={`st-chip ${tone === 'drop' ? 'drop' : 'on'}`}>{x}<button type="button" className="st-chip-x" aria-label={`Remove ${x}`} onClick={() => void onChange(items.filter(y => y !== x))}><X size={11} /></button></span>
        ))}
        {!items.length && <span className="st-hint">None yet.</span>}
      </div>
      <div className="st-row" style={{ gap: 6 }}>
        <input className="st-input sm grow" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} placeholder={placeholder} aria-label={`Add to ${label}`} />
        <button type="button" className="st-btn xs" onClick={add} disabled={!v.trim()}><Plus size={12} />Add</button>
      </div>
    </div>
  )
}

// Step 3 and 4: the stills with their scores and gates; the face pass in
// one click; "Make the video" on a still that passes.
function StillsStep({ ctx, list: all, kept, takes, picked, opts }: { ctx: PostCtx; list: CloneStill[]; kept: string | null; takes: { still: number; face: number }; picked: CloneModel | null; opts: CloneOptions | undefined }) {
  const toast = useToast()
  const qc = useQueryClient()
  const gateMargin = opts?.gate.margin ?? null
  // The face pass on the best still rides with the stills, in one price
  // (owner, round 17); the switch skips it.
  const [facePass, setFacePass] = useState<boolean>(opts?.facePass ?? true)
  // The stills model (owner, round 18): Nano Banana 2.1 on the plan or GPT
  // Image 2.5 on the API; same prompts, face pass and gates. Last pick kept.
  const [stillModel, setStillModel] = useState<string | null>(null)
  const choices = opts?.stillModels ?? []
  const chosen = choices.find(c => c.ref === (stillModel ?? opts?.stillModel.ref)) ?? null
  function pickStill(ref: string) {
    setStillModel(ref)
    api.setRecreateStillModel(ref).catch(() => undefined)
  }
  const untested = chosen?.path === 'api' ? `${chosen.label}, ${chosen.note ?? 'untested for recreates'}` : null
  // A face pass skipped because the best still was already clear (owner,
  // 2026-10-15): one line, nothing charged.
  const skipped = all.find(x => x.status === 'skipped')
  const list = all.filter(x => x.status !== 'skipped')
  const stillsLabel = `${list.length ? `Make ${takes.still} new stills` : `Make ${takes.still} stills`}${facePass ? ' + face pass' : ''}${untested ? ` (${untested})` : ''}`
  const cid = ctx.item.characterId ?? ''
  const usable = list.filter(x => x.assetId && !x.error)
  async function youPick() {
    try { await api.pickCloneStill(ctx.item.id, cid); void qc.invalidateQueries({ queryKey: keys.content }); void qc.invalidateQueries({ queryKey: ['clone-stills', ctx.item.id] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function use(id: string) {
    try { await api.useCloneStill(ctx.item.id, id); void qc.invalidateQueries({ queryKey: keys.content }); void qc.invalidateQueries({ queryKey: ['clone-stills', ctx.item.id] }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  // Earlier failures in one gray line (owner, 2026-10-15): only the run just
  // started (the newest, while it is fresh) shows its failures as tiles.
  const [showEarlier, setShowEarlier] = useState(false)
  const clearedAt = (ctx.draft.spec as { failuresClearedAt?: string | null }).failuresClearedAt ?? null
  const newest = list.reduce<CloneStill | null>((a, x) => (!a || x.createdAt > a.createdAt ? x : a), null)
  const freshRun = newest && Date.now() - Date.parse(newest.createdAt) < FRESH_MS ? newest.runId : null
  const folded = list.filter(x => !!x.error && !x.assetId && x.runId !== freshRun)
  const earlier = folded.filter(x => !clearedAt || x.createdAt > clearedAt)
  const shown = list.filter(x => !folded.includes(x))
  // Face passes sit next to the still they fix.
  const order = [...shown.filter(x => x.pass === 'still')].flatMap(s => [s, ...shown.filter(f => f.parentId === s.id)])
  const rest = shown.filter(x => !order.includes(x))
  const tile = (x: CloneStill) => (
            <div key={x.id} className={`st-tile st-scene-tile ${kept === x.id ? 'picked' : ''} ${isFresh(x.createdAt) ? 'st-new' : ''} ${x.pass === 'face' ? 'st-facepass' : ''}`}>
              <div className="st-tile-open">
                {x.assetId ? <img className="st-clip" style={{ aspectRatio: '9 / 16', objectFit: 'cover' }} src={assetUrl(x.assetId)} alt={`${x.pass === 'face' ? 'Face pass' : 'Still'} of ${x.characterName}`} /> : <div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}><AlertTriangle size={18} /></div>}
                {kept === x.id && <span className="st-badge ok"><Check size={12} /></span>}
              </div>
              <div className="st-row" style={{ gap: 6, padding: '0 4px', flexWrap: 'wrap' }}>
                <span className="st-tile-label">{x.pass === 'face' ? 'Face pass' : 'Still'}</span>
                {x.faceScore != null && <span className="st-badge plain" title="Face match to REF-00 (higher is better)">Face {pct(x.faceScore)}</span>}
                {x.sourceScore != null && <span className="st-badge plain" title="Likeness to the person in the clip (must stay low)">Clip {pct(x.sourceScore)}</span>}
                {x.gate.margin != null && <span className={`st-badge ${x.gate.margin >= (gateMargin ?? 0) ? 'plain' : 'bad'}`} title="How much more it looks like her than the person in the clip (face minus clip)">Margin {pct(x.gate.margin)}</span>}
              </div>
              {x.error ? <span className="st-hint" style={{ color: 'var(--st-bad)', padding: '0 4px' }}>{x.error}</span> : <GatePill gate={x.gate} />}
              {/* The prompt, attachments and model, failed stills included. */}
              <SentButton candidateId={x.id} size="xs" />
              {x.assetId && !x.error && (
                <div className="st-tile-action st-col" style={{ gap: 6, alignItems: 'flex-start' }}>
                  {/* The video starts from a face pass, or from the picked still. */}
                  {x.gate.ok && picked && !picked.problem && (x.pass === 'face' || kept === x.id) && (
                    <PriceButton action={{ type: 'clone', contentId: ctx.item.id, characterIds: [cid], mode: 'motion', model: picked.ref, looks: {}, keepSound: false, stills: { [cid]: x.id } }} label="Make the video" size="sm" icon={false} compact watch={j => j.purpose.startsWith(`clone:${ctx.item.id}:`)} />
                  )}
                  {x.pass === 'still' && <PriceButton action={{ type: 'clone_face', contentId: ctx.item.id, characterId: cid, candidateId: x.id, takes: takes.face }} label={`Fix this face (${takes.face})`} variant={x.gate.ok && kept === x.id ? 'secondary' : 'primary'} size="sm" icon={false} compact watch={j => j.purpose.startsWith(`clone_face:${ctx.item.id}:${cid}:${x.id}`)} />}
                  {x.pass === 'face' && !x.gate.ok && x.parentId && <PriceButton action={{ type: 'clone_face', contentId: ctx.item.id, characterId: cid, candidateId: x.parentId, takes: takes.face }} label="Fix the face again" variant="secondary" size="sm" icon={false} compact watch={j => j.purpose.startsWith(`clone_face:${ctx.item.id}:${cid}:${x.parentId}`)} />}
                  {kept !== x.id && <AsyncButton className="st-btn xs ghost" onClick={() => use(x.id)} icon={<CheckCircle2 size={12} />}>Pick this one</AsyncButton>}
                </div>
              )}
            </div>
  )
  return (
    <div className="st-col" style={{ gap: 12 }}>
      {skipped?.note && <span className="st-hint" data-field="facepass-skipped"><ShieldCheck size={12} /> {skipped.note}</span>}
      {shown.length > 0 && <div className="st-grid scenes">{[...order, ...rest].map(tile)}</div>}
      {earlier.length > 0 && (
        <FailureLine
          text={failureLine(earlier.map(x => ({ kind: x.failure ?? 'failed', facePass: x.pass === 'face', charged: 'no' })))}
          open={showEarlier}
          onToggle={() => setShowEarlier(v => !v)}
          onClear={() => { ctx.draft.setSpec({ failuresClearedAt: new Date().toISOString() }); setShowEarlier(false) }}
        />
      )}
      {showEarlier && earlier.length > 0 && <div className="st-grid scenes st-earlier" data-field="earlier-failures">{earlier.map(tile)}</div>}
      {choices.length > 1 && (
        <div className="st-videomodels" role="radiogroup" aria-label="Stills model" data-field="recreate-stillmodel">
          {choices.map(c => {
            const on = c.ref === chosen?.ref
            return (
              <button key={c.ref} type="button" role="radio" aria-checked={on} className={`st-choice ${on ? 'on' : ''}`} onClick={() => pickStill(c.ref)} disabled={!!c.problem}>
                <span className="st-row" style={{ gap: 8 }}><b>{c.label}</b><span className="st-spacer" />{on && <Check size={14} />}</span>
                <span className="st-hint">{c.pathLabel}{c.note ? `, ${c.note}` : ''}</span>
                {c.problem && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>{c.problem}</span>}
              </button>
            )
          })}
        </div>
      )}
      <span className="st-row" style={{ gap: 8, alignItems: 'center' }} data-field="recreate-facepass" title={`Runs the face pass (${takes.face} takes) on the best still, in the same price. Both proven hand runs needed it.`}>
        <button type="button" role="switch" aria-checked={facePass} aria-label="Face pass on the best still" className={`st-switch ${facePass ? 'on' : ''}`} onClick={() => setFacePass(f => !f)}><span /></button>
        <span className="st-hint">Face pass on the best still{facePass ? '' : ' (skipped)'}</span>
      </span>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PriceButton label={stillsLabel} variant={list.length ? 'secondary' : 'primary'} todo={chosen?.problem ? [{ label: chosen.problem, target: 'recreate-stillmodel' }] : undefined} action={chosen?.problem ? null : { type: 'clone_still', contentId: ctx.item.id, characterId: cid, takes: takes.still, facePass, ...(chosen ? { stillModel: chosen.ref } : {}) }} watch={j => j.purpose === `clone_still:${ctx.item.id}:${cid}` || j.purpose === `clone_face:${ctx.item.id}:${cid}:auto`} />
        {usable.length > 1 && <AsyncButton className="st-btn sm ghost" onClick={youPick} icon={<Sparkles size={14} />}>You pick</AsyncButton>}
      </div>
    </div>
  )
}

// After every 10 real recreates: a one-line notice linking to the gate
// check in Settings > Rules (owner, round 18).
function GateCheckNotice() {
  const q = useQuery({ queryKey: ['gate-check'], queryFn: api.gateCheck, staleTime: 5 * 60_000, retry: false })
  if (!q.data?.due && !q.data?.video?.due) return null
  return <Callout tone="info">{q.data.due ? `${q.data.count} real recreates` : `${q.data.video.count} real takes`} since the gate numbers were last checked. <Link to="/studio/settings?tab=rules#gate-check">See the scores and the suggested numbers</Link>; nothing changes until you approve.</Callout>
}

// The gates (fixed): ready for the video, or why not.
export function GatePill({ gate }: { gate: CloneStill['gate'] }) {
  if (gate.ok) return <span className="st-gate ok" title={gate.note ?? undefined}><ShieldCheck size={12} /> Ready for the video</span>
  return <span className="st-gate held"><ShieldAlert size={12} /> Held: {gate.reasons.join(' ')}</span>
}

// The motion models as choices: price, path, grey with one line why.
export function MotionPicker({ models, picked, onPick, loading }: { models: CloneModel[]; picked: string | null; onPick: (ref: string) => void; loading?: boolean }) {
  if (loading) return <div className="st-skel" style={{ height: 96, borderRadius: 14 }} />
  return (
    <div className="st-videomodels" role="radiogroup" aria-label="Motion model">
      {models.map(x => {
        const on = x.ref === picked
        const off = !!x.problem
        return (
          <button key={x.ref} type="button" role="radio" aria-checked={on} className={`st-choice ${on ? 'on' : ''}`} onClick={() => onPick(x.ref)} disabled={off} title={x.note || undefined}>
            <span className="st-row" style={{ gap: 8 }}><b>{x.label}</b><span className="st-spacer" />{on && <Check size={14} />}</span>
            <span className="st-model-price">{x.display ?? (off ? 'Not available' : 'No price yet')}{x.display && !x.verified ? <span className="st-muted" style={{ fontWeight: 400 }}> (not confirmed)</span> : null}</span>
            <span className="st-hint">{x.pathLabel}{x.resolution ? ` · ${x.resolution}` : ''}{!x.takesPrompt ? ' · no prompt on this path' : ''}</span>
            {off && <span className="st-hint" style={{ color: 'var(--st-warn)' }}>{x.problem}</span>}
          </button>
        )
      })}
    </div>
  )
}

// Step 6: the takes, each with its review.
function Takes({ ctx }: { ctx: PostCtx }) {
  const clones = useClones(ctx.item.id)
  const list = (clones.data?.clones ?? []).filter(c => c.characterId === ctx.item.characterId)
  if (!list.length) return null
  return (
    <div className="st-col" style={{ gap: 12 }}>
      <span className="st-row" style={{ gap: 8 }}><span className="st-label grow">6. Review the take</span><HowTo id="post-clone" label="How the review works" /></span>
      {list.map(c => <TakeReview key={c.id} ctx={ctx} c={c} />)}
    </div>
  )
}

// Takes reviewed before text frames were kept: one free review again per
// visit fills them in.
const framesAsked = new Set<string>()

const two = (v: number | null) => (v == null ? 'none' : v.toFixed(2))
const takeLine = (g: TakeGate) => [g.face != null ? `face ${two(g.face)}` : null, g.margin != null ? `margin ${two(g.margin)}` : null, g.likeness != null ? `likeness ${two(g.likeness)}` : null].filter(Boolean).join(', ') || 'no face scores'

function TakeReview({ ctx, c }: { ctx: PostCtx; c: CloneResult }) {
  const toast = useToast()
  const qc = useQueryClient()
  const nav = useNavigate()
  const used = (ctx.draft.spec as { clipId?: string | null }).clipId === c.id
  // A paid take is never rejected (owner, 2026-10-15): one that misses the
  // video rule, or that the old check rejected, waits for your call.
  const failed = c.status === 'failed' || c.status === 'qa_failed'
  const waiting = c.status === 'in_review'
  const [others, setOthers] = useState(false)
  useEffect(() => {
    if (!c.needsFrames || framesAsked.has(c.id)) return
    framesAsked.add(c.id)
    api.reviewTakeAgain(ctx.item.id, c.id).then(() => qc.invalidateQueries({ queryKey: ['jobs'] })).catch(() => undefined)
  }, [c.id, c.needsFrames, ctx.item.id, qc])
  async function keepTake(): Promise<void> {
    try {
      await api.keepClone(c.id, true)
      await qc.invalidateQueries({ queryKey: ['clones', ctx.item.id] })
      toast({ tone: 'ok', text: 'Kept. Use this take when you are ready.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function tryAgain(): Promise<void> {
    try {
      await api.tryCloneAgain(ctx.item.id, c.id)
      await qc.invalidateQueries({ queryKey: ['clones', ctx.item.id] })
      document.querySelector('[data-field="recreate-model"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      toast({ tone: 'ok', text: 'Noted. Make the video again below (priced as before), or pick another still or model first.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function useTake(acknowledge = false): Promise<void> {
    try {
      await api.useCloneTake(ctx.item.id, c.id, acknowledge)
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['library'] })
      ctx.open('text')
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_required') toast({ tone: 'bad', text: 'The face in this take does not match REF-00.', action: { label: 'Use it anyway', run: () => void useTake(true) } })
      else toast({ tone: 'bad', text: errorMessage(e) })
    }
  }
  async function trimAt(start: number, end: number) {
    try {
      await api.trimClone(c.id, start, end)
      toast({ tone: 'ok', text: `Trimming to ${start} to ${end} s (free). The trimmed take shows here; the original stays.` })
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function forOther(characterId: string) {
    try {
      const { id } = await api.recreateFor(ctx.item.id, characterId)
      await qc.invalidateQueries({ queryKey: keys.content })
      nav(`/studio/posts/${id}`)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const others_ = ctx.characters.filter(x => x.id !== ctx.item.characterId)
  return (
    <div className={`st-card st-col st-take ${isFresh(c.createdAt) ? 'st-new' : ''}`} style={{ gap: 12 }}>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b className="grow">{c.label}</b>
        {c.model && <span className="st-badge plain">{c.model}</span>}
        {c.status === 'approved' ? <span className="st-badge ok">Kept</span> : waiting ? <span className="st-badge warn">{c.gate && !c.gate.ok ? 'Misses the video rule' : 'Your call'}</span> : failed ? <span className="st-badge bad">Did not finish</span> : null}
      </div>
      {c.error && <Callout tone="bad">{c.error}</Callout>}
      {c.oldReject && waiting && <Callout tone="info">The old check marked this take Not kept: "{c.oldReject.split('. ')[0]!.replace(/\.$/, '')}." That check is gone. A paid take is never rejected now: keep it or try again.</Callout>}
      {c.gate && (c.gate.ok
        ? <span className="st-hint" data-field="take-rule"><ShieldCheck size={12} /> Passes the video rule over {c.gate.frames} frames: {takeLine(c.gate)}.</span>
        : <Callout tone="warn"><b>Misses the video rule</b> ({takeLine(c.gate)}): {c.gate.reasons.join(' ')} It is not thrown away: keep it, or try again.</Callout>)}
      {c.gate?.note && <span className="st-hint">{c.gate.note}</span>}
      {c.assetId && <SyncedPair source={c.sourceAssetId} take={c.assetId} posters={c.posters} review={c.review} onTrim={trimAt} duration={c.durationSec ?? c.review?.duration ?? 0} />}
      {waiting && c.assetId && (
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-field="take-call">
          <AsyncButton className="st-btn primary" onClick={keepTake} icon={<CheckCircle2 size={15} />}>Keep this take</AsyncButton>
          <AsyncButton className="st-btn" onClick={tryAgain} icon={<RotateCcw size={15} />}>Try again</AsyncButton>
          <span className="st-hint">{c.decision === 'tried_again' ? 'You tried again on this take; it stays here if you change your mind.' : 'Your call counts toward the gate check. Try again spends nothing until you make the video.'}</span>
        </div>
      )}
      {c.status === 'approved' && c.assetId && (
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {used ? <span className="st-badge ok"><CheckCircle2 size={12} /> In this post</span> : <AsyncButton className="st-btn primary" onClick={() => useTake()} icon={<CheckCircle2 size={15} />}>Use this take</AsyncButton>}
          <span className="st-hint">Opens the Text step. No music unless you add one.</span>
          <span className="st-spacer" />
          {others_.length > 0 && (others
            ? <span className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>{others_.map(x => <AsyncButton key={x.id} className="st-btn xs" onClick={() => forOther(x.id)}>{x.name}</AsyncButton>)}<button type="button" className="st-btn xs ghost" onClick={() => setOthers(false)}>Cancel</button></span>
            : <button type="button" className="st-btn sm ghost" onClick={() => setOthers(true)}><Users size={14} />Recreate with another character</button>)}
        </div>
      )}
      <RunStatus match={j => j.purpose === `clone_review:${ctx.item.id}:${c.id}` || j.purpose.startsWith(`clone_trim:${ctx.item.id}:${c.id}`)} />
    </div>
  )
}

// The source clip and the take side by side, one play button, one
// scrubber; the strip under them: the face every half second (red where it
// drifts), text found, and cuts with "Trim at the cut".
function SyncedPair({ source, take, posters, review, duration, onTrim }: { source: string | null; take: string; posters?: CloneResult['posters']; review: CloneResult['review']; duration: number; onTrim: (start: number, end: number) => void }) {
  const a = useRef<HTMLVideoElement | null>(null)
  const b = useRef<HTMLVideoElement | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const total = duration || review?.duration || 0
  useEffect(() => {
    const v = b.current
    if (!v) return
    const tick = () => {
      setT(v.currentTime)
      const s = a.current
      if (s && Math.abs(s.currentTime - v.currentTime) > 0.15) s.currentTime = v.currentTime
    }
    v.addEventListener('timeupdate', tick)
    const end = () => setPlaying(false)
    v.addEventListener('ended', end)
    return () => { v.removeEventListener('timeupdate', tick); v.removeEventListener('ended', end) }
  }, [])
  function seek(x: number) {
    for (const v of [a.current, b.current]) if (v) v.currentTime = x
    setT(x)
  }
  function toggle() {
    const vs = [a.current, b.current].filter((v): v is HTMLVideoElement => !!v)
    if (playing) { vs.forEach(v => v.pause()); setPlaying(false) } else { vs.forEach(v => void v.play().catch(() => undefined)); setPlaying(true) }
  }
  const at = (x: number) => `${total ? Math.min(100, (x / total) * 100) : 0}%`
  return (
    <div className="st-col" style={{ gap: 8 }}>
      <div className="st-pair">
        {source && <figure><video ref={a} src={`${assetUrl(source)}#t=0.1`} poster={posters?.source ? assetUrl(posters.source, 480) : undefined} muted playsInline preload="auto" /><figcaption>The clip</figcaption></figure>}
        <figure><video ref={b} src={`${assetUrl(take)}#t=0.1`} poster={posters?.take ? assetUrl(posters.take, 480) : undefined} muted playsInline preload="auto" /><figcaption>The take</figcaption></figure>
      </div>
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="st-btn sm" onClick={toggle} aria-label={playing ? 'Pause both' : 'Play both'}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : 'Play both'}</button>
        <input type="range" className="grow" min={0} max={total || 1} step={0.05} value={t} onChange={e => seek(Number(e.target.value))} aria-label="Scrub both" />
        <span className="st-hint st-mono">{t.toFixed(1)} / {total.toFixed(1)} s</span>
      </div>
      {review ? (
        <div className="st-col" style={{ gap: 6 }}>
          <div className="st-strip" role="img" aria-label="Face match every half second">
            {review.samples.map(s => (
              <span key={s.t} className={`st-strip-cell ${s.face == null ? 'none' : s.face < review.faceMin ? 'drift' : 'ok'}`} style={{ left: at(s.t), width: at(review.step) }} title={`${s.t.toFixed(1)} s: face ${s.face == null ? 'not found' : s.face.toFixed(2)}${s.likeness != null ? `, clip person ${s.likeness.toFixed(2)}` : ''}`} onClick={() => seek(s.t)} />
            ))}
            {review.cuts.map(x => <span key={`c${x}`} className="st-strip-cut" style={{ left: at(x) }} title={`Cut at ${x.toFixed(1)} s`} />)}
            {review.text.map((x, i) => <span key={`t${i}`} className={`st-strip-text ${x.kind}`} style={{ left: at(x.t) }} title={`${x.kind === 'handle' ? 'Handle' : x.kind === 'logo' ? 'Logo' : 'Text'} at ${x.t.toFixed(1)} s: ${x.text}`} />)}
            <span className="st-strip-head" style={{ left: at(t) }} aria-hidden />
          </div>
          <div className="st-row st-hint" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span><span className="st-dot ok" /> face matches</span><span><span className="st-dot drift" /> face under {review.faceMin.toFixed(2)} (the video rule)</span>
            {review.drift.length > 0 && <span>Drift at {review.drift.map(d => `${d.start.toFixed(1)} to ${d.end.toFixed(1)} s`).join(', ')}</span>}
          </div>
          {review.text.length > 0 && (
            <div className="st-col" style={{ gap: 4 }}>
              <span className="st-label">Text found on the take <span className="st-muted" style={{ fontWeight: 400 }}>(the words boxed in red on their frame: tell real leftover text from a false reading)</span></span>
              <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {review.text.map((x, i) => (
                  <button key={i} type="button" className={`st-texthit text-${x.kind}`} onClick={() => seek(x.t)} title="Show this moment in both videos">
                    {x.frameAssetId ? <img src={assetUrl(x.frameAssetId)} alt={`The frame at ${x.t.toFixed(1)} s with the words boxed`} /> : <span className="st-texthit-empty">Getting the frame...</span>}
                    <span>{x.kind === 'handle' ? 'Handle' : x.kind === 'logo' ? 'Logo' : 'Text'}: <b>{x.text}</b> <span className="st-muted">{x.t.toFixed(1)} s</span></span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {review.cuts.length > 0 && (
            <div className="st-col" style={{ gap: 4 }}>
              <span className="st-label">Cuts</span>
              <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {review.cuts.map(x => (
                  <span key={x} className="st-row" style={{ gap: 4 }}>
                    <button type="button" className="st-chip" onClick={() => seek(x)}>Cut at {x.toFixed(1)} s</button>
                    <button type="button" className="st-btn xs" onClick={() => onTrim(0, x)} title={`Keep 0 to ${x.toFixed(1)} s (free)`}><Scissors size={12} />Trim at the cut</button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {!review.text.length && !review.cuts.length && !review.drift.length && review.samples.some(s => s.face != null) && <span className="st-hint"><Check size={12} /> No drift, no text, no cuts.</span>}
          {review.notes.map((n, i) => <span key={i} className="st-hint">{n}</span>)}
          <TrimFree total={total} onTrim={onTrim} />
        </div>
      ) : <span className="st-hint">Reviewing the take: the face every half second, text, cuts (free, on the worker)...</span>}
    </div>
  )
}

function TrimFree({ total, onTrim }: { total: number; onTrim: (start: number, end: number) => void }) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('0')
  const [end, setEnd] = useState(String(total))
  const s = Number(start), e = Number(end)
  const bad = !(s >= 0 && e > s + 0.5 && e <= total + 0.05)
  if (!open) return <div><button type="button" className="st-btn xs ghost" onClick={() => setOpen(true)}><Scissors size={12} />Trim</button></div>
  return (
    <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <label className="st-hint">From <input className="st-input sm" style={{ width: 64 }} inputMode="decimal" value={start} onChange={ev => setStart(ev.target.value.replace(/[^0-9.]/g, ''))} aria-label="Start, in seconds" /></label>
      <label className="st-hint">to <input className="st-input sm" style={{ width: 64 }} inputMode="decimal" value={end} onChange={ev => setEnd(ev.target.value.replace(/[^0-9.]/g, ''))} aria-label="End, in seconds" /> s</label>
      <button type="button" className="st-btn xs primary" disabled={bad} onClick={() => { onTrim(s, e); setOpen(false) }}><Scissors size={12} />Trim (free)</button>
      <button type="button" className="st-btn xs ghost" onClick={() => setOpen(false)}>Cancel</button>
      {bad && <span className="st-hint">Keep at least half a second, inside {total} s.</span>}
    </div>
  )
}

// Paste a direct video link or a Higgsfield media ID (a clip already in
// your Higgsfield media), next to "Choose the video".
export function ClipLink({ onAdd }: { onAdd: (link: string) => Promise<void> }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="st-row" style={{ gap: 6 }}>
      <input className="st-input sm" style={{ flex: 1, minWidth: 200 }} value={v} onChange={e => setV(e.target.value)} placeholder="Or paste a video link or a Higgsfield media ID" aria-label="A video link or a Higgsfield media ID" />
      <button type="button" className="st-btn sm" disabled={!v.trim() || busy} onClick={async () => { setBusy(true); try { await onAdd(v.trim()); setV('') } finally { setBusy(false) } }}><Copy size={13} />{busy ? 'Adding...' : 'Use it'}</button>
    </div>
  )
}

// ── A batch of recreates (UX-PLAN.md 16) ────────────────────────────

// Up to 20 rows, each a clip and a character in its own video post, with its
// own motion model and "Set all". Each step runs for every row that is at it
// (one price, a line per row); a row held by its gates waits for you.
export function RecreateBatch({ ctx, onTakes }: { ctx: PostCtx; onTakes: (ids: string[]) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  // The face pass rides with each row's stills unless skipped (owner, round 17).
  const [facePass, setFacePass] = useState(true)
  const view = useQuery({ queryKey: ['recreate-batch', ctx.item.id, facePass], queryFn: () => api.recreateBatch(ctx.item.id, facePass), refetchInterval: q => (q.state.data?.rows.some(r => r.next === 'preparing' || r.next === 'working') ? 4000 : false) })
  const options = useQuery({ queryKey: ['clone-options', ctx.item.id, 'batch'], queryFn: () => api.cloneOptions(ctx.item.id), staleTime: 60_000, retry: false })
  const models = (options.data?.models ?? []).filter(m => m.mode === 'motion')
  const rows = view.data?.rows ?? []
  const prices = view.data?.prices ?? {}
  const [character, setCharacter] = useState(ctx.item.characterId ?? '')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['recreate-batch', ctx.item.id] }); void qc.invalidateQueries({ queryKey: keys.content }) }
  async function add(body: { link?: string; uploadId?: string; name?: string }) {
    setBusy(true)
    try { await api.addRecreateRow(ctx.item.id, { character, ...body }); setLink(''); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try { const [up] = await uploadFiles([file]); await api.addRecreateRow(ctx.item.id, { character, uploadId: up!.uploadId, name: file.name }); refresh() } catch (e) { toast({ tone: 'bad', text: `${file.name}: ${errorMessage(e)}` }) } finally { setBusy(false) }
  }
  async function setModel(body: { all?: string | null; row?: { postId: string; model: string | null } }) {
    try { await api.setRecreateRows(ctx.item.id, body); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const at = (step: 'stills' | 'face' | 'video') => rows.filter(r => r.next === step)
  const total = (step: 'stills' | 'face' | 'video') => {
    const list = at(step).map(r => prices[r.postId]).filter(p => p?.step === step)
    const credits = list.every(p => p?.credits != null) ? list.reduce((s, p) => s + (p?.credits ?? 0), 0) : null
    return list.length ? (credits != null ? `${Math.round(credits * 100) / 100} credits` : `$${(list.reduce((s, p) => s + (p?.micros ?? 0), 0) / 1e6).toFixed(2)}`) : null
  }
  // Only the steps some row is at get a button; a row's price shows on it.
  const steps = (['stills', 'face', 'video'] as const).filter(st => at(st).length > 0)
  const done = rows.filter(r => r.take && r.take.status !== 'failed' && r.take.assetId)
  const waiting = rows.filter(r => r.next === 'waiting')
  // A row that moves on changes what each step costs: quote again.
  const where = rows.map(r => `${r.postId}:${r.next}:${r.model}`).join(',')
  useEffect(() => { void qc.invalidateQueries({ queryKey: ['estimate'] }) }, [where, qc])
  return (
    <div className="st-col" style={{ gap: 14 }}>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="st-hint grow">Each row is a clip and a character in its own video post. Up to {view.data?.max ?? 20} rows.</span>
        <HowTo id="post-clone" label="How a recreate batch works" />
      </div>
      {rows.length > 0 && (
        <div className="st-batchrows">
          <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="st-label">Set all to</span>
            <select className="st-input sm" style={{ width: 'auto' }} aria-label="Set every row's motion model" value="" onChange={e => { if (e.target.value) void setModel({ all: e.target.value }) }}>
              <option value="">Pick a model</option>
              {models.map(m => <option key={m.ref} value={m.ref} disabled={!!m.problem}>{m.label} ({m.pathLabel}){m.problem ? `: ${m.problem}` : ''}</option>)}
            </select>
          </div>
          {rows.map((r, i) => {
            const p = prices[r.postId]
            return (
              <div key={r.postId} className="st-batchrow">
                {r.frameId ? <img src={assetUrl(r.frameId)} alt={`Row ${i + 1}: ${r.name}`} /> : <div className="st-skel" style={{ width: 64, aspectRatio: '9 / 16' }} />}
                <div className="st-col" style={{ gap: 6, minWidth: 0 }}>
                  <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <b>Row {i + 1}</b><span>{r.characterName}</span><span className="st-muted">{r.name}{r.seconds ? `, ${r.seconds} s` : ''}</span>
                    <span className="st-spacer" />
                    <span className={`st-badge ${r.next === 'waiting' || r.next === 'failed' ? 'bad' : r.next === 'done' ? 'ok' : 'plain'}`}>{ROW_NEXT[r.next]}</span>
                  </div>
                  <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select className="st-input sm" style={{ width: 'auto' }} aria-label={`Row ${i + 1} motion model`} value={r.model} onChange={e => void setModel({ row: { postId: r.postId, model: e.target.value } })}>
                      {models.map(m => <option key={m.ref} value={m.ref} disabled={!!m.problem}>{m.label} ({m.pathLabel}){m.problem ? `: ${m.problem}` : ''}</option>)}
                    </select>
                    {p && <span className="st-hint">{p.step === 'stills' ? (facePass ? 'Stills + face pass' : 'Stills') : p.step === 'face' ? 'Face pass' : 'Video'}: <b>{p.display}</b></span>}
                    {r.still && <GatePill gate={r.still.gate} />}
                  </div>
                  {r.why && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>{r.why}</span>}
                  <div className="st-row" style={{ gap: 6 }}>
                    <button type="button" className="st-btn xs ghost" onClick={() => nav(`/studio/posts/${r.postId}`)}>Open the row</button>
                    <button type="button" className="st-btn xs ghost" onClick={() => void api.setRecreateRows(ctx.item.id, { remove: r.postId }).then(refresh)}><X size={12} />Take out</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="st-col" style={{ gap: 8 }}>
        <span className="st-label">Add a row</span>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="st-input sm" style={{ width: 'auto' }} value={character} onChange={e => setCharacter(e.target.value)} aria-label="Character for the row">
            {ctx.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input ref={input} type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f) }} />
          <button type="button" className="st-btn sm" disabled={busy || !character || rows.length >= (view.data?.max ?? 20)} onClick={() => input.current?.click()}>Choose a clip</button>
          <input className="st-input sm grow" style={{ minWidth: 200 }} value={link} onChange={e => setLink(e.target.value)} placeholder="or a video link or Higgsfield media ID" aria-label="A video link or Higgsfield media ID for the row" />
          <button type="button" className="st-btn sm" disabled={busy || !link.trim() || !character} onClick={() => void add({ link: link.trim() })}>Add</button>
        </div>
      </div>
      {steps.length > 0 && (
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {steps.map((st, i) => (
            <PriceButton key={st} label={`${st === 'stills' && facePass ? 'Make stills + face pass' : STEP_LABEL[st]} for ${at(st).length} row${at(st).length === 1 ? '' : 's'}`} variant={i === 0 ? 'primary' : 'secondary'} action={{ type: 'recreate_batch', contentId: ctx.item.id, step: st, ...(st === 'stills' ? { facePass } : {}) }} onStarted={refresh} />
          ))}
          {steps.includes('stills') && (
            <span className="st-row" style={{ gap: 8, alignItems: 'center' }}>
              <button type="button" role="switch" aria-checked={facePass} aria-label="Face pass on each row's best still" className={`st-switch ${facePass ? 'on' : ''}`} onClick={() => setFacePass(f => !f)}><span /></button>
              <span className="st-hint">Face pass on each row's best still{facePass ? '' : ' (skipped)'}</span>
            </span>
          )}
        </div>
      )}
      {rows.length > 0 && <span className="st-hint">{[total('stills') && `Stills: ${total('stills')}`, total('face') && `face pass: ${total('face')}`, total('video') && `videos: ${total('video')}`].filter(Boolean).join(', ') || 'Nothing to run right now'}.{waiting.length ? ` ${waiting.length} row${waiting.length === 1 ? '' : 's'} wait for you; each says why.` : ''}</span>}
      {done.length > 0 && <AsyncButton className="st-btn sm" onClick={async () => {
        // Each take is kept first; a face that drifts asks you in its own row.
        const kept: string[] = []
        for (const r of done) { try { await api.keepClone(r.take!.id); kept.push(r.take!.id) } catch (e) { toast({ tone: 'bad', text: `Row ${rows.indexOf(r) + 1}: ${errorMessage(e)}` }) } }
        if (kept.length) onTakes(kept)
      }} icon={<CheckCircle2 size={14} />}>Add {done.length} finished take{done.length === 1 ? '' : 's'} to the batch's clips</AsyncButton>}
    </div>
  )
}

const STEP_LABEL = { stills: 'Make stills', face: 'Fix faces', video: 'Make videos' } as const

const ROW_NEXT: Record<string, string> = { preparing: 'Preparing the clip', working: 'Working on it', stills: 'Next: stills', face: 'Next: face pass', video: 'Ready for the video', waiting: 'Waits for you', done: 'Take ready', failed: 'Clip failed' }
