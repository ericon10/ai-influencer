import { buildDeps } from '../server/bootstrap'
import { createApp } from '../server/api/app'
import { createPassphraseAuth } from '../server/auth/provider'
import { tick } from '../server/jobs/runner'

// Vercel entry for /api/v1/*. vercel.json rewrites /api/v1/(.*) here with the
// sub-path in __path (plain Vercel functions have no multi-segment routes).
// A Vercel Cron call to /api/v1/cron/tick?key=... runs a worker sweep when no
// separate worker container is deployed.

export const config = { runtime: 'nodejs', maxDuration: 300 }

let ready: ReturnType<typeof init> | null = null
async function init() {
  const { deps } = await buildDeps()
  const app = createApp(deps, createPassphraseAuth(deps, { devAutoLogin: false }))
  return { deps, app }
}

export default async function handler(req: Request): Promise<Response> {
  ready ??= init()
  const { deps, app } = await ready
  const url = new URL(req.url)
  const sub = (url.searchParams.get('__path') ?? '').replace(/^\/+/, '')
  url.searchParams.delete('__path')
  url.pathname = `/api/v1/${sub}`
  if (sub === 'cron/tick') {
    if (url.searchParams.get('key') !== process.env.CRON_SECRET) return new Response('Forbidden', { status: 403 })
    const n = await tick(deps, 20)
    return Response.json({ processed: n })
  }
  return app.fetch(new Request(url, req))
}
