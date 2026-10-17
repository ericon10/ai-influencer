import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, GitBranch } from 'lucide-react'
import { api, downloadUrl } from '../../../api'
import { keys } from '../../../hooks'
import { PriceButton } from '../../../PriceButton'
import { Callout, Img } from '../../../ui'
import { HowTo } from '../../../guide/Guide'
import type { SlideshowSpec } from '../../../types'
import type { PostCtx } from '../ctx'
import { DownloadLink } from '../parts'
import { useLint } from '../../../lint'
import { isProductPost, postCaption } from '../../../../../server/core/slides'

// The slideshow's Finish step (UX-PLAN.md section 27): the export (both
// sizes, caption.txt and post.json in one zip), the warning when a picture
// or the caption is also another account's, and Make variations.

export function SlideshowOutputs({ ctx, name }: { ctx: PostCtx; name: string }) {
  const o = ctx.item.outputs
  if (ctx.item.status !== 'ready' || !o.imageAssetIds) return null
  return (
    <div className="st-col" style={{ gap: 10 }} data-field="slideshow-outputs">
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {o.zipAssetId && <DownloadLink assetId={o.zipAssetId} name={`${name}-slides.zip`}>Download all (zip)</DownloadLink>}
        {o.jsonAssetId && <DownloadLink assetId={o.jsonAssetId} name={`${name}-post.json`}>post.json</DownloadLink>}
      </div>
      <span className="st-hint">The zip has tiktok/ (1080 x 1920, numbered in order){o.instagramAssetIds?.length ? ', instagram/ (1080 x 1440)' : ''}, caption.txt and post.json.</span>
      <span className="st-label">TikTok, 1080 x 1920</span>
      <div className="st-content-strip">
        {o.imageAssetIds.map((id, i) => <a key={id} href={downloadUrl(id, `${String(i + 1).padStart(2, '0')}-${name}.jpg`)} title={`Download slide ${i + 1}`}><Img assetId={id} width={320} style={{ width: 120, aspectRatio: '9 / 16' }} /></a>)}
      </div>
      {!!o.instagramAssetIds?.length && (
        <>
          <span className="st-label">Instagram, 1080 x 1440</span>
          <div className="st-content-strip">
            {o.instagramAssetIds.map((id, i) => <a key={id} href={downloadUrl(id, `${String(i + 1).padStart(2, '0')}-${name}-instagram.jpg`)} title={`Download slide ${i + 1} for Instagram`}><Img assetId={id} width={320} style={{ width: 120, aspectRatio: '3 / 4' }} /></a>)}
          </div>
        </>
      )}
    </div>
  )
}

// Slideshows are TikTok only (owner, 2026-10-16): the export makes the
// 1080 x 1920 set; the 1080 x 1440 Instagram set is an option, off by
// default, and Export makes it next time.
export function InstagramSet({ ctx }: { ctx: PostCtx }) {
  const spec = ctx.draft.spec as unknown as SlideshowSpec
  const on = !!spec.instagramSet
  return (
    <label className="st-row" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }} data-field="slideshow-instagram">
      <button type="button" role="switch" aria-checked={on} aria-label="Also make the Instagram set" className={`st-switch ${on ? 'on' : ''}`} onClick={() => ctx.draft.setSpec({ instagramSet: !on } as never)}><span /></button>
      <span className="st-col" style={{ gap: 2 }}>
        <span>Also make the Instagram set (1080 x 1440)</span>
        <span className="st-hint">Slideshows are TikTok only: Export makes 1080 x 1920. Turn this on for a 3:4 copy of the same slides. Free.</span>
      </span>
    </label>
  )
}

