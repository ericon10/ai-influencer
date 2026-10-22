import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Copy, Plus, Sparkles, X } from 'lucide-react'
import { PriceButton } from '../../PriceButton'
import { Drawer, Field, useToast, type TodoItem } from '../../ui'
import { useProduct, useProducts } from '../../hooks'
import { HowTo } from '../../guide/Guide'
import type { BatchSpec, CaptionStyle, MemeSpec, SlideshowSpec } from '../../types'
import { CaptionPreview, CaptionStylePick } from './parts'
import type { PostCtx } from './ctx'
import { SlideshowText } from './slideshow/SlideshowText'
import { TEXT_STYLES, postCaption, slideList } from '../../../../server/core/slides'
import { LintNote, useLint } from '../../lint'
import { LineBankButton } from './LineBank'

// The Text step: the caption of a video post, the hook and slides of a
// slideshow (Claude writes them, priced), or the captions of a batch (pasted,
// or written by Claude from the idea, priced).

export function textSummary(ctx: PostCtx) {
  if (ctx.item.kind === 'meme') {
    const s = ctx.draft.spec as unknown as MemeSpec
    if (s.captionOff) return 'No caption'
    return s.caption?.trim().slice(0, 100) || 'No caption (optional)'
  }
  if (ctx.item.kind === 'slideshow') {
    const s = ctx.draft.spec as unknown as SlideshowSpec
    const style = TEXT_STYLES.find(x => x.id === s.textStyle)?.label ?? 'Classic'
    const n = slideList(s).length
    return s.hook?.trim() ? `${style} · ${n} slides · Hook: ${s.hook.trim().slice(0, 70)}${s.ad ? ' · #ad' : ''}` : 'No words on the slides (optional)'
  }
  const bs = ctx.draft.spec as unknown as BatchSpec
  const n = (bs.captions ?? []).filter(c => c.trim()).length
  if (bs.captionOff) return n ? `No caption on the videos (${n} lines)` : `No caption, ${bs.count} videos`
  return n ? `${n} caption${n === 1 ? '' : 's'}` : `No captions (optional), ${bs.count} videos`
}

export function TextStep({ ctx }: { ctx: PostCtx }) {
  if (ctx.item.kind === 'slideshow') return <SlideshowText ctx={ctx} />
  if (ctx.item.kind === 'batch') return <Captions ctx={ctx} />
  return <Caption ctx={ctx} />
}

