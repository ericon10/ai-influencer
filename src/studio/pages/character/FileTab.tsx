import { useState } from 'react'
import { Download, FileUp, Fingerprint, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { Callout, PromptViewer, errorMessage, useToast } from '../../ui'
import type { CharacterView } from '../../types'

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
      const shots = r.importedShots.length ? ` Added ${r.importedShots.join(', ')} to the sheet.` : ''
      const hasFile = files.some(f => f.name.toLowerCase().endsWith('.md'))
      toast({ tone: 'ok', text: `${hasFile ? 'Edits imported; the previous version is in history.' : 'Sheet images added.'}${shots}` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="st-col" style={{ gap: 20 }}>
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
          <Callout tone="info">Edit the Card, Body and Notes sections freely. Marks and settings live in the block at the top. Images named REF-00 to REF-11 become approved sheet shots. Importing keeps the previous version in history.</Callout>
          {!v.sheet.progress.complete && <Callout tone="warn">The sheet is {v.sheet.progress.approved} of 12. The file records what is approved so far.</Callout>}
        </div>
      </section>
      <Knowledge v={v} />
    </div>
  )
}

const ROLE: Record<string, string> = { sheet: 'Sheet', scene_still: 'Scene stills', video_final: 'Final video', video_test: 'Motion tests' }

// What the file taught the Studio beyond the card: the saved identity,
// model choices, and the sections kept word for word (scene rules, recipes).
function Knowledge({ v }: { v: CharacterView }) {
  const d = v.data
  const label = (ref: string) => v.modelLabels[ref] ?? ref
  const prefs = Object.entries(d.preferredModels ?? {})
  if (!d.identity && !prefs.length && !d.avoidModels?.length && !d.sections?.length) return null
  return (
    <section className="st-card">
      <div className="st-card-head"><div className="grow"><div className="st-h2">From the character file</div><div className="st-hint">Kept with {d.name} and written back on every export.</div></div></div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        {d.identity && (
          <div className="st-row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Fingerprint size={18} style={{ color: 'var(--st-accent-2)', flex: 'none', marginTop: 2 }} />
            <div className="st-col" style={{ gap: 2 }}>
              <b>{d.identity.provider === 'higgsfield' ? 'Higgsfield ' : ''}{d.identity.kind === 'element' ? 'Element' : 'Trained identity'} "{d.identity.name}"</b>
              <span className="st-hint">{d.identity.kind === 'element' ? 'Instant, no training.' : ''} <span className="st-mono">{d.identity.externalId}</span></span>
            </div>
          </div>
        )}
        {(prefs.length > 0 || (d.avoidModels?.length ?? 0) > 0) && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {prefs.map(([role, ref]) => <span key={role} className="st-badge plain ok" title={ref}>{ROLE[role] ?? role}: {label(ref)}</span>)}
            {d.avoidModels.map(ref => <span key={ref} className="st-badge plain bad" title={ref}>Avoid: {label(ref)}</span>)}
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
