import { useState } from 'react'
import { Download, FileUp, Fingerprint, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { Callout, PromptViewer, errorMessage, useToast } from '../../ui'
import type { CharacterView } from '../../types'
import { BrandCard, TemplateCheckList } from './BrandCard'

// Stage 5: character-[name].md, the human-readable source of truth. It
// round-trips: export, edit by hand, import the edits back.
export function FileTab({ v }: { v: CharacterView }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [busy, setBusy] = useState(false)

  async function applyEdits(files: File[]) {
    setBusy(true)
    try {
      const r = await api.applyFile(v.id, files)
      refresh(v.id)
      const shots = r.importedShots.length ? ` Added ${r.importedShots.join(', ')} to the sheet${r.checkJobId ? '; checking faces and skin texture against REF-00' : ''}.` : ''
      const hasFile = files.some(f => f.name.toLowerCase().endsWith('.md'))
      toast({ tone: 'ok', text: `${hasFile ? 'Edits imported; the previous version is in history.' : 'Sheet images added.'}${shots}` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="st-col" style={{ gap: 20 }}>
      <BrandCard v={v} />
      <section className="st-card">
        <div className="st-card-head"><div className="grow"><div className="st-h2">5. Character file</div><div className="st-hint">character-{v.slug}.md: card, side-specific marks, body, makeup, and every approved sheet shot with its checksum.</div></div></div>
        <div className="st-card-body st-col" style={{ gap: 14 }}>
          <div className="st-row">
            <a className="st-btn primary" href={api.exportUrl(v.id)}><Download size={16} />Download character file</a>
            <label className="st-btn" style={{ cursor: 'pointer' }}>
              {busy ? <Loader2 size={16} className="st-spin" /> : <FileUp size={16} />}Import edits or sheet images
              <input type="file" multiple accept=".md,text/markdown,image/*" hidden onChange={e => e.target.files?.length && applyEdits(Array.from(e.target.files))} />
            </label>
          </div>
          <Callout tone="info">Edit the Card, Body and Notes sections freely, or bring in a new version from the Claude project. Marks and settings live in the block at the top. Images named REF 00 to REF 11 (or REF-00) become approved sheet shots; one identical to the approved shot is skipped. Importing keeps the posts, takes and sheet, merges the combo log, and keeps the previous version in history.</Callout>
          {!v.sheet.progress.complete && <Callout tone="warn">The sheet is {v.sheet.progress.approved} of 12. The file records what is approved so far.</Callout>}
          <TemplateCheckList report={v.template} />
        </div>
      </section>
      <Knowledge v={v} />
    </div>
  )
}

const ROLE: Record<string, string> = {
  sheet: 'Sheet', scene_still: 'Scene stills', scene_still_alt: 'Scene stills, also', edit: 'Edits', video_final: 'Final video', video_test: 'Motion tests',
}

// What the file taught the Studio beyond the card: the saved identity,
// model choices, and the sections kept word for word (scene rules, recipes).
function Knowledge({ v }: { v: CharacterView }) {
  const d = v.data
  const label = (ref: string) => v.modelLabels[ref] ?? ref
  const prefs = Object.entries(d.preferredModels ?? {})
  const ids = d.identities ?? []
  const ideas = (d.style?.ideas as string[] | undefined) ?? []
  const constants = d.marks.filter(m => m.kind === 'jewelry')
  if (!ids.length && !prefs.length && !d.avoidModels?.length && !d.sections?.length && !ideas.length) return null
  return (
    <section className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">From the character file</div><div className="st-hint">Kept with {d.name} and written back on every export.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        {ids.map(id => (
          <div key={id.externalId} className="st-row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <Fingerprint size={18} style={{ color: 'var(--st-accent-2)', flex: 'none', marginTop: 2 }} />
            <div className="st-col" style={{ gap: 4, minWidth: 0, flex: 1 }}>
              <b>
                {id.provider === 'higgsfield' ? 'Higgsfield ' : ''}
                {id.kind === 'element' ? 'Element' : `${id.model ? label(id.model) : 'trained'} character`} "{id.name}"
                {id.status !== 'ready' && <span className="st-badge plain warn" style={{ marginLeft: 8 }}>{id.status}</span>}
              </b>
              <span className="st-hint">{id.kind === 'element' ? 'Instant, no training. ' : 'Trained. '}<span className="st-mono">{id.externalId}</span></span>
              {id.promptBlock && <span className="st-hint">Every {id.model ? label(id.model) : ''} prompt includes: "{id.promptBlock}"</span>}
              {id.followUp && <span className="st-hint">{id.followUp.name}{id.followUp.model ? ` (${label(id.followUp.model)})` : ''}: {id.followUp.text}</span>}
            </div>
          </div>
        ))}
        {(prefs.length > 0 || (d.avoidModels?.length ?? 0) > 0) && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {prefs.map(([role, ref]) => <span key={role} className="st-badge plain ok" title={ref}>{ROLE[role] ?? role}: {label(ref)}</span>)}
            {d.avoidModels.map(ref => <span key={ref} className="st-badge plain bad" title={ref}>Avoid: {label(ref)}</span>)}
          </div>
        )}
        {ideas.length > 0 && (
          <div className="st-col" style={{ gap: 6 }}>
            <div className="st-kicker">Style ideas, optional</div>
            <span className="st-hint">Never put into a prompt: every scene names its own outfit.{constants.length ? ` The one constant: ${constants.map(m => `${m.description} on ${d.pronouns.poss} ${m.side} ${m.region}`).join(', ')}.` : ''}</span>
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>{ideas.map(i => <span key={i} className="st-chip">{i}</span>)}</div>
          </div>
        )}
        {(d.sections?.length ?? 0) > 0 && (
          <div className="st-col" style={{ gap: 8 }}>
            <div className="st-kicker">Kept as written</div>
            {d.sections.map(s => (
              <details key={s.title} className="st-details">
                <summary>{s.title}</summary>
                <PromptViewer label={s.title} text={s.body} wrapped={s.wrapped ?? s.body} />
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
