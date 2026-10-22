import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Info, Loader2, Receipt, RotateCcw, Sparkles } from 'lucide-react'
import { api, ApiError } from './api'
import { isActiveJob, keys, useLiveJobs, useRefresh, useWorkerGate } from './hooks'
import type { JobView, StudioAction } from './types'
import { Callout, Modal, PromptViewer, Todo, errorMessage, useToast, type TodoItem } from './ui'
import { RunStatus } from './runs'

// Every Generate button shows its price before it can be pressed (SPEC 11:
// "Money is always visible"). Estimates are free; the run must present the
// quote the person saw, or the server refuses it. A button is never silently
// gray: what is left to do sits right above it, and a price that cannot be
// fetched says why, with a Retry.

// How long the button waits for a price before it says what went wrong.
const PRICE_WAIT_MS = 10_000

interface Props {
  action: StudioAction | null
  label: string
  variant?: 'primary' | 'secondary'
  size?: 'big' | 'normal' | 'sm'
  // What still has to be done before this can run, each linked to its field.
  todo?: TodoItem[]
  // A reason that is not a field to fill (shown above the button too).
  disabledReason?: string
  // A short wait that clears on its own (saving), shown with a spinner.
  waiting?: string
  onStarted?: (jobIds: string[]) => void
  icon?: boolean
  // Runs that belong to this button even when started elsewhere or before
  // a reload; their live status shows under it (feedback everywhere).
  watch?: (j: JobView) => boolean
  // Earlier failures are already folded where the results show (a stills
  // grid): the run list under the button leaves them out.
  hideEarlier?: boolean
  // No live status here (another place shows it).
  noStatus?: boolean
  // A small button inside a status line (Retry): no details or notes.
  compact?: boolean
  // Called once when every run this button started has finished.
  onDone?: () => void
}

async function estimateWithin(action: StudioAction, outer?: AbortSignal) {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, PRICE_WAIT_MS)
  const cancel = () => ctl.abort()
  outer?.addEventListener('abort', cancel)
  try {
    return await api.estimate(action, ctl.signal)
  } catch (e) {
    if (timedOut) throw new Error(`No price after ${PRICE_WAIT_MS / 1000} seconds. Higgsfield may be slow to answer right now. Press Retry; nothing has been charged.`)
    if (e instanceof TypeError) throw new Error('Could not reach the Studio to get a price. Check your connection and press Retry.')
    throw e
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', cancel)
  }
}

