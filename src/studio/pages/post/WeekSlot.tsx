import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { AsyncButton, errorMessage, useToast } from '../../ui'
import { rowKey } from '../../postRow'
import { HowTo } from '../../guide/Guide'
import { weekOf } from '../../../../server/core/weeks'
import type { PlanMeta } from '../../types'
import type { PostCtx } from './ctx'

// Add to a week (owner, 2026-10-23; UX-PLAN.md section 43, item 7): a New
// post and a Weeks row are the same record. Pick the account, the date and
// the slot; the post gets a row id and shows on that week's grid, where
// Fill, Check, Make, Review and Send to Drive treat it like any other row.

const tomorrow = () => { const d = new Date(Date.now() + 86_400_000); return d.toISOString().slice(0, 10) }

export function WeekSlot({ ctx }: { ctx: PostCtx }) {
  const { item, draft, data } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const plan = (draft.spec as { plan?: Partial<PlanMeta> }).plan ?? {}
  const inWeek = !!(plan.rowId && plan.date)
  const [open, setOpen] = useState(false)
  const accounts = useQuery({ queryKey: ['social-accounts'], queryFn: () => api.socialAccounts(), staleTime: 30_000, enabled: open })
  const tags = [...new Set([...(accounts.data?.accounts ?? []).filter(a => !a.characterId || a.characterId === item.characterId).map(a => a.tag), ...data.accountTags])]
  const [tag, setTag] = useState(item.accountTag)
  const [date, setDate] = useState(plan.date || tomorrow())
  const [slot, setSlot] = useState(Number(plan.slot) || 1)
  if (item.kind !== 'meme' && item.kind !== 'slideshow') return null
  const pick = tag || tags[0] || ''

  async function add() {
    try {
      await draft.flush()
      const r = await api.addToWeek(item.id, { accountTag: pick, date, slot })
      qc.setQueryData(rowKey(item.id), r.row)
      await qc.invalidateQueries({ queryKey: keys.content })
      void qc.invalidateQueries({ queryKey: ['week'] }); void qc.invalidateQueries({ queryKey: ['weeks'] })
      setOpen(false)
      toast({ tone: 'ok', text: `In the week of ${r.week} as row ${r.rowId}.${r.clash ? ` Row ${r.clash} is in that slot too.` : ''} Fill, Check, Make, Review and Send to Drive treat it like any row.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <div className="st-col" style={{ gap: 6 }} data-field="week-slot">
      <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <CalendarPlus size={14} />
        {inWeek ? (
          <>
            <span className="st-hint" data-field="week-slot-where">In the week of {weekOf(plan.date!)}: @{item.accountTag || 'no account'}, {plan.date} slot {plan.slot}, row {plan.rowId}</span>
            <Link className="st-btn xs ghost" to={`/studio/weeks?week=${weekOf(plan.date!)}`}>Open the week</Link>
            <button type="button" className="st-btn xs ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}>Move</button>
          </>
        ) : (
          <button type="button" className="st-btn xs secondary" onClick={() => setOpen(o => !o)} aria-expanded={open} data-field="week-slot-open">Add to a week</button>
        )}
        <HowTo id="line-first" label="How a week works" />
      </div>
      {open && (
        <div className="st-row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} data-field="week-slot-form">
          <label className="st-col" style={{ gap: 2 }}><span className="st-label" style={{ margin: 0 }}>Account</span>
            <input className="st-input sm" style={{ width: 180 }} list={`week-tags-${item.id}`} value={pick} onChange={e => setTag(e.target.value)} aria-label="Week account" />
            <datalist id={`week-tags-${item.id}`}>{tags.map(t => <option key={t} value={t} />)}</datalist>
          </label>
          <label className="st-col" style={{ gap: 2 }}><span className="st-label" style={{ margin: 0 }}>Date</span>
            <input className="st-input sm" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Week date" />
          </label>
          <label className="st-col" style={{ gap: 2 }}><span className="st-label" style={{ margin: 0 }}>Slot</span>
            <input className="st-input sm" type="number" min={1} max={24} style={{ width: 70 }} value={slot} onChange={e => setSlot(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} aria-label="Week slot" />
          </label>
          <AsyncButton className="st-btn sm primary" disabled={!pick.trim() || !date} field="week-slot-add" onClick={add}>{inWeek ? 'Move it' : 'Add to the week'}</AsyncButton>
          <span className="st-hint">Free. The post keeps its line, place, still, video and sound.</span>
        </div>
      )}
    </div>
  )
}
