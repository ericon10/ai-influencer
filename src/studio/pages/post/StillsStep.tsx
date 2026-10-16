import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Images, Minus, Plus, SkipForward } from 'lucide-react'
import { api, ApiError } from '../../api'
import { keys, useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { LibraryDrawer, StillUpload } from '../../library'
import { AsyncButton, Callout, Img, errorMessage, useToast } from '../../ui'
import type { SceneStill, SlideshowSpec } from '../../types'
import { SceneStills } from '../character/SceneStills'
import type { PostCtx } from './ctx'
import { SlideshowStills } from './slideshow/SlideshowStills'
import { editSlides, slideList } from '../../../../server/core/slides'

// The Stills step: make stills from the idea right here (Write and
// generate), or pick them from the Library drawer. A video post uses one
// still to animate ("Use this still" also writes the video prompt, priced);
// a slideshow collects several, in order.

export function stillsSummary(ctx: PostCtx) {
  if (ctx.item.kind === 'slideshow') {
    const list = slideList(ctx.draft.spec as unknown as SlideshowSpec)
    const pictured = list.filter(x => x.stillId || x.special).length
    return list.length ? `${pictured} of ${list.length} slides have a picture` : 'No slides yet'
  }
  const id = (ctx.draft.spec as { stillId?: string | null }).stillId
  const still = id ? ctx.lib?.stills.find(s => s.id === id) : undefined
  return still ? <span className="st-row" style={{ gap: 8 }}><Img assetId={still.assetId} width={80} className="st-sumthumb" />Using a still from {still.sceneTitle || 'a scene'}</span> : 'Skipped; the clip comes from an upload or the Library'
}

export function StillsStep({ ctx }: { ctx: PostCtx }) {
  const { item, draft, v, scenes, scene, lib } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const [library, setLibrary] = useState(false)
  const ready = !!v?.sheet.shots[0]?.approved
  const idea = draft.fields.idea.trim()
  const slideshow = item.kind === 'slideshow'
  const stillIds = slideshow ? ((draft.spec as unknown as SlideshowSpec).stillIds ?? []) : []
  const stillId = (draft.spec as { stillId?: string | null }).stillId ?? null

  // The post's scene is made from the idea (free) once there is one, so the
  // price of Write and generate can show right away.
  const making = useRef(false)
  const savedIdea = item.idea.trim()
  useEffect(() => {
    if (item.sceneId || !ready || savedIdea.length < 3 || making.current) return
    making.current = true
    api.postScene(item.id)
      .then(() => { qc.invalidateQueries({ queryKey: keys.content }); if (item.characterId) qc.invalidateQueries({ queryKey: keys.scenes(item.characterId) }) })
      .catch(e => toast({ tone: 'bad', text: errorMessage(e) }))
      .finally(() => { making.current = false })
  }, [item.sceneId, item.id, ready, savedIdea]) // eslint-disable-line react-hooks/exhaustive-deps

  // A still picked from the Library: its scene becomes the post's scene.
  async function pickFromLibrary(id: string) {
    const s = lib?.stills.find(x => x.id === id)
    if (!s) return
    if (slideshow) { toggle(id); return }
    try {
      if (s.sceneId && s.sceneId !== item.sceneId) await api.updateContent(item.id, { sceneId: s.sceneId })
      await ctx.advance('video', { stillId: id })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  // A slideshow: picking adds a slide at the end with that picture (the
  // words, shots and places of the slides before it stay with them);
  // picking it again takes it out.
  function toggle(id: string) {
    const max = ctx.data.options.slideshow.maxStills
    const s = draft.spec as unknown as SlideshowSpec
    const list = slideList(s)
    const at = list.findIndex(x => x.stillId === id)
    if (at >= 0) { draft.setSpec(editSlides(s, { remove: at }) as never); return }
    if (list.length >= max) return
    const added = editSlides(s, { add: list.length })
    draft.setSpec({ ...added, stillIds: added.stillIds.map((x, i) => (i === list.length ? id : x)) } as never)
  }

  const name = v?.data.name ?? 'this character'
  if (slideshow) return (
    <div className="st-col" style={{ gap: 16 }}>
      <SlideshowStills ctx={ctx} />
      <details className="st-card st-more" data-field="slideshow-more-stills">
        <summary className="st-card-head st-row st-more-head" style={{ cursor: 'pointer' }}><Images size={15} /><div className="grow"><div className="st-h3">More ways to add pictures</div><div className="st-hint">Pick several from the Library, upload several, or make stills of the post's scene and add them. Each adds a slide at the end.</div></div></summary>
        <div className="st-card-body st-col" style={{ gap: 12 }}>{legacy()}</div>
      </details>
    </div>
  )
  return legacy()

  function legacy() { return (
    <div className="st-col" style={{ gap: 16 }}>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="st-btn" onClick={() => setLibrary(true)} disabled={!item.characterId}><Images size={15} />Pick {slideshow ? 'stills' : 'a still'} from the Library</button>
        {!slideshow && <button type="button" className="st-btn ghost" onClick={() => void ctx.advance('video')}><SkipForward size={15} />Skip: I have a clip</button>}
      </div>
      {slideshow && item.characterId && (
        <StillUpload characters={v ? [{ id: v.id, name: v.data.name }] : []} characterId={item.characterId} contentId={item.id}
          onUploaded={ids => {
            let s = draft.spec as unknown as SlideshowSpec
            for (const id of ids) {
              const list = slideList(s)
              if (list.length >= ctx.data.options.slideshow.maxStills || list.some(x => x.stillId === id)) continue
              const added = editSlides(s, { add: list.length })
              s = { ...s, ...added, stillIds: added.stillIds.map((x, i) => (i === list.length ? id : x)) }
            }
            draft.setSpec({ hook: s.hook, slides: s.slides, stillIds: s.stillIds, shots: s.shots, specials: s.specials, textPos: s.textPos } as never)
          }} />
      )}

      {!ready ? (
        v && <Callout tone="info">To make new stills of {name}, set up {v.data.pronouns.poss} face and reference sheet first (<Link to={`/studio/characters/${v.id}`}>set up {name}</Link>). Stills already in the Library work now.</Callout>
      ) : !scene || !scenes || !v ? (
        savedIdea.length < 3
          ? <Callout tone="info">Write the idea in step 1 and the stills can be made right here.</Callout>
          : <div className="st-skel" style={{ height: 220, borderRadius: 18 }} />
      ) : (
        <SceneStills
          v={v} data={scenes} scene={scene}
          picked={slideshow ? stillIds : stillId ? [stillId] : []}
          onStarted={() => void ctx.advance('stills')}
          onEditDetails={() => ctx.open('idea', { field: 'post-more', more: true })}
          action={c => (slideshow ? <AddToSlideshow c={c} on={stillIds.includes(c.id)} n={stillIds.indexOf(c.id)} toggle={() => toggle(c.id)} /> : <UseStill ctx={ctx} c={c} used={c.id === stillId} />)}
        />
      )}
      {idea !== savedIdea && scene && <span className="st-hint">Saving your idea...</span>}

      {item.characterId && (
        <LibraryDrawer open={library} onClose={() => setLibrary(false)} kind="stills" characterId={item.characterId} characterName={name} picked={slideshow ? stillIds : stillId ? [stillId] : []} multi={slideshow} onPick={id => void pickFromLibrary(id)} />
      )}
    </div>
  ) }
}

function AddToSlideshow({ on, n, toggle }: { c: SceneStill; on: boolean; n: number; toggle: () => void }) {
  return on
    ? <button type="button" className="st-btn sm ok" onClick={toggle}><Minus size={14} />Slide {n + 1}: remove</button>
    : <button type="button" className="st-btn sm" onClick={toggle}><Plus size={14} />Add to the slideshow</button>
}

// "Use this still": picks it (it becomes the start frame) and, with the
// prompt writer on, writes the video prompt from it at the same time (priced
// on the button). The post moves on to the Video step.
function UseStill({ ctx, c, used }: { ctx: PostCtx; c: SceneStill; used: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const { scene, scenes, item } = ctx
  if (!scene || !scenes || !item.characterId) return null
  if (used) return <span className="st-badge ok"><CheckCircle2 size={12} /> Used for the video</span>
  const motion = (scene.fields.moment || scene.brief || ctx.draft.fields.idea).trim()
  const pw = scenes.options.promptWriter
  async function use(acknowledge = false) {
    try {
      if (c.status !== 'approved') await api.approve(c.id, acknowledge)
      refresh(item.characterId!)
      await ctx.advance('video', { stillId: c.id })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_required') toast({ tone: 'bad', text: 'The face in this still does not match REF-00.', action: { label: 'Use it anyway', run: () => void use(true) } })
      else toast({ tone: 'bad', text: errorMessage(e) })
    }
  }
  if (pw.on && motion.length >= 3) {
    return (
      <PriceButton
        size="sm" icon={false} label="Use this still"
        action={{ type: 'scene_prompt', characterId: item.characterId, sceneId: scene.id, target: 'video', motion, directions: scenes.options.video.directions, startCandidateId: c.id }}
        onStarted={() => void use()}
      />
    )
  }
  return <AsyncButton className="st-btn sm primary" onClick={() => use()} icon={<CheckCircle2 size={14} />}>Use this still</AsyncButton>
}
