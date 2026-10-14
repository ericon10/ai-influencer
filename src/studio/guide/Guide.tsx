import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, CircleHelp, Coins, ExternalLink, Lightbulb, ListChecks, MapPin, X } from 'lucide-react'
import { Drawer } from '../ui'
import { QUICK_START, sectionById, type GuideId, type GuideSection } from './content'
import shots from './shots.json'

// The Guide's parts (UX-PLAN.md pattern 12): an annotated screenshot with
// numbered hotspots, one section of the manual, and the "How this works"
// button that opens a section in a drawer from any page or step.

interface ShotMeta { w: number; h: number; spots: Array<{ n: number; x: number; y: number; w: number; h: number; label: string }> }
const SHOTS = shots as Record<string, ShotMeta>

export const shotUrl = (id: string) => `/studio-guide/${id}.webp`

// A real screen with numbered hotspots: hover or tap a number (on the image
// or in the list) to outline that part of the screen.
export function Shot({ id, caption, maxHeight = 680 }: { id: string; caption: string; maxHeight?: number }) {
  const meta = SHOTS[id]
  const [active, setActive] = useState<number | null>(null)
  if (!meta) return null
  const width = `min(100%, ${Math.round((maxHeight * meta.w) / meta.h)}px)`
  return (
    <figure className="gd-shot">
      <div className="gd-shot-frame" style={{ aspectRatio: `${meta.w} / ${meta.h}`, width }}>
        <img src={shotUrl(id)} alt={caption} loading="lazy" draggable={false} />
        {meta.spots.map(s => (
          <button
            key={s.n} type="button" className={`gd-spot ${active === s.n ? 'on' : ''}`}
            style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%` }}
            onMouseEnter={() => setActive(s.n)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(s.n)} onBlur={() => setActive(null)}
            onClick={() => setActive(a => (a === s.n ? null : s.n))} aria-label={`${s.n}. ${s.label}`}
          >
            <span className="gd-pin">{s.n}</span>
            {active === s.n && <span className="gd-tip">{s.label}</span>}
          </button>
        ))}
      </div>
      <figcaption>
        <div className="st-row" style={{ gap: 8 }}>
          <b>{caption}</b>
          <span className="st-spacer" />
          <a className="st-hint gd-full" href={shotUrl(id)} target="_blank" rel="noreferrer">Full size <ExternalLink size={11} /></a>
        </div>
        {meta.spots.length > 0 && (
          <ol className="gd-legend">
            {meta.spots.map(s => (
              <li key={s.n} className={active === s.n ? 'on' : ''} onMouseEnter={() => setActive(s.n)} onMouseLeave={() => setActive(null)}>
                <span className="gd-pin">{s.n}</span><span>{s.label}</span>
              </li>
            ))}
          </ol>
        )}
      </figcaption>
    </figure>
  )
}

// One section of the manual.
export function SectionView({ s, compact = false }: { s: GuideSection; compact?: boolean }) {
  const free = s.cost === 'Free.'
  return (
    <div className={`gd-section gd-c-${s.color} ${compact ? 'compact' : ''}`}>
      <div className="gd-section-head">
        {!compact && <div className="gd-kicker">{s.group}</div>}
        {!compact && <h2 className="gd-title">{s.title}</h2>}
        <p className="gd-tagline">{s.tagline}</p>
        <div className="gd-where"><MapPin size={13} />{s.where}</div>
      </div>
      <p className="gd-intro">{s.intro}</p>
      <div className={compact ? 'st-col' : 'gd-twocol'} style={compact ? { gap: 14 } : undefined}>
        <div className="gd-box">
          <div className="gd-box-head"><ListChecks size={15} />Do this</div>
          <ol className="gd-steps">{s.steps.map((t, i) => <li key={i}><span className="gd-num">{i + 1}</span><span>{t}</span></li>)}</ol>
        </div>
        <div className="st-col" style={{ gap: 14 }}>
          {s.tips.length > 0 && (
            <div className="gd-box tips">
              <div className="gd-box-head"><Lightbulb size={15} />Good to know</div>
              <ul className="gd-tips">{s.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          {s.cost && <div className={`gd-cost ${free ? 'free' : ''}`}><Coins size={15} /><span><b>{free ? 'Free' : 'What it costs'}</b>{free ? ': nothing is charged here.' : `: ${s.cost}`}</span></div>}
        </div>
      </div>
      {s.shots.length > 0 && (
        <div className="gd-shots">
          {s.shots.map(sh => <Shot key={sh.id} id={sh.id} caption={sh.caption} maxHeight={compact ? 560 : 680} />)}
        </div>
      )}
    </div>
  )
}

// "How this works": that part of the Guide, right where you are.
export function HowTo({ id, label = 'How this works' }: { id: GuideId; label?: string }) {
  const [open, setOpen] = useState(false)
  const s = sectionById(id)
  return (
    <>
      <button type="button" className={`gd-howto gd-c-${s.color}`} onClick={e => { e.stopPropagation(); setOpen(true) }} title={`How this works: ${s.title}`}>
        <CircleHelp size={14} /><span className="gd-howto-label">{label}</span>
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} wide title={<span className="st-row" style={{ gap: 8 }}><CircleHelp size={18} />{s.title}</span>}>
        <SectionView s={s} compact />
        <div className="st-row" style={{ marginTop: 18 }}>
          <Link className="st-btn" to={`/studio/guide#${s.id}`} onClick={() => setOpen(false)}>Open the full guide</Link>
        </div>
      </Drawer>
    </>
  )
}

// Posts home: the Quick start in one line until it is dismissed. Remembered
// in this browser only; it is a convenience, so a blocked store just shows it.
const BANNER_KEY = 'st-guide-banner-off'
function bannerOff(): boolean {
  try { return window.localStorage.getItem(BANNER_KEY) === '1' } catch { return false }
}

export function QuickStartBanner() {
  const [off, setOff] = useState(bannerOff)
  if (off) return null
  function dismiss() {
    try { window.localStorage.setItem(BANNER_KEY, '1') } catch { /* shown again next time */ }
    setOff(true)
  }
  return (
    <div className="gd-banner" role="note">
      <span className="gd-banner-icon"><BookOpen size={20} /></span>
      <div className="grow">
        <b>New here? The Quick start shows the whole flow in 7 steps, with pictures.</b>
        <div className="gd-banner-steps">{QUICK_START.map(q => <span key={q.n} className={`gd-c-${q.color}`}>{q.n}. {q.title}</span>)}</div>
      </div>
      <Link className="st-btn primary" to="/studio/guide#quick-start">Open the guide</Link>
      <button type="button" className="st-btn icon ghost" onClick={dismiss} aria-label="Hide the Quick start" title="Hide. The Guide stays in the sidebar."><X size={16} /></button>
    </div>
  )
}
