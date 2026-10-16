import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, ExternalLink, Layers, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api } from '../../../api'
import { keys, useProducts } from '../../../hooks'
import { PriceButton } from '../../../PriceButton'
import { RunStatus } from '../../../runs'
import { AsyncButton, Field, errorMessage, useToast } from '../../../ui'
import { HowTo } from '../../../guide/Guide'
import { HOOK_PATTERNS, backdropFor, patternLabel, slideList, wordCount, type HookIdea, type HookPattern } from '../../../../../server/core/slides'
import { wordsNote } from '../../../../../server/core/slideSvg'
import type { SlideBatch, SlideshowSpec } from '../../../types'
import type { PostCtx } from '../ctx'
import { SlideFrame } from './SlideFrame'
import { useSlideFonts } from './draw'

// The slideshow's Idea step, hook first (UX-PLAN.md section 27): the hook
// box, Write 10 hooks (from the vault for free, or with Claude, priced),
// each hook's Use this hook (drafts every slide, priced), who is in the
// photos, how many slides, and Batch from hooks with its review.

export function SlideshowIdea({ ctx }: { ctx: PostCtx }) {
  const { item, draft } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const spec = draft.spec as unknown as SlideshowSpec
  const [filter, setFilter] = useState<HookPattern | null>(null)
  const [offset, setOffset] = useState(0)
  const products = useProducts().data?.products ?? []
  const ideas = (spec.hookIdeas ?? []) as HookIdea[]
  const shown = filter ? ideas.filter(h => h.pattern === filter) : ideas
  const n = spec.slideCount ?? ctx.data.options.slideshow.draftSlides ?? 6
  const hook = spec.hook ?? ''
  const note = wordsNote(hook)
  const name = ctx.v?.data.name ?? 'the character'

  async function fromVault() {
    try {
      await draft.flush()
      await api.vaultHooks(item.id, { offset, ...(filter ? { patterns: [filter] } : {}) })
      setOffset(o => o + 5)
      await qc.invalidateQueries({ queryKey: keys.content })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <div className="st-col" style={{ gap: 14 }} data-field="slideshow-hook">
      <Field id="post-hook" label="Hook (slide 1)" extra={<HowTo id="slideshow" label="Hook first, how it works" />}
        hint={note ?? 'The words on the first slide: 4 to 12 words that stop the scroll. Type your own, or write 10 below and pick one.'}>
        <input className="st-input" maxLength={200} value={hook} onChange={e => draft.setSpec({ hook: e.target.value } as never)} placeholder="e.g. My manager said I would never get promoted" />
      </Field>

      <div className="st-col" style={{ gap: 8 }}>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <span className="st-label" style={{ alignSelf: 'center' }}>Write 10 hooks</span>
          <AsyncButton className="st-btn sm" onClick={fromVault} icon={<Layers size={14} />}>10 from the vault<span className="st-price">Free</span></AsyncButton>
          {item.characterId && (
            <PriceButton size="sm" variant="secondary" label="Write 10 with Claude" action={draft.saving ? null : { type: 'slideshow_hooks', contentId: item.id }} waiting={draft.saving ? 'Saving...' : undefined}
              watch={j => j.purpose === `slideshow_hooks:${item.id}`} onDone={() => void qc.invalidateQueries({ queryKey: keys.content })} />
          )}
        </div>
        <span className="st-hint">From the vault: the kit's own hooks and the buyers' words, recast into the patterns by code (press again for more). With Claude: the vault, the buyers' words and {name}'s voice card go in. Each hook is tagged with its pattern.</span>
        {products.length > 1 && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="st-hint">Kit:</span>
            {products.map(p => <button key={p.id} type="button" className={`st-chip ${(spec.productId ?? products[0]?.id) === p.id ? 'on' : ''}`} onClick={() => draft.setSpec({ productId: p.id } as never)}>{p.name}</button>)}
          </div>
        )}
      </div>

      {ideas.length > 0 && (
        <div className="st-col" style={{ gap: 8 }} data-field="hook-ideas">
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`st-chip ${!filter ? 'on' : ''}`} onClick={() => setFilter(null)}>All ({ideas.length})</button>
            {HOOK_PATTERNS.filter(p => ideas.some(h => h.pattern === p.id)).map(p => (
              <button key={p.id} type="button" className={`st-chip ${filter === p.id ? 'on' : ''}`} onClick={() => setFilter(filter === p.id ? null : p.id)}>{p.label}</button>
            ))}
          </div>
          <div className="st-hooklist">
            {shown.map((h, i) => {
              const on = hook.trim() === h.text.trim()
              return (
                <div key={`${h.text}-${i}`} className={`st-hookrow ${on ? 'on' : ''}`}>
                  <span className="text">{h.text}</span>
                  <span className="tag">{patternLabel(h.pattern)}{h.source === 'claude' ? ' · Claude' : ' · vault'}</span>
                  {item.characterId && (
                    <PriceButton size="sm" variant={on ? 'primary' : 'secondary'} icon={false} compact label={on ? 'Draft again' : 'Use this hook'}
                      action={{ type: 'slideshow_draft', contentId: item.id, hook: h.text, pattern: h.pattern }}
                      onStarted={() => draft.setSpec({ hook: h.text, pattern: h.pattern } as never)} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {hook.trim().length >= 3 && !ideas.some(h => h.text.trim() === hook.trim()) && item.characterId && (
        <PriceButton label={`Draft ${n} slides from this hook`} variant="secondary" action={draft.saving ? null : { type: 'slideshow_draft', contentId: item.id, hook: hook.trim(), pattern: null }} waiting={draft.saving ? 'Saving...' : undefined} />
      )}
      <RunStatus match={j => j.purpose === `slide_draft:${item.id}:self`} />
      <span className="st-hint">Use this hook drafts every slide: the hook, a setup, the reveal on slide 3 or 4, the payoff, and a soft CTA last, 4 to 12 words a slide, each with the shot its photo shows and, where it helps, a mock phone screen. Plus the caption. Edit anything after.</span>

      <div className="st-row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field id="slideshow-who" label="Who is in the photos" group>
          <div className="st-seg sm" role="radiogroup" aria-label="Who is in the photos">
            <button type="button" role="radio" aria-checked={spec.mode !== 'topic'} className={spec.mode !== 'topic' ? 'on' : ''} onClick={() => draft.setSpec({ mode: 'character' } as never)}>{name}</button>
            <button type="button" role="radio" aria-checked={spec.mode === 'topic'} className={spec.mode === 'topic' ? 'on' : ''} onClick={() => draft.setSpec({ mode: 'topic' } as never)}>No one, a topic</button>
          </div>
        </Field>
        <Field id="slideshow-count" label="Slides">
          <select className="st-select" value={n} onChange={e => draft.setSpec({ slideCount: Number(e.target.value) } as never)}>
            {[3, 4, 5, 6, 7, 8, 9, 10].map(k => <option key={k} value={k}>{k}{k === 6 ? ' (default)' : ''}</option>)}
          </select>
        </Field>
      </div>
      {spec.mode === 'topic' && <span className="st-hint">A topic account: offices, skylines, commutes, desk setups, interview lobbies. No one in focus and no faces; the REALISM line still goes in every prompt.</span>}

      <BatchCard ctx={ctx} />
    </div>
  )
}

// Batch from hooks: paste up to 10, Make 10 (one price: each drafted and its
// set made), then one review: Approve (exported, free), Reroll (a new set,
// priced), Reject (archived).
function BatchCard({ ctx }: { ctx: PostCtx }) {
  const { item, draft, data } = ctx
  const spec = draft.spec as unknown as SlideshowSpec
  const max = data.options.slideshow.batchMax ?? 10
  const [open, setOpen] = useState((spec.batchHooks ?? []).length > 0)
  const [text, setText] = useState((spec.batchHooks ?? []).join('\n'))
  const hooks = text.split('\n').map(h => h.trim()).filter(h => wordCount(h) >= 1)
  const batch = useQuery({ queryKey: ['slide-batch', item.id], queryFn: () => api.slideBatch(item.id), enabled: open, refetchInterval: q => ((q.state.data?.items ?? []).some(x => !x.archived && (x.status === 'rendering' || slideList(x.spec).some(s => !s.stillId && !s.special))) ? 4000 : 15000) })
  const items = batch.data?.items ?? []
  return (
    <section className="st-card st-more" data-field="slideshow-batch">
      <button type="button" className="st-card-head st-row st-more-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Layers size={15} />
        <div className="grow" style={{ textAlign: 'left' }}>
          <div className="st-h3">Batch from hooks</div>
          <div className="st-hint">Paste up to {max} hooks, make a slideshow from each, review them in one place.</div>
        </div>
      </button>
      {open && (
        <div className="st-card-body st-col" style={{ gap: 12 }}>
          <div className="st-row"><HowTo id="slideshow" label="How a batch works" /></div>
          <Field label={`Hooks, one a line (${Math.min(hooks.length, max)} of ${max})`} hint="Each line becomes its own slideshow, drafted from the hook with this post's settings (who is in the photos, slides, scene, text style).">
            <textarea className="st-textarea" rows={6} value={text} onChange={e => { setText(e.target.value); draft.setSpec({ batchHooks: e.target.value.split('\n').map(h => h.trim()).filter(Boolean).slice(0, max) } as never) }}
              placeholder={'e.g. Things nobody tells you about your first job\nRed flags in a job posting I ignored\nPOV: the recruiter finally calls back'} />
          </Field>
          <PriceButton label={`Make ${Math.min(hooks.length, max) || ''} slideshow${hooks.length === 1 ? '' : 's'}`.replace('  ', ' ')} variant="primary"
            todo={hooks.length ? [] : [{ label: 'Paste the hooks', target: 'slideshow-batch' }]}
            action={!hooks.length || draft.saving || !item.characterId ? null : { type: 'slideshow_batch', contentId: item.id }}
            waiting={draft.saving ? 'Saving...' : undefined}
            watch={j => j.purpose === `slide_draft:${item.id}:batch` || j.purpose === `slide_still:${item.id}:b`}
            onStarted={() => setTimeout(() => void batch.refetch(), 1500)} />
          <span className="st-hint">One price: each hook drafted by Claude, then a still for every slide. A slide the draft makes a mock screen gets no still and is not charged.</span>
          {items.length > 0 && <BatchReview ctx={ctx} items={items} assets={batch.data?.assets ?? {}} refetch={() => void batch.refetch()} />}
        </div>
      )}
    </section>
  )
}

function BatchReview({ ctx, items, assets, refetch }: { ctx: PostCtx; items: SlideBatch['items']; assets: Record<string, string>; refetch: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const fonts = useSlideFonts()
  const stills = useMemo(() => new Map([...(ctx.lib?.stills ?? []).map(s => [s.id, s.assetId] as const), ...Object.entries(assets)]), [ctx.lib, assets])
  const brands = { names: ctx.data.options.slideshow.brandNames ?? [], generic: ctx.data.options.slideshow.genericNames ?? [] }
  async function decide(id: string, decision: 'approve' | 'reject' | 'pending') {
    try { await api.reviewSlideBatch(ctx.item.id, id, decision); refetch(); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const counts = { approved: items.filter(x => x.spec.review === 'approved').length, rejected: items.filter(x => x.spec.review === 'rejected').length }
  return (
    <div className="st-col" style={{ gap: 10 }} data-field="batch-review">
      <span className="st-label">Review ({items.length} slideshows · {counts.approved} approved · {counts.rejected} rejected)</span>
      {items.map((x, n) => {
        const list = slideList(x.spec)
        const missing = list.filter(s => !s.stillId && !s.special).length
        const state = x.spec.review ?? 'pending'
        return (
          <div key={x.id} className={`st-batchrow ${state}`} data-field={`batch-row-${n}`}>
            <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <b style={{ flex: 1, minWidth: 0 }}>{n + 1}. {x.spec.hook || x.idea}</b>
              <span className="st-hint">{state === 'approved' ? (x.status === 'ready' ? 'Approved, exported' : x.status === 'rendering' ? 'Approved, exporting...' : 'Approved') : state === 'rejected' ? 'Rejected' : missing ? `${missing} still${missing === 1 ? '' : 's'} coming` : 'Ready to review'}</span>
              <Link className="st-btn ghost sm" to={`/studio/posts/${x.id}`}><ExternalLink size={13} />Open</Link>
            </div>
            {fonts && (
              <div className="st-slidestrip">
                {list.map(s => <SlideFrame key={s.index} slide={s} assetId={(s.special ? backdropFor(list, s.index) : s.stillId) ? stills.get((s.special ? backdropFor(list, s.index) : s.stillId)!) : null} style={x.spec.textStyle} ad={x.spec.ad && s.index === 0} width={84} brands={brands} />)}
              </div>
            )}
            {state !== 'rejected' ? (
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <AsyncButton className={`st-btn sm ${state === 'approved' ? 'ok' : 'primary'}`} disabled={missing > 0 || state === 'approved'} onClick={() => decide(x.id, 'approve')} icon={state === 'approved' ? <Check size={13} /> : <ThumbsUp size={13} />}>{state === 'approved' ? 'Approved' : 'Approve'}<span className="st-price">Free</span></AsyncButton>
                <PriceButton size="sm" variant="secondary" icon={false} compact label="Reroll" action={{ type: 'slideshow_stills', contentId: x.id, slides: list.filter(s => !s.special).map(s => s.index) }} onStarted={() => { if (state === 'approved') void decide(x.id, 'pending') }} />
                <AsyncButton className="st-btn sm ghost" onClick={() => decide(x.id, 'reject')} icon={<ThumbsDown size={13} />}>Reject</AsyncButton>
              </div>
            ) : (
              <div className="st-row"><AsyncButton className="st-btn sm ghost" onClick={() => decide(x.id, 'pending')} icon={<RefreshCw size={13} />}>Bring it back</AsyncButton></div>
            )}
            <RunStatus match={j => j.purpose === `slide_still:${x.id}` || j.purpose === `content_render:${x.id}`} />
          </div>
        )
      })}
    </div>
  )
}
