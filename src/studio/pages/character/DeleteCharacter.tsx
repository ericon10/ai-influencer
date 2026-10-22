import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { Modal, errorMessage, useToast } from '../../ui'

// Delete character (owner, 2026-10-22; UX-PLAN.md section 35, item 3b): on
// every character, half-built ones too. One confirm; the character goes to
// Library > Trash for 7 days and Restore brings it back with its sheet and
// file. Its posts, stills and takes stay where they are.
export function DeleteCharacter({ id, name, compact = false }: { id: string; name: string; compact?: boolean }) {
  const toast = useToast()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      await api.archiveCharacter(id)
      setOpen(false)
      await qc.invalidateQueries({ queryKey: keys.characters })
      toast({ tone: 'ok', text: `${name || 'The character'} moved to Library > Trash. Restore within 7 days.` })
      nav('/studio/characters')
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" className={`st-btn ${compact ? 'sm ghost icon' : 'ghost'}`} onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }} aria-label={`Delete ${name || 'this character'}`} title="Delete character (to the Trash, restorable)" data-field="delete-character">
        <Trash2 size={compact ? 14 : 15} />{compact ? null : 'Delete character'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="st-col" style={{ gap: 14 }} data-field="delete-character-confirm">
          <div className="st-h2">Delete {name || 'this character'}?</div>
          <span className="st-sub" style={{ margin: 0 }}>It goes to Library &gt; Trash for 7 days; Restore brings it back with its sheet and file. Its posts, stills and takes stay where they are.</span>
          <div className="st-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="st-btn ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="st-btn bad" disabled={busy} onClick={() => void go()}>{busy ? <Loader2 size={15} className="st-spin" /> : <Trash2 size={15} />}Move to the Trash</button>
          </div>
        </div>
      </Modal>
    </>
  )
}
