import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Link2, Loader2, Scissors, X } from 'lucide-react'
import { api } from '../../api'
import { keys, useRefresh } from '../../hooks'
import { RunStatus } from '../../runs'
import { AsyncButton, Callout, Img, errorMessage, useToast } from '../../ui'
import type { ContinueFrom, LibraryClip } from '../../types'
import { VideoSection } from '../character/VideoSection'
import type { PostCtx } from './ctx'

// "Continue this shot" (Phase 3 chaining; UX-PLAN.md section 8). The kept
// clip's last frame starts the next take on the same model, with the same
// place, light, wardrobe and camera. "Use this take" joins the takes into
// one longer clip on the worker: the seam is scored and cut or color
// matched, never crossfaded. A seam that fails can become two shots.

function useAct() {
  const qc = useQueryClient()
  const toast = useToast()
  return async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: keys.content })
      qc.invalidateQueries({ queryKey: ['cut'] })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
}

export function ContinueButton({ ctx, clip }: { ctx: PostCtx; clip: LibraryClip }) {
  const act = useAct()
  const max = ctx.data.options.chain?.maxParts ?? 4
  return (
    <div className="st-col" style={{ gap: 4, alignItems: 'flex-start' }}>
      <AsyncButton className="st-btn sm" icon={<Link2 size={14} />} onClick={() => act(() => api.continueShot(ctx.item.id))} title="Free: the last frame becomes the start frame of the next take">
        Continue this shot
      </AsyncButton>
      <span className="st-hint">Free. Its last frame starts the next take on the same model; the takes join into one longer clip (up to {max} takes).</span>
    </div>
  )
}

export function ContinuePanel({ ctx, clip, cont }: { ctx: PostCtx; clip: LibraryClip | null; cont: ContinueFrom }) {
  const act = useAct()
  const refresh = useRefresh()
  const { item, v, scenes, scene } = ctx
  const frame = scene?.candidates.find(c => c.id === cont.frameId) ?? null
  const working = cont.status === 'preparing' || cont.status === 'joining'
  // The frame is a new still of the post's scene: look at the scene again
  // once it exists, so the next take starts from it.
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (cont.frameId && !frame && v && asked.current !== cont.frameId) { asked.current = cont.frameId; refresh(v.id) }
  }, [cont.frameId, frame, v, refresh])
  return (
    <div className="st-card pad st-col st-continue" style={{ gap: 14 }} data-field="continue-shot">
      <div className="st-row" style={{ gap: 12, alignItems: 'flex-start' }}>
        {frame?.assetId ? <Img assetId={frame.assetId} width={160} className="st-continue-frame" alt="The last frame" /> : <div className="st-continue-frame st-skel" />}
        <div className="st-col" style={{ gap: 4, flex: 1, minWidth: 200 }}>
          <span className="st-label">Continue this shot</span>
          <b>From the last frame of: {clip ? clip.title : 'the clip'}</b>
          <span className="st-hint">The next take starts on this frame with the same model, place, light, wardrobe and camera. Use a take, and the two join into one longer clip.</span>
        </div>
        {!working && <AsyncButton className="st-btn sm ghost" icon={<X size={13} />} onClick={() => act(() => api.cancelContinue(item.id))}>Stop continuing</AsyncButton>}
      </div>
      <RunStatus match={j => j.purpose === `chain_frame:${item.id}` || j.purpose === `chain_join:${item.id}`} />
      {cont.status === 'preparing' && <Callout tone="info" icon={<Loader2 size={16} className="st-spin" />}>Taking the last frame at full size (stepping back a moment if it is blurry)...</Callout>}
      {cont.status === 'joining' && <Callout tone="info" icon={<Loader2 size={16} className="st-spin" />}>Joining the takes into one clip: the handoff frame is dropped and the seam is scored. Never a crossfade.</Callout>}
      {cont.status === 'failed' && cont.error && (
        <Callout tone="warn" icon={<AlertTriangle size={16} />}>
          {cont.error}
          {cont.takeId && (
            <div className="st-row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <AsyncButton className="st-btn sm" icon={<Scissors size={13} />} onClick={() => act(() => api.twoShots(item.id))}>Keep them as two shots</AsyncButton>
              <span className="st-hint">Or make another take below and use that one.</span>
            </div>
          )}
        </Callout>
      )}
      {cont.frameId && !frame && cont.status === 'ready' && <Callout tone="info" icon={<Loader2 size={16} className="st-spin" />}>Loading the frame...</Callout>}
      {cont.frameId && frame && scene && scenes && v && cont.status !== 'joining' && (
        <VideoSection
          v={v} data={scenes} scene={scene} startId={cont.frameId} setStartId={() => undefined}
          preferModel={cont.model} takesFrom={cont.frameId}
          onUseTake={id => act(async () => { await api.chainUse(item.id, id); refresh(v.id) })}
        />
      )}
    </div>
  )
}
