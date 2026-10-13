import { useEffect, useRef, useState } from 'react'
import { Copy, Plus, X } from 'lucide-react'
import { PriceButton } from '../../PriceButton'
import { Field, useToast, type TodoItem } from '../../ui'
import type { BatchSpec, MemeSpec, SlideshowSpec } from '../../types'
import { CaptionPreview } from './parts'
import type { PostCtx } from './ctx'

// The Text step: the caption of a video post, the hook and slides of a
// slideshow (Claude writes them, priced), or the captions of a batch (pasted,
// or written by Claude from the idea, priced).

export function textSummary(ctx: PostCtx) {
  if (ctx.item.kind === 'meme') return (ctx.draft.spec as unknown as MemeSpec).caption?.trim().slice(0, 100) || 'No caption yet'
  if (ctx.item.kind === 'slideshow') {
    const s = ctx.draft.spec as unknown as SlideshowSpec
    return s.hook?.trim() ? `Hook: ${s.hook.trim().slice(0, 80)} (+${s.slides.filter(x => x.trim()).length} slides)` : 'No slides yet'
  }
  const n = ((ctx.draft.spec as unknown as BatchSpec).captions ?? []).filter(c => c.trim()).length
  return `${n} caption${n === 1 ? '' : 's'}`
}

export function TextStep({ ctx }: { ctx: PostCtx }) {
  if (ctx.item.kind === 'slideshow') return <Slides ctx={ctx} />
  if (ctx.item.kind === 'batch') return <Captions ctx={ctx} />
  return <Caption ctx={ctx} />
}

function Caption({ ctx }: { ctx: PostCtx }) {
  const { data, draft, lib } = ctx
  const spec = draft.spec as unknown as MemeSpec
  const clip = lib?.clips.find(c => c.id === spec.clipId && c.status === 'approved')
  return (
    <div className="st-content-grid">
      <Field id="post-caption" label="Caption" required done={!!spec.caption?.trim()} hint={`In TikTok's white box, kept clear of TikTok's buttons. Up to ${data.options.caption.maxChars} characters; emoji work.`}>
        <textarea className="st-textarea" rows={3} maxLength={data.options.caption.maxChars} value={spec.caption ?? ''} onChange={e => draft.setSpec({ caption: e.target.value })} placeholder="e.g. me when the code finally works and I have no idea why 💀" />
      </Field>
      <div className="st-content-side"><CaptionPreview text={spec.caption ?? ''} data={data} video={clip?.assetId} /><span className="st-hint">Preview. The export uses the same font, box and safe zones.</span></div>
    </div>
  )
}

