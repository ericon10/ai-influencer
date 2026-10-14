import type { EditSpec, EditStyleView } from '../../types'

// Where an edit acts on the Fine-tune timeline (before the edit changes the
// time): the highlighted zones, the payoff marker (draggable when the edit
// lands at a payoff), and what is missing. Mirrors server/media/edits.ts.
export interface EditZones { zones: Array<{ start: number; end: number; label: string }>; marker: number | null; movable: boolean; problem: string | null }
export function editZones(style: EditStyleView | null, edit: EditSpec, shots: Array<{ kind: string; start: number }>, total: number, payoffFromEnd: number, hasMusic: boolean): EditZones {
  const none: EditZones = { zones: [], marker: null, movable: false, problem: null }
  if (!style || total < 0.5) return none
  const p = style.params?.[edit.strength] ?? style.params?.normal ?? {}
  const clipStarts = shots.filter(s => s.kind === 'clip').map(s => s.start)
  const shotB = clipStarts[1]
  const firstCut = shots.slice(1).map(s => s.start).find(c => c > 0.3 && c < total - 0.3)
  const clamp = (t: number) => Math.max(0.2, Math.min(total - 0.2, t))
  const payoff = clamp(edit.payoff ?? total - payoffFromEnd)
  const r = (n: number) => Math.round(n * 10) / 10
  if (style.shots === 2 && shotB == null) return { ...none, problem: `${style.label} needs shot B after the clip.` }
  switch (style.id) {
    case 'crash_zoom': { const L = Math.min(p.seconds ?? 0.6, shotB! - 0.1); return { ...none, zones: [{ start: shotB! - L, end: shotB!, label: `Zoom to ${p.zoom ?? 3}x` }], marker: shotB! } }
    case 'whip_pan': { const S = p.seconds ?? 0.16; return { ...none, zones: [{ start: shotB! - S, end: shotB! + S, label: 'Whip' }], marker: shotB! } }
    case 'hand_lens': { const S = p.search ?? 1; return { ...none, zones: [{ start: Math.max(0, shotB! - S), end: Math.min(total, shotB! + S), label: 'Looks for the covered lens' }], marker: shotB! } }
    case 'speed_ramp': return { ...none, zones: [{ start: payoff, end: Math.min(total, payoff + (p.seconds ?? 1)), label: `Slow motion ${p.speed ?? 0.4}x` }], marker: payoff, movable: true }
    case 'freeze_pop': return { ...none, zones: [{ start: payoff, end: Math.min(total, payoff + 0.15), label: `Holds ${r(p.seconds ?? 1.1)} s` }], marker: payoff, movable: true }
    case 'flash_shake': { const at = edit.payoff == null && firstCut != null ? firstCut : payoff; return { ...none, zones: [{ start: at, end: Math.min(total, at + (p.seconds ?? 0.4)), label: 'Flash and shake' }], marker: at, movable: true } }
    case 'zoom_reveal': return { ...none, zones: [{ start: 0, end: Math.min(total - 0.2, p.seconds ?? 1.2), label: `From ${p.zoom ?? 2.4}x` }] }
    case 'seamless_loop': return { ...none, zones: [{ start: Math.max(0.5, total * (p.min_share ?? 0.6)), end: total, label: 'Loop point found here' }] }
    case 'punch_in': {
      if (hasMusic) return { ...none, zones: [{ start: 0, end: total, label: 'On the beat of your music' }] }
      const every = p.every ?? 1
      const beats = Array.from({ length: Math.floor((total - 0.3) / every) }, (_, i) => 0.5 + i * every).filter(b => b < total - 0.1)
      const zones: EditZones['zones'] = []
      for (let i = 0; i < beats.length; i += 2) zones.push({ start: beats[i]!, end: beats[i + 1] ?? total, label: `${p.zoom ?? 1.14}x` })
      return { ...none, zones }
    }
    case 'word_pop': return { ...none, zones: [{ start: 0, end: total, label: 'Captions pop word by word' }] }
  }
  return none
}
