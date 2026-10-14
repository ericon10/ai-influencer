import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Film, Loader2, Upload, Volume2 } from 'lucide-react'
import { api, ApiError, assetUrl } from '../../api'
import { keys, useClones, useCloneStills, useMe, useWorkerGate } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { RunStatus } from '../../runs'
import { AsyncButton, Callout, Field, errorMessage, isFresh, useToast, type TodoItem } from '../../ui'
import type { CloneMode, CloneModel, CloneResult, CloneSource, CloneStill, MemeSpec } from '../../types'
import { pickPerson } from '../../../../server/core/cloneTarget'
import type { PostCtx } from './ctx'
import { HowTo } from '../../guide/Guide'

// "Clone a TikTok or Reel" (SPEC 13.1 R1; UX-PLAN.md), inline in the Video
// step. Choose the saved video, then what to do with it (G28): "Replace the
// person (keep the scene)", the default, swaps only the person picked on the
// first frame (the largest unless you tap another) and keeps the clip's
// place, light, crowd and outfit. "Copy the moves into a new scene" first
// makes a scene still of the character in the clip's place, shown here
// before the run. The post's character is picked (add others for one quote
// with a line each); the model, with its price, and "Original sound" (off)
// are pre-filled. Each clone is checked for free and kept in Library >
// Clips; "Use this clip" puts it in the post.

const MODES: Array<{ id: CloneMode; label: string; line: string }> = [
  { id: 'replace', label: 'Replace the person (keep the scene)', line: "Only the person you pick changes. The clip's place, light, crowd and outfit stay." },
  { id: 'motion', label: 'Copy the moves into a new scene', line: "First a still of your character in the clip's place, then the moves copied onto it." },
]

