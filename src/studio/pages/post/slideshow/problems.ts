import { slideList } from '../../../../../server/core/slides'
import type { SlideshowSpec } from '../../../types'
import type { TodoItem } from '../../../ui'

// What Export needs, linked to the field (the same rule as the server's
// slideshowProblems): every slide has a picture or a special slide, and a
// product screenshot slide has its upload.
export function slideshowProblemsClient(spec: SlideshowSpec): TodoItem[] {
  const list = slideList(spec)
  if (!list.length) return [{ label: 'Pick stills or draft the slides', target: 'step-stills' }]
  const missing = list.filter(s => !s.stillId && !s.special).map(s => s.index + 1)
  if (missing.length) return [{ label: `A picture for slide${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`, target: 'slide-cards' }]
  // A product screenshot is only ever the owner's upload.
  const shots = list.filter(s => s.special?.type === 'product_shot' && !s.special.assetId).map(s => s.index + 1)
  return shots.length ? [{ label: `The product screenshot for slide${shots.length > 1 ? 's' : ''} ${shots.join(', ')} (Upload)`, target: 'slide-cards' }] : []
}
