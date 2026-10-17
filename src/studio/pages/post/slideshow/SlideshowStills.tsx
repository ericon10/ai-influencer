import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Bookmark, Camera, Images, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { api } from '../../../api'
import { useRefresh } from '../../../hooks'
import { PriceButton } from '../../../PriceButton'
import { LibraryDrawer } from '../../../library'
import { Field, errorMessage, useToast, type TodoItem } from '../../../ui'
import { HowTo } from '../../../guide/Guide'
import { SPECIAL_TYPES, backdropFor, editSlides, emptySpecial, setAt, slideList, slidePerson, type SlideEdit, type SlidePerson, type SpecialType } from '../../../../../server/core/slides'
import type { SceneLock, SlideshowSpec } from '../../../types'
import type { PostCtx } from '../ctx'
import { SlideFrame, slideViewerItems } from './SlideFrame'
import { Viewer, useViewer } from '../../../viewer'
import { useSlideFonts } from './draw'
import { StillPaths, type PathModel } from './StillPaths'

// The slideshow's Stills step (UX-PLAN.md section 27): one locked scene so
// the set reads like one camera roll (place, light, phone, outfit, 2
// details; saved and picked in the Scene library), the shape the stills
// are made in, Generate the set (priced, every slide with no picture), and
// a card per slide: its shot, Reroll (priced), a picture from the Library
// or an upload, a special slide (drawn free), the order. Section 30: the
// stills path (the plan or the API) is the pick; each slide's model follows
// who is in it (the slide card says, and switches it).

const IMAGE = /^image\/(png|jpe?g|webp)$/

