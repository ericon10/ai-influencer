import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileUp, Plus, Upload } from 'lucide-react'
import { api } from '../api'
import { useCharacters, useRefresh } from '../hooks'
import { Img, Modal, STAGES, errorMessage, useToast } from '../ui'

export default function Characters() {
  const list = useCharacters()
  const nav = useNavigate()
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [creating, setCreating] = useState(false)

  async function create() {
    setCreating(true)
    try { const { id } = await api.createCharacter('New character'); nav(`/studio/c/${id}`) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setCreating(false) }
  }

  const chars = list.data?.characters ?? []
  return (
    <div className="st-page wide">
      <div className="st-pagehead">
        <div className="grow">
          <div className="st-kicker">Your cast</div>
          <h1 className="st-h1">Characters</h1>
          <p className="st-sub">Each character goes from inspiration to a 12-shot reference sheet and a character file. One clear next step at a time.</p>
        </div>
        <button className="st-btn" onClick={() => setImporting(true)}><FileUp size={16} />Import</button>
        <button className="st-btn primary" onClick={create} disabled={creating}><Plus size={16} />New character</button>
      </div>

      {list.isLoading && <div className="st-grid cards">{[0, 1, 2, 3].map(i => <div key={i} className="st-casting"><div className="st-img"><div className="st-skel" style={{ aspectRatio: '3/4' }} /></div><div className="st-casting-body"><div className="st-skel" style={{ height: 22, width: '60%' }} /></div></div>)}</div>}

      {!list.isLoading && chars.length === 0 && (
        <div className="st-empty">
          <h2 className="st-h1">Cast your first <em>character</em></h2>
          <p className="st-sub" style={{ margin: 0 }}>Start from an inspiration image, or import a character you already built.</p>
          <div className="st-row" style={{ justifyContent: 'center' }}>
            <button className="st-btn" onClick={() => setImporting(true)}><FileUp size={16} />Import</button>
            <button className="st-btn primary big" onClick={create}><Plus size={18} />New character</button>
          </div>
        </div>
      )}

      <div className="st-grid cards">
        {chars.map(c => (
          <Link to={`/studio/c/${c.id}`} key={c.id} className="st-casting">
            <Img assetId={c.portraitAssetId} width={520} alt={c.name} />
            <div className="st-casting-body">
              <div className="st-casting-name">{c.name}</div>
              <div className="st-casting-meta">
                <span>{c.stage >= 4 ? `Sheet ${c.progress.approved}/${c.progress.total}` : STAGES[c.stage - 1]}</span>
                <span>{c.spent} spent</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  )
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefresh()
  const [file, setFile] = useState<File | null>(null)
  const [images, setImages] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [done, setDone] = useState<{ characterId: string; importedShots: string[]; checkShots: string[]; warnings: string[] } | null>(null)

  function take(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (f.name.toLowerCase().endsWith('.md')) setFile(f)
      else if (f.type.startsWith('image/')) setImages(prev => [...prev.filter(p => p.name !== f.name), f])
    }
  }
  const mapped = images.map(f => ({ f, ref: f.name.toUpperCase().match(/REF-(\d{2})/)?.[0] ?? null, mirrored: /mirror/i.test(f.name) }))

  async function submit() {
    if (!file) return
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      for (const m of mapped) if (m.ref) form.append('images', m.f)
      const r = await api.importCharacter(form)
      refresh()
      // Show what was read before opening the character.
      setDone(r); setFile(null); setImages([])
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  function close() { setDone(null); onClose() }
  function open_() { if (done) nav(`/studio/c/${done.characterId}`); close() }

  if (done) {
    return (
      <Modal open={open} onClose={close}>
        <div className="st-card-body st-col" style={{ gap: 16 }}>
          <div><div className="st-kicker">Imported</div><div className="st-h2">Here is what the Studio read</div><p className="st-sub">{done.importedShots.length ? `${done.importedShots.length} approved sheet shot${done.importedShots.length === 1 ? '' : 's'}: ${done.importedShots.join(', ')}.` : 'No sheet images yet. Add them any time from the Sheet tab.'}{done.checkShots.length ? ` To check with QA: ${done.checkShots.join(', ')}.` : ''}</p></div>
          {done.warnings.length > 0 && <ul className="st-notes">{done.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="st-row"><span className="st-spacer" /><button className="st-btn primary" onClick={open_}>Open character</button></div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={close}>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        <div><div className="st-kicker">Import</div><div className="st-h2">Bring in a character you already built</div><p className="st-sub">Drop the character file (.md) and any approved sheet images named REF-00 to REF-11.</p></div>
        <label className={`st-drop ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}>
          <Upload size={22} />
          <span>Drop files here, or <u>browse</u></span>
          <input type="file" multiple accept=".md,image/*" hidden onChange={e => e.target.files && take(e.target.files)} />
        </label>
        {file && <div className="st-chip on">{file.name}</div>}
        {mapped.length > 0 && (
          <div className="st-row" style={{ gap: 6 }}>
            {mapped.map(m => <span key={m.f.name} className={`st-badge ${m.mirrored ? 'warn' : m.ref ? 'ok' : 'bad'} plain`} title={m.f.name}>{m.mirrored ? `${m.ref ?? '?'} mirrored, to check` : m.ref ?? 'No REF id'}</span>)}
          </div>
        )}
        <div className="st-row"><span className="st-spacer" /><button className="st-btn ghost" onClick={onClose}>Cancel</button><button className="st-btn primary" disabled={!file || busy} onClick={submit}>{busy ? 'Importing...' : 'Import character'}</button></div>
      </div>
    </Modal>
  )
}
