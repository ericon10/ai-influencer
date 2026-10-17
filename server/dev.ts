import { serve } from '@hono/node-server'
import { buildDeps } from './bootstrap.js'
import { createApp } from './api/app.js'
import { createPassphraseAuth } from './auth/provider.js'
import { startWorker } from './jobs/runner.js'

// Local development: the API and the job worker in one process. Vite proxies
// /api/v1 here. Signs the owner in automatically unless a passphrase is set.
const { deps, handle } = await buildDeps()
const auth = createPassphraseAuth(deps, { devAutoLogin: !deps.env.isProduction && !deps.env.STUDIO_OWNER_PASSPHRASE })
const app = createApp(deps, auth)
const stopWorker = startWorker(deps, { intervalMs: 1000 })
const server = serve({ fetch: app.fetch, port: deps.env.STUDIO_API_PORT, hostname: '127.0.0.1' }, info => {
  deps.log.info({ port: info.port, db: handle.driver, storage: deps.store.driver, auth: auth.name }, 'Character Studio API ready')
})
// The worker and PGlite share this process, so a render or a big query can
// hold the event loop for a few seconds. Node closes an idle kept-alive
// connection after 5 s by default, and a timer that fires late closes one
// a client has just sent a request on (ECONNRESET, seen in the browser
// tests, G63). A long idle timeout keeps the client the one that closes.
if ('keepAliveTimeout' in server) {
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
}

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  await stopWorker()
  server.close()
  await handle.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
