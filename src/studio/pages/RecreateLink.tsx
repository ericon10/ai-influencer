import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '../api'
import { keys } from '../hooks'
import { Callout, errorMessage } from '../ui'

// The Recreate link (UX-PLAN.md 16): /studio/recreate?clip=<Higgsfield media
// ID or a direct video link>&character=<name>&model=<motion model>&cap=<credits>
// makes a video post, brings the clip in (free, on the worker) and opens it
// at Recreate. Opening the same link again goes back to that post instead of
// making another.

const seenKey = (q: string) => `st-recreate:${q}`

export default function RecreateLink() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const clip = params.get('clip')?.trim() ?? ''
  const character = params.get('character')?.trim() ?? ''
  const model = params.get('model')?.trim() || undefined
  const cap = Number(params.get('cap')) > 0 ? Number(params.get('cap')) : null
  const query = new URLSearchParams({ clip, character, ...(model ? { model } : {}), ...(cap ? { cap: String(cap) } : {}) }).toString()
  async function start(again = false) {
    setError(null)
    try {
      const seen = (() => { try { return localStorage.getItem(seenKey(query)) } catch { return null } })()
      if (seen && !again) { nav(`/studio/posts/${seen}`, { replace: true }); return }
      const { id } = await api.startRecreate({ character, link: clip, ...(model ? { model } : {}), cap })
      try { localStorage.setItem(seenKey(query), id) } catch { /* private window */ }
      await qc.invalidateQueries({ queryKey: keys.content })
      nav(`/studio/posts/${id}`, { replace: true })
    } catch (e) { setError(errorMessage(e)) }
  }
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!clip || !character) { setError('This link needs a clip (a Higgsfield media ID or a video link) and a character.'); return }
    void start()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="st-page" style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
      <div className="st-card st-col" style={{ gap: 12, maxWidth: 520, padding: 20 }}>
        <div className="st-h2">Recreate from a real clip</div>
        {error ? (
          <>
            <Callout tone="bad">{error}</Callout>
            <div className="st-row" style={{ gap: 8 }}><button type="button" className="st-btn" onClick={() => void start(true)}>Try again</button><button type="button" className="st-btn ghost" onClick={() => nav('/studio')}>Posts</button></div>
          </>
        ) : (
          <span className="st-row" style={{ gap: 8 }}><Loader2 size={15} className="st-spin" />Making the post for {character || 'your character'} and bringing the clip in (free)...</span>
        )}
      </div>
    </div>
  )
}
