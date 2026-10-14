import { Link } from 'react-router-dom'
import { CopyPlus, Download, RotateCcw, Scissors } from 'lucide-react'
import { api, assetUrl, downloadUrl } from '../../api'
import { AsyncButton, Img, errorMessage, scrollToField, useToast, type TodoItem } from '../../ui'
import type { BatchSpec, MemeSpec, SlideshowSpec } from '../../types'
import { DownloadLink, ExportPanel, fileSlug, postName, useDuplicate } from './parts'
import type { PostCtx } from './ctx'
import { RoughCut, SoundRow, autoCut } from './RoughCut'
import { EditStylePicker, editOf } from './EditStyles'
import { keys, useSounds } from '../../hooks'
import { useQueryClient } from '@tanstack/react-query'

// The Finish step: the rough cut and sound, export (free, on the worker),
// download, make another like this, and Fine-tune (the editor over the post).

export function FinishStep({ ctx }: { ctx: PostCtx }) {
  const { item, draft, lib } = ctx
  const duplicate = useDuplicate()
  const qc = useQueryClient()
  const toast = useToast()
  const name = fileSlug(postName({ ...item, title: draft.fields.title, idea: draft.fields.idea }))
  const o = item.outputs
  const sounds = useSounds().data?.sounds ?? []
  // A field in an earlier step: open that step, then go to the field.
  const inStep = (step: 'video' | 'text', field: string) => () => { void draft.go(step); window.setTimeout(() => scrollToField(field), 150) }
  let todo: TodoItem[] = []
  let label = 'Export MP4'
  if (item.kind === 'meme') {
    const s = draft.spec as unknown as MemeSpec
    // The rough cut decides what is in the video (Phase 3).
    const cut = s.cut && !s.cut.auto && s.cut.shots.length ? s.cut : autoCut(s, ctx.data.options.meme.max_broll_seconds)
    const captioned = cut.captions.some(c => (c.text ?? s.caption ?? '').trim())
    todo = [...(!cut.shots.length ? [{ label: 'Pick a clip', target: 'step-video' }] : []), ...(!captioned ? [{ label: 'Write the caption', onGo: inStep('text', 'post-caption') }] : [])]
    const waiting = cut.shots.filter(x => x.kind === 'clip').map(x => lib?.clips.find(c => c.id === x.ref)).some(c => c && c.status !== 'approved')
    if (waiting) todo.push({ label: 'Wait for the clip to be prepared' })
    if (s.continueFrom?.status === 'joining') todo.push({ label: 'Wait for the takes to be joined', target: 'continue-shot' })
    const style = ctx.data.options.edits?.styles.find(x => x.id === editOf(s).style)
    if (style?.shots === 2 && cut.shots.filter(x => x.kind === 'clip').length < 2) todo.push({ label: `Add shot B for the ${style.label.toLowerCase()}`, onGo: inStep('video', 'shot-b') })
    if (style?.needs?.includes('background') && !cut.shots.some(x => x.kind === 'broll')) todo.push({ label: `Pick B-roll or a screenshot for the ${style.label.toLowerCase()} background`, onGo: inStep('video', 'post-broll') })
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
  // A sound picked while it is still being prepared.
  const sp = (draft.spec as { sound?: { ambience?: string; music?: string | null } }).sound
  if (item.kind !== 'slideshow' && sounds.some(x => x.status === 'processing' && (x.id === sp?.ambience || x.id === sp?.music))) todo.push({ label: 'Wait for the sound to be prepared', target: 'post-sound' })
  return (
    <div className="st-col" style={{ gap: 16 }}>
      {item.kind === 'meme' && <RoughCut ctx={ctx} />}
      {item.kind !== 'slideshow' && (
        <section className="st-card" data-field="post-edit">
          <div className="st-card-head"><div className="grow"><div className="st-h3">Edit style</div><div className="st-hint">A finishing edit, rendered by code with the export. Default: None.</div></div></div>
          <div className="st-card-body"><EditStylePicker ctx={ctx} mode="finish" /></div>
        </section>
      )}
      {item.kind !== 'slideshow' && <SoundRow ctx={ctx} />}
      <ExportPanel item={item} todo={todo} saving={draft.saving} flush={draft.flush} label={label} onStart={() => void ctx.advance('finish')}>
        {item.kind === 'meme' && item.status === 'ready' && o.videoAssetId && (
          <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <video className="st-content-result" src={assetUrl(o.videoAssetId)} controls playsInline />
            <div className="st-col" style={{ gap: 6 }}>
              <DownloadLink assetId={o.videoAssetId} name={`${name}.mp4`}>Download MP4</DownloadLink>
              {o.editNote && <span className="st-hint">Edit: {o.editNote}</span>}
            </div>
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
            {(o.zipParts?.length ?? 0) > 1
              ? <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>{o.zipParts!.map((z, i) => <DownloadLink key={z.assetId} assetId={z.assetId} name={`${name}-batch-part${i + 1}.zip`}>Part {i + 1} (videos {z.from} to {z.to})</DownloadLink>)}<span className="st-hint">Each part has captions.txt.</span></div>
              : o.zipAssetId && <div className="st-row"><DownloadLink assetId={o.zipAssetId} name={`${name}-batch.zip`}>Download all (zip, with captions.txt)</DownloadLink></div>}
            {item.status !== 'rendering' && (o.failed ?? 0) > 0 && (
              <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <AsyncButton className="st-btn sm" icon={<RotateCcw size={13} />} onClick={async () => { try { await api.retryFailed(item.id); await qc.invalidateQueries({ queryKey: keys.content }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } }}>Retry the failed ones ({o.failed})</AsyncButton>
                <span className="st-hint">Free. Only those videos render again.</span>
              </div>
            )}
            {Object.entries(o.errors ?? {}).filter(([k]) => !o.videos?.[Number(k)]).slice(0, 5).map(([k, msg]) => <span key={k} className="st-hint st-warntext">{msg}</span>)}
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
        {item.kind === 'meme' && <Link className="st-btn" to={`/studio/posts/${item.id}/edit`} onClick={() => void draft.flush()} title="The rough cut as layers, full screen; Done saves and exports"><Scissors size={15} />Fine-tune</Link>}
      </div>
    </div>
  )
}
