import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Clapperboard, Copy, Loader2, Music, Pause, Play, Plus, Redo2, Scissors, SkipBack, Sparkles, Trash2, Type, Undo2, Wind, X, ZoomIn, ZoomOut } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { keys, useSounds } from '../../hooks'
import { LibraryDrawer } from '../../library'
import { Drawer, errorMessage, useToast } from '../../ui'
import type { Cut, CutCaption, CutShot, EditSpec, EditStrength, EditStyleView, MemeSpec, SoundLevel, SoundSpec } from '../../types'
import { autoCut, place, shotInfo, type Placed } from './RoughCut'
import { firstFrame, postName } from './parts'
import { editOf, editStyles, editZones, type EditZones } from './EditStyles'
import type { PostCtx } from './ctx'

// Fine-tune (Phase 4; UX-PLAN.md section 9): the post's rough cut as
// editable layers, full screen over the workspace. Video (clips and B-roll),
// Text (captions) and Sound (ambience and music) on one timeline; the
// preview plays the cut with its captions and music, streamed from storage
// (nothing is downloaded). Split at the playhead, trim by the edges, drag
// to move, undo and redo. Done saves the cut and the sound to the post,
// renders the MP4 on the worker (free) and returns to the Finish step. The
// layers follow OpenCut's layout (DECISIONS G23). The Edit lane (Phase 5)
// shows where the post's edit acts; the preview plays the plain cut and
// Export renders the edit.

type Sel = { kind: 'shot' | 'caption' | 'edit'; id: string } | null
interface State { cut: Cut; sound: SoundSpec; edit: EditSpec }
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const uid = () => Math.random().toString(36).slice(2, 8)
const VOLUME: Record<SoundLevel, number> = { quiet: 0.45, normal: 0.75, loud: 1 }

