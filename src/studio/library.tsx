import { useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, Loader2, Minus, Upload } from 'lucide-react'
import { api, assetUrl } from './api'
import { useLibrary, useRefresh, useWorkerGate } from './hooks'
import { Callout, Drawer, Img, errorMessage, isFresh, useToast } from './ui'
import { RunStatus } from './runs'
import { HowTo } from './guide/Guide'
import { DeleteButton, TileCheck } from './trash'
import { THUMB_W, ViewButton, Viewer, useViewer, type ViewerItem } from './viewer'
import type { LibraryClip, LibraryStill } from './types'

// The Library's grids (UX-PLAN.md): stills and clips across characters. The
// Library page browses them; inside a post they open as a drawer to pick
// from, and the pick drops into the step. A tap opens the viewer (section
// 34); in a drawer a tap picks, and the view button on the tile opens it.

const firstFrame = (id: string) => `${assetUrl(id)}#t=0.1`
// Select mode (Library, owner 2026-10-15): the tile toggles its checkbox.
export interface GridSelect<T> { has: (id: string) => boolean; toggle: (x: T) => void }
// The viewer's own buttons for an item; `close` closes it first.
export type ViewActions<T> = (x: T, close: () => void) => ReactNode

const usedLine = (n: number | undefined) => (n == null ? '' : n ? `Used in ${n === 1 ? '1 post' : `${n} posts`}` : '')
export const stillItem = (s: LibraryStill): ViewerItem => ({ id: s.id, assetId: s.assetId, media: 'image', name: s.sceneTitle || 'Still', thumbId: s.assetId, createdAt: s.createdAt, characterName: s.characterName })
export const clipItem = (c: LibraryClip): ViewerItem => ({ id: c.id, assetId: c.assetId, media: 'video', name: c.title || 'Clip', thumbId: c.posterId, createdAt: c.createdAt, characterName: c.characterName })

export function StillGrid({ stills, picked = [], onPick, action, viewActions, showCharacter = false, select, onDelete }: { stills: LibraryStill[]; picked?: string[]; onPick?: (s: LibraryStill) => void; action?: (s: LibraryStill) => ReactNode; viewActions?: ViewActions<LibraryStill>; showCharacter?: boolean; select?: GridSelect<LibraryStill> | null; onDelete?: (s: LibraryStill) => void }) {
  const v = useViewer()
  const byId = new Map(stills.map(s => [s.id, s]))
  return (
    <>
    <div className="st-grid scenes">
      {stills.map(s => {
        const n = picked.indexOf(s.id)
        const on = !!select?.has(s.id)
        const body = (
          <>
            <Img assetId={s.assetId} width={THUMB_W} style={{ aspectRatio: '9 / 16' }} />
            {select ? <TileCheck on={on} /> : n >= 0 && <span className="st-badge ok">{picked.length > 1 ? `${n + 1}` : <Check size={12} />}</span>}
          </>
        )
        const name = s.sceneTitle || 'Still'
        return (
          <div key={s.id} className={`st-tile st-scene-tile ${n >= 0 || on ? 'picked' : ''} ${isFresh(s.createdAt) ? 'st-new' : ''}`} data-id={s.id}>
            {select ? <button type="button" className="st-tile-open" onClick={() => select.toggle(s)} aria-pressed={on} aria-label={`Select ${name}`}>{body}</button>
              : onPick ? <button type="button" className="st-tile-open" onClick={() => onPick(s)} aria-pressed={n >= 0} aria-label={`Pick ${name}`}>{body}</button>
              : <button type="button" className="st-tile-open" onClick={() => v.open(s.id)} aria-label={`View ${name}`}>{body}</button>}
            {onPick && !select && <ViewButton onClick={() => v.open(s.id)} label={name} />}
            <div className="st-tile-meta">
              <div className="st-col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <span className="st-tile-label">{name}</span>
                <span className="st-hint">{[showCharacter ? s.characterName : '', s.op === 'upload_image' ? 'Uploaded' : '', s.status === 'approved' ? 'Picked' : '', usedLine(s.used)].filter(Boolean).join(' · ')}</span>
              </div>
              {onDelete && !select && <DeleteButton onClick={() => onDelete(s)} label={name} />}
            </div>
            {action && !select && <div className="st-tile-action">{action(s)}</div>}
          </div>
        )
      })}
    </div>
    <Viewer items={stills.map(stillItem)} openId={v.openId} onOpen={v.open} onClose={v.close}
      actions={(x, close) => { const s = byId.get(x.id); return s ? (viewActions ? viewActions(s, close) : action?.(s)) : null }} />
    </>
  )
}

