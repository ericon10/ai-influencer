import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useCharacter } from '../hooks'
import { Img, MarkChip, Meter, STAGES, Stepper } from '../ui'
import { CardEditor } from './character/CardEditor'
import { StartTab } from './character/StartTab'
import { HeroTab } from './character/HeroTab'
import { SheetTab } from './character/SheetTab'
import { FileTab } from './character/FileTab'
import { ScenesTab } from './character/ScenesTab'
import type { CharacterView } from '../types'

type Tab = 'start' | 'hero' | 'sheet' | 'scenes' | 'file'

function defaultTab(stage: number): Tab {
  if (stage <= 2) return 'start'
  if (stage === 3) return 'hero'
  if (stage >= 5) return 'scenes'
  return 'sheet'
}

export default function Character() {
  const { id = '' } = useParams()
  const q = useCharacter(id)
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab | null>(null)
  const [editing, setEditing] = useState(false)
  const v = q.data
  useEffect(() => { if (v && tab === null) setTab(defaultTab(v.stage)) }, [v, tab])
  // A link can open a tab and a scene (a scene copied to this character).
  const wantTab = params.get('tab') as Tab | null
  const wantScene = params.get('scene')
  useEffect(() => { if (wantTab && ['start', 'hero', 'sheet', 'scenes', 'file'].includes(wantTab)) setTab(wantTab) }, [wantTab, id])

  if (q.isLoading) return <div className="st-page wide"><div className="st-skel" style={{ height: 40, width: 260, marginBottom: 24 }} /><div className="st-character"><div className="st-skel" style={{ aspectRatio: '3/4', borderRadius: 26 }} /><div className="st-skel" style={{ height: 320, borderRadius: 26 }} /></div></div>
  if (!v) return <div className="st-page"><div className="st-empty"><h2 className="st-h1">Not found</h2><Link className="st-btn" to="/studio">Back to characters</Link></div></div>

  const current = tab ?? defaultTab(v.stage)
  return (
    <div className="st-page wide">
      <Link to="/studio" className="st-btn ghost sm" style={{ marginBottom: 14 }}><ArrowLeft size={14} />Characters</Link>
      <div className="st-pagehead" style={{ marginBottom: 22 }}>
        <div className="grow">
          <div className="st-kicker">Character · revision {v.revision}</div>
          <h1 className="st-h1">{v.data.name}</h1>
        </div>
        <Stepper steps={STAGES} current={Math.min(5, v.stage)} done={[v.stage > 1, v.stage > 2, !!v.sheet.shots[0]?.approved, v.sheet.progress.complete, false]} />
      </div>

      <div className="st-character">
        <Profile v={v} onEdit={() => setEditing(true)} />
        <div style={{ minWidth: 0 }}>
          <div className="st-seg" role="tablist" style={{ marginBottom: 20 }}>
            {([['start', 'Start'], ['hero', 'Hero'], ['sheet', `Sheet ${v.sheet.progress.approved}/${v.sheet.progress.total}`], ['scenes', 'Scenes'], ['file', 'Character file']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={current === k} className={current === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          {current === 'start' && <StartTab v={v} onEditCard={() => setEditing(true)} goHero={() => setTab('hero')} />}
          {current === 'hero' && <HeroTab v={v} onEditCard={() => setEditing(true)} goSheet={() => setTab('sheet')} />}
          {current === 'sheet' && <SheetTab v={v} goHero={() => setTab('hero')} goFile={() => setTab('file')} />}
          {current === 'scenes' && <ScenesTab key={`${v.id}-${wantScene ?? ''}`} v={v} openScene={wantScene} goSheet={() => setTab('sheet')} />}
          {current === 'file' && <FileTab v={v} />}
        </div>
      </div>
      <CardEditor v={v} open={editing} onClose={() => setEditing(false)} />
    </div>
  )
}

function Profile({ v, onEdit }: { v: CharacterView; onEdit: () => void }) {
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
