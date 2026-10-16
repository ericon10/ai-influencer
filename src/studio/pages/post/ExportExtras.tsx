import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clapperboard, Image as ImageIcon, Loader2, Sparkles, Split } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { keys, useWorkerGate } from '../../hooks'
import { Field, errorMessage, useToast } from '../../ui'
import { RunStatus } from '../../runs'
import { HowTo } from '../../guide/Guide'
import type { MemeSpec } from '../../types'
import type { PostCtx } from './ctx'
import { DownloadLink, fileSlug, postName } from './parts'
import { HookPicker } from './TextStep'

// Long run part 4 (UX-PLAN.md section 25): Export for TikTok, Reels or
// Shorts, hook variants (the same timeline with a different first 2
// seconds) and the cover. All free, on the worker.

type Preset = { id: string; label: string; max_seconds: number; video_kbps: number; lufs: number; true_peak: number }
const line = (p: Preset) => `up to ${p.max_seconds} s, ${Math.round(p.video_kbps / 100) / 10} Mbps, ${p.lufs} LUFS`

export function ExportFor({ ctx }: { ctx: PostCtx }) {
  const presets = ctx.data.options.exportPresets ?? []
  const spec = ctx.draft.spec as { exportPreset?: string }
  const current = presets.find(p => p.id === spec.exportPreset) ?? presets[0]
  if (!presets.length) return null
  return (
    <Field id="export-for" label="Export for" group hint="Sets the length cap, the bitrate cap and the loudness of the export, the editor's Done and the hook variants. Starting points; any of them works anywhere.">
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Export for">
        {presets.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={current?.id === p.id} className={`st-chip ${current?.id === p.id ? 'on' : ''}`} onClick={() => ctx.draft.setSpec({ exportPreset: p.id })} title={line(p)}>
            {current?.id === p.id && <Check size={12} />}{p.label}
          </button>
        ))}
      </div>
      {current && <span className="st-hint" data-field="export-preset-line">{current.label}: {line(current)}.</span>}
    </Field>
  )
}

// While the worker makes variants or a cover, the post is read again.
function usePoll(on: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!on) return
    const t = window.setInterval(() => void qc.invalidateQueries({ queryKey: keys.content }), 2500)
    return () => window.clearInterval(t)
  }, [on, qc])
}

