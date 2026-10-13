import { useState } from 'react'
import { ArrowRight, Check, ImagePlus, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Field, Img, MarkChip, SectionProgress, errorMessage, useToast } from '../../ui'
import { LastRun } from '../../LastRun'
import type { CharacterView } from '../../types'
import { REALISM_LINE } from '../../copy'

// Stages 1 and 2: inspiration intake, the Keep / Change breakdown, and three
// concepts to choose from.
export function StartTab({ v, onEditCard, goHero }: { v: CharacterView; onEditCard: () => void; goHero: () => void }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [uploading, setUploading] = useState(0)
  const [notes, setNotes] = useState('')
  const [over, setOver] = useState(false)
  const chosen = v.concepts.find(c => c.status === 'chosen')

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter(f => f.type.startsWith('image/'))
    setUploading(list.length)
    for (const f of list) {
      try { await api.addInspiration(v.id, f) } catch (e) { toast({ tone: 'bad', text: `${f.name}: ${errorMessage(e)}` }) }
      setUploading(n => n - 1)
    }
    refresh(v.id)
  }

  return (
    <div className="st-col" style={{ gap: 24 }}>
      <section className="st-card">
        <div className="st-card-head"><div className="grow"><div className="st-h2">1. Inspiration</div><div className="st-hint">The look to borrow: styling, palette, vibe. The face will be a new person.</div></div><SectionProgress done={v.inspirations.length ? 1 : 0} total={1} /></div>
        <div className="st-card-body st-col" style={{ gap: 14 }}>
          {v.inspirations.length === 0 && <p className="st-realism left">{REALISM_LINE}</p>}
          <Field id="start-inspiration" label="Inspiration images" required done={v.inspirations.length > 0} group hint="At least one. Styling, palette and vibe come from here; never the face.">
          <div className="st-grid heroes">
            {v.inspirations.map(id => <Img key={id} assetId={id} width={360} style={{ aspectRatio: '3/4' }} />)}
            <label className={`st-drop ${over ? 'over' : ''}`} style={{ aspectRatio: '3/4', padding: 12 }} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}>
              {uploading ? <Loader2 className="st-spin" size={22} /> : <ImagePlus size={22} />}
              <span style={{ fontSize: 12.5 }}>{uploading ? `Uploading ${uploading}...` : 'Add images'}</span>
              <input type="file" accept="image/*" multiple hidden onChange={e => e.target.files && upload(e.target.files)} />
            </label>
          </div>
          </Field>
          <Field id="start-notes" label="Notes for the breakdown and concepts (optional)"><textarea className="st-textarea" style={{ minHeight: 64 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Keep the beachy, sun-kissed feel. Late 20s. Not a model look, a real person." /></Field>
          <LastRun characterId={v.id} purpose="breakdown" />
          <PriceButton action={v.inspirations.length ? { type: 'breakdown', characterId: v.id, notes: notes || undefined } : null} label={v.breakdown ? 'Break it down again' : 'Break it down'} variant={v.breakdown ? 'secondary' : 'primary'} todo={v.inspirations.length ? [] : [{ label: 'Add at least one inspiration image', target: 'start-inspiration' }]} />
        </div>
      </section>

      {v.breakdown && (
        <section className="st-card">
          <div className="st-card-head"><div className="grow"><div className="st-h2">Keep and change</div><div className="st-hint">Vibe: {v.breakdown.vibe}</div></div></div>
          <div className="st-card-body">
            <div className="st-kc">
              <div><div className="st-label" style={{ marginBottom: 8 }}>Keep the look</div><ul>{v.breakdown.keep.map((k, i) => <li key={i}><b>{k.aspect}</b>{k.detail}</li>)}</ul></div>
              <div><div className="st-label" style={{ marginBottom: 8 }}>Change the face</div><ul>{v.breakdown.change.map((c, i) => <li key={i}><b>{c.feature}</b>{c.observed} <ArrowRight size={12} style={{ verticalAlign: -1 }} /> {c.direction}</li>)}</ul></div>
            </div>
            {v.breakdown.cautions.length > 0 && <div style={{ marginTop: 12 }}><Callout tone="warn">{v.breakdown.cautions.join(' ')}</Callout></div>}
          </div>
        </section>
      )}

      <section className="st-card">
        <div className="st-card-head">
          <div className="grow"><div className="st-h2">2. Concepts</div><div className="st-hint">Three different people with specific features and two side-specific marks. Pick one.</div></div>
          <button className="st-btn sm ghost" onClick={onEditCard}>Write my own</button>
        </div>
        <div className="st-card-body st-col" style={{ gap: 16 }}>
          <LastRun characterId={v.id} purpose="concepts" />
          <PriceButton action={v.breakdown || notes ? { type: 'concepts', characterId: v.id, notes: notes || undefined } : null} label={v.concepts.length ? 'Propose 3 new concepts' : 'Propose 3 concepts'} variant={v.concepts.length ? 'secondary' : 'primary'} todo={v.breakdown || notes ? [] : [{ label: 'Run the breakdown above, or write notes', target: 'start-notes' }]} />
          {v.concepts.length > 0 && (
            <div className="st-grid cards">
              {v.concepts.map(c => <ConceptCard key={c.id} characterId={v.id} c={c} chosen={chosen?.id === c.id} onChosen={goHero} />)}
            </div>
          )}
          {chosen && <div className="st-row"><Callout tone="ok" icon={<Check size={16} />}>{chosen.data.name} is your character. Next: generate the hero portrait.</Callout><button className="st-btn primary" onClick={goHero}>Go to hero<ArrowRight size={15} /></button></div>}
        </div>
      </section>
    </div>
  )
}

function ConceptCard({ characterId, c, chosen, onChosen }: { characterId: string; c: CharacterView['concepts'][number]; chosen: boolean; onChosen: () => void }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [busy, setBusy] = useState(false)
  const errors = (c.data.issues ?? []).filter(i => i.severity === 'error')
  async function choose() {
    setBusy(true)
    try { await api.chooseConcept(c.id); refresh(characterId); onChosen() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <div className="st-card st-concept" style={chosen ? { borderColor: 'rgba(63,209,143,0.5)' } : undefined}>
      <div className="st-row"><div className="st-concept-name">{c.data.name}</div><span className="st-spacer" /><span className="st-badge plain">{c.data.age}</span></div>
      <p className="st-cardtext" style={{ margin: 0 }}>{c.data.card}</p>
      <div className="st-marks">{c.data.marks.map(m => <MarkChip key={m.name + m.side} mark={m} />)}</div>
      <div className="st-hint">{c.data.vibe}</div>
      {errors.length > 0 && <Callout tone="warn">{errors.map(e => e.message).join(' ')}</Callout>}
      {chosen ? <span className="st-badge ok">Chosen</span> : <button className="st-btn" disabled={busy || errors.length > 0} onClick={choose}>Choose {c.data.name}</button>}
    </div>
  )
}
