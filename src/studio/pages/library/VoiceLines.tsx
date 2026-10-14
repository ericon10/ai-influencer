import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, Loader2, Mic, Upload } from 'lucide-react'
import { api, assetUrl } from '../../api'
import { useVoiceLines, useWorkerGate } from '../../hooks'
import { PriceButton } from '../../PriceButton'
import { RunStatus } from '../../runs'
import { Callout, Todo, errorMessage, useToast } from '../../ui'
import type { CharacterSummary, VoiceLine } from '../../types'

// Library > Voice lines (UX-PLAN.md section 13): the owner's performed
// takes, one line each, named by hook (047_check-my-match-score.wav). The
// worker prepares each take free; Convert (priced first) turns it into the
// character's voice with every word timed. A converted line is a post's
// voiceover from the Finish step's Sound row.

const STATUS: Record<VoiceLine['status'], string> = {
  processing: 'Preparing the take...', take: 'Take ready to convert', converting: 'Converting...', ready: 'In the character\'s voice', failed: 'Could not be read',
}

export function VoiceLinesTab({ characterId, characters }: { characterId: string | null; characters: CharacterSummary[] }) {
  const toast = useToast()
  const qc = useQueryClient()
  const worker = useWorkerGate()
  const lines = useVoiceLines(characterId)
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const input = useRef<HTMLInputElement | null>(null)
  const uploadFor = characterId ?? (characters.length === 1 ? characters[0]!.id : null)
  const owner = characters.find(c => c.id === uploadFor)
  const list = lines.data?.lines ?? []
  const waiting = list.filter(l => l.status === 'take')
  const nameOf = (id: string | null) => characters.find(c => c.id === id)?.name ?? 'Unknown'

  async function upload(files: File[]) {
    if (!files.length || !uploadFor) return
    setBusy(`Uploading ${files.length} take${files.length === 1 ? '' : 's'}...`)
    try {
      const r = await api.addVoiceTakes(uploadFor, files, (done, total) => setBusy(`Uploading takes (${done} of ${total})...`))
      setAdded(a => [...a, ...r.lines.map(l => l.id)])
      toast({ tone: 'ok', text: `${r.lines.length} take${r.lines.length === 1 ? '' : 's'} added. The worker is preparing them.` })
    } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) } finally {
      setBusy(null)
      await qc.invalidateQueries({ queryKey: ['voice-lines'] })
    }
  }

  return (
    <div className="st-col" style={{ gap: 18 }}>
      <section className="st-card"><div className="st-card-body st-col" style={{ gap: 12 }}>
        <div className="st-h3">Upload takes</div>
        <span className="st-hint">Perform each line yourself, one WAV per line, named by hook: <span className="st-mono">047_check-my-match-score.wav</span> is Hook 47, "Check my match score". Convert turns each take into the character's voice (ElevenLabs) and times every word, for captions. No lip sync.</span>
        <input ref={input} type="file" accept="audio/*,.wav,.mp3,.m4a" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} />
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="st-btn" data-field="voice-upload" disabled={!!busy || !worker.ready || !uploadFor} onClick={() => input.current?.click()}><Upload size={15} />{owner ? `Upload takes for ${owner.name}` : 'Upload takes'}</button>
          {waiting.length > 1 && <PriceButton action={{ type: 'voice_convert', soundIds: waiting.map(l => l.id) }} label={`Convert all ${waiting.length} takes`} variant="secondary" onStarted={() => void qc.invalidateQueries({ queryKey: ['voice-lines'] })} />}
          {busy && <span className="st-hint"><Loader2 size={12} className="st-spin" style={{ verticalAlign: -2 }} /> {busy}</span>}
          {!worker.ready && <span className="st-hint st-warntext" role="status">{worker.reason} Takes are prepared by the worker.</span>}
        </div>
        {!uploadFor && <Todo items={[{ label: 'Pick a character above (takes become that character\'s voice lines)' }]} />}
        {owner && <span className="st-hint">Converting needs {owner.name}'s ElevenLabs voice ID: <Link className="st-todo-link" to={`/studio/characters/${owner.id}?voice=1`}>set it in {owner.name}'s Voice</Link>.</span>}
        <RunStatus match={j => added.some(id => j.purpose === `voice_take:${id}`) || j.purpose.startsWith('voice_convert:')} />
      </div></section>
      {!lines.data ? <div className="st-skel" style={{ height: 120 }} /> : !list.length
        ? <Callout tone="info">No voice lines yet. Upload your takes above; each becomes a line you can convert and use as a post's voiceover.</Callout>
        : <div className="st-soundlist">{list.map(l => <VoiceLineRow key={l.id} line={l} who={characterId ? null : nameOf(l.characterId)} />)}</div>}
    </div>
  )
}

function VoiceLineRow({ line, who }: { line: VoiceLine; who: string | null }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [title, setTitle] = useState(line.title)
  const [text, setText] = useState(line.line)
  const refresh = () => qc.invalidateQueries({ queryKey: ['voice-lines'] })
  async function save(patch: { title?: string; line?: string }) {
    try { await api.updateVoiceLine(line.id, patch); await refresh() } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  async function archive() {
    try { await api.archiveVoiceLine(line.id); await refresh(); toast({ tone: 'ok', text: `Archived "${line.title}".` }) } catch (e) { toast({ tone: 'bad', text: errorMessage(e) }) }
  }
  const converted = line.status === 'ready' && line.assetId
  return (
    <div className="st-sounditem st-voiceline" data-status={line.status}>
      <Mic size={16} />
      <div className="st-col" style={{ gap: 6, flex: '1 1 320px', minWidth: 0 }}>
        <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {line.tag && <span className="st-badge">{line.tag}</span>}
          {who && <span className="st-badge">{who}</span>}
          <input className="st-input" style={{ maxWidth: 280 }} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title !== line.title && void save({ title })} aria-label="Title" />
          <span className={`st-hint ${line.status === 'failed' ? 'st-warntext' : ''}`}>{line.status === 'converting' || line.status === 'processing' ? <Loader2 size={11} className="st-spin" style={{ verticalAlign: -1 }} /> : null} {STATUS[line.status]}{line.takeSec ? ` · ${line.takeSec} s` : ''}</span>
        </div>
        <input className="st-input" value={text} onChange={e => setText(e.target.value)} onBlur={() => text !== line.line && void save({ line: text })} placeholder="The words of the line (helps the captions when no timings come back)" aria-label="Line" />
        {line.error && <span className="st-hint st-warntext">{line.error}</span>}
        <div className="st-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {line.takeAssetId && <span className="st-col" style={{ gap: 2 }}><span className="st-hint">Your take</span><audio className="st-audio" src={assetUrl(line.takeAssetId)} controls preload="none" /></span>}
          {converted && <span className="st-col" style={{ gap: 2 }}><span className="st-hint">In the character's voice</span><audio className="st-audio" src={assetUrl(line.assetId!)} controls preload="none" /></span>}
        </div>
        {converted && line.transcript && <span className="st-hint">Heard: "{line.transcript}" ({line.words.length} words timed)</span>}
      </div>
      <div className="st-row" style={{ gap: 6 }}>
        {(line.status === 'take' || line.status === 'ready') && <PriceButton action={{ type: 'voice_convert', soundIds: [line.id] }} label={line.status === 'ready' ? 'Convert again' : 'Convert'} size="sm" variant={line.status === 'ready' ? 'secondary' : 'primary'} onStarted={() => void refresh()} />}
        <button className="st-btn sm icon ghost" onClick={archive} aria-label="Archive this voice line" title="Archive"><Archive size={14} /></button>
      </div>
    </div>
  )
}
