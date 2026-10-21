import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ImagePlus, Music, Sparkles, Type, Video, Image as ImageIcon, CheckCircle2, Package } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { keys } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Img, errorMessage, useToast } from '../../ui'
import { LintNote, useLint } from '../../lint'
import { RunStatus } from '../../runs'
import { HowTo } from '../../guide/Guide'
import type { FacelessFile } from '../../types'
import type { PostCtx } from './ctx'
import { FinishStep } from './FinishStep'

// A faceless post (owner, 2026-10-22; UX-PLAN.md section 35, item 4e): the
// same workspace, in drawers: Still (a place from the bank or written, its
// price), Video (the prompt filled in from the row, image-to-video, any
// model with its price), Sound, Text (the on-screen line, the caption and
// the hashtags, each with Copy), and Posted. The still shows on the post
// card; nothing here is ever a URL or a job id.

interface FacelessSpec {
  placeId?: string | null; line?: string; product?: { assetId: string; name: string } | null; videoPrompt?: string
  postCaption?: string; hashtags?: string[]; music?: string | null; voiceover?: { search: string; note: string } | null
  posted?: boolean; recipe?: 'finished_damage' | null; stillAssetId?: string; clipAssetId?: string
}

function Drawer({ id, icon, title, sum, open, onToggle, children }: { id: string; icon: ReactNode; title: string; sum: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={`st-card st-facelessdrawer ${open ? 'open' : ''}`} data-field={`faceless-${id}`}>
      <button type="button" className="st-card-head st-row" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit', gap: 10 }} aria-expanded={open} onClick={onToggle}>
        {icon}<div className="grow"><div className="st-h3">{title}</div><div className="st-hint">{sum}</div></div>
      </button>
      {open && <div className="st-card-body st-col" style={{ gap: 12 }}>{children}</div>}
    </section>
  )
}

function CopyLine({ label, text }: { label: string; text: string }) {
  const toast = useToast()
  return (
    <button type="button" className="st-btn sm ghost" disabled={!text.trim()} aria-label={`Copy the ${label}`} onClick={async () => {
      try { await navigator.clipboard.writeText(text); toast({ tone: 'ok', text: `${label[0]!.toUpperCase()}${label.slice(1)} copied.` }) } catch { toast({ tone: 'bad', text: 'Could not copy. Select the text and copy it.' }) }
    }}><Copy size={13} />Copy</button>
  )
}

