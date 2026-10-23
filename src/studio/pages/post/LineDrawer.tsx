import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Library, PenLine, Search, X } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { AsyncButton, Callout, errorMessage, useToast } from '../../ui'
import { rowKey } from '../../postRow'
import { HowTo } from '../../guide/Guide'
import type { LinePick, LinePicks, PostRowView } from '../../types'
import type { PostCtx } from './ctx'

// The Line step (owner, 2026-10-23; UX-PLAN.md sections 43 and 45): step 1
// of every post, the same record a Weeks row has. A slot one row tall: the
// 3 best-fit lines for this character and product with Use, Browse all N,
// Write my own and No line; a picked line shows with its tags and Change.
// Browse (and Change) opens the line picker, a centered sheet: search,
// filter chips, compact rows, unused first then by likes. Only lines tagged
// for the post's product and in the character's voice ever show; an empty
// bank says so, never filling in with another product's lines.

const short = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

export function lineSummary(r: PostRowView | undefined): string {
  if (!r) return 'Pick a line, write your own, or No line'
  if (r.line.text) return `"${r.line.text.slice(0, 70)}"${[r.line.pain, r.line.emotion].filter(Boolean).length ? ` · ${[r.line.pain, r.line.emotion].filter(Boolean).join(', ')}` : ''}`
  return r.line.mode === 'none' ? 'No line: a visual post' : 'Pick a line, write your own, or No line'
}

export function usePostRow(postId: string) {
  return useQuery({ queryKey: rowKey(postId), queryFn: () => api.postRow(postId), staleTime: 5_000 })
}

type Filters = { pain: string; emotion: string; format: string; lifeOrJob: string; q: string }
const NONE: Filters = { pain: '', emotion: '', format: '', lifeOrJob: '', q: '' }

// Who the lines are for, in words: "Callie and SideStep", "Doug and no product".
const forWhom = (p: LinePicks | undefined) => `${p?.characterName || 'this character'} and ${p?.product ? p.product.name : 'no product'}`

