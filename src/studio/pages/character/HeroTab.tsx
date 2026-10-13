import { useState } from 'react'
import { ArrowRight, Check, Star } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Img, MarkChip, errorMessage, scrollToField, useToast } from '../../ui'
import { LastRun } from '../../LastRun'
import type { CharacterView } from '../../types'
import { REALISM_LINE } from '../../copy'

// Stage 3: three hero prompts, several text-only runs each; one hero across
// all prompts becomes REF-00 (SPEC 5.1 rules 1 and 2).
export function HeroTab({ v, onEditCard, goSheet }: { v: CharacterView; onEditCard: () => void; goSheet: () => void }) {
  // An upscale that smoothed the skin never replaces REF-00; say so.
  const lastUpscale = v.sheet.shots[0]?.candidates.filter(c => c.status === 'qa_failed' && c.qaReport?.texture?.smoothed).at(-1)
  const smoothedUpscale = lastUpscale && !v.sheet.shots[0]?.candidates.some(c => c.status === 'approved' && c.createdAt > lastUpscale.createdAt)
    ? `The last upscale smoothed the skin, so REF-00 kept its original. ${lastUpscale.qaReport!.texture!.message.replace(/ Rerun it;.*$/, '')} Run the upscale again.`
    : null
  const toast = useToast()
  const refresh = useRefresh()
  const [runs, setRuns] = useState(4)
  const errors = v.issues.filter(i => i.severity === 'error')
  const live = v.heroes.filter(h => h.status !== 'superseded' || h.favorite)
  const picked = v.heroes.find(h => h.status === 'approved')

  async function pick(id: string) {
    try {
      const r = await api.pickHero(id)
      refresh(v.id)
      toast({ tone: 'ok', text: r.needsUpscale ? `REF-00 set. It is ${r.height}px tall, so upscale it 2x before the sheet.` : 'REF-00 set. The sheet is next.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <div className="st-col" style={{ gap: 24 }}>
      <section className="st-card">
        <div className="st-card-head"><div className="grow"><div className="st-h2">3. Hero portrait</div><div className="st-hint">Text only: the inspiration image is never attached. Bare face, no makeup, no retouching.</div></div><button className="st-btn sm ghost" onClick={onEditCard}>Edit card</button></div>
        <div className="st-card-body st-col" style={{ gap: 14 }}>
          <p className="st-realism left">{REALISM_LINE}</p>
          {v.data.marks.length > 0 && <div className="st-marks">{v.data.marks.map(m => <MarkChip key={m.name + m.side} mark={m} />)}</div>}
          <div className="st-row">
            <span className="st-label">Runs per prompt</span>
            <div className="st-stepnum"><button onClick={() => setRuns(r => Math.max(1, r - 1))} aria-label="Fewer" disabled={runs <= 1}>-</button><span>{runs}</span><button onClick={() => setRuns(r => Math.min(8, r + 1))} aria-label="More" disabled={runs >= 8}>+</button></div>
            <span className="st-hint">3 prompts x {runs} = {3 * runs} portraits{runs < 4 ? '. 4 or more per prompt usually makes a better pick.' : ''}</span>
          </div>
          <PriceButton watch={j => j.characterId === v.id && /^hero(:|$)/.test(j.purpose)} action={errors.length ? null : { type: 'hero', characterId: v.id, runsPerPrompt: runs }} label={v.heroes.length ? 'Generate more heroes' : 'Generate heroes'} variant={picked ? 'secondary' : 'primary'} size={picked ? 'normal' : 'big'} todo={errors.map(e => ({ label: e.message.replace(/\.$/, ''), onGo: () => { onEditCard(); window.setTimeout(() => scrollToField(`card-${e.field}`), 250) } }))} />
          <span className="st-hint">Pick one hero across all three prompts. Prefer one where both marks are visible; every later shot copies what REF-00 shows.</span>
        </div>
      </section>

      {picked && (
        <section className="st-card">
          <div className="st-card-body st-col" style={{ gap: 12 }}>
            <div className="st-row"><Callout tone="ok" icon={<Check size={16} />}>REF-00 is set{v.ref00?.height ? ` (${v.ref00.width} x ${v.ref00.height})` : ''}.</Callout><span className="st-spacer" /><button className="st-btn primary" onClick={goSheet}>Build the sheet<ArrowRight size={15} /></button></div>
            {smoothedUpscale && <Callout tone="bad">{smoothedUpscale}</Callout>}
            {v.ref00?.needsUpscale && <><Callout tone="warn">REF-00 is under 1,500 px tall. Upscale it 2x (never more) so small marks survive.</Callout><PriceButton watch={j => j.characterId === v.id && j.purpose === 'upscale'} action={{ type: 'upscale', characterId: v.id }} label="Upscale REF-00 2x" /></>}
            <div className="st-divider" style={{ margin: '4px 0' }} />
            <div className="st-h3">The image wins over the card</div>
            <span className="st-hint">If the hero differs from the card (lip fullness, which ear the cuff landed on), update the card to match the image.</span>
            <LastRun characterId={v.id} purpose="card_update" />
            <PriceButton action={{ type: 'card_update', characterId: v.id }} label="Compare card with hero" variant="secondary" />
            {v.cardSuggestion?.card && <CardSuggestion v={v} />}
          </div>
        </section>
      )}

      {[0, 1, 2].map(i => {
        const items = live.filter(h => h.heroPromptIndex === i)
        if (!items.length) return null
        return (
          <section key={i}>
            <div className="st-section-head"><div className="st-h3">Hero prompt {i + 1}</div><span className="st-muted">{items.length} results</span></div>
            <div className="st-grid heroes">
              {items.map(h => (
                <div key={h.id} className="st-tile" style={h.status === 'approved' ? { borderColor: 'rgba(63,209,143,0.6)' } : h.status === 'qa_failed' ? { opacity: 0.72 } : undefined}>
                  {h.status === 'failed' ? <div className="st-img" style={{ aspectRatio: '3/4', display: 'grid', placeItems: 'center', padding: 12 }}><span className="st-hint" style={{ textAlign: 'center' }}>{h.rejectNote || 'This run failed. It cost nothing.'}</span></div> : <Img assetId={h.assetId} width={420} />}
                  {h.status === 'approved' && <span className="st-badge ok">REF-00</span>}
                  {h.status === 'qa_failed' && <span className="st-badge bad">Too similar</span>}
                  {h.qaReport?.identity?.kind === 'distinctness' && (
                    <span className="st-hint" title="Face similarity to the closest inspiration face. It must stay under the threshold so the character is a new person.">
                      {h.status === 'qa_failed' ? `Too close to the inspiration person (face match ${h.qaReport.identity.score.toFixed(2)}, must stay under ${h.qaReport.identity.threshold.toFixed(2)}), so it cannot be REF-00.` : `New person: face match ${h.qaReport.identity.score.toFixed(2)} with the inspiration.`}
                    </span>
                  )}
                  <div className="st-row" style={{ gap: 6 }}>
                    {h.status === 'in_review' && <button className="st-btn sm primary" style={{ flex: 1 }} onClick={() => pick(h.id)}>Pick as REF-00</button>}
                    {h.assetId && <button className="st-btn sm icon ghost" aria-label="Favorite" onClick={async () => { await api.favorite(h.id, !h.favorite); refresh(v.id) }}><Star size={14} fill={h.favorite ? 'currentColor' : 'none'} /></button>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CardSuggestion({ v }: { v: CharacterView }) {
  const toast = useToast()
  const refresh = useRefresh()
  const s = v.cardSuggestion!
  async function apply() {
    try { await api.updateCharacter(v.id, { card: s.card, ...(s.marks?.length ? { marks: s.marks } : {}) }, 'the image wins: matched the card to the hero'); refresh(v.id); toast({ tone: 'ok', text: 'Card updated to match the hero.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <div className="st-card" style={{ padding: 14, boxShadow: 'none' }}>
      {(s.differences ?? []).length === 0 ? <span className="st-hint">No differences found between the card and the hero.</span> : (
        <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: 'var(--st-text-2)', fontSize: 13 }}>{s.differences!.map((d, i) => <li key={i}><b>{d.field}</b>: card says {d.card_says}; image shows {d.image_shows}</li>)}</ul>
      )}
      {s.card && s.card !== v.data.card && <><p className="st-cardtext" style={{ margin: '0 0 10px' }}>{s.card}</p><button className="st-btn sm primary" onClick={apply}>Use this card</button></>}
    </div>
  )
}
