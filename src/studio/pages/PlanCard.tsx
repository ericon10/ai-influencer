import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronDown, ChevronRight, ExternalLink, Upload } from 'lucide-react'
import { api } from '../api'
import { keys, useActiveJobs } from '../hooks'
import { PriceButton } from '../PriceButton'
import { AsyncButton, errorMessage, useToast } from '../ui'
import { HowTo } from '../guide/Guide'
import type { CharacterSummary, PlanImportResult, PlanPostView, PlanPreview } from '../types'

// Posts home > Launch plan (owner, 2026-10-16; UX-PLAN.md section 28): the
// plan's CSV, previewed for free (rows by day and account, errors, what
// each slide becomes, the total price), then every row a draft in its flow
// with its words as written (free). Then tick posts and Generate N posts:
// one price, ten posts at a time. Each post opens in its own workspace.

const KEY = 'st-plan-open'
const FORMAT_SHORT: Record<string, string> = {
  'mock ui slideshow': 'Mock UI', 'slideshow list': 'List', 'slideshow story': 'Story', 'stat slideshow': 'Stat',
  'character slideshow': 'Slideshow', 'character photo': 'Photo', 'character clip': 'Clip',
}
const short = (f: string) => FORMAT_SHORT[f.trim().toLowerCase()] ?? f
const usd = (n: number) => `$${n.toFixed(2)}`
const dayLabel = (d: string) => {
  if (!d) return 'No date'
  const t = new Date(`${d}T12:00:00Z`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function PlanCard({ characters }: { characters: CharacterSummary[] }) {
  const qc = useQueryClient()
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api.plan(), staleTime: 5_000 })
  const posts = plan.data?.posts ?? []
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* private window */ } }, [open])
  // While stills run, the list follows them.
  const jobs = useActiveJobs()
  const running = (jobs.data?.jobs ?? []).some(j => /^(slide_still|scene):/.test(j.purpose))
  useEffect(() => {
    if (!running || !open) return
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: ['plan'] }), 5000)
    return () => clearInterval(t)
  }, [running, open, qc])
  const have = posts.filter(p => p.need > 0 && p.have >= p.need).length
  const exported = posts.filter(p => p.exported).length

  return (
    <section className="st-card" data-field="launch-plan" style={{ marginBottom: 18 }}>
      <div className="st-card-head st-row" style={{ gap: 10 }}>
        <button type="button" className="st-row grow" style={{ flex: 1, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', gap: 10, color: 'inherit', font: 'inherit', padding: 0 }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <CalendarDays size={16} />
          <div className="grow">
            <div className="st-h3">Launch plan</div>
            <div className="st-hint">{posts.length ? `${posts.length} posts from the plan · ${have} with their pictures · ${exported} exported` : 'Import the plan\'s CSV: every row becomes a draft with its words as written. Free; nothing paid runs.'}</div>
          </div>
        </button>
        <HowTo id="launch-plan" label="How the plan import works" />
      </div>
      {open && (
        <div className="st-card-body st-col" style={{ gap: 14 }}>
          <ImportPlan characters={characters} hasPosts={posts.length > 0} onImported={() => void qc.invalidateQueries({ queryKey: ['plan'] })} />
          {posts.length > 0 && <PlanPosts posts={posts} />}
        </div>
      )}
    </section>
  )
}

function ImportPlan({ characters, hasPosts, onImported }: { characters: CharacterSummary[]; hasPosts: boolean; onImported: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [show, setShow] = useState(!hasPosts)
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [draw, setDraw] = useState(false)
  const [store, setStore] = useState<Record<string, string>>({})
  const [model, setModel] = useState<string | null>(null)
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [done, setDone] = useState<PlanImportResult | null>(null)
  const file = useRef<HTMLInputElement>(null)
  async function load(f: File | undefined) {
    if (!f) return
    if (f.size > 400_000) { toast({ tone: 'bad', text: `${f.name} is over 400 KB. Split it.` }); return }
    setCsv(await f.text()); setName(f.name); setPreview(null); setDone(null)
  }
  async function check(o: { draw?: boolean; store?: Record<string, string>; model?: string | null } = {}) {
    try {
      setPreview(await api.planPreview(csv, { drawSpecials: o.draw ?? draw, store: o.store ?? store, stillModel: o.model ?? model }))
      setDone(null)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  if (!show) return <button type="button" className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShow(true)}><Upload size={13} />Import a plan CSV again</button>
  const ok = preview?.totals.ok ?? 0
  return (
    <div className="st-col" style={{ gap: 10 }} data-field="plan-import">
      <span className="st-hint">The plan's columns (row_id, date, slot, account, format, hook, slides 2 to 6, scene, clip_action, caption, hashtags, cta and the playbook fields). Slideshow rows become slideshows, photo rows one-slide slideshows, clip rows video posts. Every word as written; no redraft.</span>
      <textarea className="st-textarea" rows={3} value={csv} onChange={e => { setCsv(e.target.value); setName(''); setPreview(null); setDone(null) }} placeholder="Paste the plan (with its header line), or upload the CSV" aria-label="Plan rows" />
      <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void load(f) }} />
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="st-btn sm secondary" onClick={() => file.current?.click()}><Upload size={13} />Upload the CSV</button>
        {name && <span className="st-hint">{name}</span>}
        <label className="st-row" style={{ gap: 8, cursor: 'pointer' }}>
          <button type="button" role="switch" aria-checked={draw} className={`st-switch ${draw ? 'on' : ''}`} onClick={() => { setDraw(!draw); if (preview) void check({ draw: !draw }) }}><span /></button>
          <span className="st-hint">Draw mock screens by code (off: every slide is a photo made as written)</span>
        </label>
        <AsyncButton className="st-btn sm" disabled={!csv.trim()} title={csv.trim() ? undefined : 'Paste the rows or upload the CSV first'} busyLabel="Reading the plan..." onClick={() => check()}>Preview (free)</AsyncButton>
      </div>
      {preview && (
        <div className="st-col" style={{ gap: 10 }} data-field="plan-preview">
          {preview.problems.map(p => <span key={p} className="st-hint st-warntext">{p}</span>)}
          <div className="st-tablewrap">
            <table className="st-table">
              <thead><tr><th>Account</th><th>What it is</th><th>Pictures filed under</th><th>Rows</th></tr></thead>
              <tbody>
                {preview.accounts.map(a => (
                  <tr key={a.tag} className={a.problem ? 'st-warnrow' : undefined}>
                    <td><b>{a.tag}</b></td>
                    <td>{a.kind === 'character' ? `Character: ${a.characterName || '?'}` : 'Topic account (no one in the photos)'}</td>
                    <td>{a.kind === 'topic' ? (
                      <select className="st-input sm" value={a.characterId ?? ''} onChange={e => { const next = { ...store, [a.tag]: e.target.value }; setStore(next); void check({ store: next }) }} aria-label={`Pictures for ${a.tag} filed under`}>
                        {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : a.problem ? <span className="st-warntext">{a.problem}</span> : a.characterName}</td>
                    <td>{a.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="st-hint">A topic account's pictures are filed under a character only for storage: nothing of hers (face, voice, name) goes into its posts.</span>
          <PlanGrid preview={preview} />
          {preview.rows.some(r => r.errors.length) && (
            <div className="st-col" style={{ gap: 4 }} data-field="plan-errors">
              <b className="st-warntext">Rows that will be skipped</b>
              {preview.rows.filter(r => r.errors.length).slice(0, 20).map(r => <span key={r.line} className="st-hint st-warntext">Line {r.line} ({r.rowId || 'no id'}): {r.errors.join('; ')}</span>)}
            </div>
          )}
          {preview.rows.some(r => r.warnings.length || r.lint.length) && (
            <details className="st-col" data-field="plan-warnings">
              <summary className="st-hint" style={{ cursor: 'pointer' }}>{preview.rows.filter(r => r.warnings.length || r.lint.length).length} rows with notes (warnings and language notes; they still import)</summary>
              {preview.rows.filter(r => r.warnings.length || r.lint.length).slice(0, 40).map(r => <span key={r.line} className="st-hint">{r.rowId}: {[...r.warnings, ...r.lint].join('; ')}</span>)}
            </details>
          )}
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-field="plan-still-model">
            <span className="st-hint">Stills:</span>
            {preview.still.choices.map(c => (
              <button key={c.ref} type="button" className={`st-chip ${preview.still.model === c.ref ? 'on' : ''}`} disabled={!!c.problem} title={c.problem ?? c.pathLabel} onClick={() => { setModel(c.ref); void check({ model: c.ref }) }}>{c.label} · {c.pathLabel}</button>
            ))}
          </div>
          <span className="st-hint" role="status" data-field="plan-totals">
            <b>{ok} posts</b>: {preview.totals.slideshows} slideshows, {preview.totals.photos} photos, {preview.totals.clips} clips{preview.totals.kept ? `, ${preview.totals.kept} already with pictures (kept as they are)` : ''}{preview.totals.problem ? `, ${preview.totals.problem} skipped` : ''}. Generating all their pictures later: {preview.totals.stills} stills, about {usd(preview.totals.usd)} ({preview.still.label}, {usd(preview.still.perStillUsd)} a still). Making the drafts is free; each Generate shows its price first.
          </span>
          <AsyncButton className="st-btn" disabled={!ok} title={ok ? undefined : 'Fix the rows above first'} busyLabel={`Making ${ok} drafts...`} onClick={async () => {
            try {
              const r = await api.planImport(csv, { drawSpecials: draw, store })
              setDone(r)
              onImported()
              await qc.invalidateQueries({ queryKey: keys.content })
              toast({ tone: 'ok', text: `${r.created} drafts made${r.updated ? `, ${r.updated} updated` : ''}.` })
            } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
          }}>Make {ok} drafts (free)</AsyncButton>
        </div>
      )}
      {done && <span className="st-hint" role="status" data-field="plan-done">{done.created} drafts made, {done.updated} updated{done.kept ? `, ${done.kept} kept (they have pictures)` : ''}{done.skipped ? `, ${done.skipped} skipped` : ''}. Tick them below and generate, or open any post.</span>}
    </div>
  )
}

// The preview by day (rows) and account (columns).
function PlanGrid({ preview }: { preview: PlanPreview }) {
  const accounts = preview.accounts.map(a => a.tag)
  return (
    <div className="st-tablewrap" data-field="plan-grid">
      <table className="st-table st-plangrid">
        <thead><tr><th>Day</th>{accounts.map(a => <th key={a}>{a}</th>)}</tr></thead>
        <tbody>
          {preview.days.map(d => (
            <tr key={d}>
              <td className="day">{dayLabel(d)}</td>
              {accounts.map(a => (
                <td key={a}>
                  {preview.rows.filter(r => r.date === d && r.account === a).map(r => (
                    <span key={r.line} className={`st-planchip ${r.state}`} title={[`${r.rowId} · ${r.slot} · ${r.format}`, r.hook, r.photos ? `${r.photos} photo${r.photos === 1 ? '' : 's'}${r.specials.length ? `, ${r.specials.length} drawn` : ''}, about ${usd(r.priceUsd)}` : '', ...r.errors, ...r.warnings].filter(Boolean).join('\n')}>
                      <b>{r.slot || '·'}</b> {short(r.format)}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The plan's posts after import: tick, generate (one price, ten at a time),
// open any post.
function PlanPosts({ posts }: { posts: PlanPostView[] }) {
  const [day, setDay] = useState('')
  const [account, setAccount] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const models = useQuery({ queryKey: ['slide-still-models'], queryFn: () => api.slideStillModels(), staleTime: 60_000 })
  const [model, setModel] = useState<string | null>(null)
  const days = useMemo(() => [...new Set(posts.map(p => p.date))], [posts])
  const accounts = useMemo(() => [...new Set(posts.map(p => p.account))], [posts])
  const shown = posts.filter(p => (!day || p.date === day) && (!account || p.account === account))
  const needing = shown.filter(p => p.have < p.need)
  const ids = [...picked].filter(id => posts.some(p => p.id === id && p.have < p.need))
  const pick = model ?? models.data?.pick ?? null
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="st-col" style={{ gap: 10 }} data-field="plan-posts">
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="st-select" value={day} onChange={e => setDay(e.target.value)} aria-label="Day"><option value="">Every day</option>{days.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}</select>
        <select className="st-select" value={account} onChange={e => setAccount(e.target.value)} aria-label="Account"><option value="">Every account</option>{accounts.map(a => <option key={a} value={a}>{a}</option>)}</select>
        <button type="button" className="st-btn sm ghost" disabled={!needing.length} onClick={() => setPicked(s => new Set([...s, ...needing.map(p => p.id)]))}>Tick the {needing.length} shown that need pictures</button>
        {picked.size > 0 && <button type="button" className="st-btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>}
      </div>
      <div className="st-tablewrap">
        <table className="st-table">
          <thead><tr><th aria-label="Pick" /><th>Day</th><th>Account</th><th>Format</th><th>Hook</th><th>Pictures</th><th /></tr></thead>
          <tbody>
            {shown.slice(0, 200).map(p => (
              <tr key={p.id} data-field={`plan-post-${p.rowId}`}>
                <td><input type="checkbox" checked={picked.has(p.id)} disabled={p.have >= p.need} onChange={() => toggle(p.id)} aria-label={`Pick ${p.rowId}`} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{dayLabel(p.date)} {p.slot}</td>
                <td>{p.account}</td>
                <td>{short(p.format)}</td>
                <td style={{ maxWidth: 360 }}><span className="st-clamp1">{p.hook}</span></td>
                <td>{p.exported ? 'Exported' : p.need ? `${p.have} of ${p.need}` : 'Drawn only'}</td>
                <td><Link className="st-btn ghost xs" to={`/studio/posts/${p.id}`}><ExternalLink size={12} />{p.rowId}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="st-hint">Stills:</span>
        {(models.data?.choices ?? []).map(c => <button key={c.ref} type="button" className={`st-chip ${pick === c.ref ? 'on' : ''}`} disabled={!!c.problem} title={c.problem ?? c.pathLabel} onClick={() => setModel(c.ref)}>{c.label} · {c.pathLabel}</button>)}
      </div>
      <PriceButton label={`Generate ${ids.length} post${ids.length === 1 ? '' : 's'}`} action={ids.length ? { type: 'plan_generate', postIds: ids.slice(0, 100), ...(pick ? { stillModel: pick } : {}) } : null}
        todo={ids.length ? [] : [{ label: 'Tick the posts to generate' }]} onStarted={() => setPicked(new Set())} />
      <span className="st-hint">A slideshow gets a still for every photo slide (drawn slides are free), a clip its opening still; its take is made in the post with its own price after you pick the still. More than 10 posts run ten at a time.{ids.length > 100 ? ' At most 100 in one go.' : ''}</span>
    </div>
  )
}

