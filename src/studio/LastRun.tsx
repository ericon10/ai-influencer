import { AlertTriangle } from 'lucide-react'
import { useCharacterJobs } from './hooks'
import { Callout } from './ui'

// Shows when the most recent run of an action failed, right where the action
// lives, so a failure is never silent.
export function LastRun({ characterId, purpose }: { characterId: string; purpose: string }) {
  const jobs = useCharacterJobs(characterId)
  const last = (jobs.data?.jobs ?? []).find(j => j.purpose === purpose || j.purpose.startsWith(`${purpose}:`))
  if (!last || (last.status !== 'failed' && last.status !== 'needs_attention')) return null
  return (
    <Callout tone={last.status === 'failed' ? 'bad' : 'warn'} icon={<AlertTriangle size={16} />}>
      {last.status === 'failed' ? `The last run failed: ${last.error ?? 'unknown error'}. Failed runs cost nothing.` : `The last run needs your attention: ${last.error ?? ''}`}
    </Callout>
  )
}
