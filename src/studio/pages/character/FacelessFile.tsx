import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Film, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { AsyncButton, errorMessage, useToast } from '../../ui'
import { HowTo } from '../../guide/Guide'
import type { CharacterView, FacelessFile as File, FacelessPlace, FacelessSound } from '../../types'
import { DeleteCharacter } from './DeleteCharacter'
import { useNewPost } from '../post/parts'

// A faceless character's page (owner, 2026-10-22; UX-PLAN.md section 35,
// item 4b): its file, and nothing that asks for a face. Persona (who, town,
// life details), the place bank (reusable scenes, picked per post like set
// plates), look rules, the voice and line formats, and the sound bank
// (music beds and voiceover clips with their search words).

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item'
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean)

export function FacelessCharacter({ v }: { v: CharacterView }) {
  const toast = useToast()
  const refresh = useRefresh()
  const newPost = useNewPost()
  const [f, setF] = useState<File>(v.faceless!)
  const [dirty, setDirty] = useState(false)
  const set = (next: File) => { setF(next); setDirty(true) }
  async function save() {
    try { await api.saveFaceless(v.id, f); setDirty(false); refresh(v.id); toast({ tone: 'ok', text: 'Saved.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const place = (i: number, p: Partial<FacelessPlace>) => set({ ...f, places: f.places.map((x, k) => (k === i ? { ...x, ...p } : x)) })
  const sound = (i: number, p: Partial<FacelessSound>) => set({ ...f, sounds: f.sounds.map((x, k) => (k === i ? { ...x, ...p } : x)) })
  return (
    <div className="st-page wide" data-field="faceless-character">
      <Link to="/studio/characters" className="st-btn ghost sm" style={{ marginBottom: 14 }}><ArrowLeft size={14} />Characters</Link>
      <div className="st-pagehead" style={{ marginBottom: 18 }}>
        <div className="grow">
          <div className="st-kicker st-row" style={{ gap: 10 }}><span className="st-badge plain">Faceless</span>Its file</div>
          <div className="st-titlerow"><h1 className="st-h1">{v.name}</h1><HowTo id="faceless" /></div>
          <p className="st-sub">No face, no hero, no sheet, no face checks. Stills are real places with no one in them; posts pick a place from the bank or write their own.</p>
        </div>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <DeleteCharacter id={v.id} name={v.name} />
          <button className="st-btn primary" disabled={!!newPost.busy} onClick={() => void newPost.create('meme', { characterId: v.id })}><Film size={16} />Make a post with {v.name}</button>
        </div>
      </div>

      <div className="st-col" style={{ gap: 16 }}>
        <section className="st-card" data-field="faceless-persona">
          <div className="st-card-head"><div className="st-h3">Persona</div></div>
          <div className="st-card-body st-col" style={{ gap: 10 }}>
            <label className="st-col" style={{ gap: 4 }}><span className="st-label">Who</span><textarea className="st-textarea" rows={2} value={f.persona.who} onChange={e => set({ ...f, persona: { ...f.persona, who: e.target.value } })} /></label>
            <label className="st-col" style={{ gap: 4 }}><span className="st-label">Town</span><input className="st-input" value={f.persona.town} onChange={e => set({ ...f, persona: { ...f.persona, town: e.target.value } })} /></label>
            <label className="st-col" style={{ gap: 4 }}><span className="st-label">Life details</span><textarea className="st-textarea" rows={3} value={f.persona.life} onChange={e => set({ ...f, persona: { ...f.persona, life: e.target.value } })} /></label>
          </div>
        </section>

        <section className="st-card" data-field="faceless-places">
          <div className="st-card-head"><div className="grow"><div className="st-h3">Place bank ({f.places.length})</div><div className="st-hint">Reusable scenes, picked per post like set plates. Write the place only: no person or body part, nothing that carries text.</div></div></div>
          <div className="st-card-body st-col" style={{ gap: 8 }}>
            {f.places.map((p, i) => (
              <div key={p.id} className="st-row" style={{ gap: 8, alignItems: 'flex-start' }} data-field={`faceless-place-${p.id}`}>
                <input className="st-input" style={{ width: 200 }} value={p.name} aria-label="Place name" onChange={e => place(i, { name: e.target.value })} />
                <textarea className="st-textarea" rows={2} style={{ flex: 1 }} value={p.line} aria-label={`What ${p.name} shows`} onChange={e => place(i, { line: e.target.value })} />
                <button type="button" className="st-btn sm ghost icon" aria-label={`Remove ${p.name}`} onClick={() => set({ ...f, places: f.places.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" className="st-btn sm secondary" style={{ alignSelf: 'flex-start' }} onClick={() => { const n = `place-${f.places.length + 1}`; set({ ...f, places: [...f.places, { id: `${n}-${Date.now().toString(36).slice(-4)}`, name: 'New place', line: '' }] }) }}><Plus size={13} />Add a place</button>
          </div>
        </section>

        <section className="st-card" data-field="faceless-look">
          <div className="st-card-head"><div className="grow"><div className="st-h3">Look rules</div><div className="st-hint">One per line. Every still also gets the fixed rules: no people, no text on objects, upright portrait, level, and "Level, unedited. Sharp, real phone grain, muted color. No people."</div></div></div>
          <div className="st-card-body"><textarea className="st-textarea" rows={4} value={f.look.join('\n')} aria-label="Look rules" onChange={e => set({ ...f, look: lines(e.target.value) })} /></div>
        </section>

        <section className="st-card" data-field="faceless-voice">
          <div className="st-card-head"><div className="st-h3">Voice and line formats</div></div>
          <div className="st-card-body st-col" style={{ gap: 10 }}>
            <label className="st-col" style={{ gap: 4 }}><span className="st-label">Voice</span><textarea className="st-textarea" rows={2} value={f.voice.notes} onChange={e => set({ ...f, voice: { ...f.voice, notes: e.target.value } })} /></label>
            <label className="st-col" style={{ gap: 4 }}><span className="st-label">Line formats (one per line)</span><textarea className="st-textarea" rows={3} value={f.voice.formats.join('\n')} onChange={e => set({ ...f, voice: { ...f.voice, formats: lines(e.target.value) } })} /></label>
          </div>
        </section>

        <section className="st-card" data-field="faceless-sounds">
          <div className="st-card-head"><div className="grow"><div className="st-h3">Sound bank ({f.sounds.length})</div><div className="st-hint">Music beds and voiceover clips, each with the words to search for it. Upload the files themselves in Library &gt; Sounds; a post picks its music from there.</div></div></div>
          <div className="st-card-body st-col" style={{ gap: 8 }}>
            {f.sounds.map((x, i) => (
              <div key={x.id} className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select className="st-select" style={{ width: 'auto' }} value={x.kind} aria-label="Kind" onChange={e => sound(i, { kind: e.target.value as FacelessSound['kind'] })}><option value="music">Music bed</option><option value="voiceover">Voiceover clip</option></select>
                <input className="st-input" style={{ width: 200 }} value={x.name} aria-label="Sound name" onChange={e => sound(i, { name: e.target.value })} />
                <input className="st-input" style={{ flex: 1, minWidth: 160 }} value={x.search} aria-label="Search words" placeholder="Search words" onChange={e => sound(i, { search: e.target.value })} />
                <button type="button" className="st-btn sm ghost icon" aria-label={`Remove ${x.name}`} onClick={() => set({ ...f, sounds: f.sounds.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" className="st-btn sm secondary" style={{ alignSelf: 'flex-start' }} onClick={() => set({ ...f, sounds: [...f.sounds, { id: `${slug('sound')}-${Date.now().toString(36).slice(-4)}`, kind: 'music', name: 'New sound', search: '', soundId: null }] })}><Plus size={13} />Add a sound</button>
          </div>
        </section>

        <div className="st-row" style={{ gap: 8, position: 'sticky', bottom: 12 }}>
          <AsyncButton className="st-btn primary" disabled={!dirty} onClick={save} icon={<Save size={15} />}>{dirty ? 'Save the file' : 'Saved'}</AsyncButton>
        </div>
      </div>
    </div>
  )
}
