import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Film, Loader2, Scissors, Upload, Volume2 } from 'lucide-react'
import { api, ApiError, assetUrl } from '../../api'
import { keys, useClones, useCloneStills, useMe, useWorkerGate } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { RunStatus } from '../../runs'
import { AsyncButton, Callout, Field, errorMessage, isFresh, useToast, type TodoItem } from '../../ui'
import { Viewer, useViewer } from '../../viewer'
import type { CloneMode, CloneModel, CloneResult, CloneSource, CloneStill, MemeSpec } from '../../types'
import { pickPerson } from '../../../../server/core/cloneTarget'
import type { PostCtx } from './ctx'
import { HowTo } from '../../guide/Guide'
import { ClipLink, RecreatePanel } from './RecreatePanel'

// "Clone a TikTok or Reel" (SPEC 13.1 R1; UX-PLAN.md sections 15 and G28),
// inline in the Video step. Choose the saved video, then the route: "Replace
// the person (keep the scene)" swaps only the person picked on the first
// frame and keeps the clip's place, light, crowd and outfit; "Recreate from
// a real clip" (suggested for a dark clip or a lot of movement) makes stills
// of the character in the clip's frame, then copies the clip's real motion
// onto the one picked. The post's character is picked (add others for one
// quote with a line each); the model, with its price, and "Original sound"
// (off) are pre-filled. Each clone is checked for free, can be trimmed, and
// is kept in Library > Clips; "Use this clip" puts it in the post.

// Two routes (UX-PLAN.md section 15). "Recreate from a real clip" is the
// owner's proven recipe (2026-10-14) and the suggestion for a dark clip or
// one with a lot of movement: a still of the character in the clip's first
// frame, then the clip's real motion copied onto it.
const MODES: Array<{ id: CloneMode; label: string; line: string }> = [
  { id: 'replace', label: 'Replace the person (keep the scene)', line: "Only the person you pick changes. The clip's place, light, crowd and outfit stay." },
  { id: 'motion', label: 'Recreate from a real clip', line: "Four stills of your character in the clip's first frame, you pick one, then the clip's real motion goes onto it. Best for clubs, dark venues and real dancing." },
]

