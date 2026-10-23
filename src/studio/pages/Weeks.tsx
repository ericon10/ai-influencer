import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Check, CheckCircle2, Download, FileSpreadsheet, FileText, Lock, LockOpen, RefreshCw, Send, Shuffle, Upload, X } from 'lucide-react'
import { api, assetUrl } from '../api'
import { keys, useCharacters } from '../hooks'
import { PriceButton } from '../PriceButton'
import { AsyncButton, Drawer, Todo, errorMessage, useToast, type TodoItem } from '../ui'
import { HowTo } from '../guide/Guide'
import { SelectAllBox, SelectBox, SelectionCount, useSelection } from '../select'
import { NotesBadge } from '../lint'
import { StillPaths } from './post/slideshow/StillPaths'
import { PlanCard } from './PlanCard'
import { LinkedSheets, SheetPicker } from './weeks/Sheets'
import { takeWeekFile, type Incoming } from '../importDoor'
import { lineLint, templateCsv, weekOf } from '../../../server/core/weeks'
import SPEC from '../../../docs/PLAN-CSV-SPEC.md?raw'
import type { DrawRow, StillPathId, WeekCell, WeekImportResult, WeekPreview, WeekStep, WeekView } from '../types'

// Weeks (owner, 2026-10-22; UX-PLAN.md section 37): one week of posts on
// one page. Accounts down, days across, each account's slots in its cells;
// a step bar on top (Import > Fill > Check > Make > Review > Send to
// Drive) with the current step lit and its one main button. A cell opens
// its post in the normal workspace.

