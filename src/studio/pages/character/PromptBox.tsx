import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Clapperboard, Copy, FileText, Info, Loader2, PenLine } from 'lucide-react'
import { api } from '../../api'
import { isActiveJob, useLiveJobs, useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { ReqBadge, errorMessage, useToast, type TodoItem } from '../../ui'
import type { JobView, StudioAction, WrittenPrompt } from '../../types'

// The finished prompt, above the Generate button (owner, 2026-10-13): Claude
// writes it from the details (the prompt writer, Sonnet 5.5 unless switched
// in Settings), and it stays fully editable, saved as you type. Rewrite asks
// Claude again, priced on the button. The Studio adds the reference line,
// the mark sides and the REALISM block when it runs, so they can never be
// edited away. With the director's pass on (default rule
// scene-directors-pass), the writer's choices show as an editable
// "Director's notes" line above the prompt; Rewrite follows notes you set.

const SOURCE: Record<WrittenPrompt['source'], string> = { claude: 'Written by', owner: 'Edited by you', template: 'From the template' }

export function PromptBox({ id, characterId, sceneId, target, written, writeAction, writeTodo = [], templateText, words, model, realism, addedNote, changedNote, onDirty, watch, label, placeholder, onText, children, directors = false }: {
  id: string
  characterId: string
  sceneId: string
  target: 'still' | 'video'
  written: WrittenPrompt | null
  // The write action, or one built from the box's current text.
  writeAction: StudioAction | null | ((text: string) => StudioAction | null)
  writeTodo?: TodoItem[]
  templateText: string | null
  words: [number, number]
  model: string
  realism: string
  // What the Studio adds around the text, in one line.
  addedNote: string
  // Why the text may be out of date (the details changed after writing).
  changedNote?: string | null
  onDirty?: (dirty: boolean) => void
  // Writer runs started elsewhere ("Use this still") show here too.
  watch?: (j: JobView) => boolean
  label?: string
  placeholder?: string
  // The text as it is typed (the take sends it).
  onText?: (text: string) => void
  // A line under the box (the video directions).
  children?: ReactNode
  // The director's pass is on: show and edit the notes.
  directors?: boolean
}) {
  const toast = useToast()
  const refresh = useRefresh()
  const qc = useQueryClient()
  const [text, setText] = useState(written?.text ?? '')
  useEffect(() => { onText?.(text) }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  // A writer run started from elsewhere (the still's "Use this still").
  const live = useLiveJobs()
  const liveWriting = !!watch && (live.data?.jobs ?? []).some(j => watch(j) && isActiveJob(j) && j.status !== 'needs_attention')
  const [writing, setWriting] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The director's notes: the writer's, or yours. Yours are sent with the
  // next Rewrite and followed as given.
  const [notes, setNotes] = useState(written?.notes ?? '')
  const [ownNotes, setOwnNotes] = useState(written?.notesBy === 'owner')
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A new answer from the writer (or another tab) replaces untouched text.
  const serverAt = written?.at ?? ''
  useEffect(() => {
    if (!dirty.current) setText(written?.text ?? '')
    if (!notesTimer.current) { setNotes(written?.notes ?? ''); setOwnNotes(written?.notesBy === 'owner') }
    if (writing !== null && serverAt !== writing) setWriting(null)
  }, [serverAt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (writing === null) return
    const t = setTimeout(() => setWriting(null), 120_000)
    return () => clearTimeout(t)
  }, [writing])

  async function save(next: string, fromTemplate = false) {
    try {
      await api.updateScene(sceneId, { prompts: { [target]: next }, ...(fromTemplate ? { fromTemplate: true } : {}) })
      dirty.current = false
      onDirty?.(false)
      refresh(characterId)
      qc.invalidateQueries({ queryKey: ['estimate'] })
    } catch (e) {
      toast({ tone: 'bad', text: errorMessage(e) })
    }
  }
  function edit(next: string) {
    setText(next)
    dirty.current = true
    onDirty?.(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void save(next) }, 700)
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void save(text) } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function editNotes(next: string) {
    setNotes(next)
    setOwnNotes(next.trim().length > 0)
    if (!written) return
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      notesTimer.current = null
      api.updateScene(sceneId, { notes: { [target]: next } }).then(() => refresh(characterId)).catch(e => toast({ tone: 'bad', text: errorMessage(e) }))
    }, 700)
  }
  // The write action, with your notes when you set them.
  const baseAction = typeof writeAction === 'function' ? writeAction(written?.text ?? '') : writeAction
  const action = baseAction && baseAction.type === 'scene_prompt' && directors && ownNotes && notes.trim() ? { ...baseAction, notes: notes.trim() } : baseAction

  function useTemplate() {
    if (!templateText) return
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setText(templateText)
    dirty.current = true
    onDirty?.(true)
    void save(templateText, true)
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { toast({ tone: 'bad', text: 'Could not copy. Select the text and copy it.' }) }
  }

  const count = text.trim() ? text.trim().split(/\s+/).length : 0
  const inRange = count >= words[0] && count <= words[1]
  const has = text.trim().length > 0
  return (
    <div className="st-promptbox" data-field={id}>
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="st-label" style={{ margin: 0 }}><PenLine size={14} style={{ verticalAlign: -2 }} /> {label ?? (target === 'still' ? 'The prompt' : 'The video prompt')}<ReqBadge done={has} /></span>
        <span className="st-spacer" />
        {written && has && <span className="st-hint">{SOURCE[written.source]}{written.source === 'claude' && written.model ? ` ${written.model}` : ''}</span>}
        {has && <span className={`st-hint ${inRange ? '' : 'st-warntext'}`} title={`Aim for ${words[0]} to ${words[1]} words`}>{count} words</span>}
      </div>
      {directors && (
        <label className="st-col st-notes" style={{ gap: 4 }}>
          <span className="st-row" style={{ gap: 6 }}><Clapperboard size={13} /><span className="st-label" style={{ margin: 0 }}>Director's notes</span><span className="st-hint">{ownNotes ? 'Yours: Rewrite follows them' : notes ? 'From Claude: edit them, then Rewrite' : 'Optional'}</span></span>
          <textarea
            className="st-textarea st-notes-edit" rows={2} style={{ minHeight: 0 }} maxLength={600} value={notes}
            onChange={e => editNotes(e.target.value)}
            placeholder={target === 'video'
              ? 'Claude decides these when it writes: the moment people remember, the hook in the first second, the payoff in the last 2, one camera move, depth, light, one contrast. Or set your own.'
              : 'Claude decides these when it writes: the moment people remember, the hook, depth, light, one contrast. Or set your own.'}
            aria-label="Director's notes"
          />
        </label>
      )}
      {writing !== null || liveWriting ? (
        <div className="st-promptbox-writing"><Loader2 size={16} className="st-spin" />{target === 'video' ? 'Claude is writing the video prompt from the still...' : 'Claude is writing the prompt from your details...'}</div>
      ) : (
        <textarea
          className={`st-textarea st-prompt-edit ${has ? '' : 'empty'}`}
          rows={target === 'still' ? 8 : 9}
          maxLength={4000}
          value={text}
          onChange={e => edit(e.target.value)}
          placeholder={placeholder ?? (target === 'still'
            ? 'Press "Write the prompt" and Claude writes it from the details above, or type your own.'
            : 'Press "Write the video prompt" and Claude writes it, or type your own.')}
          aria-label={label ?? (target === 'still' ? 'The prompt' : 'The video prompt')}
        />
      )}
      {changedNote && <span className="st-hint st-warntext"><Info size={12} style={{ verticalAlign: -2 }} /> {changedNote}</span>}
      {written?.removed?.length ? <span className="st-hint"><Info size={12} style={{ verticalAlign: -2 }} /> Taken out or reworded because your words did not use them: {written.removed.join(', ')}. Type them back in if you want them (Settings, Rules: no mood words, and outfits in catalog terms with no fit or body words).</span> : null}
      {has && !inRange && <span className="st-hint">Aim for {words[0]} to {words[1]} words. Longer or shorter still runs.</span>}
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PriceButton
          action={action}
          todo={writeTodo}
          label={has ? 'Rewrite' : target === 'still' ? 'Write the prompt' : 'Write it'}
          variant={has ? 'secondary' : 'primary'}
          size="sm"
          icon={!has}
          onStarted={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null } dirty.current = false; onDirty?.(false); setWriting(serverAt) }}
          watch={watch}
        />
        {templateText && !has && <button type="button" className="st-btn ghost sm" onClick={useTemplate}><FileText size={14} />Use the template instead (free)</button>}
        {has && <button type="button" className="st-btn ghost sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>}
      </div>
      {has && written?.source === 'owner' && <span className="st-hint">Rewrite replaces your edits with a new version from Claude ({model}).</span>}
      {children}
      <details className="st-promptbox-added">
        <summary>{addedNote}</summary>
        <p className="st-promptbox-realism">{realism}</p>
      </details>
    </div>
  )
}
