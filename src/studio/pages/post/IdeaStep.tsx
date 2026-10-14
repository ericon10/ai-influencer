import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { keys } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { Callout, Field, Img, errorMessage, useToast } from '../../ui'
import { jobDone, noDash, remember, useJobResult } from './parts'
import type { PostCtx } from './ctx'
import { EditStylePicker } from './EditStyles'

// Step 1: what the post is, for which account, with which character. Only
// the character is needed to go on; the idea feeds the stills, the slides
// and the captions, and each of those says when it needs it.

const IDEA: Record<string, { label: string; placeholder: string }> = {
  meme: { label: 'What happens in this post?', placeholder: 'e.g. Callie laughs at her laptop when her code finally runs' },
  slideshow: { label: 'What is the slideshow about?', placeholder: 'e.g. 5 apps that saved my semester' },
  batch: { label: 'What are the captions about?', placeholder: 'e.g. studying with AI the night before an exam' },
}

export function ideaSummary(ctx: PostCtx) {
  const name = ctx.characters.find(c => c.id === ctx.item.characterId)?.name ?? 'No character'
  return [ctx.item.accountTag || 'No account tag', name, ctx.item.idea.trim() ? `"${ctx.item.idea.trim().slice(0, 90)}"` : 'No idea written'].join(' · ')
}

export function IdeaStep({ ctx }: { ctx: PostCtx }) {
  const { item, data, draft, characters, v } = ctx
  const toast = useToast()
  const qc = useQueryClient()
  const [switching, setSwitching] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ideasJob, setIdeasJob] = useState<string | null>(null)
  const idea = draft.fields.idea
  // The rough idea the price is for, settled while typing.
  const [rough, setRough] = useState(idea.trim())
  useEffect(() => { const t = setTimeout(() => setRough(idea.trim()), 500); return () => clearTimeout(t) }, [idea])
  const copy = IDEA[item.kind]!
  const tags = data.accountTags.filter(t => t !== draft.fields.accountTag.trim())
  const spec = draft.spec as { clipId?: string | null; stillId?: string | null; stillIds?: string[]; clipIds?: string[] }
  // Switching drops this character's own stills, clips and scene.
  const hasPicks = !!(item.sceneId || spec.clipId || spec.stillId || spec.stillIds?.length || spec.clipIds?.length)

  async function switchTo(id: string) {
    setBusy(true)
    try {
      await draft.flush()
      await api.updateContent(item.id, { characterId: id })
      remember('character', id)
      await qc.invalidateQueries({ queryKey: keys.content })
      setSwitching(null)
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally { setBusy(false) }
  }
  function pick(id: string) {
    if (id === item.characterId) return
    if (hasPicks) setSwitching(id)
    else void switchTo(id)
  }
  const target = characters.find(c => c.id === switching)
  const ready = !!v?.sheet.shots[0]?.approved
  const personaIdeas = item.kind === 'meme' ? (((v?.data.persona as { settings?: string[] } | undefined)?.settings) ?? []).slice(0, 6) : []

  return (
    <div className="st-col" style={{ gap: 18 }}>
      <Field id="post-character" label="Character" group>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {characters.map(c => (
            <button key={c.id} type="button" className={`st-charchip ${c.id === item.characterId ? 'on' : ''}`} onClick={() => pick(c.id)} disabled={busy} aria-pressed={c.id === item.characterId}>
              <Img assetId={c.portraitAssetId} width={80} />
              <span>{c.name}</span>
              {c.id === item.characterId && <Check size={13} />}
            </button>
          ))}
          <Link to="/studio/characters" className="st-btn sm ghost">Set up a new character</Link>
        </div>
      </Field>
      {target && (
        <Callout tone="warn" icon={<AlertTriangle size={16} />}>
          Switching to {target.name} drops the stills and clips picked for {characters.find(c => c.id === item.characterId)?.name ?? 'this character'} in this post. The idea, the text and the B-roll stay.
          <div className="st-row" style={{ gap: 8, marginTop: 8 }}>
            <button className="st-btn sm" disabled={busy} onClick={() => void switchTo(target.id)}>{busy ? <Loader2 size={13} className="st-spin" /> : null}Switch to {target.name}</button>
            <button className="st-btn sm ghost" onClick={() => setSwitching(null)}>Cancel</button>
          </div>
        </Callout>
      )}
      {v && !ready && item.kind !== 'batch' && (
        <Callout tone="info">New stills of {v.data.name} need {v.data.pronouns.poss} face and reference sheet first. <Link to={`/studio/characters/${v.id}`}>Set up {v.data.name}</Link>, or use stills and clips already in the Library.</Callout>
      )}

      <Field id="post-idea" label={copy.label} hint="In your own words. It feeds the stills, the slides or the captions; change it any time.">
        <textarea className="st-textarea" rows={3} maxLength={2000} value={idea} onChange={e => draft.setFields({ idea: e.target.value })} placeholder={copy.placeholder} />
      </Field>
      {item.kind === 'meme' && (
        <div className="st-col" style={{ gap: 8 }}>
          <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {rough.length >= 3 && item.characterId
              ? <PriceButton action={{ type: 'scene_ideas', characterId: item.characterId, idea: rough }} label="Punch it up" variant="secondary" size="sm" onStarted={ids => setIdeasJob(ids[0] ?? null)} />
              : null}
            <span className="st-hint">{rough.length >= 3 ? 'Turns your rough idea into 3 specific moments to pick from.' : 'Write a rough idea; Punch it up turns it into 3 specific moments.'}</span>
          </div>
          {ideasJob && <IdeaOptions jobId={ideasJob} current={idea} onPick={text => draft.setFields({ idea: text })} onClose={() => setIdeasJob(null)} />}
          {personaIdeas.length > 0 && (
            <div className="st-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="st-hint">Places:</span>
              {personaIdeas.map(i => <button key={i} type="button" className="st-chip" onClick={() => draft.setFields({ idea: idea.trim() ? `${idea.trim()}, ${i}` : `${v?.data.name ?? ''} at ${i}`.trim() })}>{i}</button>)}
            </div>
          )}
        </div>
      )}

      <Field id="post-account" label="Account" hint="Where this goes, for example a TikTok account. The Posts page filters by it. Optional.">
        <input className="st-input" style={{ maxWidth: 320 }} list="post-account-tags" maxLength={60} value={draft.fields.accountTag} onChange={e => { draft.setFields({ accountTag: e.target.value }); remember('tag', e.target.value.trim()) }} placeholder="e.g. Callie TikTok" />
        <datalist id="post-account-tags">{data.accountTags.map(t => <option key={t} value={t} />)}</datalist>
      </Field>
      {tags.length > 0 && (
        <div className="st-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: -10 }}>
          {tags.slice(0, 8).map(t => <button key={t} type="button" className="st-chip" onClick={() => { draft.setFields({ accountTag: t }); remember('tag', t) }}>{t}</button>)}
        </div>
      )}
      {item.kind !== 'slideshow' && (
        <Field id="post-format" label="Format (optional)" group hint="An edit made by code, free. A two-shot format plans shot A and shot B in the Video step. Change it any time in the Finish step.">
          <EditStylePicker ctx={ctx} mode="format" />
        </Field>
      )}
    </div>
  )
}

