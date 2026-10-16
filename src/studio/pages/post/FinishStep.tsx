import { CopyPlus, Download, RotateCcw } from 'lucide-react'
import { api, assetUrl, downloadUrl } from '../../api'
import { AsyncButton, Img, errorMessage, scrollToField, useToast, type TodoItem } from '../../ui'
import type { BatchSpec, MemeSpec, SlideshowSpec } from '../../types'
import { DownloadLink, ExportPanel, fileSlug, postName, renderFailure, useDuplicate } from './parts'
import type { PostCtx } from './ctx'
import { SoundRow, autoCut } from './SoundRow'
import { editOf } from './EditStyles'
import { EditorCard } from './EditorCard'
import { BatchStyle } from './BatchStyle'
import { CoverCard, ExportFor, HookVariants } from './ExportExtras'
import { ReuseWarning, SlideshowOutputs, VariationsCard } from './slideshow/SlideshowFinish'
import { slideshowProblemsClient } from './slideshow/problems'
import { keys, useSounds } from '../../hooks'
import { useQueryClient } from '@tanstack/react-query'

// The Finish step: the timeline (Open the editor, UX-PLAN.md section 12),
// sound, export (free, on the worker), download, and make another like
// this. Edits are placed in the editor, never guessed for the whole video.

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
    // A caption is optional (owner, 2026-10-15): none means no caption.
    todo = !cut.shots.length ? [{ label: 'Pick a clip', target: 'step-video' }] : []
    const waiting = cut.shots.filter(x => x.kind === 'clip').map(x => lib?.clips.find(c => c.id === x.ref)).some(c => c && c.status !== 'approved')
    if (waiting) todo.push({ label: 'Wait for the clip to be prepared' })
    if (s.continueFrom?.status === 'joining') todo.push({ label: 'Wait for the takes to be joined', target: 'continue-shot' })
    // A post edited in the editor exports its saved timeline on the worker
    // (editor phase D); the Format's shot B and background apply only
    // before that.
    const style = s.editor?.projectAssetId ? undefined : ctx.data.options.edits?.styles.find(x => x.id === editOf(s).style)
    if (style?.shots === 2 && cut.shots.filter(x => x.kind === 'clip').length < 2) todo.push({ label: `Add shot B for the ${style.label.toLowerCase()}`, onGo: inStep('video', 'shot-b') })
    if (style?.needs?.includes('background') && !cut.shots.some(x => x.kind === 'broll')) todo.push({ label: `Pick B-roll or a screenshot for the ${style.label.toLowerCase()} background`, onGo: inStep('video', 'post-broll') })
  } else if (item.kind === 'slideshow') {
    todo = slideshowProblemsClient(draft.spec as unknown as SlideshowSpec)
    label = 'Export images'
  } else {
    const s = draft.spec as unknown as BatchSpec
    const lines = Math.min((s.captions ?? []).filter(c => c.trim()).length, ctx.data.options.batch.max)
    // Captions are optional: the lines count the videos, else How many does.
    const n = lines || Math.min(s.count, ctx.data.options.batch.max)
    todo = !s.clipIds?.length ? [{ label: 'Pick a clip', target: 'batch-clips' }] : []
    label = `Make ${n} videos`
  }
  // A sound picked while it is still being prepared.
  const sp = (draft.spec as { sound?: { ambience?: string; music?: string | null } }).sound
  if (item.kind !== 'slideshow' && sounds.some(x => x.status === 'processing' && (x.id === sp?.ambience || x.id === sp?.music))) todo.push({ label: 'Wait for the sound to be prepared', target: 'post-sound' })
  return (
    <div className="st-col" style={{ gap: 16 }}>
      {item.kind === 'meme' && <EditorCard ctx={ctx} />}
      {item.kind === 'slideshow' && <ReuseWarning ctx={ctx} />}
      {item.kind !== 'slideshow' && <SoundRow ctx={ctx} />}
      {item.kind === 'batch' && <BatchStyle ctx={ctx} />}
      {item.kind !== 'slideshow' && <ExportFor ctx={ctx} />}
      <ExportPanel item={item} todo={todo} saving={draft.saving} flush={draft.flush} label={label} onStart={() => void ctx.advance('finish')}>
        {item.kind === 'meme' && item.status === 'ready' && o.videoAssetId && (
          <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <video className="st-content-result" src={assetUrl(o.videoAssetId)} controls playsInline />
            <div className="st-col" style={{ gap: 6 }}>
              <DownloadLink assetId={o.videoAssetId} name={`${name}.mp4`}>Download MP4</DownloadLink>
              {o.fromEditor && <span className="st-hint">Exported from the editor.</span>}
              {o.fromTimeline && <span className="st-hint">Rendered from your timeline on the worker.</span>}
              {o.preset && <span className="st-hint" data-field="export-made-for">Made for {(ctx.data.options.exportPresets ?? []).find(p => p.id === o.preset)?.label ?? o.preset}{o.capped ? ', the bitrate capped' : ''}.</span>}
              {!!o.editorOnly?.length && <span className="st-hint st-warntext">Only the editor's export has: {o.editorOnly.join('; ')}. Open the editor and press Done for them.</span>}
              {o.editNote && <span className="st-hint">Edit: {o.editNote}</span>}
            </div>
          </div>
        )}
        {item.kind === 'slideshow' && <SlideshowOutputs ctx={ctx} name={name} />}
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
            {Object.entries(o.errors ?? {}).filter(([k]) => !o.videos?.[Number(k)]).slice(0, 5).map(([k, msg]) => <span key={k} className="st-hint st-warntext" title={renderFailure(msg).detail ?? undefined}>Video {Number(k) + 1}: {renderFailure(msg).plain}</span>)}
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
      {item.kind === 'meme' && <CoverCard ctx={ctx} />}
      {item.kind === 'meme' && <HookVariants ctx={ctx} />}
      {item.kind === 'slideshow' && <VariationsCard ctx={ctx} />}
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="st-btn" onClick={() => void duplicate(item.id)}><CopyPlus size={15} />Make another like this</button>
      </div>
    </div>
  )
}
