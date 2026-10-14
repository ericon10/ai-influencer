import type { ContentItem } from '../../types'

// A batch's progress, for its card on Posts home: "12 of 50 done", with the
// failed ones counted apart. Null before the batch has started.
export function batchProgress(o: ContentItem['outputs']): { text: string; share: number } | null {
  const total = o.total ?? 0
  if (!total) return null
  const done = o.done ?? 0, failed = o.failed ?? 0
  return { text: `${done} of ${total} done${failed ? `, ${failed} failed` : ''}`, share: Math.min(1, (done + failed) / total) }
}