const STEPS: Array<{ id: WeekStep; label: string }> = [
  { id: 'import', label: 'Import' }, { id: 'fill', label: 'Fill' }, { id: 'check', label: 'Check' },
  { id: 'make', label: 'Make' }, { id: 'review', label: 'Review' }, { id: 'drive', label: 'Send to Drive' },
]
const TYPE: Record<string, string> = { slideshow: 'Slides', clip: 'Clip', photo: 'Photo', faceless: 'Faceless' }
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function Weeks() {
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['weeks'], queryFn: () => api.weeks(), staleTime: 10_000 })
  const thisWeek = weekOf(today())
  const monday = params.get('week') || list.data?.weeks.find(w => w.monday >= thisWeek)?.monday || list.data?.weeks[0]?.monday || thisWeek
  const view = useQuery({ queryKey: ['week', monday], queryFn: () => api.week(monday), refetchInterval: q => ((q.state.data?.counts.making ?? 0) > 0 ? 4000 : false) })
  const [open, setOpen] = useState<WeekStep | null>(params.get('step') as WeekStep | null)
  const [spec, setSpec] = useState(false)
  const v = view.data
  const step = open ?? v?.step ?? 'import'
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['week'] }); void qc.invalidateQueries({ queryKey: ['weeks'] }); void qc.invalidateQueries({ queryKey: keys.content }) }
  const choices = useMemo(() => {
    const set = new Map((list.data?.weeks ?? []).map(w => [w.monday, w.posts]))
    for (const m of [thisWeek, addDays(thisWeek, 7)]) if (!set.has(m)) set.set(m, 0)
    if (!set.has(monday)) set.set(monday, 0)
    return [...set.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [list.data, thisWeek, monday])
  const pick = (m: string) => { const p = new URLSearchParams(params); p.set('week', m); p.delete('step'); setParams(p, { replace: true }); setOpen(null) }

  return (
    <div className="st-page wide" data-field="weeks">
      <div className="st-pagehead" style={{ marginBottom: 14 }}>
        <div className="grow">
          <div className="st-kicker">Plan a week, make it, send it</div>
          <div className="st-titlerow"><h1 className="st-h1">Weeks</h1><HowTo id="weeks" /></div>
        </div>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="st-select" style={{ width: 'auto' }} value={monday} onChange={e => pick(e.target.value)} aria-label="Week">
            {choices.map(([m, n]) => <option key={m} value={m}>Week of {dayLabel(m)}{m === thisWeek ? ' (this week)' : ''}{n ? ` · ${n} posts` : ''}</option>)}
          </select>
          <button type="button" className="st-btn sm secondary" onClick={() => download('plan-template.csv', templateCsv())} data-field="weeks-template"><Download size={13} />Download template</button>
          <button type="button" className="st-btn sm secondary" onClick={() => setSpec(true)} data-field="weeks-spec"><FileText size={13} />Read the spec</button>
        </div>
      </div>

      <StepBar v={v} step={step} onOpen={s => setOpen(s)} />
      <section className="st-card" style={{ marginBottom: 16 }} data-field={`weeks-panel-${step}`}>
        <div className="st-card-body st-col" style={{ gap: 12 }}>
          {step === 'import' && <ImportStep monday={monday} onImported={(r) => { refresh(); if (r.weeks[0] && r.weeks[0] !== monday) pick(r.weeks[0]) }} onNext={() => setOpen('fill')} />}
          {step === 'fill' && v && <FillStep v={v} onChanged={refresh} onNext={() => setOpen('check')} />}
          {step === 'check' && v && <CheckStep v={v} onChanged={refresh} onNext={() => setOpen('make')} />}
          {step === 'make' && v && <MakeStep v={v} onChanged={refresh} onNext={() => setOpen('review')} />}
          {step === 'review' && v && <ReviewStep v={v} onChanged={refresh} onNext={() => setOpen('drive')} />}
          {step === 'drive' && v && <DriveStep v={v} onChanged={refresh} />}
          {!v && step !== 'import' && <span className="st-hint">Reading the week...</span>}
        </div>
      </section>

      {v && <WeekGrid v={v} />}
      <Drawer open={spec} onClose={() => setSpec(false)} title="The plan CSV spec" wide>
        <div className="st-row" style={{ gap: 8, marginBottom: 10 }}>
          <button type="button" className="st-btn sm secondary" onClick={() => download('PLAN-CSV-SPEC.md', SPEC, 'text/markdown')}><Download size={13} />Download the spec</button>
          <button type="button" className="st-btn sm secondary" onClick={() => download('plan-template.csv', templateCsv())}><Download size={13} />Download template</button>
        </div>
        <SpecDoc text={SPEC} />
      </Drawer>
    </div>
  )
}

// ── The step bar ──────────────────────────────────────────────────────

function StepBar({ v, step, onOpen }: { v: WeekView | undefined; step: WeekStep; onOpen: (s: WeekStep) => void }) {
  const c = v?.counts
  const note: Record<WeekStep, string> = {
    import: c?.posts ? `${c.posts} posts` : 'No posts yet',
    fill: c ? (c.noLine ? `${c.noLine} without a line` : 'Every post has a line') : '',
    check: c ? (c.unchecked ? `${c.unchecked} not checked` : c.flagged ? `${c.flagged} flagged` : 'All clear') : '',
    make: c ? (c.making ? `${c.making} making` : c.toMake ? `${c.toMake} to make` : 'Nothing to make') : '',
    review: c ? `${c.approved} of ${c.posts - c.killed} approved` : '',
    drive: c ? (c.toSend ? `${c.toSend} to send` : `${c.sent} in Drive`) : '',
  }
  const at = STEPS.findIndex(s => s.id === v?.step)
  return (
    <nav className="st-weekbar" aria-label="Week steps" data-field="weeks-steps">
      {STEPS.map((s, i) => (
        <button key={s.id} type="button" className={`st-step ${v?.step === s.id ? 'current' : i < at ? 'done' : ''} ${step === s.id ? 'open' : ''}`} aria-current={v?.step === s.id ? 'step' : undefined} onClick={() => onOpen(s.id)} data-field={`weeks-step-${s.id}`}>
          <span className="st-row" style={{ gap: 6 }}><span className="dot">{i < at ? <Check size={11} /> : i + 1}</span>{s.label}</span>
          <span className="st-hint">{note[s.id]}</span>
        </button>
      ))}
    </nav>
  )
}

// ── The grid ──────────────────────────────────────────────────────────

function slotState(c: WeekCell): string {
  if (c.review === 'killed') return 'killed'
  if (c.approved) return `approved${c.sentAt ? ' sent' : ''}`
  if (c.making) return 'making'
  if (c.made) return 'made'
  if (c.flags.length || c.fillFlag) return 'flagged'
  if (!c.line.trim()) return 'empty'
  return ''
}
function stateWord(c: WeekCell): string {
  if (c.review === 'killed') return 'Killed'
  if (c.sentAt) return 'In Drive'
  if (c.approved) return 'Approved'
  if (c.making) return 'Making'
  if (c.made) return 'Made'
  if (c.flags.length) return c.flags[0]!
  if (c.fillFlag) return c.fillFlag
  if (!c.line.trim()) return 'No line'
  return c.checked ? 'Ready to make' : 'Not checked'
}

function WeekGrid({ v }: { v: WeekView }) {
  return (
    <section className="st-card" data-field="weeks-grid">
      <div className="st-card-head st-row" style={{ gap: 10 }}>
        <CalendarRange size={16} />
        <div className="grow"><div className="st-h3">The week by account and day</div><div className="st-hint">Click a post to open it in its workspace. {v.cells.length} posts.</div></div>
        <div className="st-weeklegend"><span className="flagged">Flagged</span><span className="made">Made</span><span className="approved">Approved</span></div>
      </div>
      <div className="st-card-body st-tablewrap">
        <table className="st-weekgrid">
          <thead><tr><th className="acct">Account</th>{v.days.map(d => <th key={d}>{dayLabel(d)}</th>)}</tr></thead>
          <tbody>
            {v.accounts.map(a => (
              <tr key={a.tag} data-field={`weeks-row-${a.tag}`}>
                <th className="acct" scope="row">
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{a.tag}</div>
                  <div className="st-hint" style={{ fontSize: 11 }}>{a.characterName || 'No character'}{a.kind === 'faceless' ? ' · faceless' : ''} · {a.slotsPerDay}/day · life {a.lifeShare}%{a.deviceId ? ` · ${a.deviceId}` : ''}</div>
                </th>
                {v.days.map(d => {
                  const mine = v.cells.filter(c => c.account.toLowerCase() === a.tag.toLowerCase() && c.date === d)
                  const slots = Math.max(a.slotsPerDay, ...mine.map(c => c.slot))
                  return (
                    <td key={d}>
                      <div className="st-weekcell">
                        {Array.from({ length: slots }, (_, i) => i + 1).map(n => {
                          const here = mine.filter(c => c.slot === n)
                          if (!here.length) return <span key={n} className="st-weekslot none" title={`Slot ${n}: no post`}><span className="top">{n}</span></span>
                          return here.map(c => (
                            <Link key={c.postId} to={`/studio/posts/${c.postId}`} className={`st-weekslot ${slotState(c)}`} title={`${c.rowId} · ${TYPE[c.postType]} · ${stateWord(c)}${c.storyBeat ? `\n${c.storyBeat}` : ''}`} data-field={`weeks-cell-${c.rowId}`}>
                              <span className="top">{n} · {TYPE[c.postType]}{c.lifeOrJob ? ` · ${c.lifeOrJob}` : ''}{c.locked ? <Lock size={10} /> : null}</span>
                              <span className={`words ${c.line ? '' : 'empty'}`}>{c.line || 'no line'}</span>
                              <span className="st-hint" style={{ fontSize: 10.5 }}>{c.rowId} · {stateWord(c)}</span>
                            </Link>
                          ))
                        })}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
            {!v.accounts.length && <tr><td colSpan={8}><span className="st-hint">No accounts yet. Import the week's plan CSV, or add accounts on the <Link to="/studio/accounts">Accounts</Link> page.</span></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Import ────────────────────────────────────────────────────────────

function ImportStep({ monday, onImported, onNext }: { monday: string; onImported: (r: WeekImportResult) => void; onNext: () => void }) {
  const toast = useToast()
  const characters = useCharacters().data?.characters ?? []
  const file = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [paste, setPaste] = useState(false)
  const [older, setOlder] = useState(false)
  const [olderFile, setOlderFile] = useState<Incoming | null>(null)
  const [preview, setPreview] = useState<WeekPreview | null>(null)
  // From Google Sheets (section 39): the sheet the rows came from.
  const [sheet, setSheet] = useState<{ id: string; name: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [existing, setExisting] = useState<'replace' | 'add' | null>(null)
  const [done, setDone] = useState<WeekImportResult | null>(null)
  const good = (preview?.rows ?? []).filter(r => r.state !== 'problem')
  const sel = useSelection(useMemo(() => good.map(r => r.rowId), [good.map(r => r.rowId).join('|')])) // eslint-disable-line react-hooks/exhaustive-deps
  // A file sent by Import on Posts home lands here with its preview.
  useEffect(() => {
    const f = takeWeekFile()
    if (!f) return
    if (f.kind === 'plan' || f.kind === 'faceless') { setOlderFile(f); setOlder(true); return }
    setCsv(f.text); setName(f.name); void check(f.text)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function check(text = csv) {
    try { const p = await api.weekPreview(text); setPreview(p); setDone(null); setExisting(null); sel.set(p.rows.filter(r => r.state !== 'problem').map(r => r.rowId)) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function load(f: File | undefined) {
    if (!f) return
    if (f.size > 400_000) { toast({ tone: 'bad', text: `${f.name} is over 400 KB. Split it.` }); return }
    const text = await f.text()
    setCsv(text); setName(f.name); setPaste(false); setDone(null); setSheet(null)
    await check(text)
  }
  const ticked = good.filter(r => sel.has(r.rowId))
  const matching = ticked.filter(r => r.state !== 'new')
  const todo: TodoItem[] = [
    ...(!ticked.length ? [{ label: 'Tick the rows to import', target: 'weeks-rows' }] : []),
    ...(matching.length && !existing ? [{ label: `Pick Replace them or Add as new posts for the ${matching.length} matching row${matching.length === 1 ? '' : 's'}`, target: 'weeks-existing' }] : []),
  ]
  if (older) return (
    <div className="st-col" style={{ gap: 10 }}>
      <div className="st-row" style={{ gap: 8 }}><b className="grow">The launch plan (the older file with format and hook columns)</b><button type="button" className="st-btn sm ghost" onClick={() => setOlder(false)}>Back to the plan CSV</button></div>
      <PlanCard characters={characters} incoming={olderFile} />
    </div>
  )
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="weeks-import">
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="st-h3 grow">Import the week's plan CSV</span>
        <HowTo id="weeks" label="How the plan CSV works" />
      </div>
      <span className="st-hint">The file Claude writes in chat, to docs/PLAN-CSV-SPEC.md: row_id, account, date and slot on every row, the rest optional. Rows land as drafts on the grid below. Free: nothing paid runs here.</span>
      <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void load(f) }} data-field="weeks-file" />
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={`st-btn ${csv ? 'secondary sm' : ''}`} onClick={() => file.current?.click()}><Upload size={14} />Upload the plan CSV</button>
        {csv && !paste && <span className="st-hint" data-field="weeks-file-name">{sheet ? 'Google Sheet: ' : ''}{name ? `${name} · ` : ''}{csv.split('\n').filter(l => l.trim()).length - 1} rows</span>}
        <button type="button" className={`st-btn ${csv ? 'secondary sm' : 'secondary'}`} onClick={() => setPicking(p => !p)} aria-expanded={picking} data-field="weeks-from-sheets"><FileSpreadsheet size={14} />From Google Sheets</button>
        <button type="button" className="st-btn xs ghost" onClick={() => setPaste(p => !p)}>{paste ? 'Hide the rows' : csv ? 'See or edit the rows' : 'Paste the rows instead'}</button>
        <button type="button" className="st-btn xs ghost" onClick={() => setOlder(true)}>An older launch plan file?</button>
      </div>
      {picking && <SheetPicker onClose={() => setPicking(false)} onRead={p => {
        setCsv(p.csv); setName(p.sheet.name); setSheet({ id: p.sheet.id, name: p.sheet.name }); setPaste(false); setPicking(false); setDone(null); setExisting(null)
        setPreview(p.preview); sel.set(p.preview.rows.filter(r => r.state !== 'problem').map(r => r.rowId))
      }} />}
      {!preview && !picking && <LinkedSheets onSynced={r => { setDone(r); onImported(r) }} />}
      {paste && <textarea className="st-textarea" rows={5} value={csv} onChange={e => { setCsv(e.target.value); setName(''); setSheet(null); setPreview(null) }} placeholder="Paste the plan (with its header line)" aria-label="Plan rows" />}
      {paste && <AsyncButton className="st-btn sm" disabled={!csv.trim()} busyLabel="Reading..." onClick={() => check()}>Preview (free)</AsyncButton>}
      {preview && (
        <div className="st-col" style={{ gap: 10 }} data-field="weeks-preview">
          {preview.problems.map(p => <span key={p} className="st-hint st-warntext">{p}</span>)}
          <span className="st-hint" role="status"><b>{preview.totals.ok} of {preview.totals.rows} rows</b> can import{preview.totals.problem ? `, ${preview.totals.problem} cannot (below)` : ''}; {preview.totals.withLine} have a line already. {preview.weeks.length ? `Week${preview.weeks.length === 1 ? '' : 's'} of ${preview.weeks.map(dayLabel).join(', ')}.` : ''}{preview.newAccounts.length ? ` New accounts (added to Accounts): ${preview.newAccounts.map(a => `${a.tag}${a.characterName ? ` (${a.characterName})` : ''}`).join(', ')}.` : ''}</span>
          <div className="st-row" style={{ gap: 8 }} data-field="weeks-rows"><SelectionCount sel={sel} /></div>
          <div className="st-tablewrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="st-table">
              <thead><tr><th><SelectAllBox sel={sel} label="Tick every row" disabled={!good.length} /></th><th>Row</th><th>Day</th><th>Slot</th><th>Account</th><th>Type</th><th>Line</th><th>Notes</th></tr></thead>
              <tbody>
                {preview.rows.map(r => (
                  <tr key={r.line} className={r.state === 'problem' ? 'st-warnrow' : undefined} data-field={`weeks-prow-${r.rowId}`}>
                    <td>{r.state !== 'problem' && <SelectBox sel={sel} id={r.rowId} label={`Import ${r.rowId}`} />}</td>
                    <td>{r.rowId}</td><td style={{ whiteSpace: 'nowrap' }}>{r.date ? dayLabel(r.date) : ''}</td><td>{r.slot ?? ''}</td><td>{r.account}</td><td>{r.postType ? TYPE[r.postType] : ''}</td>
                    <td style={{ maxWidth: 320 }}><span className="st-clamp1" title={r.text}>{r.text || <span className="st-muted">Fill draws one</span>}</span></td>
                    <td>{r.errors.length ? <span className="st-warntext">{r.errors.join('; ')}</span> : r.state === 'update' ? <span className="st-hint">Matches a draft</span> : r.state === 'kept' ? <span className="st-hint">Matches a post with pictures</span> : null}<NotesBadge notes={[...r.warnings, ...r.lint]} field={`weeks-notes-${r.rowId}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matching.length > 0 && (
            <div className="st-col st-callout" style={{ gap: 8 }} data-field="weeks-existing" role="group" aria-label="Rows that match posts you already have">
              <b>{matching.length} row{matching.length === 1 ? ' matches posts' : 's match posts'} you already have.</b>
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className={`st-btn sm ${existing === 'replace' ? '' : 'secondary'}`} aria-pressed={existing === 'replace'} onClick={() => setExisting('replace')}>Replace them (their pictures go to Trash)</button>
                <button type="button" className={`st-btn sm ${existing === 'add' ? '' : 'secondary'}`} aria-pressed={existing === 'add'} onClick={() => setExisting('add')}>Add as new posts</button>
              </div>
            </div>
          )}
          <div className="st-col" style={{ gap: 6, alignItems: 'flex-start' }}>
            <AsyncButton className="st-btn" disabled={todo.length > 0} title={todo.map(t => t.label).join('; ') || undefined} busyLabel={`Importing ${ticked.length} rows...`} onClick={async () => {
              try {
                const o = { rows: ticked.map(x => x.rowId), ...(matching.length && existing ? { existing } : {}) }
                const r = sheet ? await api.sheetImport(sheet.id, o) : await api.weekImport(csv, o)
                setDone(r); setPreview(null); onImported(r)
                toast({ tone: 'ok', text: `${r.created + r.replaced} drafts made.` })
              } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
            }}>Import {ticked.length || ''} row{ticked.length === 1 ? '' : 's'} (free)</AsyncButton>
            <Todo items={todo} />
          </div>
        </div>
      )}
      {done && (
        <div className="st-row st-callout ok" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }} role="status" data-field="weeks-import-done">
          <CheckCircle2 size={16} />
          <span className="grow">{done.created + done.replaced} drafts made{done.replaced ? ` (${done.replaced} replaced)` : ''}{done.skipped ? `, ${done.skipped} skipped` : ''}{done.pulls ? `; ${done.pulls} place still${done.pulls === 1 ? '' : 's'} being pulled (free)` : ''}. Next: {done.noLine ? `Fill ${done.noLine} empty slot${done.noLine === 1 ? '' : 's'}, free.` : 'Check the week, free.'}</span>
          <button type="button" className="st-btn sm" onClick={onNext}>{done.noLine ? 'Fill empty slots' : 'Check the week'}</button>
        </div>
      )}
      {!preview && !done && <span className="st-hint">Week shown below: {dayLabel(monday)}.</span>}
    </div>
  )
}

// ── Fill ──────────────────────────────────────────────────────────────

function FillStep({ v, onChanged, onNext }: { v: WeekView; onChanged: () => void; onNext: () => void }) {
  const toast = useToast()
  const [draw, setDraw] = useState<DrawRow[] | null>(null)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [busy, setBusy] = useState(false)
  const draft = () => Object.fromEntries((draw ?? []).filter(r => r.from === 'draft').map(r => [r.postId, r.lineId]))
  async function run(redraw: 'empty' | 'all' | string[]) {
    setBusy(true)
    try {
      const next = Math.floor(Math.random() * 1e9)
      setSeed(next)
      const r = await api.weekDraw(v.monday, { seed: next, redraw, draft: redraw === 'all' || redraw === 'empty' ? {} : draft() })
      setDraw(r.rows)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  async function lock(r: DrawRow) {
    try { await api.weekLock(r.postId, !r.locked); setDraw(d => d?.map(x => (x.postId === r.postId ? { ...x, locked: !r.locked } : x)) ?? null); onChanged() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const drawn = (draw ?? []).filter(r => r.from === 'draft')
  const fits = v.cells.filter(c => c.fit)
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="weeks-fill">
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}><span className="st-h3 grow">Fill empty slots from the line bank</span><HowTo id="weeks" label="How Fill works" /></div>
      <span className="st-hint">Free and random per slot, with the rules: no pain twice in an account's last 7 posts; a line on one account only, ever; emotion and format rotate (never 3 alike in a row); the voice fits; each account's life/job blend, and never a job line in a life slot (a life slot with no life line left stays empty and is flagged). The draw shows first; nothing is saved until Save the draw.</span>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <AsyncButton className="st-btn" disabled={busy} busyLabel="Drawing..." onClick={() => run('empty')}><Shuffle size={14} />Fill empty slots (free)</AsyncButton>
        {draw && <AsyncButton className="st-btn sm secondary" disabled={busy} busyLabel="Drawing..." onClick={() => run('all')}><RefreshCw size={13} />Redraw all</AsyncButton>}
      </div>
      {draw && (
        <div className="st-col" style={{ gap: 8 }} data-field="weeks-draw">
          <span className="st-hint" role="status"><b>{drawn.length} drawn</b>, {draw.filter(r => r.kept).length} kept (the plan's own lines, locked and saved ones), {draw.filter(r => !r.lineId && !r.line).length} left empty. Draw {seed}.</span>
          <div className="st-tablewrap" style={{ maxHeight: 440, overflow: 'auto' }}>
            <table className="st-table st-drawtable">
              <thead><tr><th>Day</th><th>Account</th><th>Life or job</th><th>Line</th><th>Pain</th><th>Emotion</th><th>Format</th><th /></tr></thead>
              <tbody>
                {draw.map(r => (
                  <tr key={r.postId} className={r.flag ? 'flag' : r.kept ? 'kept' : undefined} data-field={`weeks-draw-${r.rowId}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dayLabel(r.date)} · {r.slot}</td><td>{r.account}</td><td>{r.lifeOrJob}</td>
                    <td style={{ maxWidth: 360 }}>{r.line || <span className="st-warntext">{r.flag ?? 'empty'}</span>}{r.from === 'csv' ? <span className="st-chip xs" style={{ marginLeft: 6 }}>the plan's</span> : null}</td>
                    <td>{r.pain}</td><td>{r.emotion}</td><td>{r.format}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.from !== 'csv' && <button type="button" className="st-btn xs ghost" aria-label={`${r.locked ? 'Unlock' : 'Lock'} ${r.rowId}`} aria-pressed={r.locked} onClick={() => void lock(r)} title={r.locked ? 'Locked: keeps its line on every redraw' : 'Lock this slot'}>{r.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>}
                      {!r.locked && r.from !== 'csv' && <button type="button" className="st-btn xs ghost" disabled={busy} onClick={() => void run([r.postId])} aria-label={`Redraw ${r.rowId}`}><RefreshCw size={12} />Redraw</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AsyncButton className="st-btn" disabled={!drawn.length && !draw.some(r => r.flag)} busyLabel="Saving..." onClick={async () => {
            try {
              const r = await api.weekFill(v.monday, draw.filter(x => x.from === 'draft' || (!x.lineId && !x.line)).map(x => ({ postId: x.postId, lineId: x.lineId, lifeOrJob: x.lifeOrJob, flag: x.flag })))
              setDraw(null); onChanged()
              toast({ tone: 'ok', text: `${r.filled} lines saved${r.empty ? `, ${r.empty} left empty and flagged` : ''}; ${r.drafted} visuals drafted from their lines.` })
            } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
          }} field="weeks-save-draw">Save the draw ({drawn.length} line{drawn.length === 1 ? '' : 's'}, free)</AsyncButton>
        </div>
      )}
      {!draw && (
        <div className="st-col" style={{ gap: 8 }} data-field="weeks-fit">
          <span className="st-label">Fit to voice</span>
          <span className="st-hint">Each line rewritten in its character's voice card and fitted to that day's story beat, keeping the original truth and detail (numbers, times, the petty reason), the hit in the first words. You see before and after with the 9-point line lint; nothing changes until you press Use.</span>
          <PriceButton label={`Fit ${v.cells.filter(c => c.line.trim() && c.review !== 'killed').length} lines to voice`} action={v.cells.some(c => c.line.trim()) ? { type: 'week_fit', week: v.monday, postIds: v.cells.filter(c => c.line.trim() && c.lineFrom === 'drawn' && c.review !== 'killed').map(c => c.postId) } : null}
            todo={v.cells.some(c => c.line.trim()) ? [] : [{ label: 'Fill the week first' }]} onDone={onChanged} />
          {fits.length > 0 && <FitList cells={fits} onChanged={onChanged} />}
          <div className="st-row" style={{ gap: 8 }}>
            <span className="st-hint grow">Next: Check the week (free).</span>
            <button type="button" className="st-btn sm secondary" onClick={onNext}>Go to Check</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LintDots({ text }: { text: string }) {
  const points = lineLint(text)
  return (
    <span className="st-lintdots" aria-label={`Line lint: ${points.filter(p => p.ok).length} of 9`}>
      {points.map(p => <span key={p.n} className={p.ok ? '' : 'no'} title={`${p.n}. ${p.title}${p.ok ? '' : `: ${p.message}`}`}>{p.n}</span>)}
    </span>
  )
}

function FitList({ cells, onChanged }: { cells: WeekCell[]; onChanged: () => void }) {
  const toast = useToast()
  const apply = async (ids: string[], use: boolean) => { try { const r = await api.weekFitApply(ids, use); onChanged(); toast({ tone: 'ok', text: use ? `${r.applied} line${r.applied === 1 ? '' : 's'} used.` : 'Kept as they were.' }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }
  return (
    <div className="st-col" style={{ gap: 8 }} data-field="weeks-fit-list">
      <div className="st-row" style={{ gap: 8 }}>
        <b className="grow">{cells.length} line{cells.length === 1 ? '' : 's'} fitted: before and after</b>
        <AsyncButton className="st-btn sm" busyLabel="Using..." onClick={() => apply(cells.filter(c => c.fit?.after).map(c => c.postId), true)}>Use all</AsyncButton>
        <AsyncButton className="st-btn sm ghost" busyLabel="..." onClick={() => apply(cells.map(c => c.postId), false)}>Keep all as they were</AsyncButton>
      </div>
      <div className="st-tablewrap">
        <table className="st-table">
          <thead><tr><th>Row</th><th>Before</th><th>After</th><th /></tr></thead>
          <tbody>
            {cells.map(c => (
              <tr key={c.postId} data-field={`weeks-fit-${c.rowId}`}>
                <td>{c.rowId}</td>
                <td style={{ maxWidth: 280 }}>{c.fit!.before}<div><LintDots text={c.fit!.before} /></div></td>
                <td style={{ maxWidth: 280 }}>{c.fit!.after || <span className="st-warntext">{c.fit!.why || 'Does not fit: kept as it was'}</span>}{c.fit!.after && <div><LintDots text={c.fit!.after} /></div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {c.fit!.after && <button type="button" className="st-btn xs" onClick={() => void apply([c.postId], true)}>Use</button>}
                  <button type="button" className="st-btn xs ghost" onClick={() => void apply([c.postId], false)}>Keep</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Check ─────────────────────────────────────────────────────────────

function CheckStep({ v, onChanged, onNext }: { v: WeekView; onChanged: () => void; onNext: () => void }) {
  const toast = useToast()
  const flagged = v.cells.filter(c => c.flags.length && c.review !== 'killed')
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="weeks-check">
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}><span className="st-h3 grow">Check the week before money</span><HowTo id="weeks" label="What Check looks for" /></div>
      <span className="st-hint">Free: a person post with no outfit, no line, no scene, a line outside its product's claims, a life slot with a job line, the same line on two accounts. Bad rows are marked on the grid; the rest can run.</span>
      <AsyncButton className="st-btn" busyLabel="Checking..." onClick={async () => {
        try { const r = await api.weekCheck(v.monday); onChanged(); toast({ tone: r.flagged ? 'bad' : 'ok', text: `${r.checked} checked, ${r.flagged} flagged.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
      }} field="weeks-run-check">Check the week (free)</AsyncButton>
      {v.counts.unchecked === 0 && (
        <span className="st-hint" role="status" data-field="weeks-check-result"><b>{v.counts.posts - v.counts.killed - flagged.length} posts ready to make</b>{flagged.length ? `, ${flagged.length} flagged (fix them in their post, then Check again):` : '. Next: Make the week.'}</span>
      )}
      {flagged.length > 0 && (
        <ul className="st-col" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
          {flagged.map(c => <li key={c.postId}><Link to={`/studio/posts/${c.postId}`}>{c.rowId}</Link> <span className="st-hint">({c.account}, {dayLabel(c.date)} {c.slot})</span>: {c.flags.join('; ')}</li>)}
        </ul>
      )}
      {v.counts.unchecked === 0 && <button type="button" className="st-btn sm secondary" style={{ alignSelf: 'flex-start' }} onClick={onNext}>Go to Make</button>}
    </div>
  )
}

// ── Make ──────────────────────────────────────────────────────────────

function MakeStep({ v, onChanged, onNext }: { v: WeekView; onChanged: () => void; onNext: () => void }) {
  const models = useQuery({ queryKey: ['slide-still-models', null], queryFn: () => api.slideStillModels(null), staleTime: 60_000 })
  const [path, setPath] = useState<StillPathId | null>(null)
  const pick = path ?? models.data?.pick ?? null
  // Provider for this run (section 40): every post uses it where it runs
  // that post's model, else the post's own pick.
  const engines = useQuery({ queryKey: ['engines'], queryFn: () => api.engines(), staleTime: 60_000 })
  const [provider, setProvider] = useState('')
  const ready = v.cells.filter(c => c.review !== 'killed' && !c.made && !c.making && !c.flags.length && c.checked && c.line.trim())
  const ids = new Set(v.cells.map(c => c.postId))
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="weeks-make">
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}><span className="st-h3 grow">Make the week</span><HowTo id="weeks" label="How Make works" /></div>
      <span className="st-hint">One total price, one click: every checked post without a flag, stills first, then the video where the post has one (each video starts from its own still when it lands). Ten posts at a time; each group is checked against your daily cap when its turn comes, and a group over it waits and goes on after midnight (UTC). Progress is one line per post.</span>
      {models.data && <StillPaths field="weeks-make-path" paths={models.data.paths} value={pick} onPick={p => setPath(p)} models={[]} />}
      {engines.data && (
        <label className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }} data-field="weeks-make-provider">
          <span className="st-label" style={{ margin: 0 }}>Provider for this run</span>
          <select className="st-select" style={{ width: 'auto' }} value={provider} onChange={e => setProvider(e.target.value)} aria-label="Provider for this run">
            <option value="">Each post's own pick (Higgsfield unless you picked another)</option>
            {engines.data.providers.map(p => <option key={p.id} value={p.id}>{p.label}, where it runs the post's model</option>)}
          </select>
          <span className="st-hint">The price below follows it. Models only one provider runs (Soul, Genjutsu) stay where they are.</span>
        </label>
      )}
      <PriceButton label={`Make the week (${ready.length} post${ready.length === 1 ? '' : 's'})`} action={ready.length ? { type: 'week_make', week: v.monday, ...(pick ? { path: pick } : {}), ...(provider ? { provider } : {}) } : null}
        todo={ready.length ? [] : [{ label: v.counts.unchecked ? 'Check the week first' : 'Nothing to make: every checked post is made or making' }]} onStarted={onChanged} onDone={onChanged}
        watch={j => ids.has(j.postId ?? '')} />
      {v.counts.making === 0 && v.counts.toReview > 0 && <div className="st-row" style={{ gap: 8 }}><span className="st-hint grow">{v.counts.toReview} made. Next: Review.</span><button type="button" className="st-btn sm" onClick={onNext}>Go to Review</button></div>}
    </div>
  )
}

// ── Review ────────────────────────────────────────────────────────────

function ReviewStep({ v, onChanged, onNext }: { v: WeekView; onChanged: () => void; onNext: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const cards = v.cells.filter(c => c.made || c.review)
  const [focus, setFocus] = useState(0)
  const [redo, setRedo] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const live = v.counts.posts - v.counts.killed
  async function call(c: WeekCell, next: 'approved' | 'killed' | null) {
    // Instant: the card shows the call, the server keeps it (and logs it).
    qc.setQueryData<WeekView>(['week', v.monday], d => (d ? { ...d, cells: d.cells.map(x => (x.postId === c.postId ? { ...x, review: next, approved: next === 'approved' } : x)) } : d))
    try { await api.weekReview(c.postId, next); onChanged() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }); onChanged() }
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!box.current || (e.target as HTMLElement)?.closest('input, textarea, select')) return
      const c = cards[focus]
      const k = e.key.toLowerCase()
      if (k === 'arrowright' || k === 'arrowdown') { setFocus(f => Math.min(cards.length - 1, f + 1)); e.preventDefault() }
      else if (k === 'arrowleft' || k === 'arrowup') { setFocus(f => Math.max(0, f - 1)); e.preventDefault() }
      else if (c && k === 'a') { void call(c, 'approved'); setFocus(f => Math.min(cards.length - 1, f + 1)) }
      else if (c && k === 'k') { void call(c, 'killed'); setFocus(f => Math.min(cards.length - 1, f + 1)) }
      else if (c && k === 'r') setRedo(c.postId)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="weeks-review" ref={box}>
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="st-h3 grow" role="status" data-field="weeks-approved-count">{v.counts.approved} of {live} approved</span>
        <span className="st-hint">Keys: A approve, K kill, R redo, arrows to move</span>
        <HowTo id="weeks" label="How Review works" />
      </div>
      {!cards.length && <span className="st-hint">Nothing made yet. Make the week first.</span>}
      <div className="st-reviewgrid">
        {cards.map((c, i) => (
          <div key={c.postId} className={`st-reviewcard ${i === focus ? 'focus' : ''} ${c.review ?? ''}`} tabIndex={0} onFocus={() => setFocus(i)} onClick={() => setFocus(i)} data-field={`weeks-review-${c.rowId}`}>
            <div className="media">
              {c.videoAssetId ? <video src={assetUrl(c.videoAssetId)} muted loop playsInline onMouseEnter={e => void e.currentTarget.play().catch(() => undefined)} onMouseLeave={e => e.currentTarget.pause()} poster={c.thumbAssetId ? assetUrl(c.thumbAssetId, 480) : undefined} /> : c.thumbAssetId ? <img src={assetUrl(c.thumbAssetId, 480)} alt="" /> : <span className="st-hint">No picture</span>}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }} className="st-clamp1" title={c.line}>{c.line}</div>
            <div className="st-hint" style={{ fontSize: 11 }}>{c.rowId} · {c.account} · {dayLabel(c.date)} {c.slot} · {TYPE[c.postType]}</div>
            <div className="st-row" style={{ gap: 4, flexWrap: 'wrap' }}>
              <button type="button" className={`st-btn xs ${c.review === 'approved' ? '' : 'secondary'}`} aria-pressed={c.review === 'approved'} onClick={() => void call(c, c.review === 'approved' ? null : 'approved')}><Check size={12} />Approve</button>
              <button type="button" className={`st-btn xs ${c.review === 'killed' ? '' : 'ghost'}`} aria-pressed={c.review === 'killed'} onClick={() => void call(c, c.review === 'killed' ? null : 'killed')}><X size={12} />Kill</button>
              <button type="button" className="st-btn xs ghost" onClick={() => setRedo(redo === c.postId ? null : c.postId)}><RefreshCw size={12} />Redo</button>
              <Link className="st-btn xs ghost" to={`/studio/posts/${c.postId}`}>Open</Link>
            </div>
            {redo === c.postId && <PriceButton size="sm" label="Redo this post" action={{ type: 'week_redo', week: v.monday, postIds: [c.postId] }} onStarted={() => { setRedo(null); onChanged() }} onDone={onChanged} />}
          </div>
        ))}
      </div>
      {v.counts.approved > 0 && <div className="st-row" style={{ gap: 8 }}><span className="st-hint grow">Next: Send the {v.counts.toSend} approved post{v.counts.toSend === 1 ? '' : 's'} to Drive (free).</span><button type="button" className="st-btn sm" onClick={onNext}>Go to Send to Drive</button></div>}
    </div>
  )
}

// ── Send to Drive ─────────────────────────────────────────────────────

function DriveStep({ v, onChanged }: { v: WeekView; onChanged: () => void }) {
  const toast = useToast()
  const nav = useNavigate()
  const drive = useQuery({ queryKey: ['drive'], queryFn: () => api.drive(), staleTime: 30_000 })
  const d = drive.data
  const approved = v.cells.filter(c => c.approved)
  const sel = useSelection(useMemo(() => approved.map(c => c.postId), [approved.map(c => c.postId).join('|')])) // eslint-disable-line react-hooks/exhaustive-deps
  const [sending, setSending] = useState<string | null>(null)
  const job = useQuery({ queryKey: ['drive-job', sending], queryFn: async () => (await api.job(sending!)).job, enabled: !!sending, refetchInterval: q => (['completed', 'failed', 'canceled'].includes(q.state.data?.status ?? '') ? false : 2000) })
  useEffect(() => { if (job.data && ['completed', 'failed'].includes(job.data.status)) { onChanged(); if (job.data.status === 'failed') toast({ tone: 'bad', text: job.data.error?.message ?? 'The send did not finish.' }) } }, [job.data?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!(d?.connected && d.root)
  const picked = approved.filter(c => sel.has(c.postId))
  const todo: TodoItem[] = [
    ...(!d?.connected ? [{ label: 'Connect Google Drive in Settings' }] : []),
    ...(d?.connected && !d.root ? [{ label: 'Pick the root folder in Settings' }] : []),
    ...(!approved.length ? [{ label: 'Approve posts in Review first' }] : []),
  ]
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="weeks-drive">
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}><span className="st-h3 grow">Send to Google Drive</span><HowTo id="weeks" label="How Send to Drive works" /></div>
      <span className="st-hint">Free, on the worker: each approved post to {d?.root ? <b>{d.root.name}</b> : 'ROOT'} / CHARACTER / week of {v.monday} /, named date_slot_account_rowid (.mp4, .jpg, or a .zip for a slideshow), with a manifest Google Sheet and CSV in the same folder (Device ID and Account first). Sending again replaces the same files and rows, never duplicates. Each caption carries the AI label line.</span>
      <span className="st-hint" data-field="weeks-drive-status">{d ? (d.connected ? `Google Drive connected${d.email ? ` (${d.email})` : ''}. Root folder: ${d.root?.name ?? 'not picked yet'}.` : 'Google Drive is not connected.') : 'Reading Google Drive...'} <button type="button" className="st-btn xs ghost" onClick={() => nav('/studio/settings?tab=general#drive')}>Google Drive settings</button></span>
      {approved.length > 0 && (
        <div className="st-tablewrap" style={{ maxHeight: 300, overflow: 'auto' }}>
          <table className="st-table">
            <thead><tr><th><SelectAllBox sel={sel} label="Pick every approved post" /></th><th>Row</th><th>Account</th><th>Day</th><th>In Drive</th></tr></thead>
            <tbody>{approved.map(c => <tr key={c.postId}><td><SelectBox sel={sel} id={c.postId} label={`Send ${c.rowId}`} /></td><td>{c.rowId}</td><td>{c.account}</td><td>{dayLabel(c.date)} {c.slot}</td><td>{c.sentAt ? <span title={c.driveName}>Sent {new Date(c.sentAt).toLocaleString()}</span> : <span className="st-muted">Not yet</span>}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <AsyncButton className="st-btn" disabled={!ready || !approved.length || !!(sending && job.data && !['completed', 'failed'].includes(job.data.status))} title={todo.map(t => t.label).join('; ') || undefined} busyLabel="Starting..." onClick={async () => {
          try { const r = await api.weekSend(v.monday, picked.length ? { postIds: picked.map(c => c.postId), again: true } : {}); setSending(r.jobId); toast({ tone: 'ok', text: `Sending ${r.posts} post${r.posts === 1 ? '' : 's'} to Drive.` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
        }} field="weeks-send"><Send size={14} />{picked.length ? `Send ${picked.length} to Drive (free)` : `Send ${v.counts.toSend} approved to Drive (free)`}</AsyncButton>
        {sending && job.data && <span className="st-hint" role="status" data-field="weeks-send-status">{job.data.status === 'completed' ? 'Sent. The manifest is in the same folder.' : job.data.status === 'failed' ? `Not sent: ${job.data.error?.message ?? ''}` : 'Sending...'}</span>}
      </div>
      <Todo items={todo} />
    </div>
  )
}

// ── The spec, read in the app ─────────────────────────────────────────

// A small Markdown reader for the spec: headings, tables, code, lists.
function SpecDoc({ text }: { text: string }) {
  const blocks: JSX.Element[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    const inline = (s: string) => s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, k) => p.startsWith('`') ? <code key={k}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <b key={k}>{p.slice(2, -2)}</b> : p)
    if (l.startsWith('```')) { const body: string[] = []; for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) body.push(lines[i]!); blocks.push(<pre key={i}>{body.join('\n')}</pre>); continue }
    if (l.startsWith('|')) {
      const rows: string[][] = []
      for (; i < lines.length && lines[i]!.startsWith('|'); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i]!)) rows.push(lines[i]!.slice(1, -1).split(' | ').map(x => x.trim()))
      i--
      blocks.push(<table key={i}><thead><tr>{rows[0]!.map((h, k) => <th key={k}>{inline(h)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table>)
      continue
    }
    if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)![0].length; blocks.push(n === 1 ? <h1 key={i} className="st-h2">{l.slice(2)}</h1> : <h2 key={i} className="st-h3">{l.replace(/^#+ /, '')}</h2>); continue }
    if (/^(?:- |\d+\. )/.test(l)) { const items: string[] = []; for (; i < lines.length && /^(?:- |\d+\. |  )/.test(lines[i]!); i++) { if (/^ {2}/.test(lines[i]!)) items[items.length - 1] += ` ${lines[i]!.trim()}`; else items.push(lines[i]!.replace(/^(?:- |\d+\. )/, '')) } i--; blocks.push(<ul key={i}>{items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ul>); continue }
    if (l.trim()) { const para: string[] = [l]; for (i++; i < lines.length && lines[i]!.trim() && !/^(#|\||```|- |\d+\. )/.test(lines[i]!); i++) para.push(lines[i]!); i--; blocks.push(<p key={i}>{inline(para.join(' '))}</p>) }
  }
  return <div className="st-specdoc" data-field="weeks-spec-doc">{blocks}</div>
}
