import { useMemo, useState } from 'react'
import { SelectAllBox, SelectBox, SelectionCount, useSelection } from '../../../select'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Check, ChevronDown, ChevronRight, ExternalLink, Layers, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api } from '../../../api'
import { keys, useSocialAccounts } from '../../../hooks'
import { PriceButton } from '../../../PriceButton'
import { RunStatus } from '../../../runs'
import { AsyncButton, Field, errorMessage, useToast } from '../../../ui'
import { HowTo } from '../../../guide/Guide'
import { HOOK_PATTERNS, backdropFor, isProductPost, patternLabel, slideList, wordCount, type HookIdea, type HookPattern } from '../../../../../server/core/slides'
import { SHIPS, codeLabel, effectLabel } from '../../../../../server/core/playbook'
import { LintNote, useLint, useProductRules } from '../../../lint'
import { wordsNote } from '../../../../../server/core/slideSvg'
import type { SlideBatch, SlideshowSpec } from '../../../types'
import type { PostCtx } from '../ctx'
import { SlideFrame, slideViewerItems } from './SlideFrame'
import { Viewer, useViewer } from '../../../viewer'
import { LineBankButton } from '../LineBank'
import { useSlideFonts } from './draw'

// The slideshow's Idea step, hook first (UX-PLAN.md section 27): the hook
// box, Write 10 hooks (from the vault for free, or with Claude, priced),
// each hook's Use this hook (drafts every slide, priced), who is in the
// photos, how many slides, and Batch from hooks with its review.

