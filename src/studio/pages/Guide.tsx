import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, BookOpen, Clapperboard, FolderOpen, Repeat, Sparkle, Users } from 'lucide-react'
import { GLOSSARY, GUIDE, QUICK_START, type GuideId, type GuideSection } from '../guide/content'
import { SectionView, shotUrl } from '../guide/Guide'

// The Guide (owner, 2026-10-13; UX-PLAN.md): the visual manual. The Quick
// start, the big picture, every page and step with annotated screenshots of
// the real screens, and a glossary. Each section also opens from its page.

const QUICK_TO: Record<number, GuideId> = { 1: 'setup-face', 2: 'posts', 3: 'post-idea', 4: 'post-stills', 5: 'post-video', 6: 'post-text', 7: 'post-finish' }
const GROUPS: Array<GuideSection['group']> = ['Start here', 'Set up a character', 'Make a post', 'Grow your accounts', 'Everything else']

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export default function Guide() {
  const loc = useLocation()
  // "Open the full guide" from a drawer lands on its section.
  useEffect(() => {
    const id = loc.hash.replace('#', '')
    if (id) window.setTimeout(() => jump(id), 120)
  }, [loc.hash])

  return (
    <div className="st-page wide gd-page">
      <header className="gd-hero">
        <div className="gd-hero-kicker"><BookOpen size={15} />Guide</div>
        <h1 className="gd-hero-title">How Character Studio works</h1>
        <p className="gd-hero-sub">Set up a character once. Then make a post a day: an idea, a photo, a video, a caption, an export. Here is all of it in pictures, with every button explained.</p>
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="st-btn primary" onClick={() => jump('quick-start')}>Quick start: 7 steps<ArrowRight size={15} /></button>
          <button type="button" className="st-btn" onClick={() => jump('sections')}>Every page and step</button>
          <button type="button" className="st-btn ghost" onClick={() => jump('glossary')}>Words used here</button>
        </div>
      </header>

      <section id="quick-start" className="gd-block">
        <div className="gd-block-head"><span className="gd-block-num">1</span><div><h2 className="gd-h2">Quick start</h2><p className="st-sub" style={{ margin: 0 }}>From nothing to a posted video. Steps 2 to 7 are one page: each step opens under the one before.</p></div></div>
        <ol className="gd-quick">
          {QUICK_START.map(q => (
            <li key={q.n} className={`gd-quick-card gd-c-${q.color}`}>
              <button type="button" onClick={() => jump(QUICK_TO[q.n]!)} aria-label={`Step ${q.n}: ${q.title}`}>
                <div className="gd-quick-img"><img src={shotUrl(q.shot)} alt="" loading="lazy" style={q.focus ? { objectPosition: `${q.focus[0]}% ${q.focus[1]}%`, transformOrigin: `${q.focus[0]}% ${q.focus[1]}%`, transform: `scale(${q.focus[2]})` } : undefined} /></div>
                <div className="gd-quick-body">
                  <div className="st-row" style={{ gap: 8 }}><span className="gd-quick-n">{q.n}</span><b>{q.title}</b>{q.once && <span className="gd-once">once</span>}</div>
                  <p>{q.text}</p>
                </div>
              </button>
            </li>
          ))}
        </ol>
        <div className="gd-shortcut gd-c-blue">
          <Clapperboard size={18} />
          <div><b>Shortcut: clone a TikTok.</b> New post &gt; Video post from a TikTok. Choose the saved video, press Clone it, then Use this clip, add a caption and export. <button type="button" className="gd-link" onClick={() => jump('post-clone')}>How cloning works</button></div>
        </div>
      </section>

      <section id="map" className="gd-block">
        <div className="gd-block-head"><span className="gd-block-num">2</span><div><h2 className="gd-h2">The big picture</h2><p className="st-sub" style={{ margin: 0 }}>Three places, used in this order.</p></div></div>
        <div className="gd-map">
          <div className="gd-map-card gd-c-violet">
            <Users size={22} />
            <b>Characters</b>
            <span>Set up once</span>
            <div className="gd-map-chips"><span>Inspiration</span><span>Face (REF-00)</span><span>Reference sheet</span><span>Character file</span></div>
          </div>
          <ArrowRight className="gd-map-arrow" size={22} />
          <div className="gd-map-card gd-c-orange big">
            <Sparkle size={22} />
            <b>Posts</b>
            <span>Every day, one page per post</span>
            <div className="gd-map-chips"><span>Idea</span><span>Stills</span><span>Video</span><span>Caption</span><span>Finish</span></div>
          </div>
          <ArrowRight className="gd-map-arrow" size={22} />
          <div className="gd-map-card gd-c-teal">
            <FolderOpen size={22} />
            <b>Library</b>
            <span>Everything kept</span>
            <div className="gd-map-chips"><span>Stills</span><span>Clips</span><span>B-roll</span><span>Posts</span></div>
          </div>
        </div>
        <div className="gd-map-note"><Repeat size={15} />Anything in the Library can start a new post, and "Make another like this" copies a finished post for the next one in a series.</div>
      </section>

      <section id="sections" className="gd-block">
        <div className="gd-block-head"><span className="gd-block-num">3</span><div><h2 className="gd-h2">Every page and step</h2><p className="st-sub" style={{ margin: 0 }}>Hover the numbers on a screenshot to see what each part does. The same help opens from "How this works" on each page.</p></div></div>
        <nav className="gd-index" aria-label="Guide sections">
          {GROUPS.map(g => (
            <div key={g} className="gd-index-group">
              <span className="gd-index-label">{g}</span>
              <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {GUIDE.filter(s => s.group === g).map(s => <button key={s.id} type="button" className={`gd-chip gd-c-${s.color}`} onClick={() => jump(s.id)}>{s.title}</button>)}
              </div>
            </div>
          ))}
        </nav>
        <div className="st-col" style={{ gap: 26 }}>
          {GUIDE.map(s => <div key={s.id} id={s.id} className="gd-anchor"><SectionView s={s} /></div>)}
        </div>
      </section>

      <section id="glossary" className="gd-block">
        <div className="gd-block-head"><span className="gd-block-num">4</span><div><h2 className="gd-h2">Words used here</h2></div></div>
        <dl className="gd-glossary">
          {GLOSSARY.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}
        </dl>
        <p className="st-hint" style={{ marginTop: 18 }}>Screenshots are from demo mode, so the images are stand-ins. Yours show your character. <Link to="/studio">Back to your posts</Link></p>
      </section>
    </div>
  )
}
