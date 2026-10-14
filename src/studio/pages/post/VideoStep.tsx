import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clapperboard, Film, Images, Wand2, X } from 'lucide-react'
import { assetUrl } from '../../api'
import { ClipGrid, ClipUpload, LibraryDrawer } from '../../library'
import { Callout, Field } from '../../ui'
import type { BatchSpec, BrollTiming, LibraryClip, MemeSpec } from '../../types'
import { VideoSection } from '../character/VideoSection'
import { BrollPicker } from './parts'
import { ClonePanel } from './ClonePanel'
import { RecreateBatch } from './RecreatePanel'
import { ContinueButton, ContinuePanel } from './ContinueShot'
import { ShotB } from './ShotB'
import { editOf } from './EditStyles'
import type { PostCtx } from './ctx'

// The Video step. A video post gets its clip four ways, all right here:
// a video from a still (takes; picking one keeps it), clone a TikTok or
// Reel, upload a video, or pick one from the Library drawer. A batch picks
// several clips, rotated across its captions (clones of its character can
// be added too). B-roll is optional. "?clone=1" opens the clone option
// ("New post from a TikTok").

export function videoSummary(ctx: PostCtx) {
  if (ctx.item.kind === 'batch') {
    const s = ctx.draft.spec as unknown as BatchSpec
    const n = s.clipIds?.length ?? 0, b = s.brollIds?.length ?? 0
    return `${n} clip${n === 1 ? '' : 's'}${b ? `, ${b} B-roll` : ''}${n > 1 || b > 1 ? ', rotated' : ''}`
  }
  const s = ctx.draft.spec as unknown as MemeSpec
  const clip = ctx.lib?.clips.find(c => c.id === s.clipId)
  const broll = ctx.data.broll.find(b => b.id === s.brollId)
  return clip ? `${clip.title}${broll ? `, then B-roll: ${broll.title}` : ''}` : 'No clip yet'
}

type Way = 'animate' | 'clone'

export function VideoStep({ ctx }: { ctx: PostCtx }) {
  return ctx.item.kind === 'batch' ? <BatchClips ctx={ctx} /> : <PostClip ctx={ctx} />
}