function Caption({ ctx }: { ctx: PostCtx }) {
  const { data, draft, lib, item } = ctx
  const spec = draft.spec as unknown as MemeSpec
  const clip = lib?.clips.find(c => c.id === spec.clipId && c.status === 'approved')
  const [hooks, setHooks] = useState(false)
  const lint = useLint(item.characterId, item.productId)
  const plan = spec.plan
  const product = !!plan?.product
  const setPlan = (patch: Record<string, unknown>) => draft.setSpec({ plan: { ...(plan ?? {}), ...patch } } as never)
  const alt = plan?.altHook ?? ''
  return (
    <div className="st-content-grid">
      <div className="st-col" style={{ gap: 14 }}>
        <Field id="post-caption-style" label="Caption" hint="TikTok's white box, white text with a black outline (TikTok Classic), or No caption: none in the editor or the export. It is kept with this post." extra={<HowTo id="post-text" label="About captions" />}>
          <CaptionStylePick value={spec.captionStyle} data={data} off={!!spec.captionOff} onOff={v => draft.setSpec({ captionOff: v } as never)} onChange={v => draft.setSpec({ captionStyle: v } as never)} />
        </Field>
        {spec.captionOff ? (
          <div className="st-col" style={{ gap: 6 }} data-field="caption-off">
            <span className="st-hint">No caption on this post: the editor opens without a caption track and the export has none. Your words are kept; pick White box or Outline to put them back.{item.outputs?.videoAssetId ? ' A video exported before this keeps its caption until you export again.' : ''}</span>
            {spec.caption?.trim() && <textarea className="st-textarea st-dim" rows={2} aria-label="Caption (off)" value={spec.caption} readOnly />}
          </div>
        ) : (
          <Field id="post-caption" group label="Words (optional)" hint={`Leave it empty for a video with no caption; you can add text in the editor. In the upper third, kept clear of her mouth and hands and of TikTok's buttons. Up to ${data.options.caption.maxChars} characters; emoji work.`}
            extra={<span className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}><button type="button" className="st-btn sm ghost" onClick={() => setHooks(true)}><Sparkles size={13} />Pick a hook</button><LineBankButton className="st-btn sm ghost" post={{ id: item.id, kind: item.kind, characterId: item.characterId, accountTag: item.accountTag }} /></span>}>
            <textarea className="st-textarea" rows={3} aria-label="Caption" maxLength={data.options.caption.maxChars} value={spec.caption ?? ''} onChange={e => draft.setSpec({ caption: e.target.value })} placeholder="e.g. me when the code finally works and I have no idea why 💀" />
            <LintNote hits={lint(spec.caption ?? '', 'hook', { product })} field="hook-lint" />
          </Field>
        )}
        {(alt.trim() || (spec.caption ?? '').trim()) && (
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }} data-field="alt-hook">
            <span className="st-hint">Alt hook:</span>
            <input className="st-input sm" style={{ flex: '1 1 220px', minWidth: 0 }} maxLength={200} value={alt} onChange={e => setPlan({ altHook: e.target.value })} placeholder="The runner-up hook (optional)" aria-label="Alt hook" />
            <button type="button" className="st-btn sm secondary" disabled={!alt.trim()} title={alt.trim() ? 'The words on the video and the alt hook trade places (free)' : 'Write an alt hook first'}
              onClick={() => draft.setSpec({ caption: alt.slice(0, data.options.caption.maxChars), plan: { ...(plan ?? {}), altHook: spec.caption ?? '' } } as never)}><ArrowLeftRight size={13} />Swap with the alt hook</button>
          </div>
        )}
        <PostCaptionFields plan={plan} product={product} lint={lint} onChange={setPlan} max={data.options.slideshow.hashtagsMax ?? 5} />
        <HookPicker open={hooks} onClose={() => setHooks(false)} characterId={ctx.item.characterId} productId={item.productId ?? null} onPick={t => { draft.setSpec({ caption: t.slice(0, data.options.caption.maxChars) }); setHooks(false) }} />
      </div>
      <div className="st-content-side"><CaptionPreview text={spec.captionOff ? '' : spec.caption ?? ''} data={data} video={clip?.assetId} look={spec.captionStyle} /><span className="st-hint">{spec.captionOff ? 'Preview: no caption.' : 'Preview. The export uses the same font, style and safe zones.'}</span></div>
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
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="st-hint">About "{topic || 'your idea'}". Or paste your own below, or add one from the bank.</span>
          <LineBankButton className="st-btn sm ghost" post={{ id: item.id, kind: item.kind, characterId: item.characterId, accountTag: item.accountTag }} />
        </div>
        <Field id="batch-captions" label={`Captions, one per line, optional (${captions.length}${captions.length > max ? `, the first ${max} are used` : ''})`} hint={spec.captionOff ? 'No caption is drawn on the videos. Lines here still count them; with none, How many does.' : 'Each line becomes one video. With none, How many counts the videos and they have no caption.'}>
          <textarea className="st-textarea" rows={8} value={text}
            onFocus={() => { editing.current = true }}
            onBlur={() => { editing.current = false }}
            onChange={e => { setText(e.target.value); draft.setSpec({ captions: e.target.value.split('\n').map(c => c.trim()).filter(Boolean).slice(0, 50) }) }}
            placeholder={'e.g. me pretending I read the syllabus\nPOV: the group chat at 2am before the exam'} />
        </Field>
        <Field id="batch-caption-style" label="Caption style" hint="TikTok's white box, white text with a black outline (TikTok Classic), or No caption on any video (the lines, or How many, still count the videos).">
          <CaptionStylePick value={(draft.spec as { captionStyle?: CaptionStyle | null }).captionStyle} data={data} off={!!spec.captionOff} onOff={v => draft.setSpec({ captionOff: v } as never)} onChange={v => draft.setSpec({ captionStyle: v } as never)} />
        </Field>
      </div>
      <div className="st-content-side"><CaptionPreview text={spec.captionOff ? '' : captions[0] ?? ''} data={data} video={first?.assetId} look={(draft.spec as { captionStyle?: CaptionStyle | null }).captionStyle} /><span className="st-hint">{spec.captionOff ? 'Preview: no caption.' : 'The first caption, as a preview.'}</span></div>
    </div>
  )
}

