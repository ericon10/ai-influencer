import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, Library, PenLine } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { AsyncButton, Callout, errorMessage, useToast } from '../../ui'
import { rowKey } from '../../postRow'
import { HowTo } from '../../guide/Guide'
import type { LinePick, PostRowView } from '../../types'
import type { PostCtx } from './ctx'

// The Line drawer (owner, 2026-10-23; UX-PLAN.md section 43, item 2): the
// first step of a New post, the same record a Weeks row has. Pick from the
// bank (filters, unused lines first, only lines that fit this character's
// voice, none used on another account), write your own, or No line for a
// pure visual post. The picked line shows its pain, emotion and source.
// The place, the video and the text are filled from it in the drawers
// after it.

const short = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))
type Mode = 'bank' | 'own' | 'none'

export function lineSummary(r: PostRowView | undefined): string {
  if (!r) return 'Pick a line, write your own, or No line'
  if (r.line.text) return `"${r.line.text.slice(0, 70)}"${[r.line.pain, r.line.emotion].filter(Boolean).length ? ` · ${[r.line.pain, r.line.emotion].filter(Boolean).join(', ')}` : ''}`
  return r.line.mode === 'none' ? 'No line: a visual post' : 'Pick a line, write your own, or No line'
}

export function usePostRow(postId: string) {
  return useQuery({ queryKey: rowKey(postId), queryFn: () => api.postRow(postId), staleTime: 5_000 })
}

