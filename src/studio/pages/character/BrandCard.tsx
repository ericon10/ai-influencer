import { useEffect, useState } from 'react'
import { Check, CircleAlert, Megaphone, Plus } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { Field, errorMessage, useToast } from '../../ui'
import type { BrandLayer, CharacterView, TemplateReport } from '../../types'
import { HowTo } from '../../guide/Guide'

// Character template v1.6 (UX-PLAN.md section 24): the file checked against
// the template, and the brand layer, editable in place and written back
// into the file's own sections (Brand, Why people watch, Accounts, Winning
// stack, Growth log).

export function TemplateCheckList({ report }: { report: TemplateReport }) {
  const left = report.needed.filter(n => !n.ok).length
  return (
    <div className="st-col" style={{ gap: 8 }} data-field="template-check">
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="st-label">Character template v{report.version}</span>
        <span className={`st-badge plain ${left ? 'warn' : 'ok'}`} data-field="template-summary">{left ? `${left} to add` : 'Everything the template needs'}</span>
      </div>
      <ul className="st-checklist">
        {report.needed.map(n => (
          <li key={n.id} className={n.ok ? 'ok' : 'missing'} data-item={n.id}>
            {n.ok ? <Check size={14} /> : <CircleAlert size={14} />}
            <span><b>{n.label}</b> <span className="st-hint">{n.detail}</span></span>
          </li>
        ))}
      </ul>
      {report.missingOptional.length > 0 && <span className="st-hint" data-field="template-optional">Optional, not in the file yet: {report.missingOptional.join(', ')}. Never needed to import.</span>}
      {report.brackets.length > 0 && <span className="st-hint" data-field="template-brackets">Still holding [brackets] to fill: {report.brackets.join(', ')}.</span>}
    </div>
  )
}

type Text = 'interest' | 'subInterest' | 'arc' | 'statement' | 'payoff' | 'howTheyFilm' | 'accounts'
type List = 'series' | 'runningBits' | 'cast' | 'winningStack'

const month = () => new Date().toISOString().slice(0, 7)

