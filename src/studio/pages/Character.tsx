import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, FileUp, Film, Mic, Pencil } from 'lucide-react'
import { useCharacter } from '../hooks'
import { Img, MarkChip, Meter } from '../ui'
import { CardEditor } from './character/CardEditor'
import { VoiceEditor, voiceSummary } from './character/VoiceEditor'
import { StartTab } from './character/StartTab'
import { HeroTab } from './character/HeroTab'
import { SheetTab } from './character/SheetTab'
import { FileTab } from './character/FileTab'
import { DeleteCharacter } from './character/DeleteCharacter'
import { FacelessCharacter } from './character/FacelessFile'
import { useNewPost } from './post/parts'
import type { CharacterView } from '../types'
import { HowTo } from '../guide/Guide'
import type { GuideId } from '../guide/content'

// Character setup (UX-PLAN.md), once per character, as a stepper:
// inspiration, face, reference sheet, character file. Making stills and
// clips happens in posts.

type Tab = 'start' | 'hero' | 'sheet' | 'file'
const TABS: Tab[] = ['start', 'hero', 'sheet', 'file']
const TAB_GUIDE: Record<Tab, GuideId> = { start: 'setup-start', hero: 'setup-face', sheet: 'setup-sheet', file: 'setup-file' }

function defaultTab(v: CharacterView): Tab {
  if (v.stage <= 2) return 'start'
  if (v.stage === 3) return 'hero'
  return v.sheet.progress.complete ? 'file' : 'sheet'
}

export default function Character() {
  const { id = '' } = useParams()
  const q = useCharacter(id)
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab | null>(null)
  const [editing, setEditing] = useState(false)
  // The Voice modal (a link can open it: ?voice=1, from Library > Voice lines).
  const [voicing, setVoicing] = useState(params.get('voice') === '1')
  const newPost = useNewPost()
  const v = q.data
  useEffect(() => { if (v && tab === null) setTab(defaultTab(v)) }, [v, tab])
  // A link can open a step (an import opens the sheet).
  const wantTab = params.get('tab') as Tab | null
  useEffect(() => { if (wantTab && TABS.includes(wantTab)) setTab(wantTab) }, [wantTab, id])

  if (q.isLoading) return <div className="st-page wide"><div className="st-skel" style={{ height: 40, width: 260, marginBottom: 24 }} /><div className="st-character"><div className="st-skel" style={{ aspectRatio: '3/4', borderRadius: 26 }} /><div className="st-skel" style={{ height: 320, borderRadius: 26 }} /></div></div>
  if (!v) return <div className="st-page"><div className="st-empty"><h2 className="st-h1">Not found</h2><Link className="st-btn" to="/studio/characters">Back to characters</Link></div></div>

  // A faceless character has no face steps: its page is its file.
  if (v.kind === 'faceless' && v.faceless) return <FacelessCharacter key={v.id} v={v} />
  const current = tab ?? defaultTab(v)
  const ready = !!v.sheet.shots[0]?.approved
  const done: Record<Tab, boolean> = { start: v.stage > 2, hero: ready, sheet: v.sheet.progress.complete, file: false }
  const label: Record<Tab, string> = { start: 'Inspiration', hero: 'Face', sheet: `Reference sheet ${v.sheet.progress.approved}/${v.sheet.progress.total}`, file: 'Character file' }
  return (
    <div className="st-page wide">
      <Link to="/studio/characters" className="st-btn ghost sm" style={{ marginBottom: 14 }}><ArrowLeft size={14} />Characters</Link>
      <div className="st-pagehead" style={{ marginBottom: 18 }}>
        <div className="grow">
          <div className="st-kicker">Set up · revision {v.revision}</div>
          <div className="st-titlerow"><h1 className="st-h1">{v.data.name}</h1><HowTo key={current} id={TAB_GUIDE[current]} /></div>
        </div>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <DeleteCharacter id={v.id} name={v.data.name} />
          {/* A half-built character finished by its file (UX-PLAN.md section 37, item 20): the import updates the character of the same name and skips the setup steps. */}
          {!v.sheet.progress.complete && <Link className="st-btn" to={`/studio/characters?import=1&for=${encodeURIComponent(v.data.name)}`} data-field="finish-with-file"><FileUp size={15} />Import a character file</Link>}
          {ready && <button className="st-btn primary" disabled={!!newPost.busy} onClick={() => void newPost.create('meme', { characterId: v.id })}><Film size={16} />Make a post with {v.data.name}</button>}
        </div>
      </div>
      <nav className="st-steps st-poststeps" aria-label="Setup steps" style={{ marginBottom: 22 }}>
        {TABS.map((k, i) => {
          const state = k === current ? 'current' : done[k] ? 'done' : ''
          return (
            <button key={k} type="button" className={`st-step ${state}`} aria-current={state === 'current' ? 'step' : undefined} onClick={() => setTab(k)}>
              <span className="dot">{state === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}</span>{label[k]}
            </button>
          )
        })}
      </nav>

      <div className="st-character">
        <Profile v={v} onEdit={() => setEditing(true)} onVoice={() => setVoicing(true)} />
        <div style={{ minWidth: 0 }}>
          {current === 'start' && <StartTab v={v} onEditCard={() => setEditing(true)} goHero={() => setTab('hero')} />}
          {current === 'hero' && <HeroTab v={v} onEditCard={() => setEditing(true)} goSheet={() => setTab('sheet')} />}
          {current === 'sheet' && <SheetTab v={v} goHero={() => setTab('hero')} goFile={() => setTab('file')} />}
          {current === 'file' && <FileTab v={v} />}
        </div>
      </div>
      <CardEditor v={v} open={editing} onClose={() => setEditing(false)} />
      <VoiceEditor v={v} open={voicing} onClose={() => setVoicing(false)} />
    </div>
  )
}

