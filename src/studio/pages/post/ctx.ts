import type { CharacterSummary, CharacterView, ContentData, ContentItem, LibraryData, PostStep, SceneView, ScenesData } from '../../types'
import type { PostDraft } from './parts'

// What every step of a post sees: the post and its draft, its character,
// the character's scenes (and the post's own), and the Library.
export interface PostCtx {
  item: ContentItem
  data: ContentData
  draft: PostDraft<Record<string, unknown>>
  characters: CharacterSummary[]
  v: CharacterView | undefined
  scenes: ScenesData | undefined
  scene: SceneView | undefined
  lib: LibraryData | undefined
  current: PostStep
  advance: (step: PostStep, spec?: Record<string, unknown>) => Promise<void>
  // Opens a step (going back to it when it is done) and scrolls to a field
  // in it; `more` also opens the Idea step's More control.
  open: (step: PostStep, o?: { field?: string; more?: boolean }) => void
}

// The Idea step's More control, opened from elsewhere in the post.
export const MORE_EVENT = 'st-more-control'
export const moreKey = (postId: string) => `st-more:${postId}`
