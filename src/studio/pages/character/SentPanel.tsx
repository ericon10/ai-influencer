import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileSearch, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { Img, Modal, PromptViewer, errorMessage } from '../../ui'
import { HowTo } from '../../guide/Guide'

// "What was sent" (UX-PLAN.md section 15): the final prompt as the model got
// it (hard-wrapped, one-click copy), the images attached with their REF ids,
// the model and the path, the settings, and the price quoted next to the
// real cost, flagged when more than 20% off. A failed run shows it too, with
// why it failed (owner, 2026-10-15).

const ROLE: Record<string, string> = { ref: 'Ref', start: 'Start frame', end: 'End frame', source: 'Source clip' }

export function SentPanel({ candidateId, jobId }: { candidateId?: string; jobId?: string }) {
  const q = useQuery({ queryKey: ['sent', candidateId ?? `job:${jobId}`], queryFn: () => (candidateId ? api.candidateSent(candidateId) : api.jobSent(jobId!)), staleTime: 30_000, retry: false })
  if (q.isLoading) return <span className="st-hint st-row" style={{ gap: 6 }}><Loader2 size={13} className="st-spin" />Reading what was sent...</span>
  if (q.error) return <span className="st-hint">{errorMessage(q.error)}</span>
  const s = q.data!
  return (
    <div className="st-col st-sent" style={{ gap: 12 }}>
      {s.error && <span className="st-hint" style={{ color: 'var(--st-bad)' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> This run failed: {s.error}{s.providerJobId ? ` (provider id ${s.providerJobId})` : ''}</span>}
      <div className="st-sent-facts">
        <div><span className="st-label">Model</span><b>{s.model}</b>{s.ranOn !== s.model && <span className="st-hint"> ({s.ranOn})</span>}</div>
        <div><span className="st-label">Path</span>{s.pathLabel}</div>
        {s.settings.map(x => <div key={x.label}><span className="st-label">{x.label}</span>{x.value}</div>)}
        <div><span className="st-label">Quoted</span>{s.quoted}</div>
        <div><span className="st-label">Real cost</span>{s.actual ?? <span className="st-muted">{s.path === 'demo' ? 'Free' : 'Not reported'}</span>}</div>
      </div>
      {s.costNote && (
        <span className={`st-hint ${s.flagged ? 'st-warntext' : ''}`}>{s.flagged && <AlertTriangle size={12} style={{ verticalAlign: -2 }} />} {s.costNote}</span>
      )}
      <div className="st-col" style={{ gap: 6 }}>
        <span className="st-label">Attached ({s.images.length + s.elements.length})</span>
        {s.elements.length > 0 && <span className="st-hint">{s.elements.map(e => `Higgsfield element: ${e.name} (${e.id})`).join('; ')}</span>}
        {s.images.length ? (
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {s.images.map((im, i) => (
              <div key={`${im.assetId}-${i}`} className="st-refpick" title={im.refId ?? ROLE[im.role]}>
                {im.role === 'source' ? <div className="st-sent-clip">Clip</div> : <Img assetId={im.assetId} width={120} />}
                <span>{im.refId ?? ROLE[im.role]}</span>
              </div>
            ))}
          </div>
        ) : <span className="st-hint">{s.elements.length ? 'No images: the saved character carried the look.' : 'None: the prompt alone carried the look.'}</span>}
      </div>
      <PromptViewer label="The final prompt, exactly as sent" wrapped={s.wrapped} text={s.prompt} />
    </div>
  )
}

// A small link under a still or a take that opens the panel.
export function SentButton({ candidateId, jobId, size = 'sm' }: { candidateId?: string; jobId?: string; size?: 'sm' | 'xs' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={`st-btn ghost ${size === 'xs' ? 'xs' : 'sm'}`} onClick={() => setOpen(true)} title="The prompt, images, model and cost of this run"><FileSearch size={13} />What was sent</button>
      <Modal open={open} onClose={() => setOpen(false)} className="st-sent-modal">
        <div className="st-card-body st-col" style={{ gap: 12 }}>
          <div className="st-row" style={{ gap: 8 }}><div className="st-h2 grow">What was sent</div><HowTo id="feedback" label="How prices and real cost work" /><button className="st-btn ghost sm" onClick={() => setOpen(false)}>Close</button></div>
          {open && <SentPanel candidateId={candidateId} jobId={jobId} />}
        </div>
      </Modal>
    </>
  )
}
