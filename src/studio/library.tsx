import { useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Loader2, Upload } from 'lucide-react'
import { api, assetUrl } from './api'
import { useLibrary, useRefresh, useWorkerGate } from './hooks'
import { Callout, Drawer, Img, errorMessage, isFresh, useToast } from './ui'
import { RunStatus } from './runs'
import type { LibraryClip, LibraryStill } from './types'

// The Library's grids (UX-PLAN.md): stills and clips across characters. The
// Library page browses them; inside a post they open as a drawer to pick
// from, and the pick drops into the step.

const firstFrame = (id: string) => `${assetUrl(id)}#t=0.1`

export function StillGrid({ stills, picked = [], onPick, action, showCharacter = false }: { stills: LibraryStill[]; picked?: string[]; onPick?: (s: LibraryStill) => void; action?: (s: LibraryStill) => ReactNode; showCharacter?: boolean }) {
  return (
    <div className="st-grid scenes">
      {stills.map(s => {
        const n = picked.indexOf(s.id)
        const body = (
          <>
            <Img assetId={s.assetId} width={420} style={{ aspectRatio: '9 / 16' }} />
            {n >= 0 && <span className="st-badge ok">{picked.length > 1 ? `${n + 1}` : <Check size={12} />}</span>}
          </>
        )
        return (
          <div key={s.id} className={`st-tile st-scene-tile ${n >= 0 ? 'picked' : ''} ${isFresh(s.createdAt) ? 'st-new' : ''}`}>
            {onPick ? <button type="button" className="st-tile-open" onClick={() => onPick(s)} aria-pressed={n >= 0}>{body}</button> : <div className="st-tile-open">{body}</div>}
            <div className="st-col" style={{ gap: 2, padding: '0 4px 2px' }}>
              <span className="st-tile-label">{s.sceneTitle || 'Still'}</span>
              <span className="st-hint">{[showCharacter ? s.characterName : '', s.status === 'approved' ? 'Picked' : ''].filter(Boolean).join(' · ')}</span>
            </div>
            {action && <div className="st-tile-action">{action(s)}</div>}
          </div>
        )
      })}
    </div>
  )
}

export function ClipGrid({ clips, picked = [], onPick, action, showCharacter = false }: { clips: LibraryClip[]; picked?: string[]; onPick?: (c: LibraryClip) => void; action?: (c: LibraryClip) => ReactNode; showCharacter?: boolean }) {
  return (
    <div className="st-grid scenes">
      {clips.map(c => {
        const n = picked.indexOf(c.id)
        const ready = c.status === 'approved' && !!c.assetId
        const body = (
          <>
            {ready
              ? <video className="st-clip" src={firstFrame(c.assetId)} poster={c.posterId ? assetUrl(c.posterId, 420) : undefined} muted loop playsInline preload="metadata" style={{ aspectRatio: '9 / 16' }} onMouseEnter={e => void e.currentTarget.play().catch(() => {})} onMouseLeave={e => e.currentTarget.pause()} />
              : <div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}>{c.status === 'failed' ? <AlertTriangle size={18} /> : <Loader2 size={18} className="st-spin" />}</div>}
            {n >= 0 && <span className="st-badge ok">{picked.length > 1 ? `${n + 1}` : <Check size={12} />}</span>}
            {!ready && <span className={`st-badge ${c.status === 'failed' ? 'bad' : 'accent live'}`}>{c.status === 'failed' ? 'Failed' : 'Preparing'}</span>}
          </>
        )
        return (
          <div key={c.id} className={`st-tile st-scene-tile ${n >= 0 ? 'picked' : ''} ${isFresh(c.createdAt) ? 'st-new' : ''}`}>
            {onPick && ready ? <button type="button" className="st-tile-open" onClick={() => onPick(c)} aria-pressed={n >= 0}>{body}</button> : <div className="st-tile-open">{body}</div>}
            <div className="st-col" style={{ gap: 2, padding: '0 4px 2px' }}>
              <span className="st-tile-label">{c.title}</span>
              <span className="st-hint">{[showCharacter ? c.characterName : '', c.op === 'upload' ? 'Uploaded' : c.op === 'video_upscale' ? 'Upscaled take' : c.op === 'clone' ? 'Clone' : 'Take', c.durationSec ? `${c.durationSec} s` : ''].filter(Boolean).join(' · ')}</span>
              {c.error && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>{c.error}</span>}
            </div>
            {action && ready && <div className="st-tile-action">{action(c)}</div>}
          </div>
        )
      })}
    </div>
  )
}