export function ClonePanel({ ctx, onUse, usedIds, batch = false }: { ctx: PostCtx; onUse: (clipId: string) => void; usedIds: string[]; batch?: boolean }) {
  const { item } = ctx
  const source = ((item.spec as unknown as MemeSpec).clone ?? null) as CloneSource | null
  const me = useMe().data?.mode
  const ready = source?.status === 'ready' && !!source.assetId
  const options = useQuery({
    queryKey: ['clone-options', item.id, source?.durationSec ?? null, source?.target ?? null, source?.look?.suggest ?? null, me],
    queryFn: () => api.cloneOptions(item.id),
    staleTime: 10 * 60_000, retry: false,
  })
  const o = options.data
  // The owner's pick wins; until then the suggested route (from the free
  // read of the clip) is selected.
  const [mode, setMode] = useState<CloneMode | null>(null)
  // A post started from a real clip (the Idea step, a Recreate link, Library
  // > Clips) opens at Recreate.
  const fromClip = (item.spec as { start?: string }).start === 'clip'
  const m = mode ?? (fromClip ? 'motion' : o?.mode ?? 'replace')
  const [models, setModels] = useState<Partial<Record<CloneMode, string>>>({})
  const model = models[m] ?? o?.defaults?.[m] ?? null
  const picked = o?.models.find(x => x.ref === model && x.mode === m) ?? null
  const [characterIds, setCharacterIds] = useState<string[]>(item.characterId ? [item.characterId] : [])
  const [keepSound, setKeepSound] = useState(false)
  useEffect(() => { if (o) setKeepSound(o.keepSound) }, [o?.keepSound]) // eslint-disable-line react-hooks/exhaustive-deps
  // The outfit: the clip's own (default), or the post's still for its
  // character.
  const stillId = (ctx.draft.spec as { stillId?: string | null }).stillId ?? null
  const [outfit, setOutfit] = useState<'source' | 'hers' | null>(null)
  const wear = outfit ?? o?.outfit ?? 'source'
  const looks = wear === 'hers' && stillId && item.characterId ? { [item.characterId]: stillId } : {}
  const fits = (x: CloneModel) => !source?.durationSec || (source.durationSec >= x.minSec - 0.05 && source.durationSec <= x.maxSec + 0.05)
  const stills = useCloneStills(item.id)
  const kept = source?.stills ?? {}
  const name = ctx.v?.data.name ?? 'your character'

  function pick(ref: string) {
    setModels(x => ({ ...x, [m]: ref }))
    api.setCloneModel(ref).catch(() => undefined)
  }
  function toggle(id: string) {
    setCharacterIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(0, o?.maxCharacters ?? 5)))
  }

  // Stills first (item 20): a replace starts from a kept still too, unless
  // switched off; then its price warns that it runs without stills.
  const [stillsFirst, setStillsFirst] = useState(true)
  const replaceStills = m === 'replace' && stillsFirst && !batch
  const needStill = m === 'motion' || replaceStills ? characterIds.filter(id => !kept[id]) : []
  const todo: TodoItem[] = [
    ...(!ready ? [{ label: 'Choose the TikTok or Reel', target: 'clone-source' }] : []),
    ...(!characterIds.length ? [{ label: 'Pick a character', target: 'clone-characters' }] : []),
    ...(ready && needStill.length ? [{ label: `Make the scene still${needStill.length > 1 ? 's' : ''} first`, target: 'clone-still' }] : []),
  ]
  const others = ctx.characters.filter(c => c.id !== item.characterId)
  const shown = o?.models.filter(x => x.mode === m) ?? []

  return (
    <div className="st-col st-clone" style={{ gap: 16 }}>
      <div className="st-row" style={{ gap: 10 }}><span className="st-hint" style={{ flex: 1, minWidth: 200 }}>Your character in a saved TikTok or Reel, with its real motion and camera.</span><HowTo id="post-clone" label="How cloning works" /></div>
      <Field id="clone-source" label="The TikTok or Reel" required done={ready} group hint={`Save it from TikTok or Instagram, then choose the file. ${o?.minSeconds ?? 3} to ${o?.maxSeconds ?? 30} s; a longer one is cut to ${o?.maxSeconds ?? 30} s.`}>
        <SourceBox ctx={ctx} source={source} maxMb={o?.maxUploadMb ?? 200} />
      </Field>

      <Field id="clone-mode" label="What to do" group>
        <div className="st-videomodels" role="radiogroup" aria-label="What to do">
          {MODES.map(x => (
            <button key={x.id} type="button" role="radio" aria-checked={m === x.id} className={`st-choice ${m === x.id ? 'on' : ''}`} onClick={() => setMode(x.id)}>
              <span className="st-row" style={{ gap: 8 }}><b>{x.label}</b><span className="st-spacer" />{o?.suggest?.mode === x.id && <span className="st-badge accent">Suggested</span>}{m === x.id && <Check size={14} />}</span>
              <span className="st-hint">{x.line}</span>
              {o?.suggest?.mode === x.id && <span className="st-hint" style={{ color: 'var(--st-accent-2)' }}>{o.suggest.why}</span>}
            </button>
          ))}
        </div>
      </Field>

      {ready && (
        <Field id="clone-target" label={m === 'motion' ? '1. Who to replace' : 'Who to replace'} group hint="Only this person changes. Tap someone else on the frame to replace them instead.">
          <FramePick ctx={ctx} source={source!} words={o?.target ?? null} />
        </Field>
      )}

      {m === 'motion' && !batch ? (ready ? <RecreatePanel ctx={ctx} source={source!} o={o} takes={o?.takes ?? { still: 4, face: 2 }} /> : null) : (<>

      <Field id="clone-characters" label={`Who is in it${characterIds.length > 1 ? ` (${characterIds.length})` : ''}`} required done={characterIds.length > 0} group hint="Rebuilt with each character. One price with a line each.">
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[...ctx.characters.filter(c => c.id === item.characterId), ...(batch ? [] : others)].map(c => {
            const on = characterIds.includes(c.id)
            return (
              <button key={c.id} type="button" className={`st-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(c.id)} title={c.id === item.characterId ? "This post's character" : 'Clone for this character too'}>
                {on && <Check size={12} />}{c.name}{c.id === item.characterId ? <span className="st-muted"> (this post)</span> : null}
              </button>
            )
          })}
        </div>
      </Field>

      <Field id="clone-outfit" label="Outfit" group hint={wear === 'hers' && !stillId ? `Make a still of ${name} in the Stills step to use one of ${ctx.v?.data.pronouns?.poss ?? 'their'} outfits.` : 'Defaults to the clothes in the clip.'}>
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`st-chip ${wear === 'source' ? 'on' : ''}`} onClick={() => setOutfit('source')}>Keep the clip's outfit</button>
          <button type="button" className={`st-chip ${wear === 'hers' ? 'on' : ''}`} onClick={() => setOutfit('hers')} disabled={!stillId} title={stillId ? undefined : 'Make a still in the Stills step first'}>{`${name}'s outfit from this post's still`}</button>
        </div>
      </Field>

      {m === 'replace' && ready && !batch && (
        <label className="st-row" style={{ gap: 10, cursor: 'pointer' }} data-field="clone-stills-first">
          <button type="button" role="switch" aria-checked={stillsFirst} aria-label="Stills first" className={`st-switch ${stillsFirst ? 'on' : ''}`} onClick={() => setStillsFirst(v => !v)}><span /></button>
          <span className="st-col" style={{ gap: 0 }}><b>Stills first</b><span className="st-hint">{stillsFirst ? `On: ${name} in the clip's frame first, checked against REF-00 for free, then the replace starts from the still you keep.` : `Off: the replace gets only ${name}'s sheet and no face checks run first. Its price says so.`}</span></span>
        </label>
      )}
      {m === 'replace' && ready && !batch && !stillsFirst && (
        <Callout tone="warn">This clone runs without stills: no face check before the money step, and faces drift more. Switch Stills first back on to start from a still that passed the gates.</Callout>
      )}

      {(m === 'motion' || replaceStills) && ready && (
        <Field id="clone-still" label={m === 'motion' ? 'The still the motion goes onto' : 'The still the replace starts from'} required done={!needStill.length} group hint={m === 'motion' ? `${name} in the clip's first frame (about 0.2 s in). Pick one; the clip's real motion is copied onto it, never onto a bare sheet image.` : `${name} in the clip's first frame (about 0.2 s in). Pick one; it leads the images the replace model gets, ahead of REF-00.`}>
          <RecreateSteps ctx={ctx} source={source!} characterIds={characterIds} outfit={wear} look={looks[item.characterId ?? ''] ?? null} list={stills.data?.stills ?? []} kept={kept} takes={o?.takes ?? { still: 4, face: 2 }} />
        </Field>
      )}

      <Field id="clone-model" label="Clone model" group hint={me === 'demo' ? 'Demo mode runs a free mock for every model.' : `Price for one character${source?.durationSec ? ` and this ${source.durationSec} s clip` : ''}. Your pick is remembered.`}>
        {!o ? <div className="st-skel" style={{ height: 96, borderRadius: 14 }} /> : (
          <div className="st-videomodels" role="radiogroup" aria-label="Clone model">
            {shown.map(x => {
              const on = x.ref === picked?.ref
              const ok = fits(x)
              return (
                <button key={x.ref} type="button" role="radio" aria-checked={on} className={`st-choice ${on ? 'on' : ''}`} onClick={() => pick(x.ref)} disabled={!ok} title={x.note || undefined}>
                  <span className="st-row" style={{ gap: 8 }}><b>{x.label}</b><span className="st-spacer" />{on && <Check size={14} />}</span>
                  <span className="st-model-price">{x.display ?? 'No price yet'}{x.display && !x.verified ? <span className="st-muted" style={{ fontWeight: 400 }}> (not confirmed)</span> : null}</span>
                  <span className="st-hint">{x.pathLabel}{x.resolution ? ` · ${x.resolution}` : ''}</span>
                  {!ok && <span className="st-hint" style={{ color: 'var(--st-warn)' }}>Takes {x.minSec} to {x.maxSec} s clips</span>}
                  {ok && x.problem && <span className="st-hint" style={{ color: 'var(--st-warn)' }}>{x.problem}</span>}
                </button>
              )
            })}
          </div>
        )}
      </Field>

      <label className="st-row" style={{ gap: 10, cursor: 'pointer' }}>
        <button type="button" role="switch" aria-checked={keepSound} className={`st-switch ${keepSound ? 'on' : ''}`} disabled={ready && !source!.hasAudio} onClick={() => setKeepSound(k => !k)}><span /></button>
        <span className="st-col" style={{ gap: 0 }}><b>Original sound</b><span className="st-hint">{ready && !source!.hasAudio ? 'This clip has no sound.' : keepSound ? "On: the clip's own sound goes back on the clone (free)." : 'Off: a silent clone, like every video.'}</span></span>
      </label>

      {ready && <RunPreview ctx={ctx} source={source!} mode={m} words={o?.target ?? null} wear={wear} still={item.characterId ? kept[item.characterId] ?? null : null} list={stills.data?.stills ?? []} />}

      <PriceButton
        label={characterIds.length > 1 ? `Clone it for ${characterIds.length} characters` : 'Clone it'}
        todo={todo}
        action={{ type: 'clone', contentId: item.id, characterIds, mode: m, ...(picked ? { model: picked.ref } : {}), outfit: wear, looks, keepSound, ...(m === 'replace' && !replaceStills ? { noStills: true } : {}) }}
        watch={j => j.purpose.startsWith(`clone:${item.id}:`)}
      />

      <CloneResults ctx={ctx} onUse={onUse} usedIds={usedIds} batch={batch} />
      </>)}
    </div>
  )
}

// The first frame with the people the worker found: tap one to replace it
// (or anywhere, when no face was found).
function FramePick({ ctx, source, words }: { ctx: PostCtx; source: CloneSource; words: string | null }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const people = source.people ?? []
  const at = source.target ?? null
  async function set(next: { x: number; y: number } | null) {
    setBusy(true)
    try {
      await api.setCloneTarget(ctx.item.id, next)
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['clone-options', ctx.item.id] })
      qc.invalidateQueries({ queryKey: ['clone-stills', ctx.item.id] })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  if (!source.firstFrameId) {
    return (
      <div className="st-col" style={{ gap: 6 }}>
        <span className="st-row" style={{ gap: 8 }}><Loader2 size={14} className="st-spin" />Finding the people in the clip...</span>
        <RunStatus match={j => j.purpose === `clone_frame:${ctx.item.id}` || j.purpose === `clone_source:${ctx.item.id}`} />
      </div>
    )
  }
  const chosen = pickPerson(people, at)
  return (
    <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <button type="button" className="st-framepick" disabled={busy} aria-label="Tap the person to replace"
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); void set({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }) }}>
        <img src={assetUrl(source.firstFrameId, 720)} alt="The first frame of the clip" />
        {people.map((b, i) => (
          <span key={i} className={`st-framepick-ring ${i === chosen ? 'on' : ''}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />
        ))}
        {at && !people.length && <span className="st-framepick-dot" style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} />}
      </button>
      <div className="st-col" style={{ gap: 6, minWidth: 0, flex: 1 }}>
        <span><b>Replacing:</b> {words ?? 'the main person'}</span>
        <span className="st-hint">{people.length > 1 ? `${people.length} people found. Everyone else stays exactly as they are.` : people.length === 1 ? 'One person found.' : 'No face found on this frame; the main person is replaced. Tap a spot to point at someone.'}</span>
        {busy && <span className="st-hint"><Loader2 size={12} className="st-spin" /> Saving...</span>}
        {at && <button type="button" className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void set(null)}>Use the largest person again</button>}
      </div>
    </div>
  )
}

// What the paid run gets, before it runs: the first frame with the person
// to replace and the face images that go with it (Replace), or the scene
// still the motion is copied onto (Recreate).
function RunPreview({ ctx, source, mode, words, wear, still, list }: { ctx: PostCtx; source: CloneSource; mode: CloneMode; words: string | null; wear: 'source' | 'hers'; still: string | null; list: CloneStill[] }) {
  const shots = ctx.v?.sheet.shots ?? []
  const face = ['REF-00', 'REF-01', 'REF-02'].map(id => shots.find(s => s.id === id)?.approved?.assetId).filter((a): a is string => !!a)
  const refs = face.slice(0, 1).concat(face.slice(1, 2))
  const stillAsset = still ? list.find(x => x.id === still)?.assetId ?? null : null
  const people = source.people ?? []
  const chosen = pickPerson(people, source.target ?? null)
  return (
    <div className="st-card st-col st-clonepreview" style={{ gap: 10 }}>
      <span className="st-label">What runs</span>
      <div className="st-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {mode === 'replace' ? (
          <>
            <div className="st-framepick sm">
              {source.firstFrameId ? <img src={assetUrl(source.firstFrameId, 320)} alt="The clip's first frame" /> : <div className="st-skel" style={{ width: 90, aspectRatio: '9 / 16' }} />}
              {chosen != null && people[chosen] && <span className="st-framepick-ring on" style={{ left: `${people[chosen]!.x * 100}%`, top: `${people[chosen]!.y * 100}%`, width: `${people[chosen]!.w * 100}%`, height: `${people[chosen]!.h * 100}%` }} />}
            </div>
            <ArrowRight size={16} aria-hidden />
            {refs.map(a => <img key={a} className="st-clonepreview-ref" src={assetUrl(a, 320)} alt="Face reference" />)}
          </>
        ) : stillAsset ? (
          <>
            <img className="st-clonepreview-still" src={assetUrl(stillAsset, 720)} alt="The scene still" />
            <span className="st-hint">+ the clip's moves</span>
          </>
        ) : <span className="st-hint">Make the scene still above; it shows here before the run.</span>}
      </div>
      {mode === 'replace' && (
        <span className="st-hint">
          <b>Changes:</b> only {words ?? 'the main person'}, with REF-00 and one three-quarter view for the face.{' '}
          <b>Keeps:</b> the place, the light, the crowd{wear === 'source' ? ', the outfit' : ''} and the moves.
        </span>
      )}
    </div>
  )
}

// "Recreate from a real clip" (UX-PLAN.md section 15): what the character
// must not take from the person in the clip, four stills from the frame,
// pick one (or "You pick"), an optional face-only pass, and the free checks
// on each still before the paid motion run.
function RecreateSteps({ ctx, source, characterIds, outfit, look, list, kept, takes }: { ctx: PostCtx; source: CloneSource; characterIds: string[]; outfit: 'source' | 'hers'; look: string | null; list: CloneStill[]; kept: Record<string, string>; takes: { still: number; face: number } }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [notLike, setNotLike] = useState(source.notLike ?? '')
  useEffect(() => setNotLike(source.notLike ?? ''), [source.notLike])
  const refresh = () => { void qc.invalidateQueries({ queryKey: keys.content }); void qc.invalidateQueries({ queryKey: ['clone-stills', ctx.item.id] }) }
  async function use(id: string) {
    try { await api.useCloneStill(ctx.item.id, id); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function youPick(cid: string) {
    try { await api.pickCloneStill(ctx.item.id, cid); refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function saveNotLike() {
    if (notLike.trim() === (source.notLike ?? '').trim()) return
    try { await api.setCloneNotLike(ctx.item.id, notLike.trim()); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const frame = source.rawFrameId ?? source.firstFrameId ?? null
  // A tap opens a still full size (the viewer, section 34).
  const view = useViewer()
  const viewable = characterIds.flatMap(cid => list.filter(x => x.characterId === cid && x.assetId))
  return (
    <div className="st-col" style={{ gap: 16 }}>
      <Viewer items={viewable.map(x => ({ id: x.id, assetId: x.assetId!, media: 'image' as const, name: x.pass === 'face' ? 'Face pass' : 'Still', thumbId: x.assetId, createdAt: x.createdAt, characterName: x.characterName }))}
        openId={view.openId} onOpen={view.open} onClose={view.close}
        actions={x => { const c = list.find(y => y.id === x.id); return !c || c.error ? null : kept[c.characterId] === c.id ? <span className="st-badge ok"><CheckCircle2 size={12} /> Used for the run</span> : <AsyncButton className="st-btn" onClick={() => use(c.id)} icon={<CheckCircle2 size={15} />}>Use this still</AsyncButton> }} />
      <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {frame && <img className="st-clonepreview-still" src={assetUrl(frame, 720)} alt="The clip's frame the stills are made from" />}
        <div className="st-col grow" style={{ gap: 6, minWidth: 240 }}>
          <span className="st-row" style={{ gap: 8 }}><span className="st-label grow">Not like the person in the clip <span className="st-muted">(optional)</span></span><HowTo id="post-clone" label="How Recreate works" /></span>
          <input className="st-input" value={notLike} maxLength={300} onChange={e => setNotLike(e.target.value)} onBlur={() => void saveNotLike()} placeholder="e.g. dark brown hair, brown eyes, a nose ring, winged liner" />
          <span className="st-hint">The traits the character must not take from that person: hair color, eye color, piercings, makeup. The real frame pulls the face toward that person; naming them keeps it away.</span>
          {ctx.item.characterId && <PriceButton action={{ type: 'clone_traits', contentId: ctx.item.id, characterId: ctx.item.characterId }} label="Read them for me" variant="secondary" size="sm" watch={j => j.purpose === `clone_traits:${ctx.item.id}`} />}
        </div>
      </div>
      {characterIds.map(cid => {
        const c = ctx.characters.find(x => x.id === cid)
        const mine = list.filter(x => x.characterId === cid)
        const usable = mine.filter(x => x.assetId && !x.error)
        return (
          <div key={cid} className="st-col" style={{ gap: 8 }}>
            {characterIds.length > 1 && <b>{c?.name}</b>}
            {mine.length > 0 && (
              <div className="st-grid scenes">
                {mine.map(x => (
                  <div key={x.id} className={`st-tile st-scene-tile ${kept[cid] === x.id ? 'picked' : ''} ${isFresh(x.createdAt) ? 'st-new' : ''}`}>
                    {x.assetId ? (
                      <button type="button" className="st-tile-open" onClick={() => view.open(x.id)} aria-label={`View still of ${x.characterName} full size`}>
                        <img className="st-clip" style={{ aspectRatio: '9 / 16', objectFit: 'cover' }} src={assetUrl(x.assetId, 480)} alt={`Still of ${x.characterName}`} />
                        {kept[cid] === x.id && <span className="st-badge ok"><Check size={12} /></span>}
                      </button>
                    ) : <div className="st-tile-open"><div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}><AlertTriangle size={18} /></div></div>}
                    <div className="st-row" style={{ gap: 6, padding: '0 4px', flexWrap: 'wrap' }}>
                      <span className="st-tile-label">{x.pass === 'face' ? 'Face pass' : 'Still'}</span>
                      {x.faceScore != null && <span className="st-badge plain" title="Face match to REF-00">Face {Math.round(x.faceScore * 100)}</span>}
                      {x.sourceScore != null && <span className="st-badge plain" title="Likeness to the person in the clip (lower is better)">Clip {Math.round(x.sourceScore * 100)}</span>}
                    </div>
                    {x.error && <span className="st-hint" style={{ color: 'var(--st-bad)', padding: '0 4px' }}>{x.error}</span>}
                    {!x.error && x.findings.filter(f => f.severity !== 'info').slice(0, 2).map((f, i) => <span key={i} className="st-hint" style={{ color: f.severity === 'fail' ? 'var(--st-bad)' : 'var(--st-warn)', padding: '0 4px' }}>{f.message}</span>)}
                    {x.assetId && !x.error && (
                      <div className="st-tile-action st-col" style={{ gap: 6, alignItems: 'flex-start' }}>
                        {kept[cid] === x.id ? <span className="st-badge ok"><CheckCircle2 size={12} /> Used for the run</span> : <AsyncButton className="st-btn sm" onClick={() => use(x.id)} icon={<CheckCircle2 size={14} />}>Use this still</AsyncButton>}
                        {x.pass === 'still' && <PriceButton action={{ type: 'clone_face', contentId: ctx.item.id, characterId: cid, candidateId: x.id, takes: takes.face }} label={`Fix the face (${takes.face})`} variant="secondary" size="sm" icon={false} watch={j => j.purpose.startsWith(`clone_face:${ctx.item.id}:${cid}:${x.id}`)} />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <PriceButton
                label={`${mine.length ? 'Make' : 'Make'} ${takes.still} stills${characterIds.length > 1 ? ` of ${c?.name}` : ''}`}
                variant={mine.length ? 'secondary' : 'primary'}
                action={{ type: 'clone_still', contentId: ctx.item.id, characterId: cid, outfit, takes: takes.still, ...(look && cid === ctx.item.characterId ? { look } : {}) }}
                watch={j => j.purpose === `clone_still:${ctx.item.id}:${cid}`}
              />
              {usable.length > 1 && <AsyncButton className="st-btn sm ghost" onClick={() => youPick(cid)} icon={<Check size={14} />}>You pick</AsyncButton>}
            </div>
            {usable.length > 0 && <span className="st-hint">You pick takes the best face match to REF-00 that looks least like the person in the clip. Fix the face redoes only the face of a still, keeping everything else pixel for pixel, when the real frame pulled it toward the person in the clip.</span>}
          </div>
        )
      })}
    </div>
  )
}

// The saved video: choose it, see it prepared (with its live status), play it.
export function SourceBox({ ctx, source, maxMb }: { ctx: PostCtx; source: CloneSource | null; maxMb: number }) {
  const toast = useToast()
  const qc = useQueryClient()
  const worker = useWorkerGate()
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  async function upload(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) { toast({ tone: 'bad', text: 'Pick a video file (MP4, MOV or WebM).' }); return }
    if (file.size > maxMb * 1024 * 1024) { toast({ tone: 'bad', text: `${file.name} is over ${maxMb} MB. Save a shorter or smaller copy.` }); return }
    setBusy(`Uploading ${file.name}...`)
    try {
      await api.addCloneSource(ctx.item.id, file, (done, total) => setBusy(`Uploading ${file.name}... ${Math.round((done / Math.max(1, total)) * 100)}%`))
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) { toast({ tone: 'bad', text: `${file.name}: ${errorMessage(e)}` }) } finally { setBusy(null) }
  }
  async function link(text: string) {
    try {
      await api.addCloneLink(ctx.item.id, text)
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const choose = (label: string, variant = '') => (
    <button type="button" className={`st-btn ${variant}`} disabled={!!busy || !worker.ready} onClick={() => input.current?.click()} title={worker.ready ? undefined : worker.reason ?? undefined}>
      {busy ? <Loader2 size={15} className="st-spin" /> : <Upload size={15} />}{label}
    </button>
  )
  return (
    <div className="st-col" style={{ gap: 8 }}>
      <input ref={input} type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f) }} />
      {source?.status === 'ready' && source.assetId ? (
        <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <video className="st-clip" style={{ width: 150, aspectRatio: '9 / 16' }} src={`${assetUrl(source.assetId)}#t=0.1`} controls playsInline preload="metadata" />
          <div className="st-col" style={{ gap: 6, minWidth: 0 }}>
            <b>{source.name}</b>
            <span className="st-hint">{source.durationSec} s · {source.hasAudio ? 'has sound' : 'no sound'}{source.trimmed ? ' · cut to the first 30 s' : ''}</span>
            {source.cleanup && <CleanupNote ctx={ctx} source={source} />}
            {source.textFrameId && ctx.item.characterId && (
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <PriceButton action={{ type: 'clone_caption', characterId: ctx.item.characterId, contentId: ctx.item.id }} label="Read its caption" variant="secondary" size="sm" onStarted={() => void qc.invalidateQueries({ queryKey: ['jobs'] })} />
                <span className="st-hint">{source.sourceCaption != null ? (source.sourceCaption ? `Read: "${source.sourceCaption}". It is the post's caption now; change it in the Caption step.` : 'No caption was found on the clip.') : 'Claude reads the caption on the clip and puts it in the post\'s caption, to edit.'}</span>
              </div>
            )}
            <RunStatus match={j => j.purpose === `clone_caption:${ctx.item.id}`} />
            {choose('Use a different video', 'sm ghost')}
          </div>
        </div>
      ) : source?.status === 'preparing' ? (
        <div className="st-col" style={{ gap: 6 }}>
          <span className="st-row" style={{ gap: 8 }}><Loader2 size={14} className="st-spin" />Preparing <b>{source.name}</b>...</span>
          <RunStatus match={j => j.purpose === `clone_source:${ctx.item.id}`} />
        </div>
      ) : (
        <div className="st-col" style={{ gap: 8 }}>
          {source?.status === 'failed' && <Callout tone="bad">{source.error}</Callout>}
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{choose(source?.status === 'failed' ? 'Choose another video' : 'Choose the video', 'primary')}</div>
          <ClipLink onAdd={link} />
        </div>
      )}
      {busy && <span className="st-hint">{busy}</span>}
    </div>
  )
}

