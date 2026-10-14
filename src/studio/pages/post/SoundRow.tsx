import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AudioLines, Loader2, Music, Upload, Volume2, Wind } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { useCut, useSounds, useWorkerGate } from '../../hooks'
import { RunStatus } from '../../runs'
import { Callout, errorMessage, useToast } from '../../ui'
import type { Cut, CutShot, MemeSpec, SoundItem, SoundLevel, SoundSpec } from '../../types'
import type { PostCtx } from './ctx'

// The automatic cut and the Sound row (Phase 3; UX-PLAN.md sections 8 and
// 12). The cut is what the Studio lays out on the post's timeline from the
// steps above (the clip, its B-roll before or after, the caption over the
// whole video); edits are placed in the editor. The Sound row sets the bed:
// Room tone or an uploaded ambience, an uploaded music track (ducked),
// mixed and normalized to social loudness. No AI music.

// The automatic cut (the same rule as the server's core/cut.ts).
export function autoCut(s: MemeSpec, maxBroll: number): Cut {
  const clip: CutShot | null = s.clipId ? { id: 'clip', kind: 'clip', ref: s.clipId, in: 0, out: null } : null
  const broll: CutShot | null = s.brollId ? { id: 'broll', kind: 'broll', ref: s.brollId, in: s.brollStart, out: s.brollStart + Math.min(s.brollSeconds, maxBroll) } : null
  const clipB: CutShot | null = s.clipId && s.clipB ? { id: 'clipB', kind: 'clip', ref: s.clipB, in: 0, out: null } : null
  const shots = (s.order === 'broll_first' ? [broll, clip, clipB] : [clip, clipB, broll]).filter((x): x is CutShot => !!x)
  return { auto: true, shots, captions: [{ id: 'main', text: null, start: 0, end: null }] }
}

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