interface Idea { moment: string; shooter: string; place: string; detail: string; other_person: string }

// The three options from "Punch it up". Picking one fills the idea; it stays
// editable, and another option can still be picked.
function IdeaOptions({ jobId, current, onPick, onClose }: { jobId: string; current: string; onPick: (text: string) => void; onClose: () => void }) {
  const q = useJobResult(jobId)
  const status = q.data?.job.status
  const options = ((q.data?.result as { options?: Idea[] } | null)?.options ?? []).slice(0, 3)
  if (!jobDone(status)) return <div className="st-row st-hint" style={{ gap: 8 }}><Loader2 size={14} className="st-spin" />Writing 3 specific moments...</div>
  if (status !== 'completed' || !options.length) {
    return <div className="st-price-error" role="alert"><span className="msg">{q.data?.job.error?.message ?? 'No options came back.'} Press Punch it up to try again; a failed run is not charged.</span><button className="st-btn sm ghost" onClick={onClose}>Close</button></div>
  }
  return (
    <div className="st-col" style={{ gap: 8 }}>
      <div className="st-row"><span className="st-label">Pick one</span><span className="st-spacer" /><button className="st-btn sm ghost" onClick={onClose}>Hide</button></div>
      <div className="st-ideas">
        {options.map((o, i) => {
          const text = noDash(o.moment)
          const on = current.trim() === text
          return (
            <button key={i} type="button" className={`st-choice ${on ? 'on' : ''}`} onClick={() => onPick(text)}>
              <span className="st-row" style={{ gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 1 }}>{text}</span>{on && <Check size={14} />}</span>
              <span className="st-hint">{[o.shooter, o.place, o.detail].map(noDash).filter(Boolean).join(' · ')}</span>
              {o.other_person && <span className="st-hint">Also in it: {noDash(o.other_person)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
