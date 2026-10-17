import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { Field, Modal, errorMessage, useToast } from '../../ui'
import type { CharacterView, VoiceCard } from '../../types'
import { HowTo } from '../../guide/Guide'

// The voice card (UX-PLAN.md sections 13 and 14): the character's
// ElevenLabs voice for voice lines, and how the character talks, which the
// caption, script and hook writers follow. Every field is optional: a
// starting point, never a lock.

type Form = Record<'elevenlabsId' | 'who' | 'pov' | 'talks' | 'uses' | 'never' | 'emoji' | 'humor' | 'pillars' | 'example', string>

const LISTS = ['uses', 'never', 'pillars'] as const

function init(v: CharacterView): Form {
  const c = ((v.data.persona as { voice?: VoiceCard }).voice ?? {}) as VoiceCard
  return {
    elevenlabsId: c.elevenlabsId ?? '', who: c.who ?? '', pov: c.pov ?? '', talks: c.talks ?? '', emoji: c.emoji ?? '', humor: c.humor ?? '', example: c.example ?? '',
    uses: (c.uses ?? []).join('; '), never: (c.never ?? []).join('; '), pillars: (c.pillars ?? []).join('; '),
  }
}

function toCard(f: Form): VoiceCard {
  const out: VoiceCard = {}
  for (const [k, v] of Object.entries(f) as Array<[keyof Form, string]>) {
    const t = v.trim()
    if (!t) continue
    if ((LISTS as readonly string[]).includes(k)) (out as Record<string, unknown>)[k] = t.split(/\s*;\s*/).filter(Boolean)
    else (out as Record<string, unknown>)[k] = t
  }
  return out
}

export function VoiceEditor({ v, open, onClose }: { v: CharacterView; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [form, setForm] = useState(() => init(v))
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setForm(init(v)) }, [open, v])
  const name = v.data.name
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function save() {
    setBusy(true)
    try {
      await api.updateCharacter(v.id, { voice: toCard(form) }, 'edited the voice')
      refresh(v.id)
      toast({ tone: 'ok', text: `Saved ${name}'s voice. A new revision was kept.` })
      onClose()
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="st-card-body st-col" style={{ gap: 14 }}>
        <div><div className="st-kicker st-row" style={{ gap: 10 }}>Voice<HowTo id="voice" label="How voices work" /></div><div className="st-h2">How {name} sounds and talks</div><span className="st-hint">All optional. The caption, script and hook writers write in this voice, so accounts never sound alike.</span></div>
        <Field id="voice-eleven" label="ElevenLabs voice ID" hint="For voice lines: your takes are turned into this voice. Copy it from ElevenLabs (Voices, the voice, ID).">
          <input className="st-input st-mono" value={form.elevenlabsId} placeholder="e.g. 21m00Tcm4TlvDq8ikWAM" onChange={set('elevenlabsId')} />
        </Field>
        <div className="st-grid two" style={{ gap: 12 }}>
          <Field id="voice-who" label="Who"><input className="st-input" value={form.who} placeholder="e.g. 24, just moved to a new city, sunny and a little chaotic" onChange={set('who')} /></Field>
          <Field id="voice-pov" label="Point of view"><input className="st-input" value={form.pov} placeholder="e.g. my friend / my roommate / me storytime" onChange={set('pov')} /></Field>
        </div>
        <Field id="voice-talks" label="Talks like"><textarea className="st-textarea" rows={2} value={form.talks} placeholder="e.g. casual, short sentences, a bit dramatic for laughs" onChange={set('talks')} /></Field>
        <div className="st-grid two" style={{ gap: 12 }}>
          <Field id="voice-uses" label="Words and phrases used" hint="Separate with semicolons."><input className="st-input" value={form.uses} placeholder="e.g. be so for real; I'm crying" onChange={set('uses')} /></Field>
          <Field id="voice-never" label="Never" hint="Suggestions for the writers, never a block."><input className="st-input" value={form.never} placeholder="e.g. leverage; synergy; hard selling" onChange={set('never')} /></Field>
        </div>
        <div className="st-grid two" style={{ gap: 12 }}>
          <Field id="voice-emoji" label="Emoji"><input className="st-input" value={form.emoji} placeholder="e.g. 😭 💀 🥲, one per caption, at the end" onChange={set('emoji')} /></Field>
          <Field id="voice-humor" label="Humor"><input className="st-input" value={form.humor} placeholder="e.g. self-roasting" onChange={set('humor')} /></Field>
        </div>
        <Field id="voice-pillars" label="Content pillars" hint="Separate with semicolons."><input className="st-input" value={form.pillars} placeholder="e.g. storytime; relatable pain; small wins; soft product" onChange={set('pillars')} /></Field>
        <Field id="voice-example" label="An example line in this voice"><input className="st-input" value={form.example} placeholder="e.g. we said one episode. it is 2am. be so for real 😭" onChange={set('example')} /></Field>
        <div className="st-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="st-btn ghost" onClick={onClose}>Cancel</button>
          <button className="st-btn primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save voice'}</button>
        </div>
      </div>
    </Modal>
  )
}

// One line for the profile: what is set.
export function voiceSummary(v: CharacterView): string {
  const c = ((v.data.persona as { voice?: VoiceCard }).voice ?? {}) as VoiceCard
  const parts = [c.elevenlabsId ? 'ElevenLabs voice set' : 'No ElevenLabs voice yet', c.talks || c.pov || c.uses?.length ? 'voice card filled' : 'no voice card yet']
  return parts.join(' · ')
}
