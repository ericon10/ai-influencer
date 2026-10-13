import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { Callout, Field, Modal, errorMessage, useToast } from '../../ui'
import type { CharacterView, Mark } from '../../types'

const REGIONS = ['brow', 'eye', 'cheek', 'ear', 'lip', 'jaw', 'neck', 'nose', 'temple', 'forehead', 'chin']

// The card and side-specific marks (SPEC 5.1 rule 11). Sides are always the
// character's own LEFT and RIGHT.
export function CardEditor({ v, open, onClose }: { v: CharacterView; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [form, setForm] = useState(() => init(v))
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setForm(init(v)) }, [open, v])
  const words = form.card.trim().split(/\s+/).filter(Boolean).length

  function setMark(i: number, patch: Partial<Mark>) {
    setForm(f => ({ ...f, marks: f.marks.map((m, j) => (j === i ? { ...m, ...patch } : m)) }))
  }

  async function save() {
    setBusy(true)
    try {
      await api.updateCharacter(v.id, { name: form.name, age: form.age ? Number(form.age) : null, card: form.card, eyes: form.eyes, body: form.body, marks: form.marks }, 'edited the card')
      refresh(v.id)
      toast({ tone: 'ok', text: 'Saved. A new revision was kept.' })
      onClose()
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        <div><div className="st-kicker">Character card</div><div className="st-h2">The source of truth for every prompt</div></div>
        <div className="st-grid two" style={{ gap: 12 }}>
          <Field id="card-name" label="Name" required done={!!form.name.trim()}><input className="st-input" value={form.name} placeholder="e.g. Callie" onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field id="card-age" label="Age" required done={Number(form.age) >= 21} hint={form.age && Number(form.age) < 21 ? 'Characters are 21 or older.' : '21 or older.'}><input className="st-input" inputMode="numeric" value={form.age} placeholder="e.g. 24" onChange={e => setForm({ ...form, age: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <Field id="card-card" label={<>Card <span className="st-muted">({words}/40 words)</span></>} required done={!!form.card.trim()}>
          <textarea className="st-textarea" value={form.card} onChange={e => setForm({ ...form, card: e.target.value })} placeholder="e.g. 24, long honey-blonde beachy waves with a deep side part, warm hazel-brown eyes..." />
        </Field>
        <div className="st-grid two" style={{ gap: 12 }}>
          <Field id="card-eyes" label="Eyes"><input className="st-input" value={form.eyes} placeholder="e.g. warm hazel-brown" onChange={e => setForm({ ...form, eyes: e.target.value })} /></Field>
          <Field id="card-body" label="Body (neutral terms)"><input className="st-input" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="e.g. fit, athletic build, defined waist" /></Field>
        </div>
        <div className="st-field" data-field="card-marks">
          <span className="st-label">Distinguishing marks</span>
          <span className="st-hint">Optional. Subtle marks that are part of the face, each on the character's own LEFT or RIGHT side.</span>
          {form.marks.map((m, i) => (
            <div key={i} className="st-card" style={{ padding: 12, boxShadow: 'none', display: 'grid', gap: 8 }}>
              <div className="st-row">
                <input className="st-input" style={{ flex: '1 1 120px' }} value={m.name} placeholder="e.g. mole" onChange={e => setMark(i, { name: e.target.value })} />
                <div className="st-seg">{(['LEFT', 'RIGHT'] as const).map(s => <button key={s} className={m.side === s ? 'on' : ''} onClick={() => setMark(i, { side: s })}>{s}</button>)}</div>
                <button className="st-btn sm icon ghost" aria-label="Remove mark" onClick={() => setForm(f => ({ ...f, marks: f.marks.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
              </div>
              <input className="st-input" value={m.description} placeholder="e.g. Subtle mole above the left brow" onChange={e => setMark(i, { description: e.target.value })} />
              <div className="st-row">
                <select className="st-select" style={{ flex: 1 }} value={m.region} onChange={e => setMark(i, { region: e.target.value })}>{REGIONS.map(r => <option key={r}>{r}</option>)}</select>
                <div className="st-seg">{(['skin', 'jewelry'] as const).map(k => <button key={k} className={m.kind === k ? 'on' : ''} onClick={() => setMark(i, { kind: k })}>{k}</button>)}</div>
              </div>
            </div>
          ))}
          {form.marks.length < 4 && <button className="st-btn sm" onClick={() => setForm(f => ({ ...f, marks: [...f.marks, { name: '', description: '', side: 'LEFT', region: 'brow', kind: 'skin', subtle: true }] }))}><Plus size={14} />Add mark</button>}
        </div>
        {v.issues.filter(i => i.severity === 'error').length > 0 && <Callout tone="warn">{v.issues.filter(i => i.severity === 'error').map(i => i.message).join(' ')}</Callout>}
        <div className="st-row"><span className="st-spacer" /><button className="st-btn ghost" onClick={onClose}>Cancel</button><button className="st-btn primary" disabled={busy} onClick={save}>Save card</button></div>
      </div>
    </Modal>
  )
}

function init(v: CharacterView) {
  return { name: v.data.name, age: v.data.age ? String(v.data.age) : '', card: v.data.card, eyes: v.data.eyes, body: v.data.body, marks: v.data.marks.map(m => ({ ...m })) }
}
