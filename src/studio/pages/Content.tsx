import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, Check, Clapperboard, Copy, Download, Film, Images, Layers, Loader2, Plus, RotateCcw, Upload, X } from 'lucide-react'
import '@fontsource/tiktok-sans/600.css'
import { api, assetUrl, downloadUrl } from '../api'
import { keys, useCharacters, useContent, useScenes, useWorkerGate } from '../hooks'
import { PriceButton } from '../PriceButton'
import { Callout, Field, Img, Todo, errorMessage, useToast, type TodoItem } from '../ui'
import type { BatchSpec, BrollClip, ContentData, ContentItem, ContentKind, MemeSpec, SceneStill, ScenesData, SlideshowSpec } from '../types'

// The text-overlay content builder (owner, 2026-10-13): meme videos (a kept
// clip, optional B-roll cut in hard, a TikTok caption box), slideshows
// (stills with Claude's hook and slide text), batches (many captions, many
// videos) and the B-roll library. Exports render on the worker for free;
// only Claude's writing is priced. Drafts save as you type.

type Tab = ContentKind | 'broll'
const TABS: Array<[Tab, string, ReactNode]> = [
  ['meme', 'Meme video', <Film size={14} key="m" />],
  ['slideshow', 'Slideshow', <Images size={14} key="s" />],
  ['batch', 'Batch', <Layers size={14} key="b" />],
  ['broll', 'B-roll library', <Clapperboard size={14} key="r" />],
]
const KIND_LABEL: Record<ContentKind, string> = { meme: 'meme video', slideshow: 'slideshow', batch: 'batch' }
const AI_LABEL = "Turn on TikTok's AI-generated content label when you post."

export default function Content() {
  const [params, setParams] = useSearchParams()
  const chars = useCharacters()
  const content = useContent()
  const tab = (params.get('tab') as Tab | null) ?? 'meme'
  const characters = chars.data?.characters ?? []
  const characterId = params.get('c') ?? characters[0]?.id ?? null
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }
  return (
    <div className="st-page">
      <div className="st-pagehead">
        <div className="grow"><div className="st-kicker">Content</div><h1 className="st-h1">Text-overlay content</h1></div>
        {tab !== 'broll' && characters.length > 0 && (
          <label className="st-row" style={{ gap: 8 }}>
            <span className="st-label" style={{ margin: 0 }}>Character</span>
            <select className="st-select" value={characterId ?? ''} onChange={e => set({ c: e.target.value, item: null })}>
              {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="st-seg" role="tablist" style={{ marginBottom: 20 }}>
        {TABS.map(([k, label, icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k, item: null })}><span className="st-row" style={{ gap: 6 }}>{icon}{label}</span></button>
        ))}
      </div>
      {!content.data ? <div className="st-skel" style={{ height: 240, borderRadius: 18 }} />
        : tab === 'broll' ? <BrollTab data={content.data} />
        : !characterId ? <Callout tone="info">Make a character first. Content uses their kept clips and stills.</Callout>
        : <Builder key={`${tab}:${characterId}`} kind={tab} data={content.data} characterId={characterId} itemId={params.get('item')} onItem={id => set({ item: id })} />}
    </div>
  )
}

// ── Drafts: one per post, saved as you type ─────────────────────────────

function useDraft<T extends object>(item: ContentItem) {
  const qc = useQueryClient()
  const toast = useToast()
  const [spec, setSpec] = useState<T>(item.spec as T)
  const [pending, setPending] = useState(false)
  const dirty = useRef<Partial<T>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Claude's answer (or another tab) replaces fields not being edited.
  const serverKey = JSON.stringify(item.spec)
  useEffect(() => { setSpec({ ...(item.spec as T), ...dirty.current }) }, [serverKey]) // eslint-disable-line react-hooks/exhaustive-deps
  async function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const patch = dirty.current
    if (!Object.keys(patch).length) { setPending(false); return }
    dirty.current = {}
    try {
      await api.updateContent(item.id, { spec: patch as Record<string, unknown> })
      qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['estimate'] })
    } catch (e) {
      toast({ tone: 'bad', text: errorMessage(e) })
    } finally {
      setPending(Object.keys(dirty.current).length > 0)
    }
  }
  function set(patch: Partial<T>) {
    setSpec(s => ({ ...s, ...patch }))
    dirty.current = { ...dirty.current, ...patch }
    setPending(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 600)
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { spec, set, flush, saving: pending }
}

