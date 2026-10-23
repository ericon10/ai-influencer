import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronDown, ChevronRight, ExternalLink, Upload } from 'lucide-react'
import { api } from '../api'
import { keys, useActiveJobs } from '../hooks'
import { PriceButton } from '../PriceButton'
import { AsyncButton, Todo, errorMessage, useToast, type TodoItem } from '../ui'
import { NotesBadge } from '../lint'
import { PunchUp } from '../punchUp'
import { useProductList } from '../products'
import { HowTo } from '../guide/Guide'
import type { CharacterSummary, PlanImportResult, PlanPostView, PlanPreview, StillPathId } from '../types'
import { StillPaths } from './post/slideshow/StillPaths'
import { SelectAllBox, SelectBox, SelectionCount, useSelection } from '../select'
import { useIncoming, type Incoming } from '../importDoor'
import { WriteTheWeek } from './post/LineBank'
import { FacelessImport } from './FacelessImport'

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
// Section 30: plan credits on the plan path, dollars on the API, or both.
const credits = (n: number) => `${Math.round(n * 100) / 100} credit${n === 1 ? '' : 's'}`
const priceOf = (c: number, d: number) => [c > 0 ? credits(c) : '', d > 0 || c <= 0 ? usd(d) : ''].filter(Boolean).join(' + ')
const dayLabel = (d: string) => {
  if (!d) return 'No date'
  const t = new Date(`${d}T12:00:00Z`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// On Weeks (UX-PLAN.md section 37) the older launch plan file still imports
// here, unchanged; `incoming` is a file sent by Import on Posts home.
export function PlanCard({ characters, incoming: first = null }: { characters: CharacterSummary[]; incoming?: Incoming | null }) {
  const qc = useQueryClient()
  // While the plan's stills are on their way the plan is read every 3 s, and
  // the plan itself says so (G63): it counts its own running stills, so the
  // card never depends on the jobs list (at most 100 jobs; a big run could
  // hide the stills still running, and the card stopped at "0 of 6").
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api.plan(), staleTime: 5_000, refetchInterval: q => (q.state.data?.running ? 3000 : false) })
  const posts = plan.data?.posts ?? []
  const [open, setOpen] = useState(() => { if (first) return true; try { return localStorage.getItem(KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* private window */ } }, [open])
  // Stills started somewhere else (a post's Generate the set) show in the
  // jobs list first: the plan is read then, and once more when they stop.
  const jobs = useActiveJobs()
  const running = (jobs.data?.jobs ?? []).some(j => /^(slide_still|scene):/.test(j.purpose))
  useEffect(() => {
    if (!running || !open) return
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: ['plan'] }), 5000)
    return () => clearInterval(t)
  }, [running, open, qc])
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: ['plan'] })
    wasRunning.current = running
  }, [running, qc])
  // A plan sent by Import on Posts home opens here with its preview.
  const [incoming, setIncoming] = useState<Incoming | null>(first)
  useIncoming(['plan', 'faceless'], f => { setOpen(true); setIncoming(f) })
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
            <div className="st-hint">{posts.length ? `${posts.length} posts from the plan · ${have} with their pictures · ${exported} exported` : 'Import the plan\'s CSV: the rows you tick become drafts with their words as written. Free; nothing paid runs.'}</div>
          </div>
        </button>
        <HowTo id="launch-plan" label="How the plan import works" />
      </div>
      {open && (
        <div className="st-card-body st-col" style={{ gap: 14 }}>
          {incoming?.kind === 'faceless' && <FacelessImport key={incoming.at} incoming={incoming} onImported={() => void qc.invalidateQueries({ queryKey: ['plan'] })} />}
          {incoming?.kind !== 'faceless' && <ImportPlan key={incoming?.at ?? 0} incoming={incoming} characters={characters} hasPosts={posts.length > 0} onImported={() => void qc.invalidateQueries({ queryKey: ['plan'] })} />}
          {posts.length > 0 && <WriteTheWeek accountTags={[...new Set(posts.map(p => p.account).filter(Boolean))]} />}
          {posts.length > 0 && <PlanPosts posts={posts} />}
        </div>
      )}
    </section>
  )
}

