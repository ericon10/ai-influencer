import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Package } from 'lucide-react'
import { api, downloadUrl } from './api'
import { keys } from './hooks'
import { errorMessage, useToast } from './ui'
import { isApproved, postingDay, postingSlot, readPosting, shortWhen, type Posting } from '../../server/core/postingDay'
import type { ContentItem } from './types'

// Download day (owner, 2026-10-17; UX-PLAN.md section 33): a post's
// posting state. Approve for posting (on the post's card and in its Finish
// step) is what lets a post into a day's zip; Packed says it went into one
// (and downloads that zip again); the day and slot come from the plan, or
// the owner sets them in Finish.

export const DAY_KEY = ['posting-day'] as const
type Spec = { posting?: unknown; review?: string | null; plan?: { date?: string; slot?: string } | null; results?: { postedAt?: string } | null }
export const postingOf = (item: ContentItem): Posting => readPosting((item.spec as Spec).posting)
export const approvedOf = (item: ContentItem) => isApproved(postingOf(item), (item.spec as Spec).review)
export const dayOf = (item: ContentItem) => { const s = item.spec as Spec; return postingDay({ posting: postingOf(item), planDate: s.plan?.date, postedAt: s.results?.postedAt }) }
export const slotOf = (item: ContentItem) => postingSlot({ posting: postingOf(item), planSlot: (item.spec as Spec).plan?.slot })
// Batches are many videos in one post: not a day's post.
export const packable = (item: Pick<ContentItem, 'kind'>) => item.kind === 'meme' || item.kind === 'slideshow'
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return null } }
export const browserTz = tz
export const dayLabel = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function usePostingSlots() {
  return useQuery({ queryKey: ['posting-slots'], queryFn: () => api.postingSlots(), staleTime: 60_000 })
}

function useSetPosting(item: ContentItem) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function save(patch: { approved?: boolean; date?: string; slot?: string }) {
    setBusy(true)
    try {
      await api.setPosting(item.id, patch)
      await Promise.all([qc.invalidateQueries({ queryKey: keys.content }), qc.invalidateQueries({ queryKey: DAY_KEY })])
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  return { save, busy }
}

// The card's Approve for posting: one tap on, one tap off.
export function ApproveChip({ item }: { item: ContentItem }) {
  const { save, busy } = useSetPosting(item)
  if (!packable(item)) return null
  const on = approvedOf(item)
  return (
    <button type="button" className={`st-chip xs st-approve ${on ? 'on' : ''}`} aria-pressed={on} disabled={busy} onClick={() => void save({ approved: !on })} title={on ? 'Approved for posting: it goes into its day\'s Download day zip. Tap to take it back.' : 'Approve for posting: only approved posts go into Download day'} data-field="approve-chip">
      {busy ? <Loader2 size={11} className="st-spin" /> : on ? <Check size={11} strokeWidth={3} /> : null}{on ? 'Approved' : 'Approve for posting'}
    </button>
  )
}

// Packed: which Download day it went into, and that zip again.
export function PackedChip({ item }: { item: ContentItem }) {
  const p = postingOf(item).packed
  if (!p) return null
  const label = `Packed ${dayLabel(p.date)}`
  const title = `In the Download day zip for ${p.date}, made ${shortWhen(p.at, tz())}. Download it again.`
  return p.assetId
    ? <a className="st-chip xs st-packed" href={downloadUrl(p.assetId, `download-day-${p.date}.zip`)} title={title} data-field="packed-chip"><Package size={11} />{label}</a>
    : <span className="st-chip xs st-packed" title={title} data-field="packed-chip"><Package size={11} />{label}</span>
}

// The posting line on a card: the day and slot when it has one.
export function PostingChips({ item }: { item: ContentItem }) {
  if (!packable(item)) return null
  const day = dayOf(item), slot = slotOf(item)
  return (
    <div className="st-row" style={{ gap: 6 }} data-field="post-posting">
      <ApproveChip item={item} />
      <PackedChip item={item} />
      {day && <span className="st-hint">{dayLabel(day)}{slot ? ` ${slot}` : ''}</span>}
    </div>
  )
}

// The Finish step's Posting card: Approve for posting, the day and slot
// (the plan's unless changed here), and the zip it went into.
export function PostingCard({ item }: { item: ContentItem }) {
  const { save, busy } = useSetPosting(item)
  const slots = usePostingSlots().data?.slots ?? []
  if (!packable(item)) return null
  const posting = postingOf(item)
  const plan = (item.spec as Spec).plan
  const on = approvedOf(item)
  const day = dayOf(item), slot = slotOf(item)
  const slotNames = [...new Set([...slots.map(s => s.slot), ...(slot ? [slot] : [])])]
  return (
    <div className="st-col" style={{ gap: 12 }} data-field="post-posting-finish">
      <label className="st-row" style={{ gap: 10, cursor: 'pointer', alignItems: 'center' }}>
        <button type="button" role="switch" aria-checked={on} aria-label="Approve for posting" className={`st-switch ${on ? 'on' : ''}`} disabled={busy} onClick={() => void save({ approved: !on })}><span /></button>
        <span className="st-col" style={{ gap: 2 }}>
          <b>Approve for posting</b>
          <span className="st-hint">{on ? `Approved${posting.approvedAt ? ` ${shortWhen(posting.approvedAt, tz())}` : ''}: it goes into its day's Download day zip (exported first if it has no export yet, free).` : 'Only approved posts go into Download day.'}</span>
        </span>
      </label>
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="st-label">Post on</span>
        <input className="st-input sm" style={{ width: 'auto' }} type="date" value={day} onChange={e => void save({ date: e.target.value })} aria-label="Post on" />
        <select className="st-select" style={{ width: 'auto' }} value={slot} onChange={e => void save({ slot: e.target.value })} aria-label="Slot">
          <option value="">Any time</option>
          {slotNames.map(s => <option key={s} value={s}>{s}{slots.find(x => x.slot === s) ? ` (${slots.find(x => x.slot === s)!.time})` : ''}</option>)}
        </select>
        {(posting.date || posting.slot) && plan?.date && <button type="button" className="st-btn xs ghost" onClick={() => void save({ date: '', slot: '' })}>Back to the plan's ({dayLabel(plan.date)}{plan.slot ? ` ${plan.slot}` : ''})</button>}
        {!posting.date && plan?.date && <span className="st-hint">From the plan.</span>}
      </div>
      <div className="st-row" style={{ gap: 8 }}>
        <PackedChip item={item} />
        {day && <Link className="st-btn xs ghost" to={`/studio?day=${day}`}><Package size={12} />Download day for {dayLabel(day)}</Link>}
      </div>
    </div>
  )
}