export function PriceButton({ action, label, variant = 'primary', size = 'normal', todo = [], disabledReason, waiting, onStarted, icon = true, watch, noStatus = false, compact = false, hideEarlier = false, onDone }: Props) {
  const qc = useQueryClient()
  const refresh = useRefresh()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState<string[]>([])
  const [details, setDetails] = useState(false)
  const key = ['estimate', JSON.stringify(action)]
  const blockers: TodoItem[] = [...todo, ...(disabledReason ? [{ label: disabledReason }] : [])]
  // While the worker restarts or is down, nothing starts (it would wait, or
  // run on old code); the reason shows instead.
  const worker = useWorkerGate()
  const held = blockers.length > 0 || !!waiting || !worker.ready
  const est = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => estimateWithin(action!, signal),
    enabled: !!action && !held,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const quote = est.data?.quote
  // When the runs started here are all done, the posts are read again and
  // onDone is called once, however fast they ran (a run that finished
  // between two polls of the jobs list never looks busy, so nothing else
  // would refresh the post).
  const live = useLiveJobs()
  const doneFor = useRef('')
  useEffect(() => {
    if (!started.length) return
    const key = started.join(',')
    if (doneFor.current === key) return
    const jobs = live.data?.jobs ?? []
    if (started.every(id => jobs.some(j => j.id === id && !isActiveJob(j)))) {
      doneFor.current = key
      void qc.invalidateQueries({ queryKey: keys.content })
      onDone?.()
    }
  }, [live.data, started, onDone]) // eslint-disable-line react-hooks/exhaustive-deps
  // Realism warnings (smoothing or makeup words removed) are shown right
  // under the button, not only in the details; so is a word of yours the
  // provider's filter often blocks (it goes as typed, G46).
  const realism = (est.data?.preview.warnings ?? []).filter(w => (w as { ruleId?: string }).ruleId?.startsWith('realism'))
  const risky = (est.data?.preview.warnings ?? []).filter(w => (w as { ruleId?: string }).ruleId === 'wording-risky')
  // A clone with no stills says so before the click (item 20).
  const noStills = (est.data?.preview.warnings ?? []).filter(w => w.ruleId === 'clone-no-stills')
  // The clip reader's outfit names no garment type (UX-PLAN section 26):
  // the warning, with its one-tap fix priced on its own button.
  const garment = (est.data?.preview.warnings ?? []).filter(w => w.ruleId === 'outfit-garment')
  const blocked = quote?.status === 'blocked'
  // The daily cap (section 31): a run that would pass it waits, and says so
  // with today's spend and its price; every price shows today's spend.
  const waits = blocked && !!quote?.budget.blocks.some(b => b.scope === 'day')
  const today = quote?.budget.day?.label
  const estimateError = est.error ? errorMessage(est.error) : null
  const disabled = held || !action || est.isLoading || !!estimateError || blocked || running

  async function go() {
    // One click starts one run: a second click while sending does nothing.
    if (!action || !quote || running) return
    if (quote.needsConfirm && !confirming) { setConfirming(true); return }
    setRunning(true)
    try {
      // Re-quote if this one is close to expiring, so the run never fails on time.
      let q = quote
      if (new Date(q.expiresAt).getTime() - Date.now() < 30_000) q = (await qc.fetchQuery({ queryKey: key, queryFn: () => api.estimate(action) })).quote
      let jobIds: string[]
      try {
        ({ jobIds } = await api.run(action, q.id, confirming || !q.needsConfirm))
      } catch (e) {
        // What runs changed since the price was shown (a chip, a pick), but
        // not the price: quote again and run at the same price shown.
        if (!(e instanceof ApiError && e.code === 'quote_expired')) throw e
        const fresh = (await qc.fetchQuery({ queryKey: key, queryFn: () => api.estimate(action), staleTime: 0 })).quote
        if (fresh.display !== q.display || fresh.status !== 'open' || (fresh.needsConfirm && !confirming && !q.needsConfirm)) throw e
        q = fresh
        ;({ jobIds } = await api.run(action, q.id, confirming || !q.needsConfirm))
      }
      // The live status shows right under the button; a toast only when it
      // is not shown here.
      if (noStatus) toast({ tone: 'ok', text: `Started ${jobIds.length === 1 ? '1 job' : `${jobIds.length} jobs`} for ${q.display}.` })
      setStarted(ids => [...ids, ...jobIds])
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
  const price = held || !action ? null
    : est.isFetching && !quote ? <span className="st-price loading"><Loader2 size={13} className="st-spin" />Getting price...</span>
    : blocked ? <span className="st-price">{waits ? 'Waits' : 'Over budget'}</span>
    : quote ? <span className="st-price">{quote.display}</span>
    : estimateError ? <span className="st-price">No price</span>
    : null
  return (
    <div className="st-col st-pricebtn" style={{ gap: 8, alignItems: 'flex-start' }}>
      <Todo items={blockers} />
      {!worker.ready && <span className="st-hint st-warntext" role="status"><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {worker.reason}</span>}
      {waiting && !blockers.length && <span className="st-hint st-row" style={{ gap: 6 }}><Loader2 size={13} className="st-spin" />{waiting}</span>}
      <div className="st-row st-pricebtn-row" style={{ gap: 6 }}>
        <button className={cls} disabled={disabled} onClick={go} title={blockers.map(b => b.label).join(', ') || estimateError || undefined}>
          {running ? <Loader2 size={16} className="st-spin" /> : icon && <Sparkles size={16} />}
          {running ? 'Submitting...' : confirming ? `Confirm ${quote?.display}` : label}
          {!confirming && !running && price}
        </button>
        {confirming && <button className="st-btn ghost sm" onClick={() => setConfirming(false)}>Cancel</button>}
        {quote && !held && <span className="st-model-tag" title="The model this runs on (Claude models can be switched in Settings)">{quote.models.join(' + ')}</span>}
        {quote && !held && today && <span className="st-today-tag" data-field="today-spend" title="Today's spend (UTC) against your daily cap: what ran today and what is running now. Plan credits count at the Higgsfield API rate.">{today}</span>}
        {quote && !confirming && !compact && (
          <button className="st-btn ghost sm" onClick={() => setDetails(true)} aria-label="Price details"><Receipt size={14} />Details</button>
        )}
      </div>
      {estimateError && !held && (
        <div className="st-price-error" role="alert">
          <AlertTriangle size={16} style={{ color: 'var(--st-bad)', flex: 'none' }} />
          <span className="msg">{estimateError}</span>
          <button className="st-btn sm secondary" onClick={() => est.refetch()} disabled={est.isFetching}>{est.isFetching ? <Loader2 size={13} className="st-spin" /> : <RotateCcw size={13} />}Retry</button>
        </div>
      )}
      {!compact && quote?.notes?.map((n, i) => <span key={i} className="st-hint" style={{ color: 'var(--st-warn)' }}><Info size={12} style={{ verticalAlign: -2 }} /> {n}</span>)}
      {est.data?.preview.followUp && !held && (
        <span className="st-hint"><Receipt size={12} style={{ verticalAlign: -2 }} /> Then: {est.data.preview.followUp.label}: <b>{est.data.preview.followUp.display}</b> on {est.data.preview.followUp.models.join(' + ')}{est.data.preview.followUp.verified ? '' : ' (not confirmed yet)'}</span>
      )}
      {blocked && (
        <span className="st-hint" style={{ color: 'var(--st-bad)' }} role="alert" data-field="budget-block">
          {(quote?.budget.messages?.length ? quote.budget.messages : ['This run would go over a budget cap.']).join(' ')}{' '}
          <Link to="/studio/settings?tab=usage">Budgets and usage</Link>
        </span>
      )}
      {!noStatus && !compact && <RunStatus ids={started} match={watch} pending={running} hideEarlier={hideEarlier} />}
      {realism.map((w, i) => <span key={i} className="st-hint" style={{ color: 'var(--st-warn)' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {w.message}</span>)}
      {noStills.map((w, i) => <span key={`s${i}`} className="st-hint" data-field="clone-no-stills" style={{ color: 'var(--st-warn)' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {w.title}: {w.message}</span>)}
      {risky.map((w, i) => <span key={`r${i}`} className="st-hint" data-field="wording-risky" style={{ color: 'var(--st-warn)' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {w.title}: {w.message}</span>)}
      {!compact && garment.map((w, i) => (
        <div key={`g${i}`} className="st-col" style={{ gap: 6 }} data-field="outfit-garment">
          <span className="st-hint" style={{ color: 'var(--st-warn)' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {w.title}: {w.message}</span>
          {w.fix && <PriceButton action={w.fix.action} label={w.fix.label} size="sm" variant="secondary" icon={false} watch={j => 'contentId' in w.fix!.action && j.purpose === `${w.fix!.action.type}:${w.fix!.action.contentId}`} onDone={() => { void qc.invalidateQueries({ queryKey: keys.content }); void qc.invalidateQueries({ queryKey: ['estimate'] }) }} />}
        </div>
      ))}
      {quote && !quote.verified && !blocked && !compact && <span className="st-hint"><Info size={12} style={{ verticalAlign: -2 }} /> Uses a price that is not confirmed with the provider yet.</span>}
      {(est.data?.preview.invalidates.length ?? 0) > 0 && (
        <span className="st-hint" style={{ color: 'var(--st-warn)' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> Will mark {est.data!.preview.invalidates.join(' and ')} for re-check.</span>
      )}

      <Modal open={details} onClose={() => setDetails(false)} className="st-quote">
        {quote && est.data && (
          <div>
            <div className="st-kicker">Estimate</div>
            <div className="st-h2" style={{ marginBottom: 12 }}>{est.data.preview.title}</div>
            {quote.items.map((it, i) => (
              <div className="st-quote-line" key={i}><span>{it.label}<span className="st-muted"> · {it.modelLabel}</span></span><span>{it.amount}</span></div>
            ))}
            <div className="st-quote-total"><span className="st-muted">Total, reserved until done</span><b>{quote.display}</b></div>
            {quote.credits > 0 && <p className="st-hint" style={{ marginTop: 8 }}>Plan credits come from your Higgsfield account{quote.totalMicros > 0 ? `; they count as ${quote.total} toward budgets` : ''}.</p>}
            {quote.budget.warnings.map((w, i) => <div key={i} style={{ marginTop: 10 }}><Callout tone="warn">Close to the {w.scope === 'day' ? 'daily' : w.scope} budget.</Callout></div>)}
            {quote.budget.day && <p className="st-hint" style={{ marginTop: 8 }}>Daily cap: {quote.budget.day.label} (UTC). Plan credits count at the Higgsfield API rate.</p>}
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
