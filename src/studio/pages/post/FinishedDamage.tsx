import { HowTo } from '../../guide/Guide'
import type { PostCtx } from './ctx'

// "Finished damage" on any video post (owner, 2026-10-22; UX-PLAN.md
// section 35, item 4j): one still, a 7 s just-existing clip (driving,
// staring, rain on the windshield), a sad song and the on-screen line. On
// a person's post the switch fills the Video step's take (7 s, the just-
// existing motion, both editable) and lists what is left; a faceless
// post has the same switch in its own drawers.
export function FinishedDamage({ ctx }: { ctx: PostCtx }) {
  const { draft } = ctx
  const spec = draft.spec as { recipe?: 'finished_damage' | null; stillId?: string | null; clipId?: string | null; caption?: string; sound?: { music?: string | null } }
  const on = spec.recipe === 'finished_damage'
  const left = [
    !spec.stillId ? 'one still (Stills step)' : '',
    !spec.clipId ? 'the 7 s just-existing take (Video step, filled in)' : '',
    !spec.sound?.music ? 'a sad song (Finish step, Sound)' : '',
    !(spec.caption ?? '').trim() ? 'the on-screen line (Caption step)' : '',
  ].filter(Boolean)
  return (
    <div className="st-row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 12 }} data-field="finished-damage">
      <button type="button" role="switch" aria-checked={on} aria-label="Finished damage" className={`st-switch ${on ? 'on' : ''}`} onClick={() => draft.setSpec({ recipe: on ? null : 'finished_damage' })}><span /></button>
      <span className="st-col" style={{ gap: 2 }}>
        <span className="st-titlerow"><b>Finished damage</b><HowTo id="post-video" label="About Finished damage" /></span>
        <span className="st-hint">{on ? (left.length ? `Left: ${left.join('; ')}.` : 'All four parts are in.') : 'One still, a 7 s just-existing clip (driving, staring, rain on the windshield), a sad song and the on-screen line.'}</span>
      </span>
    </div>
  )
}
