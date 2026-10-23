import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, MapPin, Quote } from 'lucide-react'
import { api, assetUrl } from './api'
import { Callout, Drawer, Img, errorMessage } from './ui'
import { HowTo } from './guide/Guide'
import { postLine, postPlace } from '../../server/core/postRow'
import type { PostRowView } from './types'

// Line first, both doors (UX-PLAN.md rule 2 and section 43): wherever a
// picture of a post shows (post cards, Weeks cells, Review cards, the
// Library), its line and place_id show under it, and a tap opens the full
// row in a drawer with Open post.

export const rowKey = (postId: string) => ['post-row', postId] as const

// The line and place of a post, read from its spec (the same reader the
// server uses).
export function lineOfItem(item: { kind: string; spec: Record<string, unknown> | null | undefined }) {
  return { ...postLine(item.kind, item.spec ?? {}), placeId: postPlace(item.spec ?? {}) }
}

// The line under a thumbnail and the place_id; a tap opens the row.
export function LineTag({ postId, line, placeId, none = false, compact = false }: { postId: string; line: string; placeId: string | null; none?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={`st-linetag ${compact ? 'compact' : ''}`} onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }} data-field={`line-tag-${postId}`} aria-label={`Open the row: ${line || (none ? 'no line' : 'no line yet')}`} title="Open the full row">
        <span className={`st-linetag-line ${line ? '' : 'empty'}`}>{line ? <><Quote size={11} />{line}</> : none ? 'No line (a visual post)' : 'No line yet'}</span>
        {placeId && <span className="st-linetag-place" data-field="line-tag-place"><MapPin size={10} />{placeId}</span>}
      </button>
      {/* Clicks in the drawer (a portal) stay out of the tile or card around the tag. */}
      <span hidden={!open} onClick={e => e.stopPropagation()}><RowDrawer postId={postId} open={open} onClose={() => setOpen(false)} /></span>
    </>
  )
}

const FROM: Record<string, string> = { place: 'Reused from the place, $0', new: 'Made for this post', upload: 'Your own picture' }

// The full row: where it posts, the line with its pain, emotion and
// source, the place, the still, the video, the sound and the caption.
export function RowDrawer({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const row = useQuery({ queryKey: rowKey(postId), queryFn: () => api.postRow(postId), enabled: open, staleTime: 5_000 })
  return (
    <Drawer open={open} onClose={onClose} title={<span className="st-titlerow">The row<HowTo id="line-first" label="Line first, both doors" /></span>}>
      {open && (row.data ? <RowBody r={row.data} /> : row.error ? <Callout tone="bad">{errorMessage(row.error)}</Callout> : <span className="st-hint">Reading the row...</span>)}
    </Drawer>
  )
}

function RowBody({ r }: { r: PostRowView }) {
  const where = [r.accountTag ? `@${r.accountTag}` : 'No account', r.date ? `${r.date}${r.slot ? `, slot ${r.slot}` : ''}` : 'not in a week', r.rowId ? `row ${r.rowId}` : ''].filter(Boolean).join(' · ')
  return (
    <div className="st-col" style={{ gap: 14 }} data-field="post-row">
      <div className="st-col" style={{ gap: 2 }}>
        <b>{r.title || 'Untitled post'}</b>
        <span className="st-hint" data-field="post-row-where">{where} · {r.characterName || 'no character'}{r.faceless ? ' (faceless)' : ''}</span>
      </div>
      <section className="st-col" style={{ gap: 4 }} data-field="post-row-line">
        <span className="st-label">1. Line</span>
        {r.line.text ? <div className="st-bankline-text">{r.line.text}</div> : <span className="st-hint">{r.line.mode === 'none' ? 'No line: a visual post.' : 'No line yet.'}</span>}
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.line.mode === 'bank' && <span className="st-badge plain">From the bank</span>}
          {r.line.mode === 'own' && <span className="st-badge plain">Your own words</span>}
          {r.line.pain && <span className="st-badge plain">pain: {r.line.pain}</span>}
          {r.line.emotion && <span className="st-badge plain">{r.line.emotion}</span>}
          {r.line.format && <span className="st-badge plain">{r.line.format}</span>}
          {r.line.lifeOrJob && <span className="st-badge plain">{r.line.lifeOrJob}</span>}
        </div>
        {r.line.source && <span className="st-hint">Source: {r.line.source}{r.line.likes ? `, ${r.line.likes.toLocaleString()} likes` : ''}{r.line.comment ? `: "${r.line.comment.slice(0, 200)}"` : ''}</span>}
      </section>
      <section className="st-col" style={{ gap: 4 }} data-field="post-row-place">
        <span className="st-label">2. Place</span>
        {r.place ? <span><b>{r.place.id}</b>{r.place.name ? ` · ${r.place.name}` : ''}</span> : <span className="st-hint">No place from the bank.</span>}
        {r.place?.scene && <span className="st-hint">{r.place.scene}</span>}
      </section>
      <section className="st-col" style={{ gap: 6 }}>
        <span className="st-label">3. Still and 4. video</span>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {r.stillAssetId ? <Img assetId={r.stillAssetId} width={240} style={{ width: 110, aspectRatio: '9 / 16', borderRadius: 10 }} /> : <span className="st-hint">No still yet.</span>}
          {r.videoAssetId && <video src={`${assetUrl(r.videoAssetId)}#t=0.1`} muted playsInline controls style={{ width: 110, aspectRatio: '9 / 16', borderRadius: 10 }} />}
        </div>
        {r.stillFrom && <span className="st-hint" data-field="post-row-still-from">{FROM[r.stillFrom]}</span>}
      </section>
      <section className="st-col" style={{ gap: 4 }}>
        <span className="st-label">5. Sound</span>
        <span className="st-hint">{r.sound || 'None picked.'}</span>
      </section>
      <section className="st-col" style={{ gap: 4 }}>
        <span className="st-label">6. Caption</span>
        <span className="st-hint">{r.caption || 'No caption yet.'}{r.hashtags.length ? ` ${r.hashtags.map(t => `#${t}`).join(' ')}` : ''}</span>
      </section>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Link className="st-btn primary" to={`/studio/posts/${r.postId}`} data-field="post-row-open">Open post<ArrowRight size={14} /></Link>
        {r.week && <Link className="st-btn ghost" to={`/studio/weeks?week=${r.week}`}>Its week</Link>}
      </div>
    </div>
  )
}