export function Editor({ ctx, onClose }: { ctx: PostCtx; onClose: () => void }) {
  const { item, data, draft } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const spec = draft.spec as unknown as MemeSpec
  const o = data.options
  const limits = { maxClip: o.meme.max_clip_seconds, maxBroll: o.meme.max_broll_seconds, maxTotal: o.cut?.max_seconds ?? 90 }
  const initial = useMemo<State>(() => {
    const manual = spec.cut && !spec.cut.auto && spec.cut.shots.length ? spec.cut : null
    const cut = manual ?? autoCut(spec, o.meme.max_broll_seconds)
    const def = o.sound?.defaultAmbience ?? 'room'
    return {
      cut: { auto: false, shots: cut.shots.map(s => ({ ...s })), captions: cut.captions.map(c => ({ ...c })) },
      sound: { ambience: def, ambienceLevel: 'normal', music: null, musicLevel: 'normal', duck: true, clipSound: true, ...(spec.sound ?? {}) },
      edit: editOf(spec),
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [st, setSt] = useState<State>(initial)
  const [past, setPast] = useState<State[]>([])
  const [future, setFuture] = useState<State[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [px, setPx] = useState(60)
  const fitted = useRef(false)
  const [adding, setAdding] = useState<'clip' | 'broll' | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = past.length > 0
  const info = shotInfo(ctx)
  const placed = place(st.cut, info, limits)
  const total = Math.max(0.1, placed.reduce((a, p) => a + p.dur, 0))
  const sounds = useSounds().data?.sounds ?? []

  // Every change is a step that Undo can take back. A drag changes the
  // state live and records one step when it ends.
  const commit = useCallback((next: State | ((s: State) => State), record = true, from?: Partial<State>) => {
    setSt(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      // A drag records the state as it was before the drag began.
      if (record) { setPast(p => [...p.slice(-80), from ? { ...prev, ...from } : prev]); setFuture([]) }
      return value
    })
  }, [])
  const undo = () => { if (!past.length) return; setFuture(f => [st, ...f]); setSt(past[past.length - 1]!); setPast(p => p.slice(0, -1)) }
  const redo = () => { if (!future.length) return; setPast(p => [...p, st]); setSt(future[0]!); setFuture(f => f.slice(1)) }
  const editCut = (fn: (c: Cut) => Cut, record = true, fromCut?: Cut) => commit(s => ({ ...s, cut: fn({ ...s.cut, shots: s.cut.shots.map(x => ({ ...x })), captions: s.cut.captions.map(x => ({ ...x })) }) }), record, fromCut ? { cut: fromCut } : undefined)
  const setSound = (patch: Partial<SoundSpec>) => commit(s => ({ ...s, sound: { ...s.sound, ...patch } }))
  const setEdit = (patch: Partial<EditSpec>, record = true, fromEdit?: EditSpec) => commit(s => ({ ...s, edit: { ...s.edit, ...patch } }), record, fromEdit ? { edit: fromEdit } : undefined)
  const styles = editStyles(ctx)
  const style = styles.find(x => x.id === st.edit.style) ?? null

  const atTime = (t: number) => placed.find(p => t >= p.start - 1e-6 && t < p.start + p.dur - 1e-6) ?? null
  function split() {
    const p = atTime(time)
    if (!p) return
    const cutAt = p.in + (time - p.start)
    if (cutAt - p.in < 0.2 || p.out - cutAt < 0.2) { toast({ tone: 'bad', text: 'Too close to the edge of the shot to split here.' }); return }
    const id = uid()
    editCut(c => {
      const i = c.shots.findIndex(s => s.id === p.shot.id)
      c.shots.splice(i, 1, { ...c.shots[i]!, in: r2(p.in), out: r2(cutAt) }, { ...c.shots[i]!, id, in: r2(cutAt), out: r2(p.out) })
      return c
    })
    setSel({ kind: 'shot', id })
  }
  function remove() {
    if (!sel) return
    if (sel.kind === 'shot') editCut(c => ({ ...c, shots: c.shots.filter(s => s.id !== sel.id) }))
    else if (sel.kind === 'edit') setEdit({ style: 'none', payoff: null })
    else editCut(c => ({ ...c, captions: c.captions.filter(x => x.id !== sel.id) }))
    setSel(null)
  }
  function duplicate() {
    if (sel?.kind !== 'shot') return
    const id = uid()
    editCut(c => { const i = c.shots.findIndex(s => s.id === sel.id); c.shots.splice(i + 1, 0, { ...c.shots[i]!, id }); return c })
    setSel({ kind: 'shot', id })
  }
  function addShot(kind: 'clip' | 'broll', ref: string) {
    setAdding(null)
    const id = uid()
    const len = kind === 'broll' ? data.broll.find(b => b.id === ref)?.durationSec ?? o.meme.broll_seconds : null
    editCut(c => ({ ...c, shots: [...c.shots, { id, kind, ref, in: 0, out: kind === 'broll' ? Math.min(o.meme.broll_seconds, len ?? o.meme.broll_seconds) : null }] }))
    setSel({ kind: 'shot', id })
  }
  function addCaption() {
    const id = uid()
    const start = r1(Math.min(time, Math.max(0, total - 0.5)))
    editCut(c => ({ ...c, captions: [...c.captions, { id, text: '', start, end: r1(Math.min(total, start + 2)) }] }))
    setSel({ kind: 'caption', id })
  }

  async function done() {
    setSaving(true)
    try {
      await draft.flush()
      await api.updateContent(item.id, { spec: { cut: st.cut, sound: st.sound, edit: st.edit }, step: 'finish' })
      await api.renderContent(item.id)
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['cut'] })
      toast({ tone: 'ok', text: 'Saved. The MP4 is rendering in the Finish step.' })
      onClose()
    } catch (e) {
      toast({ tone: 'bad', text: errorMessage(e) })
    } finally { setSaving(false) }
  }
  function cancel() {
    if (dirty && !window.confirm('Leave Fine-tune without saving your changes?')) return
    onClose()
  }

  // Keys: Space plays, S splits, Delete removes, Cmd or Ctrl+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 's' || e.key === 'S') { if (!e.metaKey && !e.ctrlKey) split() }
      else if (e.key === 'Delete' || e.key === 'Backspace') remove()
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // The page under the editor does not scroll while it is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  useEffect(() => { if (time > total) setTime(total) }, [total, time])
  // The whole cut fits the timeline when the editor opens.
  useEffect(() => {
    if (fitted.current || !placed.length) return
    fitted.current = true
    const room = Math.max(320, window.innerWidth - 140)
    setPx(Math.max(20, Math.min(240, room / total)))
  }, [placed.length, total])

  const selShot = sel?.kind === 'shot' ? placed.find(p => p.shot.id === sel.id) ?? null : null
  const selCaption = sel?.kind === 'caption' ? st.cut.captions.find(c => c.id === sel.id) ?? null : null
  const musicAsset = st.sound.music ? sounds.find(x => x.id === st.sound.music)?.assetId ?? null : null
  const zones = editZones(style, st.edit, placed.map(p => ({ kind: p.shot.kind, start: p.start })), total, o.edits?.payoffFromEnd ?? 2, !!st.sound.music)
  const zoneNow = zones.zones.find(z => time >= z.start - 1e-3 && time <= z.end + 1e-3)?.label ?? null

  return (
    <div className="st-root ed-root" role="dialog" aria-modal="true" aria-label="Fine-tune">
      <header className="ed-head">
        <button type="button" className="st-btn sm ghost" onClick={cancel}><ArrowLeft size={14} />Back to the post</button>
        <div className="ed-title"><b>Fine-tune</b><span className="st-hint">{postName({ ...item, title: draft.fields.title, idea: draft.fields.idea })}</span></div>
        <span className="st-spacer" />
        {dirty && <span className="st-hint">Not saved yet</span>}
        <button type="button" className="st-btn sm ghost icon" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl or Cmd+Z)"><Undo2 size={15} /></button>
        <button type="button" className="st-btn sm ghost icon" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl or Cmd+Shift+Z)"><Redo2 size={15} /></button>
        <button type="button" className="st-btn sm" onClick={cancel}><X size={14} />Cancel</button>
        <button type="button" className="st-btn sm primary" onClick={() => void done()} disabled={saving || !placed.length}>{saving ? <Loader2 size={14} className="st-spin" /> : null}{saving ? 'Saving...' : 'Done: save and export'}</button>
      </header>

      <div className="ed-body">
        <Preview ctx={ctx} placed={placed} captions={st.cut.captions} caption={spec.caption} time={time} setTime={setTime} playing={playing} setPlaying={setPlaying} total={total} musicAsset={musicAsset} musicVolume={VOLUME[st.sound.musicLevel]} clipSound={st.sound.clipSound} badge={style && zoneNow ? `${style.label}: ${zoneNow}` : null} />
        <aside className="ed-side">
          {selShot ? (
            <ShotPanel p={selShot} onTrim={patch => editCut(c => ({ ...c, shots: c.shots.map(s => (s.id === selShot.shot.id ? { ...s, ...patch } : s)) }))}
              onMove={d => editCut(c => { const i = c.shots.findIndex(s => s.id === selShot.shot.id), j = i + d; if (j < 0 || j >= c.shots.length) return c; [c.shots[i], c.shots[j]] = [c.shots[j]!, c.shots[i]!]; return c })}
              onSplit={split} onDuplicate={duplicate} onDelete={remove} canSplit={!!atTime(time) && atTime(time)!.shot.id === selShot.shot.id} />
          ) : selCaption ? (
            <CaptionPanel c={selCaption} postCaption={spec.caption} total={total} onChange={patch => editCut(c => ({ ...c, captions: c.captions.map(x => (x.id === selCaption.id ? { ...x, ...patch } : x)) }))} onDelete={remove} canDelete={st.cut.captions.length > 1} />
          ) : sel?.kind === 'edit' ? (
            <EditPanel styles={styles} edit={st.edit} setEdit={setEdit} zones={zones} total={total} payoffFromEnd={o.edits?.payoffFromEnd ?? 2} />
          ) : (
            <SoundPanel sound={st.sound} setSound={setSound} sounds={sounds} def={o.sound?.defaultAmbience ?? 'room'} />
          )}
        </aside>
      </div>

      <div className="ed-tools">
        <button type="button" className="st-btn sm" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="st-btn sm ghost icon" onClick={() => { setPlaying(false); setTime(0) }} aria-label="Back to the start"><SkipBack size={14} /></button>
        <span className="ed-clock">{r1(time).toFixed(1)} / {r1(total).toFixed(1)} s</span>
        <button type="button" className="st-btn sm" onClick={split} disabled={!atTime(time)} title="Split the shot under the playhead (S)"><Scissors size={14} />Split</button>
        <button type="button" className="st-btn sm ghost" onClick={remove} disabled={!sel} title="Delete (Delete key)"><Trash2 size={14} />Delete</button>
        <span className="st-spacer" />
        <button type="button" className="st-btn sm" onClick={() => setAdding('clip')}><Plus size={13} />Clip</button>
        <button type="button" className="st-btn sm" onClick={() => setAdding('broll')}><Plus size={13} />B-roll</button>
        <button type="button" className="st-btn sm" onClick={addCaption}><Plus size={13} />Caption</button>
        <button type="button" className="st-btn sm ghost icon" onClick={() => setPx(z => Math.max(20, z / 1.5))} aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button type="button" className="st-btn sm ghost icon" onClick={() => setPx(z => Math.min(240, z * 1.5))} aria-label="Zoom in"><ZoomIn size={14} /></button>
        <button type="button" className="st-btn sm ghost" onClick={() => setPx(Math.max(20, Math.min(240, Math.max(320, window.innerWidth - 140) / total)))}>Fit</button>
      </div>

      <Timeline placed={placed} cut={st.cut} caption={spec.caption} total={total} px={px} time={time} sel={sel} sound={st.sound} sounds={sounds}
        onSeek={t => { setPlaying(false); setTime(Math.max(0, Math.min(total, t))) }} onSelect={setSel} editCut={editCut} limits={limits}
        style={style} edit={st.edit} zones={zones} setEdit={setEdit} />

      {item.characterId && <LibraryDrawer open={adding === 'clip'} onClose={() => setAdding(null)} kind="clips" characterId={item.characterId} characterName={ctx.v?.data.name ?? 'this character'} picked={[]} onPick={id => addShot('clip', id)} />}
      <Drawer open={adding === 'broll'} onClose={() => setAdding(null)} title="Add B-roll">
        <div className="st-refgrid">
          {data.broll.filter(b => b.status === 'ready' && b.assetId).map(b => (
            <button key={b.id} type="button" className="st-refchoice" onClick={() => addShot('broll', b.id)} title={b.title}>
              <video className="st-content-thumb" src={firstFrame(b.assetId!)} muted playsInline preload="metadata" />
              <span>{b.title}{b.durationSec ? ` · ${b.durationSec} s` : ''}</span>
            </button>
          ))}
        </div>
      </Drawer>
    </div>
  )
}

