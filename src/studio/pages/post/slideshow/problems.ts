import { slideList } from '../../../../../server/core/slides'
import type { SlideshowSpec } from '../../../types'
import type { TodoItem } from '../../../ui'

// What Export needs, linked to the field (the same rule as the server's
// slideshowProblems): every slide has a picture or a special slide.
export function slideshowProblemsClient(spec: SlideshowSpec): TodoItem[] {
  const list = slideList(spec)
  if (!list.length) return [{ label: 'Pick stills or draft the slides', target: 'step-stills' }]
  const missing = list.filter(s => !s.stillId && !s.special).map(s => s.index + 1)
  return missing.length ? [{ label: `A picture for slide${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`, target: 'slide-cards' }] : []
}
