import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, RotateCcw, Upload } from 'lucide-react'
import '@fontsource/tiktok-sans/600.css'
import { api, assetUrl, downloadUrl } from '../../api'
import { keys, useCharacters, useWorkerGate } from '../../hooks'
import { Callout, Todo, errorMessage, useToast, type TodoItem } from '../../ui'
import { RunStatus } from '../../runs'
import type { BrollTiming, CaptionStyle, ContentData, ContentItem, ContentKind, PostStep } from '../../types'

// Shared parts of a post (UX-PLAN.md): saving as you type, the TikTok
// caption preview, B-roll, and the free export on the worker.

export const KIND_LABEL: Record<ContentKind, string> = { meme: 'Video post', slideshow: 'Slideshow', batch: 'Batch' }
export const NEW_POST: Array<[ContentKind, string, string]> = [
  ['meme', 'Video post', 'A clip with a caption, optional B-roll'],
  ['slideshow', 'Slideshow', 'Stills with a hook and slides'],
  ['batch', 'Batch', 'Many captions, many videos'],
]
export const AI_LABEL = "Turn on TikTok's AI-generated content label when you post."

// The steps of each post type, in order, with their names.
export const STEPS: Record<ContentKind, Array<[PostStep, string]>> = {
  meme: [['idea', 'Idea'], ['stills', 'Stills'], ['video', 'Video'], ['text', 'Caption'], ['finish', 'Finish']],
  slideshow: [['idea', 'Idea'], ['stills', 'Stills'], ['text', 'Slides'], ['finish', 'Finish']],
  batch: [['idea', 'Idea'], ['video', 'Clips'], ['text', 'Captions'], ['finish', 'Finish']],
}

export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post'
// Safari shows a video's first frame only with a start time in the link.
export const firstFrame = (id: string) => `${assetUrl(id)}#t=0.1`

export const postName = (i: Pick<ContentItem, 'title' | 'idea' | 'kind'>) => i.title.trim() || i.idea.trim().slice(0, 60) || `Untitled ${KIND_LABEL[i.kind].toLowerCase()}`

// ── Saving as you type ────────────────────────────────────────────────

type Fields = { title?: string; idea?: string; accountTag?: string }