function PostClip({ ctx }: { ctx: PostCtx }) {
  const { item, data, draft, v, scenes, scene, lib } = ctx
  const spec = draft.spec as unknown as MemeSpec
  const clips = lib?.clips ?? []
  const clip = clips.find(c => c.id === spec.clipId) ?? null
  const hasStills = !!scene?.candidates.some(c => c.media === 'image' && c.assetId)
  const [params] = useSearchParams()
  // A post started from a real clip opens at Recreate.
  const fromClip = (spec as { start?: string }).start === 'clip'
  const [way, setWay] = useState<Way | null>(params.get('clone') || ((spec.clone || fromClip) && !clip) ? 'clone' : spec.stillId || (hasStills && !clip) ? 'animate' : null)
  // A still picked in the Stills step opens "Make a video from a still" here.
  useEffect(() => { if (spec.stillId && !spec.clipId) setWay('animate') }, [spec.stillId]) // eslint-disable-line react-hooks/exhaustive-deps
  // A clip brought in from the Idea step (or a Recreate link) opens Recreate.
  useEffect(() => { if ((spec.clone || fromClip) && !spec.clipId) setWay('clone') }, [!!spec.clone, fromClip]) // eslint-disable-line react-hooks/exhaustive-deps
  const [changing, setChanging] = useState(false)
  const [library, setLibrary] = useState(false)
  const name = v?.data.name ?? 'this character'
  const use = (id: string) => { setChanging(false); void ctx.advance('text', { clipId: id }) }
  // "Continue this shot" (Phase 3): the clip is being continued.
  const cont = spec.continueFrom ?? null
  // A two-shot edit (Phase 5) plans shot A (this clip) and shot B.
  const twoShot = data.options.edits?.styles.find(s => s.id === editOf(spec).style && s.shots === 2) ?? null
  // The green screen uses the B-roll as her background.
  const bgStyle = data.options.edits?.styles.find(s => s.id === editOf(spec).style && s.needs?.includes('background')) ?? null
  const showWays = (!clip || changing) && !cont

  return (
    <div className="st-col" style={{ gap: 16 }}>
      {twoShot && <Callout tone="info"><b>{twoShot.label}:</b> two shots. Shot A is the clip here ({twoShot.slots?.a}); shot B comes right after it, below. Both directions are added to their takes.</Callout>}
      {clip && (
        <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <ClipPreview clip={clip} />
          <div className="st-col" style={{ gap: 6, minWidth: 0 }}>
            <span className="st-label">The clip</span>
            <b>{clip.title}</b>
            <span className="st-hint">{clip.status === 'approved' ? `${clip.durationSec ? `${clip.durationSec} s, ` : ''}kept in Library > Clips.` : clip.status === 'failed' ? clip.error : 'Being prepared; it is ready in a moment.'}</span>
            {!changing && !cont && (
              <div className="st-row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <button type="button" className="st-btn sm ghost" onClick={() => setChanging(true)}>Use a different clip</button>
              </div>
            )}
            {!changing && !cont && clip.status === 'approved' && <ContinueButton ctx={ctx} clip={clip} />}
          </div>
        </div>
      )}
      {cont && <ContinuePanel ctx={ctx} clip={clip} cont={cont} />}
      {showWays && (
        <>
          <div className="st-ways">
            <button type="button" className={`st-way ${way === 'animate' ? 'on' : ''}`} onClick={() => setWay(w => (w === 'animate' ? null : 'animate'))}><Wand2 size={18} /><b>Make a video from a still</b><span className="st-hint">Real video starting from your photo (Kling, Seedance...)</span></button>
            <button type="button" className={`st-way ${way === 'clone' ? 'on' : ''}`} onClick={() => setWay(w => (w === 'clone' ? null : 'clone'))}><Clapperboard size={18} /><b>Start from a real clip</b><span className="st-hint">Recreate a TikTok or Reel with {name}, or replace the person</span></button>
            {item.characterId && (
              <div className="st-way as-upload">
                <Film size={18} /><b>Upload a video</b><span className="st-hint">Any video file</span>
                <ClipUpload characterId={item.characterId} contentId={item.id} label="Choose a file" variant="sm" onUploaded={() => { setChanging(false); void ctx.advance('text') }} />
              </div>
            )}
            <button type="button" className="st-way" onClick={() => setLibrary(true)}><Images size={18} /><b>Pick from the Library</b><span className="st-hint">{clips.filter(c => c.status === 'approved').length} kept clips of {name}</span></button>
          </div>
          {way === 'animate' && (
            !scene || !scenes || !v ? <Callout tone="info">A video from a still starts from a photo of this post. Make one in the Stills step, or pick one there from the Library.</Callout>
              : !hasStills ? <Callout tone="info">No stills in this post yet. Make one in the Stills step above, then make the video from it here.</Callout>
              : <VideoSection v={v} data={scenes} scene={scene} startId={spec.stillId} setStartId={id => draft.setSpec({ stillId: id })} onUseTake={use} usedId={spec.clipId} extraDirections={twoShot?.slots?.a ?? ''} />
          )}
          {way === 'clone' && <ClonePanel ctx={ctx} onUse={use} usedIds={spec.clipId ? [spec.clipId] : []} />}
        </>
      )}
      {twoShot && <ShotB ctx={ctx} style={twoShot} />}
      <Field id="post-broll" label={bgStyle ? `Background for the ${bgStyle.label.toLowerCase()}` : 'B-roll (optional)'} required={!!bgStyle} done={!!spec.brollId} group hint={bgStyle ? 'A screen recording, a post, or a screenshot (upload an image): it sits behind her, she is cut out over it.' : 'A screen recording or phone video, cut in hard before or after the clip.'}>
        <BrollPicker data={data} ids={spec.brollId ? [spec.brollId] : []} multi={false} onChange={ids => draft.setSpec({ brollId: ids[0] ?? null })} timing={spec} setTiming={(p: Partial<BrollTiming>) => draft.setSpec(p)} />
      </Field>
      {item.characterId && (
        <LibraryDrawer open={library} onClose={() => setLibrary(false)} kind="clips" characterId={item.characterId} characterName={name} picked={spec.clipId ? [spec.clipId] : []} onPick={use} />
      )}
    </div>
  )
}

