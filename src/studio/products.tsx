import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Package } from 'lucide-react'
import { api } from './api'
import { keys, useContent } from './hooks'
import { errorMessage, useToast } from './ui'
import { HowTo } from './guide/Guide'
import type { ContentItem, ProductBrief } from './types'
import { lineOfItem } from './postRow'

// Products (owner, 2026-10-17; UX-PLAN.md section 29): every post belongs to
// one product, or none. Every post is written to the general standard; its
// product adds its own rules on top (SideStep: the job word, pain 7+, the
// honest endings and the language notes) and its vault, buyer language and
// claims sheet. Nothing of a product reaches another product's posts.

export function useProductList(): ProductBrief[] {
  return useContent().data?.products ?? []
}

export function productById(list: ProductBrief[], id: string | null | undefined): ProductBrief | null {
  return (id && list.find(p => p.id === id)) || null
}

// What a post's words are written to, in one line.
export function writingLine(p: ProductBrief | null): string {
  if (!p) return 'No product: the general standard (the stop test, one story thread, clear on one read, an image line a slide), no product words.'
  return p.writing ? `${p.name}: the general standard plus ${p.writingLabel}.` : `${p.name}: the general standard, with ${p.name}'s vault and claims sheet.`
}

// The Product row of the Idea step: No product and each product. Saved with
// the post at once (free).
export function ProductPicker({ item }: { item: ContentItem }) {
  const list = useProductList()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!list.length) return null
  const current = item.productId ?? null
  // Section 45: changing the product clears the line (a line never rides on
  // the wrong product).
  const hasLine = !!lineOfItem(item).text || lineOfItem(item).mode === 'none'
  async function pick(id: string | null) {
    if (id === current || busy) return
    setBusy(true)
    try {
      await api.updateContent(item.id, { productId: id })
      await qc.invalidateQueries({ queryKey: keys.content })
      void qc.invalidateQueries({ queryKey: ['post-row', item.id] })
      void qc.invalidateQueries({ queryKey: ['line-picks', item.id] })
      if (hasLine) toast({ tone: '', text: `Product changed to ${productById(list, id)?.name ?? 'No product'}: the line was cleared. Pick a line for it in the Line step.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  const on = productById(list, current)
  return (
    <div className="st-col" style={{ gap: 6 }} data-field="post-product">
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="radiogroup" aria-label="Product">
        <span className="st-label" style={{ marginRight: 4 }}><Package size={13} style={{ verticalAlign: '-2px' }} /> Product</span>
        <HowTo id="products" label="About products" />
        <button type="button" role="radio" aria-checked={!current} className={`st-chip ${!current ? 'on' : ''}`} disabled={busy} onClick={() => void pick(null)}>{!current && <Check size={12} />}No product</button>
        {list.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={current === p.id} className={`st-chip ${current === p.id ? 'on' : ''}`} disabled={busy} onClick={() => void pick(p.id)}>{current === p.id && <Check size={12} />}{p.name}</button>
        ))}
      </div>
      <span className="st-hint" data-field="post-product-rules">{writingLine(on)}</span>
      {hasLine && <span className="st-hint" data-field="post-product-clears">Changing the product clears this post's line.</span>}
    </div>
  )
}