function ImportPlan({ characters, hasPosts, onImported, incoming = null }: { characters: CharacterSummary[]; hasPosts: boolean; onImported: () => void; incoming?: Incoming | null }) {
  const toast = useToast()
  const qc = useQueryClient()
  const products = useProductList()
  const [show, setShow] = useState(!hasPosts || !!incoming)
  const [csv, setCsv] = useState(incoming?.text ?? '')
  const [name, setName] = useState(incoming?.name ?? '')
  const [paste, setPaste] = useState(false)
  const [draw, setDraw] = useState(true)
  // Lines OK'd after Punch up (item 14): row_id, then slide number.
  const [punched, setPunched] = useState<Record<string, Record<string, string>>>({})
  const [store, setStore] = useState<Record<string, string>>({})
  const [path, setPath] = useState<StillPathId | null>(null)
  // The plan's product (section 29): '' not picked yet, 'none' No product.
  const [product, setProduct] = useState('')
  const [day, setDay] = useState('')
  const [account, setAccount] = useState('')
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  // Rows that match posts already made (2026-10-22): Replace or Add as new.
  const [existing, setExisting] = useState<'replace' | 'add' | null>(null)
  const [done, setDone] = useState<PlanImportResult | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const good = (preview?.rows ?? []).filter(r => r.state !== 'problem')
  const shown = good.filter(r => (!day || r.date === day) && (!account || r.account === account))
  const sel = useSelection(useMemo(() => shown.map(r => r.rowId), [shown.map(r => r.rowId).join('|')])) // eslint-disable-line react-hooks/exhaustive-deps
  const productArg = (p: string) => (p === 'none' ? null : p || undefined)
  async function load(f: File | undefined) {
    if (!f) return
    if (f.size > 400_000) { toast({ tone: 'bad', text: `${f.name} is over 400 KB. Split it.` }); return }
    setCsv(await f.text()); setName(f.name); setPaste(false); setPreview(null); setDone(null); sel.clear(); setExisting(null); setPunched({})
  }
  // A file sent by Import on Posts home: its free preview at once.
  useEffect(() => { if (incoming) void check() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function check(o: { draw?: boolean; store?: Record<string, string>; path?: StillPathId | null; product?: string; lines?: Record<string, Record<string, string>> } = {}) {
    try {
      const p = o.product ?? product
      const next = await api.planPreview(csv, { lines: o.lines ?? punched, drawSpecials: o.draw ?? draw, store: o.store ?? store, path: o.path ?? path, productId: productArg(p) })
      setPreview(next)
      // The product the plan's accounts agree on pre-fills the pick.
      if (!p && next.suggestedProductId) { setProduct(next.suggestedProductId); void check({ ...o, product: next.suggestedProductId }) }
      setDone(null)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  if (!show) return <button type="button" className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShow(true)}><Upload size={13} />Import a CSV</button>
  const lines = csv.split('\n').filter(l => l.trim()).length
  const ticked = good.filter(r => sel.has(r.rowId))
  const matching = ticked.filter(r => r.state === 'update' || r.state === 'kept')
  const matchingPictures = matching.filter(r => r.state === 'kept').length
  const stills = ticked.reduce((a, r) => a + r.photos, 0)
  const usdTicked = ticked.reduce((a, r) => a + r.priceUsd, 0)
  const creditsTicked = ticked.reduce((a, r) => a + r.credits, 0)
  // The plan's pick fills only the rows that name no product of their own.
  const needsPick = ticked.some(r => r.productFrom === 'plan')
  const todo: TodoItem[] = [
    ...(!product && needsPick ? [{ label: 'Pick the plan\'s product (or No product) for the rows that name none', target: 'plan-product' }] : []),
    ...(!ticked.length ? [{ label: 'Tick the rows to import', target: 'plan-rows' }] : []),
    ...(matching.length && !existing ? [{ label: `Pick Replace them or Add as new posts for the ${matching.length} matching row${matching.length === 1 ? '' : 's'}`, target: 'plan-existing' }] : []),
  ]
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="plan-import">
      <span className="st-hint">The plan's columns (row_id, date, slot, account, format, hook, slides 2 to 6, scene, clip_action, caption, hashtags, cta and the playbook fields). Slideshow rows become slideshows, photo rows one-slide slideshows, clip rows video posts. Every word as written; no redraft. Nothing is saved until step 4, and only the rows you tick.</span>

      <div className="st-col" style={{ gap: 8 }} data-field="plan-step-1">
        <span className="st-label">1 · The plan's CSV</span>
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void load(f) }} />
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="st-btn sm secondary" onClick={() => file.current?.click()}><Upload size={13} />Upload the CSV</button>
          {csv && !paste && <span className="st-hint" data-field="plan-file">{name ? `${name} · ` : ''}{lines - 1} row{lines - 1 === 1 ? '' : 's'} loaded</span>}
          <button type="button" className="st-btn xs ghost" onClick={() => setPaste(p => !p)}>{paste ? 'Hide the rows' : csv ? 'See or edit the rows' : 'Paste the rows instead'}</button>
        </div>
        {paste && <textarea className="st-textarea" rows={4} value={csv} onChange={e => { setCsv(e.target.value); setName(''); setPreview(null); setDone(null) }} placeholder="Paste the plan (with its header line)" aria-label="Plan rows" />}
      </div>

      <div className="st-col" style={{ gap: 8 }} data-field="plan-step-2">
        <span className="st-label">2 · Preview (free)</span>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <AsyncButton className="st-btn sm" disabled={!csv.trim()} title={csv.trim() ? undefined : 'Upload or paste the plan first'} busyLabel="Reading the plan..." onClick={() => check()}>Preview (free)</AsyncButton>
          <label className="st-row" style={{ gap: 8, cursor: 'pointer', flex: '1 1 320px', minWidth: 0, alignItems: 'flex-start' }}>
            <button type="button" role="switch" aria-checked={draw} aria-label="Draw screens by code" className={`st-switch ${draw ? 'on' : ''}`} onClick={() => { setDraw(!draw); if (preview) void check({ draw: !draw }) }}><span /></button>
            <span className="st-hint">Draw screens by code (on by default): a slide whose image line is mostly on-screen text (a job posting, an email, a text thread, a bank app, a placard, a form) is drawn by the Studio, free, its words from the line and generic company names. Off: every slide is a photo made from its line. A line that names your product is always your own screenshot, never generated or priced.</span>
          </label>
        </div>
      </div>

      {preview && (
        <div className="st-col" style={{ gap: 12 }} data-field="plan-preview">
          {preview.problems.map(p => <span key={p} className="st-hint st-warntext">{p}</span>)}

          <div className="st-col" style={{ gap: 8 }} data-field="plan-product">
            <span className="st-label">3 · This plan is for{preview.blankProductRows < good.length ? ' (the rows that name no product)' : ''}</span>
            <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="st-select" style={{ width: 'auto' }} value={product} onChange={e => { setProduct(e.target.value); void check({ product: e.target.value }) }} aria-label="This plan is for">
                <option value="">Pick the product...</option>
                <option value="none">No product</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <HowTo id="products" label="About products" />
            </div>
            <span className="st-hint">A row that names a product in the CSV's product column uses it; {preview.blankProductRows} row{preview.blankProductRows === 1 ? '' : 's'} name none and use this pick: {preview.product ? `the general standard plus ${preview.product.writingLabel === 'General standard' ? `${preview.product.name}'s vault and claims` : preview.product.writingLabel}` : 'the general standard, no product words'}. A row is an ad only when its own ad column says yes (#ad and, on a product with them, its honest endings); every other row stays a plain post. In an older file, a product column of yes or no is the ad column.</span>
          </div>

          <div className="st-tablewrap">
            <table className="st-table st-planaccts">
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
          <span className="st-hint">A topic account's pictures are filed under a character only for storage: nothing of that character (face, voice, name) goes into its posts.</span>

          <PunchUp field="plan-punch-up" lines={ticked.flatMap(r => r.lines.filter(l => l.thin).map(l => ({ id: `${r.rowId}|${l.slide}`, text: l.text, label: `${r.rowId}, slide ${l.slide}` }))).slice(0, 60)}
            onUse={next => {
              const merged = { ...punched }
              for (const [key, text] of Object.entries(next)) { const [row, slide] = key.split('|'); merged[row!] = { ...(merged[row!] ?? {}), [slide!]: text } }
              setPunched(merged); void check({ lines: merged })
            }} />

          <div className="st-col" style={{ gap: 8 }} data-field="plan-rows">
            <span className="st-label">Tick the rows to import</span>
            <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="st-select" style={{ width: 'auto' }} value={day} onChange={e => setDay(e.target.value)} aria-label="Day"><option value="">Every day</option>{preview.days.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}</select>
              <select className="st-select" style={{ width: 'auto' }} value={account} onChange={e => setAccount(e.target.value)} aria-label="Account"><option value="">Every account</option>{preview.accounts.map(a => <option key={a.tag} value={a.tag}>{a.tag}</option>)}</select>
              <SelectionCount sel={sel} />
            </div>
            <div className="st-tablewrap" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="st-table st-planrows">
                <thead><tr><th><SelectAllBox sel={sel} label={`Tick the ${shown.length} rows shown`} disabled={!shown.length} /></th><th>Row</th><th>Day</th><th>Account</th><th>Format</th><th>Product</th><th>Hook</th><th>Notes</th></tr></thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.line} data-field={`plan-row-${r.rowId}`}>
                      <td><SelectBox sel={sel} id={r.rowId} label={`Import ${r.rowId}`} /></td>
                      <td>{r.rowId}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dayLabel(r.date)} {r.slot}</td>
                      <td>{r.account}</td>
                      <td>{short(r.format)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.productFrom === 'row' ? r.product : r.product ? <span className="st-muted">{r.product} (plan)</span> : <span className="st-muted">{product ? 'None' : 'The plan\'s pick'}</span>}{r.ad ? <span className="st-chip xs" style={{ marginLeft: 6 }}>Ad</span> : null}</td>
                      <td style={{ maxWidth: 380 }}><span className="st-clamp1" title={r.hook}>{r.hook}</span></td>
                      <td>{r.state === 'update' ? <span className="st-hint">Matches a draft you have</span> : r.state === 'kept' ? <span className="st-hint">Matches a post with pictures</span> : null}{r.screenshots?.length ? <span className="st-chip xs" data-field={`needs-screenshot-${r.rowId}`} title="A line that names the product: your own screenshot goes there. Never generated, never priced.">Needs your screenshot: slide {r.screenshots.map(x => x.slide).join(', ')}</span> : null}<NotesBadge notes={[...r.warnings, ...r.lint]} field={`notes-${r.rowId}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview.rows.some(r => r.errors.length) && (
            <div className="st-col" style={{ gap: 4 }} data-field="plan-errors">
              <b className="st-warntext">Rows that cannot import</b>
              {preview.rows.filter(r => r.errors.length).slice(0, 20).map(r => <span key={r.line} className="st-hint st-warntext">Line {r.line} ({r.rowId || 'no id'}): {r.errors.join('; ')}</span>)}
            </div>
          )}
          {matching.length > 0 && (
            <div className="st-col st-callout" style={{ gap: 8 }} data-field="plan-existing" role="group" aria-label="Rows that match posts you already have">
              <b>{matching.length} row{matching.length === 1 ? ' matches posts' : 's match posts'} you already have{matchingPictures ? ` (${matchingPictures} with pictures)` : ''}.</b>
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className={`st-btn sm ${existing === 'replace' ? '' : 'secondary'}`} aria-pressed={existing === 'replace'} onClick={() => setExisting('replace')}>Replace them (their pictures go to Trash)</button>
                <button type="button" className={`st-btn sm ${existing === 'add' ? '' : 'secondary'}`} aria-pressed={existing === 'add'} onClick={() => setExisting('add')}>Add as new posts</button>
              </div>
              <span className="st-hint">Replace moves the old posts and their pictures to Library &gt; Trash (restorable for 7 days) and makes new drafts. Add keeps the old posts and makes new drafts next to them.</span>
            </div>
          )}
          <details>
            <summary className="st-hint" style={{ cursor: 'pointer' }}>The plan by day and account</summary>
            <PlanGrid preview={preview} />
          </details>
          <StillPaths field="plan-still-model" paths={preview.still.paths} value={preview.still.path} onPick={p => { setPath(p); void check({ path: p }) }}
            models={preview.still.models.map(m => ({ who: m.who, model: m }))} />
          <span className="st-hint" role="status" data-field="plan-totals">
            <b>{ticked.length} of {good.length} rows ticked</b>. Generating their pictures later: {stills} stills, about {priceOf(creditsTicked, usdTicked)} on {preview.still.pathLabel}. Importing is free; each Generate shows its price first.
          </span>
          <div className="st-col" style={{ gap: 6, alignItems: 'flex-start' }} data-field="plan-step-4">
            <span className="st-label">4 · Import</span>
            <AsyncButton className="st-btn" disabled={todo.length > 0} title={todo.length ? todo.map(t => t.label).join('; ') : undefined} busyLabel={`Importing ${ticked.length} rows...`} onClick={async () => {
              try {
                const r = await api.planImport(csv, { lines: punched, drawSpecials: draw, store, productId: productArg(product), path: preview?.still.path ?? path, rows: ticked.map(x => x.rowId), ...(matching.length && existing ? { existing } : {}) })
                sel.clear()
                setExisting(null)
                onImported()
                await qc.invalidateQueries({ queryKey: keys.content })
                // The preview again (its matches are new now), then the next step.
                await check()
                setDone(r)
                toast({ tone: 'ok', text: `${r.created + r.replaced} drafts made${r.replaced ? ` (${r.replaced} replaced)` : ''}.` })
              } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
            }}>Import {ticked.length || ''} row{ticked.length === 1 ? '' : 's'} (free)</AsyncButton>
            <Todo items={todo} />
          </div>
        </div>
      )}
      {done && <ImportDone done={done} path={preview?.still.path ?? path} onStarted={onImported} />}
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
                    <span key={r.line} className={`st-planchip ${r.state}`} title={[`${r.rowId} · ${r.slot} · ${r.format}`, r.hook, r.photos ? `${r.photos} photo${r.photos === 1 ? '' : 's'}${r.specials.length ? `, ${r.specials.length} drawn` : ''}, about ${r.price}` : '', ...r.errors, ...r.warnings].filter(Boolean).join('\n')}>
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

// After an import, the last line is the next step (owner, 2026-10-22):
// "10 drafts made. Next: Generate 10 posts, $X" with the button.
// The preview's "Stills on" pick runs the stills too (item 7).
function ImportDone({ done, path, onStarted }: { done: PlanImportResult; path: StillPathId | null; onStarted: () => void }) {
  const made = done.created + done.replaced
  const ids = done.next.postIds.slice(0, 100)
  return (
    <div className="st-col" style={{ gap: 8 }} data-field="plan-done">
      <span className="st-hint" role="status">
        {made} draft{made === 1 ? '' : 's'} made{done.replaced ? ` (${done.replaced} replaced; ${done.trashedPictures} old picture${done.trashedPictures === 1 ? '' : 's'} in the Trash)` : ''}{done.skipped ? `, ${done.skipped} skipped` : ''}.
        {ids.length ? ` Next: Generate ${ids.length} post${ids.length === 1 ? '' : 's'} (${done.next.stills} still${done.next.stills === 1 ? '' : 's'}).` : ''}
      </span>
      {ids.length > 0 && (
        <PriceButton label={`Generate ${ids.length} post${ids.length === 1 ? '' : 's'}`} action={{ type: 'plan_generate', postIds: ids, ...(path ? { path } : {}) }}
          onStarted={onStarted} onDone={onStarted} />
      )}
    </div>
  )
}

// The plan's posts after import: tick (Select all, shift-click), generate
// the ones that need pictures (one price, ten at a time), remake the ones
// that have them (the old pictures go to the Trash), Clear to the Trash,
// open any post.
function PlanPosts({ posts }: { posts: PlanPostView[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [day, setDay] = useState('')
  const [account, setAccount] = useState('')
  const models = useQuery({ queryKey: ['slide-still-models', null], queryFn: () => api.slideStillModels(null), staleTime: 60_000 })
  const [path, setPath] = useState<StillPathId | null>(null)
  const days = useMemo(() => [...new Set(posts.map(p => p.date))], [posts])
  const accounts = useMemo(() => [...new Set(posts.map(p => p.account))], [posts])
  const shown = posts.filter(p => (!day || p.date === day) && (!account || p.account === account))
  const sel = useSelection(useMemo(() => shown.map(p => p.id), [shown.map(p => p.id).join('|')])) // eslint-disable-line react-hooks/exhaustive-deps
  const ticked = posts.filter(p => sel.has(p.id))
  const ids = ticked.filter(p => p.have < p.need).map(p => p.id)
  const remake = ticked.filter(p => p.need > 0 && p.have > 0)
  const remakePictures = remake.reduce((a, p) => a + p.need, 0)
  const pick = path ?? models.data?.pick ?? null
  const on = models.data?.paths.find(p => p.path === pick)
  const refresh = () => { sel.clear(); void qc.invalidateQueries({ queryKey: ['plan'] }) }
  return (
    <div className="st-col" style={{ gap: 10 }} data-field="plan-posts">
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="st-select" style={{ width: 'auto' }} value={day} onChange={e => setDay(e.target.value)} aria-label="Day"><option value="">Every day</option>{days.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}</select>
        <select className="st-select" style={{ width: 'auto' }} value={account} onChange={e => setAccount(e.target.value)} aria-label="Account"><option value="">Every account</option>{accounts.map(a => <option key={a} value={a}>{a}</option>)}</select>
        <SelectionCount sel={sel} />
        <ClearPlan posts={posts} ticked={ticked.map(p => p.id)} onCleared={() => { refresh(); void qc.invalidateQueries({ queryKey: keys.content }); toast({ tone: 'ok', text: 'Moved to Library > Trash. Restore them there within 7 days.' }) }} />
      </div>
      <div className="st-tablewrap">
        <table className="st-table st-planposts">
          <thead><tr><th><SelectAllBox sel={sel} label={`Pick the ${shown.length} posts shown`} disabled={!shown.length} /></th><th>Day</th><th>Account</th><th>Format</th><th>Hook</th><th>Pictures</th><th /></tr></thead>
          <tbody>
            {shown.slice(0, 200).map(p => (
              <tr key={p.id} data-field={`plan-post-${p.rowId}`}>
                <td><SelectBox sel={sel} id={p.id} label={`Pick ${p.rowId}`} /></td>
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
      {models.data && (
        <StillPaths field="plan-generate-path" paths={models.data.paths} value={pick} onPick={p => { setPath(p); void api.saveSlideStillPath(p).catch(() => undefined) }}
          models={on?.empty ? [{ who: 'Slides with no one', model: on.empty }] : []} />
      )}
      <PriceButton label={`Generate ${ids.length} post${ids.length === 1 ? '' : 's'}`} action={ids.length ? { type: 'plan_generate', postIds: ids.slice(0, 100), ...(pick ? { path: pick } : {}) } : null}
        todo={ids.length ? [] : [{ label: 'Tick the posts that need pictures' }]} onStarted={refresh}
        onDone={() => void qc.invalidateQueries({ queryKey: ['plan'] })} />
      {remake.length > 0 && (
        <div data-field="plan-remake">
          <PriceButton label={`Remake ${remakePictures} picture${remakePictures === 1 ? '' : 's'}`} action={{ type: 'plan_generate', postIds: remake.map(p => p.id).slice(0, 100), remake: true, ...(pick ? { path: pick } : {}) }}
            onStarted={refresh} onDone={() => void qc.invalidateQueries({ queryKey: ['plan'] })} />
          <span className="st-hint">{remake.length} ticked post{remake.length === 1 ? ' has' : 's have'} pictures: Remake makes every photo slide again, and the old pictures go to Library &gt; Trash (restorable for 7 days) when it starts.</span>
        </div>
      )}
      <span className="st-hint">A slideshow gets a still for every photo slide (drawn slides are free), a clip its opening still; its take is made in the post with its own price after you pick the still. A slide with a character in it, and a clip's opening still, use the stills model in that character's file, on the path picked above. More than 10 posts run ten at a time.{ids.length > 100 ? ' At most 100 in one go.' : ''}</span>
    </div>
  )
}

// Clear (owner, 2026-10-22): the plan's drafts to the Trash, restorable.
// All drafts in one import, only the ones with no pictures yet, or the
// ticked ones; one confirm that says how many have pictures you paid for.
function ClearPlan({ posts, ticked, onCleared }: { posts: PlanPostView[]; ticked: string[]; onCleared: () => void }) {
  const toast = useToast()
  const plans = useMemo(() => [...new Set(posts.map(p => p.planId))].sort().reverse(), [posts])
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'all' | 'empty' | 'ids'>('empty')
  const [planId, setPlanId] = useState('')
  const [count, setCount] = useState<{ posts: number; withPictures: number } | null>(null)
  const plan = planId || plans[0] || ''
  const args = { scope, planId: scope === 'ids' ? null : plan || null, ...(scope === 'ids' ? { ids: ticked } : {}) }
  useEffect(() => {
    if (!open) return
    if (scope === 'ids' && !ticked.length) { setCount({ posts: 0, withPictures: 0 }); return }
    let live = true
    api.planClear({ ...args, dryRun: true }).then(c => { if (live) setCount(c) }).catch(() => { if (live) setCount(null) })
    return () => { live = false }
  }, [open, scope, plan, ticked.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return <button type="button" className="st-btn sm ghost" onClick={() => { setOpen(true); if (ticked.length) setScope('ids') }}>Clear...</button>
  return (
    <div className="st-col st-callout" style={{ gap: 8, flexBasis: '100%' }} data-field="plan-clear" role="group" aria-label="Clear drafts">
      <b>Clear drafts to the Trash</b>
      <label className="st-row" style={{ gap: 6 }}><input type="radio" name="plan-clear" checked={scope === 'all'} onChange={() => setScope('all')} />All drafts in this import</label>
      <label className="st-row" style={{ gap: 6 }}><input type="radio" name="plan-clear" checked={scope === 'empty'} onChange={() => setScope('empty')} />Only drafts with no images</label>
      <label className="st-row" style={{ gap: 6 }}><input type="radio" name="plan-clear" checked={scope === 'ids'} onChange={() => setScope('ids')} />The ticked ones ({ticked.length})</label>
      {scope !== 'ids' && plans.length > 1 && (
        <select className="st-select" style={{ width: 'auto' }} value={plan} onChange={e => setPlanId(e.target.value)} aria-label="Which import">
          {plans.map(p => <option key={p} value={p}>{p.replace(/^plan-?/, 'Plan from ') || 'Plan'}</option>)}
        </select>
      )}
      <span className="st-hint" role="status" data-field="plan-clear-count">
        {count ? `${count.posts} post${count.posts === 1 ? '' : 's'} go to Library > Trash (restorable for 7 days).${count.withPictures ? ` ${count.withPictures} of these ${count.withPictures === 1 ? 'has' : 'have'} images you paid for.` : ''}` : 'Counting...'}
      </span>
      <div className="st-row" style={{ gap: 8 }}>
        <AsyncButton className="st-btn sm" disabled={!count?.posts} busyLabel="Clearing..." onClick={async () => {
          try { await api.planClear(args); setOpen(false); setCount(null); onCleared() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
        }}>Clear {count?.posts ?? ''} post{count?.posts === 1 ? '' : 's'}</AsyncButton>
        <button type="button" className="st-btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}