// What the cleanup did, and "Use the cleaned clip" (on) to undo it.
function CleanupNote({ ctx, source }: { ctx: PostCtx; source: CloneSource }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const c = source.cleanup!
  const did = [c.endCardSec ? `TikTok's end card trimmed (${c.endCardSec} s)` : '', c.spots ? `${c.spots} text spot${c.spots === 1 ? '' : 's'} (captions, the handle) filled in` : ''].filter(Boolean).join(' · ')
  return (
    <label className="st-row" style={{ gap: 8, cursor: busy ? 'progress' : 'pointer', alignItems: 'flex-start' }}>
      <button type="button" role="switch" aria-checked={c.on} disabled={busy} className={`st-switch ${c.on ? 'on' : ''}`} onClick={async () => {
        setBusy(true)
        try { await api.cloneCleanup(ctx.item.id, !c.on); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
      }}><span /></button>
      <span className="st-col" style={{ gap: 0 }}><b>{busy ? 'Switching...' : 'Use the cleaned clip'}</b><span className="st-hint">{did}. Off uses the clip as uploaded.</span></span>
    </label>
  )
}

function CloneResults({ ctx, onUse, usedIds, batch }: { ctx: PostCtx; onUse: (clipId: string) => void; usedIds: string[]; batch: boolean }) {
  const clones = useClones(ctx.item.id)
  const list = clones.data?.clones ?? []
  if (!list.length) return null
  return (
    <div className="st-col" style={{ gap: 8 }}>
      <span className="st-label">Clones <span className="st-muted">(kept in Library &gt; Clips)</span></span>
      <div className="st-grid scenes">
        {list.map(c => <CloneTile key={c.id} ctx={ctx} c={c} onUse={onUse} used={usedIds.includes(c.id)} batch={batch} />)}
      </div>
    </div>
  )
}

function CloneTile({ ctx, c, onUse, used, batch }: { ctx: PostCtx; c: CloneResult; onUse: (clipId: string) => void; used: boolean; batch: boolean }) {
  const toast = useToast()
  const qc = useQueryClient()
  const nav = useNavigate()
  const mine = c.characterId === ctx.item.characterId
  const notes = c.findings.filter(f => f.severity !== 'info' || /original sound/.test(f.message)).slice(0, 3)
  const sound = c.findings.some(f => /original sound from the source clip is kept/.test(f.message))
  async function use(acknowledge = false): Promise<void> {
    try {
      await api.keepClone(c.id, acknowledge)
      qc.invalidateQueries({ queryKey: ['clones', ctx.item.id] })
      qc.invalidateQueries({ queryKey: ['library'] })
      onUse(c.id)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_required') toast({ tone: 'bad', text: 'The face in this clone does not match REF-00.', action: { label: 'Use it anyway', run: () => void use(true) } })
      else toast({ tone: 'bad', text: errorMessage(e) })
    }
  }
  async function post(acknowledge = false): Promise<void> {
    try {
      const { id } = await api.postFromClone(ctx.item.id, c.id, acknowledge)
      await qc.invalidateQueries({ queryKey: keys.content })
      toast({ tone: 'ok', text: `A video post for ${c.characterName} is ready at the Caption step.`, action: { label: 'Open it', run: () => nav(`/studio/posts/${id}`) } })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_required') toast({ tone: 'bad', text: 'The face in this clone does not match REF-00.', action: { label: 'Make it anyway', run: () => void post(true) } })
      else toast({ tone: 'bad', text: errorMessage(e) })
    }
  }
  const failed = c.status === 'failed' || c.status === 'qa_failed'
  return (
    <div className={`st-tile st-scene-tile ${used ? 'picked' : ''} ${isFresh(c.createdAt) ? 'st-new' : ''}`}>
      <div className="st-tile-open">
        {c.assetId
          ? <video className="st-clip" style={{ aspectRatio: '9 / 16' }} src={`${assetUrl(c.assetId)}#t=0.1`} controls playsInline preload="metadata" />
          : <div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}><AlertTriangle size={18} /></div>}
        {used && <span className="st-badge ok"><Check size={12} /></span>}
      </div>
      <div className="st-col" style={{ gap: 2, padding: '0 4px 2px' }}>
        <span className="st-tile-label">{c.characterName}{sound && <Volume2 size={12} style={{ marginLeft: 6, verticalAlign: -1 }} aria-label="Original sound" />}</span>
        <span className="st-hint">{[c.durationSec ? `${c.durationSec} s` : '', c.status === 'approved' ? 'Kept' : c.status === 'in_review' ? 'Check the face' : failed ? 'Not kept' : ''].filter(Boolean).join(' · ')}</span>
        {c.error && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>{c.error}</span>}
        {!c.error && notes.map((f, i) => <span key={i} className="st-hint" style={{ color: f.severity === 'fail' ? 'var(--st-bad)' : f.severity === 'warn' ? 'var(--st-warn)' : undefined }}>{f.message}</span>)}
      </div>
      {!failed && c.assetId && c.durationSec && <TrimClone ctx={ctx} c={c} />}
      {!failed && c.assetId && (
        <div className="st-tile-action">
          {mine
            ? used
              ? <span className="st-badge ok"><CheckCircle2 size={12} /> {batch ? 'In the batch' : 'In this post'}</span>
              : <AsyncButton className="st-btn sm primary" onClick={() => use()} icon={<CheckCircle2 size={14} />}>{batch ? 'Add to the batch' : 'Use this clip'}</AsyncButton>
            : <AsyncButton className="st-btn sm" onClick={() => post()} icon={<Film size={14} />}>Make a video post</AsyncButton>}
        </div>
      )}
    </div>
  )
}