// Library drawer > Hooks (UX-PLAN.md section 14): a hook, or a variant
// written in this character's voice, becomes the caption. The post's own
// product's vault (section 29); with no product, pick one to browse.
export function HookPicker({ open, onClose, characterId, onPick, productId: own = null }: { open: boolean; onClose: () => void; characterId: string | null; onPick: (text: string) => void; productId?: string | null }) {
  const products = useProducts()
  const list = products.data?.products ?? []
  const [productId, setProductId] = useState<string | null>(null)
  const current = productId ?? own ?? null
  const product = useProduct(open ? current : null)
  const hooks = product.data?.hooks ?? []
  return (
    <Drawer open={open} onClose={onClose} title="Pick a hook" wide>
      <div className="st-col" style={{ gap: 12 }}>
        <div className="st-row"><HowTo id="hooks" label="How hooks work" /></div>
        {!own && list.length > 0 && <span className="st-hint" data-field="hookpicker-no-product">This post has no product (Idea step). Pick one to browse its vault; the post stays as it is.</span>}
        {list.length > 1 || (!own && list.length > 0) ? <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>{list.map(p => <button key={p.id} className={`st-chip ${p.id === current ? 'on' : ''}`} onClick={() => setProductId(p.id)}>{p.name}{p.id === own ? ' (this post)' : ''}</button>)}</div> : null}
        {!products.data ? <div className="st-skel" style={{ height: 120 }} /> : !list.length ? <span className="st-hint">No hooks yet. Load a script kit in Library, Hooks.</span> : !current ? null : !product.data ? <div className="st-skel" style={{ height: 200 }} /> : (
          <div className="st-col" style={{ gap: 6 }}>
            <span className="st-hint">Variants in this character's voice come first under each hook. Write more in Library, Hooks.</span>
            {hooks.map(h => {
              const mine = h.variants.filter(v => v.characterId === characterId)
              return (
                <div key={h.id} className="st-col" style={{ gap: 4 }}>
                  {mine.map(v => <button key={v.id} type="button" className="st-hookpick mine" onClick={() => onPick(v.text)}><span className="st-badge ok">{h.number}</span>{v.text}</button>)}
                  <button type="button" className="st-hookpick" onClick={() => onPick(h.text)}><span className="st-badge">{h.number}</span>{h.text}<span className="st-hint">{h.kind}</span></button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Drawer>
  )
}

// A video post's own caption for TikTok or Instagram (not the words on the
// video): from its plan row or typed here, with its hashtags and CTA line,
// linted, and copied as posted (section 28).
export function PostCaptionFields({ plan, product, lint, onChange, max }: { plan: MemeSpec['plan']; product: boolean; lint: ReturnType<typeof useLint>; onChange: (patch: Record<string, unknown>) => void; max: number }) {
  const toast = useToast()
  const caption = plan?.caption ?? ''
  const tags = plan?.hashtags ?? []
  const cta = plan?.cta ?? ''
  const posted = postCaption(caption, tags, { ad: product, max, cta })
  return (
    <div className="st-col" style={{ gap: 8 }} data-field="post-caption-to-post">
      <Field label="Caption to post (not on the video)" hint="What goes under the video on TikTok or Instagram: 1 to 3 short sentences that add a layer. Optional.">
        <textarea className="st-textarea" rows={2} maxLength={2200} value={caption} onChange={e => onChange({ caption: e.target.value })} placeholder="e.g. we said one episode. it is 2am." />
      </Field>
      <LintNote hits={lint(caption, 'caption', { product, hashtags: tags })} field="post-caption-lint" />
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="st-input" style={{ flex: '2 1 220px', minWidth: 0 }} value={tags.join(' ')} onChange={e => onChange({ hashtags: e.target.value.split(/[\s,]+/).map(h => h.replace(/^#+/, '')).filter(Boolean).slice(0, 15) })} aria-label="Hashtags" placeholder={`Hashtags, at most ${max}, without #`} />
        <input className="st-input" style={{ flex: '3 1 260px', minWidth: 0 }} maxLength={300} value={cta} onChange={e => onChange({ cta: e.target.value })} aria-label="CTA line" placeholder="CTA line: a question, a warm offer or a shrug" />
      </div>
      {posted && (
        <div className="st-row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <pre className="st-license" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, flex: 1, margin: 0 }}>{posted}</pre>
          <button type="button" className="st-btn ghost sm" onClick={async () => { try { await navigator.clipboard.writeText(posted); toast({ tone: 'ok', text: 'Caption copied.' }) } catch { toast({ tone: 'bad', text: 'Could not copy. Select the text and copy it.' }) } }}><Copy size={14} />Copy</button>
        </div>
      )}
    </div>
  )
}