export function LinePanel({ ctx, onPicked }: { ctx: PostCtx; onPicked?: () => void }) {
  const { item, draft } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const row = usePostRow(item.id)
  const r = row.data
  const [mode, setMode] = useState<Mode>(r?.line.mode === 'own' ? 'own' : r?.line.mode === 'none' ? 'none' : 'bank')
  const [f, setF] = useState({ pain: '', emotion: '', format: '', lifeOrJob: '' })
  const picks = useQuery({ queryKey: ['line-picks', item.id, f], queryFn: () => api.linePicks(item.id, f), enabled: mode === 'bank', staleTime: 10_000 })
  const [own, setOwn] = useState(r?.line.mode === 'own' ? r.line.text : '')

  async function put(body: { lineId?: string | null; text?: string | null; none?: boolean }, said: string) {
    try {
      await draft.flush()
      const next = await api.setPostLine(item.id, body)
      qc.setQueryData(rowKey(item.id), next)
      await qc.invalidateQueries({ queryKey: keys.content })
      void qc.invalidateQueries({ queryKey: ['line-picks', item.id] })
      void qc.invalidateQueries({ queryKey: ['post-places', item.id] })
      void qc.invalidateQueries({ queryKey: ['line-bank'] })
      toast({ tone: 'ok', text: said })
      onPicked?.()
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const p = picks.data
  const select = (k: keyof typeof f, label: string, list: string[]) => (
    <select className="st-input sm" style={{ width: 'auto', maxWidth: '100%' }} aria-label={label} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })}>
      <option value="">Any {label.toLowerCase()}</option>
      {list.map(x => <option key={x} value={x}>{x}</option>)}
    </select>
  )

  return (
    <div className="st-col" style={{ gap: 12 }} data-field="line-panel">
      {r?.line.text && (
        <div className="st-linepick on" data-field="line-current">
          <span className="st-label" style={{ margin: 0 }}>This post's line{r.line.mode === 'own' ? ' (your own words)' : ''}</span>
          <div className="st-linepick-text">{r.line.text}</div>
          <LineFacts pain={r.line.pain} emotion={r.line.emotion} format={r.line.format} lifeOrJob={r.line.lifeOrJob} source={r.line.source} likes={r.line.likes} comment={r.line.comment} />
        </div>
      )}
      <div className="st-row" style={{ gap: 8, alignItems: 'center' }}><span className="st-hint grow">The line comes first: the place, the video and the text are filled from it.</span><HowTo id="line-first" label="Line first" /></div>
      <div className="st-seg sm" role="radiogroup" aria-label="Where the line comes from" data-field="line-mode">
        {([['bank', <Library key="b" size={13} />, 'From the bank'], ['own', <PenLine key="o" size={13} />, 'Write my own'], ['none', <Ban key="n" size={13} />, 'No line']] as Array<[Mode, ReactNode, string]>).map(([m, icon, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{icon}{label}</button>
        ))}
      </div>

      {mode === 'bank' && (
        <div className="st-col" style={{ gap: 10 }}>
          {p && (
            <>
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-field="line-filters">
                {select('pain', 'Pain', p.options.pains)}
                {select('emotion', 'Emotion', p.options.emotions)}
                {select('format', 'Format', p.options.formats)}
                {select('lifeOrJob', 'Life or job', ['life', 'job'])}
              </div>
              <span className="st-hint" data-field="line-picks-count">
                {p.total} line{p.total === 1 ? '' : 's'} that fit {p.characterName || 'this character'} ({p.stance === 'first' ? 'first person' : 'secondhand'}), {p.unused} unused, unused first{p.hidden ? `; ${p.hidden} used on other accounts left out` : ''}{p.otherVoice ? `; ${p.otherVoice} in another voice left out` : ''}.
              </span>
            </>
          )}
          {picks.isLoading && <span className="st-hint">Reading the line bank...</span>}
          {picks.error && <Callout tone="bad">{errorMessage(picks.error)}</Callout>}
          {p && !p.lines.length && <Callout tone="info">No line in the bank fits these filters. Import lines on the Line bank page, or write your own.</Callout>}
          <div className="st-col" style={{ gap: 8 }} data-field="line-picks">
            {p?.lines.map(l => <PickCard key={l.id} l={l} current={p.current === l.id} onUse={() => put({ lineId: l.id }, 'The line is on this post. Next: the visual.')} />)}
          </div>
        </div>
      )}

      {mode === 'own' && (
        <div className="st-col" style={{ gap: 8 }}>
          <textarea className="st-textarea" rows={2} value={own} maxLength={300} onChange={e => setOwn(e.target.value)} placeholder="the line, 12 words or fewer, the hit first" aria-label="Your own line" />
          <div className="st-row" style={{ gap: 8 }}>
            <AsyncButton className="st-btn sm primary" disabled={!own.trim()} field="line-own-use" onClick={() => put({ text: own }, 'Your line is on this post. Next: the visual.')}>Use my line</AsyncButton>
            <span className="st-hint">Your words go on as written (the line lint still checks them in Text).</span>
          </div>
        </div>
      )}

      {mode === 'none' && (
        <div className="st-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <AsyncButton className="st-btn sm" field="line-none" onClick={() => put({ none: true }, 'No line: a visual post. Next: the visual.')}><Ban size={13} />No line: a visual post</AsyncButton>
          <span className="st-hint">The post has no on-screen line; Fill never draws one for it and Check does not flag it.</span>
        </div>
      )}
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

function PickCard({ l, current, onUse }: { l: LinePick; current: boolean; onUse: () => Promise<void> }) {
  return (
    <div className={`st-linepick ${current ? 'on' : ''}`} data-field="line-pick" data-id={l.id}>
      <div className="st-linepick-text">{l.text}</div>
      <LineFacts pain={l.pain} emotion={l.emotion} format={l.format} lifeOrJob={l.lifeOrJob} source={l.source} likes={l.likes} comment={l.comment} />
      <div className="st-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {l.used ? <span className="st-badge ok">{l.used.here ? 'On this post' : `Used on @${l.used.account}${l.used.date ? ` ${l.used.date}` : ''}`}</span> : <span className="st-badge plain">Unused</span>}
        <span className="st-spacer" />
        {current ? <span className="st-hint"><Check size={12} style={{ verticalAlign: -2 }} /> This post's line</span> : <AsyncButton className="st-btn xs primary" onClick={onUse}>Use this line</AsyncButton>}
      </div>
    </div>
  )
}
