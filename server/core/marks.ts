import type { Side, ViewDef } from '../config/pipeline.js'

// Distinguishing marks are side-specific (SPEC 5.1 rule 11). Sides are always
// the character's own LEFT and RIGHT, never the viewer's.

export interface Mark {
  name: string
  description: string
  side: Side
  region: string
  kind: 'skin' | 'jewelry'
  subtle?: boolean
}

export type ImageSide = 'image_left' | 'image_right'
export type Expectation = 'required' | 'optional' | 'hidden'

export const otherSide = (s: Side): Side => (s === 'LEFT' ? 'RIGHT' : 'LEFT')

// Facing the camera, the character's RIGHT side is on the image left.
// Seen from behind, their LEFT side is on the image left.
export function subjectSide(image: ImageSide, facing: 'camera' | 'away'): Side {
  if (facing === 'camera') return image === 'image_left' ? 'RIGHT' : 'LEFT'
  return image === 'image_left' ? 'LEFT' : 'RIGHT'
}

export function imageSideOf(side: Side, facing: 'camera' | 'away'): 'left' | 'right' {
  if (facing === 'camera') return side === 'LEFT' ? 'right' : 'left'
  return side === 'LEFT' ? 'left' : 'right'
}

// Must the mark show in this view, may it show, or must it be hidden?
export function markExpectation(view: ViewDef, mark: Mark): Expectation {
  const vis = view.sides[mark.side]
  if (vis === 'visible') return view.facing === 'away' && mark.region !== 'ear' && mark.region !== 'neck' ? 'hidden' : 'required'
  if (vis === 'partial') return view.partial_regions.includes(mark.region) ? 'optional' : 'hidden'
  return 'hidden'
}

// Is the given region on the given side visible at all in this view?
export function regionVisible(view: ViewDef, side: Side, region: string): boolean {
  const vis = view.sides[side]
  if (vis === 'visible') return view.facing === 'camera' || region === 'ear' || region === 'neck'
  if (vis === 'partial') return view.partial_regions.includes(region)
  return false
}
