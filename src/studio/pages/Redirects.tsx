import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useContent } from '../hooks'

// Old Studio addresses keep working (UX-PLAN.md section 2).

export function OldCharacter() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const content = useContent()
  const tab = params.get('tab')
  const scene = params.get('scene')
  if (tab === 'scenes') {
    // The post that holds the scene; else its stills in the Library.
    if (scene && !content.data) return null
    const post = scene ? content.data?.items.find(i => i.sceneId === scene) : undefined
    if (post) return <Navigate to={`/studio/posts/${post.id}`} replace />
    return <Navigate to={`/studio/library?tab=stills&c=${encodeURIComponent(id)}${scene ? `&scene=${encodeURIComponent(scene)}` : ''}`} replace />
  }
  return <Navigate to={`/studio/characters/${id}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`} replace />
}

export function OldReview() {
  const { id = '', refId } = useParams()
  return <Navigate to={`/studio/characters/${id}/review${refId ? `/${refId}` : ''}`} replace />
}

export function OldContent() {
  const [params] = useSearchParams()
  const item = params.get('item')
  if (params.get('tab') === 'broll') return <Navigate to="/studio/library?tab=broll" replace />
  return <Navigate to={item ? `/studio/posts/${item}` : '/studio'} replace />
}

export const OldUsage = () => <Navigate to="/studio/settings?tab=usage" replace />
export const OldRules = () => <Navigate to="/studio/settings?tab=rules" replace />