function ClipPreview({ clip, width = 150 }: { clip: LibraryClip; width?: number }) {
  if (clip.status !== 'approved' || !clip.assetId) return <div className="st-clip st-clip-empty" style={{ width, aspectRatio: '9 / 16' }} />
  return <video className="st-clip" style={{ width, aspectRatio: '9 / 16' }} src={assetUrl(clip.assetId)} poster={clip.posterId ? assetUrl(clip.posterId, 320) : undefined} muted loop playsInline autoPlay />
}

function BatchClips({ ctx }: { ctx: PostCtx }) {
  const { item, data, draft, v, lib } = ctx
  const spec = draft.spec as unknown as BatchSpec
  const ids = spec.clipIds ?? []
  const [library, setLibrary] = useState(false)
  const [params] = useSearchParams()
  const [cloning, setCloning] = useState(!!params.get('clone') || !!spec.clone)
  const [recreating, setRecreating] = useState(!!(spec as { recreate?: { rows?: unknown[] } | null }).recreate?.rows?.length)
  const picked = ids.map(id => lib?.clips.find(c => c.id === id)).filter((c): c is LibraryClip => !!c)
  const name = v?.data.name ?? 'this character'
  const toggle = (id: string) => { void ctx.advance('video', { clipIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(0, 20) }) }
  return (
    <div className="st-col" style={{ gap: 16 }}>
      <Field id="batch-clips" label={`Clips (${ids.length})`} required done={ids.length > 0} group hint="Several clips rotate across the captions: video 1 uses clip 1, video 2 clip 2, and so on.">
        {picked.length > 0 && <ClipGrid clips={picked} action={c => <button type="button" className="st-btn sm ghost" onClick={() => toggle(c.id)}><X size={13} />Remove</button>} />}
        {picked.some(c => c.status !== 'approved') && <span className="st-hint">Uploads are being prepared; they are ready in a moment.</span>}
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="st-btn" onClick={() => setLibrary(true)}><Images size={15} />Pick from the Library</button>
          {item.characterId && <ClipUpload characterId={item.characterId} contentId={item.id} onUploaded={() => void ctx.advance('video')} />}
          <button type="button" className={`st-btn ${cloning ? '' : 'ghost'}`} aria-pressed={cloning} onClick={() => setCloning(c => !c)}><Clapperboard size={15} />Clone a TikTok or Reel</button>
        </div>
      </Field>
      {cloning && <ClonePanel ctx={ctx} batch onUse={id => { if (!ids.includes(id)) toggle(id) }} usedIds={ids} />}
      <Field id="batch-recreate" label="Recreate a batch of clips" group hint="Real clips recreated with your characters, step by step together, each row priced.">
        {recreating ? <RecreateBatch ctx={ctx} onTakes={takes => void ctx.advance('video', { clipIds: [...new Set([...ids, ...takes])].slice(0, 20) })} />
          : <button type="button" className="st-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setRecreating(true)}><Clapperboard size={15} />Recreate a batch of clips</button>}
      </Field>
      <Field id="batch-broll" label="B-roll (optional)" group hint="Pick several to rotate them too.">
        <BrollPicker data={data} ids={spec.brollIds ?? []} multi onChange={next => draft.setSpec({ brollIds: next })} timing={spec} setTiming={(p: Partial<BrollTiming>) => draft.setSpec(p)} />
      </Field>
      {item.characterId && (
        <LibraryDrawer open={library} onClose={() => setLibrary(false)} kind="clips" characterId={item.characterId} characterName={name} picked={ids} multi onPick={toggle} />
      )}
    </div>
  )
}