export function SlideshowIdea({ ctx }: { ctx: PostCtx }) {
  const { item, draft } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const lint = useLint(item.characterId, item.productId)
  const spec = draft.spec as unknown as SlideshowSpec
  const [filter, setFilter] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  // What the post's product adds on top of the general standard (section
  // 29): SideStep's stop-test reviewer, pain and structures; none for a post
  // with no product or a product that adds no rules.
  const rules = useProductRules(item.productId)
  const account = useSocialAccounts().data?.accounts.find(a => a.tag === item.accountTag)
  const ideas = (spec.hookIdeas ?? []) as HookIdea[]
  // Claude's hooks show once the reviewer has scored them (a product whose
  // rules add the reviewer), and only the 1s and 2s; otherwise the writer's
  // own rank (the general standard, one call, or a review that did not come
  // back).
  const reviewing = spec.hookReview === 'pending'
  const ships = (h: HookIdea) => h.source !== 'claude' || (h.reviewed ? SHIPS(h.score) : SHIPS(h.selfScore ?? 1))
  const visible = reviewing ? ideas.filter(h => h.source !== 'claude') : ideas.filter(ships)
  const hidden = reviewing ? 0 : ideas.filter(h => h.source === 'claude' && !ships(h)).length
  const stopFails = reviewing ? 0 : ideas.filter(h => h.source === 'claude' && h.reviewed && h.stops === false).length
  const byCode = visible.some(h => h.code)
  const tagOf = (h: HookIdea) => (byCode ? h.code ?? '' : h.pattern)
  const shown = filter ? visible.filter(h => tagOf(h) === filter) : visible
  const n = spec.slideCount ?? ctx.data.options.slideshow.draftSlides ?? 6
  const hook = spec.hook ?? ''
  const alt = spec.plan?.altHook ?? ''
  const note = wordsNote(hook)
  const name = ctx.v?.data.name ?? 'the character'
  const product = isProductPost(spec)
  const last = rules.review ? account?.lastCode ?? null : null

  async function fromVault() {
    try {
      await draft.flush()
      await api.vaultHooks(item.id, { offset, ...(filter && !byCode ? { patterns: [filter as HookPattern] } : {}) })
      setOffset(o => o + 5)
      await qc.invalidateQueries({ queryKey: keys.content })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  // The alt hook swap (free): the hook and the alt hook trade places.
  const swap = () => draft.setSpec({ hook: alt, plan: { ...spec.plan, altHook: hook } } as never)
  const use = (h: HookIdea) => ({ type: 'slideshow_draft' as const, contentId: item.id, hook: h.text, pattern: h.pattern, ...(h.code ? { code: h.code, effectOpen: h.effectOpen ?? null, effectPayoff: h.effectPayoff ?? null } : {}), ...(h.moment || h.alt || h.code ? { moment: h.moment ?? '', alt: h.alt ?? '', score: h.score ?? h.selfScore ?? null } : {}) })

  return (
    <div className="st-col" style={{ gap: 14 }} data-field="slideshow-hook">
      <Field id="post-hook" label="Hook (slide 1)" extra={<HowTo id="slideshow" label="Hook first, how it works" />}
        hint={note ?? (rules.review
          ? `The words on the first slide, to the general standard plus ${rules.name}'s rules (THE STANDARD): name the job situation, say exactly what happened, pain 7 or more, like a text from a friend in the group chat, about 15 words, with a loop the slides close. Type your own, or write 10 below and pick one.`
          : 'The words on the first slide, to the general standard: a stranger would stop on it, it is clear on one read with no image, it says exactly what happened, it sounds like a person, about 15 words, with a loop the slides close. Type your own, or write 10 below and pick one.')}>
        <input className="st-input" maxLength={200} value={hook} onChange={e => draft.setSpec({ hook: e.target.value } as never)} placeholder="e.g. My landlord texted &quot;quick question&quot; at 11:48pm. It was not quick" />
      </Field>
      <LintNote hits={lint(hook, 'hook', { product })} field="hook-lint" />
      {(alt.trim() || hook.trim()) && (
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }} data-field="alt-hook">
          <span className="st-hint">Alt hook:</span>
          <input className="st-input sm" style={{ flex: '1 1 220px', minWidth: 0 }} maxLength={200} value={alt} onChange={e => draft.setSpec({ plan: { ...spec.plan, altHook: e.target.value } } as never)} placeholder="The runner-up hook (optional)" aria-label="Alt hook" />
          <button type="button" className="st-btn sm secondary" disabled={!alt.trim()} title={alt.trim() ? 'The hook and the alt hook trade places (free)' : 'Write an alt hook first'} onClick={swap}><ArrowLeftRight size={13} />Swap with the alt hook</button>
        </div>
      )}

      <div className="st-col" style={{ gap: 8 }}>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <span className="st-label" style={{ alignSelf: 'center' }}>Write 10 hooks</span>
          <AsyncButton className="st-btn sm" onClick={fromVault} icon={<Layers size={14} />}>10 from the vault<span className="st-price">Free</span></AsyncButton>
          {item.characterId && (
            <PriceButton size="sm" variant="secondary" label="Write 10 with Claude" action={draft.saving ? null : { type: 'slideshow_hooks', contentId: item.id }} waiting={draft.saving ? 'Saving...' : undefined}
              watch={j => j.purpose.startsWith(`slideshow_hooks:${item.id}`)} onDone={() => void qc.invalidateQueries({ queryKey: keys.content })} />
          )}
          {item.characterId && <LineBankButton className="st-btn sm secondary" post={{ id: item.id, kind: item.kind, characterId: item.characterId, accountTag: item.accountTag }} />}
        </div>
        {rules.review
          ? <span className="st-hint">From the vault: {rules.name}'s own hooks and the buyers' words, recast into patterns by code (press again for more). With Claude, to the general standard plus {rules.name}'s rules (THE STANDARD, playbook v1.2, its pass and fail examples as the guide): each hook names the job situation and says exactly what happened, pain 7 or more, in the group-chat voice; each with its moment and structure or lens for slides 2 to 6, its effects, and the runner-up as the alt hook. Then a separate reviewer runs the five-check stop test (stops a stranger, clearly a job, exactly what happened, pain 7 or more, sounds like a friend) and scores each 1 to 5; only the 1s and 2s show.{spec.mode === 'topic' ? '' : ` ${name}'s voice card goes in.`}</span>
          : <span className="st-hint">{item.productId ? 'From the vault: the product\'s own hooks and the buyers\' words, recast into patterns by code (press again for more). ' : 'This post has no product, so the vault has nothing to recast (pick a product in the row above to use its vault). '}With Claude, to the general standard, one call: each hook runs the stop test (a stranger would stop, clear on one read, says exactly what happened, sounds like a person), with its moment, its pattern and the runner-up as the alt hook.{spec.mode === 'topic' ? ' The account\'s own words set the voice.' : ` ${name}'s voice card sets the voice.`}</span>}
        {rules.review && (account?.primary || account?.backup || last) && (
          <span className="st-hint" data-field="account-structures">{item.accountTag || 'This account'}: {[account?.primary && `primary ${codeLabel(account.primary)}`, account?.backup && `backup ${codeLabel(account.backup)}`, last && `last post ${codeLabel(last)} (not again)`].filter(Boolean).join(', ')}. Change them on Posts, Accounts.</span>
        )}
      </div>
      {reviewing && <span className="st-hint" role="status">The reviewer is scoring the hooks; only the 1s and 2s will show.</span>}

      {visible.length > 0 && (
        <div className="st-col" style={{ gap: 8 }} data-field="hook-ideas">
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`st-chip ${!filter ? 'on' : ''}`} onClick={() => setFilter(null)}>All ({visible.length})</button>
            {(byCode ? [...new Set(visible.map(h => h.code).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(c => ({ id: c, label: codeLabel(c) })) : HOOK_PATTERNS.filter(p => visible.some(h => h.pattern === p.id)))
              .map(p => <button key={p.id} type="button" className={`st-chip ${filter === p.id ? 'on' : ''}`} onClick={() => setFilter(filter === p.id ? null : p.id)}>{p.label}</button>)}
          </div>
          <div className="st-hooklist">
            {shown.map((h, i) => {
              const on = hook.trim() === h.text.trim()
              const score = h.reviewed ? h.score : h.selfScore
              return (
                <div key={`${h.text}-${i}`} className={`st-hookrow ${on ? 'on' : ''} ${h.code ? 'card' : ''}`} data-field="hook-card">
                  <div className="st-col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                    <span className="text">{h.text}</span>
                    {h.moment && <span className="st-hint moment">Moment: {h.moment}</span>}
                    {h.alt && <span className="st-hint">Alt: {h.alt}</span>}
                    <span className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {h.code ? <span className="st-chip xs on" title="Structure or lens">{codeLabel(h.code)}</span> : <span className="tag">{patternLabel(h.pattern)}{h.source === 'claude' ? '' : ' · vault'}</span>}
                      {h.effectOpen && <span className="st-chip xs" title="The effect: first second, then the payoff">{effectLabel(h.effectOpen)}{h.effectPayoff ? ` to ${effectLabel(h.effectPayoff)}` : ''}</span>}
                      {score != null && h.source === 'claude' && <span className={`st-score s${score}`} title={h.note || (h.reviewed ? 'The reviewer\'s score' : 'The writer\'s own rank (not reviewed)')}>{score}{h.reviewed ? '' : ' (writer)'}</span>}
                      {h.pain != null && h.source === 'claude' && <span className={`st-chip xs ${h.pain >= 7 ? '' : 'warn'}`} title={h.reviewed ? 'The reviewer\'s pain score (7 or more passes the stop test)' : 'The writer\'s own pain score'}>Pain {h.pain}/10</span>}
                      {h.note && <span className="st-hint" style={{ fontSize: 11.5 }}>{h.note}</span>}
                      {h.code && last && h.code === last && <span className="st-lint compact" title="Never the same structure twice in a row">Same code as the last post</span>}
                      <LintNote compact hits={lint(h.text, 'hook', { product })} />
                    </span>
                  </div>
                  {item.characterId && (
                    <PriceButton size="sm" variant={on ? 'primary' : 'secondary'} icon={false} compact label={on ? 'Draft again' : 'Use this hook'}
                      action={use(h)}
                      onStarted={() => draft.setSpec({ hook: h.text, pattern: h.pattern, ...(h.alt ? { plan: { ...spec.plan, altHook: h.alt } } : {}) } as never)} />
                  )}
                </div>
              )
            })}
          </div>
          {hidden > 0 && <span className="st-hint" data-field="hooks-hidden">{hidden} scored 3 to 5 and are hidden (only a 1 or 2 ships){stopFails ? `; ${stopFails} of them failed the stop test` : ''}.</span>}
        </div>
      )}

      {hook.trim().length >= 3 && !ideas.some(h => h.text.trim() === hook.trim()) && item.characterId && (
        <PriceButton label={`Draft ${n} slides from this hook`} variant="secondary" action={draft.saving ? null : { type: 'slideshow_draft', contentId: item.id, hook: hook.trim(), pattern: null, ...(alt.trim() ? { alt: alt.trim() } : {}) }} waiting={draft.saving ? 'Saving...' : undefined} />
      )}
      <RunStatus match={j => j.purpose === `slide_draft:${item.id}:self`} />
      <span className="st-hint">Use this hook drafts its story in the same voice, one thread: the setup, the turn (often a person reacting), the payoff, then relief or a question; every slide clear to a stranger, 4 to 14 words, each with the image line its photo shows and, where it helps, a mock screen. {rules.review ? `On an ad (#ad on) the last slide is a friend's ${rules.name} tip from its honest endings only. ` : item.productId ? 'On an ad (#ad on) the last slide is an honest tip about the product. ' : ''}Plus the caption, a CTA line and 3 to 5 hashtags. Edit anything after.</span>

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
      {spec.mode === 'topic' && <span className="st-hint">A topic account: places and things, for example rooms, streets, desks, shop counters, screens. No one in focus and no faces; the REALISM line still goes in every prompt.</span>}

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
              placeholder={'e.g. Things nobody tells you about your first apartment\nRed flags I ignored at my last haircut\nPOV: the group chat finally answers'} />
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
  // Select all (owner, 2026-10-22): tick rows (shift-click a range), then
  // approve or reject the ticked ones together.
  const sel = useSelection(useMemo(() => items.map(x => x.id), [items]))
  const ready = (x: SlideBatch['items'][number]) => x.spec.review !== 'approved' && x.spec.review !== 'rejected' && !slideList(x.spec).some(s => !s.stillId && !s.special)
  const pickedReady = items.filter(x => sel.has(x.id) && ready(x))
  const pickedOpen = items.filter(x => sel.has(x.id) && x.spec.review !== 'rejected')
  async function decideAll(list: typeof items, decision: 'approve' | 'reject') {
    try { for (const x of list) await api.reviewSlideBatch(ctx.item.id, x.id, decision); sel.clear(); refetch(); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-col" style={{ gap: 10 }} data-field="batch-review">
      <span className="st-label">Review ({items.length} slideshows · {counts.approved} approved · {counts.rejected} rejected)</span>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-field="batch-select">
        <label className="st-row" style={{ gap: 6 }}><SelectAllBox sel={sel} label={`Select all ${items.length}`} />Select all {items.length}</label>
        <SelectionCount sel={sel} />
        {sel.picked.size > 0 && <AsyncButton className="st-btn sm primary" disabled={!pickedReady.length} onClick={() => decideAll(pickedReady, 'approve')} icon={<ThumbsUp size={13} />}>Approve {pickedReady.length}<span className="st-price">Free</span></AsyncButton>}
        {sel.picked.size > 0 && <AsyncButton className="st-btn sm ghost" disabled={!pickedOpen.length} onClick={() => decideAll(pickedOpen, 'reject')} icon={<ThumbsDown size={13} />}>Reject {pickedOpen.length}</AsyncButton>}
      </div>
      {items.map((x, n) => {
        const list = slideList(x.spec)
        const missing = list.filter(s => !s.stillId && !s.special).length
        const state = x.spec.review ?? 'pending'
        return (
          <div key={x.id} className={`st-batchrow ${state}`} data-field={`batch-row-${n}`}>
            <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <SelectBox sel={sel} id={x.id} label={`Select slideshow ${n + 1}`} />
              <b style={{ flex: 1, minWidth: 0 }}>{n + 1}. {x.spec.hook || x.idea}</b>
              <span className="st-hint">{state === 'approved' ? (x.status === 'ready' ? 'Approved, exported' : x.status === 'rendering' ? 'Approved, exporting...' : 'Approved') : state === 'rejected' ? 'Rejected' : missing ? `${missing} still${missing === 1 ? '' : 's'} coming` : 'Ready to review'}</span>
              <Link className="st-btn ghost sm" to={`/studio/posts/${x.id}`}><ExternalLink size={13} />Open</Link>
            </div>
            {fonts && <ReviewStrip postId={x.id} list={list} stills={stills} textStyle={x.spec.textStyle} ad={x.spec.ad} brands={brands} />}
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

// One slideshow's slides in the review: a tap on a photo opens it full size
// (the viewer, section 34), with the slideshow's other photos either side.
function ReviewStrip({ postId, list, stills, textStyle, ad, brands }: { postId: string; list: ReturnType<typeof slideList>; stills: Map<string, string>; textStyle: SlideshowSpec['textStyle']; ad: boolean; brands: { names: string[]; generic: string[] } }) {
  const view = useViewer()
  return (
    <div className="st-slidestrip">
      {list.map(s => {
        const back = s.special ? backdropFor(list, s.index) : s.stillId
        const frame = <SlideFrame key={s.index} slide={s} assetId={back ? stills.get(back) : null} style={textStyle} ad={ad && s.index === 0} width={84} brands={brands} />
        return !s.special && s.stillId && stills.get(s.stillId)
          ? <button key={s.index} type="button" className="st-slideframe-open" onClick={() => view.open(`slide-${s.index}`)} aria-label={`View slide ${s.index + 1} full size`}>{frame}</button>
          : frame
      })}
      <Viewer items={slideViewerItems(list, id => stills.get(id))} openId={view.openId} onOpen={view.open} onClose={view.close}
        actions={(_x, close) => <Link className="st-btn" to={`/studio/posts/${postId}`} onClick={close}><ExternalLink size={15} />Open the post</Link>} />
    </div>
  )
}
