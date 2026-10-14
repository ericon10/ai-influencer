import { useEffect, useState } from 'react'
import { Clapperboard, Film, Monitor, Type } from 'lucide-react'
import type { Cut, MemeSpec } from '../../types'
import { autoCut } from './SoundRow'
import type { PostCtx } from './ctx'

// The post's timeline in the Finish step (UX-PLAN.md section 12, DECISIONS
// G29). The Studio lays the clips, B-roll and captions out on it from the
// steps above; "Open the editor" opens it in OpenReel, full screen, where
// edits are placed, dragged and trimmed. Done there saves the video and the
// timeline to the post and comes back here. On a phone: the preview, Trim
// start and end, and Export.

export const editorUrl = (id: string) => `/editor/?studio=${id}&back=${encodeURIComponent(`/studio/posts/${id}?step=finish`)}`
export const scrollKey = (id: string) => `st-scroll:${id}`

function useNarrow(): boolean {
  const query = '(max-width: 720px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

const r1 = (n: number) => Math.round(n * 10) / 10
const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 60 * 24 ? `${Math.round(min / 60)} h ago` : new Date(iso).toLocaleDateString()
}

export function EditorCard({ ctx }: { ctx: PostCtx }) {
  const { item, draft } = ctx
  const s = draft.spec as unknown as MemeSpec
  const cut: Cut = s.cut && !s.cut.auto && s.cut.shots.length ? s.cut : autoCut(s, ctx.data.options.meme.max_broll_seconds)
  const edited = s.editor?.savedAt ?? null
  const narrow = useNarrow()
  const [opening, setOpening] = useState(false)
  const clips = ctx.lib?.clips ?? []
  const length = (ref: string, kind: string) => kind === 'clip' ? clips.find(c => c.id === ref)?.durationSec ?? null : ctx.data.broll.find(b => b.id === ref)?.durationSec ?? null
  const shots = cut.shots.map((x, i) => {
    const src = length(x.ref, x.kind)
    const dur = src == null ? null : r1(Math.max(0, (x.out ?? src) - x.in))
    return { key: x.id, label: x.kind === 'clip' ? `Shot ${i + 1}` : 'B-roll', dur, kind: x.kind }
  })
  const total = shots.every(x => x.dur != null) ? r1(shots.reduce((a, x) => a + (x.dur ?? 0), 0)) : null
  const captions = cut.captions.filter(c => (c.text ?? s.caption ?? '').trim()).length

  async function open() {
    setOpening(true)
    try {
      await draft.flush()
      try { sessionStorage.setItem(scrollKey(item.id), String(window.scrollY)) } catch { /* private window */ }
      window.location.assign(editorUrl(item.id))
    } catch { setOpening(false) }
  }

  // Phone: trim where the video starts and ends (the first shot's start,
  // the last shot's end). An edited timeline is trimmed in the editor.
  const first = cut.shots[0]
  const last = cut.shots[cut.shots.length - 1]
  const lastLen = last ? length(last.ref, last.kind) : null
  function trim(edge: 'start' | 'end', value: number) {
    if (!first || !last) return
    const next = cut.shots.map((x, i) => {
      if (edge === 'start' && i === 0) return { ...x, in: Math.max(0, value) }
      if (edge === 'end' && i === cut.shots.length - 1) return { ...x, out: Math.max(x.in + 0.5, value) }
      return x
    })
    draft.setSpec({ cut: { ...cut, auto: false, shots: next } } as never)
  }

  return (
    <section className="st-card" data-field="post-timeline">
      <div className="st-card-head">
        <div className="grow">
          <div className="st-h3">Timeline</div>
          <div className="st-hint">
            {edited
              ? `Edited in the editor ${ago(edited)}. Done there saves the video here.`
              : 'Your clips, B-roll and captions, laid out for you. Open the editor to place edits exactly where you want them.'}
          </div>
        </div>
      </div>
      <div className="st-card-body st-col" style={{ gap: 12 }}>
        <div className="st-row st-timeline-sum" style={{ gap: 6, flexWrap: 'wrap' }}>
          {shots.map(x => <span key={x.key} className="st-chip static">{x.kind === 'clip' ? <Film size={12} /> : <Clapperboard size={12} />}{x.label}{x.dur != null ? ` · ${x.dur} s` : ''}</span>)}
          {captions > 0 && <span className="st-chip static"><Type size={12} />{captions === 1 ? '1 caption' : `${captions} captions`}</span>}
          {total != null && <span className="st-hint">{total} s in all</span>}
        </div>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={`st-btn ${narrow ? '' : 'primary'}`} disabled={opening || !cut.shots.length} onClick={() => void open()} aria-busy={opening}>
            <Clapperboard size={15} />{opening ? 'Opening the editor...' : edited ? 'Open the editor again' : 'Open the editor'}
          </button>
          {narrow && <span className="st-hint"><Monitor size={12} style={{ verticalAlign: -2 }} /> The editor works best on a computer.</span>}
          {!cut.shots.length && <span className="st-hint">Pick a clip in the Video step first.</span>}
        </div>
        {narrow && !edited && first && last && (
          <div className="st-row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="st-col" style={{ gap: 4 }}>
              <span className="st-label">Trim start (s)</span>
              <input className="st-input" type="number" inputMode="decimal" min={0} step={0.1} value={first.in} onChange={e => trim('start', Number(e.target.value))} style={{ width: 110 }} />
            </label>
            <label className="st-col" style={{ gap: 4 }}>
              <span className="st-label">Trim end (s)</span>
              <input className="st-input" type="number" inputMode="decimal" min={0} step={0.1} value={last.out ?? lastLen ?? ''} placeholder={lastLen != null ? String(lastLen) : ''} onChange={e => trim('end', Number(e.target.value))} style={{ width: 110 }} />
            </label>
          </div>
        )}
      </div>
    </section>
  )
}
