import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, Check, CopyPlus, Loader2 } from 'lucide-react'
import { api } from '../api'
import { keys, useCharacter, useCharacters, useContent, useLibrary, useScenes } from '../hooks'
import { Callout, errorMessage, scrollToField, useToast } from '../ui'
import type { ContentData, ContentItem, PlanMeta, PostStep } from '../types'
import { codeLabel } from '../../../server/core/playbook'
import { KIND_LABEL, STEPS, postName, useDuplicate, usePostDraft } from './post/parts'
import { IdeaStep, ideaSummary } from './post/IdeaStep'
import { StillsStep, stillsSummary } from './post/StillsStep'
import { VideoStep, videoSummary } from './post/VideoStep'
import { TextStep, textSummary } from './post/TextStep'
import { FinishStep } from './post/FinishStep'
import { FacelessPost } from './post/FacelessPost'
import { FinishedDamage } from './post/FinishedDamage'
import { MORE_EVENT, moreKey, type PostCtx } from './post/ctx'
import { editorUrl, scrollKey } from './post/EditorCard'
import { HowTo } from '../guide/Guide'
import type { GuideId } from '../guide/content'

const STEP_GUIDE: Record<PostStep, GuideId> = { idea: 'post-idea', stills: 'post-stills', video: 'post-video', text: 'post-text', finish: 'post-finish' }

// One post, idea to export, on one page (UX-PLAN.md rule 1). The steps flow
// top to bottom: the ones done fold into a line with Change, the current one
// and those after it stay open, so nothing needs a Next click. Pickers open
// as drawers; uploads happen in the step that needs them.

// "/studio/posts/:id/edit" (the old Fine-tune address) opens the editor.
// The editor's Back and Done return to "?step=finish": the Finish step,
// scrolled to where the owner left it (UX-PLAN.md section 12).
export default function Post({ editing = false }: { editing?: boolean }) {
  const { id = '' } = useParams()
  const content = useContent()
  const listed = content.data?.items.find(i => i.id === id)
  // The list holds the newest 200 posts; an older one is read on its own.
  const single = useQuery({ queryKey: [...keys.content, 'item', id], queryFn: () => api.contentItem(id), enabled: !!content.data && !listed, retry: false })
  const item = listed ?? single.data?.item
  if (!content.data || (!listed && single.isLoading)) return <div className="st-page"><div className="st-skel" style={{ height: 48, width: 320, marginBottom: 20 }} /><div className="st-skel" style={{ height: 360, borderRadius: 18 }} /></div>
  if (!item) {
    return (
      <div className="st-page">
        <div className="st-empty">
          <h2 className="st-h1">This post is not here</h2>
          <p className="st-sub" style={{ margin: 0 }}>It may have been archived. Your other posts are on the Posts page.</p>
          <Link className="st-btn primary" to="/studio">Back to posts</Link>
        </div>
      </div>
    )
  }
  if (editing && item.kind === 'meme') {
    window.location.replace(editorUrl(item.id))
    return <div className="st-page"><span className="st-hint"><Loader2 size={13} className="st-spin" style={{ verticalAlign: -2 }} /> Opening the editor...</span></div>
  }
  return <Workspace key={item.id} item={item} data={content.data} />
}

