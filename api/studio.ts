import { buildDeps } from '../server/bootstrap.js'
import { createApp } from '../server/api/app.js'
import { createPassphraseAuth } from '../server/auth/provider.js'
import { NotConfiguredError } from '../server/lib/env.js'

// Vercel entry for /api/v1/*. vercel.json rewrites /api/v1/(.*) here with the
// sub-path in __path (plain Vercel functions have no multi-segment routes).
// Long work never runs here: jobs go to the worker on Railway, which the API
// wakes when it queues something.

export const config = { maxDuration: 60 }

let ready: ReturnType<typeof init> | null = null
async function init() {
  const { deps } = await buildDeps()
  return createApp(deps, createPassphraseAuth(deps, { devAutoLogin: false }))
}

export default {
  async fetch(req: Request): Promise<Response> {
    // A failed cold start (say, the database was unreachable) is retried on
    // the next request instead of being cached for the life of the instance.
    ready ??= init().catch(e => { ready = null; throw e })
    let app: Awaited<typeof ready>
    try {
      app = await ready
    } catch (e) {
      // A deployment without its settings says what is missing (names only).
      if (e instanceof NotConfiguredError) return Response.json({ error: { code: 'not_configured', message: e.message, details: null } }, { status: 503 })
      throw e
    }
    const url = new URL(req.url)
    const sub = url.searchParams.get('__path')
    if (sub !== null) {
      url.searchParams.delete('__path')
      url.pathname = `/api/v1/${sub.replace(/^\/+/, '')}`
    }
    return app.fetch(new Request(url, req))
  },
}