export function SlideshowStills({ ctx }: { ctx: PostCtx }) {
  const { item, draft, v, scenes, lib } = ctx
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = useRefresh()
  const fonts = useSlideFonts()
  const spec = draft.spec as unknown as SlideshowSpec
  const list = slideList(spec)
  const stills = useMemo(() => new Map((lib?.stills ?? []).map(s => [s.id, s.assetId])), [lib])
  const [pickFor, setPickFor] = useState<number | null>(null)
  // A tap on a slide's photo opens it full size (the viewer, section 34).
  const view = useViewer()
  const [uploadFor, setUploadFor] = useState<number | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const file = useRef<HTMLInputElement | null>(null)
  const models = useQuery({ queryKey: ['slide-still-models', item.characterId], queryFn: () => api.slideStillModels(item.characterId), staleTime: 60_000 })
  const path = spec.stillPath && models.data?.paths.some(p => p.path === spec.stillPath && !p.problem) ? spec.stillPath : models.data?.pick
  const on = models.data?.paths.find(p => p.path === path)
  const name = v?.data.name ?? models.data?.name ?? 'The character'
  const who = { name, pronouns: v?.data.pronouns }
  const ready = !!v?.sheet.shots[0]?.approved
  const topic = spec.mode === 'topic'
  const empty = list.filter(s => !s.stillId && !s.special).length
  // What the picked path makes here: the character's slides and the ones
  // with no one (a topic slideshow has only those).
  const people = list.filter(s => !s.special).map(s => slidePerson(spec, s.index, who))
  const pathModels: PathModel[] = [
    ...(!topic && on?.character && people.includes('character') ? [{ who: `${name}'s slides`, model: on.character }] : []),
    ...(on?.empty && (topic || people.includes('none')) ? [{ who: topic ? 'No one in these photos' : 'Slides with no one', model: on.empty }] : []),
  ]
  const brands = { names: ctx.data.options.slideshow.brandNames ?? [], generic: ctx.data.options.slideshow.genericNames ?? [] }

  function edit(op: SlideEdit) { draft.setSpec(editSlides(spec, op) as never) }
  function setSlide(i: number, patch: { still?: string; shot?: string; special?: SlideshowSpec['specials'][number]; who?: SlidePerson }) {
    const out: Partial<SlideshowSpec> = {}
    if (patch.who !== undefined) out.people = setAt(spec.people ?? [], i, patch.who, '')
    if (patch.still !== undefined) out.stillIds = setAt(list.map(s => s.stillId ?? ''), i, patch.still, '')
    if (patch.shot !== undefined) out.shots = setAt(spec.shots ?? [], i, patch.shot, '')
    if (patch.special !== undefined) out.specials = setAt(spec.specials ?? [], i, patch.special, null)
    draft.setSpec(out as never)
  }
  // A product screenshot (section 28): the owner's upload, placed as it is.
  async function uploadShot(i: number, files: File[]) {
    const image = files.find(f => IMAGE.test(f.type))
    if (!image || !item.characterId) { if (files.length) toast({ tone: 'bad', text: 'Pick a PNG, JPEG or WebP screenshot.' }); return }
    setUploading(i)
    try {
      const bmp = await createImageBitmap(image).catch(() => null)
      const ratio = bmp && bmp.height ? Math.min(10, Math.max(0.1, bmp.width / bmp.height)) : 0.5
      bmp?.close()
      const { stills: up } = await api.addStills(item.characterId, [image], item.id)
      const cur = list[i]?.special
      if (up[0]) setSlide(i, { special: { ...emptySpecial('product_shot'), ...(cur?.type === 'product_shot' ? { scale: cur.scale, variant: cur.variant } : {}), assetId: up[0].assetId, ratio } })
      refresh(item.characterId)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setUploading(null) }
  }
  async function uploadInto(i: number, files: File[]) {
    if (list[i]?.special?.type === 'product_shot') return uploadShot(i, files)
    const images = files.filter(f => IMAGE.test(f.type))
    if (!images.length || !item.characterId) { if (files.length) toast({ tone: 'bad', text: 'Pick a PNG, JPEG or WebP image.' }); return }
    setUploading(i)
    try {
      const { stills: up } = await api.addStills(item.characterId, images.slice(0, 1), item.id)
      if (up[0]) setSlide(i, { still: up[0].id })
      refresh(item.characterId)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setUploading(null) }
  }

  const todo: TodoItem[] = [
    ...(!list.length ? [{ label: 'Draft the slides from a hook (Idea step), or add slides below', target: 'slideshow-hook', onGo: () => ctx.open('idea', { field: 'slideshow-hook' }) }] : []),
    ...(!topic && v && !ready ? [{ label: `${v.data.name}'s face and reference sheet (or pick No one, a topic)` }] : []),
  ]
  return (
    <div className="st-col" style={{ gap: 16 }} data-field="slideshow-stills">
      <SceneCard ctx={ctx} />

      <div className="st-col" style={{ gap: 8 }} data-field="slideshow-generate">
        {models.data && (
          <StillPaths paths={models.data.paths} value={path ?? null} models={pathModels} name={name}
            onPick={p => { draft.setSpec({ stillPath: p } as never); void api.saveSlideStillPath(p).catch(() => undefined) }} />
        )}
        <PriceButton
          label={empty ? `Generate the set (${empty} still${empty === 1 ? '' : 's'})` : list.length ? 'Every slide has a picture' : 'Generate the set'}
          todo={todo} waiting={draft.saving ? 'Saving...' : undefined}
          action={todo.length || draft.saving || !empty || !item.characterId ? null : { type: 'slideshow_stills', contentId: item.id, ...(path ? { path } : {}) }}
          watch={j => j.purpose === `slide_still:${item.id}`}
          onDone={() => { if (item.characterId) refresh(item.characterId); void qc.invalidateQueries({ queryKey: ['estimate'] }) }}
          onStarted={() => void ctx.advance('stills')}
        />
        <span className="st-hint">One still for each slide with no picture, all in the locked scene, at {spec.made === 'instagram' ? '3:4' : '9:16'}. {topic ? 'No one in them.' : `${v?.data.name ?? 'The character'} from ${v?.data.pronouns.poss ?? 'their'} sheet, the same outfit in every photo; the free face and skin checks run on each.`} Special slides are drawn free.</span>
      </div>

      {list.length > 0 && (
        <div className="st-slidecards" data-field="slide-cards">
          {list.map(s => {
            const back = s.special ? backdropFor(list, s.index) : s.stillId
            const asset = back ? stills.get(back) : null
            return (
              <div key={s.index} className={`st-slidecard ${s.special ? 'special' : ''}`} data-field={`slide-card-${s.index}`}>
                {fonts ? (() => {
                  const frame = <SlideFrame slide={s} assetId={asset} style={spec.textStyle} ad={spec.ad && s.index === 0} width={156} frame={spec.made === 'instagram' ? 'instagram' : 'tiktok'} brands={brands} />
                  return asset && !s.special ? <button type="button" className="st-slideframe-open" onClick={() => view.open(`slide-${s.index}`)} aria-label={`View slide ${s.index + 1} full size`}>{frame}</button> : frame
                })() : <div className="st-skel" style={{ width: 156, height: 277 }} />}
                <select className="st-select sm" aria-label={`Slide ${s.index + 1} picture`} value={s.special?.type ?? 'photo'}
                  onChange={e => setSlide(s.index, { special: e.target.value === 'photo' ? null : { ...emptySpecial(e.target.value as SpecialType), ...(s.special ? { from: s.special.from, title: s.special.title, body: s.special.body, lines: s.special.lines } : {}), type: e.target.value as SpecialType } })}>
                  <option value="photo">Photo</option>
                  {SPECIAL_TYPES.map(t => <option key={t.id} value={t.id}>{t.id === 'product_shot' ? `${t.label} (your upload)` : `${t.label} (free)`}</option>)}
                </select>
                {!s.special ? (
                  <>
                    {!topic && (
                      <select className="st-select sm" aria-label={`Slide ${s.index + 1}: who is in the photo`} data-field={`slide-who-${s.index}`} value={slidePerson(spec, s.index, who)}
                        title={spec.people?.[s.index] ? 'Your pick' : 'Read from the shot: a thing or a place is no one'}
                        onChange={e => setSlide(s.index, { who: e.target.value as SlidePerson })}>
                        <option value="character">{name} in it{on?.character ? ` · ${on.character.label}` : ''}</option>
                        <option value="none">No one in it{on?.empty ? ` · ${on.empty.label}` : ''}</option>
                      </select>
                    )}
                    <textarea className="st-textarea" aria-label={`Slide ${s.index + 1} shot`} maxLength={300} value={spec.shots?.[s.index] ?? ''} onChange={e => setSlide(s.index, { shot: e.target.value })} placeholder={s.text ? `e.g. ${topic ? 'the desk' : 'her'} ${s.index ? 'later that day' : 'at the start'}` : 'What the photo shows'} />
                    <div className="st-row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {item.characterId && <PriceButton size="sm" variant="secondary" icon={false} compact label={asset ? 'Reroll' : 'Make it'} action={draft.saving ? null : { type: 'slideshow_stills', contentId: item.id, slides: [s.index], ...(path ? { path } : {}) }} waiting={draft.saving ? 'Saving...' : undefined} todo={todo} />}
                    </div>
                    <div className="st-row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      <button type="button" className="st-btn ghost xs" onClick={() => setPickFor(s.index)}><Images size={12} />Library</button>
                      <button type="button" className="st-btn ghost xs" disabled={uploading != null} onClick={() => { setUploadFor(s.index); file.current?.click() }}>{uploading === s.index ? <Loader2 size={12} className="st-spin" /> : <Upload size={12} />}Upload</button>
                      {s.stillId && <button type="button" className="st-btn ghost xs" onClick={() => setSlide(s.index, { still: '' })} title="Take the picture out of this slide (it stays in the Library)"><X size={12} />Clear</button>}
                    </div>
                  </>
                ) : s.special.type === 'product_shot' ? (
                  <div className="st-col" style={{ gap: 4 }} data-field={`product-shot-${s.index}`}>
                    <button type="button" className="st-btn ghost xs" disabled={uploading != null} onClick={() => { setUploadFor(s.index); file.current?.click() }}>{uploading === s.index ? <Loader2 size={12} className="st-spin" /> : <Upload size={12} />}{s.special.assetId ? 'Replace the screenshot' : 'Upload the screenshot'}</button>
                    <span className="st-hint">Your own screenshot, placed as it is. The Studio never draws a product screen. Size and place it in the Slides step.</span>
                  </div>
                ) : <span className="st-hint">Drawn by code, free. Edit its words in the Slides step.</span>}
                <div className="st-row" style={{ gap: 2, justifyContent: 'center' }}>
                  <button type="button" className="st-btn icon ghost sm" aria-label="Earlier" disabled={s.index === 0} onClick={() => edit({ move: [s.index, s.index - 1] })}><ArrowLeft size={13} /></button>
                  <button type="button" className="st-btn icon ghost sm" aria-label={`Remove slide ${s.index + 1}`} onClick={() => edit({ remove: s.index })}><Trash2 size={13} /></button>
                  <button type="button" className="st-btn icon ghost sm" aria-label="Later" disabled={s.index === list.length - 1} onClick={() => edit({ move: [s.index, s.index + 1] })}><ArrowRight size={13} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {list.length < 10 && <button type="button" className="st-btn ghost sm" onClick={() => edit({ add: list.length })}><Plus size={14} />Add a slide</button>}
        {list.length > 0 && ctx.current === 'stills' && <button type="button" className="st-btn ghost sm" onClick={() => void ctx.advance('text')}>Continue to the slides<ArrowRight size={14} /></button>}
      </div>
      <Viewer items={slideViewerItems(list, id => stills.get(id))} openId={view.openId} onOpen={view.open} onClose={view.close} />
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Upload a picture for this slide" onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (uploadFor != null) void uploadInto(uploadFor, f) }} />
      {item.characterId && (
        <LibraryDrawer open={pickFor != null} onClose={() => setPickFor(null)} kind="stills" characterId={item.characterId} characterName={v?.data.name ?? 'this character'}
          picked={pickFor != null && list[pickFor]?.stillId ? [list[pickFor]!.stillId!] : []} multi={false}
          onPick={id => { if (pickFor != null) setSlide(pickFor, { still: id }); setPickFor(null) }} />
      )}
      {!scenes && !topic && <span className="st-hint">Loading the scene...</span>}
    </div>
  )
}

// One camera roll: the locked scene, the Scene library and the shape.
function SceneCard({ ctx }: { ctx: PostCtx }) {
  const { item, draft, scenes, v } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const spec = draft.spec as unknown as SlideshowSpec
  const lock = spec.lock as SceneLock
  const topic = spec.mode === 'topic'
  const saved = useQuery({ queryKey: ['slide-scenes'], queryFn: api.slideScenes, staleTime: 30_000 })
  const mine = (saved.data?.scenes ?? []).filter(s => (topic ? !s.characterId : s.characterId === item.characterId))
  const [naming, setNaming] = useState<string | null>(null)
  const lights = scenes?.options.lights.filter(l => l.id !== 'as_written') ?? []
  const cameras = scenes?.options.cameras ?? []
  const firstStill = slideList(spec).find(s => s.stillId)?.stillId
  const firstAsset = firstStill ? ctx.lib?.stills.find(s => s.id === firstStill)?.assetId ?? null : null

  function set(patch: Partial<SceneLock>) {
    const own = new Set(lock.ownerSet ?? [])
    for (const k of Object.keys(patch)) if (['place', 'light', 'camera', 'phone', 'outfit', 'details'].includes(k)) own.add(k)
    draft.setSpec({ lock: { ...lock, ...patch, ownerSet: [...own].slice(0, 8) } } as never)
  }
  async function save() {
    if (!naming?.trim()) return
    try {
      await api.saveSlideScene({ name: naming.trim(), characterId: topic ? null : item.characterId, topic: topic ? (item.idea || spec.hook).slice(0, 120) : '', place: lock.place, light: lock.light, camera: lock.camera, phone: lock.phone, details: lock.details, lookAssetId: firstAsset })
      setNaming(null)
      await qc.invalidateQueries({ queryKey: ['slide-scenes'] })
      toast({ tone: 'ok', text: 'Scene saved. Pick it in any slideshow.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  return (
    <section className="st-card" data-field="slideshow-scene">
      <div className="st-card-head st-row" style={{ gap: 8 }}>
        <Camera size={15} />
        <div className="grow"><div className="st-h3">One camera roll</div><div className="st-hint">The same place, light and phone in every photo{topic ? '' : ', and the same outfit'}. Only the moment changes.</div></div>
        <HowTo id="slideshow" label="About the scene" />
      </div>
      <div className="st-card-body st-col" style={{ gap: 12 }}>
        {mine.length > 0 && (
          <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }} data-field="scene-library">
            <span className="st-hint">Saved scenes:</span>
            {mine.map(s => (
              <span key={s.id} className={`st-chip ${lock.savedId === s.id ? 'on' : ''}`}>
                <button type="button" className="st-shotchip-main" onClick={() => draft.setSpec({ lock: { ...lock, place: s.place, light: s.light, camera: s.camera, phone: (['front', 'rear'].includes(s.phone) ? s.phone : '') as SceneLock['phone'], details: s.details, savedId: s.id, lookAssetId: s.lookAssetId, ownerSet: [...new Set([...(lock.ownerSet ?? []), 'place', 'light', 'camera', 'phone', 'details'])] } } as never)}>{s.name}</button>
                <button type="button" className="st-shotchip-x" aria-label={`Delete the saved scene ${s.name}`} onClick={async () => { await api.deleteSlideScene(s.id).catch(() => undefined); void qc.invalidateQueries({ queryKey: ['slide-scenes'] }) }}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="st-lockgrid">
          <Field label="Place" hint={topic ? 'e.g. a glass-walled office lobby on a high floor' : 'e.g. a small home office by a window'}>
            <input className="st-input" maxLength={300} value={lock.place} onChange={e => set({ place: e.target.value })} placeholder={item.idea || 'Where every photo is'} />
          </Field>
          <Field label="Light">
            <select className="st-select" value={lock.light} onChange={e => set({ light: e.target.value })}>
              <option value="">{topic ? 'Natural light' : "The scene's light"}</option>
              {lights.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Field>
          {topic ? (
            <Field label="Phone" hint="How the phone is held, in a few words.">
              <input className="st-input" maxLength={60} value={lock.camera} onChange={e => set({ camera: e.target.value })} placeholder="e.g. held at chest height" />
            </Field>
          ) : (
            <Field label="Camera">
              <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <select className="st-select" value={lock.camera} onChange={e => set({ camera: e.target.value })} style={{ flex: '1 1 180px', minWidth: 160 }} aria-label="Camera">
                  <option value="">The scene's camera</option>
                  {cameras.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select className="st-select" value={lock.phone} onChange={e => set({ phone: e.target.value as SceneLock['phone'] })} aria-label="Front or rear camera">
                  <option value="">Phone camera</option><option value="front">Front</option><option value="rear">Rear</option>
                </select>
              </div>
            </Field>
          )}
          {!topic && (
            <Field label="Outfit (the same in every photo)" hint="In catalog terms: the garment, its color and fabric.">
              <input className="st-input" maxLength={300} value={lock.outfit} onChange={e => set({ outfit: e.target.value })} placeholder="e.g. a gray cotton crewneck sweater" />
            </Field>
          )}
          <Field label="2 details that show up again">
            <div className="st-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              {[0, 1].map(i => <input key={i} className="st-input" style={{ flex: 1, minWidth: 0 }} maxLength={160} value={lock.details[i] ?? ''} onChange={e => set({ details: [0, 1].map(j => (j === i ? e.target.value : lock.details[j] ?? '')).filter((d, j) => d || j < 1) })} placeholder={i ? 'e.g. a sticky note' : 'e.g. a coffee mug'} />)}
            </div>
          </Field>
        </div>
        <div className="st-row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {spec.made === 'instagram' ? (
            <>
              <span className="st-hint">Made at 3:4 (an older post).</span>
              <button type="button" className="st-btn sm ghost" onClick={() => draft.setSpec({ made: 'tiktok' } as never)}>Make the next stills 9:16 for TikTok</button>
            </>
          ) : <span className="st-hint" data-field="slideshow-made">Made for TikTok, 9:16. Slideshows are TikTok only; an Instagram 3:4 copy is an option in Finish.</span>}
          <span className="st-spacer" />
          {naming == null
            ? <button type="button" className="st-btn ghost sm" disabled={!lock.place.trim()} title={lock.place.trim() ? 'Save the place, light, camera and details' : 'Write the place first'} onClick={() => setNaming(lock.place.slice(0, 40))}><Bookmark size={13} />Save this scene</button>
            : (
              <span className="st-row" style={{ gap: 6 }}>
                <input className="st-input" style={{ width: 200 }} autoFocus maxLength={80} value={naming} onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save() }} aria-label="Scene name" placeholder="Name, e.g. Home office" />
                <button type="button" className="st-btn sm primary" onClick={() => void save()}>Save<span className="st-price">Free</span></button>
                <button type="button" className="st-btn sm ghost" onClick={() => setNaming(null)}>Cancel</button>
              </span>
            )}
        </div>
        {lock.savedId && <span className="st-hint">From the Scene library{lock.lookAssetId ? (topic ? '; its picture goes with each still as the place to match.' : '; the place goes in words (the character stills attach the sheet only).') : '.'}</span>}
        {!topic && v && !scenes && <span className="st-hint">Loading {v.data.name}'s scene options...</span>}
      </div>
    </section>
  )
}
