import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, CheckCircle2, Download, Film, Info, Loader2, RotateCcw, Wand2, XCircle } from 'lucide-react'
import { api, ApiError, assetUrl } from '../../api'
import { useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Drawer, Field, Img, PromptViewer, errorMessage, useToast, type TodoItem } from '../../ui'
import type { CharacterView, SceneStill, SceneView, ScenesData } from '../../types'
import { OP_LABEL, STILL_STATUS, claudeChecked, wrap } from './StillDrawer'
import { PromptBox } from './PromptBox'

// Stage 9 (owner ruling 2026-10-13): a video from a picked still. Straight
// to the picked model (Kling 3.0 Pro unless another was picked last, each
// shown with its price), then "Upscale this take" on a take you keep, so
// the exact take is preserved. Start frame plus an optional end frame,
// 9:16, audio off, the directions in the prompt, one continuous take: all
// defaults, all editable. A quick motion test on the cheap model is there
// for complex movement, off by default.

const usable = (c: SceneStill) => c.media === 'image' && !!c.assetId && !['failed', 'rejected', 'superseded', 'qa_failed', 'qa_pending'].includes(c.status)

// In a post, `onUseTake` picks a take for the post; picking it keeps it
// (owner, 2026-10-13), so there is no separate Keep click.
export function VideoSection({ v, data, scene, startId, setStartId, onUseTake, usedId = null }: { v: CharacterView; data: ScenesData; scene: SceneView; startId: string | null; setStartId: (id: string | null) => void; onUseTake?: (id: string) => void; usedId?: string | null }) {
  const toast = useToast()
  const refresh = useRefresh()
  const o = data.options.video
  const stills = scene.candidates.filter(usable).sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'))
  const clips = scene.candidates.filter(c => c.media === 'video' && (c.assetId || c.status === 'failed'))
  const start = stills.find(c => c.id === startId) ?? stills.find(c => c.status === 'approved') ?? null
  const [endId, setEndId] = useState<string | null>(null)
  const [motion, setMotion] = useState(String(scene.fields.moment ?? ''))
  const [directions, setDirections] = useState(o.directions)
  const [duration, setDuration] = useState(o.duration)
  const [aspect, setAspect] = useState(o.aspect)
  const [audio, setAudio] = useState(false)
  const [takes, setTakes] = useState(o.takes)
  const [test, setTest] = useState(false)
  const [helper, setHelper] = useState(false)
  // The model for this take: the account's last pick (Kling 3.0 Pro until
  // one is made), each shown with the price of one take.
  const [model, setModel] = useState(o.model.ref)
  useEffect(() => setModel(o.model.ref), [o.model.ref])
  const picked = o.models.find(m => m.ref === model) ?? { ...o.model, resolution: null }
  const prices = useQuery({ queryKey: ['video-prices', v.id, duration, aspect, data.options.mode], queryFn: () => api.videoPrices(v.id, duration, aspect), staleTime: 10 * 60_000, retry: false })
  function pick(ref: string) {
    setModel(ref)
    api.setVideoModel(ref).catch(() => undefined)
  }
  const pw = data.options.promptWriter
  const [promptDirty, setPromptDirty] = useState(false)
  const written = scene.prompts.video
  const needsPrompt = pw.on && !(written?.text ?? '').trim()
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { if (endId && (endId === start?.id || !stills.some(s => s.id === endId))) setEndId(null) }, [endId, start?.id, stills])
  const ends = stills.filter(c => c.id !== start?.id).sort((a, b) => Number(b.op === 'end_frame') - Number(a.op === 'end_frame'))
  const writeTodo: TodoItem[] = [
    ...(!start ? [{ label: 'Pick a start frame', target: 'video-start' }] : []),
    ...(motion.trim().length < 3 ? [{ label: 'What happens', target: 'video-motion' }] : []),
  ]
  const todo: TodoItem[] = [
    ...writeTodo,
    ...(needsPrompt ? [{ label: 'The video prompt (write it, or type your own)', target: 'video-prompt' }] : []),
  ]
  const motionChanged = !!written?.motion && written.motion.trim() !== motion.trim()
  const clip = clips.find(c => c.id === open) ?? null
  // Keep (if not kept yet), then pick it for the post. A face that does not
  // match REF-00 asks first (a strong warning; the owner decides).
  async function useTake(id: string, acknowledge = false) {
    const c = clips.find(x => x.id === id)
    if (!c || !onUseTake) return
    try {
      if (c.status !== 'approved') await api.approve(c.id, acknowledge)
      refresh(v.id)
      onUseTake(c.id)
      setOpen(null)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_required') toast({ tone: 'bad', text: 'The face in this take does not match REF-00.', action: { label: 'Use it anyway', run: () => void useTake(id, true) } })
      else toast({ tone: 'bad', text: errorMessage(e) })
    }
  }

  return (
    <section className="st-col" style={{ gap: 14 }}>

      <div className="st-card" data-field="video-card">
        <div className="st-card-head"><Film size={16} /><div className="grow"><div className="st-h3">Make a video</div><div className="st-hint">Straight to {picked.label}{picked.resolution ? ` at ${picked.resolution}` : ''}. Keep a take you like, then upscale that exact take.</div></div></div>
        <div className="st-card-body st-col" style={{ gap: 16 }}>
          {stills.length === 0 ? (
            <Callout tone="info">Generate a still above first. A video starts from a still of this scene.</Callout>
          ) : (
            <>
              <Field id="video-start" label="Start frame" required done={!!start} group>
                <div className="st-refgrid">
                  {stills.map(c => (
                    <button key={c.id} type="button" className={`st-refchoice ${start?.id === c.id ? 'on' : ''}`} onClick={() => setStartId(c.id)} title={OP_LABEL[c.op]}>
                      <Img assetId={c.assetId} width={160} style={{ aspectRatio: scene.aspect.replace(':', ' / ') }} />
                      <span>{c.status === 'approved' ? 'Picked' : OP_LABEL[c.op]}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field id="video-end" label="End frame (optional)" group hint="Start and end frames give two beats in one continuous take.">
                <div className="st-refgrid">
                  <button type="button" className={`st-refchoice ${endId === null ? 'on' : ''}`} onClick={() => setEndId(null)}><span className="st-refnone">None</span><span>No end frame</span></button>
                  {ends.map(c => (
                    <button key={c.id} type="button" className={`st-refchoice ${endId === c.id ? 'on' : ''}`} onClick={() => setEndId(c.id)} title={OP_LABEL[c.op]}>
                      <Img assetId={c.assetId} width={160} style={{ aspectRatio: scene.aspect.replace(':', ' / ') }} />
                      <span>{OP_LABEL[c.op]}</span>
                    </button>
                  ))}
                </div>
                {start && <button type="button" className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setHelper(x => !x)}><Wand2 size={14} />{helper ? 'Hide the end frame helper' : 'Make an end frame from the start frame'}</button>}
              </Field>
              {helper && start && <EndFrameHelper v={v} data={data} start={start} />}
              <Field id="video-motion" label="What happens" required done={motion.trim().length >= 3} hint="One action and at most one camera move. Calm motion keeps the face steady.">
                <textarea className="st-textarea" rows={2} style={{ minHeight: 0 }} maxLength={600} value={motion} onChange={e => setMotion(e.target.value)} placeholder={`e.g. ${v.data.name} laughs softly and turns toward the camera`} />
              </Field>
              <Field id="video-directions" label="Directions" hint="Added to the prompt. Edit freely.">
                <textarea className="st-textarea" rows={2} style={{ minHeight: 0 }} maxLength={600} value={directions} onChange={e => setDirections(e.target.value)} />
              </Field>
              {!test && (
                <Field id="video-model" label="Video model" group hint={data.options.mode === 'demo' ? 'Demo mode runs a free mock for every model.' : 'Price of one take at this length and shape. Your pick is remembered for the next take.'}>
                  <div className="st-videomodels" role="radiogroup" aria-label="Video model">
                    {o.models.map(m => {
                      const price = prices.data?.prices.find(p => p.model === m.ref)
                      const on = m.ref === picked.ref
                      return (
                        <button key={m.ref} type="button" role="radio" aria-checked={on} className={`st-choice ${on ? 'on' : ''}`} onClick={() => pick(m.ref)} title={m.note || undefined}>
                          <span className="st-row" style={{ gap: 8 }}><b>{m.label}</b><span className="st-spacer" />{on && <Check size={14} />}</span>
                          <span className="st-model-price">{prices.isLoading ? <Loader2 size={12} className="st-spin" /> : price?.display ?? 'No price yet'}{price?.display && !price.verified ? <span className="st-muted" style={{ fontWeight: 400 }}> (not confirmed)</span> : null}</span>
                          <span className="st-hint">{m.path === 'account' ? 'Your Higgsfield plan' : 'Higgsfield API'}{m.resolution ? ` · ${m.resolution}` : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                </Field>
              )}
              <div className="st-form">
                {!test && (
                  <Field label="Length" group>
                    <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>{o.durations.map(d => <button key={d} type="button" className={`st-chip ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)}>{d} s</button>)}</div>
                  </Field>
                )}
                <Field label="Shape" group>
                  <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>{[...new Set(data.options.destinations.map(d => d.aspect))].map(a => <button key={a} type="button" className={`st-chip ${aspect === a ? 'on' : ''}`} onClick={() => setAspect(a)}>{a}</button>)}</div>
                </Field>
              </div>
              <div className="st-row" style={{ gap: 18, flexWrap: 'wrap' }}>
                <label className="st-row" style={{ gap: 10, cursor: 'pointer' }}>
                  <button type="button" role="switch" aria-checked={audio} className={`st-switch ${audio ? 'on' : ''}`} onClick={() => setAudio(a => !a)}><span /></button>
                  <span className="st-col" style={{ gap: 0 }}><b>Sound</b><span className="st-hint">{audio ? 'On: the model makes sound.' : 'Off: silent clip, sound is added later.'}</span></span>
                </label>
                {!test && (
                  <div className="st-row">
                    <span className="st-label">Takes</span>
                    <div className="st-stepnum"><button onClick={() => setTakes(n => Math.max(1, n - 1))} aria-label="Fewer takes">-</button><span>{takes}</span><button onClick={() => setTakes(n => Math.min(o.maxTakes, n + 1))} aria-label="More takes">+</button></div>
                  </div>
                )}
              </div>
              <label className="st-row st-testtoggle" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
                <button type="button" role="switch" aria-checked={test} className={`st-switch ${test ? 'on' : ''}`} onClick={() => setTest(t => !t)}><span /></button>
                <span className="st-col" style={{ gap: 2 }}>
                  <b>{o.test.label} <span className="st-badge warn plain">{o.test.note}</span></b>
                  <span className="st-hint">{o.test.model.label}, {o.test.duration} s, cheap. Only for checking complex motion before a real take; off for real takes.</span>
                </span>
              </label>
              {pw.on ? (
                <PromptBox
                  id="video-prompt" characterId={v.id} sceneId={scene.id} target="video"
                  written={written} templateText={motion.trim().length >= 3 ? `${motion.trim().replace(/[.\s]+$/, '')}.` : null} words={pw.words.video} model={pw.model} realism={pw.realism}
                  writeTodo={writeTodo}
                  writeAction={writeTodo.length || !start ? null : { type: 'scene_prompt', characterId: v.id, sceneId: scene.id, target: 'video', motion: motion.trim(), directions: directions.trim(), startCandidateId: start.id, ...(endId ? { endCandidateId: endId } : {}) }}
                  addedNote="Added when it runs: the directions, the silent line when sound is off, and the REALISM block (always)."
                  changedNote={motionChanged ? 'You changed "What happens" after this was written. Rewrite to use it, or keep it as it is.' : null}
                  onDirty={setPromptDirty}
                />
              ) : (
                <span className="st-hint"><Info size={12} style={{ verticalAlign: -2 }} /> The prompt writer is off, so "What happens" and the directions are the prompt. Switch it on in Settings, Claude models.</span>
              )}
              <PriceButton
                size="big"
                label={test ? 'Run the motion test' : takes > 1 ? `Generate ${takes} takes` : 'Generate a take'}
                todo={todo}
                waiting={promptDirty ? 'Saving your changes...' : undefined}
                action={todo.length || !start || promptDirty ? null : {
                  type: 'scene_video', characterId: v.id, candidateId: start.id, ...(endId ? { endCandidateId: endId } : {}), ...(test ? {} : { model: picked.ref }),
                  motion: motion.trim(), directions: directions.trim(), durationSec: test ? o.test.duration : duration, aspect, audio, takes: test ? 1 : takes, test,
                }}
              />
            </>
          )}
        </div>
      </div>
      {clips.length > 0 && (
        <>
          <div className="st-section-head" style={{ margin: '6px 0 0' }}><div className="st-h3">Takes</div><span className="st-muted">{clips.filter(c => c.assetId).length}</span></div>
          <div className="st-grid scenes">
            {clips.map(c => <ClipTile key={c.id} c={c} aspect={scene.aspect} onOpen={() => setOpen(c.id)} used={c.id === usedId} onUse={onUseTake ? () => void useTake(c.id) : undefined} />)}
          </div>
        </>
      )}
      <ClipDrawer v={v} scene={scene} clip={clip} onClose={() => setOpen(null)} onOpen={setOpen} onUse={onUseTake ? (ack: boolean) => useTake(clip!.id, ack) : undefined} used={clip?.id === usedId} />
    </section>
  )
}

// The end frame helper: only the head and face of the start frame change
// (a masked inpaint), so the rest of the frame stays exactly the same.
function EndFrameHelper({ v, data, start }: { v: CharacterView; data: ScenesData; start: SceneStill }) {
  const presets = data.options.video.endFrame.presets
  const [change, setChange] = useState(presets[0]?.text ?? '')
  return (
    <div className="st-card pad st-col" style={{ gap: 10, boxShadow: 'none' }}>
      <div className="st-h3">End frame helper</div>
      <span className="st-hint">Changes only {v.data.pronouns.poss} head and face, inside a mask over the start frame. Everything else stays exactly as it is. REF-00 holds the face, and QA checks the mole side. The result shows up in Stills and as an end frame here.</span>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {presets.map(p => <button key={p.id} type="button" className={`st-chip ${change === p.text ? 'on' : ''}`} onClick={() => setChange(p.text)}>{p.label}</button>)}
      </div>
      <Field id="end-frame-change" label="How the head or face changes" required done={change.trim().length >= 3}>
        <textarea className="st-textarea" rows={2} style={{ minHeight: 0 }} maxLength={400} value={change} onChange={e => setChange(e.target.value)} placeholder="e.g. She turns her head toward the camera and looks into the lens" />
      </Field>
      <PriceButton
        label="Make the end frame"
        variant="secondary"
        todo={change.trim().length < 3 ? [{ label: 'How the head or face changes', target: 'end-frame-change' }] : []}
        action={change.trim().length < 3 ? null : { type: 'scene_end_frame', characterId: v.id, candidateId: start.id, change: change.trim(), withQa: data.options.autoQa }}
      />
    </div>
  )
}

function ClipTile({ c, aspect, onOpen, onUse, used }: { c: SceneStill; aspect: string; onOpen: () => void; onUse?: () => void; used: boolean }) {
  const s = STILL_STATUS[c.status] ?? { label: c.status, tone: '' }
  const test = JSON.stringify(c.qaReport ?? '').includes('faces not representative')
  const usable = !!c.assetId && ['in_review', 'approved', 'rejected', 'superseded'].includes(c.status)
  return (
    <div className={`st-tile st-scene-tile ${used ? 'picked' : ''}`}>
      <button type="button" className="st-tile-open" onClick={onOpen} aria-label={`Open ${test ? 'motion test' : OP_LABEL[c.op]}`}>
        {c.assetId
          ? <video className="st-clip" src={assetUrl(c.assetId)} muted loop playsInline preload="metadata" style={{ aspectRatio: aspect.replace(':', ' / ') }} onMouseEnter={e => void e.currentTarget.play().catch(() => {})} onMouseLeave={e => e.currentTarget.pause()} />
          : <div className="st-clip st-clip-empty" style={{ aspectRatio: aspect.replace(':', ' / ') }}><AlertTriangle size={18} /></div>}
        <span className={`st-badge ${used ? 'ok' : s.tone}`}>{used ? 'Used' : s.label}</span>
      </button>
      <div className="st-row" style={{ gap: 6, padding: '0 4px 2px' }}>
        <span className="st-tile-label">{test ? 'Motion test' : OP_LABEL[c.op]}</span>
        <span className="st-spacer" />
        {c.qaVerdict && <span className={`st-badge plain ${c.qaVerdict === 'post' ? 'ok' : c.qaVerdict === 'regenerate' ? 'bad' : 'warn'}`}>{c.qaVerdict === 'post' ? (claudeChecked(c.qaReport) ? 'QA ok' : 'Free checks ok') : c.qaVerdict === 'regenerate' ? 'Face?' : 'Look'}</span>}
      </div>
      {onUse && usable && !used && !test && <div className="st-tile-action"><button type="button" className="st-btn sm ok" onClick={onUse}><CheckCircle2 size={14} />Use this take</button></div>}
    </div>
  )
}

function ClipDrawer({ v, scene, clip, onClose, onOpen, onUse, used = false }: { v: CharacterView; scene: SceneView; clip: SceneStill | null; onClose: () => void; onOpen: (id: string) => void; onUse?: (acknowledge: boolean) => Promise<void>; used?: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => setConfirm(false), [clip?.id])
  if (!clip) return null
  const r = clip.qaReport
  const s = STILL_STATUS[clip.status] ?? { label: clip.status, tone: '' }
  const smoothed = !!r?.findings.some(f => f.severity === 'fail' && (f.code === 'skin_smoothed' || f.code === 'skin_plastic'))
  const canKeep = !!clip.assetId && ['in_review', 'rejected', 'superseded'].includes(clip.status) && !smoothed
  const upscaled = scene.candidates.find(c => c.parentId === clip.id && c.op === 'video_upscale' && c.status !== 'failed')

  async function keep(acknowledge = false) {
    setBusy(true)
    if (onUse) {
      try { await onUse(acknowledge) } finally { setBusy(false) }
      return
    }
    try {
      await api.approve(clip!.id, acknowledge)
      setConfirm(false)
      refresh(v.id)
      toast({ tone: 'ok', text: 'Kept. You can upscale this exact take now.' })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_required') setConfirm(true)
      else toast({ tone: 'bad', text: errorMessage(e) })
    } finally { setBusy(false) }
  }
  async function reject() {
    setBusy(true)
    try {
      await api.reject(clip!.id, ['other'], 'Video take')
      refresh(v.id)
      toast({ tone: '', text: 'Rejected.', action: { label: 'Undo', run: async () => { await api.reopen(clip!.id); refresh(v.id) } } })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <Drawer open onClose={onClose} wide title={<span>{OP_LABEL[clip.op]} · <span className="st-muted">{scene.title || 'Scene'}</span></span>}>
      <div className="st-col" style={{ gap: 16 }}>
        <div className="st-row"><span className={`st-badge ${s.tone}`}>{s.label}</span>{clip.rejectNote && clip.status === 'failed' && <span className="st-hint">{clip.rejectNote}</span>}</div>
        {clip.assetId && <video className="st-clip-player" src={assetUrl(clip.assetId)} controls loop playsInline autoPlay muted style={{ aspectRatio: scene.aspect.replace(':', ' / ') }} />}
        {clip.status === 'qa_pending' && <Callout tone="info" icon={<Loader2 size={16} className="st-spin" />}>Checking the face against REF-00 and the skin texture on sampled frames...</Callout>}
        {r && clip.status !== 'qa_pending' && (
          <Callout tone={r.verdict === 'post' ? 'ok' : r.verdict === 'regenerate' ? 'bad' : 'warn'}>
            <b>{r.summary}</b>
            <ul className="st-notes" style={{ margin: '8px 0 0' }}>{r.findings.filter(f => f.code !== 'identity_match' || f.severity !== 'info').map((f, i) => <li key={i}>{f.message}</li>)}</ul>
          </Callout>
        )}
        {confirm && (
          <Callout tone="warn" icon={<AlertTriangle size={16} />}>
            QA found the face does not match REF-00 in this take. Keep it anyway?
            <div className="st-row" style={{ gap: 8, marginTop: 8 }}><button className="st-btn sm" disabled={busy} onClick={() => keep(true)}>Keep anyway</button><button className="st-btn sm ghost" onClick={() => setConfirm(false)}>Cancel</button></div>
          </Callout>
        )}
        {clip.assetId && clip.status !== 'qa_pending' && (
          <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <PriceButton action={{ type: 'scene_qa', characterId: v.id, candidateId: clip.id }} label={claudeChecked(r) ? 'Check again' : 'Check this'} variant="secondary" size="sm" icon={false} />
            <span className="st-hint">Claude checks the take's last frame: the face, the mole side and the skin. On demand only.</span>
          </div>
        )}
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {onUse && !used && !!clip.assetId && (canKeep || clip.status === 'approved') && <button className="st-btn ok" disabled={busy} onClick={() => keep()}>{busy ? <Loader2 size={15} className="st-spin" /> : <CheckCircle2 size={15} />}Use this take</button>}
          {!onUse && canKeep && <button className="st-btn ok" disabled={busy} onClick={() => keep()}>{busy ? <Loader2 size={15} className="st-spin" /> : <CheckCircle2 size={15} />}Keep this take</button>}
          {clip.assetId && clip.status !== 'rejected' && <button className="st-btn bad ghost" disabled={busy} onClick={reject}><XCircle size={15} />Reject</button>}
          {clip.status === 'rejected' && <button className="st-btn ghost" onClick={async () => { await api.reopen(clip.id); refresh(v.id) }}><RotateCcw size={14} />Undo reject</button>}
          {clip.assetId && <a className="st-btn ghost" href={`${assetUrl(clip.assetId)}?download=1`}><Download size={14} />Download</a>}
        </div>
        {clip.op === 'video' && clip.assetId && (
          <div className="st-card pad st-col" style={{ gap: 10, boxShadow: 'none' }}>
            <div className="st-h3">Upscale this take</div>
            <span className="st-hint">The video upscaler sharpens this exact take; nothing is re-rolled. If the skin comes out smoothed, the original take stays.</span>
            {upscaled ? (
              <button className="st-btn sm" onClick={() => onOpen(upscaled.id)}><Film size={14} />Open the upscaled take</button>
            ) : clip.status === 'approved' ? (
              <PriceButton label="Upscale this take" variant="secondary" action={{ type: 'scene_video_upscale', characterId: v.id, candidateId: clip.id }} />
            ) : (
              <span className="st-hint">Keep this take first; then you can upscale it.</span>
            )}
          </div>
        )}
        {clip.prompt && <PromptViewer label="Video prompt" wrapped={wrap(clip.prompt)} text={clip.prompt} />}
      </div>
    </Drawer>
  )
}