export function FacelessPost({ ctx }: { ctx: PostCtx }) {
  const { item, draft, v } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const lint = useLint(item.characterId, item.productId)
  const file: FacelessFile | null = v?.faceless ?? null
  const spec = draft.spec as { caption?: string; stillId?: string | null; clipId?: string | null; faceless?: FacelessSpec | null; sound?: Record<string, unknown> }
  const f: FacelessSpec = spec.faceless ?? {}
  const setF = (patch: Partial<FacelessSpec>) => draft.setSpec({ faceless: { ...f, ...patch } })
  const [open, setOpen] = useState<string>(spec.clipId ? 'text' : spec.stillId ? 'video' : 'still')
  const toggle = (id: string) => setOpen(o => (o === id ? '' : id))
  const sounds = useQuery({ queryKey: ['sounds'], queryFn: () => api.sounds(), staleTime: 30_000 })
  const music = (sounds.data?.sounds ?? []).filter(s => s.kind === 'music' && s.status === 'ready')
  const [duration, setDuration] = useState(f.recipe === 'finished_damage' ? 7 : 5)
  const prices = useQuery({ queryKey: ['video-prices', item.characterId, duration], queryFn: () => api.videoPrices(item.characterId!, duration, '9:16'), enabled: !!item.characterId, staleTime: 60_000 })
  const [model, setModel] = useState<string | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const productFile = useRef<HTMLInputElement>(null)
  // A still or take landing reloads the post (its file shows here and on the card).
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.content })
  useEffect(() => { if (f.recipe === 'finished_damage' && !f.videoPrompt) setF({ videoPrompt: 'Nothing happens: just existing. Rain keeps running down the glass, the light barely changes, the camera holds still like a phone propped up.' }) }, [f.recipe]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!file) return null
  const place = file.places.find(p => p.id === f.placeId) ?? null
  const caption = spec.caption ?? ''
  const tags = f.hashtags ?? []
  const pickedModel = model ?? prices.data?.prices[0]?.model ?? null

  async function uploadStill(fl: globalThis.File | undefined) {
    if (!fl || !item.characterId) return
    try {
      const { stills } = await api.addStills(item.characterId, [fl], item.id)
      const s = stills[0]
      if (s) { draft.setSpec({ stillId: s.id, faceless: { ...f, stillAssetId: s.assetId } }); toast({ tone: 'ok', text: 'Your picture is the still.' }) }
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function uploadProduct(fl: globalThis.File | undefined) {
    if (!fl || !item.characterId) return
    try {
      const { stills } = await api.addStills(item.characterId, [fl])
      const s = stills[0]
      if (s) setF({ product: { assetId: s.assetId, name: f.product?.name || fl.name.replace(/\.[a-z0-9]+$/i, '') } })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <div className="st-col" style={{ gap: 12 }} data-field="faceless-post">
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="st-badge plain">Faceless</span>
        <span className="st-hint">No face anywhere: real places, the line, the sound.</span>
        <span className="st-spacer" />
        <label className="st-row" style={{ gap: 6 }} title="One still, a 7 s just-existing clip, a sad song and the on-screen line">
          <input type="checkbox" checked={f.recipe === 'finished_damage'} onChange={e => { setF({ recipe: e.target.checked ? 'finished_damage' : null }); setDuration(e.target.checked ? 7 : 5) }} />Finished damage
        </label>
        <HowTo id="faceless" label="About faceless posts" />
      </div>

      <Drawer id="still" icon={<ImageIcon size={16} />} title="Still" open={open === 'still'} onToggle={() => toggle('still')}
        sum={spec.stillId ? 'The still is ready.' : place ? `Place: ${place.name}` : f.line ? 'Your own words' : 'Pick a place or write it'}>
        {f.stillAssetId && <Img assetId={f.stillAssetId} width={360} style={{ width: 180, aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 12 }} />}
        <label className="st-col" style={{ gap: 4 }}><span className="st-label">From the place bank</span>
          <select className="st-select" value={f.placeId ?? ''} onChange={e => setF({ placeId: e.target.value || null })} aria-label="Place">
            <option value="">Write my own</option>
            {file.places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {place && !f.line && <span className="st-hint">{place.line}</span>}
        <label className="st-col" style={{ gap: 4 }}><span className="st-label">Or your own words (they win over the place)</span>
          <textarea className="st-textarea" rows={2} value={f.line ?? ''} onChange={e => setF({ line: e.target.value })} placeholder="the inside of a parked car, rain on the windshield" aria-label="What the still shows" />
        </label>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-field="faceless-product">
          <input ref={productFile} type="file" accept="image/*" hidden aria-label="Product photo" onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; void uploadProduct(x) }} />
          <Package size={14} />
          {f.product ? (
            <>
              <Img assetId={f.product.assetId} width={120} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} />
              <input className="st-input sm" style={{ width: 200 }} value={f.product.name} aria-label="Product name" onChange={e => setF({ product: { ...f.product!, name: e.target.value } })} />
              <button type="button" className="st-btn xs ghost" onClick={() => setF({ product: null })}>No product</button>
              <span className="st-hint">A product post uses an edit model with this photo (Soul can't render labels).</span>
            </>
          ) : <button type="button" className="st-btn sm ghost" onClick={() => productFile.current?.click()}>Add a product photo</button>}
        </div>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <PriceButton label={spec.stillId ? 'Make another still' : 'Make the still'} variant={spec.stillId ? 'secondary' : 'primary'}
            action={place || (f.line ?? '').trim().length >= 3 ? { type: 'faceless_still', contentId: item.id } : null}
            todo={place || (f.line ?? '').trim().length >= 3 ? [] : [{ label: 'Pick a place or write what the still shows' }]}
            watch={j => j.purpose === `faceless_still:${item.id}`} onDone={refresh} />
          <input ref={upload} type="file" accept="image/*" hidden aria-label="Upload a still" onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; void uploadStill(x) }} />
          <button type="button" className="st-btn ghost" onClick={() => upload.current?.click()}><ImagePlus size={15} />Use my own picture</button>
        </div>
        <RunStatus match={j => j.purpose === `faceless_still:${item.id}`} />
      </Drawer>

      <Drawer id="video" icon={<Video size={16} />} title="Video" open={open === 'video'} onToggle={() => toggle('video')}
        sum={spec.clipId ? 'The take is ready.' : spec.stillId ? 'From the still' : 'Make the still first'}>
        {f.clipAssetId && <video className="st-clip" src={`${assetUrl(f.clipAssetId)}#t=0.1`} controls muted playsInline style={{ width: 180, aspectRatio: '9 / 16', borderRadius: 12 }} />}
        <label className="st-col" style={{ gap: 4 }}><span className="st-label">What happens (from the plan row; edit freely)</span>
          <textarea className="st-textarea" rows={3} value={f.videoPrompt ?? ''} onChange={e => setF({ videoPrompt: e.target.value })} aria-label="Video prompt" />
        </label>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="st-label">Length</span>
          {[5, 7, 10].map(d => <button key={d} type="button" className={`st-chip ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)}>{d} s</button>)}
        </div>
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Video model">
          {(prices.data?.prices ?? []).map(p => (
            <button key={p.model} type="button" role="radio" aria-checked={pickedModel === p.model} className={`st-chip ${pickedModel === p.model ? 'on' : ''}`} onClick={() => setModel(p.model)}>{p.label}<span className="st-price">{p.display ?? 'No price'}</span></button>
          ))}
        </div>
        <PriceButton label={spec.clipId ? 'Make another take' : 'Make the video'} variant={spec.clipId ? 'secondary' : 'primary'}
          action={spec.stillId && (f.videoPrompt ?? '').trim().length >= 3 ? { type: 'faceless_video', contentId: item.id, model: pickedModel, durationSec: duration } : null}
          todo={[...(!spec.stillId ? [{ label: 'Make or pick the still first' }] : []), ...((f.videoPrompt ?? '').trim().length < 3 ? [{ label: 'Say what happens in the video' }] : [])]}
          watch={j => j.purpose === `faceless_video:${item.id}`} onDone={refresh} />
        <RunStatus match={j => j.purpose === `faceless_video:${item.id}`} />
      </Drawer>

      <Drawer id="sound" icon={<Music size={16} />} title="Sound" open={open === 'sound'} onToggle={() => toggle('sound')}
        sum={(spec.sound as { music?: string | null } | undefined)?.music ? `Music: ${music.find(m => m.id === (spec.sound as { music?: string }).music)?.title ?? 'picked'}` : 'No music yet'}>
        <label className="st-col" style={{ gap: 4 }}><span className="st-label">Music bed (Library &gt; Sounds)</span>
          <select className="st-select" value={(spec.sound as { music?: string | null } | undefined)?.music ?? ''} aria-label="Music bed" onChange={e => draft.setSpec({ sound: { ...(spec.sound ?? {}), music: e.target.value || null } })}>
            <option value="">No music</option>
            {music.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
        {file.sounds.filter(s => s.kind === 'music').length > 0 && <span className="st-hint">From the sound bank: {file.sounds.filter(s => s.kind === 'music').map(s => `${s.name} (search "${s.search}")`).join(', ')}.</span>}
        <div className="st-col" style={{ gap: 4 }} data-field="faceless-voiceover">
          <span className="st-label">Voiceover clip</span>
          <input className="st-input" value={f.voiceover?.search ?? ''} placeholder="the line's search words" aria-label="Voiceover search words" onChange={e => setF({ voiceover: { search: e.target.value, note: f.voiceover?.note ?? '' } })} />
          <span className="st-hint">Movie and TV quote clips are not searched automatically: none of the quote sites allows it with the rights to post the audio. Upload your own clip to Library &gt; Sounds and pick it in the Finish step's Sound row.</span>
        </div>
      </Drawer>

      <Drawer id="text" icon={<Type size={16} />} title="Text" open={open === 'text'} onToggle={() => toggle('text')}
        sum={caption ? `On screen: ${caption.slice(0, 60)}` : 'The on-screen line, the caption, the hashtags'}>
        <div className="st-col" style={{ gap: 4 }}>
          <div className="st-row" style={{ gap: 8 }}><span className="st-label grow">On-screen line</span><CopyLine label="on-screen line" text={caption} /></div>
          <textarea className="st-textarea" rows={2} value={caption} aria-label="On-screen line" onChange={e => draft.setSpec({ caption: e.target.value })} />
          <LintNote hits={lint(caption, 'hook')} field="hook-lint" />
        </div>
        <div className="st-col" style={{ gap: 4 }}>
          <div className="st-row" style={{ gap: 8 }}><span className="st-label grow">Caption</span><CopyLine label="caption" text={f.postCaption ?? ''} /></div>
          <textarea className="st-textarea" rows={3} value={f.postCaption ?? ''} aria-label="Post caption" onChange={e => setF({ postCaption: e.target.value })} />
        </div>
        <div className="st-col" style={{ gap: 4 }}>
          <div className="st-row" style={{ gap: 8 }}><span className="st-label grow">Hashtags</span><CopyLine label="hashtags" text={tags.map(t => `#${t}`).join(' ')} /></div>
          <input className="st-input" value={tags.map(t => `#${t}`).join(' ')} aria-label="Hashtags" onChange={e => setF({ hashtags: e.target.value.split(/[\s,]+/).map(t => t.replace(/^#+/, '')).filter(Boolean).slice(0, 15) })} />
        </div>
      </Drawer>

      <section className="st-card" data-field="faceless-posted">
        <div className="st-card-body st-row" style={{ gap: 10, alignItems: 'center' }}>
          <CheckCircle2 size={16} />
          <b className="grow">Posted</b>
          <button type="button" role="switch" aria-checked={!!f.posted} aria-label="Posted" className={`st-switch ${f.posted ? 'on' : ''}`} onClick={() => setF({ posted: !f.posted })}><span /></button>
        </div>
      </section>

      {spec.clipId && (
        <details className="st-card" style={{ padding: 12 }}>
          <summary className="st-h3" style={{ cursor: 'pointer' }}><Sparkles size={14} style={{ verticalAlign: -2 }} /> Export and the editor</summary>
          <FinishStep ctx={ctx} />
        </details>
      )}
    </div>
  )
}
