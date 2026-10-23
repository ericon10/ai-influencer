import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CloudDownload, MapPin } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { AsyncButton, Callout, Img, errorMessage, useToast } from '../../ui'
import { rowKey } from '../../postRow'
import type { PlaceSuggestion } from '../../types'
import type { PostCtx } from './ctx'

// The Visual drawer's suggestions (owner, 2026-10-23; UX-PLAN.md section 43,
// item 3): the character's places that fit the post's line come first,
// each with its thumbnail, scene text and place_id. A place whose still is
// already in the Studio (or on Higgsfield) is reused for $0 and says so;
// the rest are used as the scene of a new still (priced below).

export const placesKey = (postId: string) => ['post-places', postId] as const

export function PlaceSuggestions({ ctx, onUsed }: { ctx: PostCtx; onUsed?: (still: 'attached' | 'pulling' | 'none' | 'kept') => void }) {
  const { item, draft } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: placesKey(item.id), queryFn: () => api.places(item.id), staleTime: 10_000 })
  const [all, setAll] = useState(false)
  const v = q.data
  if (q.error) return <Callout tone="bad">{errorMessage(q.error)}</Callout>
  if (!v) return <span className="st-hint">Reading the place bank...</span>
  if (!v.places.length) return <span className="st-hint">This character's place bank is empty. Add places on its file (Import places), or write the scene below.</span>
  const fit = v.places.filter(p => p.score > 0)
  const shown = all ? v.places : (fit.length ? fit : v.places).slice(0, 6)

  async function use(p: PlaceSuggestion, reuse: boolean) {
    try {
      await draft.flush()
      const r = await api.usePlace(item.id, p.id, reuse)
      qc.setQueryData(rowKey(item.id), r.row)
      await qc.invalidateQueries({ queryKey: keys.content })
      void qc.invalidateQueries({ queryKey: placesKey(item.id) })
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      toast({ tone: 'ok', text: r.still === 'attached' ? `${p.id}'s still is on this post, $0. Next: the video.` : r.still === 'pulling' ? `Pulling ${p.id}'s still from Higgsfield, $0. It shows here in a few seconds.` : `${p.id} is the scene. Make the still below (priced).` })
      onUsed?.(r.still)
      // A pull runs on the worker: look again until its still lands (a minute
      // at most), then show it where the owner is (the drawer stays open).
      if (r.still === 'pulling') {
        for (let i = 0; i < 30; i++) {
          await new Promise(res => setTimeout(res, 2000))
          const row = await api.postRow(item.id).catch(() => null)
          if (row?.stillAssetId) { qc.setQueryData(rowKey(item.id), row); await qc.invalidateQueries({ queryKey: keys.content }); onUsed?.('kept'); break }
        }
      }
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }

  return (
    <div className="st-col" style={{ gap: 8 }} data-field="place-suggestions">
      <span className="st-hint">
        {v.line ? (fit.length ? `${fit.length} place${fit.length === 1 ? '' : 's'} fit the line "${v.line.slice(0, 60)}", best first.` : `No place matches the line's words; the least used come first.`) : 'Pick the line first and the places that fit it come first.'} Reusing a still that exists is $0.
      </span>
      <div className="st-placecards">
        {shown.map(p => (
          <div key={p.id} className={`st-placecard ${v.current === p.id ? 'on' : ''}`} data-field={`place-${p.id}`}>
            <div className="thumb">
              {p.still?.assetId ? <Img assetId={p.still.assetId} width={300} /> : <span className="st-hint" style={{ padding: 8 }}>{p.still ? <><CloudDownload size={16} /><br />Still on Higgsfield, pulled free</> : 'No still yet'}</span>}
            </div>
            <div className="st-row" style={{ gap: 4, alignItems: 'center' }}><MapPin size={12} /><b style={{ fontSize: 12.5 }}>{p.id}</b>{p.used ? <span className="st-hint" style={{ fontSize: 11 }}>· used {p.used}x</span> : null}</div>
            <div style={{ fontSize: 12, fontWeight: 600 }} className="st-clamp1" title={p.name}>{p.name}</div>
            <div className="scene" title={p.scene}>{p.scene}</div>
            {p.why && <span className="st-badge accent" style={{ alignSelf: 'flex-start' }} data-field="place-why">{p.why}</span>}
            {v.current === p.id ? <span className="st-hint"><Check size={12} style={{ verticalAlign: -2 }} /> This post's place</span>
              : p.still ? <AsyncButton className="st-btn xs primary" field={`place-reuse-${p.id}`} onClick={() => use(p, true)}>Reuse this still: $0</AsyncButton>
              : <AsyncButton className="st-btn xs secondary" field={`place-use-${p.id}`} onClick={() => use(p, false)}>Use this place</AsyncButton>}
          </div>
        ))}
      </div>
      {v.places.length > shown.length && <button type="button" className="st-btn xs ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(true)}>Show all {v.places.length} places</button>}
    </div>
  )
}

// A person post's visual (item 3): the character's own settings that fit
// the line, as chips that fill the idea.
export function SettingSuggestions({ ctx }: { ctx: PostCtx }) {
  const { item, draft } = ctx
  const q = useQuery({ queryKey: placesKey(item.id), queryFn: () => api.places(item.id), staleTime: 10_000 })
  const list = (q.data?.settings ?? []).slice(0, 6)
  if (!list.length || item.kind !== 'meme') return null
  return (
    <div className="st-col" style={{ gap: 6 }} data-field="setting-suggestions">
      <span className="st-label" style={{ margin: 0 }}>Places from {ctx.v?.data.name ?? 'the character'}'s world that fit the line</span>
      <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {list.map(s => (
          <button key={s.text} type="button" className={`st-chip ${s.score ? 'on' : ''}`} title={s.why || 'Fill the idea with this place'} onClick={() => draft.setFields({ idea: draft.fields.idea.trim() ? `${draft.fields.idea.trim().replace(/[.\s]+$/, '')}. ${s.text}` : s.text })}>{s.text}</button>
        ))}
      </div>
    </div>
  )
}
