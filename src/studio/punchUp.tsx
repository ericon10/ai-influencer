import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { PriceButton } from './PriceButton'
import { jobDone, useJobResult } from './pages/post/parts'
import { HowTo } from './guide/Guide'

// "Punch up" (owner, 2026-10-22; UX-PLAN.md section 35, item 14): a priced
// Claude call rewrites thin image lines to the density rule (a named
// camera, 3 to 5 objects, a background person or motion, mixed real light,
// mid-action). The answer shows before and after; nothing changes until
// Use these. On a post's Stills step and on the plan's import preview.

export interface PunchLine { id: string; text: string; label?: string }

export function PunchUp({ lines, contentId, onUse, field = 'punch-up' }: { lines: PunchLine[]; contentId?: string; onUse: (next: Record<string, string>) => void; field?: string }) {
  const [job, setJob] = useState<string | null>(null)
  const thin = lines.length
  return (
    <div className="st-col" style={{ gap: 8 }} data-field={field}>
      <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <PriceButton size="sm" variant="secondary" label={`Punch up ${thin} thin line${thin === 1 ? '' : 's'}`}
          action={thin ? (contentId ? { type: 'punch_up_lines', contentId } : { type: 'punch_up_lines', lines: lines.map(l => ({ id: l.id, text: l.text })) }) : null}
          todo={thin ? [] : [{ label: 'Every image line already names a camera, objects, a background and real light' }]}
          onStarted={ids => setJob(ids[0] ?? null)} />
        <span className="st-hint">Rewrites thin image lines: a named camera, 3 to 5 objects, one person or motion behind, mixed real light, mid-action. You see before and after first.</span>
        <HowTo id="launch-plan" label="About Punch up" />
      </div>
      {job && <PunchResult jobId={job} lines={lines} onUse={next => { onUse(next); setJob(null) }} onClose={() => setJob(null)} />}
    </div>
  )
}

function PunchResult({ jobId, lines, onUse, onClose }: { jobId: string; lines: PunchLine[]; onUse: (next: Record<string, string>) => void; onClose: () => void }) {
  const q = useJobResult(jobId)
  const status = q.data?.job.status
  const after = ((q.data?.result as { lines?: Array<{ id: string; text: string }> } | null)?.lines ?? []).filter(l => l.text?.trim())
  const [skip, setSkip] = useState<Set<string>>(new Set())
  if (!jobDone(status)) return <div className="st-row st-hint" style={{ gap: 8 }}><Loader2 size={14} className="st-spin" />Rewriting the thin lines...</div>
  if (status !== 'completed' || !after.length) {
    return <div className="st-price-error" role="alert"><span className="msg">{q.data?.job.error?.message ?? 'No lines came back.'} Press Punch up to try again; a failed run is not charged.</span><button className="st-btn sm ghost" onClick={onClose}>Close</button></div>
  }
  const byId = new Map(lines.map(l => [l.id, l]))
  const used = after.filter(l => byId.has(l.id) && !skip.has(l.id))
  return (
    <div className="st-card pad st-col" style={{ gap: 10 }} data-field="punch-up-result">
      <div className="st-row"><span className="st-label">Before and after</span><span className="st-spacer" /><button className="st-btn sm ghost" onClick={onClose}>Keep mine</button></div>
      {after.filter(l => byId.has(l.id)).map(l => (
        <label key={l.id} className="st-row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={!skip.has(l.id)} onChange={e => setSkip(s => { const n = new Set(s); if (e.target.checked) n.delete(l.id); else n.add(l.id); return n })} aria-label={`Use the new line for ${byId.get(l.id)!.label ?? l.id}`} />
          <span className="st-col" style={{ gap: 2, flex: 1 }}>
            <b className="st-hint">{byId.get(l.id)!.label ?? l.id}</b>
            <span className="st-muted" style={{ textDecoration: 'line-through' }}>{byId.get(l.id)!.text}</span>
            <span>{l.text}</span>
          </span>
        </label>
      ))}
      <button type="button" className="st-btn primary sm" style={{ alignSelf: 'flex-start' }} disabled={!used.length} onClick={() => onUse(Object.fromEntries(used.map(l => [l.id, l.text])))}><Check size={14} />Use {used.length === 1 ? 'this line' : `these ${used.length} lines`}</button>
    </div>
  )
}
