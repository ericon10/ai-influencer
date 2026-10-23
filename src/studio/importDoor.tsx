import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, Loader2 } from 'lucide-react'
import { CSV_KIND_LABEL, csvKind, type CsvKind } from '../../server/core/csvImport'
import { useToast } from './ui'

// One import door (owner, 2026-10-22; UX-PLAN.md section 35, item 2g):
// Import on Posts home reads the file and sends it where it belongs, with a
// clear message. A week's plan CSV, a launch plan and a faceless account's
// plan open on Weeks (section 37), a results sheet in the Results card, a video batch
// sheet in a new batch post's import, a character file on Characters.

export interface Incoming { kind: CsvKind; name: string; text: string; at: number }
const EVENT = 'st-import'
const BATCH_KEY = 'st-import-batch'

// A card that takes a kind of file: called with each file sent to it.
export function useIncoming(kinds: CsvKind[], on: (f: Incoming) => void) {
  const cb = useRef(on)
  cb.current = on
  useEffect(() => {
    const h = (e: Event) => { const f = (e as CustomEvent<Incoming>).detail; if (kinds.includes(f.kind)) cb.current(f) }
    window.addEventListener(EVENT, h)
    return () => window.removeEventListener(EVENT, h)
  }, [kinds.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
}

// A plan sent to Weeks (UX-PLAN.md section 37): a week's plan CSV, an older
// launch plan or a faceless account's plan, waiting for the Weeks page.
const WEEK_KEY = 'st-import-week'
export function takeWeekFile(): Incoming | null {
  try {
    const raw = sessionStorage.getItem(WEEK_KEY)
    if (!raw) return null
    sessionStorage.removeItem(WEEK_KEY)
    return JSON.parse(raw) as Incoming
  } catch { return null }
}

// The batch sheet waiting for the new batch post's import card.
export function takeBatchSheet(): { name: string; text: string } | null {
  try {
    const raw = sessionStorage.getItem(BATCH_KEY)
    if (!raw) return null
    sessionStorage.removeItem(BATCH_KEY)
    return JSON.parse(raw) as { name: string; text: string }
  } catch { return null }
}

export function ImportDoor({ newBatch }: { newBatch: () => Promise<string | null> }) {
  const toast = useToast()
  const nav = useNavigate()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function read(f: File | undefined) {
    if (!f) return
    if (/\.md$/i.test(f.name)) {
      toast({ tone: 'ok', text: `${f.name} is a character file: import it on Characters with its REF images.` })
      nav('/studio/characters?import=1')
      return
    }
    if (f.size > 400_000) { toast({ tone: 'bad', text: `${f.name} is over 400 KB. Split it.` }); return }
    setBusy(true)
    try {
      const text = await f.text()
      const kind = csvKind(text)
      const detail: Incoming = { kind, name: f.name, text, at: Date.now() }
      if (kind === 'unknown') {
        toast({ tone: 'bad', text: `${f.name} is ${CSV_KIND_LABEL.unknown}. A week's plan needs row_id, account, date and slot (docs/PLAN-CSV-SPEC.md); a results sheet row_id and views_72h; a batch sheet character, clip and caption.` })
        return
      }
      if (kind === 'batch') {
        try { sessionStorage.setItem(BATCH_KEY, JSON.stringify({ name: f.name, text })) } catch { /* private window */ }
        const id = await newBatch()
        if (id) toast({ tone: 'ok', text: `${f.name} is ${CSV_KIND_LABEL.batch}: it is loaded in this new batch's import. Press Preview.` })
        return
      }
      if (kind === 'week' || kind === 'plan' || kind === 'faceless') {
        try { sessionStorage.setItem(WEEK_KEY, JSON.stringify(detail)) } catch { /* private window */ }
        toast({ tone: 'ok', text: `${f.name} is ${CSV_KIND_LABEL[kind]}: opened on Weeks with its free preview.` })
        nav('/studio/weeks?step=import')
        return
      }
      window.dispatchEvent(new CustomEvent(EVENT, { detail }))
      toast({ tone: 'ok', text: `${f.name} is ${CSV_KIND_LABEL[kind]}: opened in the Results card below with its free preview.` })
    } finally { setBusy(false) }
  }
  return (
    <>
      <input ref={file} type="file" accept=".csv,.tsv,.md,text/csv,text/plain,text/markdown" hidden data-field="import-door-file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void read(f) }} />
      <button type="button" className="st-btn" disabled={busy} onClick={() => file.current?.click()} data-field="import-door" title="A launch plan, a results sheet, a video batch sheet or a character file: the Studio reads it and sends it to the right place">
        {busy ? <Loader2 size={15} className="st-spin" /> : <FileUp size={15} />}Import
      </button>
    </>
  )
}
