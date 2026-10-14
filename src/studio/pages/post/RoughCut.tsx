import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, AudioLines, Clapperboard, Film, Loader2, Music, Plus, RotateCcw, Trash2, Type, Upload, Volume2, Wind } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { useCut, useSounds, useWorkerGate } from '../../hooks'
import { LibraryDrawer } from '../../library'
import { RunStatus } from '../../runs'
import { Callout, Drawer, Img, errorMessage, useToast } from '../../ui'
import type { ContentData, Cut, CutCaption, CutShot, LibraryClip, MemeSpec, SoundItem, SoundLevel, SoundSpec } from '../../types'
import { firstFrame } from './parts'
import type { PostCtx } from './ctx'

// The Finish step's rough cut and Sound row (Phase 3; UX-PLAN.md section 8).
// The cut is built automatically from the steps above (the clip, its B-roll
// before or after, the caption over the whole video) until it is edited
// here; Rebuild goes back to the automatic cut. Export renders exactly this
// timeline: hard cuts, never a crossfade. The Sound row sets the bed: Room
// tone or an uploaded ambience, an uploaded music track (ducked), mixed and
// normalized to social loudness. No AI music.

const r1 = (n: number) => Math.round(n * 10) / 10
const uid = () => Math.random().toString(36).slice(2, 8)

// The automatic cut (the same rule as the server's core/cut.ts).
export function autoCut(s: MemeSpec, maxBroll: number): Cut {
  const clip: CutShot | null = s.clipId ? { id: 'clip', kind: 'clip', ref: s.clipId, in: 0, out: null } : null
  const broll: CutShot | null = s.brollId ? { id: 'broll', kind: 'broll', ref: s.brollId, in: s.brollStart, out: s.brollStart + Math.min(s.brollSeconds, maxBroll) } : null
  const shots = (s.order === 'broll_first' ? [broll, clip] : [clip, broll]).filter((x): x is CutShot => !!x)
  return { auto: true, shots, captions: [{ id: 'main', text: null, start: 0, end: null }] }
}

interface Placed { shot: CutShot; start: number; in: number; out: number; dur: number; src: number | null; title: string; poster: string | null; video: string | null; ready: boolean }

// Each shot's real trim and place (the renderer's planShots, in short).
function place(cut: Cut, info: (s: CutShot) => { src: number | null; title: string; poster: string | null; video: string | null; ready: boolean }, o: { maxClip: number; maxBroll: number; maxTotal: number }): Placed[] {
  const out: Placed[] = []
  let at = 0
  for (const shot of cut.shots) {
    const i = info(shot)
    const len = i.src ?? (shot.out ?? (shot.in + 5))
    const start = Math.min(Math.max(0, shot.in), Math.max(0, len - 0.2))
    let end = shot.out == null ? len : Math.min(len, Math.max(start + 0.2, shot.out))
    if (shot.out == null) end = Math.min(end, start + (shot.kind === 'clip' ? o.maxClip : o.maxBroll))
    end = Math.min(end, start + Math.max(0, o.maxTotal - at))
    const dur = end - start
    if (dur < 0.2) break
    out.push({ shot, start: at, in: start, out: end, dur, ...i })
    at += dur
  }
  return out
}