function Builder({ kind, data, characterId, itemId, onItem }: { kind: ContentKind; data: ContentData; characterId: string; itemId: string | null; onItem: (id: string | null) => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const scenes = useScenes(characterId)
  const items = data.items.filter(i => i.kind === kind && i.characterId === characterId)
  const item = items.find(i => i.id === itemId) ?? items[0] ?? null
  const [creating, setCreating] = useState(false)
  async function create() {
    setCreating(true)
    try {
      const { id } = await api.createContent({ kind, characterId })
      await qc.invalidateQueries({ queryKey: keys.content })
      onItem(id)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setCreating(false) }
  }
  async function archive(id: string) {
    try { await api.archiveContent(id); await qc.invalidateQueries({ queryKey: keys.content }); onItem(null) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-col" style={{ gap: 18 }}>
      <div className="st-row st-content-list" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="st-btn primary sm" onClick={create} disabled={creating}>{creating ? <Loader2 size={14} className="st-spin" /> : <Plus size={14} />}New {KIND_LABEL[kind]}</button>
        {items.map((i, n) => (
          <button key={i.id} className={`st-chip ${item?.id === i.id ? 'on' : ''}`} onClick={() => onItem(i.id)} title={i.title || undefined}>
            {itemName(i, items.length - n)}{i.status === 'rendering' ? <Loader2 size={12} className="st-spin" /> : i.status === 'ready' ? <Check size={12} /> : null}
          </button>
        ))}
      </div>
      {!item ? (
        <Callout tone="info">{kind === 'meme' ? 'A meme video is a kept clip, an optional B-roll cut, and a caption in TikTok\'s white box.' : kind === 'slideshow' ? 'A slideshow is your stills with a hook and 5 to 7 slides of text Claude writes, exported as images in order.' : 'A batch is many captions on one clip and B-roll: one video per caption.'} Press New {KIND_LABEL[kind]} to start.</Callout>
      ) : !scenes.data ? <div className="st-skel" style={{ height: 240, borderRadius: 18 }} />
        : kind === 'meme' ? <MemeEditor key={item.id} item={item} data={data} scenes={scenes.data} characterId={characterId} onArchive={() => archive(item.id)} />
        : kind === 'slideshow' ? <SlideshowEditor key={item.id} item={item} data={data} scenes={scenes.data} characterId={characterId} onArchive={() => archive(item.id)} />
        : <BatchEditor key={item.id} item={item} data={data} scenes={scenes.data} characterId={characterId} onArchive={() => archive(item.id)} />}
    </div>
  )
}

const itemName = (i: ContentItem, n: number) => i.title || (i.kind === 'meme' && (i.spec as { caption?: string }).caption?.trim().slice(0, 28)) || (i.kind === 'slideshow' && (i.spec as { topic?: string }).topic?.trim().slice(0, 28)) || (i.kind === 'batch' && (i.spec as { topic?: string }).topic?.trim().slice(0, 28)) || `${KIND_LABEL[i.kind]} ${n}`

// ── Sources: kept clips, stills, B-roll ─────────────────────────────────

type Clip = SceneStill & { sceneTitle: string; posterId?: string | null }
// Kept takes (and their upscales), each with its start still as the poster.
function keptClips(scenes: ScenesData): Clip[] {
  return scenes.scenes.flatMap(s => s.candidates.filter(c => c.media === 'video' && c.assetId && c.status === 'approved').map(c => {
    let parent = s.candidates.find(p => p.id === c.parentId)
    while (parent && parent.media === 'video') parent = s.candidates.find(p => p.id === parent!.parentId)
    return { ...c, sceneTitle: s.title || 'Scene', posterId: parent?.assetId ?? null }
  }))
}
// Safari shows a video's first frame only with a start time in the link.
const firstFrame = (id: string) => `${assetUrl(id)}#t=0.1`
function usableStills(scenes: ScenesData): Clip[] {
  const bad = ['failed', 'rejected', 'superseded', 'qa_failed', 'qa_pending']
  return scenes.scenes.flatMap(s => s.candidates.filter(c => c.media === 'image' && c.assetId && !bad.includes(c.status)).map(c => ({ ...c, sceneTitle: s.title || 'Scene' })))
    .sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'))
}

function ClipPicker({ scenes, value, onChange }: { scenes: ScenesData; value: string | null; onChange: (id: string) => void }) {
  const clips = keptClips(scenes)
  if (!clips.length) return <Callout tone="info">No kept clips yet. Keep a take in a scene's Videos (press Keep), and it shows up here.</Callout>
  return (
    <div className="st-refgrid">
      {clips.map(c => (
        <button key={c.id} type="button" className={`st-refchoice ${value === c.id ? 'on' : ''}`} onClick={() => onChange(c.id)} title={c.sceneTitle}>
          <video className="st-content-thumb" src={firstFrame(c.assetId!)} poster={c.posterId ? assetUrl(c.posterId, 320) : undefined} muted playsInline preload="metadata" />
          <span>{c.sceneTitle}{c.op === 'video_upscale' ? ' (upscaled)' : ''}</span>
        </button>
      ))}
    </div>
  )
}

function BrollFields({ data, spec, set }: { data: ContentData; spec: Pick<MemeSpec, 'brollId' | 'order' | 'brollStart' | 'brollSeconds'>; set: (p: Partial<MemeSpec>) => void }) {
  const [product, setProduct] = useState<string | null>(null)
  const ready = data.broll.filter(b => b.status === 'ready' && b.assetId)
  const shown = ready.filter(b => !product || b.product === product)
  const picked = ready.find(b => b.id === spec.brollId) ?? null
  const max = data.options.meme.max_broll_seconds
  return (
    <div className="st-col" style={{ gap: 10 }}>
      {data.products.length > 0 && (
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`st-chip ${product === null ? 'on' : ''}`} onClick={() => setProduct(null)}>All products</button>
          {data.products.map(p => <button key={p} type="button" className={`st-chip ${product === p ? 'on' : ''}`} onClick={() => setProduct(p)}>{p}</button>)}
        </div>
      )}
      <div className="st-refgrid">
        <button type="button" className={`st-refchoice ${!spec.brollId ? 'on' : ''}`} onClick={() => set({ brollId: null })}><span className="st-refnone">None</span><span>No B-roll</span></button>
        {shown.map(b => (
          <button key={b.id} type="button" className={`st-refchoice ${spec.brollId === b.id ? 'on' : ''}`} onClick={() => set({ brollId: b.id, brollSeconds: Math.min(spec.brollSeconds, b.durationSec ?? spec.brollSeconds) })} title={b.title}>
            <video className="st-content-thumb" src={firstFrame(b.assetId!)} muted playsInline preload="metadata" />
            <span>{b.title}{b.product ? ` · ${b.product}` : ''}</span>
          </button>
        ))}
      </div>
      {!ready.length && <span className="st-hint">Upload screen recordings or phone video in the B-roll library tab.</span>}
      {picked && (
        <div className="st-row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <div className="st-seg" role="radiogroup" aria-label="Order">
            <button className={spec.order === 'clip_first' ? 'on' : ''} onClick={() => set({ order: 'clip_first' })}>Clip, then B-roll</button>
            <button className={spec.order === 'broll_first' ? 'on' : ''} onClick={() => set({ order: 'broll_first' })}>B-roll, then clip</button>
          </div>
          <label className="st-row" style={{ gap: 6 }}><span className="st-hint">From</span><input className="st-input st-num" type="number" min={0} max={Math.max(0, (picked.durationSec ?? 0) - 0.5)} step={0.5} value={spec.brollStart} onChange={e => set({ brollStart: Math.max(0, Number(e.target.value) || 0) })} /><span className="st-hint">s, for</span>
            <input className="st-input st-num" type="number" min={0.5} max={max} step={0.5} value={spec.brollSeconds} onChange={e => set({ brollSeconds: Math.min(max, Math.max(0.5, Number(e.target.value) || 0.5)) })} /><span className="st-hint">s (clip is {picked.durationSec ?? '?'} s). Hard cut, never a crossfade.</span></label>
        </div>
      )}
    </div>
  )
}

// ── The caption preview: TikTok's white box over the frame ───────────────

function CaptionPreview({ text, data, video, image, width = 240 }: { text: string; data: ContentData; video?: string | null; image?: string | null; width?: number }) {
  const o = data.options
  const k = width / o.canvas.width
  const c = o.caption
  const half = Math.min(o.canvas.width / 2 - c.safe.left, o.canvas.width / 2 - c.safe.right)
  const style = {
    top: c.position === 'top' ? c.safe.top * k : undefined,
    bottom: c.position === 'bottom' ? c.safe.bottom * k : undefined,
    width: 2 * half * k,
    fontSize: c.size * k,
  }
  return (
    <div className="st-captionframe" style={{ width, height: (width * o.canvas.height) / o.canvas.width }}>
      {video ? <video src={assetUrl(video)} autoPlay muted loop playsInline /> : image ? <img src={assetUrl(image, 480)} alt="" /> : null}
      {text.trim() && (
        <div className={`st-captionbox ${c.position}`} style={style}>
          <span style={{ padding: `${c.box.pad_y * k}px ${c.box.pad_x * k}px`, borderRadius: c.box.radius * k, background: c.box.fill, color: c.box.text }}>{text.trim()}</span>
        </div>
      )}
    </div>
  )
}

// ── Export: free, rendered on the worker ────────────────────────────────

function ExportPanel({ item, todo, saving, flush, label, children }: { item: ContentItem; todo: TodoItem[]; saving: boolean; flush: () => Promise<void>; label: string; children?: ReactNode }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [starting, setStarting] = useState(false)
  async function go() {
    setStarting(true)
    try {
      await flush()
      await api.renderContent(item.id)
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
          {rendering ? (o.total ? `Rendering ${Math.min((o.done ?? 0) + (o.failed ?? 0) + 1, o.total)} of ${o.total}...` : 'Rendering...') : item.status === 'ready' || item.status === 'failed' ? `${label} again` : label}
          <span className="st-price">Free</span>
        </button>
        {saving && <span className="st-hint st-row" style={{ gap: 6 }}><Loader2 size={13} className="st-spin" />Saving...</span>}
      </div>
      {!worker.ready && <span className="st-hint st-warntext" role="status">{worker.reason}</span>}
      <span className="st-hint">Renders on the Studio's worker: no provider, no cost. 9:16, no sound. {AI_LABEL}</span>
      {item.status === 'failed' && item.error && <Callout tone="bad">{item.error}</Callout>}
      {children}
    </div>
  )
}

function DownloadLink({ assetId, name, children }: { assetId: string; name: string; children: ReactNode }) {
  return <a className="st-btn secondary sm" href={downloadUrl(assetId, name)}><Download size={14} />{children}</a>
}

const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post'

// ── Meme video ──────────────────────────────────────────────────────────

function MemeEditor({ item, data, scenes, onArchive }: { item: ContentItem; data: ContentData; scenes: ScenesData; characterId: string; onArchive: () => void }) {
  const { spec, set, flush, saving } = useDraft<MemeSpec>(item)
  const clip = keptClips(scenes).find(c => c.id === spec.clipId) ?? null
  const todo: TodoItem[] = [
    ...(!clip ? [{ label: 'Pick a clip', target: 'meme-clip' }] : []),
    ...(!spec.caption.trim() ? [{ label: 'Write the caption', target: 'meme-caption' }] : []),
  ]
  return (
    <div className="st-content-grid">
      <div className="st-col" style={{ gap: 18 }}>
        <section className="st-card"><div className="st-card-body st-col" style={{ gap: 16 }}>
          <Field id="meme-clip" label="Clip" required done={!!clip} group><ClipPicker scenes={scenes} value={spec.clipId} onChange={id => set({ clipId: id })} /></Field>
          <Field id="meme-broll" label="B-roll (optional)" group hint="A screen recording or phone video, cut in hard."><BrollFields data={data} spec={spec} set={p => set(p)} /></Field>
          <Field id="meme-caption" label="Caption" required done={!!spec.caption.trim()} hint={`In TikTok's white box, kept clear of TikTok's buttons. Up to ${data.options.caption.maxChars} characters; emoji work.`}>
            <textarea className="st-textarea" rows={3} maxLength={data.options.caption.maxChars} value={spec.caption} onChange={e => set({ caption: e.target.value })} placeholder="e.g. me when the code finally works and I have no idea why 💀" />
          </Field>
        </div></section>
        <ExportPanel item={item} todo={todo} saving={saving} flush={flush} label="Export MP4">
          {item.status === 'ready' && item.outputs.videoAssetId && (
            <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <video className="st-content-result" src={assetUrl(item.outputs.videoAssetId)} controls playsInline />
              <DownloadLink assetId={item.outputs.videoAssetId} name={`${fileSlug(spec.caption)}.mp4`}>Download MP4</DownloadLink>
            </div>
          )}
        </ExportPanel>
        <button className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onArchive}><Archive size={14} />Archive this meme video</button>
      </div>
      <div className="st-content-side"><CaptionPreview text={spec.caption} data={data} video={clip?.assetId} /><span className="st-hint">Preview. The export uses the same font, box and safe zones.</span></div>
    </div>
  )
}

// ── Slideshow ───────────────────────────────────────────────────────────

function SlideshowEditor({ item, data, scenes, characterId, onArchive }: { item: ContentItem; data: ContentData; scenes: ScenesData; characterId: string; onArchive: () => void }) {
  const toast = useToast()
  const { spec, set, flush, saving } = useDraft<SlideshowSpec>(item)
  const stills = usableStills(scenes)
  const picked = spec.stillIds.map(id => stills.find(s => s.id === id)).filter((s): s is Clip => !!s)
  const [min, max] = data.options.slideshow.slides
  const slides = Math.max(min, Math.min(max, picked.length - 1))
  const texts = [spec.hook, ...spec.slides]
  function toggle(id: string) {
    const next = spec.stillIds.includes(id) ? spec.stillIds.filter(x => x !== id) : [...spec.stillIds, id].slice(0, data.options.slideshow.maxStills)
    set({ stillIds: next })
  }
  const writeTodo: TodoItem[] = [
    ...(!picked.length ? [{ label: 'Pick stills', target: 'slides-stills' }] : []),
    ...(spec.topic.trim().length < 3 ? [{ label: 'What it is about', target: 'slides-topic' }] : []),
  ]
  const todo: TodoItem[] = [
    ...(!picked.length ? [{ label: 'Pick stills', target: 'slides-stills' }] : []),
    ...(!texts.some(t => t.trim()) ? [{ label: 'Write the slides (or type them)', target: 'slides-text' }] : []),
  ]
  const tags = spec.hashtags.map(h => `#${h}`).join(' ')
  async function copyCaption() {
    try { await navigator.clipboard.writeText(`${spec.caption}${tags ? `\n\n${tags}` : ''}`); toast({ tone: 'ok', text: 'Caption copied.' }) } catch { toast({ tone: 'bad', text: 'Could not copy. Select the text and copy it.' }) }
  }
  return (
    <div className="st-col" style={{ gap: 18 }}>
      <section className="st-card"><div className="st-card-body st-col" style={{ gap: 16 }}>
        <Field id="slides-stills" label={`Stills, in order (${picked.length} picked)`} required done={picked.length > 0} group hint={`The hook goes on the first. With fewer stills than slides (${slides + 1}), they repeat in order.`}>
          {!stills.length ? <Callout tone="info">No stills yet. Generate some in a scene first.</Callout> : (
            <div className="st-refgrid">
              {stills.map(s => {
                const n = spec.stillIds.indexOf(s.id)
                return (
                  <button key={s.id} type="button" className={`st-refchoice ${n >= 0 ? 'on' : ''}`} onClick={() => toggle(s.id)} title={s.sceneTitle}>
                    <Img assetId={s.assetId} width={160} style={{ aspectRatio: '9 / 16' }} />
                    <span>{n >= 0 ? `${n + 1}. ` : ''}{s.sceneTitle}</span>
                  </button>
                )
              })}
            </div>
          )}
        </Field>
        <Field id="slides-topic" label="What it is about" required done={spec.topic.trim().length >= 3}>
          <input className="st-input" maxLength={400} value={spec.topic} onChange={e => set({ topic: e.target.value })} placeholder="e.g. 5 apps that saved my semester" />
        </Field>
        <PriceButton
          label={texts.some(t => t.trim()) ? 'Rewrite the slides' : 'Write the slides'}
          variant={texts.some(t => t.trim()) ? 'secondary' : 'primary'}
          todo={writeTodo}
          waiting={saving ? 'Saving...' : undefined}
          action={writeTodo.length || saving ? null : { type: 'content_slides', characterId, contentId: item.id }}
        />
      </div></section>

      <section className="st-card" data-field="slides-text"><div className="st-card-body st-col" style={{ gap: 12 }}>
        <div className="st-h3">The slides</div>
        <Field label="Hook (slide 1)"><input className="st-input" maxLength={200} value={spec.hook} onChange={e => set({ hook: e.target.value })} placeholder="e.g. POV: you finally found apps that actually help" /></Field>
        {spec.slides.map((t, i) => (
          <div key={i} className="st-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <span className="st-hint" style={{ width: 54, flex: 'none' }}>Slide {i + 2}</span>
            <input className="st-input" style={{ flex: 1, minWidth: 0 }} maxLength={300} value={t} onChange={e => set({ slides: spec.slides.map((x, j) => (j === i ? e.target.value : x)) })} />
            <button className="st-btn ghost sm" aria-label={`Remove slide ${i + 2}`} onClick={() => set({ slides: spec.slides.filter((_, j) => j !== i) })}><X size={14} /></button>
          </div>
        ))}
        {spec.slides.length < 10 && <button className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ slides: [...spec.slides, ''] })}><Plus size={14} />Add a slide</button>}
        <Field label="Post caption"><textarea className="st-textarea" rows={2} maxLength={2200} value={spec.caption} onChange={e => set({ caption: e.target.value })} /></Field>
        <Field label="Hashtags" hint="Separated by spaces, without #.">
          <input className="st-input" value={spec.hashtags.join(' ')} onChange={e => set({ hashtags: e.target.value.split(/[\s,]+/).map(h => h.replace(/^#+/, '')).filter(Boolean) })} />
        </Field>
        {(spec.caption || tags) && <button className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={copyCaption}><Copy size={14} />Copy caption and hashtags</button>}
      </div></section>

      {picked.length > 0 && texts.some(t => t.trim()) && (
        <div className="st-content-strip">
          {texts.filter(t => t.trim()).map((t, i) => <CaptionPreview key={i} text={t} data={data} image={picked[i % picked.length]!.assetId} width={150} />)}
        </div>
      )}

      <ExportPanel item={item} todo={todo} saving={saving} flush={flush} label="Export images">
        {item.status === 'ready' && item.outputs.imageAssetIds && (
          <div className="st-col" style={{ gap: 10 }}>
            <div className="st-row" style={{ gap: 8 }}>{item.outputs.zipAssetId && <DownloadLink assetId={item.outputs.zipAssetId} name={`${fileSlug(spec.topic)}-slides.zip`}>Download all, in order (zip)</DownloadLink>}</div>
            <div className="st-content-strip">
              {item.outputs.imageAssetIds.map((id, i) => <a key={id} href={downloadUrl(id, `${String(i + 1).padStart(2, '0')}-${fileSlug(spec.topic)}.jpg`)} title={`Download slide ${i + 1}`}><Img assetId={id} width={320} style={{ width: 150, aspectRatio: '9 / 16' }} /></a>)}
            </div>
          </div>
        )}
      </ExportPanel>
      <button className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onArchive}><Archive size={14} />Archive this slideshow</button>
    </div>
  )
}

// ── Batch ───────────────────────────────────────────────────────────────

function BatchEditor({ item, data, scenes, characterId, onArchive }: { item: ContentItem; data: ContentData; scenes: ScenesData; characterId: string; onArchive: () => void }) {
  const { spec, set, flush, saving } = useDraft<BatchSpec>(item)
  const clip = keptClips(scenes).find(c => c.id === spec.clipId) ?? null
  const [text, setText] = useState(spec.captions.join('\n'))
  const serverKey = spec.captions.join('\n')
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setText(serverKey) }, [serverKey])
  const captions = text.split('\n').map(c => c.trim()).filter(Boolean)
  const max = data.options.batch.max
  const writeTodo: TodoItem[] = spec.topic.trim().length < 3 ? [{ label: 'What the captions are about', target: 'batch-topic' }] : []
  const todo: TodoItem[] = [
    ...(!clip ? [{ label: 'Pick a clip', target: 'batch-clip' }] : []),
    ...(!captions.length ? [{ label: 'Add captions (paste them or write them with Claude)', target: 'batch-captions' }] : []),
  ]
  const o = item.outputs
  return (
    <div className="st-content-grid">
      <div className="st-col" style={{ gap: 18 }}>
        <section className="st-card"><div className="st-card-body st-col" style={{ gap: 16 }}>
          <div className="st-row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field id="batch-topic" label="What the captions are about" className="grow">
              <input className="st-input" maxLength={400} value={spec.topic} onChange={e => set({ topic: e.target.value })} placeholder="e.g. studying with AI the night before an exam" />
            </Field>
            <Field label="How many">
              <input className="st-input st-num" type="number" min={1} max={max} value={spec.count} onChange={e => set({ count: Math.min(max, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
          </div>
          <PriceButton
            label={`Write ${spec.count} captions`} variant={captions.length ? 'secondary' : 'primary'}
            todo={writeTodo} waiting={saving ? 'Saving...' : undefined}
            action={writeTodo.length || saving ? null : { type: 'content_captions', characterId, contentId: item.id }}
          />
          <Field id="batch-captions" label={`Captions, one per line (${captions.length}${captions.length > max ? `, the first ${max} are used` : ''})`} required done={captions.length > 0} hint="Paste your own, or edit Claude's. Each line becomes one video.">
            <textarea className="st-textarea" rows={8} value={text}
              onFocus={() => { editing.current = true }}
              onBlur={() => { editing.current = false }}
              onChange={e => { setText(e.target.value); set({ captions: e.target.value.split('\n').map(c => c.trim()).filter(Boolean).slice(0, 50) }) }}
              placeholder={'e.g. me pretending I read the syllabus\nPOV: the group chat at 2am before the exam'} />
          </Field>
        </div></section>
        <section className="st-card"><div className="st-card-body st-col" style={{ gap: 16 }}>
          <Field id="batch-clip" label="Clip (the same for every video)" required done={!!clip} group><ClipPicker scenes={scenes} value={spec.clipId} onChange={id => set({ clipId: id })} /></Field>
          <Field label="B-roll (optional)" group><BrollFields data={data} spec={spec} set={p => set(p as Partial<BatchSpec>)} /></Field>
        </div></section>
        <ExportPanel item={item} todo={todo} saving={saving} flush={flush} label={`Make ${Math.min(captions.length, max) || ''} videos`.replace('  ', ' ')}>
          {(o.videos?.length ?? 0) > 0 && (
            <div className="st-col" style={{ gap: 10 }}>
              {o.zipAssetId && <div className="st-row"><DownloadLink assetId={o.zipAssetId} name={`${fileSlug(spec.topic)}-batch.zip`}>Download all (zip, with captions.txt)</DownloadLink></div>}
              <div className="st-content-videos">
                {o.videos!.map((v, i) => v && (
                  <div key={v.assetId} className="st-col" style={{ gap: 6 }}>
                    <video className="st-content-result sm" src={assetUrl(v.assetId)} controls playsInline preload="metadata" />
                    <span className="st-hint">{i + 1}. {v.caption}</span>
                    <a className="st-hint" href={downloadUrl(v.assetId, `${fileSlug(spec.topic)}-${String(i + 1).padStart(2, '0')}.mp4`)}><Download size={12} style={{ verticalAlign: -2 }} /> Download</a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ExportPanel>
        <button className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onArchive}><Archive size={14} />Archive this batch</button>
      </div>
      <div className="st-content-side"><CaptionPreview text={captions[0] ?? ''} data={data} video={clip?.assetId} /><span className="st-hint">The first caption, as a preview.</span></div>
    </div>
  )
}

// ── B-roll library ──────────────────────────────────────────────────────

function BrollTab({ data }: { data: ContentData }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [product, setProduct] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const worker = useWorkerGate()
  async function upload(files: File[]) {
    const videos = files.filter(f => f.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(f.name))
    if (!videos.length) { toast({ tone: 'bad', text: 'Pick video files (MP4, MOV or WebM).' }); return }
    for (const [i, f] of videos.entries()) {
      setBusy(`Uploading ${f.name} (${i + 1} of ${videos.length})...`)
      try { await api.addBroll(f, product) } catch (e) { toast({ tone: 'bad', text: `${f.name}: ${errorMessage(e)}` }) }
    }
    setBusy(null)
    await qc.invalidateQueries({ queryKey: keys.content })
    toast({ tone: 'ok', text: 'Uploaded. Each clip is being prepared; it is ready in a moment.' })
  }
  const shown = data.broll.filter(b => !filter || b.product === filter)
  return (
    <div className="st-col" style={{ gap: 18 }}>
      <section className="st-card"><div className="st-card-body st-col" style={{ gap: 12 }}>
        <div className="st-h3">Add B-roll</div>
        <span className="st-hint">Screen recordings and phone video of your laptop, up to {data.options.maxUploadMb} MB each. They are kept as a lean copy without sound. Landscape clips are fitted over a blurred copy in 9:16, so nothing on screen is cut off.</span>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input className="st-input" style={{ maxWidth: 260 }} list="broll-products" value={product} onChange={e => setProduct(e.target.value)} placeholder="Product, e.g. Notion" aria-label="Product" />
          <datalist id="broll-products">{data.products.map(p => <option key={p} value={p} />)}</datalist>
          <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} />
          <button className="st-btn primary" disabled={!!busy || !worker.ready} onClick={() => input.current?.click()}>{busy ? <Loader2 size={15} className="st-spin" /> : <Upload size={15} />}Upload videos</button>
          {busy && <span className="st-hint">{busy}</span>}
          {!worker.ready && <span className="st-hint st-warntext" role="status">{worker.reason} Uploads are prepared by the worker.</span>}
        </div>
      </div></section>
      {data.products.length > 0 && (
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`st-chip ${filter === null ? 'on' : ''}`} onClick={() => setFilter(null)}>All products</button>
          {data.products.map(p => <button key={p} className={`st-chip ${filter === p ? 'on' : ''}`} onClick={() => setFilter(p)}>{p}</button>)}
        </div>
      )}
      {!shown.length ? <Callout tone="info">No B-roll yet. Upload a screen recording to start the library.</Callout> : (
        <div className="st-content-videos">{shown.map(b => <BrollCard key={b.id} b={b} products={data.products} />)}</div>
      )}
    </div>
  )
}

function BrollCard({ b, products }: { b: BrollClip; products: string[] }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [title, setTitle] = useState(b.title)
  const [product, setProduct] = useState(b.product)
  const listId = useMemo(() => `p-${b.id}`, [b.id])
  async function save(patch: { title?: string; product?: string }) {
    try { await api.updateBroll(b.id, patch); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function archive() {
    try { await api.archiveBroll(b.id); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-card st-col" style={{ gap: 8, padding: 10 }}>
      {b.status === 'ready' && b.assetId ? <video className="st-content-result sm" src={assetUrl(b.assetId)} controls muted playsInline preload="metadata" />
        : b.status === 'processing' ? <div className="st-content-processing"><Loader2 size={18} className="st-spin" />Preparing...</div>
        : <div className="st-content-processing bad">{b.error ?? 'This upload failed.'}</div>}
      <input className="st-input" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title !== b.title && save({ title })} aria-label="Title" />
      <input className="st-input" list={listId} value={product} onChange={e => setProduct(e.target.value)} onBlur={() => product !== b.product && save({ product })} placeholder="Product" aria-label="Product" />
      <datalist id={listId}>{products.map(p => <option key={p} value={p} />)}</datalist>
      <div className="st-row"><span className="st-hint">{b.durationSec != null ? `${b.durationSec} s` : ''}</span><span className="st-spacer" /><button className="st-btn ghost sm" onClick={archive}><Archive size={13} />Archive</button></div>
    </div>
  )
}
