import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Package, UserRound } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { AsyncButton, Img, errorMessage, useToast } from '../../ui'
import { HowTo } from '../../guide/Guide'
import { lineOfItem } from '../../postRow'
import { picksOf } from '../../../../server/core/postRow'
import { productById, useProductList } from '../../products'
import type { CharacterSummary, ContentItem } from '../../types'

// Who and what first (owner, 2026-10-23; UX-PLAN.md rule 3 and section 45):
// every post starts with two picks by the owner, the character (or faceless
// account) and the product, where No product is a real choice. Nothing is
// picked for you; nothing of the post loads until both are set. A clip's own
// character comes pre-ticked; a Weeks row's character too, its product only
// when the row named one. Changing the product later clears the line.

export const picksDoneOf = (item: ContentItem) => { const p = picksOf(item.spec); return p.character && p.product }

export function StartSheet({ item, characters, onClose }: { item: ContentItem; characters: CharacterSummary[]; onClose?: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const products = useProductList()
  const p = picksOf(item.spec)
  const changing = !!onClose
  // Pre-ticked only when already picked (a Weeks row, a clip's character, Change).
  const [character, setCharacter] = useState<string | null>(p.character && (changing || (item.spec as { picks?: unknown }).picks) ? item.characterId : null)
  const [product, setProduct] = useState<string | null | undefined>(p.product && changing ? item.productId ?? null : undefined)
  const line = lineOfItem(item)
  const clears = changing && product !== undefined && product !== (item.productId ?? null) && (!!line.text || line.mode === 'none')
  const ready = !!character && product !== undefined

  async function start() {
    try {
      await api.updateContent(item.id, {
        ...(character !== item.characterId ? { characterId: character! } : {}),
        productId: product ?? null,
        spec: { picks: { character: true, product: true } },
      })
      await qc.invalidateQueries({ queryKey: keys.content })
      void qc.invalidateQueries({ queryKey: ['post-row', item.id] })
      void qc.invalidateQueries({ queryKey: ['line-picks', item.id] })
      if (clears) toast({ tone: '', text: 'The product changed, so the line was cleared. Pick a line for it in the Line step.' })
      onClose?.()
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  const sheet = (
    <div className="st-root" style={{ minHeight: 0, background: 'transparent' }}>
      <div className="st-overlay" onClick={onClose} />
      <div className="st-modal st-startsheet" role="dialog" aria-modal="true" aria-label="Who and what" data-field="start-sheet">
        <div className="st-titlerow"><div className="st-h2" style={{ margin: 0 }}>{changing ? 'Who and what' : 'New post: who and what'}</div><HowTo id="who-what" label="Who and what first" /></div>
        <span className="st-hint">Two picks first, every time: the character, then the product (No product is a real choice). Nothing is picked for you.</span>

        <section className="st-col" style={{ gap: 8 }} data-field="start-character">
          <span className="st-label" style={{ margin: 0 }}><UserRound size={13} style={{ verticalAlign: -2 }} /> 1. Character <span className="st-badge plain">{character ? 'set' : 'REQUIRED'}</span></span>
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }} role="radiogroup" aria-label="Character">
            {characters.map(c => (
              <button key={c.id} type="button" role="radio" aria-checked={character === c.id} className={`st-charchip ${character === c.id ? 'on' : ''}`} onClick={() => setCharacter(c.id)}>
                <Img assetId={c.portraitAssetId} width={80} />
                <span>{c.name}{c.kind === 'faceless' ? ' (faceless)' : ''}</span>
                {character === c.id && <Check size={13} />}
              </button>
            ))}
            {!characters.length && <Link to="/studio/characters" className="st-btn sm">Set up a character first</Link>}
          </div>
        </section>

        <section className="st-col" style={{ gap: 8, opacity: character ? 1 : 0.55 }} data-field="start-product">
          <span className="st-label" style={{ margin: 0 }}><Package size={13} style={{ verticalAlign: -2 }} /> 2. Product <span className="st-badge plain">{product !== undefined ? 'set' : 'REQUIRED'}</span></span>
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Product">
            <button type="button" role="radio" aria-checked={product === null} className={`st-chip ${product === null ? 'on' : ''}`} disabled={!character} onClick={() => setProduct(null)}>{product === null && <Check size={12} />}No product</button>
            {products.map(x => (
              <button key={x.id} type="button" role="radio" aria-checked={product === x.id} className={`st-chip ${product === x.id ? 'on' : ''}`} disabled={!character} onClick={() => setProduct(x.id)}>{product === x.id && <Check size={12} />}{x.name}</button>
            ))}
          </div>
          {product !== undefined && <span className="st-hint">{product ? `${productById(products, product)?.name}: its rules, claims and lines only.` : 'No product: the general standard, lines tagged no product, no product words.'}</span>}
        </section>

        {clears && <span className="st-warntext" data-field="start-clears">Changing the product clears this post's line.</span>}
        <div className="st-modal-actions">
          {onClose && <button type="button" className="st-btn ghost" onClick={onClose}>Cancel</button>}
          {!changing && <Link className="st-btn ghost" to="/studio">Back to posts</Link>}
          <AsyncButton className="st-btn primary" disabled={!ready} field="start-go" onClick={start}>{changing ? 'Save' : 'Start the post'}</AsyncButton>
        </div>
        {!ready && <span className="st-hint" data-field="start-left">Left: {[!character && 'the character', product === undefined && 'the product (or No product)'].filter(Boolean).join(' and ')}.</span>}
      </div>
    </div>
  )
  return createPortal(sheet, document.body)
}

// The post's header line: who and what, with Change (the same sheet).
export function WhoWhat({ item, characters }: { item: ContentItem; characters: CharacterSummary[] }) {
  const [open, setOpen] = useState(false)
  const products = useProductList()
  const who = characters.find(c => c.id === item.characterId)?.name ?? 'No character'
  const what = item.productId ? productById(products, item.productId)?.name ?? 'a product' : 'No product'
  return (
    <span className="st-row" style={{ gap: 6, alignItems: 'center' }} data-field="who-what">
      <span className="st-hint"><b>{who}</b> · <b>{what}</b></span>
      <button type="button" className="st-btn xs ghost" onClick={() => setOpen(true)}>Change</button>
      {open && <StartSheet item={item} characters={characters} onClose={() => setOpen(false)} />}
    </span>
  )
}
