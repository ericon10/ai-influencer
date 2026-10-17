import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronDown, ChevronRight, ExternalLink, Upload } from 'lucide-react'
import { api } from '../api'
import { keys, useActiveJobs } from '../hooks'
import { PriceButton } from '../PriceButton'
import { AsyncButton, Todo, errorMessage, useToast, type TodoItem } from '../ui'
import { useProductList } from '../products'
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
            <div className="st-hint">{posts.length ? `${posts.length} posts from the plan · ${have} with their pictures · ${exported} exported` : 'Import the plan\'s CSV: the rows you tick become drafts with their words as written. Free; nothing paid runs.'}</div>
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
  const products = useProductList()
  const [show, setShow] = useState(!hasPosts)
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [paste, setPaste] = useState(false)
  const [draw, setDraw] = useState(false)
  const [store, setStore] = useState<Record<string, string>>({})
  const [model, setModel] = useState<string | null>(null)
  // The plan's product (section 29): '' not picked yet, 'none' No product.
  const [product, setProduct] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [day, setDay] = useState('')
  const [account, setAccount] = useState('')
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [done, setDone] = useState<PlanImportResult | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const productArg = (p: string) => (p === 'none' ? null : p || undefined)
  async function load(f: File | undefined) {
    if (!f) return
    if (f.size > 400_000) { toast({ tone: 'bad', text: `${f.name} is over 400 KB. Split it.` }); return }
    setCsv(await f.text()); setName(f.name); setPaste(false); setPreview(null); setDone(null); setPicked(new Set())
  }
  async function check(o: { draw?: boolean; store?: Record<string, string>; model?: string | null; product?: string } = {}) {
    try {
      const p = o.product ?? product
      const next = await api.planPreview(csv, { drawSpecials: o.draw ?? draw, store: o.store ?? store, stillModel: o.model ?? model, productId: productArg(p) })
      setPreview(next)
      // The product the plan's accounts agree on pre-fills the pick.
      if (!p && next.suggestedProductId) { setProduct(next.suggestedProductId); void check({ ...o, product: next.suggestedProductId }) }
      setDone(null)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  if (!show) return <button type="button" className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShow(true)}><Upload size={13} />Import plan rows again</button>
  const lines = csv.split('\n').filter(l => l.trim()).length
  const rows = preview?.rows ?? []
  const good = rows.filter(r => r.state === 'new' || r.state === 'update')
  const shown = good.filter(r => (!day || r.date === day) && (!account || r.account === account))
  const ticked = good.filter(r => picked.has(r.rowId))
  const stills = ticked.reduce((a, r) => a + r.photos, 0)
  const usdTicked = ticked.reduce((a, r) => a + r.priceUsd, 0)
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // The plan's pick fills only the rows that name no product of their own.
  const needsPick = ticked.some(r => r.productFrom === 'plan')
  const todo: TodoItem[] = [
    ...(!product && needsPick ? [{ label: 'Pick the plan\'s product (or No product) for the rows that name none', target: 'plan-product' }] : []),
    ...(!ticked.length ? [{ label: 'Tick the rows to import', target: 'plan-rows' }] : []),
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
            <button type="button" role="switch" aria-checked={draw} className={`st-switch ${draw ? 'on' : ''}`} onClick={() => { setDraw(!draw); if (preview) void check({ draw: !draw }) }}><span /></button>
            <span className="st-hint">Draw mock screens by code: a slide whose scene describes a phone screen, an email, a placard or a form is drawn by the Studio (free, the exact words). Off: every slide is a photo made from its scene.</span>
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
          <span className="st-hint">A topic account's pictures are filed under a character only for storage: nothing of that character (face, voice, name) goes into its posts.</span>

          <div className="st-col" style={{ gap: 8 }} data-field="plan-rows">
            <span className="st-label">Tick the rows to import</span>
            <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="st-select" style={{ width: 'auto' }} value={day} onChange={e => setDay(e.target.value)} aria-label="Day"><option value="">Every day</option>{preview.days.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}</select>
              <select className="st-select" style={{ width: 'auto' }} value={account} onChange={e => setAccount(e.target.value)} aria-label="Account"><option value="">Every account</option>{preview.accounts.map(a => <option key={a.tag} value={a.tag}>{a.tag}</option>)}</select>
              <button type="button" className="st-btn sm ghost" disabled={!shown.length} onClick={() => setPicked(s => new Set([...s, ...shown.map(r => r.rowId)]))}>Tick the {shown.length} shown</button>
              <button type="button" className="st-btn sm ghost" disabled={!good.length} onClick={() => setPicked(new Set(good.map(r => r.rowId)))}>Tick all {good.length}</button>
              {picked.size > 0 && <button type="button" className="st-btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>}
              <span className="st-hint">{ticked.length} ticked</span>
            </div>
            <div className="st-tablewrap" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="st-table">
                <thead><tr><th aria-label="Tick" /><th>Row</th><th>Day</th><th>Account</th><th>Format</th><th>Product</th><th>Hook</th><th>Notes</th></tr></thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.line} data-field={`plan-row-${r.rowId}`}>
                      <td><input type="checkbox" checked={picked.has(r.rowId)} onChange={() => toggle(r.rowId)} aria-label={`Import ${r.rowId}`} /></td>
                      <td>{r.rowId}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dayLabel(r.date)} {r.slot}</td>
                      <td>{r.account}</td>
                      <td>{short(r.format)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.productFrom === 'row' ? r.product : r.product ? <span className="st-muted">{r.product} (plan)</span> : <span className="st-muted">{product ? 'None' : 'The plan\'s pick'}</span>}{r.ad ? <span className="st-chip xs" style={{ marginLeft: 6 }}>Ad</span> : null}</td>
                      <td style={{ maxWidth: 380 }}><span className="st-clamp1" title={r.hook}>{r.hook}</span></td>
                      <td>{r.state === 'update' ? <span className="st-hint">A draft exists (updated)</span> : null}{[...r.warnings, ...r.lint].length ? <span className="st-lint compact" title={[...r.warnings, ...r.lint].join('\n')}>{[...r.warnings, ...r.lint].length} note{[...r.warnings, ...r.lint].length === 1 ? '' : 's'}</span> : null}</td>
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
          {preview.totals.kept > 0 && <span className="st-hint">{preview.totals.kept} row{preview.totals.kept === 1 ? ' is' : 's are'} already made with pictures and stay as they are.</span>}
          <details>
            <summary className="st-hint" style={{ cursor: 'pointer' }}>The plan by day and account</summary>
            <PlanGrid preview={preview} />
          </details>
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-field="plan-still-model">
            <span className="st-hint">Stills:</span>
            {preview.still.choices.map(c => (
              <button key={c.ref} type="button" className={`st-chip ${preview.still.model === c.ref ? 'on' : ''}`} disabled={!!c.problem} title={c.problem ?? c.pathLabel} onClick={() => { setModel(c.ref); void check({ model: c.ref }) }}>{c.label} · {c.pathLabel}</button>
            ))}
          </div>
          <span className="st-hint" role="status" data-field="plan-totals">
            <b>{ticked.length} of {good.length} rows ticked</b>. Generating their pictures later: {stills} stills, about {usd(usdTicked)} ({preview.still.label}, {usd(preview.still.perStillUsd)} a still). Importing is free; each Generate shows its price first.
          </span>
          <div className="st-col" style={{ gap: 6, alignItems: 'flex-start' }} data-field="plan-step-4">
            <span className="st-label">4 · Import</span>
            <AsyncButton className="st-btn" disabled={todo.length > 0} title={todo.length ? todo.map(t => t.label).join('; ') : undefined} busyLabel={`Importing ${ticked.length} rows...`} onClick={async () => {
              try {
                const r = await api.planImport(csv, { drawSpecials: draw, store, productId: productArg(product), rows: ticked.map(x => x.rowId) })
                setDone(r)
                setPicked(new Set())
                onImported()
                await qc.invalidateQueries({ queryKey: keys.content })
                toast({ tone: 'ok', text: `${r.created} drafts made${r.updated ? `, ${r.updated} updated` : ''}.` })
              } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
            }}>Import {ticked.length || ''} row{ticked.length === 1 ? '' : 's'} (free)</AsyncButton>
            <Todo items={todo} />
          </div>
        </div>
      )}
      {done && <span className="st-hint" role="status" data-field="plan-done">{done.created} drafts made, {done.updated} updated{done.kept ? `, ${done.kept} kept (they have pictures)` : ''}{done.skipped ? `, ${done.skipped} skipped` : ''}. They are in the list below and on Posts home: tick them there and generate, or open any post.</span>}
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
        <select className="st-select" style={{ width: 'auto' }} value={day} onChange={e => setDay(e.target.value)} aria-label="Day"><option value="">Every day</option>{days.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}</select>
        <select className="st-select" style={{ width: 'auto' }} value={account} onChange={e => setAccount(e.target.value)} aria-label="Account"><option value="">Every account</option>{accounts.map(a => <option key={a} value={a}>{a}</option>)}</select>
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

