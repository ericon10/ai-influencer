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
}
