import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AudioLines, Loader2, Mic, Music, Upload, Volume2, Wind } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { useCut, useSounds, useVoiceLines, useWorkerGate } from '../../hooks'
import { RunStatus } from '../../runs'
import { Callout, errorMessage, useToast } from '../../ui'
import type { Cut, CutShot, MemeSpec, PostVoice, SoundItem, SoundLevel, SoundSpec } from '../../types'
import type { PostCtx } from './ctx'
import { Link } from 'react-router-dom'

// The automatic cut and the Sound row (Phase 3; UX-PLAN.md sections 8 and
// 12). The cut is what the Studio lays out on the post's timeline from the
// steps above (the clip, its B-roll before or after, the caption over the
// whole video); edits are placed in the editor. The Sound row sets the bed:
// Room tone or an uploaded ambience, an uploaded music track (ducked),
// mixed and normalized to social loudness. No AI music. A video post can
// also take a voiceover: one of the character's converted voice lines
// (UX-PLAN.md section 13), with captions from its words.

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
  const voice = s.voice ?? null
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
                <span className="st-hint">Dip the music under {voice ? 'the voiceover' : hasClipSound ? 'the clip\'s own sound' : 'any clip sound'}</span>
              </label>
              {chosenMusic?.assetId && <audio className="st-audio" src={assetUrl(chosenMusic.assetId)} controls preload="none" />}
            </div>
          )}
          <span className="st-hint">Use music you have the rights to (for ads, a commercial library such as TikTok's or CapCut's).</span>
        </div>
        {item.kind === 'meme' && <VoiceoverLine ctx={ctx} voice={voice} onChange={v => set({ voice: v })} />}
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

// The voiceover (voice lines): one of the character's converted lines, where
// it starts, its level, and whether its words are the captions.
function VoiceoverLine({ ctx, voice, onChange }: { ctx: PostCtx; voice: PostVoice | null; onChange: (v: PostVoice | null) => void }) {
  const { item } = ctx
  const lines = useVoiceLines(item.characterId)
  const list = lines.data?.lines ?? []
  const ready = list.filter(l => l.status === 'ready' && l.assetId)
  const waiting = list.filter(l => l.status === 'take' || l.status === 'converting' || l.status === 'processing').length
  const chosen = ready.find(l => l.id === voice?.id) ?? null
  const [at, setAt] = useState(String(voice?.at ?? 0))
  const pick = (id: string) => { setAt('0'); onChange({ id, at: 0, level: 'normal', captions: true }) }
  const saved = !!(ctx.draft.spec as unknown as MemeSpec).editor?.projectAssetId
  return (
    <div className="st-soundline" data-field="post-voiceover">
      <span className="st-label"><Mic size={13} />Voiceover</span>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={`st-chip ${!voice ? 'on' : ''}`} onClick={() => onChange(null)}>None</button>
        {ready.map(l => <button key={l.id} type="button" className={`st-chip ${voice?.id === l.id ? 'on' : ''}`} onClick={() => pick(l.id)} title={l.transcript || l.line}>{l.tag ? `${l.tag}: ` : ''}{l.title}</button>)}
        {voice && !chosen && lines.data && <span className="st-hint st-warntext">The picked line is not converted any more; pick another.</span>}
      </div>
      {!ready.length && lines.data && (
        <span className="st-hint">{waiting ? `${waiting} take${waiting === 1 ? ' is' : 's are'} waiting to be converted` : 'No voice lines for this character yet'}: <Link className="st-todo-link" to={`/studio/library?tab=voice${item.characterId ? `&c=${item.characterId}` : ''}`}>Library, Voice lines</Link>.</span>
      )}
      {voice && (
        <div className="st-row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="st-row" style={{ gap: 6 }}>
            <span className="st-hint">Starts at</span>
            <input className="st-input" style={{ width: 72 }} inputMode="decimal" value={at} onChange={e => setAt(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => { const n = Math.max(0, Math.min(600, Number(at) || 0)); setAt(String(n)); if (n !== voice.at) onChange({ ...voice, at: n }) }} aria-label="Voiceover starts at, seconds" />
            <span className="st-hint">s</span>
          </label>
          <Levels value={voice.level ?? 'normal'} onChange={l => onChange({ ...voice, level: l })} label="Voiceover level" />
          <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
            <button type="button" role="switch" aria-checked={voice.captions} className={`st-switch ${voice.captions ? 'on' : ''}`} onClick={() => onChange({ ...voice, captions: !voice.captions })}><span /></button>
            <span className="st-hint">Captions from the voice line (each word timed; works with Karaoke captions)</span>
          </label>
          {chosen?.assetId && <audio className="st-audio" src={assetUrl(chosen.assetId)} controls preload="none" />}
        </div>
      )}
      {voice && saved && <span className="st-hint">This post's timeline was saved in the editor, so it keeps its own captions. The voice is mixed in on export, and the editor adds it on its own track the next time it opens.</span>}
    </div>
  )
}