// The preview: one video per shot (only the current one shows), so a cut
// plays without reloading; captions in TikTok's box; the music under it.
function Preview({ ctx, placed, captions, caption, time, setTime, playing, setPlaying, total, musicAsset, musicVolume, clipSound, badge }: {
  ctx: PostCtx; placed: Placed[]; captions: CutCaption[]; caption: string; time: number; setTime: (t: number) => void; playing: boolean; setPlaying: (p: boolean) => void
  total: number; musicAsset: string | null; musicVolume: number; clipSound: boolean; badge: string | null
}) {
  const o = ctx.data.options
  const vids = useRef<Record<string, HTMLVideoElement | null>>({})
  const music = useRef<HTMLAudioElement | null>(null)
  const timeRef = useRef(time)
  timeRef.current = time
  const current = placed.find(p => time >= p.start - 1e-6 && time < p.start + p.dur - 1e-6) ?? placed[placed.length - 1] ?? null
  const [w, setW] = useState(300)
  const frame = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Paused: every shot shows the frame at the playhead.
  useEffect(() => {
    if (playing || !current) return
    const v = vids.current[current.shot.id]
    if (v) { try { v.currentTime = current.in + (time - current.start) } catch { /* not loaded yet */ } }
    if (music.current) { try { music.current.currentTime = time } catch { /* not loaded yet */ } }
  }, [time, playing, current?.shot.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Playing: the current shot plays; at its out point the next one starts.
  useEffect(() => {
    if (!playing) {
      for (const v of Object.values(vids.current)) v?.pause()
      music.current?.pause()
      return
    }
    let raf = 0
    let active: Placed | null = placed.find(p => timeRef.current >= p.start - 1e-6 && timeRef.current < p.start + p.dur - 1e-6) ?? placed[0] ?? null
    if (!active) { setPlaying(false); return }
    if (timeRef.current >= total - 0.05) timeRef.current = 0
    const start = (p: Placed, at: number) => {
      const v = vids.current[p.shot.id]
      if (!v) return
      v.currentTime = p.in + (at - p.start)
      void v.play().catch(() => undefined)
    }
    start(active, Math.max(active.start, timeRef.current))
    if (music.current) { music.current.currentTime = timeRef.current; music.current.volume = musicVolume; void music.current.play().catch(() => undefined) }
    let last = performance.now()
    let clock = timeRef.current
    const step = () => {
      if (!active) return
      const v = vids.current[active.shot.id]
      const now = performance.now()
      // A video that cannot play here (still loading, or a format this
      // browser lacks) does not stop the preview: the clock goes on.
      const live = !!v && !v.error && v.readyState >= 2 && !v.paused
      clock = live ? active.start + Math.max(0, v!.currentTime - active.in) : clock + (now - last) / 1000
      last = now
      const t = clock
      if ((live && (v!.currentTime >= active.out - 0.04 || v!.ended)) || (!live && t >= active.start + active.dur)) {
        v?.pause()
        const i = placed.indexOf(active)
        const next = placed[i + 1]
        if (!next) { setTime(total); setPlaying(false); return }
        active = next
        clock = next.start
        start(next, next.start)
        setTime(next.start)
      } else setTime(Math.min(total, t))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  const k = w / o.canvas.width
  const c = o.caption
  const half = Math.min(o.canvas.width / 2 - c.safe.left, o.canvas.width / 2 - c.safe.right)
  const shown = captions.filter(x => time >= x.start && time < (x.end ?? total)).map(x => (x.text ?? caption).trim()).filter(Boolean)
  return (
    <div className="ed-preview">
      <div ref={frame} className="st-captionframe ed-frame" style={{ aspectRatio: `${o.canvas.width} / ${o.canvas.height}` }}>
        {placed.map(p => p.video && (
          <video key={p.shot.id} ref={el => { vids.current[p.shot.id] = el }} src={assetUrl(p.video)} muted={!clipSound} playsInline preload="auto"
            style={{ opacity: current?.shot.id === p.shot.id ? 1 : 0, objectFit: p.shot.kind === 'broll' ? 'contain' : 'cover' }} />
        ))}
        {!placed.length && <div className="ed-empty">Add a clip to start</div>}
        {badge && <span className="ed-edit-badge"><Sparkles size={11} />{badge}</span>}
        {shown.map((text, i) => (
          <div key={i} className={`st-captionbox ${c.position}`} style={{ top: c.position === 'top' ? c.safe.top * k : undefined, bottom: c.position === 'bottom' ? c.safe.bottom * k : undefined, width: 2 * half * k, fontSize: c.size * k }}>
            <span style={{ padding: `${c.box.pad_y * k}px ${c.box.pad_x * k}px`, borderRadius: c.box.radius * k, background: c.box.fill, color: c.box.text }}>{text}</span>
          </div>
        ))}
      </div>
      {musicAsset && <audio ref={music} src={assetUrl(musicAsset)} preload="auto" />}
      <span className="st-hint">Preview. Export renders it exactly, with the sound mixed and leveled and the edit (if any) applied.</span>
    </div>
  )
}

// The timeline: Video, Text and Sound lanes in seconds, a ruler to click,
// the playhead, trim handles on each edge and drag to move.
function Timeline({ placed, cut, caption, total, px, time, sel, sound, sounds, onSeek, onSelect, editCut, limits, style, edit, zones, setEdit }: {
  placed: Placed[]; cut: Cut; caption: string; total: number; px: number; time: number; sel: Sel; sound: SoundSpec; sounds: Array<{ id: string; title: string }>
  onSeek: (t: number) => void; onSelect: (s: Sel) => void; editCut: (fn: (c: Cut) => Cut, record?: boolean, fromCut?: Cut) => void; limits: { maxClip: number; maxBroll: number }
  style: EditStyleView | null; edit: EditSpec; zones: EditZones; setEdit: (patch: Partial<EditSpec>, record?: boolean, fromEdit?: EditSpec) => void
}) {
  const width = Math.max(total * px, 320)
  const lanes = useRef<HTMLDivElement | null>(null)
  const ticks = useMemo(() => {
    const step = px >= 120 ? 0.5 : px >= 50 ? 1 : px >= 25 ? 2 : 5
    return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => r2(i * step))
  }, [px, total])
  const seekAt = (clientX: number) => {
    const el = lanes.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    onSeek((clientX - rect.left) / px)
  }

  // One drag: live changes without an Undo step each, then one step at the end.
  function drag(e: ReactPointerEvent, apply: (dx: number, record: boolean) => void) {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    let moved = false
    const onMove = (ev: PointerEvent) => { const dx = (ev.clientX - x0) / px; if (Math.abs(ev.clientX - x0) > 2) moved = true; if (moved) apply(dx, false) }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) apply((ev.clientX - x0) / px, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const base = useRef<Cut | null>(null)
  const begin = () => { base.current = { ...cut, shots: cut.shots.map(s => ({ ...s })), captions: cut.captions.map(c => ({ ...c })) } }
  const fromBase = (fn: (c: Cut) => Cut, record: boolean) => {
    const b = base.current
    if (!b) return
    editCut(() => fn({ ...b, shots: b.shots.map(s => ({ ...s })), captions: b.captions.map(c => ({ ...c })) }), record, record ? b : undefined)
  }

  function trimShot(e: ReactPointerEvent, p: Placed, edge: 'in' | 'out') {
    begin()
    onSelect({ kind: 'shot', id: p.shot.id })
    const maxLen = p.src ?? (p.shot.kind === 'clip' ? limits.maxClip : limits.maxBroll)
    drag(e, (dx, record) => fromBase(c => ({
      ...c,
      shots: c.shots.map(s => {
        if (s.id !== p.shot.id) return s
        if (edge === 'in') return { ...s, in: r2(Math.min(p.out - 0.2, Math.max(0, p.in + dx))) }
        return { ...s, out: r2(Math.max(p.in + 0.2, Math.min(maxLen, p.out + dx))) }
      }),
    }), record))
  }
  function moveShot(e: ReactPointerEvent, p: Placed) {
    begin()
    onSelect({ kind: 'shot', id: p.shot.id })
    drag(e, (dx, record) => {
      if (!record) return
      // Drop: the shot goes where its middle lands.
      const mid = p.start + p.dur / 2 + dx
      fromBase(c => {
        const rest = c.shots.filter(s => s.id !== p.shot.id)
        const others = placed.filter(q => q.shot.id !== p.shot.id)
        let at = others.findIndex(q => mid < q.start + q.dur / 2)
        if (at < 0) at = rest.length
        rest.splice(at, 0, c.shots.find(s => s.id === p.shot.id)!)
        return { ...c, shots: rest }
      }, true)
    })
  }
  function dragCaption(e: ReactPointerEvent, x: CutCaption, mode: 'move' | 'start' | 'end') {
    begin()
    onSelect({ kind: 'caption', id: x.id })
    const end0 = x.end ?? total
    drag(e, (dx, record) => fromBase(c => ({
      ...c,
      captions: c.captions.map(y => {
        if (y.id !== x.id) return y
        if (mode === 'start') return { ...y, start: r2(Math.max(0, Math.min(end0 - 0.2, x.start + dx))) }
        if (mode === 'end') return { ...y, end: r2(Math.min(total, Math.max(x.start + 0.2, end0 + dx))) }
        const len = end0 - x.start
        const s = Math.max(0, Math.min(total - len, x.start + dx))
        return { ...y, start: r2(s), end: x.end == null && s + len >= total - 0.01 ? null : r2(s + len) }
      }),
    }), record))
  }

  // The payoff marker: where a speed ramp, freeze or flash lands.
  function dragPayoff(e: ReactPointerEvent) {
    const from = { ...edit }
    const t0 = zones.marker ?? 0
    onSelect({ kind: 'edit', id: 'edit' })
    drag(e, (dx, record) => setEdit({ payoff: r2(Math.max(0.2, Math.min(total - 0.2, t0 + dx))) }, record, record ? from : undefined))
  }

  const ambience = sound.ambience === 'none' ? null : sound.ambience === 'room' ? 'Room tone' : sounds.find(s => s.id === sound.ambience)?.title ?? 'Ambience'
  const music = sound.music ? sounds.find(s => s.id === sound.music)?.title ?? 'Music' : null
  return (
    <div className="ed-timeline">
      <div className="ed-labels">
        <span />
        <span><Clapperboard size={12} />Video</span>
        <span><Type size={12} />Text</span>
        <span><Sparkles size={12} />Edit</span>
        <span><Music size={12} />Sound</span>
      </div>
      <div className="ed-scroll">
        <div ref={lanes} className="ed-lanes" style={{ width }} onPointerDown={e => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('ed-lane')) { onSelect(null); seekAt(e.clientX) } }}>
          <div className="ed-ruler" onPointerDown={e => { e.stopPropagation(); seekAt(e.clientX); const move = (ev: PointerEvent) => seekAt(ev.clientX); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up) }}>
            {ticks.map(t => <span key={t} style={{ left: t * px }}>{t}s</span>)}
          </div>
          <div className="ed-lane">
            {placed.map(p => (
              <div key={p.shot.id} className={`ed-clip ${p.shot.kind} ${sel?.kind === 'shot' && sel.id === p.shot.id ? 'on' : ''}`} style={{ left: p.start * px, width: Math.max(8, p.dur * px) }}
                onPointerDown={e => moveShot(e, p)} title={`${p.title}: ${r1(p.in)} to ${r1(p.out)} s of the source`}>
                {p.poster ? <img className="ed-clip-pic" src={assetUrl(p.poster, 160)} alt="" draggable={false} /> : null}
                <span className="ed-clip-label">{p.title}</span>
                <span className="ed-handle left" onPointerDown={e => trimShot(e, p, 'in')} aria-label="Trim the start" />
                <span className="ed-handle right" onPointerDown={e => trimShot(e, p, 'out')} aria-label="Trim the end" />
              </div>
            ))}
          </div>
          <div className="ed-lane">
            {cut.captions.map(x => {
              const end = x.end == null ? total : Math.min(total, x.end)
              const text = (x.text ?? caption).trim()
              return (
                <div key={x.id} className={`ed-clip caption ${sel?.kind === 'caption' && sel.id === x.id ? 'on' : ''} ${text ? '' : 'empty'}`} style={{ left: x.start * px, width: Math.max(8, (end - x.start) * px) }}
                  onPointerDown={e => dragCaption(e, x, 'move')} title={text || 'No text yet'}>
                  <span className="ed-clip-label">{text || 'No text yet'}</span>
                  <span className="ed-handle left" onPointerDown={e => dragCaption(e, x, 'start')} aria-label="Move the start" />
                  <span className="ed-handle right" onPointerDown={e => dragCaption(e, x, 'end')} aria-label="Move the end" />
                </div>
              )
            })}
          </div>
          <div className="ed-lane edit">
            <div className={`ed-bar edit ${style ? '' : 'none'} ${sel?.kind === 'edit' ? 'on' : ''}`} style={{ width: total * px }} onPointerDown={e => { e.stopPropagation(); onSelect({ kind: 'edit', id: 'edit' }) }}
              title={style ? style.line : 'Pick an edit style'}>
              <Sparkles size={11} />{style ? `${style.label} · ${edit.strength}` : 'No edit. Click to pick one.'}{zones.problem ? ` · ${zones.problem}` : ''}
            </div>
            {zones.zones.map((z, i) => <div key={i} className="ed-zone" style={{ left: z.start * px, width: Math.max(3, (z.end - z.start) * px) }} title={z.label} />)}
            {zones.marker != null && (
              <span className={`ed-marker ${zones.movable ? 'movable' : ''}`} style={{ left: zones.marker * px }} onPointerDown={zones.movable ? dragPayoff : e => { e.stopPropagation(); onSelect({ kind: 'edit', id: 'edit' }) }}
                role={zones.movable ? 'slider' : undefined} aria-label={zones.movable ? 'Where the edit lands' : 'The cut'} aria-valuenow={zones.movable ? zones.marker : undefined} aria-valuemin={0} aria-valuemax={total}
                title={zones.movable ? `Lands at ${r1(zones.marker)} s. Drag to move it.` : `At the cut, ${r1(zones.marker)} s`} />
            )}
          </div>
          <div className="ed-lane sound">
            {ambience && <div className="ed-bar amb" style={{ width: total * px }}><Wind size={11} />{ambience} · {sound.ambienceLevel}</div>}
            {music && <div className="ed-bar mus" style={{ width: total * px }}><Music size={11} />{music} · {sound.musicLevel}{sound.duck ? ', dips under clip sound' : ''}</div>}
            {!ambience && !music && <div className="ed-bar none">No sound</div>}
          </div>
          <div className="ed-playhead" style={{ left: time * px }} />
        </div>
      </div>
    </div>
  )
}

function ShotPanel({ p, onTrim, onMove, onSplit, onDuplicate, onDelete, canSplit }: {
  p: Placed; onTrim: (patch: Partial<Pick<CutShot, 'in' | 'out'>>) => void; onMove: (d: -1 | 1) => void; onSplit: () => void; onDuplicate: () => void; onDelete: () => void; canSplit: boolean
}) {
  return (
    <div className="st-col" style={{ gap: 12 }}>
      <div className="st-label">{p.shot.kind === 'broll' ? 'B-roll shot' : 'Clip shot'}</div>
      <b>{p.title}</b>
      <span className="st-hint">{p.src != null ? `${r1(p.src)} s source` : 'Length not known yet'} · plays {r1(p.dur)} s from {r1(p.start)} s</span>
      <label className="st-row" style={{ gap: 6 }}>Starts at <input className="st-input st-num" type="number" min={0} step={0.1} value={r1(p.in)} onChange={e => onTrim({ in: Math.max(0, Number(e.target.value) || 0) })} aria-label="Starts at, seconds into the source" /> s</label>
      <label className="st-row" style={{ gap: 6 }}>Ends at <input className="st-input st-num" type="number" min={0} step={0.1} value={r1(p.out)} onChange={e => onTrim({ out: Math.max(0, Number(e.target.value) || 0) })} aria-label="Ends at, seconds into the source" /> s</label>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="st-btn sm" onClick={onSplit} disabled={!canSplit} title="Move the playhead inside this shot first"><Scissors size={13} />Split at the playhead</button>
        <button type="button" className="st-btn sm ghost" onClick={onDuplicate}><Copy size={13} />Duplicate</button>
        <button type="button" className="st-btn sm ghost" onClick={() => onMove(-1)}>Earlier</button>
        <button type="button" className="st-btn sm ghost" onClick={() => onMove(1)}>Later</button>
        <button type="button" className="st-btn sm bad" onClick={onDelete}><Trash2 size={13} />Delete</button>
      </div>
      <span className="st-hint">Cuts between shots are hard cuts, never a crossfade. Drag a shot to move it; drag its edges to trim.</span>
    </div>
  )
}

function CaptionPanel({ c, postCaption, total, onChange, onDelete, canDelete }: { c: CutCaption; postCaption: string; total: number; onChange: (patch: Partial<CutCaption>) => void; onDelete: () => void; canDelete: boolean }) {
  return (
    <div className="st-col" style={{ gap: 12 }}>
      <div className="st-label">Caption</div>
      {c.text == null ? (
        <>
          <span className="st-hint">Uses the caption from the Caption step: "{postCaption.trim() || 'empty'}".</span>
          <button type="button" className="st-btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ text: postCaption })}>Write a different one</button>
        </>
      ) : (
        <textarea className="st-textarea" rows={3} maxLength={400} value={c.text} onChange={e => onChange({ text: e.target.value })} placeholder="e.g. wait for it" aria-label="Caption text" />
      )}
      <label className="st-row" style={{ gap: 6 }}>From <input className="st-input st-num" type="number" min={0} step={0.1} value={r1(c.start)} onChange={e => onChange({ start: Math.max(0, Number(e.target.value) || 0) })} aria-label="Caption starts at" /> s</label>
      <label className="st-row" style={{ gap: 6 }}>To <input className="st-input st-num" type="number" min={0} step={0.1} value={c.end == null ? '' : r1(c.end)} placeholder={`${r1(total)}`} onChange={e => onChange({ end: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} aria-label="Caption ends at" /> s</label>
      {canDelete && <button type="button" className="st-btn sm bad" style={{ alignSelf: 'flex-start' }} onClick={onDelete}><Trash2 size={13} />Delete caption</button>}
    </div>
  )
}

function EditPanel({ styles, edit, setEdit, zones, total, payoffFromEnd }: {
  styles: EditStyleView[]; edit: EditSpec; setEdit: (patch: Partial<EditSpec>) => void; zones: EditZones; total: number; payoffFromEnd: number
}) {
  const style = styles.find(x => x.id === edit.style) ?? null
  return (
    <div className="st-col" style={{ gap: 12 }}>
      <div className="st-label">Edit style</div>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Edit style">
        <button type="button" role="radio" aria-checked={!style} className={`st-chip ${!style ? 'on' : ''}`} onClick={() => setEdit({ style: 'none', payoff: null })}>None</button>
        {styles.map(x => <button key={x.id} type="button" role="radio" aria-checked={edit.style === x.id} className={`st-chip ${edit.style === x.id ? 'on' : ''}`} title={x.line} onClick={() => setEdit({ style: x.id, payoff: edit.style === x.id ? edit.payoff : null })}>{x.label}{x.shots === 2 ? ' (2 shots)' : ''}</button>)}
      </div>
      {style && <span className="st-hint">{style.line}</span>}
      {zones.problem && <span className="st-callout warn">{zones.problem} Add it in the Video step, or drag a second clip into the timeline.</span>}
      {style && (
        <>
          <div className="st-seg sm" role="radiogroup" aria-label="Strength">
            {(['subtle', 'normal', 'strong'] as EditStrength[]).map(k => <button key={k} type="button" role="radio" aria-checked={edit.strength === k} className={edit.strength === k ? 'on' : ''} onClick={() => setEdit({ strength: k })}>{k === 'subtle' ? 'Subtle' : k === 'normal' ? 'Normal' : 'Strong'}</button>)}
          </div>
          {zones.movable && (
            <label className="st-row" style={{ gap: 6 }}>Lands at
              <input className="st-input st-num" type="number" min={0} max={r1(total)} step={0.1} value={edit.payoff ?? ''} placeholder={zones.marker != null ? String(r1(zones.marker)) : 'auto'} onChange={e => setEdit({ payoff: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} aria-label="Where the edit lands, in seconds" /> s
              {edit.payoff != null && <button type="button" className="st-btn sm ghost" onClick={() => setEdit({ payoff: null })}>Auto</button>}
            </label>
          )}
          {zones.movable && <span className="st-hint">{edit.payoff == null ? `Auto: ${payoffFromEnd} s before the end${style.anchor === 'cut_or_payoff' ? ', or the first cut' : ''}. ` : ''}Drag the marker on the Edit lane to move it.</span>}
          {style.id === 'freeze_pop' && <input className="st-input" maxLength={120} value={edit.text} onChange={e => setEdit({ text: e.target.value })} placeholder="Pop text, e.g. NO WAY (else the caption)" aria-label="Pop text" />}
        </>
      )}
      <span className="st-hint">The preview plays the plain cut; the highlighted part of the Edit lane is where the edit acts. Export renders it, free, on the worker.</span>
    </div>
  )
}

function SoundPanel({ sound, setSound, sounds, def }: { sound: SoundSpec; setSound: (p: Partial<SoundSpec>) => void; sounds: Array<{ id: string; kind: string; title: string; status: string }>; def: string }) {
  const amb = sound.ambience || def
  const levels = (value: SoundLevel, onChange: (l: SoundLevel) => void, label: string) => (
    <div className="st-seg sm" role="radiogroup" aria-label={label}>
      {(['quiet', 'normal', 'loud'] as const).map(l => <button key={l} type="button" role="radio" aria-checked={value === l} className={value === l ? 'on' : ''} onClick={() => onChange(l)}>{l === 'quiet' ? 'Quiet' : l === 'normal' ? 'Normal' : 'Loud'}</button>)}
    </div>
  )
  return (
    <div className="st-col" style={{ gap: 12 }}>
      <div className="st-label">Sound</div>
      <span className="st-hint">Click a shot, a caption or the Edit lane to change it. With nothing picked, this is the post's sound.</span>
      <b className="st-row" style={{ gap: 6 }}><Wind size={13} />Ambience</b>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={`st-chip ${amb === 'none' ? 'on' : ''}`} onClick={() => setSound({ ambience: 'none' })}>None</button>
        <button type="button" className={`st-chip ${amb === 'room' ? 'on' : ''}`} onClick={() => setSound({ ambience: 'room' })}>Room tone</button>
        {sounds.filter(s => s.kind === 'ambience' && s.status === 'ready').map(s => <button key={s.id} type="button" className={`st-chip ${amb === s.id ? 'on' : ''}`} onClick={() => setSound({ ambience: s.id })}>{s.title}</button>)}
      </div>
      {amb !== 'none' && levels(sound.ambienceLevel, l => setSound({ ambienceLevel: l }), 'Ambience level')}
      <b className="st-row" style={{ gap: 6 }}><Music size={13} />Music</b>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={`st-chip ${!sound.music ? 'on' : ''}`} onClick={() => setSound({ music: null })}>None</button>
        {sounds.filter(s => s.kind === 'music' && s.status === 'ready').map(s => <button key={s.id} type="button" className={`st-chip ${sound.music === s.id ? 'on' : ''}`} onClick={() => setSound({ music: s.id })}>{s.title}</button>)}
      </div>
      {sound.music && levels(sound.musicLevel, l => setSound({ musicLevel: l }), 'Music level')}
      {sound.music && (
        <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
          <button type="button" role="switch" aria-checked={sound.duck} className={`st-switch ${sound.duck ? 'on' : ''}`} onClick={() => setSound({ duck: !sound.duck })}><span /></button>
          <span className="st-hint">Dip the music under the clip's own sound</span>
        </label>
      )}
      <span className="st-hint">Upload tracks in the Finish step or Library &gt; Sounds. No AI music.</span>
    </div>
  )
}