export function ClonePanel({ ctx, onUse, usedIds, batch = false }: { ctx: PostCtx; onUse: (clipId: string) => void; usedIds: string[]; batch?: boolean }) {
  const { item } = ctx
  const source = ((item.spec as unknown as MemeSpec).clone ?? null) as CloneSource | null
  const me = useMe().data?.mode
  const ready = source?.status === 'ready' && !!source.assetId
  const options = useQuery({
    queryKey: ['clone-options', item.id, source?.durationSec ?? null, source?.target ?? null, me],
    queryFn: () => api.cloneOptions(item.id),
    staleTime: 10 * 60_000, retry: false,
  })
  const o = options.data
  const [mode, setMode] = useState<CloneMode | null>(null)
  useEffect(() => { if (o && !mode) setMode(o.mode) }, [o, mode])
  const m = mode ?? 'replace'
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

  const needStill = m === 'motion' ? characterIds.filter(id => !kept[id]) : []
  const todo: TodoItem[] = [
    ...(!ready ? [{ label: 'Choose the TikTok or Reel', target: 'clone-source' }] : []),
    ...(!characterIds.length ? [{ label: 'Pick a character', target: 'clone-characters' }] : []),
    ...(ready && needStill.length ? [{ label: `Make the scene still${needStill.length > 1 ? 's' : ''} first`, target: 'clone-still' }] : []),
  ]
  const others = ctx.characters.filter(c => c.id !== item.characterId)
  const shown = o?.models.filter(x => x.mode === m) ?? []

  return (
    <div className="st-col st-clone" style={{ gap: 16 }}>
      <div className="st-row" style={{ gap: 10 }}><span className="st-hint" style={{ flex: 1, minWidth: 200 }}>Your character in a saved TikTok or Reel, with the same moves and camera.</span><HowTo id="post-clone" label="How cloning works" /></div>
      <Field id="clone-source" label="The TikTok or Reel" required done={ready} group hint={`Save it from TikTok or Instagram, then choose the file. ${o?.minSeconds ?? 3} to ${o?.maxSeconds ?? 30} s; a longer one is cut to ${o?.maxSeconds ?? 30} s.`}>
        <SourceBox ctx={ctx} source={source} maxMb={o?.maxUploadMb ?? 200} />
      </Field>

      <Field id="clone-mode" label="What to do" group>
        <div className="st-videomodels" role="radiogroup" aria-label="What to do">
          {MODES.map(x => (
            <button key={x.id} type="button" role="radio" aria-checked={m === x.id} className={`st-choice ${m === x.id ? 'on' : ''}`} onClick={() => setMode(x.id)}>
              <span className="st-row" style={{ gap: 8 }}><b>{x.label}</b><span className="st-spacer" />{m === x.id && <Check size={14} />}</span>
              <span className="st-hint">{x.line}</span>
            </button>
          ))}
        </div>
      </Field>

      {ready && (
        <Field id="clone-target" label="Who to replace" group hint="Only this person changes. Tap someone else on the frame to replace them instead.">
          <FramePick ctx={ctx} source={source!} words={o?.target ?? null} />
        </Field>
      )}

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

      {m === 'motion' && ready && (
        <Field id="clone-still" label="Scene still" required done={!needStill.length} group hint={`${name} in the clip's place, made from its first frame. The moves are copied onto this still, never onto a bare sheet image.`}>
          <SceneStills ctx={ctx} characterIds={characterIds} outfit={wear} look={looks[item.characterId ?? ''] ?? null} list={stills.data?.stills ?? []} kept={kept} />
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
                  <span className="st-hint">{x.path === 'account' ? 'Your Higgsfield plan' : 'Higgsfield API'}{x.resolution ? ` · ${x.resolution}` : ''}</span>
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
        action={{ type: 'clone', contentId: item.id, characterIds, mode: m, ...(picked ? { model: picked.ref } : {}), outfit: wear, looks, keepSound }}
        watch={j => j.purpose.startsWith(`clone:${item.id}:`)}
      />

      <CloneResults ctx={ctx} onUse={onUse} usedIds={usedIds} batch={batch} />
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
        <img src={assetUrl(source.firstFrameId)} alt="The first frame of the clip" />
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
// still the moves are copied onto (Copy the moves).
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
              {source.firstFrameId ? <img src={assetUrl(source.firstFrameId)} alt="The clip's first frame" /> : <div className="st-skel" style={{ width: 90, aspectRatio: '9 / 16' }} />}
              {chosen != null && people[chosen] && <span className="st-framepick-ring on" style={{ left: `${people[chosen]!.x * 100}%`, top: `${people[chosen]!.y * 100}%`, width: `${people[chosen]!.w * 100}%`, height: `${people[chosen]!.h * 100}%` }} />}
            </div>
            <ArrowRight size={16} aria-hidden />
            {refs.map(a => <img key={a} className="st-clonepreview-ref" src={assetUrl(a)} alt="Face reference" />)}
          </>
        ) : stillAsset ? (
          <>
            <img className="st-clonepreview-still" src={assetUrl(stillAsset)} alt="The scene still" />
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

// "Copy the moves": per character, the kept scene still (or a button to
// make it), and the other stills with "Use this still".
function SceneStills({ ctx, characterIds, outfit, look, list, kept }: { ctx: PostCtx; characterIds: string[]; outfit: 'source' | 'hers'; look: string | null; list: CloneStill[]; kept: Record<string, string> }) {
  const toast = useToast()
  const qc = useQueryClient()
  async function use(id: string) {
    try {
      await api.useCloneStill(ctx.item.id, id)
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['clone-stills', ctx.item.id] })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-col" style={{ gap: 14 }}>
      {characterIds.map(cid => {
        const c = ctx.characters.find(x => x.id === cid)
        const mine = list.filter(x => x.characterId === cid)
        return (
          <div key={cid} className="st-col" style={{ gap: 8 }}>
            {characterIds.length > 1 && <b>{c?.name}</b>}
            {mine.length > 0 && (
              <div className="st-grid scenes">
                {mine.map(x => (
                  <div key={x.id} className={`st-tile st-scene-tile ${kept[cid] === x.id ? 'picked' : ''} ${isFresh(x.createdAt) ? 'st-new' : ''}`}>
                    <div className="st-tile-open">
                      {x.assetId ? <img className="st-clip" style={{ aspectRatio: '9 / 16', objectFit: 'cover' }} src={assetUrl(x.assetId)} alt={`Scene still of ${x.characterName}`} /> : <div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}><AlertTriangle size={18} /></div>}
                      {kept[cid] === x.id && <span className="st-badge ok"><Check size={12} /></span>}
                    </div>
                    {x.error && <span className="st-hint" style={{ color: 'var(--st-bad)', padding: '0 4px' }}>{x.error}</span>}
                    {!x.error && x.findings.filter(f => f.severity !== 'info').slice(0, 2).map((f, i) => <span key={i} className="st-hint" style={{ color: f.severity === 'fail' ? 'var(--st-bad)' : 'var(--st-warn)', padding: '0 4px' }}>{f.message}</span>)}
                    {x.assetId && !x.error && (
                      <div className="st-tile-action">
                        {kept[cid] === x.id ? <span className="st-badge ok"><CheckCircle2 size={12} /> Used for the run</span> : <AsyncButton className="st-btn sm" onClick={() => use(x.id)} icon={<CheckCircle2 size={14} />}>Use this still</AsyncButton>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <PriceButton
              label={mine.length ? `Make another scene still${characterIds.length > 1 ? ` for ${c?.name}` : ''}` : `Make the scene still${characterIds.length > 1 ? ` for ${c?.name}` : ''}`}
              action={{ type: 'clone_still', contentId: ctx.item.id, characterId: cid, outfit, ...(look && cid === ctx.item.characterId ? { look } : {}) }}
              watch={j => j.purpose === `clone_still:${ctx.item.id}:${cid}`}
            />
          </div>
        )
      })}
    </div>
  )
}

// The saved video: choose it, see it prepared (with its live status), play it.
function SourceBox({ ctx, source, maxMb }: { ctx: PostCtx; source: CloneSource | null; maxMb: number }) {
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
            {choose('Use a different video', 'sm ghost')}
          </div>
        </div>
      ) : source?.status === 'preparing' ? (
        <div className="st-col" style={{ gap: 6 }}>
          <span className="st-row" style={{ gap: 8 }}><Loader2 size={14} className="st-spin" />Preparing <b>{source.name}</b>...</span>
          <RunStatus match={j => j.purpose === `clone_source:${ctx.item.id}`} />
        </div>
      ) : (
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {source?.status === 'failed' && <Callout tone="bad">{source.error}</Callout>}
          {choose(source?.status === 'failed' ? 'Choose another video' : 'Choose the video', 'primary')}
        </div>
      )}
      {busy && <span className="st-hint">{busy}</span>}
    </div>
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
