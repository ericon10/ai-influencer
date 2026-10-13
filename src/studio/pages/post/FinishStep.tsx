import { CopyPlus, Download, Scissors } from 'lucide-react'
import { assetUrl, downloadUrl } from '../../api'
import { Img, type TodoItem } from '../../ui'
import type { BatchSpec, MemeSpec, SlideshowSpec } from '../../types'
import { DownloadLink, ExportPanel, fileSlug, postName, useDuplicate } from './parts'
import type { PostCtx } from './ctx'

// The Finish step: export (free, on the worker), download, and make another
// like this. Fine-tune opens the editor over the post in Phase 4.

export function FinishStep({ ctx }: { ctx: PostCtx }) {
  const { item, draft, lib } = ctx
  const duplicate = useDuplicate()
  const name = fileSlug(postName({ ...item, title: draft.fields.title, idea: draft.fields.idea }))
  const o = item.outputs
  let todo: TodoItem[] = []
  let label = 'Export MP4'
  if (item.kind === 'meme') {
    const s = draft.spec as unknown as MemeSpec
    todo = [...(!s.clipId ? [{ label: 'Pick a clip', target: 'step-video' }] : []), ...(!s.caption?.trim() ? [{ label: 'Write the caption', target: 'post-caption' }] : [])]
    const clip = lib?.clips.find(c => c.id === s.clipId)
    if (clip && clip.status !== 'approved') todo.push({ label: 'Wait for the clip to be prepared' })
  } else if (item.kind === 'slideshow') {
    const s = draft.spec as unknown as SlideshowSpec
    todo = [...(!s.stillIds.length ? [{ label: 'Pick stills', target: 'step-stills' }] : []), ...(![s.hook, ...s.slides].some(t => t.trim()) ? [{ label: 'Write the slides (or type them)', target: 'slides-text' }] : [])]
    label = 'Export images'
  } else {
    const s = draft.spec as unknown as BatchSpec
    const n = Math.min((s.captions ?? []).filter(c => c.trim()).length, ctx.data.options.batch.max)
    todo = [...(!s.clipIds?.length ? [{ label: 'Pick a clip', target: 'batch-clips' }] : []), ...(!n ? [{ label: 'Add captions', target: 'batch-captions' }] : [])]
    label = n ? `Make ${n} videos` : 'Make the videos'
  }
  return (
    <div className="st-col" style={{ gap: 16 }}>
      <ExportPanel item={item} todo={todo} saving={draft.saving} flush={draft.flush} label={label} onStart={() => void ctx.advance('finish')}>
        {item.kind === 'meme' && item.status === 'ready' && o.videoAssetId && (
          <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <video className="st-content-result" src={assetUrl(o.videoAssetId)} controls playsInline />
            <DownloadLink assetId={o.videoAssetId} name={`${name}.mp4`}>Download MP4</DownloadLink>
          </div>
        )}
        {item.kind === 'slideshow' && item.status === 'ready' && o.imageAssetIds && (
          <div className="st-col" style={{ gap: 10 }}>
            <div className="st-row" style={{ gap: 8 }}>{o.zipAssetId && <DownloadLink assetId={o.zipAssetId} name={`${name}-slides.zip`}>Download all, in order (zip)</DownloadLink>}</div>
            <div className="st-content-strip">
              {o.imageAssetIds.map((id, i) => <a key={id} href={downloadUrl(id, `${String(i + 1).padStart(2, '0')}-${name}.jpg`)} title={`Download slide ${i + 1}`}><Img assetId={id} width={320} style={{ width: 150, aspectRatio: '9 / 16' }} /></a>)}
            </div>
          </div>
        )}
        {item.kind === 'batch' && (o.videos?.length ?? 0) > 0 && (
          <div className="st-col" style={{ gap: 10 }}>
            {o.zipAssetId && <div className="st-row"><DownloadLink assetId={o.zipAssetId} name={`${name}-batch.zip`}>Download all (zip, with captions.txt)</DownloadLink></div>}
            <div className="st-content-videos">
              {o.videos!.map((x, i) => x && (
                <div key={x.assetId} className="st-col" style={{ gap: 6 }}>
                  <video className="st-content-result sm" src={assetUrl(x.assetId)} controls playsInline preload="metadata" />
                  <span className="st-hint">{i + 1}. {x.caption}</span>
                  <a className="st-hint" href={downloadUrl(x.assetId, `${name}-${String(i + 1).padStart(2, '0')}.mp4`)}><Download size={12} style={{ verticalAlign: -2 }} /> Download</a>
                </div>
              ))}
            </div>
          </div>
        )}
      </ExportPanel>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="st-btn" onClick={() => void duplicate(item.id)}><CopyPlus size={15} />Make another like this</button>
        <button type="button" className="st-btn ghost" disabled title="Phase 4: the editor opens over this post, and Done brings you back here"><Scissors size={15} />Fine-tune (coming with the editor)</button>
      </div>
    </div>
  )
}