export function usePostDraft<T extends object>(item: ContentItem) {
  const qc = useQueryClient()
  const toast = useToast()
  const [spec, setSpecState] = useState<T>(item.spec as T)
  const [fields, setFieldsState] = useState<Required<Fields>>({ title: item.title, idea: item.idea, accountTag: item.accountTag })
  const [pending, setPending] = useState(false)
  const dirtySpec = useRef<Partial<T>>({})
  const dirtyFields = useRef<Fields>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Claude's answer (or another tab) replaces what is not being edited.
  const serverKey = JSON.stringify([item.spec, item.title, item.idea, item.accountTag])
  useEffect(() => {
    setSpecState({ ...(item.spec as T), ...dirtySpec.current })
    setFieldsState({ title: item.title, idea: item.idea, accountTag: item.accountTag, ...dirtyFields.current })
  }, [serverKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const spec = dirtySpec.current, f = dirtyFields.current
    if (!Object.keys(spec).length && !Object.keys(f).length) { setPending(false); return }
    dirtySpec.current = {}
    dirtyFields.current = {}
    try {
      await api.updateContent(item.id, { ...f, ...(Object.keys(spec).length ? { spec: spec as Record<string, unknown> } : {}) })
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['estimate'] })
    } catch (e) {
      toast({ tone: 'bad', text: errorMessage(e) })
    } finally {
      setPending(Object.keys(dirtySpec.current).length + Object.keys(dirtyFields.current).length > 0)
    }
  }
  function schedule() {
    setPending(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 600)
  }
  function setSpec(patch: Partial<T>) {
    setSpecState(s => ({ ...s, ...patch }))
    dirtySpec.current = { ...dirtySpec.current, ...patch }
    schedule()
  }
  function setFields(patch: Fields) {
    setFieldsState(s => ({ ...s, ...patch }))
    dirtyFields.current = { ...dirtyFields.current, ...patch }
    schedule()
  }
  // Moves the post to a step right away (it reopens there).
  async function go(step: PostStep, patch: { spec?: Partial<T> } = {}) {
    if (patch.spec) { setSpecState(s => ({ ...s, ...patch.spec })); dirtySpec.current = { ...dirtySpec.current, ...patch.spec } }
    await flush()
    try {
      await api.updateContent(item.id, { step })
      await qc.invalidateQueries({ queryKey: keys.content })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { spec, setSpec, fields, setFields, flush, go, saving: pending }
}
export type PostDraft<T extends object> = ReturnType<typeof usePostDraft<T>>

// ── New posts ─────────────────────────────────────────────────────────

const LAST_CHARACTER = 'st-last-character'
const LAST_TAG = 'st-last-account-tag'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
export const remember = (k: 'character' | 'tag', v: string) => { try { localStorage.setItem(k === 'character' ? LAST_CHARACTER : LAST_TAG, v) } catch { /* private window */ } }

// A new post of a kind, with the character and account used last; it opens
// at once. Without a character, setup comes first.
export function useNewPost() {
  const nav = useNavigate()
  const toast = useToast()
  const chars = useCharacters()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<ContentKind | null>(null)
  // `open` adds to the post's link, e.g. "?clone=1" opens Clone Video.
  async function create(kind: ContentKind, extra: { characterId?: string; sceneId?: string | null; idea?: string; step?: PostStep; spec?: Record<string, unknown> } = {}, open = '') {
    const list = chars.data?.characters ?? []
    if (!list.length) { nav('/studio/characters'); return }
    const last = read(LAST_CHARACTER)
    const characterId = extra.characterId ?? (list.find(c => c.id === last) ?? list.find(c => c.progress.approved > 0) ?? list[0]!).id
    setBusy(kind)
    try {
      const { id } = await api.createContent({ kind, characterId, accountTag: read(LAST_TAG) ?? '', ...extra })
      await qc.invalidateQueries({ queryKey: keys.content })
      nav(`/studio/posts/${id}${open}`)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  return { create, busy, ready: !chars.isLoading }
}

// "Make another like this": a filled-in copy, opened at the Text step.
export function useDuplicate() {
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  return async (id: string) => {
    try {
      const out = await api.duplicateContent(id)
      await qc.invalidateQueries({ queryKey: keys.content })
      nav(`/studio/posts/${out.id}`)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
}

// ── The caption preview: TikTok's white box over the frame ───────────

// Where the caption sits and how it looks, scaled by k (preview px per
// frame px). Matches server/core/overlay.ts: the box or the outline style,
// top, upper third, middle or bottom.
export function captionCss(o: ContentData['options'], k: number, look?: CaptionStyle | null): { cls: string; box: CSSProperties; span: CSSProperties } {
  const c = o.caption
  const half = Math.min(o.canvas.width / 2 - c.safe.left, o.canvas.width / 2 - c.safe.right)
  const style = look ?? (c.style === 'outline' ? 'outline' : 'box')
  const upper = c.position === 'upper_third'
  const box: CSSProperties = {
    top: c.position === 'top' ? c.safe.top * k : upper ? Math.max(c.safe.top, o.canvas.height * 0.26) * k : undefined,
    bottom: c.position === 'bottom' ? c.safe.bottom * k : undefined,
    width: 2 * half * k,
    fontSize: c.size * k,
  }
  const span: CSSProperties = style === 'outline'
    ? { color: c.outline?.text ?? '#fff', WebkitTextStroke: `${Math.max(1, c.size * (c.outline?.width ?? 0.11) * k)}px ${c.outline?.stroke ?? '#000'}`, paintOrder: 'stroke fill', padding: `${c.box.pad_y * k}px 0` }
    : { padding: `${c.box.pad_y * k}px ${c.box.pad_x * k}px`, borderRadius: c.box.radius * k, background: c.box.fill, color: c.box.text }
  return { cls: `st-captionbox ${upper ? 'upper' : c.position}`, box, span }
}

export function CaptionPreview({ text, data, video, image, width = 240, look }: { text: string; data: ContentData; video?: string | null; image?: string | null; width?: number; look?: CaptionStyle | null }) {
  const o = data.options
  const k = width / o.canvas.width
  const css = captionCss(o, k, look)
  return (
    <div className="st-captionframe" style={{ width, height: (width * o.canvas.height) / o.canvas.width }}>
      {video ? <video src={assetUrl(video)} autoPlay muted loop playsInline /> : image ? <img src={assetUrl(image, 480)} alt="" /> : null}
      {text.trim() && (
        <div className={css.cls} style={css.box}>
          <span style={css.span}>{text.trim()}</span>
        </div>
      )}
    </div>
  )
}

// Box or Outline for one post's captions (the account default first).
// White box, Outline, or No caption (owner, 2026-10-15): No caption keeps
// the post's words for switching back and the style it had.
export function CaptionStylePick({ value, onChange, data, off = false, onOff }: { value: CaptionStyle | null | undefined; onChange: (v: CaptionStyle) => void; data: ContentData; off?: boolean; onOff?: (off: boolean) => void }) {
  const style = value ?? (data.options.caption.style === 'outline' ? 'outline' : 'box')
  const current = off ? 'none' : style
  const pick = (id: CaptionStyle | 'none') => {
    if (id === 'none') return onOff?.(true)
    if (off) onOff?.(false)
    onChange(id)
  }
  return (
    <div className="st-seg sm" role="radiogroup" aria-label="Caption style" data-field="caption-choice">
      {([['box', 'White box'], ['outline', 'Outline'], ...(onOff ? [['none', 'No caption']] as const : [])] as const).map(([id, label]) => (
        <button key={id} type="button" role="radio" aria-checked={current === id} className={current === id ? 'on' : ''} onClick={() => pick(id)}>{label}</button>
      ))}
    </div>
  )
}

// ── B-roll: pick one (a video post) or several (a batch), cut in hard ──

export function BrollPicker({ data, ids, multi, onChange, timing, setTiming }: {
  data: ContentData; ids: string[]; multi: boolean; onChange: (ids: string[]) => void
  timing: BrollTiming; setTiming: (p: Partial<BrollTiming>) => void
}) {
  const [product, setProduct] = useState<string | null>(null)
  const ready = data.broll.filter(b => b.status === 'ready' && b.assetId)
  const preparing = data.broll.filter(b => b.status === 'processing').length
  const shown = ready.filter(b => !product || b.product === product)
  const picked = ids.map(id => ready.find(b => b.id === id)).filter(b => !!b)
  const shortest = picked.reduce((m, b) => Math.min(m, b!.durationSec ?? m), Infinity)
  const max = data.options.meme.max_broll_seconds
  function toggle(id: string) {
    if (!multi) { onChange(ids[0] === id ? [] : [id]); return }
    onChange(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }
  return (
    <div className="st-col" style={{ gap: 10 }}>
      {data.products.length > 0 && (
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`st-chip ${product === null ? 'on' : ''}`} onClick={() => setProduct(null)}>All products</button>
          {data.products.map(p => <button key={p} type="button" className={`st-chip ${product === p ? 'on' : ''}`} onClick={() => setProduct(p)}>{p}</button>)}
        </div>
      )}
      <div className="st-refgrid">
        {!multi && <button type="button" className={`st-refchoice ${!ids.length ? 'on' : ''}`} onClick={() => onChange([])}><span className="st-refnone">None</span><span>No B-roll</span></button>}
        {shown.map(b => {
          const n = ids.indexOf(b.id)
          return (
            <button key={b.id} type="button" className={`st-refchoice ${n >= 0 ? 'on' : ''}`} onClick={() => toggle(b.id)} title={b.title}>
              <video className="st-content-thumb" src={firstFrame(b.assetId!)} muted playsInline preload="metadata" />
              <span>{multi && n >= 0 ? `${n + 1}. ` : ''}{b.title}{b.product ? ` · ${b.product}` : ''}</span>
            </button>
          )
        })}
      </div>
      <BrollUpload data={data} />
      {preparing > 0 && <span className="st-hint"><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> {preparing} B-roll {preparing === 1 ? 'clip is' : 'clips are'} being prepared.</span>}
      {picked.length > 0 && (
        <div className="st-row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <div className="st-seg" role="radiogroup" aria-label="Order">
            <button type="button" className={timing.order === 'clip_first' ? 'on' : ''} onClick={() => setTiming({ order: 'clip_first' })}>Clip, then B-roll</button>
            <button type="button" className={timing.order === 'broll_first' ? 'on' : ''} onClick={() => setTiming({ order: 'broll_first' })}>B-roll, then clip</button>
          </div>
          <label className="st-row" style={{ gap: 6 }}><span className="st-hint">From</span><input className="st-input st-num" type="number" min={0} step={0.5} value={timing.brollStart} onChange={e => setTiming({ brollStart: Math.max(0, Number(e.target.value) || 0) })} /><span className="st-hint">s, for</span>
            <input className="st-input st-num" type="number" min={0.5} max={max} step={0.5} value={timing.brollSeconds} onChange={e => setTiming({ brollSeconds: Math.min(max, Math.max(0.5, Number(e.target.value) || 0.5)) })} />
            <span className="st-hint">s{Number.isFinite(shortest) ? ` (${picked.length > 1 ? 'shortest clip' : 'clip'} is ${shortest} s)` : ''}. Hard cut, never a crossfade.</span></label>
        </div>
      )}
      {multi && picked.length > 1 && <span className="st-hint">Rotated across the captions: video 1 uses the first, video 2 the second, and so on.</span>}
    </div>
  )
}

// Add B-roll right here (it goes to Library > B-roll too).
export function BrollUpload({ data }: { data: ContentData }) {
  const toast = useToast()
  const qc = useQueryClient()
  const worker = useWorkerGate()
  const input = useRef<HTMLInputElement | null>(null)
  const [product, setProduct] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  async function upload(files: File[]) {
    // A screenshot (an image) becomes a still B-roll clip (the green screen's background).
    const videos = files.filter(f => f.type.startsWith('video/') || f.type.startsWith('image/') || /\.(mp4|mov|webm|m4v|png|jpe?g|webp)$/i.test(f.name))
    if (!videos.length) { toast({ tone: 'bad', text: 'Pick video files (MP4, MOV or WebM) or a screenshot (PNG or JPEG).' }); return }
    for (const [i, f] of videos.entries()) {
      setBusy(`Uploading ${f.name} (${i + 1} of ${videos.length})...`)
      try { const b = await api.addBroll(f, product); setAdded(a => [...a, b.id]) } catch (e) { toast({ tone: 'bad', text: `${f.name}: ${errorMessage(e)}` }) }
    }
    setBusy(null)
    await qc.invalidateQueries({ queryKey: keys.content })
  }
  return (
    <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <input className="st-input" style={{ maxWidth: 200 }} list="post-broll-products" value={product} onChange={e => setProduct(e.target.value)} placeholder="Product, e.g. Notion" aria-label="Product for new B-roll" />
      <datalist id="post-broll-products">{data.products.map(p => <option key={p} value={p} />)}</datalist>
      <input ref={input} type="file" accept="video/*,image/png,image/jpeg,image/webp" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} />
      <button type="button" className="st-btn sm" disabled={!!busy || !worker.ready} onClick={() => input.current?.click()} title="A screen recording, a phone video, or a screenshot">{busy ? <Loader2 size={14} className="st-spin" /> : <Upload size={14} />}Upload B-roll</button>
      {busy && <span className="st-hint">{busy}</span>}
      {!worker.ready && <span className="st-hint st-warntext">{worker.reason}</span>}
      <RunStatus match={j => added.some(id => j.purpose === `broll_ingest:${id}`)} />
    </div>
  )
}

// ── Export: free, rendered on the worker ──────────────────────────────

export function ExportPanel({ item, todo, saving, flush, label, onStart, children }: { item: ContentItem; todo: TodoItem[]; saving: boolean; flush: () => Promise<void>; label: string; onStart?: () => void; children?: ReactNode }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [starting, setStarting] = useState(false)
  async function go() {
    setStarting(true)
    try {
      await flush()
      await api.renderContent(item.id)
      onStart?.()
      await qc.invalidateQueries({ queryKey: keys.content })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setStarting(false) }
  }
  const o = item.outputs
  const rendering = item.status === 'rendering'
  const worker = useWorkerGate()
  return (
    <div className="st-col" style={{ gap: 10 }}>
      <Todo items={todo} />
      <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button className="st-btn primary big" disabled={todo.length > 0 || saving || starting || rendering || !worker.ready} onClick={go}>
          {starting || rendering ? <Loader2 size={16} className="st-spin" /> : item.status === 'ready' || item.status === 'failed' ? <RotateCcw size={16} /> : <Download size={16} />}
          {starting ? 'Submitting...' : rendering ? (o.total ? `Rendering ${Math.min((o.done ?? 0) + (o.failed ?? 0) + 1, o.total)} of ${o.total}...` : 'Rendering...') : item.status === 'ready' || item.status === 'failed' ? `${label} again` : label}
          {!starting && !rendering && <span className="st-price">Free</span>}
        </button>
        {saving && <span className="st-hint st-row" style={{ gap: 6 }}><Loader2 size={13} className="st-spin" />Saving...</span>}
      </div>
      {!worker.ready && <span className="st-hint st-warntext" role="status">{worker.reason}</span>}
      <RunStatus match={j => j.purpose === `content_render:${item.id}` || j.purpose === `editor_save:${item.id}`} pending={starting} />
      <span className="st-hint">Renders on the Studio's worker: no provider, no cost. 9:16, silent unless the clip kept its original sound. {AI_LABEL}</span>
      {item.status === 'failed' && item.error && (() => {
        const why = renderFailure(item.error)
        return (
          <Callout tone="bad">
            <div className="st-col" style={{ gap: 6 }}>
              <span>{why.plain}</span>
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="st-btn sm" disabled={starting || rendering || !worker.ready || todo.length > 0} onClick={go}><RotateCcw size={13} />Retry<span className="st-price">Free</span></button>
              </div>
              {why.detail && <details><summary className="st-hint">Details</summary><pre className="st-license" style={{ maxHeight: 160 }}>{why.detail}</pre></details>}
            </div>
          </Callout>
        )
      })()}
      {children}
    </div>
  )
}

// A failed render in plain words: our own messages stay; anything technical
// (an ffmpeg error) becomes one line with the detail under Details. Mirrors
// server/jobs/jobView.ts explainFailure for work done on the worker.
export function renderFailure(error: string): { plain: string; detail: string | null } {
  const raw = error.trim()
  if (/ffmpeg|ffprobe|filter|exited with code|invalid argument|provider reported a failure/i.test(raw) || raw.length > 160 || /[{}[\]\\]/.test(raw)) return { plain: 'The render failed on our side. Nothing was charged.', detail: raw }
  return { plain: raw, detail: null }
}

export function DownloadLink({ assetId, name, children }: { assetId: string; name: string; children: ReactNode }) {
  return <a className="st-btn secondary sm" href={downloadUrl(assetId, name)}><Download size={14} />{children}</a>
}

// A job's result, polled until it ends (Punch it up's options).
const DONE = ['completed', 'failed', 'canceled', 'needs_attention']
export function useJobResult(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId!),
    enabled: !!jobId,
    refetchInterval: query => (DONE.includes(query.state.data?.job.status ?? '') ? false : 1500),
  })
}
export const jobDone = (status?: string) => !!status && DONE.includes(status)

// No em-dashes in anything shown or saved (SPEC 5.7 rule 42).
export const noDash = (s: string) => s.replace(/\s*\u2014\s*/g, ', ').trim()