export function BrandCard({ v }: { v: CharacterView }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [b, setB] = useState<BrandLayer>(v.brand)
  const [entry, setEntry] = useState('')
  useEffect(() => { setB(v.brand) }, [v.brand])
  const empty = !b.statement && !b.series.length && !b.winningStack.length && !b.growthLog.length

  async function save(patch: Partial<BrandLayer>) {
    try {
      const r = await api.updateBrand(v.id, patch)
      setB(r.brand)
      refresh(v.id)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const text = (k: Text, label: string, o: { rows?: number; placeholder?: string; hint?: string } = {}) => (
    <Field id={`brand-${k}`} label={label} hint={o.hint}>
      {o.rows ? (
        <textarea className="st-textarea" rows={o.rows} style={{ minHeight: 0 }} value={b[k]} placeholder={o.placeholder} onChange={e => setB({ ...b, [k]: e.target.value })} onBlur={() => b[k] !== v.brand[k] && void save({ [k]: b[k] })} />
      ) : (
        <input className="st-input" value={b[k]} placeholder={o.placeholder} onChange={e => setB({ ...b, [k]: e.target.value })} onBlur={() => b[k] !== v.brand[k] && void save({ [k]: b[k] })} />
      )}
    </Field>
  )
  // A list edited as one line, "a; b; c" (the file writes it that way).
  const [lists, setLists] = useState<Record<List, string>>(() => ({ series: v.brand.series.join('; '), runningBits: v.brand.runningBits.join('; '), cast: v.brand.cast.join('; '), winningStack: v.brand.winningStack.join('\n') }))
  useEffect(() => { setLists({ series: v.brand.series.join('; '), runningBits: v.brand.runningBits.join('; '), cast: v.brand.cast.join('; '), winningStack: v.brand.winningStack.join('\n') }) }, [v.brand])
  const split = (k: List, s: string) => s.split(k === 'winningStack' ? /\n+/ : /\s*;\s*/).map(x => x.trim()).filter(Boolean)
  const list = (k: List, label: string, o: { placeholder?: string; hint?: string; rows?: number } = {}) => (
    <Field id={`brand-${k}`} label={label} hint={o.hint}>
      {o.rows ? (
        <textarea className="st-textarea" rows={o.rows} style={{ minHeight: 0 }} value={lists[k]} placeholder={o.placeholder} onChange={e => setLists({ ...lists, [k]: e.target.value })} onBlur={() => { const next = split(k, lists[k]); if (next.join('|') !== v.brand[k].join('|')) void save({ [k]: next }) }} />
      ) : (
        <input className="st-input" value={lists[k]} placeholder={o.placeholder} onChange={e => setLists({ ...lists, [k]: e.target.value })} onBlur={() => { const next = split(k, lists[k]); if (next.join('|') !== v.brand[k].join('|')) void save({ [k]: next }) }} />
      )}
    </Field>
  )

  return (
    <section className="st-card" data-field="brand-card">
      <div className="st-card-head">
        <Megaphone size={16} />
        <div className="grow">
          <div className="st-h2 st-row" style={{ gap: 10 }}>Brand<HowTo id="setup-file" /></div>
          <div className="st-hint">Who {v.data.name} is to the people who follow. Entertaining first, then trusted, then monetized. Saved into the character file as you leave a field; the previous version is in history.</div>
        </div>
      </div>
      <div className="st-card-body st-col" style={{ gap: 16 }}>
        {empty && <span className="st-hint" data-field="brand-empty">Not in the character file yet. Fill it in here, or import a file made with character template v1.6.</span>}
        <div className="st-form">
          <div className="wide">{text('statement', 'Brand statement', { placeholder: `e.g. ${v.data.name}, the slow trail runner who shows the real side of getting outside on a budget`, hint: 'Who they are and their interest, one line. Punch it up checks its moments against it.' })}</div>
          {text('interest', 'Interest', { placeholder: 'e.g. Trail running and cheap weekend trips' })}
          {text('subInterest', 'Sub-interest (optional)', { placeholder: 'e.g. The slowest runner in every race' })}
          <div className="wide">{text('arc', 'Arc', { placeholder: 'e.g. Training for her first trail half marathon', hint: 'The storyline people follow.' })}</div>
          <div className="wide">{list('series', 'Series', { placeholder: 'e.g. Slow Mile Monday; Trip under $100; Gear I regret', hint: '2 to 3 recurring formats, separated by ;' })}</div>
          {list('runningBits', 'Running bits', { placeholder: 'e.g. Rates every trail out of ten muddy socks', hint: 'Separated by ;' })}
          {list('cast', 'Cast', { placeholder: 'e.g. Jules the roommate; her dad on the phone', hint: 'Separated by ;' })}
          {text('payoff', 'Payoff style', { placeholder: 'e.g. The mishap lands in the first second' })}
          {text('howTheyFilm', 'How they film', { placeholder: 'e.g. Phone at chest height, fast cuts' })}
          <div className="wide">{text('accounts', 'Accounts', { rows: 4, placeholder: '- Main: @handle, TikTok and Instagram\n- Bio: in their voice\n- Link note: a reason to click', hint: 'As in the file: main account, interest account, bio, link note.' })}</div>
          <div className="wide">{list('winningStack', 'Winning stack', { rows: 3, placeholder: 'One per line, e.g. The mishap in the first second', hint: 'From the last growth review. Every post carries it for the next 30 days: the prompt writer, the planner and Punch it up get it.' })}</div>
        </div>
        <div className="st-col" style={{ gap: 8 }} data-field="brand-growth">
          <span className="st-label">Growth log</span>
          {b.growthLog.length === 0 && <span className="st-hint">No reviews yet. Once a month: the top 5 reels by follows, what they share, the new winning stack.</span>}
          {[...b.growthLog].reverse().map((g, i) => <div key={i} className="st-growth">{g}</div>)}
          <div className="st-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <input className="st-input grow" value={entry} placeholder={`${month()}: top 5 shared ...; bottom 5 lacked ...; stack ...; retired ...; testing ...; brand check fits`} onChange={e => setEntry(e.target.value)} aria-label="This month's entry" />
            <button type="button" className="st-btn sm" disabled={entry.trim().length < 3} onClick={() => { const line = /^\d{4}-\d{2}/.test(entry.trim()) ? entry.trim() : `${month()}: ${entry.trim()}`; setEntry(''); void save({ growthLog: [...b.growthLog, line] }) }}><Plus size={13} />Add this month's entry</button>
          </div>
        </div>
      </div>
    </section>
  )
}
