import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, CheckCircle2, Film, Loader2, Upload, Volume2 } from 'lucide-react'
import { api, ApiError, assetUrl } from '../../api'
import { keys, useClones, useMe, useWorkerGate } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { RunStatus } from '../../runs'
import { AsyncButton, Callout, Field, errorMessage, isFresh, useToast, type TodoItem } from '../../ui'
import type { CloneModel, CloneResult, CloneSource, MemeSpec } from '../../types'
import type { PostCtx } from './ctx'
import { HowTo } from '../../guide/Guide'

// "Clone a TikTok or Reel" (SPEC 13.1 R1; UX-PLAN.md), inline in the Video
// step. Choose the saved video; the post's character is picked (add others
// for one quote with a line each); the model, with its price, and "Original
// sound" (off) are pre-filled. Each clone is checked for free and kept in
// Library > Clips; "Use this clip" puts it in the post.

const PLACE: Record<string, string> = { video: "Keeps the clip's place", image: 'Place from the character image', both: 'Place from the clip or the image' }
const placeOf = (m: CloneModel) => (m.background.length > 1 ? PLACE.both : PLACE[m.background[0]!])

export function ClonePanel({ ctx, onUse, usedIds, batch = false }: { ctx: PostCtx; onUse: (clipId: string) => void; usedIds: string[]; batch?: boolean }) {
  const { item } = ctx
  const source = ((item.spec as unknown as MemeSpec).clone ?? null) as CloneSource | null
  const mode = useMe().data?.mode
  const ready = source?.status === 'ready' && !!source.assetId
  const options = useQuery({
    queryKey: ['clone-options', item.id, source?.durationSec ?? null, mode],
    queryFn: () => api.cloneOptions(item.id),
    staleTime: 10 * 60_000, retry: false,
  })
  const o = options.data
  const [model, setModel] = useState<string | null>(null)
  useEffect(() => { if (o && !model) setModel(o.model) }, [o, model])
  const picked = o?.models.find(m => m.ref === model) ?? null
  const [characterIds, setCharacterIds] = useState<string[]>(item.characterId ? [item.characterId] : [])
  const [background, setBackground] = useState<'video' | 'image'>('video')
  const [keepSound, setKeepSound] = useState(false)
  useEffect(() => { if (o) setKeepSound(o.keepSound) }, [o?.keepSound]) // eslint-disable-line react-hooks/exhaustive-deps
  // The post's still is the look when the place comes from the image.
  const stillId = (ctx.draft.spec as { stillId?: string | null }).stillId ?? null
  const place = picked ? (picked.background.length > 1 ? background : picked.background[0]!) : 'video'
  const [useStill, setUseStill] = useState<boolean | null>(null)
  const lookFromStill = !!stillId && (useStill ?? place === 'image')
  const fits = (m: CloneModel) => !source?.durationSec || (source.durationSec >= m.minSec - 0.05 && source.durationSec <= m.maxSec + 0.05)

  function pick(ref: string) {
    setModel(ref)
    api.setCloneModel(ref).catch(() => undefined)
  }
  function toggle(id: string) {
    setCharacterIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(0, o?.maxCharacters ?? 5)))
  }

  const todo: TodoItem[] = [
    ...(!ready ? [{ label: 'Choose the TikTok or Reel', target: 'clone-source' }] : []),
    ...(!characterIds.length ? [{ label: 'Pick a character', target: 'clone-characters' }] : []),
  ]
  const others = ctx.characters.filter(c => c.id !== item.characterId)

  return (
    <div className="st-col st-clone" style={{ gap: 16 }}>
      <div className="st-row" style={{ gap: 10 }}><span className="st-hint" style={{ flex: 1, minWidth: 200 }}>Same motion and camera as the saved video, with your character in it.</span><HowTo id="post-clone" label="How cloning works" /></div>
      <Field id="clone-source" label="The TikTok or Reel" required done={ready} group hint={`Save it from TikTok or Instagram, then choose the file. ${o?.minSeconds ?? 3} to ${o?.maxSeconds ?? 30} s; a longer one is cut to ${o?.maxSeconds ?? 30} s.`}>
        <SourceBox ctx={ctx} source={source} maxMb={o?.maxUploadMb ?? 200} />
      </Field>

      <Field id="clone-characters" label={`Who is in it${characterIds.length > 1 ? ` (${characterIds.length})` : ''}`} required done={characterIds.length > 0} group hint="Same motion and camera, rebuilt with each character. One price with a line each.">
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
        {stillId && characterIds.includes(item.characterId ?? '') && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <span className="st-hint">{ctx.v?.data.name ?? 'The character'}'s look from:</span>
            <button type="button" className={`st-chip ${!lookFromStill ? 'on' : ''}`} onClick={() => setUseStill(false)}>Face sheet (REF-00)</button>
            <button type="button" className={`st-chip ${lookFromStill ? 'on' : ''}`} onClick={() => setUseStill(true)}>This post's still</button>
          </div>
        )}
      </Field>

      <Field id="clone-model" label="Clone model" group hint={mode === 'demo' ? 'Demo mode runs a free mock for every model.' : `Price for one character${source?.durationSec ? ` and this ${source.durationSec} s clip` : ''}. Your pick is remembered.`}>
        {!o ? <div className="st-skel" style={{ height: 96, borderRadius: 14 }} /> : (
          <div className="st-videomodels" role="radiogroup" aria-label="Clone model">
            {o.models.map(m => {
              const on = m.ref === picked?.ref
              const ok = fits(m)
              return (
                <button key={m.ref} type="button" role="radio" aria-checked={on} className={`st-choice ${on ? 'on' : ''}`} onClick={() => pick(m.ref)} disabled={!ok} title={m.note || undefined}>
                  <span className="st-row" style={{ gap: 8 }}><b>{m.label}</b><span className="st-spacer" />{on && <Check size={14} />}</span>
                  <span className="st-model-price">{m.display ?? 'No price yet'}{m.display && !m.verified ? <span className="st-muted" style={{ fontWeight: 400 }}> (not confirmed)</span> : null}</span>
                  <span className="st-hint">{m.path === 'account' ? 'Your Higgsfield plan' : 'Higgsfield API'}{m.resolution ? ` · ${m.resolution}` : ''} · {placeOf(m)}</span>
                  {!ok && <span className="st-hint" style={{ color: 'var(--st-warn)' }}>Takes {m.minSec} to {m.maxSec} s clips</span>}
                  {ok && m.problem && <span className="st-hint" style={{ color: 'var(--st-warn)' }}>{m.problem}</span>}
                </button>
              )
            })}
          </div>
        )}
      </Field>

      <div className="st-row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {picked && picked.background.length > 1 && (
          <Field label="Where it happens" group>
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className={`st-chip ${background === 'video' ? 'on' : ''}`} onClick={() => setBackground('video')}>The clip's place</button>
              <button type="button" className={`st-chip ${background === 'image' ? 'on' : ''}`} onClick={() => setBackground('image')}>The character image's place</button>
            </div>
          </Field>
        )}
        <label className="st-row" style={{ gap: 10, cursor: 'pointer' }}>
          <button type="button" role="switch" aria-checked={keepSound} className={`st-switch ${keepSound ? 'on' : ''}`} disabled={ready && !source!.hasAudio} onClick={() => setKeepSound(k => !k)}><span /></button>
          <span className="st-col" style={{ gap: 0 }}><b>Original sound</b><span className="st-hint">{ready && !source!.hasAudio ? 'This clip has no sound.' : keepSound ? "On: the clip's own sound goes back on the clone (free)." : 'Off: a silent clone, like every video.'}</span></span>
        </label>
      </div>

      <PriceButton
        label={characterIds.length > 1 ? `Clone it for ${characterIds.length} characters` : 'Clone it'}
        todo={todo}
        action={{
          type: 'clone', contentId: item.id, characterIds, ...(picked ? { model: picked.ref } : {}),
          ...(picked && picked.background.length > 1 ? { background } : {}),
          looks: lookFromStill && item.characterId && stillId ? { [item.characterId]: stillId } : {}, keepSound,
        }}
        watch={j => j.purpose.startsWith(`clone:${item.id}:`)}
      />

      <CloneResults ctx={ctx} onUse={onUse} usedIds={usedIds} batch={batch} />
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
