import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, FileText, Info, Loader2, PenLine } from 'lucide-react'
import { api } from '../../api'
import { useRefresh } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { ReqBadge, errorMessage, useToast, type TodoItem } from '../../ui'
import type { StudioAction, WrittenPrompt } from '../../types'

// The finished prompt, above the Generate button (owner, 2026-10-13): Claude
// writes it from the details (the prompt writer, Sonnet 5.5 unless switched
// in Settings), and it stays fully editable, saved as you type. Rewrite asks
// Claude again, priced on the button. The Studio adds the reference line,
// the mark sides and the REALISM block when it runs, so they can never be
// edited away.

const SOURCE: Record<WrittenPrompt['source'], string> = { claude: 'Written by', owner: 'Edited by you', template: 'From the template' }

export function PromptBox({ id, characterId, sceneId, target, written, writeAction, writeTodo = [], templateText, words, model, realism, addedNote, changedNote, onDirty }: {
  id: string
  characterId: string
  sceneId: string
  target: 'still' | 'video'
  written: WrittenPrompt | null
  writeAction: StudioAction | null
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
}) {
  const toast = useToast()
  const refresh = useRefresh()
  const qc = useQueryClient()
  const [text, setText] = useState(written?.text ?? '')
  const [writing, setWriting] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A new answer from the writer (or another tab) replaces untouched text.
  const serverAt = written?.at ?? ''
  useEffect(() => {
    if (!dirty.current) setText(written?.text ?? '')
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
        <span className="st-label" style={{ margin: 0 }}><PenLine size={14} style={{ verticalAlign: -2 }} /> {target === 'still' ? 'The prompt' : 'The video prompt'}<ReqBadge done={has} /></span>
        <span className="st-spacer" />
        {written && has && <span className="st-hint">{SOURCE[written.source]}{written.source === 'claude' && written.model ? ` ${written.model}` : ''}</span>}
        {has && <span className={`st-hint ${inRange ? '' : 'st-warntext'}`} title={`Aim for ${words[0]} to ${words[1]} words`}>{count} words</span>}
      </div>
      {writing !== null ? (
        <div className="st-promptbox-writing"><Loader2 size={16} className="st-spin" />Claude is writing the prompt from your details...</div>
      ) : (
        <textarea
          className={`st-textarea st-prompt-edit ${has ? '' : 'empty'}`}
          rows={target === 'still' ? 8 : 4}
          maxLength={4000}
          value={text}
          onChange={e => edit(e.target.value)}
          placeholder={target === 'still'
            ? 'Press "Write the prompt" and Claude writes it from the details above, or type your own.'
            : 'Press "Write the video prompt" and Claude writes it from "What happens", or type your own.'}
          aria-label={target === 'still' ? 'The prompt' : 'The video prompt'}
        />
      )}
      {changedNote && <span className="st-hint st-warntext"><Info size={12} style={{ verticalAlign: -2 }} /> {changedNote}</span>}
      {has && !inRange && <span className="st-hint">Aim for {words[0]} to {words[1]} words. Longer or shorter still runs.</span>}
      <div className="st-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PriceButton
          action={writeAction}
          todo={writeTodo}
          label={has ? 'Rewrite' : target === 'still' ? 'Write the prompt' : 'Write the video prompt'}
          variant={has ? 'secondary' : 'primary'}
          size="sm"
          icon={!has}
          onStarted={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null } dirty.current = false; onDirty?.(false); setWriting(serverAt) }}
        />
        {templateText && !has && <button type="button" className="st-btn ghost sm" onClick={useTemplate}><FileText size={14} />Use the template instead (free)</button>}
        {has && <button type="button" className="st-btn ghost sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>}
      </div>
      {has && written?.source === 'owner' && <span className="st-hint">Rewrite replaces your edits with a new version from Claude ({model}).</span>}
      <details className="st-promptbox-added">
        <summary>{addedNote}</summary>
        <p className="st-promptbox-realism">{realism}</p>
      </details>
    </div>
  )
}