export function HookVariants({ ctx }: { ctx: PostCtx }) {
  const { item, draft, data } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const worker = useWorkerGate()
  const opts = data.options.hookVariants ?? { max: 3, seconds: 2 }
  const spec = draft.spec as unknown as MemeSpec
  const hooks = Array.from({ length: opts.max }, (_, i) => spec.hookVariants?.[i] ?? '')
  const shotsOf = Array.from({ length: opts.max }, (_, i) => spec.hookShots?.[i] ?? null)
  const editsOf = Array.from({ length: opts.max }, (_, i) => spec.hookEdits?.[i] ?? null)
  const editOptions = data.options.hookEdits ?? []
  // The first shot comes from the Studio's own media for this post.
  const media = useQuery({ queryKey: ['editor-media', item.id], queryFn: () => api.editorMedia(item.id), staleTime: 60_000 })
  const groups = (media.data?.groups ?? []).map(g => ({ ...g, items: g.items.filter(x => x.kind !== 'audio') })).filter(g => g.items.length)
  const shotName = (id: string | null | undefined) => (id ? groups.flatMap(g => g.items).find(x => x.id === id)?.name ?? 'another shot' : null)
  const editName = (id: string | null | undefined) => (id ? editOptions.find(e => e.id === id)?.label ?? id : null)
  const [picking, setPicking] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const o = item.outputs
  usePoll(!!o.variantsRunning)
  const filled = hooks.filter((h, i) => h.trim() || shotsOf[i] || editsOf[i]).length
  const name = fileSlug(postName({ ...item, title: draft.fields.title, idea: draft.fields.idea }))
  const set = (i: number, text: string) => { const next = [...hooks]; next[i] = text; draft.setSpec({ hookVariants: next }) }
  const setShot = (i: number, id: string | null) => { const next = [...shotsOf]; next[i] = id; draft.setSpec({ hookShots: next }) }
  const setEdit = (i: number, id: string | null) => { const next = [...editsOf]; next[i] = id; draft.setSpec({ hookEdits: next }) }
  async function go() {
    setStarting(true)
    try {
      await draft.flush()
      await api.postVariants(item.id)
      await qc.invalidateQueries({ queryKey: keys.content })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setStarting(false) }
  }
  return (
    <section className="st-card" data-field="hook-variants">
      <div className="st-card-head">
        <Split size={16} />
        <div className="grow">
          <div className="st-h3 st-row" style={{ gap: 10 }}>Hook variants<HowTo id="post-finish" /></div>
          <div className="st-hint">The same video with a different first {opts.seconds} seconds: a hook line over 0 to {opts.seconds} s (in place of a caption there), a different first shot, a camera preset as the first edit, or any of them. The rest is identical. Post them to see which opening holds people.</div>
        </div>
      </div>
      <div className="st-card-body st-col" style={{ gap: 10 }}>
        {hooks.map((h, i) => {
          const L = String.fromCharCode(65 + i)
          return (
            <div key={i} className="st-col" style={{ gap: 6 }} data-field={`hook-variant-${L.toLowerCase()}`}>
              <div className="st-row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'center' }}>
                <span className="st-badge plain" style={{ flex: 'none' }}>{L}</span>
                <input className="st-input grow" value={h} maxLength={200} aria-label={`Hook ${L}`} placeholder={i === 0 ? 'e.g. nobody warned me about this part' : 'Another opening line'} onChange={e => set(i, e.target.value)} />
                <button type="button" className="st-btn sm ghost" onClick={() => setPicking(i)} title="Pick from the character's saved hooks"><Sparkles size={13} />Pick</button>
              </div>
              <div className="st-row st-hook-opts" style={{ gap: 8, flexWrap: 'wrap', paddingLeft: 30 }}>
                <label className="st-row st-hint" style={{ gap: 6, flex: '1 1 200px', minWidth: 0 }}>
                  <span style={{ flex: 'none' }}>First shot</span>
                  <select className="st-input sm grow" style={{ minWidth: 0 }} aria-label={`First shot ${L}`} value={shotsOf[i] ?? ''} onChange={e => setShot(i, e.target.value || null)}>
                    <option value="">Same as the video</option>
                    {groups.map(g => <optgroup key={g.id} label={g.label}>{g.items.map(x => <option key={x.id} value={x.id}>{x.name}{x.kind === 'image' ? ' (still)' : ''}</option>)}</optgroup>)}
                    {shotsOf[i] && !groups.some(g => g.items.some(x => x.id === shotsOf[i])) && <option value={shotsOf[i]!}>{media.isLoading ? 'Loading...' : 'A shot no longer listed'}</option>}
                  </select>
                </label>
                <label className="st-row st-hint" style={{ gap: 6, flex: '1 1 200px', minWidth: 0 }}>
                  <span style={{ flex: 'none' }}>First edit</span>
                  <select className="st-input sm grow" style={{ minWidth: 0 }} aria-label={`First edit ${L}`} value={editsOf[i] ?? ''} onChange={e => setEdit(i, e.target.value || null)}>
                    <option value="">None</option>
                    {editOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )
        })}
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="st-btn" disabled={!filled || starting || !!o.variantsRunning || !worker.ready || draft.saving || item.status === 'rendering'} onClick={() => void go()}>
            {starting || o.variantsRunning ? <Loader2 size={15} className="st-spin" /> : <Clapperboard size={15} />}
            {o.variantsRunning ? `Making ${Math.min((o.variants?.length ?? 0) + 1, Math.max(filled, 1))} of ${Math.max(filled, 1)}...` : filled ? `Export ${filled} version${filled === 1 ? '' : 's'}` : 'Export versions'}
            {!o.variantsRunning && <span className="st-price">Free</span>}
          </button>
          {!filled && <span className="st-hint">Write a hook, or pick a first shot or a first edit, to export its version.</span>}
        </div>
        <RunStatus match={j => j.purpose === `content_variants:${item.id}`} pending={starting} />
        {o.variantsError && <span className="st-hint st-warntext">The variants stopped: {o.variantsError}</span>}
        {(o.variants?.length ?? 0) > 0 && (
          <div className="st-content-videos" data-field="hook-variant-results">
            {o.variants!.map((v, i) => (
              <div key={v.assetId} className="st-col" style={{ gap: 6 }}>
                <video className="st-content-result sm" src={assetUrl(v.assetId)} controls playsInline preload="metadata" />
                <span className="st-hint"><b>{v.letter ?? String.fromCharCode(65 + i)}.</b> {[v.hook, v.shot ? `First shot: ${shotName(v.shot)}` : null, v.edit ? `First edit: ${editName(v.edit)}` : null].filter(Boolean).join(' · ')}</span>
                <DownloadLink assetId={v.assetId} name={`${name}-hook-${(v.letter ?? String.fromCharCode(65 + i)).toLowerCase()}.mp4`}>Download {v.letter ?? String.fromCharCode(65 + i)}</DownloadLink>
              </div>
            ))}
          </div>
        )}
      </div>
      <HookPicker open={picking !== null} onClose={() => setPicking(null)} characterId={item.characterId} onPick={t => { if (picking !== null) set(picking, t.slice(0, 200)); setPicking(null) }} />
    </section>
  )
}

export function CoverCard({ ctx }: { ctx: PostCtx }) {
  const { item, draft } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const worker = useWorkerGate()
  const o = item.outputs
  const spec = draft.spec as unknown as MemeSpec
  const [at, setAt] = useState(spec.cover?.at ?? 0)
  const [text, setText] = useState(spec.cover?.text ?? '')
  const [starting, setStarting] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null)
  usePoll(!!o.coverRunning)
  const name = fileSlug(postName({ ...item, title: draft.fields.title, idea: draft.fields.idea }))
  if (!o.videoAssetId || item.status !== 'ready') return null
  const total = o.durationSec ?? 0
  function seek(t: number) { setAt(t); if (video.current) video.current.currentTime = t }
  async function go() {
    setStarting(true)
    try {
      await api.postCover(item.id, { at, text })
      await qc.invalidateQueries({ queryKey: keys.content })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setStarting(false) }
  }
  return (
    <section className="st-card" data-field="cover-card">
      <div className="st-card-head">
        <ImageIcon size={16} />
        <div className="grow">
          <div className="st-h3 st-row" style={{ gap: 10 }}>Cover<HowTo id="post-finish" /></div>
          <div className="st-hint">Pick the frame people see before they tap, and the words on it. Upload the JPEG as the cover in TikTok or Instagram.</div>
        </div>
      </div>
      <div className="st-card-body st-row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="st-col" style={{ gap: 8, flex: '1 1 260px', minWidth: 0 }}>
          <video ref={video} className="st-content-result" style={{ width: 200 }} src={`${assetUrl(o.videoAssetId)}#t=${at.toFixed(2)}`} muted playsInline preload="metadata" onLoadedMetadata={() => { if (video.current) video.current.currentTime = at }} />
          <input type="range" min={0} max={Math.max(0.1, total - 0.05)} step={0.05} value={at} onChange={e => seek(Number(e.target.value))} aria-label="Cover frame" />
          <span className="st-hint st-mono" data-field="cover-at">Frame at {at.toFixed(2)} s</span>
          <Field id="cover-text" label="Cover text (optional)">
            <input className="st-input" value={text} maxLength={200} onChange={e => setText(e.target.value)} placeholder="e.g. day 1 of trying to be a morning person" />
          </Field>
          <div className="st-row" style={{ gap: 10 }}>
            <button type="button" className="st-btn" disabled={starting || !!o.coverRunning || !worker.ready} onClick={() => void go()}>
              {starting || o.coverRunning ? <Loader2 size={15} className="st-spin" /> : <ImageIcon size={15} />}{o.cover ? 'Make the cover again' : 'Make the cover'}<span className="st-price">Free</span>
            </button>
          </div>
          <RunStatus match={j => j.purpose === `content_cover:${item.id}`} pending={starting} />
        </div>
        {o.cover && (
          <div className="st-col" style={{ gap: 6 }} data-field="cover-result">
            <img src={assetUrl(o.cover.assetId, 480)} alt="The cover" style={{ width: 180, aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--st-line)' }} />
            <span className="st-hint">At {o.cover.at.toFixed(2)} s{o.cover.text ? `: ${o.cover.text}` : ', no text'}</span>
            <DownloadLink assetId={o.cover.assetId} name={`${name}-cover.jpg`}>Download the cover</DownloadLink>
          </div>
        )}
      </div>
    </section>
  )
}