// A clip tile loads its small picture (the still it started from, or an
// upload's first frame); the clip itself plays on hover (on a computer)
// and in the viewer.
function ClipThumb({ c }: { c: LibraryClip }) {
  const [hover, setHover] = useState(false)
  if (!c.posterId) return <video className="st-clip" src={firstFrame(c.assetId)} muted loop playsInline preload="metadata" style={{ aspectRatio: '9 / 16' }} onMouseEnter={e => void e.currentTarget.play().catch(() => {})} onMouseLeave={e => e.currentTarget.pause()} />
  return (
    <div className="st-clip-thumb" onMouseEnter={() => { if (window.matchMedia('(hover: hover)').matches) setHover(true) }} onMouseLeave={() => setHover(false)}>
      <Img assetId={c.posterId} width={THUMB_W} style={{ aspectRatio: '9 / 16' }} />
      {hover && <video src={assetUrl(c.assetId)} muted loop playsInline autoPlay aria-hidden />}
    </div>
  )
}

export function ClipGrid({ clips, picked = [], onPick, action, viewActions, showCharacter = false, select, onDelete }: { clips: LibraryClip[]; picked?: string[]; onPick?: (c: LibraryClip) => void; action?: (c: LibraryClip) => ReactNode; viewActions?: ViewActions<LibraryClip>; showCharacter?: boolean; select?: GridSelect<LibraryClip> | null; onDelete?: (c: LibraryClip) => void }) {
  const v = useViewer()
  const ready = (c: LibraryClip) => c.status === 'approved' && !!c.assetId
  const viewable = clips.filter(ready)
  const byId = new Map(viewable.map(c => [c.id, c]))
  return (
    <>
    <div className="st-grid scenes">
      {clips.map(c => {
        const n = picked.indexOf(c.id)
        const on = !!select?.has(c.id)
        const ok = ready(c)
        const body = (
          <>
            {ok
              ? <ClipThumb c={c} />
              : <div className="st-clip st-clip-empty" style={{ aspectRatio: '9 / 16' }}>{c.status === 'failed' ? <AlertTriangle size={18} /> : <Loader2 size={18} className="st-spin" />}</div>}
            {select ? <TileCheck on={on} /> : n >= 0 && <span className="st-badge ok">{picked.length > 1 ? `${n + 1}` : <Check size={12} />}</span>}
            {!ok && <span className={`st-badge ${c.status === 'failed' ? 'bad' : 'accent live'}`}>{c.status === 'failed' ? 'Failed' : 'Preparing'}</span>}
          </>
        )
        return (
          <div key={c.id} className={`st-tile st-scene-tile ${n >= 0 || on ? 'picked' : ''} ${isFresh(c.createdAt) ? 'st-new' : ''}`} data-id={c.id}>
            {select ? <button type="button" className="st-tile-open" onClick={() => select.toggle(c)} aria-pressed={on} aria-label={`Select ${c.title}`}>{body}</button>
              : onPick && ok ? <button type="button" className="st-tile-open" onClick={() => onPick(c)} aria-pressed={n >= 0} aria-label={`Pick ${c.title}`}>{body}</button>
              : ok ? <button type="button" className="st-tile-open" onClick={() => v.open(c.id)} aria-label={`View ${c.title}`}>{body}</button>
              : <div className="st-tile-open">{body}</div>}
            {onPick && ok && !select && <ViewButton onClick={() => v.open(c.id)} label={c.title} />}
            <div className="st-tile-meta">
              <div className="st-col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <span className="st-tile-label">{c.title}</span>
                <span className="st-hint">{[showCharacter ? c.characterName : '', c.op === 'upload' ? 'Uploaded' : c.op === 'video_upscale' ? 'Upscaled take' : c.op === 'clone' ? 'Clone' : 'Take', c.durationSec ? `${c.durationSec} s` : '', usedLine(c.used)].filter(Boolean).join(' · ')}</span>
                {c.error && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>{c.error}</span>}
              </div>
              {onDelete && !select && c.status !== 'generating' && <DeleteButton onClick={() => onDelete(c)} label={c.title} />}
            </div>
            {action && ok && !select && <div className="st-tile-action">{action(c)}</div>}
          </div>
        )
      })}
    </div>
    <Viewer items={viewable.map(clipItem)} openId={v.openId} onOpen={v.open} onClose={v.close}
      actions={(x, close) => { const c = byId.get(x.id); return c ? (viewActions ? viewActions(c, close) : action?.(c)) : null }} />
    </>
  )
}

