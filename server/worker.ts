import { buildDeps } from './bootstrap'
import { startWorker } from './jobs/runner'

// Standalone job worker for hosted deployments (a small always-on container
// next to the Vercel app, sharing the database).
const { deps, handle } = await buildDeps()
const stop = startWorker(deps, { intervalMs: 1000, batch: 10 })
deps.log.info({ db: handle.driver }, 'Character Studio worker running')
const shutdown = async () => { await stop(); await handle.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
