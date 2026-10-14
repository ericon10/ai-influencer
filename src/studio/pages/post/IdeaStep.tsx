import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Plus, SlidersHorizontal, X } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Field, Img, errorMessage, scrollToField, useToast } from '../../ui'
import { jobDone, noDash, remember, useJobResult } from './parts'
import { MORE_EVENT, moreKey, type PostCtx } from './ctx'
import { EditStylePicker } from './EditStyles'
import { ImportCard } from './ImportCard'
import { SceneDetails } from '../character/SceneStills'
import { looksLikePrompt, readShot } from '../../../../server/core/shotParse'
import type { CloneSource, SceneView, ScenesData } from '../../types'
import { SourceBox } from './ClonePanel'
import { HowTo } from '../../guide/Guide'

// Step 1 (UX-PLAN.md section 15): one box by default. "Describe the shot or
// paste a prompt"; what the words already say (camera, framing, outfit,
// makeup, place, light) shows as chips, read for free and editable; a
// pasted prompt can go as written. Everything else (character, account,
// format, places and the scene details) is under More control, collapsed.

const IDEA: Record<string, { label: string; placeholder: string }> = {
  meme: { label: 'Describe the shot or paste a prompt', placeholder: 'e.g. Front-camera selfie in a black tank at a packed rave, phone a little above her' },
  slideshow: { label: 'What is the slideshow about?', placeholder: 'e.g. 5 apps that saved my semester' },
  batch: { label: 'What are the captions about?', placeholder: 'e.g. studying with AI the night before an exam' },
}

export function ideaSummary(ctx: PostCtx) {
  const name = ctx.characters.find(c => c.id === ctx.item.characterId)?.name ?? 'No character'
  return [ctx.item.accountTag || 'No account tag', name, ctx.item.idea.trim() ? `"${ctx.item.idea.trim().slice(0, 90)}"` : 'No idea written'].join(' · ')
}

