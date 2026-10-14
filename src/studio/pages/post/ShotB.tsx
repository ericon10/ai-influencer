import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Crop, Images, Wand2, X } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { keys } from '../../hooks'
import { ClipUpload, LibraryDrawer } from '../../library'
import { PriceButton } from '../../PriceButton'
import { RunStatus } from '../../runs'
import { AsyncButton, Callout, Field, Img, errorMessage, useToast } from '../../ui'
import type { EditStyleView, LibraryClip, MemeSpec } from '../../types'
import { VideoSection } from '../character/VideoSection'
import type { PostCtx } from './ctx'

// Shot B of a two-shot edit (Phase 5; UX-PLAN.md section 10): a crash zoom
// cut, a whip pan or a hand over the lens. Its direction is already in its
// take's prompt. Make it from a still, pick it from the Library, or upload
// it; for a crash zoom, Make the close-up crops shot A's last frame (free),
// then the priced Upscale 2x and Generate a take follow.

export function ShotB({ ctx, style }: { ctx: PostCtx; style: EditStyleView }) {
  const { item, draft, v, scenes, scene, lib } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const spec = draft.spec as unknown as MemeSpec
  const clips = lib?.clips ?? []
  const b: LibraryClip | null = clips.find(c => c.id === spec.clipB) ?? null
  const [way, setWay] = useState<'still' | null>(spec.stillB && !spec.clipB ? 'still' : null)
  const [library, setLibrary] = useState(false)
  const name = v?.data.name ?? 'this character'
  const closeup = scene?.candidates.find(c => c.id === spec.stillB) ?? null
  const upscaled = closeup ? scene?.candidates.find(c => c.parentId === closeup.id && c.op === 'upscale' && c.assetId) ?? null : null
  const use = (id: string) => { setWay(null); draft.setSpec({ clipB: id } as never) }
  async function makeCloseup() {
    try {
      await api.makeCloseup(item.id)
      await qc.invalidateQueries({ queryKey: keys.content })
      setWay('still')
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <Field id="shot-b" label={`Shot B for the ${style.label.toLowerCase()}`} required done={!!b} group hint={`Its direction, added to the take: ${style.slots?.b ?? ''}`}>
      {b ? (
        <div className="st-row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {b.assetId ? <video className="st-clip" style={{ width: 120, aspectRatio: '9 / 16' }} src={assetUrl(b.assetId)} muted loop playsInline autoPlay /> : <div className="st-clip st-clip-empty" style={{ width: 120, aspectRatio: '9 / 16' }} />}
          <div className="st-col" style={{ gap: 6 }}>
            <b>{b.title}</b>
            <span className="st-hint">{b.status === 'approved' ? `${b.durationSec ? `${b.durationSec} s, ` : ''}cut in right after shot A.` : 'Being prepared; it is ready in a moment.'}</span>
            <button type="button" className="st-btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => draft.setSpec({ clipB: null } as never)}><X size={13} />Use a different shot B</button>
          </div>
        </div>
      ) : (
        <>
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {style.id === 'crash_zoom' && <AsyncButton className="st-btn" icon={<Crop size={15} />} onClick={makeCloseup} disabled={!spec.clipId} title={spec.clipId ? 'Free: crops shot A\'s last frame around her face' : 'Pick shot A first'}>Make the close-up</AsyncButton>}
            <button type="button" className={`st-btn ${way === 'still' ? '' : 'ghost'}`} onClick={() => setWay(w => (w === 'still' ? null : 'still'))}><Wand2 size={15} />Make it from a still</button>
            <button type="button" className="st-btn ghost" onClick={() => setLibrary(true)}><Images size={15} />Pick from the Library</button>
            {item.characterId && <ClipUpload characterId={item.characterId} contentId={item.id} slot="b" label="Upload shot B" variant="ghost" onUploaded={() => void qc.invalidateQueries({ queryKey: keys.content })} />}
          </div>
          <RunStatus match={j => j.purpose === `closeup:${item.id}`} />
          {closeup?.assetId && (
            <div className="st-row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Img assetId={upscaled?.assetId ?? closeup.assetId} width={200} style={{ width: 90, aspectRatio: '9 / 16', borderRadius: 8 }} />
              <div className="st-col" style={{ gap: 6 }}>
                <b>The close-up</b>
                <span className="st-hint">{upscaled ? 'Upscaled. It is the start frame below.' : 'Cropped from shot A, free. Upscale it first for a sharper take (priced), or use it as it is.'}</span>
                {!upscaled && v && <PriceButton label="Upscale 2x" variant="secondary" size="sm" action={{ type: 'scene_upscale', characterId: v.id, candidateId: closeup.id }} />}
              </div>
            </div>
          )}
          {way === 'still' && (
            !scene || !scenes || !v ? <Callout tone="info">Shot B starts from a still of this post. Make one in the Stills step, or use Make the close-up.</Callout>
              : <VideoSection v={v} data={scenes} scene={scene} startId={upscaled?.id ?? spec.stillB ?? null} setStartId={id => draft.setSpec({ stillB: id } as never)} onUseTake={use} usedId={spec.clipB} extraDirections={style.slots?.b ?? ''} />
          )}
        </>
      )}
      {item.characterId && <LibraryDrawer open={library} onClose={() => setLibrary(false)} kind="clips" characterId={item.characterId} characterName={name} picked={spec.clipB ? [spec.clipB] : []} onPick={id => { setLibrary(false); use(id) }} />}
    </Field>
  )
}