export function RoughCut({ ctx }: { ctx: PostCtx }) {
  const { item, data, draft, lib, v } = ctx
  const spec = draft.spec as unknown as MemeSpec
  const o = data.options
  const manual = spec.cut && !spec.cut.auto && spec.cut.shots.length ? spec.cut : null
  const cut = manual ?? autoCut(spec, o.meme.max_broll_seconds)
  const [sel, setSel] = useState<string | null>(null)
  const [adding, setAdding] = useState<'clip' | 'broll' | null>(null)
  const limits = { maxClip: o.meme.max_clip_seconds, maxBroll: o.meme.max_broll_seconds, maxTotal: o.cut?.max_seconds ?? 90 }
  const clips = lib?.clips ?? []
  const info = (s: CutShot) => {
    if (s.kind === 'clip') {
      const c: LibraryClip | undefined = clips.find(x => x.id === s.ref)
      return { src: c?.durationSec ?? null, title: c?.title ?? 'Clip', poster: c?.posterId ?? null, video: c?.assetId || null, ready: c?.status === 'approved' && !!c.assetId }
    }
    const b = data.broll.find(x => x.id === s.ref)
    return { src: b?.durationSec ?? null, title: b ? `B-roll: ${b.title}` : 'B-roll', poster: null, video: b?.assetId ?? null, ready: b?.status === 'ready' && !!b.assetId }
  }
  const placed = place(cut, info, limits)
  const total = placed.reduce((a, p) => a + p.dur, 0) || 1
  const selected = placed.find(p => p.shot.id === sel) ?? null

  // Every edit makes the cut the owner's (auto off) and saves it.
  function save(next: Cut) { draft.setSpec({ cut: { ...next, auto: false } } as never) }
  const edit = (fn: (c: Cut) => Cut) => save(fn({ auto: false, shots: cut.shots.map(s => ({ ...s })), captions: cut.captions.map(c => ({ ...c })) }))
  const move = (id: string, d: -1 | 1) => edit(c => {
    const i = c.shots.findIndex(s => s.id === id), j = i + d
    if (i < 0 || j < 0 || j >= c.shots.length) return c
    ;[c.shots[i], c.shots[j]] = [c.shots[j]!, c.shots[i]!]
    return c
  })
  const trim = (id: string, patch: Partial<Pick<CutShot, 'in' | 'out'>>) => edit(c => ({ ...c, shots: c.shots.map(s => (s.id === id ? { ...s, ...patch } : s)) }))
  const remove = (id: string) => { setSel(null); edit(c => ({ ...c, shots: c.shots.filter(s => s.id !== id) })) }
  const add = (kind: 'clip' | 'broll', ref: string) => {
    setAdding(null)
    const shot: CutShot = { id: uid(), kind, ref, in: 0, out: kind === 'broll' ? Math.min(o.meme.broll_seconds, data.broll.find(b => b.id === ref)?.durationSec ?? o.meme.broll_seconds) : null }
    setSel(shot.id)
    edit(c => ({ ...c, shots: [...c.shots, shot] }))
  }
  const setCaption = (id: string, patch: Partial<CutCaption>) => edit(c => ({ ...c, captions: c.captions.map(x => (x.id === id ? { ...x, ...patch } : x)) }))
  const addCaption = () => edit(c => ({ ...c, captions: [...c.captions, { id: uid(), text: '', start: r1(Math.max(0, total - 2)), end: null }] }))
  const removeCaption = (id: string) => edit(c => ({ ...c, captions: c.captions.filter(x => x.id !== id) }))
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`
  const ticks = useMemo(() => {
    const step = total > 40 ? 10 : total > 16 ? 5 : total > 6 ? 2 : 1
    return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step)
  }, [total])

  return (
    <section className="st-card st-roughcut" data-field="rough-cut">
      <div className="st-card-head">
        <Film size={16} />
        <div className="grow">
          <div className="st-h3">Rough cut</div>
          <div className="st-hint">{r1(total)} s · {manual ? 'Edited here. Changes in the steps above are not added; Rebuild starts again from them.' : 'Built from the steps above. Click a block to trim, move or remove it.'}</div>
        </div>
        {manual && <button type="button" className="st-btn sm ghost" onClick={() => { setSel(null); draft.setSpec({ cut: null } as never) }}><RotateCcw size={13} />Rebuild from the steps</button>}
      </div>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        {!placed.length ? <Callout tone="info">No shots yet. Pick a clip in the Video step, or add one here.</Callout> : (
          <div className="st-tracks" role="group" aria-label="Timeline">
            <div className="st-track">
              <span className="st-track-label"><Film size={12} />Video</span>
              <div className="st-track-lane">
                {placed.map(p => (
                  <button key={p.shot.id} type="button" className={`st-block ${p.shot.kind} ${sel === p.shot.id ? 'on' : ''} ${p.ready ? '' : 'waiting'}`} style={{ width: pct(p.dur) }} onClick={() => setSel(s => (s === p.shot.id ? null : p.shot.id))} title={`${p.title}, ${r1(p.dur)} s`}>
                    {p.poster ? <Img assetId={p.poster} width={120} className="st-block-pic" /> : p.video ? <video className="st-block-pic" src={firstFrame(p.video)} muted playsInline preload="metadata" /> : null}
                    <span className="st-block-label">{p.shot.kind === 'broll' ? <Clapperboard size={11} /> : null}{p.title}</span>
                    <span className="st-block-dur">{r1(p.dur)} s</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="st-track">
              <span className="st-track-label"><Type size={12} />Text</span>
              <div className="st-track-lane abs">
                {cut.captions.map(c => {
                  const end = c.end == null ? total : Math.min(total, c.end)
                  const text = (c.text ?? spec.caption).trim()
                  return <div key={c.id} className={`st-block caption ${text ? '' : 'empty'}`} style={{ left: pct(c.start), width: pct(Math.max(0.3, end - c.start)) }} title={text || 'No text yet'}><span className="st-block-label">{text || 'No text yet'}</span></div>
                })}
              </div>
            </div>
            <SoundLane ctx={ctx} />
            <div className="st-ruler">{ticks.map(t => <span key={t} style={{ left: pct(t) }}>{t}s</span>)}</div>
          </div>
        )}
        {selected && (
          <div className="st-blockedit">
            <b>{selected.title}</b>
            <span className="st-hint">{selected.src != null ? `${r1(selected.src)} s source` : 'Length not known yet'}{selected.ready ? '' : ' · still being prepared'}</span>
            <label className="st-row" style={{ gap: 6 }}>Starts at
              <input className="st-input st-num" type="number" min={0} step={0.1} value={r1(selected.in)} onChange={e => trim(selected.shot.id, { in: Math.max(0, Number(e.target.value) || 0) })} aria-label="Starts at, seconds into the source" /> s
            </label>
            <label className="st-row" style={{ gap: 6 }}>Ends at
              <input className="st-input st-num" type="number" min={0} step={0.1} value={r1(selected.out)} onChange={e => trim(selected.shot.id, { out: Math.max(0, Number(e.target.value) || 0) })} aria-label="Ends at, seconds into the source" /> s
            </label>
            {selected.shot.out != null && <button type="button" className="st-btn sm ghost" onClick={() => trim(selected.shot.id, { out: null })}>To the end</button>}
            <span className="st-spacer" />
            <button type="button" className="st-btn sm ghost icon" disabled={placed[0]?.shot.id === selected.shot.id} onClick={() => move(selected.shot.id, -1)} aria-label="Move earlier"><ArrowLeft size={14} /></button>
            <button type="button" className="st-btn sm ghost icon" disabled={placed[placed.length - 1]?.shot.id === selected.shot.id} onClick={() => move(selected.shot.id, 1)} aria-label="Move later"><ArrowRight size={14} /></button>
            <button type="button" className="st-btn sm bad" onClick={() => remove(selected.shot.id)}><Trash2 size={13} />Remove</button>
          </div>
        )}
        <div className="st-col" style={{ gap: 8 }}>
          {cut.captions.map((c, i) => (
            <div key={c.id} className="st-captionrow">
              <span className="st-label" style={{ minWidth: 70 }}>Caption {i + 1}</span>
              {c.text == null
                ? <span className="st-hint" style={{ flex: 1 }}>Uses the caption from the Caption step{spec.caption.trim() ? `: "${spec.caption.trim().slice(0, 60)}"` : ' (empty)'}. <button type="button" className="st-linkbtn" onClick={() => setCaption(c.id, { text: spec.caption })}>Write a different one</button></span>
                : <input className="st-input" style={{ flex: 1, minWidth: 160 }} value={c.text} maxLength={400} onChange={e => setCaption(c.id, { text: e.target.value })} placeholder="e.g. wait for it" aria-label={`Caption ${i + 1} text`} />}
              <label className="st-row" style={{ gap: 4 }}>from <input className="st-input st-num" type="number" min={0} step={0.1} value={r1(c.start)} onChange={e => setCaption(c.id, { start: Math.max(0, Number(e.target.value) || 0) })} aria-label={`Caption ${i + 1} starts at`} /> s</label>
              <label className="st-row" style={{ gap: 4 }}>to <input className="st-input st-num" type="number" min={0} step={0.1} value={c.end == null ? '' : r1(c.end)} placeholder="end" onChange={e => setCaption(c.id, { end: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} aria-label={`Caption ${i + 1} ends at`} /> s</label>
              {cut.captions.length > 1 && <button type="button" className="st-btn sm ghost icon" onClick={() => removeCaption(c.id)} aria-label={`Remove caption ${i + 1}`}><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="st-btn sm" onClick={() => setAdding('clip')}><Plus size={13} />Add a clip</button>
          <button type="button" className="st-btn sm" onClick={() => setAdding('broll')}><Plus size={13} />Add B-roll</button>
          <button type="button" className="st-btn sm" onClick={addCaption}><Plus size={13} />Add a caption</button>
        </div>
      </div>
      {item.characterId && <LibraryDrawer open={adding === 'clip'} onClose={() => setAdding(null)} kind="clips" characterId={item.characterId} characterName={v?.data.name ?? 'this character'} picked={[]} onPick={id => add('clip', id)} />}
      <BrollAdd data={data} open={adding === 'broll'} onClose={() => setAdding(null)} onPick={id => add('broll', id)} />
    </section>
  )
}

function BrollAdd({ data, open, onClose, onPick }: { data: ContentData; open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const ready = data.broll.filter(b => b.status === 'ready' && b.assetId)
  return (
    <Drawer open={open} onClose={onClose} title="Add B-roll to the cut">
      {!ready.length ? <Callout tone="info">No B-roll yet. Upload screen recordings in the Video step or Library &gt; B-roll.</Callout> : (
        <div className="st-refgrid">
          {ready.map(b => (
            <button key={b.id} type="button" className="st-refchoice" onClick={() => onPick(b.id)} title={b.title}>
              <video className="st-content-thumb" src={firstFrame(b.assetId!)} muted playsInline preload="metadata" />
              <span>{b.title}{b.durationSec ? ` · ${b.durationSec} s` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </Drawer>
  )
}

// The sound track lane of the timeline: what the bed will hold.
function SoundLane({ ctx }: { ctx: PostCtx }) {
  const spec = ctx.draft.spec as unknown as MemeSpec
  const sounds = useSounds().data?.sounds ?? []
  const def = ctx.data.options.sound?.defaultAmbience ?? 'room'
  const amb = spec.sound?.ambience ?? def
  const ambLabel = amb === 'none' ? null : amb === 'room' ? 'Room tone' : sounds.find(s => s.id === amb)?.title ?? 'Ambience'
  const music = spec.sound?.music ? sounds.find(s => s.id === spec.sound!.music)?.title ?? 'Music' : null
  return (
    <div className="st-track">
      <span className="st-track-label"><AudioLines size={12} />Sound</span>
      <div className="st-track-lane stack">
        {ambLabel ? <div className="st-block sound"><span className="st-block-label"><Wind size={11} />{ambLabel}</span></div> : <div className="st-block sound empty"><span className="st-block-label">No ambience</span></div>}
        {music && <div className="st-block sound music"><span className="st-block-label"><Music size={11} />{music}</span></div>}
      </div>
    </div>
  )
}

// The Sound row (video posts and batches): ambience, music, levels, ducking.
export function SoundRow({ ctx }: { ctx: PostCtx }) {
  const { item, draft, data } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const worker = useWorkerGate()
  const sounds = useSounds()
  const cut = useCut(item.id, item.kind === 'meme' ? JSON.stringify([(draft.spec as unknown as MemeSpec).cut, (draft.spec as unknown as MemeSpec).clipId]) : 'none', item.kind === 'meme')
  const spec = draft.spec as unknown as { sound?: Partial<SoundSpec> }
  const def = data.options.sound?.defaultAmbience ?? 'room'
  const s: SoundSpec = { ambience: def, ambienceLevel: 'normal', music: null, musicLevel: 'normal', duck: true, clipSound: true, ...(spec.sound ?? {}) }
  const set = (patch: Partial<SoundSpec>) => draft.setSpec({ sound: { ...s, ...patch } } as never)
  const list = sounds.data?.sounds ?? []
  const ambiences = list.filter(x => x.kind === 'ambience' && x.status !== 'failed')
  const tracks = list.filter(x => x.kind === 'music' && x.status !== 'failed')
  const [uploading, setUploading] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const input = useRef<HTMLInputElement | null>(null)
  const kindRef = useRef<'ambience' | 'music'>('music')
  const maxMb = data.options.sound?.maxUploadMb ?? 50
  const hasClipSound = item.kind === 'meme' ? !!cut.data?.sound.hasClipSound : false
  async function upload(file: File | undefined) {
    if (!file) return
    if (file.size > maxMb * 1024 * 1024) { toast({ tone: 'bad', text: `${file.name} is over ${maxMb} MB.` }); return }
    setUploading(`Uploading ${file.name}...`)
    try {
      const row = await api.addSound(file, kindRef.current)
      setAdded(a => [...a, row.id])
      if (kindRef.current === 'music') set({ music: row.id })
      else set({ ambience: row.id })
      await qc.invalidateQueries({ queryKey: ['sounds'] })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setUploading(null) }
  }
  const pick = (kind: 'ambience' | 'music') => { kindRef.current = kind; input.current?.click() }
  const chosenMusic = tracks.find(t => t.id === s.music) ?? null
  return (
    <section className="st-card st-soundrow" data-field="post-sound">
      <div className="st-card-head"><Volume2 size={16} /><div className="grow"><div className="st-h3">Sound</div><div className="st-hint">Mixed on the worker and normalized to {data.options.sound?.targetLufs ?? -14} LUFS (TikTok, Reels, Shorts). Ambience alone stays quiet. No AI music.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f) }} />
        <div className="st-soundline">
          <span className="st-label"><Wind size={13} />Ambience</span>
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`st-chip ${s.ambience === 'none' ? 'on' : ''}`} onClick={() => set({ ambience: 'none' })}>None</button>
            <button type="button" className={`st-chip ${s.ambience === 'room' ? 'on' : ''}`} onClick={() => set({ ambience: 'room' })} title="A quiet room, made by code">Room tone</button>
            {ambiences.map(a => <SoundChip key={a.id} sound={a} on={s.ambience === a.id} onClick={() => set({ ambience: a.id })} />)}
            <button type="button" className="st-chip" disabled={!!uploading || !worker.ready} onClick={() => pick('ambience')}><Upload size={12} />Upload a recording</button>
          </div>
          {s.ambience !== 'none' && <Levels value={s.ambienceLevel} onChange={l => set({ ambienceLevel: l })} label="Ambience level" />}
        </div>
        <div className="st-soundline">
          <span className="st-label"><Music size={13} />Music</span>
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`st-chip ${!s.music ? 'on' : ''}`} onClick={() => set({ music: null })}>None</button>
            {tracks.map(t => <SoundChip key={t.id} sound={t} on={s.music === t.id} onClick={() => set({ music: t.id })} />)}
            <button type="button" className="st-chip" disabled={!!uploading || !worker.ready} onClick={() => pick('music')}><Upload size={12} />Upload a track</button>
          </div>
          {s.music && (
            <div className="st-row" style={{ gap: 14, flexWrap: 'wrap' }}>
              <Levels value={s.musicLevel} onChange={l => set({ musicLevel: l })} label="Music level" />
              <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
                <button type="button" role="switch" aria-checked={s.duck} className={`st-switch ${s.duck ? 'on' : ''}`} onClick={() => set({ duck: !s.duck })}><span /></button>
                <span className="st-hint">Dip the music under {hasClipSound ? 'the clip\'s own sound' : 'any clip sound'}</span>
              </label>
              {chosenMusic?.assetId && <audio className="st-audio" src={assetUrl(chosenMusic.assetId)} controls preload="none" />}
            </div>
          )}
          <span className="st-hint">Use music you have the rights to (for ads, a commercial library such as TikTok's or CapCut's).</span>
        </div>
        {hasClipSound && (
          <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
            <button type="button" role="switch" aria-checked={s.clipSound} className={`st-switch ${s.clipSound ? 'on' : ''}`} onClick={() => set({ clipSound: !s.clipSound })}><span /></button>
            <span className="st-col" style={{ gap: 0 }}><b>Keep the clip's own sound</b><span className="st-hint">A clone with its original sound.</span></span>
          </label>
        )}
        {uploading && <span className="st-hint"><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> {uploading}</span>}
        {!worker.ready && <span className="st-hint st-warntext" role="status">{worker.reason} Uploads are prepared by the worker.</span>}
        <RunStatus match={j => added.some(id => j.purpose === `sound_ingest:${id}`)} />
      </div>
    </section>
  )
}

function SoundChip({ sound, on, onClick }: { sound: SoundItem; on: boolean; onClick: () => void }) {
  const waiting = sound.status === 'processing'
  return (
    <button type="button" className={`st-chip ${on ? 'on' : ''}`} onClick={onClick} title={[sound.tag, sound.durationSec ? `${sound.durationSec} s` : '', sound.loudness != null ? `${sound.loudness} LUFS` : ''].filter(Boolean).join(' · ')}>
      {waiting && <Loader2 size={11} className="st-spin" />}{sound.title}
    </button>
  )
}

function Levels({ value, onChange, label }: { value: SoundLevel; onChange: (l: SoundLevel) => void; label: string }) {
  return (
    <div className="st-seg sm" role="radiogroup" aria-label={label}>
      {(['quiet', 'normal', 'loud'] as const).map(l => <button key={l} type="button" role="radio" aria-checked={value === l} className={value === l ? 'on' : ''} onClick={() => onChange(l)}>{l === 'quiet' ? 'Quiet' : l === 'normal' ? 'Normal' : 'Loud'}</button>)}
    </div>
  )
}
