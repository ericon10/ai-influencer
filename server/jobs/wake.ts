import { createHmac } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import type { Deps } from '../context.js'

// The worker sleeps when nothing is queued (so the database can suspend and
// the Railway service can idle). The API wakes it whenever it queues work or
// a provider webhook arrives. The token is derived from the session secret,
// which both sides already have, so there is no extra key to manage.

export function wakeToken(sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update('studio-worker-wake').digest('hex')
}

let last = 0

// Set at boot (bootstrap) so a failed wake is recorded for the worker light,
// without this module depending on the database.
let onWakeFailure: ((message: string) => Promise<void>) | null = null
export function setWakeFailureHandler(fn: ((message: string) => Promise<void>) | null): void { onWakeFailure = fn }

// The worker's address as people paste it: with or without https://, with
// or without a trailing slash.
export function workerBaseUrl(raw: string | undefined): string | null {
  const v = (raw ?? '').trim().replace(/\/+$/, '')
  if (!v) return null
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

export async function wakeWorker(deps: Pick<Deps, 'env' | 'log'>, opts: { force?: boolean } = {}): Promise<void> {
  const url = workerBaseUrl(deps.env.STUDIO_WORKER_URL)
  if (!url) return
  // One wake every few seconds is plenty; the worker drains everything due.
  const now = Date.now()
  if (!opts.force && now - last < 3000) return
  last = now
  const sent = send(deps, url)
  // On Vercel the response goes out right away and the wake finishes in the
  // background; elsewhere (tests, local runs) the caller waits for it.
  if (process.env.VERCEL) waitUntil(sent)
  else await sent
}

async function send(deps: Pick<Deps, 'env' | 'log'>, url: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(`${url}/wake`, { method: 'POST', headers: { Authorization: `Bearer ${wakeToken(deps.env.STUDIO_SESSION_SECRET)}` }, signal: controller.signal })
    // A refusal or a server error is a worker that is down (the header shows it).
    if (!res.ok) await onWakeFailure?.(`the worker answered ${res.status}`)
  } catch (e) {
    // A cold worker may take longer than the timeout to answer; the request
    // still starts it. Anything else (no route, refused) is a failure.
    if ((e as Error).name !== 'AbortError') await onWakeFailure?.((e as Error).message)
    deps.log.info({ err: (e as Error).message }, 'worker wake sent')
  } finally {
    clearTimeout(timer)
  }
}