function Workspace({ item, data }: { item: ContentItem; data: ContentData }) {
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const duplicate = useDuplicate()
  const draft = usePostDraft<Record<string, unknown>>(item)
  const chars = useCharacters()
  const characterId = item.characterId ?? ''
  const character = useCharacter(characterId)
  const scenes = useScenes(characterId)
  const lib = useLibrary(characterId)
  const steps = STEPS[item.kind]
  const current: PostStep = steps.some(([k]) => k === item.step) ? item.step : 'idea'
  const ci = steps.findIndex(([k]) => k === current)
  const ctx: PostCtx = {
    item, data, draft, characters: chars.data?.characters ?? [], v: character.data, scenes: scenes.data, lib: lib.data,
    scene: scenes.data?.scenes.find(s => s.id === item.sceneId),
    current,
    // Moves the post forward to a step (never back; Change goes back).
    advance: async (step: PostStep, spec?: Record<string, unknown>) => {
      const to = steps.findIndex(([k]) => k === step)
      if (to > ci) await draft.go(step, spec ? { spec } : {})
      else if (spec) { draft.setSpec(spec); await draft.flush() }
    },
    open: (step: PostStep, o: { field?: string; more?: boolean } = {}) => {
      if (o.more) {
        try { localStorage.setItem(moreKey(item.id), '1') } catch { /* private window */ }
        window.dispatchEvent(new CustomEvent(MORE_EVENT))
      }
      if (steps.findIndex(([k]) => k === step) < ci) void draft.go(step)
      window.setTimeout(() => scrollToField(o.field ?? `step-${step}`), 160)
    },
  }

  async function archive() {
    try {
      await api.archiveContent(item.id)
      await qc.invalidateQueries({ queryKey: keys.content })
      nav('/studio')
      toast({ tone: '', text: 'Post archived. Its stills and clips stay in the Library.' })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  // Back from the editor: the Finish step, where the owner was.
  const [params, setParams] = useSearchParams()
  const returned = useRef(false)
  useEffect(() => {
    if (returned.current || params.get('step') !== 'finish') return
    returned.current = true
    if (steps.findIndex(([k]) => k === 'finish') > ci) void draft.go('finish')
    let y = NaN
    try { y = Number(sessionStorage.getItem(scrollKey(item.id)) ?? NaN); sessionStorage.removeItem(scrollKey(item.id)) } catch { /* private window */ }
    // A link to a part of the Finish step (Make variations from a results hint).
    const field = params.get('field')
    window.setTimeout(() => { if (field) scrollToField(field); else if (Number.isFinite(y)) window.scrollTo({ top: y }); else scrollToField('step-finish') }, field ? 600 : 150)
    void qc.invalidateQueries({ queryKey: keys.content })
    params.delete('step')
    params.delete('field')
    setParams(params, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function jump(step: PostStep, state: 'done' | 'current' | 'waiting') {
    if (state === 'done') void draft.go(step)
    window.setTimeout(() => scrollToField(`step-${step}`), 60)
  }

  const summary: Record<PostStep, ReactNode> = {
    idea: ideaSummary(ctx), stills: stillsSummary(ctx), video: videoSummary(ctx), text: textSummary(ctx), finish: null,
  }
  const body: Record<PostStep, ReactNode> = {
    idea: <IdeaStep ctx={ctx} />, stills: <StillsStep ctx={ctx} />, video: <VideoStep ctx={ctx} />, text: <TextStep ctx={ctx} />, finish: <FinishStep ctx={ctx} />,
  }

  return (
    <div className="st-page">
      <div className="st-row" style={{ gap: 10, marginBottom: 10 }}>
        <Link to="/studio" className="st-btn ghost sm"><ArrowLeft size={14} />Posts</Link>
        <span className="st-spacer" />
        {draft.saving ? <span className="st-hint"><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> Saving</span> : <span className="st-hint"><Check size={12} style={{ verticalAlign: -2 }} /> Saved</span>}
        <button className="st-btn ghost sm" onClick={() => void duplicate(item.id)} title="A copy with everything filled in, opened at the text"><CopyPlus size={14} />Make another like this</button>
        <button className="st-btn ghost sm" onClick={archive} title="Archive this post (its stills and clips stay)"><Archive size={14} />Archive</button>
      </div>
      <div className="st-pagehead" style={{ marginBottom: 14 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="st-kicker">{KIND_LABEL[item.kind]}{item.accountTag ? ` · ${item.accountTag}` : ''}</div>
          <input className="st-input st-scene-title" value={draft.fields.title} placeholder={postName({ ...item, title: '' })} maxLength={120} onChange={e => draft.setFields({ title: e.target.value })} aria-label="Post name" />
          <PlanLine plan={(draft.spec as { plan?: PlanMeta }).plan} />
        </div>
      </div>
      {item.kind === 'meme' && character.data?.kind !== 'faceless' && <FinishedDamage ctx={ctx} />}
      {item.kind === 'meme' && character.data?.kind === 'faceless' ? <FacelessPost ctx={ctx} /> : (<>
      <nav className="st-steps st-poststeps" aria-label="Steps">
        {steps.map(([k, label], i) => {
          const state = i < ci ? 'done' : i === ci ? 'current' : 'waiting'
          return (
            <button key={k} type="button" className={`st-step ${state === 'done' ? 'done' : state === 'current' ? 'current' : ''}`} aria-current={state === 'current' ? 'step' : undefined} onClick={() => jump(k, state)}>
              <span className="dot">{state === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}</span>{label}
            </button>
          )
        })}
      </nav>
      {!character.data && character.isError && <Callout tone="bad">This post's character could not be loaded. Pick another one in the Idea step.</Callout>}
      <div className="st-col" style={{ gap: 14 }}>
        {steps.map(([k, label], i) => {
          const state = i < ci ? 'done' : i === ci ? 'current' : 'waiting'
          return (
            <section key={k} className={`st-poststep ${state}`} data-field={`step-${k}`}>
              <header className="st-poststep-head">
                <span className="st-poststep-dot">{state === 'done' ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="st-h3">{label}</div>
                  {state === 'done' && summary[k] && <div className="st-hint st-poststep-sum">{summary[k]}</div>}
                </div>
                {state !== 'done' && <HowTo id={STEP_GUIDE[k]} />}
                {state === 'done' && <button className="st-btn sm ghost" onClick={() => jump(k, state)}>Change</button>}
                {state === 'current' && <span className="st-badge accent">Now</span>}
              </header>
              {state !== 'done' && <div className="st-poststep-body">{body[k]}</div>}
            </section>
          )
        })}
      </div>
      </>)}
    </div>
  )
}

// What the post keeps from its plan row or its hook (UX-PLAN.md section 28):
// one small line, the moment and notes behind a click.
function PlanLine({ plan }: { plan?: PlanMeta | null }) {
  const [open, setOpen] = useState(false)
  if (!plan || !(plan.rowId || plan.structure || plan.moment)) return null
  const bits = [
    plan.rowId && `Plan ${plan.rowId}`,
    plan.date && `${plan.date}${plan.slot ? ` ${plan.slot}` : ''}`,
    plan.structure && codeLabel(plan.structure),
    (plan.effectOpen || plan.effectPayoff) && [plan.effectOpen, plan.effectPayoff].filter(Boolean).join(' to '),
    plan.hookScore && `score ${plan.hookScore}`,
    [plan.tension, plan.pillar, plan.audience].filter(Boolean).join(' '),
    plan.product && 'product',
    plan.mentionMother && 'mentions the mother account',
  ].filter(Boolean)
  return (
    <div className="st-col" style={{ gap: 4, marginTop: 4 }} data-field="plan-line">
      <button type="button" className="st-hint" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit' }} onClick={() => setOpen(!open)} aria-expanded={open}>{bits.join(' · ')} {open ? '(less)' : '(more)'}</button>
      {open && (
        <div className="st-col st-hint" style={{ gap: 2 }}>
          {plan.moment && <span><b>Moment{plan.momentId ? ` ${plan.momentId}` : ''}:</b> {plan.moment}</span>}
          {plan.altHook && <span><b>Alt hook:</b> {plan.altHook}</span>}
          {plan.statSource && <span><b>Stat source:</b> {plan.statSource}</span>}
          {plan.notes && <span><b>Notes:</b> {plan.notes}</span>}
        </div>
      )}
    </div>
  )
}
