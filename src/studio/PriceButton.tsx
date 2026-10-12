import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Info, Loader2, Receipt, Sparkles } from 'lucide-react'
import { api, ApiError } from './api'
import { useRefresh } from './hooks'
import type { StudioAction } from './types'
import { Callout, Modal, PromptViewer, errorMessage, useToast } from './ui'

// Every Generate button shows its price before it can be pressed (SPEC 11:
// "Money is always visible"). Estimates are free; the run must present the
// quote the person saw, or the server refuses it.

interface Props {
  action: StudioAction | null
  label: string
  variant?: 'primary' | 'secondary'
  size?: 'big' | 'normal' | 'sm'
  disabledReason?: string
  onStarted?: (jobIds: string[]) => void
  icon?: boolean
}

export function PriceButton({ action, label, variant = 'primary', size = 'normal', disabledReason, onStarted, icon = true }: Props) {
  const qc = useQueryClient()
  const refresh = useRefresh()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [details, setDetails] = useState(false)
  const key = ['estimate', JSON.stringify(action)]
  const est = useQuery({
    queryKey: key,
    queryFn: () => api.estimate(action!),
    enabled: !!action && !disabledReason,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const quote = est.data?.quote
  const blocked = quote?.status === 'blocked'
  const estimateError = est.error ? errorMessage(est.error) : null
  const disabled = !!disabledReason || !action || est.isLoading || !!estimateError || blocked || running

  async function go() {
    if (!action || !quote) return
    if (quote.needsConfirm && !confirming) { setConfirming(true); return }
    setRunning(true)
    try {
      // Re-quote if this one is close to expiring, so the run never fails on time.
      let q = quote
      if (new Date(q.expiresAt).getTime() - Date.now() < 30_000) q = (await qc.fetchQuery({ queryKey: key, queryFn: () => api.estimate(action) })).quote
      const { jobIds } = await api.run(action, q.id, confirming || !q.needsConfirm)
      toast({ tone: 'ok', text: `Started ${jobIds.length === 1 ? '1 job' : `${jobIds.length} jobs`} for ${q.total}.` })
      setConfirming(false)
      onStarted?.(jobIds)
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'quote_expired' || e.code === 'quote_required')) {
        toast({ tone: 'bad', text: 'The price changed. Check the new estimate and press again.' })
      } else {
        toast({ tone: 'bad', text: errorMessage(e) })
      }
    } finally {
      setRunning(false)
      qc.invalidateQueries({ queryKey: ['estimate'] })
      refresh('characterId' in (action ?? {}) ? (action as { characterId: string }).characterId : undefined)
    }
  }

  const cls = `st-btn ${variant === 'primary' ? 'primary' : ''} ${size === 'big' ? 'big' : size === 'sm' ? 'sm' : ''}`
  return (
    <div className="st-col" style={{ gap: 6, alignItems: 'flex-start' }}>
      <div className="st-row" style={{ gap: 6 }}>
        <button className={cls} disabled={disabled} onClick={go} title={disabledReason ?? estimateError ?? undefined}>
          {running ? <Loader2 size={16} className="st-spin" /> : icon && <Sparkles size={16} />}
          {confirming ? `Confirm ${quote?.total}` : label}
          {!confirming && (
            <span className="st-price">{est.isLoading ? '...' : blocked ? 'Over budget' : quote ? quote.total : estimateError ? 'n/a' : '...'}</span>
          )}
        </button>
        {confirming && <button className="st-btn ghost sm" onClick={() => setConfirming(false)}>Cancel</button>}
        {quote && !confirming && (
          <button className="st-btn ghost sm" onClick={() => setDetails(true)} aria-label="Price details"><Receipt size={14} />Details</button>
        )}
      </div>
      {disabledReason && <span className="st-hint">{disabledReason}</span>}
      {estimateError && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>{estimateError}</span>}
      {blocked && <span className="st-hint" style={{ color: 'var(--st-bad)' }}>This run would go over a budget cap. Adjust caps in Settings.</span>}
      {quote && !quote.verified && !blocked && <span className="st-hint"><Info size={12} style={{ verticalAlign: -2 }} /> Uses a price that is not confirmed with the provider yet.</span>}
      {(est.data?.preview.invalidates.length ?? 0) > 0 && (
        <span className="st-hint" style={{ color: 'var(--st-warn)' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> Will mark {est.data!.preview.invalidates.join(' and ')} for re-check.</span>
      )}

      <Modal open={details} onClose={() => setDetails(false)} className="st-quote">
        {quote && est.data && (
          <div className="st-card-body">
            <div className="st-kicker">Estimate</div>
            <div className="st-h2" style={{ marginBottom: 12 }}>{est.data.preview.title}</div>
            {quote.items.map((it, i) => (
              <div className="st-quote-line" key={i}><span>{it.label}<span className="st-muted"> · {it.model}</span></span><span>{it.amount}</span></div>
            ))}
            <div className="st-quote-total"><span className="st-muted">Total, reserved until done</span><b>{quote.total}</b></div>
            {quote.budget.warnings.map((w, i) => <div key={i} style={{ marginTop: 10 }}><Callout tone="warn">Close to the {w.scope} budget.</Callout></div>)}
            {est.data.preview.warnings.map((w, i) => <div key={i} style={{ marginTop: 10 }}><Callout tone="warn">{w.title}: {w.message}</Callout></div>)}
            {est.data.preview.prompts.length > 0 && (
              <div className="st-col" style={{ marginTop: 16 }}>
                {est.data.preview.prompts.map(p => <PromptViewer key={p.label} label={p.label} wrapped={p.wrapped} text={p.text} />)}
              </div>
            )}
            <p className="st-hint" style={{ marginTop: 14 }}>Failed or filtered runs are refunded by the provider and cost nothing here.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