// Trim before export (free, on the worker): a cut to a wide shot where the
// background people melt is cut off. A new clip is kept; the original stays.
function TrimClone({ ctx, c }: { ctx: PostCtx; c: CloneResult }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const total = c.durationSec ?? 0
  const [start, setStart] = useState('0')
  const [end, setEnd] = useState(String(total))
  const s = Number(start), e = Number(end)
  const bad = !(s >= 0 && e > s + 0.5 && e <= total + 0.05)
  async function trim() {
    try {
      await api.trimClone(c.id, s, e)
      toast({ tone: 'ok', text: `Trimming to ${s} to ${e} s. The trimmed clip shows here when it is ready; the original stays.` })
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      for (const ms of [4000, 9000, 16000]) window.setTimeout(() => void qc.invalidateQueries({ queryKey: ['clones', ctx.item.id] }), ms)
    } catch (err) { toast({ tone: 'bad', text: errorMessage(err) }) }
  }
  if (!open) return <div style={{ padding: '0 4px' }}><button type="button" className="st-btn xs ghost" onClick={() => setOpen(true)}><Scissors size={12} />Trim</button></div>
  return (
    <div className="st-col st-trim" style={{ gap: 6, padding: '0 4px' }}>
      <div className="st-row" style={{ gap: 6 }}>
        <label className="st-hint">From <input className="st-input sm" style={{ width: 64 }} inputMode="decimal" value={start} onChange={ev => setStart(ev.target.value.replace(/[^0-9.]/g, ''))} aria-label="Start, in seconds" /></label>
        <label className="st-hint">to <input className="st-input sm" style={{ width: 64 }} inputMode="decimal" value={end} onChange={ev => setEnd(ev.target.value.replace(/[^0-9.]/g, ''))} aria-label="End, in seconds" /> s</label>
      </div>
      <div className="st-row" style={{ gap: 6 }}>
        <AsyncButton className="st-btn xs primary" disabled={bad} onClick={trim} icon={<Scissors size={12} />}>Trim (free)</AsyncButton>
        <button type="button" className="st-btn xs ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {bad && <span className="st-hint">Keep at least half a second, inside {total} s.</span>}
      <RunStatus match={j => j.purpose === `clone_trim:${ctx.item.id}:${c.id}`} />
    </div>
  )
}