export function IdeaStep({ ctx }: { ctx: PostCtx }) {
  const { item, data, draft, characters, v, scene, scenes } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const [switching, setSwitching] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ideasJob, setIdeasJob] = useState<string | null>(null)
  const idea = draft.fields.idea
  // The rough idea the price is for, settled while typing.
  const [rough, setRough] = useState(idea.trim())
  useEffect(() => { const t = setTimeout(() => setRough(idea.trim()), 500); return () => clearTimeout(t) }, [idea])
  const copy = IDEA[item.kind]!
  const tags = data.accountTags.filter(t => t !== draft.fields.accountTag.trim())
  const spec = draft.spec as { clipId?: string | null; stillId?: string | null; stillIds?: string[]; clipIds?: string[] }
  // Switching drops this character's own stills, clips and scene.
  const hasPicks = !!(item.sceneId || spec.clipId || spec.stillId || spec.stillIds?.length || spec.clipIds?.length)
  const meme = item.kind === 'meme'
  // The two ways in for a video post (owner, 2026-10-14).
  const start = (draft.spec as { start?: 'describe' | 'clip' }).start ?? 'describe'

  // More control: collapsed by default, remembered per post; other steps
  // open it ("Change in the Idea step").
  const [more, setMore] = useState(() => { try { return localStorage.getItem(moreKey(item.id)) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(moreKey(item.id), more ? '1' : '0') } catch { /* private window */ } }, [more, item.id])
  useEffect(() => {
    const on = () => setMore(true)
    window.addEventListener(MORE_EVENT, on)
    return () => window.removeEventListener(MORE_EVENT, on)
  }, [])
  function openMore(field = 'post-more') { setMore(true); window.setTimeout(() => scrollToField(field), 80) }

  async function switchTo(id: string) {
    setBusy(true)
    try {
      await draft.flush()
      await api.updateContent(item.id, { characterId: id })
      remember('character', id)
      await qc.invalidateQueries({ queryKey: keys.content })
      setSwitching(null)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  function pick(id: string) {
    if (id === item.characterId) return
    if (hasPicks) setSwitching(id)
    else void switchTo(id)
  }
  const target = characters.find(c => c.id === switching)
  const current = characters.find(c => c.id === item.characterId)
  const ready = !!v?.sheet.shots[0]?.approved
  const personaIdeas = meme ? (((v?.data.persona as { settings?: string[] } | undefined)?.settings) ?? []).slice(0, 6) : []

  // The post's scene is made from the words (free) once there are some, so
  // the chips can be changed and the details live here.
  const making = useRef(false)
  const savedIdea = item.idea.trim()
  useEffect(() => {
    if (!meme || item.sceneId || !ready || savedIdea.length < 3 || making.current) return
    making.current = true
    api.postScene(item.id)
      .then(() => { qc.invalidateQueries({ queryKey: keys.content }); if (item.characterId) qc.invalidateQueries({ queryKey: keys.scenes(item.characterId) }) })
      .catch(e => toast({ tone: 'bad', text: errorMessage(e) }))
      .finally(() => { making.current = false })
  }, [item.sceneId, item.id, ready, savedIdea]) // eslint-disable-line react-hooks/exhaustive-deps

  const characterChips = (
    <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {characters.map(c => (
        <button key={c.id} type="button" className={`st-charchip ${c.id === item.characterId ? 'on' : ''}`} onClick={() => pick(c.id)} disabled={busy} aria-pressed={c.id === item.characterId}>
          <Img assetId={c.portraitAssetId} width={80} />
          <span>{c.name}</span>
          {c.id === item.characterId && <Check size={13} />}
        </button>
      ))}
      <Link to="/studio/characters" className="st-btn sm ghost">Set up a new character</Link>
    </div>
  )

  return (
    <div className="st-col" style={{ gap: 16 }}>
      {current ? (
        <div className="st-row st-forline" style={{ gap: 8 }}>
          <Img assetId={current.portraitAssetId} width={64} className="st-forline-img" />
          <span>For <b>{current.name}</b>{item.accountTag ? <span className="st-muted"> · {item.accountTag}</span> : null}</span>
          <button type="button" className="st-btn xs ghost" onClick={() => openMore('post-character')}>Change</button>
        </div>
      ) : (
        <Field id="post-character" label="Character" required done={false} group>{characterChips}</Field>
      )}
      {target && (
        <Callout tone="warn" icon={<AlertTriangle size={16} />}>
          Switching to {target.name} drops the stills and clips picked for {current?.name ?? 'this character'} in this post. The idea, the text and the B-roll stay.
          <div className="st-row" style={{ gap: 8, marginTop: 8 }}>
            <button className="st-btn sm" disabled={busy} onClick={() => void switchTo(target.id)}>{busy ? <Loader2 size={13} className="st-spin" /> : null}Switch to {target.name}</button>
            <button className="st-btn sm ghost" onClick={() => setSwitching(null)}>Cancel</button>
          </div>
        </Callout>
      )}
      {v && !ready && item.kind !== 'batch' && (
        <Callout tone="info">New stills of {v.data.name} need {v.data.pronouns.poss} face and reference sheet first. <Link to={`/studio/characters/${v.id}`}>Set up {v.data.name}</Link>, or use stills and clips already in the Library.</Callout>
      )}

      {meme && (
        <div className="st-startchoice" role="radiogroup" aria-label="How to start" data-field="post-start">
          <button type="button" role="radio" aria-checked={start === 'describe'} className={`st-choice ${start === 'describe' ? 'on' : ''}`} onClick={() => draft.setSpec({ start: 'describe' })}>
            <span className="st-row" style={{ gap: 8 }}><b>Describe it</b><span className="st-spacer" />{start === 'describe' && <Check size={14} />}</span>
            <span className="st-hint">Write the shot or paste a prompt. Stills first, then the video.</span>
          </button>
          <button type="button" role="radio" aria-checked={start === 'clip'} className={`st-choice ${start === 'clip' ? 'on' : ''}`} onClick={() => draft.setSpec({ start: 'clip' })}>
            <span className="st-row" style={{ gap: 8 }}><b>Start from a real clip</b><span className="st-spacer" />{start === 'clip' && <Check size={14} />}</span>
            <span className="st-hint">Recreate a saved TikTok or Reel with {current?.name ?? 'your character'}: its real motion and light. Best for clubs, dark venues and real dancing.</span>
          </button>
        </div>
      )}

      {meme && start === 'clip' ? <StartFromClip ctx={ctx} /> : (<>
      <Field id="post-idea" label={copy.label} hint={meme ? 'In your own words, or a whole prompt. Nothing you write is rewritten: what it says about the camera, outfit and light is kept.' : 'In your own words. It feeds the slides or the captions; change it any time.'}>
        <textarea className="st-textarea" rows={meme ? 4 : 3} maxLength={2000} value={idea} onChange={e => draft.setFields({ idea: e.target.value })} placeholder={copy.placeholder} />
      </Field>

      {meme && <ShotChips ctx={ctx} idea={idea} scene={scene} data={scenes} />}

      {meme && (
        <div className="st-col" style={{ gap: 8 }}>
          <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {rough.length >= 3 && item.characterId
              ? <PriceButton action={{ type: 'scene_ideas', characterId: item.characterId, idea: rough }} label="Punch it up" variant="secondary" size="sm" onStarted={ids => setIdeasJob(ids[0] ?? null)} />
              : null}
            <span className="st-hint">{rough.length >= 3 ? 'Turns a rough idea into 3 specific moments. What your words already say stays.' : 'Write a rough idea; Punch it up turns it into 3 specific moments.'}</span>
          </div>
          {ideasJob && <IdeaOptions jobId={ideasJob} current={idea} onPick={text => draft.setFields({ idea: text })} onClose={() => setIdeasJob(null)} />}
        </div>
      )}
      </>)}

      {item.kind === 'batch' && <ImportCard ctx={ctx} />}

      <section className="st-card st-more" data-field="post-more">
        <button type="button" className="st-card-head st-row st-more-head" onClick={() => setMore(m => !m)} aria-expanded={more}>
          {more ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <SlidersHorizontal size={15} />
          <div className="grow" style={{ textAlign: 'left' }}>
            <div className="st-h3">More control</div>
            <div className="st-hint">{meme ? 'Character, account, format, places and every detail of the shot. All optional.' : 'Character, account and format. All optional.'}</div>
          </div>
        </button>
        {more && (
          <div className="st-card-body st-col" style={{ gap: 18 }}>
            <Field id="post-character" label="Character" group>{characterChips}</Field>
            <Field id="post-account" label="Account" hint="Where this goes, for example a TikTok account. The Posts page filters by it. Optional.">
              <input className="st-input" style={{ maxWidth: 320 }} list="post-account-tags" maxLength={60} value={draft.fields.accountTag} onChange={e => { draft.setFields({ accountTag: e.target.value }); remember('tag', e.target.value.trim()) }} placeholder="e.g. Callie TikTok" />
              <datalist id="post-account-tags">{data.accountTags.map(t => <option key={t} value={t} />)}</datalist>
            </Field>
            {tags.length > 0 && (
              <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: -10 }}>
                {tags.slice(0, 8).map(t => <button key={t} type="button" className="st-chip" onClick={() => { draft.setFields({ accountTag: t }); remember('tag', t) }}>{t}</button>)}
              </div>
            )}
            {personaIdeas.length > 0 && (
              <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="st-hint">Places:</span>
                {personaIdeas.map(i => <button key={i} type="button" className="st-chip" onClick={() => draft.setFields({ idea: idea.trim() ? `${idea.trim()}, ${i}` : `${v?.data.name ?? ''} at ${i}`.trim() })}>{i}</button>)}
              </div>
            )}
            {item.kind !== 'slideshow' && (
              <Field id="post-format" label="Format (optional)" group hint="An edit made by code, free. A two-shot format plans shot A and shot B in the Video step. Change it any time in the Finish step.">
                <EditStylePicker ctx={ctx} mode="format" />
              </Field>
            )}
            {meme && v && scenes && scene && <SceneDetails v={v} data={scenes} scene={scene} />}
            {meme && !scene && <span className="st-hint">The shot's details (outfit, camera, light and the rest) show here once there are words in the box{ready ? '' : ` and ${v?.data.name ?? 'the character'} has a face and sheet`}.</span>}
          </div>
        )}
      </section>
    </div>
  )
}

// "Start from a real clip": the clip (upload, a link or a Higgsfield media
// ID), then the post opens at Recreate in the Video step.
function StartFromClip({ ctx }: { ctx: PostCtx }) {
  const source = ((ctx.item.spec as { clone?: CloneSource | null }).clone ?? null)
  const had = useRef(!!source)
  useEffect(() => {
    // Once a clip is chosen here, the post moves on to Recreate.
    if (source && !had.current) { had.current = true; void ctx.draft.go('video', { spec: { start: 'clip' } }) }
  }, [source]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field id="post-clip" label="The real clip" required done={source?.status === 'ready'} group hint="Save it from TikTok or Instagram and choose the file, or paste a video link or a Higgsfield media ID. 3 to 30 s.">
      <span className="st-row" style={{ gap: 8 }}><span className="st-hint grow">Then: what to keep, 4 stills, the face checks, the motion model, the review.</span><HowTo id="post-clone" label="How Recreate works" /></span>
      <SourceBox ctx={ctx} source={source} maxMb={200} />
      {source && <button type="button" className="st-btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => void ctx.draft.go('video', { spec: { start: 'clip' } })}>Open Recreate<ChevronRight size={14} /></button>}
    </Field>
  )
}

// ── What the words say ────────────────────────────────────────────────

type ChipKey = 'camera' | 'phone' | 'framing' | 'outfit' | 'makeup' | 'location' | 'light'
const ORDER: ChipKey[] = ['camera', 'phone', 'framing', 'outfit', 'makeup', 'location', 'light']
const CHIP_LABEL: Record<ChipKey, string> = { camera: 'Camera', phone: 'Phone camera', framing: 'Framing', outfit: 'Outfit', makeup: 'Makeup', location: 'Place', light: 'Light' }
const TEXT_KEYS = new Set<ChipKey>(['outfit', 'location'])

function readFields(text: string): Partial<Record<ChipKey, string>> {
  const r = readShot(text)
  return { camera: r.camera, phone: r.phone, framing: r.framing, outfit: r.outfit, makeup: r.makeup, location: r.place, light: r.ownLight ? 'as_written' : undefined }
}

function choices(k: ChipKey, data: ScenesData | undefined): Array<{ id: string; label: string }> | null {
  if (!data) return null
  const o = data.options
  if (k === 'camera') return o.cameras
  if (k === 'framing') return o.framings
  if (k === 'makeup') return o.makeup
  if (k === 'light') return o.lights
  if (k === 'phone') return [{ id: 'front', label: 'Front camera (selfie)' }, { id: 'rear', label: 'Rear camera' }]
  return null
}

function shown(k: ChipKey, value: string, data: ScenesData | undefined): string {
  const list = choices(k, data)
  if (k === 'phone') return value === 'front' ? 'Front camera' : value === 'rear' ? 'Rear camera' : value
  if (k === 'light' && value === 'as_written') return 'From your words'
  return list?.find(x => x.id === value)?.label ?? value
}

// The chips: read from the words for free as they are typed; one the owner
// sets wins (marked "you set"); the x takes the owner's value away.
function ShotChips({ ctx, idea, scene, data }: { ctx: PostCtx; idea: string; scene: SceneView | undefined; data: ScenesData | undefined }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<ChipKey | null>(null)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const read = readFields(idea)
  const ownerSet = new Set(scene?.words.ownerSet ?? [])
  const valueOf = (k: ChipKey): string | undefined => (ownerSet.has(k) ? String((scene?.fields as Record<string, unknown> | undefined)?.[k] ?? '') || undefined : read[k])
  const present = ORDER.filter(k => valueOf(k))
  const addable = ORDER.filter(k => !valueOf(k))
  const pasted = looksLikePrompt(idea)
  const asWritten = scene && ownerSet.has('asWritten') ? !!scene.fields.asWritten : pasted
  const canEdit = !!scene

  async function save(patch: Record<string, unknown>) {
    if (!scene) return
    setSaving(true)
    try {
      await api.updateScene(scene.id, { fields: patch })
      if (ctx.item.characterId) await qc.invalidateQueries({ queryKey: keys.scenes(ctx.item.characterId) })
      qc.invalidateQueries({ queryKey: ['estimate'] })
      setEditing(null)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setSaving(false) }
  }
  function edit(k: ChipKey) {
    if (!canEdit) return
    setEditing(k)
    setValue(valueOf(k) ?? choices(k, data)?.[0]?.id ?? '')
  }
  if (!idea.trim() && !present.length) return null
  const list = editing ? choices(editing, data) : null

  return (
    <div className="st-col st-shotchips" style={{ gap: 8 }} data-field="post-chips">
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="st-hint">{present.length ? 'Read from your words:' : 'Nothing about the camera, outfit or light yet; the defaults fill in.'}</span>
        {present.map(k => {
          const mine = ownerSet.has(k)
          return (
            <span key={k} className={`st-chip st-shotchip ${mine ? 'on' : ''} ${editing === k ? 'editing' : ''}`}>
              <button type="button" className="st-shotchip-main" onClick={() => edit(k)} disabled={!canEdit} title={canEdit ? `Change the ${CHIP_LABEL[k].toLowerCase()}` : 'Changeable once the character has a face and sheet'}>
                <span className="st-muted">{CHIP_LABEL[k]}:</span> {shown(k, valueOf(k)!, data)}{mine && <span className="st-muted"> (you set)</span>}
              </button>
              {mine && <button type="button" className="st-shotchip-x" aria-label={`Back to what your words say for ${CHIP_LABEL[k]}`} title="Back to what your words say" onClick={() => void save({ [k]: null })}><X size={11} /></button>}
            </span>
          )
        })}
        {canEdit && addable.length > 0 && (
          <select className="st-select sm st-shotchip-add" value="" onChange={e => e.target.value && edit(e.target.value as ChipKey)} aria-label="Set another detail">
            <option value="">+ Set a detail</option>
            {addable.map(k => <option key={k} value={k}>{CHIP_LABEL[k]}</option>)}
          </select>
        )}
      </div>
      {editing && (
        <div className="st-row st-chipedit" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="st-label">{CHIP_LABEL[editing]}</span>
          {list ? (
            <select className="st-select" value={value} onChange={e => setValue(e.target.value)} autoFocus>
              {list.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          ) : (
            <input className="st-input" style={{ minWidth: 240 }} value={value} onChange={e => setValue(e.target.value)} autoFocus placeholder={editing === 'outfit' ? 'e.g. a black tank and cargo pants' : 'e.g. a packed rave'} onKeyDown={e => { if (e.key === 'Enter' && value.trim()) void save({ [editing]: value.trim() }) }} />
          )}
          <button className="st-btn sm primary" disabled={saving || (TEXT_KEYS.has(editing) && !value.trim())} onClick={() => void save({ [editing]: TEXT_KEYS.has(editing) ? value.trim() : value })}>{saving ? <Loader2 size={13} className="st-spin" /> : <Check size={13} />}Use this</button>
          <button className="st-btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      )}
      {(pasted || asWritten) && (
        <label className="st-row" style={{ gap: 10, cursor: canEdit ? 'pointer' : 'default', alignItems: 'flex-start' }}>
          <button type="button" role="switch" aria-checked={asWritten} className={`st-switch ${asWritten ? 'on' : ''}`} disabled={!canEdit || saving} onClick={() => void save({ asWritten: !asWritten })}><span /></button>
          <span className="st-col" style={{ gap: 2 }}>
            <b>Send my prompt as written</b>
            <span className="st-hint">{asWritten ? 'On: your text goes unchanged. The Studio adds only the reference line, the 21+ line and the REALISM block; no writer, no camera, light or outfit lines.' : 'Off: the prompt writer turns your words into the prompt, keeping what they say.'}</span>
          </span>
        </label>
      )}
      {!canEdit && present.length > 0 && <span className="st-hint"><Plus size={11} style={{ verticalAlign: -1 }} /> These are used as soon as the post's stills can be made.</span>}
    </div>
  )
}

interface Idea { moment: string; shooter: string; place: string; detail: string; other_person: string }

// The option as the idea: the moment, and who takes it when the moment does
// not say (a selfie stays a selfie, a friend's photo says so).
function optionText(o: Idea): string {
  const text = noDash(o.moment).trim()
  const shooter = noDash(o.shooter).trim().replace(/[.\s]+$/, '')
  if (!shooter || readShot(text).camera) return text
  return `${text.replace(/[.\s]*$/, '.')} Taken by ${shooter.charAt(0).toLowerCase()}${shooter.slice(1)}.`
}

// The three options from "Punch it up". Picking one fills the idea; it stays
// editable, and another option can still be picked.
function IdeaOptions({ jobId, current, onPick, onClose }: { jobId: string; current: string; onPick: (text: string) => void; onClose: () => void }) {
  const q = useJobResult(jobId)
  const status = q.data?.job.status
  const options = ((q.data?.result as { options?: Idea[] } | null)?.options ?? []).slice(0, 3)
  if (!jobDone(status)) return <div className="st-row st-hint" style={{ gap: 8 }}><Loader2 size={14} className="st-spin" />Writing 3 specific moments...</div>
  if (status !== 'completed' || !options.length) {
    return <div className="st-price-error" role="alert"><span className="msg">{q.data?.job.error?.message ?? 'No options came back.'} Press Punch it up to try again; a failed run is not charged.</span><button className="st-btn sm ghost" onClick={onClose}>Close</button></div>
  }
  return (
    <div className="st-col" style={{ gap: 8 }}>
      <div className="st-row"><span className="st-label">Pick one</span><span className="st-spacer" /><button className="st-btn sm ghost" onClick={onClose}>Hide</button></div>
      <div className="st-ideas">
        {options.map((o, i) => {
          const text = optionText(o)
          const on = current.trim() === text
          return (
            <button key={i} type="button" className={`st-choice ${on ? 'on' : ''}`} onClick={() => onPick(text)}>
              <span className="st-row" style={{ gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 1 }}>{text}</span>{on && <Check size={14} />}</span>
              <span className="st-hint">{[o.place, o.detail].map(noDash).filter(Boolean).join(' · ')}</span>
              {o.other_person && <span className="st-hint">Also in it: {noDash(o.other_person)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
