import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, FileUp, FolderOpen, Plus, Upload } from 'lucide-react'
import { api } from '../api'
import { useCharacters, useRefresh } from '../hooks'
import { Callout, Field, Img, Modal, STAGES, Todo, errorMessage, useToast } from '../ui'
import { REALISM_LINE } from '../copy'
import { filesFromDrop, sheetRefOf, typeOf } from '../files'
import { HowTo } from '../guide/Guide'
import { TemplateCheckList } from './character/BrandCard'
import type { TemplateReport } from '../types'
import { DeleteCharacter } from './character/DeleteCharacter'

export default function Characters() {
  const list = useCharacters()
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [importing, setImporting] = useState(params.get('import') === '1')
  const [creating, setCreating] = useState(false)

  // A new character asks Person or Faceless first (owner, 2026-10-22).
  const [asking, setAsking] = useState(false)
  async function create(o: { kind?: 'person' | 'faceless'; name?: string; template?: 'doug' | null } = {}) {
    setCreating(true)
    try { const { id } = await api.createCharacter(o.name || (o.kind === 'faceless' ? '' : 'New character'), { kind: o.kind ?? 'person', template: o.template ?? null }); await list.refetch(); nav(`/studio/characters/${id}`) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setCreating(false); setAsking(false) }
  }

  const chars = list.data?.characters ?? []
  return (
    <div className="st-page wide">
      <div className="st-pagehead">
        <div className="grow">
          <div className="st-kicker">Setup</div>
          <div className="st-titlerow"><h1 className="st-h1">Your characters</h1><HowTo id="characters" /></div>
          <p className="st-sub">Set each one up once: inspiration, face, a 12-shot reference sheet and a character file. Posts use them after that.</p>
        </div>
        {/* Import first (long run part 3): most characters are built in the
            Claude project with character template v1.6. */}
        <button className="st-btn primary" onClick={() => setImporting(true)}><FileUp size={16} />Import a character file</button>
        <button className="st-btn" onClick={() => setAsking(true)} disabled={creating} data-field="new-character"><Plus size={16} />New character</button>
      </div>

      {list.isLoading && <div className="st-grid cards">{[0, 1, 2, 3].map(i => <div key={i} className="st-casting"><div className="st-img"><div className="st-skel" style={{ aspectRatio: '3/4' }} /></div><div className="st-casting-body"><div className="st-skel" style={{ height: 22, width: '60%' }} /></div></div>)}</div>}

      {!list.isLoading && chars.length === 0 && (
        <div className="st-empty">
          <h2 className="st-h1">Cast your first <em>character</em></h2>
          <p className="st-sub" style={{ margin: 0 }}>Import the character file you built in the Claude project with its 12 REF images, or start from an inspiration image and three concepts.</p>
          <p className="st-realism">{REALISM_LINE}</p>
          <div className="st-row" style={{ justifyContent: 'center' }}>
            <button className="st-btn primary big" onClick={() => setImporting(true)}><FileUp size={18} />Import a character file</button>
            <button className="st-btn" onClick={() => setAsking(true)}><Plus size={16} />New character</button>
          </div>
        </div>
      )}

      <div className="st-grid cards">
        {chars.map(c => (
          <Link to={`/studio/characters/${c.id}`} key={c.id} className="st-casting">
            <Img assetId={c.portraitAssetId} width={520} alt={c.name} />
            <div className="st-casting-body">
              <div className="st-casting-name">{c.name}</div>
              <div className="st-casting-meta">
                <span>{c.kind === 'faceless' ? <span className="st-badge plain" data-field="faceless-label">Faceless</span> : c.stage >= 4 ? `Sheet ${c.progress.approved}/${c.progress.total}` : STAGES[c.stage - 1]}</span>
                <span>{c.spent} spent</span>
                <span className="st-spacer" />
                <DeleteCharacter id={c.id} name={c.name} compact />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <NewCharacter open={asking} busy={creating} onClose={() => setAsking(false)} onPick={o => void create(o)} />
    </div>
  )
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const refresh = useRefresh()
  const [file, setFile] = useState<File | null>(null)
  const [images, setImages] = useState<File[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [done, setDone] = useState<{ characterId: string; updated: boolean; importedShots: string[]; unchangedShots: string[]; checkShots: string[]; checkJobId: string | null; warnings: string[] } | null>(null)
  // The free template check (v1.6) and the character of the same name.
  const [check, setCheck] = useState<{ report: TemplateReport; name: string; match: { id: string; name: string } | null } | null>(null)
  const [update, setUpdate] = useState(true)
  useEffect(() => {
    let live = true
    setCheck(null)
    if (file) file.text().then(md => api.importCheck(md)).then(r => { if (live) { setCheck(r); setUpdate(true) } }).catch(e => toast({ tone: 'bad', text: errorMessage(e) }))
    return () => { live = false }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps
  const updating = !!check?.match && update
  const needed = check ? check.report.needed.filter(n => !n.ok).length : 0

  function take(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (f.name.toLowerCase().endsWith('.md')) setFile(f)
      else if (typeOf(f).startsWith('image/')) setImages(prev => [...prev.filter(p => p.name !== f.name), f])
    }
  }
  // A whole folder can be dropped ("CALLIE MASTER CHARACTER" with "REF 00"
  // to "REF 11"); names are normalized to REF-00 to REF-11.
  async function drop(dt: DataTransfer) {
    try { take(await filesFromDrop(dt)) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const mapped = images.map(f => ({ f, ref: sheetRefOf(f.name), mirrored: /mirror/i.test(f.name) }))
    .sort((a, b) => (a.ref ?? 'ZZ').localeCompare(b.ref ?? 'ZZ'))
  const missing = Array.from({ length: 12 }, (_, i) => `REF-${String(i).padStart(2, '0')}`).filter(id => images.length && !mapped.some(m => m.ref === id && !m.mirrored))

  async function submit() {
    if (!file) return
    setBusy('Reading the file...')
    try {
      const r = await api.importCharacter(await file.text(), mapped.filter(m => m.ref).map(m => m.f), (n, total) => setBusy(`Uploading images ${n} of ${total}...`), updating ? check!.match!.id : undefined)
      refresh()
      // Show what was read before opening the character.
      setDone(r); setFile(null); setImages([])
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(null) }
  }
  function close() { setDone(null); onClose() }
  function open_() { if (done) nav(`/studio/characters/${done.characterId}?tab=sheet`); close() }

  if (done) {
    return (
      <Modal open={open} onClose={close}>
        <div className="st-col" style={{ gap: 16 }}>
          <div><div className="st-kicker">{done.updated ? 'Updated' : 'Imported'}</div><div className="st-h2">Here is what the Studio read</div><p className="st-sub">{done.updated ? 'The file\'s words replaced the old ones; posts, takes and the sheet stayed, and the combo log was merged. ' : ''}{done.importedShots.length ? `${done.importedShots.length} approved sheet shot${done.importedShots.length === 1 ? '' : 's'}: ${done.importedShots.join(', ')}.` : done.unchangedShots.length ? '' : 'No sheet images yet. Add them any time from the Sheet tab.'}{done.unchangedShots.length ? ` Already in the sheet, unchanged: ${done.unchangedShots.length === 12 ? 'all 12' : done.unchangedShots.join(', ')}.` : ''}{done.checkShots.length ? ` To check with QA: ${done.checkShots.join(', ')}.` : ''}</p></div>
          {done.checkJobId && <Callout tone="info">Checking each image against REF-00: face match and skin texture. It is free and runs in the background; any failures show on the Sheet tab.</Callout>}
          {done.warnings.length > 0 && <ul className="st-notes">{done.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="st-row"><span className="st-spacer" /><button className="st-btn primary" onClick={open_}>Open character</button></div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={close}>
      <div className="st-col" style={{ gap: 16 }}>
        <div><div className="st-kicker">Import</div><div className="st-titlerow"><div className="st-h2">Import a character file</div><HowTo id="characters" /></div><p className="st-sub">The character file (.md) from the Claude project, made with character template v1.6, and its sheet folder. Images named REF 00 to REF 11 (or REF-00) become the approved sheet. The file is checked against the template for free before anything is imported.</p></div>
        <Field id="import-file" label="Character file (.md)" required done={!!file} group hint="The sheet images are optional; add them now or later.">
        <label className={`st-drop ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void drop(e.dataTransfer) }}>
          <Upload size={22} />
          <span>Drop the file and the folder here, or <u>browse</u></span>
          <input type="file" multiple accept=".md,image/*" hidden onChange={e => e.target.files && take(e.target.files)} />
        </label>
        </Field>
        <label className="st-btn sm ghost" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
          <FolderOpen size={14} />Choose a folder
          <input type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={e => e.target.files && take(e.target.files)} />
        </label>
        {file && <div className="st-chip on">{file.name}</div>}
        {mapped.length > 0 && (
          <div className="st-row" style={{ gap: 6 }}>
            {mapped.map(m => <span key={m.f.name} className={`st-badge ${m.mirrored ? 'warn' : m.ref ? 'ok' : 'bad'} plain`} title={m.f.name}>{m.mirrored ? `${m.ref ?? '?'} mirrored, to check` : m.ref ?? `Skipped: ${m.f.name}`}</span>)}
          </div>
        )}
        {missing.length > 0 && <span className="st-hint">Not in this folder: {missing.join(', ')}. You can add them later from the Sheet tab.</span>}
        {file && !check && <span className="st-hint">Checking the file against the template...</span>}
        {check && <TemplateCheckList report={check.report} />}
        {check?.match && (
          <div className="st-col" style={{ gap: 6 }} role="radiogroup" aria-label="Update or new" data-field="import-update">
            <button type="button" role="radio" aria-checked={update} className={`st-choice ${update ? 'on' : ''}`} onClick={() => setUpdate(true)}>
              <b>Update {check.match.name}</b><span className="st-hint">Keeps {check.match.name}'s posts, takes, stills and sheet; the combo log is merged.</span>
            </button>
            <button type="button" role="radio" aria-checked={!update} className={`st-choice ${!update ? 'on' : ''}`} onClick={() => setUpdate(false)}>
              <b>Import as a new character</b><span className="st-hint">A second {check.name}, with nothing from the first.</span>
            </button>
          </div>
        )}
        {!file && <Todo items={[{ label: 'Add the character file (.md)', target: 'import-file' }]} />}
        <div className="st-row"><span className="st-spacer" />{busy && <span className="st-hint">{busy}</span>}<button className="st-btn ghost" onClick={onClose}>Cancel</button><button className="st-btn primary" disabled={!file || !!busy} onClick={submit} title={needed ? 'The template check found items to add; the import still works.' : undefined}>{busy ? 'Importing...' : updating ? `Update ${check!.match!.name}${needed ? ' anyway' : ''}` : needed ? 'Import anyway' : 'Import character'}</button></div>
      </div>
    </Modal>
  )
}

// Person or Faceless, first (owner, 2026-10-22; UX-PLAN.md section 35, item
// 4a). A person goes through inspiration, face, sheet and file; a faceless
// account has no face at all: its file (persona, place bank, look rules,
// voice, sound bank) is all it needs. Doug is the first one, ready to copy.
function NewCharacter({ open, busy, onClose, onPick }: { open: boolean; busy: boolean; onClose: () => void; onPick: (o: { kind: 'person' | 'faceless'; name?: string; template?: 'doug' | null }) => void }) {
  // Nothing is picked to start; the button waits for a pick (owner, 2026-10-22).
  const [kind, setKind] = useState<'person' | 'faceless' | null>(null)
  const [name, setName] = useState('')
  const [doug, setDoug] = useState(true)
  useEffect(() => { if (!open) setKind(null) }, [open])
  const kinds = [
    { id: 'person' as const, title: 'Person', text: 'A face that stays the same in every post: inspiration, face, a 12-shot reference sheet and the character file.' },
    { id: 'faceless' as const, title: 'Faceless', text: 'No face, no hero, no sheet: a persona, a bank of places, look rules, a voice and a sound bank. Stills of real places, never a person.' },
  ]
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  // A radio group: the arrow keys move the pick and the focus; Tab reaches
  // the picked card (or the first when none is picked).
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + kinds.length) % kinds.length
    setKind(kinds[next]!.id)
    refs.current[next]?.focus()
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div className="st-col" style={{ gap: 14 }} data-field="new-character-kind">
        <div><div className="st-kicker">New character</div><div className="st-h2">A person or faceless?</div></div>
        <div className="st-col" style={{ gap: 8 }} role="radiogroup" aria-label="Person or Faceless">
          {kinds.map((k, i) => (
            <button key={k.id} ref={el => { refs.current[i] = el }} type="button" role="radio" aria-checked={kind === k.id} tabIndex={kind ? (kind === k.id ? 0 : -1) : i === 0 ? 0 : -1}
              className={`st-choice ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)} onKeyDown={e => onKey(e, i)}>
              <span className="st-choice-head"><b>{k.title}</b>{kind === k.id && <CheckCircle2 size={18} className="st-choice-check" aria-hidden data-field="choice-check" />}</span>
              <span className="st-hint">{k.text}</span>
            </button>
          ))}
        </div>
        {kind === 'faceless' && (
          <div className="st-col" style={{ gap: 8 }}>
            <label className="st-col" style={{ gap: 4 }}><span className="st-label">Name (never shown on screen)</span><input className="st-input" value={name} onChange={e => setName(e.target.value)} placeholder={doug ? 'Doug' : 'Faceless account'} /></label>
            <label className="st-row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" style={{ flex: 'none', marginTop: 3 }} checked={doug} onChange={e => setDoug(e.target.checked)} /><span>Start from Doug's file (31, Peoria IL, laid-off contract data entry, rainy Midwest everyday life)</span></label>
          </div>
        )}
        <div className="st-modal-actions">
          <button type="button" className="st-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="st-btn primary" data-field="new-character-go" disabled={!kind || busy} onClick={() => kind && onPick({ kind, name: name.trim(), template: kind === 'faceless' && doug ? 'doug' : null })}>{kind === 'faceless' ? 'Set up the persona' : kind === 'person' ? 'Start from a concept' : 'Pick one first'}</button>
        </div>
      </div>
    </Modal>
  )
}