function Slides({ ctx }: { ctx: PostCtx }) {
  const { item, data, draft, lib } = ctx
  const toast = useToast()
  const spec = draft.spec as unknown as SlideshowSpec
  const picked = spec.stillIds.map(id => lib?.stills.find(s => s.id === id)).filter(s => !!s)
  const texts = [spec.hook, ...spec.slides]
  const topic = draft.fields.idea.trim() || spec.topic.trim()
  const writeTodo: TodoItem[] = [
    ...(!spec.stillIds.length ? [{ label: 'Pick stills', target: 'step-stills' }] : []),
    ...(topic.length < 3 ? [{ label: 'What it is about (the idea)', target: 'post-idea', onGo: () => void draft.go('idea') }] : []),
  ]
  const tags = spec.hashtags.map(h => `#${h}`).join(' ')
  async function copyCaption() {
    try { await navigator.clipboard.writeText(`${spec.caption}${tags ? `\n\n${tags}` : ''}`); toast({ tone: 'ok', text: 'Caption copied.' }) } catch { toast({ tone: 'bad', text: 'Could not copy. Select the text and copy it.' }) }
  }
  return (
    <div className="st-col" style={{ gap: 16 }}>
      <PriceButton
        label={texts.some(t => t.trim()) ? 'Rewrite the slides' : 'Write the slides'}
        variant={texts.some(t => t.trim()) ? 'secondary' : 'primary'}
        todo={writeTodo}
        waiting={draft.saving ? 'Saving...' : undefined}
        action={writeTodo.length || draft.saving || !item.characterId ? null : { type: 'content_slides', characterId: item.characterId, contentId: item.id }}
        watch={j => j.purpose === `content_slides:${item.id}`}
        onStarted={() => void ctx.advance('text')}
      />
      <span className="st-hint">Claude writes a hook and {data.options.slideshow.slides[0]} to {data.options.slideshow.slides[1]} slides about "{topic || 'your idea'}", plus a caption and hashtags. Edit anything after.</span>
      <div className="st-col" data-field="slides-text" style={{ gap: 10 }}>
        <Field label="Hook (slide 1)"><input className="st-input" maxLength={200} value={spec.hook} onChange={e => draft.setSpec({ hook: e.target.value })} placeholder="e.g. POV: you finally found apps that actually help" /></Field>
        {spec.slides.map((t, i) => (
          <div key={i} className="st-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <span className="st-hint" style={{ width: 54, flex: 'none' }}>Slide {i + 2}</span>
            <input className="st-input" style={{ flex: 1, minWidth: 0 }} maxLength={300} value={t} onChange={e => draft.setSpec({ slides: spec.slides.map((x, j) => (j === i ? e.target.value : x)) })} />
            <button type="button" className="st-btn ghost sm" aria-label={`Remove slide ${i + 2}`} onClick={() => draft.setSpec({ slides: spec.slides.filter((_, j) => j !== i) })}><X size={14} /></button>
          </div>
        ))}
        {spec.slides.length < 10 && <button type="button" className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => draft.setSpec({ slides: [...spec.slides, ''] })}><Plus size={14} />Add a slide</button>}
        <Field label="Post caption"><textarea className="st-textarea" rows={2} maxLength={2200} value={spec.caption} onChange={e => draft.setSpec({ caption: e.target.value })} /></Field>
        <Field label="Hashtags" hint="Separated by spaces, without #.">
          <input className="st-input" value={spec.hashtags.join(' ')} onChange={e => draft.setSpec({ hashtags: e.target.value.split(/[\s,]+/).map(h => h.replace(/^#+/, '')).filter(Boolean) })} />
        </Field>
        {(spec.caption || tags) && <button type="button" className="st-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={copyCaption}><Copy size={14} />Copy caption and hashtags</button>}
      </div>
      {picked.length > 0 && texts.some(t => t.trim()) && (
        <div className="st-content-strip">
          {texts.filter(t => t.trim()).map((t, i) => <CaptionPreview key={i} text={t} data={data} image={picked[i % picked.length]!.assetId} width={150} />)}
        </div>
      )}
    </div>
  )
}

function Captions({ ctx }: { ctx: PostCtx }) {
  const { item, data, draft, lib } = ctx
  const spec = draft.spec as unknown as BatchSpec
  const [text, setText] = useState((spec.captions ?? []).join('\n'))
  const serverKey = (spec.captions ?? []).join('\n')
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setText(serverKey) }, [serverKey])
  const captions = text.split('\n').map(c => c.trim()).filter(Boolean)
  const max = data.options.batch.max
  const topic = draft.fields.idea.trim() || spec.topic.trim()
  const writeTodo: TodoItem[] = topic.length < 3 ? [{ label: 'What the captions are about (the idea)', target: 'post-idea', onGo: () => void draft.go('idea') }] : []
  const first = lib?.clips.find(c => c.id === spec.clipIds?.[0] && c.status === 'approved')
  return (
    <div className="st-content-grid">
      <div className="st-col" style={{ gap: 14 }}>
        <div className="st-row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="How many">
            <input className="st-input st-num" type="number" min={1} max={max} value={spec.count} onChange={e => draft.setSpec({ count: Math.min(max, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
          <PriceButton
            label={`Write ${spec.count} captions`} variant={captions.length ? 'secondary' : 'primary'}
            todo={writeTodo} waiting={draft.saving ? 'Saving...' : undefined}
            action={writeTodo.length || draft.saving || !item.characterId ? null : { type: 'content_captions', characterId: item.characterId, contentId: item.id }}
            watch={j => j.purpose === `content_captions:${item.id}`}
            onStarted={() => void ctx.advance('text')}
          />
        </div>
        <span className="st-hint">About "{topic || 'your idea'}". Or paste your own below.</span>
        <Field id="batch-captions" label={`Captions, one per line (${captions.length}${captions.length > max ? `, the first ${max} are used` : ''})`} required done={captions.length > 0} hint="Each line becomes one video.">
          <textarea className="st-textarea" rows={8} value={text}
            onFocus={() => { editing.current = true }}
            onBlur={() => { editing.current = false }}
            onChange={e => { setText(e.target.value); draft.setSpec({ captions: e.target.value.split('\n').map(c => c.trim()).filter(Boolean).slice(0, 50) }) }}
            placeholder={'e.g. me pretending I read the syllabus\nPOV: the group chat at 2am before the exam'} />
        </Field>
      </div>
      <div className="st-content-side"><CaptionPreview text={captions[0] ?? ''} data={data} video={first?.assetId} /><span className="st-hint">The first caption, as a preview.</span></div>
    </div>
  )
}