function useSetLine(ctx: PostCtx, onDone?: () => void) {
  const qc = useQueryClient()
  const toast = useToast()
  return async (body: { lineId?: string | null; text?: string | null; none?: boolean }, said: string) => {
    try {
      await ctx.draft.flush()
      const next = await api.setPostLine(ctx.item.id, body)
      qc.setQueryData(rowKey(ctx.item.id), next)
      await qc.invalidateQueries({ queryKey: keys.content })
      void qc.invalidateQueries({ queryKey: ['line-picks', ctx.item.id] })
      void qc.invalidateQueries({ queryKey: ['post-places', ctx.item.id] })
      void qc.invalidateQueries({ queryKey: ['line-bank'] })
      toast({ tone: 'ok', text: said })
      onDone?.()
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
}

// The slot: one row. onPicked moves the post on (the next drawer or step).
export function LineSlot({ ctx, onPicked }: { ctx: PostCtx; onPicked?: () => void }) {
  const { item } = ctx
  const row = usePostRow(item.id)
  const r = row.data
  const picks = useQuery({ queryKey: ['line-picks', item.id, NONE], queryFn: () => api.linePicks(item.id, NONE), staleTime: 10_000 })
  const p = picks.data
  const [sheet, setSheet] = useState(false)
  const [own, setOwn] = useState<string | null>(null)
  const put = useSetLine(ctx, onPicked)
  const picked = !!r && (r.line.mode === 'bank' || r.line.mode === 'own' || r.line.mode === 'none')

  return (
    <div className="st-col" style={{ gap: 8 }} data-field="line-slot">
      {picked && r ? (
        <div className="st-lineslot" data-field="line-current">
          {r.line.text
            ? <span className="st-lineslot-pick" style={{ borderColor: 'var(--st-accent)' }}><span className="t" title={r.line.text}>{r.line.text}</span>{r.line.mode === 'own' && <span className="st-hint">your words</span>}</span>
            : <span className="st-hint">No line: a visual post.</span>}
          <span className="st-linerow-tags">{[r.line.pain && `pain: ${r.line.pain}`, r.line.emotion, r.line.format].filter(Boolean).map(t => <span key={t as string}>{t}</span>)}</span>
          <button type="button" className="st-btn xs ghost" onClick={() => setSheet(true)} data-field="line-change">Change</button>
          <HowTo id="line-first" label="Line first" />
        </div>
      ) : (
        <>
          <div className="st-lineslot" data-field="line-best">
            {p?.best.map(l => (
              <span key={l.id} className="st-lineslot-pick" data-field="line-best-item" data-id={l.id}>
                <span className="t" title={l.text}>{l.text}</span>
                <AsyncButton className="st-btn xs primary" onClick={() => put({ lineId: l.id }, 'The line is on this post.')}>Use</AsyncButton>
              </span>
            ))}
            {p && p.total > 0 && <button type="button" className="st-btn xs secondary" onClick={() => setSheet(true)} data-field="line-browse">Browse all {p.total}</button>}
            {p && p.total === 0 && <span className="st-hint" data-field="line-empty">No lines for {forWhom(p)} yet.</span>}
            <button type="button" className="st-btn xs ghost" onClick={() => setOwn(own === null ? '' : null)} aria-expanded={own !== null}><PenLine size={12} />Write my own</button>
            <AsyncButton className="st-btn xs ghost" field="line-none" onClick={() => put({ none: true }, 'No line: a visual post.')}><Ban size={12} />No line</AsyncButton>
          </div>
          {picks.isLoading && <span className="st-hint">Reading the line bank...</span>}
          {picks.error && <Callout tone="bad">{errorMessage(picks.error)}</Callout>}
        </>
      )}
      {own !== null && <OwnLine value={own} onChange={setOwn} onUse={async () => { await put({ text: own }, 'Your line is on this post.'); setOwn(null) }} />}
      {sheet && <LineSheet ctx={ctx} onClose={() => setSheet(false)} onPicked={() => { setSheet(false); onPicked?.() }} />}
    </div>
  )
}

function OwnLine({ value, onChange, onUse }: { value: string; onChange: (v: string) => void; onUse: () => Promise<void> }) {
  return (
    <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="st-input sm" style={{ flex: '1 1 260px', minWidth: 0 }} value={value} maxLength={300} onChange={e => onChange(e.target.value)} placeholder="the line, 12 words or fewer, the hit first" aria-label="Your own line" />
      <AsyncButton className="st-btn sm primary" disabled={!value.trim()} field="line-own-use" onClick={onUse}>Use my line</AsyncButton>
    </div>
  )
}

// The line picker: a centered sheet (full height on a phone).
export function LineSheet({ ctx, onClose, onPicked }: { ctx: PostCtx; onClose: () => void; onPicked: () => void }) {
  const { item } = ctx
  const [f, setF] = useState<Filters>(NONE)
  const [typed, setTyped] = useState('')
  useEffect(() => { const t = setTimeout(() => setF(x => ({ ...x, q: typed.trim() })), 250); return () => clearTimeout(t) }, [typed])
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on) }, [onClose])
  const picks = useQuery({ queryKey: ['line-picks', item.id, f], queryFn: () => api.linePicks(item.id, f), staleTime: 10_000 })
  const p = picks.data
  const [open, setOpen] = useState<string | null>(null)
  const [own, setOwn] = useState<string | null>(null)
  const put = useSetLine(ctx, onPicked)
  const chips = (k: keyof Filters, label: string, list: string[]) => (
    <div className="st-chiprow" role="radiogroup" aria-label={label} data-field={`line-filter-${k}`}>
      <span className="st-label" style={{ margin: 0, flex: 'none' }}>{label}</span>
      <button type="button" role="radio" aria-checked={!f[k]} className={`st-chip ${!f[k] ? 'on' : ''}`} onClick={() => setF({ ...f, [k]: '' })}>Any</button>
      {list.map(x => <button key={x} type="button" role="radio" aria-checked={f[k] === x} className={`st-chip ${f[k] === x ? 'on' : ''}`} onClick={() => setF({ ...f, [k]: f[k] === x ? '' : x })}>{x}</button>)}
    </div>
  )
  return createPortal(
    <div className="st-root" style={{ minHeight: 0, background: 'transparent' }}>
      <div className="st-overlay" onClick={onClose} />
      <div className="st-modal st-linesheet" role="dialog" aria-modal="true" aria-label="Pick the line" data-field="line-sheet">
        <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
          <div className="st-titlerow grow"><div className="st-h2" style={{ margin: 0 }}>Pick the line</div><HowTo id="line-first" label="How lines are picked" /></div>
          <button type="button" className="st-btn icon ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <span className="st-hint" data-field="line-sheet-scope">Lines for {forWhom(p)}: tagged for {p?.product ? p.product.name : 'no product'}, told {p?.stance === 'first' ? 'in the first person' : 'secondhand'}. Unused first, then by likes.</span>
        <label className="st-row" style={{ gap: 6, alignItems: 'center' }}>
          <Search size={14} />
          <input className="st-input sm" style={{ flex: 1, minWidth: 0 }} value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search the lines and their comments" aria-label="Search lines" autoFocus />
        </label>
        {p && (
          <div className="st-col" style={{ gap: 4 }}>
            {p.options.pains.length > 0 && chips('pain', 'Pain', p.options.pains)}
            {chips('emotion', 'Emotion', p.options.emotions)}
            {chips('format', 'Format', p.options.formats)}
            {chips('lifeOrJob', 'Life or job', ['life', 'job'])}
          </div>
        )}
        {p && <span className="st-hint" data-field="line-sheet-count">{p.total} line{p.total === 1 ? '' : 's'}, {p.unused} unused{p.hidden ? `; ${p.hidden} used on other accounts left out` : ''}.</span>}
        {picks.error && <Callout tone="bad">{errorMessage(picks.error)}</Callout>}
        {p && !p.total && (
          <div className="st-col" style={{ gap: 8 }} data-field="line-sheet-empty">
            <Callout tone="info">{f.q || f.pain || f.emotion || f.format || f.lifeOrJob ? 'No line matches these filters.' : `No lines for ${forWhom(p)} yet.`}</Callout>
          </div>
        )}
        <div className="st-linerows" data-field="line-rows">
          {p?.lines.map(l => <LineRow key={l.id} l={l} current={p.current === l.id} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} onUse={() => put({ lineId: l.id }, 'The line is on this post.')} />)}
        </div>
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="st-btn xs ghost" onClick={() => setOwn(own === null ? '' : null)} aria-expanded={own !== null}><PenLine size={12} />Write my own</button>
          <AsyncButton className="st-btn xs ghost" onClick={() => put({ none: true }, 'No line: a visual post.')}><Ban size={12} />No line</AsyncButton>
          <a className="st-btn xs ghost" href="/studio/line-bank"><Library size={12} />The line bank</a>
        </div>
        {own !== null && <OwnLine value={own} onChange={setOwn} onUse={() => put({ text: own }, 'Your line is on this post.')} />}
      </div>
    </div>,
    document.body,
  )
}

