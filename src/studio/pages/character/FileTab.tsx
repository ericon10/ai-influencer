import { useState } from 'react'
import { Download, FileUp, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { Callout, errorMessage, useToast } from '../../ui'
import type { CharacterView } from '../../types'

// Stage 5: character-[name].md, the human-readable source of truth. It
// round-trips: export, edit by hand, import the edits back.
export function FileTab({ v }: { v: CharacterView }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [busy, setBusy] = useState(false)

  async function applyEdits(file: File) {
    setBusy(true)
    try {
      const r = await api.applyFile(v.id, file)
      refresh(v.id)
      toast({ tone: 'ok', text: r.warnings.length ? `Imported with notes: ${r.warnings.join(' ')}` : 'Edits imported. A new revision was kept.' })
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
              {busy ? <Loader2 size={16} className="st-spin" /> : <FileUp size={16} />}Import my edits
              <input type="file" accept=".md,text/markdown" hidden onChange={e => e.target.files?.[0] && applyEdits(e.target.files[0])} />
            </label>
          </div>
          <Callout tone="info">Edit the Card, Body and Notes sections freely. Marks and settings live in the block at the top. Importing keeps the previous version in history.</Callout>
          {!v.sheet.progress.complete && <Callout tone="warn">The sheet is {v.sheet.progress.approved} of 12. The file records what is approved so far.</Callout>}
        </div>
      </section>
    </div>
  )
}