// Never a picture or the exact caption of another account's slideshow
// (default rule slideshow-no-reuse): a warning with Reroll as the fix.
export function ReuseWarning({ ctx }: { ctx: PostCtx }) {
  const { item } = ctx
  const q = useQuery({ queryKey: ['slide-reuse', item.id, item.updatedAt], queryFn: () => api.slideReuse(item.id), staleTime: 10_000 })
  const hits = q.data?.hits ?? []
  if (!hits.length) return null
  return (
    <div data-field="slideshow-reuse" role="status"><Callout tone="warn">
      <div className="st-col" style={{ gap: 6 }}>
        <span className="st-row" style={{ gap: 6 }}><AlertTriangle size={15} /><b>Also in another account's slideshow</b></span>
        {hits.slice(0, 3).map((h, i) => (
          <div key={i} className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="st-hint">{h.kind === 'image' ? `Slide ${(h.slide ?? 0) + 1}'s picture` : 'The exact caption'} is in "{h.postName}" ({h.accountTag}).</span>
            <Link to={`/studio/posts/${h.postId}`} className="st-btn ghost xs"><ExternalLink size={12} />Open</Link>
            {h.kind === 'image' && h.slide != null && item.characterId && <PriceButton size="sm" variant="secondary" icon={false} compact label="Reroll this slide" action={{ type: 'slideshow_stills', contentId: item.id, slides: [h.slide] }} />}
            {h.kind === 'caption' && item.characterId && <PriceButton size="sm" variant="secondary" icon={false} compact label="Rewrite the caption" action={{ type: 'slideshow_caption', contentId: item.id }} />}
          </div>
        ))}
        {hits.length > 3 && <span className="st-hint">And {hits.length - 3} more in other accounts' slideshows.</span>}
        <span className="st-hint">A default (Settings, Rules: Never reuse a picture or caption across accounts). Export still works.</span>
      </div>
    </Callout></div>
  )
}

export function VariationsCard({ ctx }: { ctx: PostCtx }) {
  const { item, draft, data } = ctx
  const qc = useQueryClient()
  const spec = draft.spec as unknown as SlideshowSpec
  const max = data.options.slideshow.maxVariations ?? 5
  const [count, setCount] = useState(Math.min(3, max))
  const family = useQuery({ queryKey: ['slide-family', item.id], queryFn: () => api.slideFamily(item.id) })
  const others = (family.data?.items ?? []).filter(f => !f.isThis)
  const todo = !spec.hook.trim() ? [{ label: 'Write or draft the slides first', target: 'slideshow-hook' }] : []
  return (
    <section className="st-card" data-field="slideshow-variations">
      <div className="st-card-head st-row" style={{ gap: 8 }}>
        <GitBranch size={15} />
        <div className="grow"><div className="st-h3">Make variations</div><div className="st-hint">For your other accounts: a new hook in new words, a new image set, the list reordered (listicles, tier lists, red flags), a new caption. Never the same picture or caption.</div></div>
        <HowTo id="slideshow" label="About variations" />
      </div>
      <div className="st-card-body st-col" style={{ gap: 10 }}>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label className="st-row" style={{ gap: 6 }}><span className="st-label">How many</span>
            <select className="st-select" value={count} onChange={e => setCount(Number(e.target.value))}>{Array.from({ length: max }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <PriceButton label={`Make ${count} variation${count === 1 ? '' : 's'}`} variant="secondary" todo={todo}
            action={todo.length || draft.saving || !item.characterId ? null : { type: 'slideshow_variations', contentId: item.id, count }} waiting={draft.saving ? 'Saving...' : undefined}
            watch={j => j.purpose === `slide_vars:${item.id}` || j.purpose === `slide_still:${item.id}:v`}
            onDone={() => { void family.refetch(); void qc.invalidateQueries({ queryKey: keys.content }) }} />
        </div>
        <span className="st-hint">Each variation is a new slideshow in this family (variation of {family.data?.root === item.id ? 'this post' : 'the first post'}), given another account tag when you have one. Open it to check and export.</span>
        {others.length > 0 && (
          <div className="st-col" style={{ gap: 4 }} data-field="slideshow-family">
            <span className="st-label">This family ({others.length + 1})</span>
            {others.map(f => (
              <Link key={f.id} to={`/studio/posts/${f.id}`} className="st-row st-hookrow" style={{ gap: 8 }}>
                <span className="text">{f.hook || 'Untitled'}</span>
                <span className="tag">{f.accountTag || 'No account tag'} · {f.stills} pictures · {f.status === 'ready' ? 'Exported' : f.status === 'rendering' ? 'Exporting' : 'Draft'}{f.variationOf ? '' : ' · the first'}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// The language lint over every slide and the caption (section 28): free,
// a note with the slide it is on; export still works.
export function LintSummary({ ctx }: { ctx: PostCtx }) {
  const { item, draft } = ctx
  const lint = useLint(item.characterId, item.productId)
  const spec = draft.spec as unknown as SlideshowSpec
  const product = isProductPost(spec)
  const texts = [spec.hook ?? '', ...(spec.slides ?? [])]
  const hits = [
    ...texts.flatMap((t, i) => lint(t, i === 0 ? 'hook' : 'slide', { product, last: i > 0 && i === texts.length - 1 }).map(h => ({ ...h, where: i === 0 ? 'Hook' : `Slide ${i + 1}` }))),
    // The caption as posted: the export puts "Ad:" first on a product post.
    ...lint(postCaption(spec.caption ?? '', [], { ad: product, max: 0, cta: spec.ctaLine ?? '' }), 'caption', { product, hashtags: spec.hashtags ?? [] }).map(h => ({ ...h, where: 'Caption' })),
  ]
  if (!hits.length) return null
  return (
    <div data-field="slideshow-lint" role="status"><Callout tone="warn">
      <div className="st-col" style={{ gap: 4 }}>
        <span className="st-row" style={{ gap: 6 }}><AlertTriangle size={15} /><b>Language notes ({hits.length})</b></span>
        {hits.slice(0, 6).map((h, i) => <span key={i} className="st-hint"><b>{h.where}:</b> {h.message}</span>)}
        {hits.length > 6 && <span className="st-hint">And {hits.length - 6} more, under the words in the Slides step.</span>}
        <span className="st-hint">Defaults (Settings, Rules, area Copy). Export still works.</span>
      </div>
    </Callout></div>
  )
}