function LineRow({ l, current, open, onToggle, onUse }: { l: LinePick; current: boolean; open: boolean; onToggle: () => void; onUse: () => Promise<void> }) {
  return (
    <div className="st-linerow" data-field="line-row" data-id={l.id}>
      <div className="st-linerow-main">
        <button type="button" className="st-linerow-text" onClick={onToggle} aria-expanded={open} title="Show the source">{l.text}</button>
        {current ? <span className="st-badge accent">On this post</span> : <AsyncButton className="st-btn xs primary" onClick={onUse}>Use</AsyncButton>}
      </div>
      <div className="st-linerow-tags">
        {[l.pain && `pain: ${l.pain}`, l.emotion, l.format, l.lifeOrJob, l.used ? (l.used.here ? 'this post' : `used @${l.used.account}`) : 'unused', l.likes ? `${short(l.likes)} likes` : ''].filter(Boolean).map(t => <span key={t as string}>{t}</span>)}
      </div>
      {open && <span className="st-hint" data-field="line-row-source">Source: {l.source || 'unknown'}{l.likes ? `, ${short(l.likes)} likes` : ''}{l.comment ? `: "${l.comment.slice(0, 280)}"` : ''}</span>}
    </div>
  )
}

export function LineFacts({ pain, emotion, format, lifeOrJob, source, likes, comment }: { pain: string; emotion: string; format: string; lifeOrJob: string | null; source: string; likes: number; comment: string }) {
  return (
    <>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} data-field="line-facts">
        {pain && <span className="st-badge plain">pain: {pain}</span>}
        {emotion && <span className="st-badge plain">{emotion}</span>}
        {format && <span className="st-badge plain">{format}</span>}
        {lifeOrJob && <span className="st-badge plain">{lifeOrJob}</span>}
      </div>
      {source && <span className="st-hint">Source: {source}{likes ? `, ${short(likes)} likes` : ''}{comment ? `: "${comment.slice(0, 180)}"` : ''}</span>}
    </>
  )
}