// Upload images (owner, 2026-10-15): several at once, dropped on a computer
// or picked from the camera roll on a phone (the file picker offers it).
// They land in Library > Stills for the character picked, kept exactly as
// uploaded: the same file at full resolution, never downscaled, recompressed
// or converted. From a slideshow they are added to it too.
const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/
export function StillUpload({ characters, characterId, contentId, onUploaded }: { characters: Array<{ id: string; name: string }>; characterId: string | null; contentId?: string; onUploaded?: (ids: string[]) => void }) {
  const toast = useToast()
  const refresh = useRefresh()
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  // Fixed in a slideshow (the post's character); picked in the Library.
  const forId = contentId ? characterId : chosen ?? characterId ?? characters[0]?.id ?? null
  const forName = characters.find(c => c.id === forId)?.name ?? 'this character'
  async function upload(files: File[]) {
    if (!forId || !files.length) return
    const images = files.filter(f => IMAGE_TYPES.test(f.type))
    const skipped = files.filter(f => !IMAGE_TYPES.test(f.type))
    if (skipped.length) toast({ tone: 'bad', text: `${skipped.map(f => f.name).join(', ')}: not a PNG, JPEG or WebP image${/hei[cf]/i.test(skipped.map(f => f.type || f.name).join(' ')) ? '. On an iPhone, share HEIC photos as JPEG (Settings > Camera > Formats > Most Compatible)' : ''}.` })
    if (!images.length) return
    setBusy(`Uploading ${images.length} image${images.length === 1 ? '' : 's'}...`)
    try {
      const { stills } = await api.addStills(forId, images, contentId, (done, total) => setBusy(`Uploading ${done} of ${total}...`))
      toast({ tone: 'ok', text: `Added ${stills.length} image${stills.length === 1 ? '' : 's'} to Library > Stills for ${forName}${contentId ? ' and to this slideshow' : ''}, exactly as uploaded.` })
      onUploaded?.(stills.map(x => x.id))
    } catch (e) {
      toast({ tone: 'bad', text: errorMessage(e) })
    } finally {
      setBusy(null)
      refresh(forId)
    }
  }
  return (
    <div className={`st-drop st-still-drop ${over ? 'over' : ''}`} data-field="still-upload"
      onDragOver={e => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); void upload(Array.from(e.dataTransfer.files)) }}>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Upload images" onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} />
      <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="st-btn" disabled={!!busy || !forId} onClick={() => input.current?.click()}>
          {busy ? <Loader2 size={15} className="st-spin" /> : <Upload size={15} />}Upload images
        </button>
        {!contentId && characters.length > 1 && (
          <label className="st-row" style={{ gap: 6 }}>
            <span className="st-hint">For</span>
            <select className="st-input sm" aria-label="Upload for" value={forId ?? ''} onChange={e => setChosen(e.target.value)} disabled={!!busy}>
              {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <span className="st-hint">{busy ?? `Several at once: drop them here, or pick them (the camera roll on a phone). PNG, JPEG or WebP. Kept exactly as uploaded, at full resolution, as stills of ${forName}.`}</span>
      <HowTo id={contentId ? 'post-stills' : 'library'} label="About uploads" />
    </div>
  )
}

// Any video becomes a kept clip of the character (picked in the post it came
// from, when there is one). The worker prepares a lean copy without sound.
export function ClipUpload({ characterId, contentId, label = 'Upload a video', onUploaded, variant = '', slot }: { characterId: string; contentId?: string; label?: string; onUploaded?: (id: string) => void; variant?: string; slot?: 'a' | 'b' }) {
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
      try { const { id } = await api.addClip(characterId, f, contentId, undefined, slot); setAdded(a => [...a, id]); onUploaded?.(id) } catch (e) { toast({ tone: 'bad', text: `${f.name}: ${errorMessage(e)}` }) }
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
            ? <StillGrid stills={list as LibraryStill[]} picked={picked} onPick={s => { onPick(s.id); if (!multi) onClose() }} viewActions={(s, close) => <UseInPost on={picked.includes(s.id)} multi={multi} use={() => { onPick(s.id); if (!multi) { close(); onClose() } }} />} />
            : <ClipGrid clips={list as LibraryClip[]} picked={picked} onPick={c => { onPick(c.id); if (!multi) onClose() }} viewActions={(c, close) => <UseInPost on={picked.includes(c.id)} multi={multi} use={() => { onPick(c.id); if (!multi) { close(); onClose() } }} />} />}
        {multi && <div className="st-row"><span className="st-spacer" /><button className="st-btn primary" onClick={onClose}>Done</button></div>}
      </div>
    </Drawer>
  )
}

// In the viewer over a post's Library drawer: the same as picking the tile.
function UseInPost({ on, multi, use }: { on: boolean; multi: boolean; use: () => void }) {
  if (multi) return on ? <button type="button" className="st-btn" onClick={use}><Minus size={15} />Take it out of the post</button> : <button type="button" className="st-btn primary" onClick={use}><CheckCircle2 size={15} />Use in this post</button>
  return on ? <span className="st-badge ok"><Check size={12} /> In this post</span> : <button type="button" className="st-btn primary" onClick={use}><CheckCircle2 size={15} />Use in this post</button>
}