// Any video becomes a kept clip of the character (picked in the post it came
// from, when there is one). The worker prepares a lean copy without sound.
export function ClipUpload({ characterId, contentId, label = 'Upload a video', onUploaded, variant = '' }: { characterId: string; contentId?: string; label?: string; onUploaded?: (id: string) => void; variant?: string }) {
  const toast = useToast()
  const refresh = useRefresh()
  const worker = useWorkerGate()
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  async function upload(files: File[]) {
    const videos = files.filter(f => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name))
    if (!videos.length) { toast({ tone: 'bad', text: 'Pick a video file (MP4, MOV or WebM).' }); return }
    for (const [i, f] of videos.entries()) {
      setBusy(`Uploading ${f.name}${videos.length > 1 ? ` (${i + 1} of ${videos.length})` : ''}...`)
      try { const { id } = await api.addClip(characterId, f, contentId); setAdded(a => [...a, id]); onUploaded?.(id) } catch (e) { toast({ tone: 'bad', text: `${f.name}: ${errorMessage(e)}` }) }
    }
    setBusy(null)
    refresh(characterId)
  }
  return (
    <span className="st-row" style={{ gap: 8 }}>
      <input ref={input} type="file" accept="video/*" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} />
      <button type="button" className={`st-btn ${variant}`} disabled={!!busy || !worker.ready} onClick={() => input.current?.click()} title={worker.ready ? 'Any video file; it becomes a clip in Library > Clips' : worker.reason ?? undefined}>
        {busy ? <Loader2 size={15} className="st-spin" /> : <Upload size={15} />}{label}
      </button>
      {busy && <span className="st-hint">{busy}</span>}
      <RunStatus match={j => added.some(id => j.purpose === `clip_ingest:${id}`)} />
    </span>
  )
}

// The Library as a drawer inside a post: pick, and it drops into the step.
export function LibraryDrawer({ open, onClose, kind, characterId, characterName, picked, multi = false, onPick }: {
  open: boolean; onClose: () => void; kind: 'stills' | 'clips'; characterId: string; characterName: string
  picked: string[]; multi?: boolean; onPick: (id: string) => void
}) {
  const lib = useLibrary(characterId)
  const d = lib.data
  const list = kind === 'stills' ? d?.stills ?? [] : (d?.clips ?? []).filter(c => c.status !== 'failed')
  return (
    <Drawer open={open} onClose={onClose} wide title={<span>{kind === 'stills' ? 'Stills' : 'Clips'} of {characterName} <span className="st-muted">from the Library</span></span>}>
      <div className="st-col" style={{ gap: 14 }}>
        <span className="st-hint">{multi ? 'Pick as many as you like, in order; press again to remove one.' : 'Pick one; it drops into the post.'}</span>
        {!d ? <div className="st-skel" style={{ height: 240, borderRadius: 18 }} />
          : !list.length ? <Callout tone="info">{kind === 'stills' ? `No stills of ${characterName} yet. Make some in the Stills step.` : `No clips of ${characterName} yet. Upload a video, or make a take from a still.`}</Callout>
          : kind === 'stills'
            ? <StillGrid stills={list as LibraryStill[]} picked={picked} onPick={s => { onPick(s.id); if (!multi) onClose() }} />
            : <ClipGrid clips={list as LibraryClip[]} picked={picked} onPick={c => { onPick(c.id); if (!multi) onClose() }} />}
        {multi && <div className="st-row"><span className="st-spacer" /><button className="st-btn primary" onClick={onClose}>Done</button></div>}
      </div>
    </Drawer>
  )
}