function Profile({ v, onEdit, onVoice }: { v: CharacterView; onEdit: () => void; onVoice: () => void }) {
  const portrait = v.ref00?.assetId ?? null
  return (
    <aside className="st-profile">
      <div className="st-portrait">
        <Img assetId={portrait} width={720} alt={v.data.name} />
        {portrait && <span className="st-badge ok st-portrait-tag">REF-00</span>}
      </div>
      <div className="st-col" style={{ gap: 12 }}>
        <div className="st-row">
          <span className="st-muted">{v.data.age ? `${v.data.age}` : 'Age not set'}{v.data.eyes ? ` · ${v.data.eyes} eyes` : ''}</span>
          <span className="st-spacer" />
          <button className="st-btn sm ghost" onClick={onVoice} title={voiceSummary(v)}><Mic size={13} />Voice</button>
          <button className="st-btn sm ghost" onClick={onEdit}><Pencil size={13} />Edit card</button>
        </div>
        <p className="st-cardtext" style={{ margin: 0 }}>{v.data.card || <span className="st-muted">No card yet. Run concepts or write one yourself.</span>}</p>
        {v.data.marks.length > 0 && <div className="st-marks">{v.data.marks.map(m => <MarkChip key={m.name + m.side} mark={m} />)}</div>}
        <div className="st-card pad" style={{ padding: 14, boxShadow: 'none' }}>
          <Meter value={v.costs.spentMicros + v.costs.heldMicros} max={v.costs.capMicros} label="Spent on this character" sub={<><b>{v.costs.spent}</b> / {v.costs.cap}</>} />
          <div className="st-row" style={{ marginTop: 10, fontSize: 12.5 }}>
            <span className="st-muted">Cost per approved asset</span><span className="st-spacer" /><b>{v.costs.costPerApproved ?? 'n/a'}</b>
          </div>
        </div>
        <span className="st-hint">{v.data.disclosure}</span>
      </div>
    </aside>
  )
}
