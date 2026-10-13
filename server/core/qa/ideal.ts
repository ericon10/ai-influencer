import type { SheetShot, ViewsConfig } from '../../config/pipeline.js'
import { imageSideOf, markExpectation, type Mark } from '../marks.js'
import type { Observation } from './perception.js'

// The observation a perfect render of a shot would produce. Demo mode uses
// it as the mock inspector's answer, so the whole flow can be tried free.
export function idealObservation(shot: Pick<SheetShot, 'view' | 'framing'>, views: ViewsConfig, marks: Mark[], eyes: string): Observation {
  const view = views.views[shot.view]!
  const pose = shot.view === 'front' ? 'frontal' : shot.view === 'back' ? 'back' : shot.view.startsWith('profile') ? 'profile' : 'three_quarter'
  const nose = shot.view === 'front' ? 'toward_camera' : shot.view === 'back' ? 'away' : shot.view.endsWith('_left') ? 'image_left' : 'image_right'
  const toImage = (side: Mark['side']) => (imageSideOf(side, view.facing) === 'left' ? 'image_left' : 'image_right') as 'image_left' | 'image_right'
  const earSides = (['LEFT', 'RIGHT'] as const).filter(s => view.sides[s] === 'visible' || (view.sides[s] === 'partial' && view.partial_regions.includes('ear')))
  return {
    pose, nose, confidence: 0.92,
    framing: shot.framing, standing: true,
    ears: earSides.map(s => {
      const m = marks.find(x => x.region === 'ear' && x.kind === 'jewelry' && x.side === s)
      return { image_side: toImage(s), jewelry: !!m, jewelry_description: m?.description ?? '' }
    }),
    skin_marks: marks.filter(m => m.kind === 'skin' && markExpectation(view, m) === 'required')
      .map(m => ({ image_side: toImage(m.side), location: `near the ${m.region}`, description: m.description })),
    other_jewelry: [],
    eye_color: view.facing === 'camera' ? eyes || 'unknown' : 'not visible',
    text_or_logos: [], artifacts: [], skin: { texture: 'real', flaws: ['visible pores'] }, notes: 'Demo inspector (mock).',
  }
}
