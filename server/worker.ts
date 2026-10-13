import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { buildDeps } from './bootstrap.js'
import { startWorker } from './jobs/runner.js'
import { wakeToken } from './jobs/wake.js'

// The job worker (Railway). Generation runs on the providers' side; this
// process submits, polls, downloads, strips audio, and runs QA, seam joins
// and imported-sheet checks, with no time limit. It stays lean: when nothing
// is queued it sends no queries and waits for the API to wake it over HTTP,
// so Neon can suspend and the Railway service can sleep.

const { deps, handle } = await buildDeps()
const idle = deps.env.STUDIO_WORKER_IDLE
const worker = startWorker(deps, { intervalMs: 1000, batch: 5, idle })

const expected = Buffer.from(`Bearer ${wakeToken(deps.env.STUDIO_SESSION_SECRET)}`)
const authorized = (header: string | undefined) => {
  const got = Buffer.from(header ?? '')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

const port = Number(process.env.PORT || 0)
const server = port
  ? createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
        return
      }
      if (req.method === 'POST' && req.url === '/wake') {
        if (!authorized(req.headers.authorization)) { res.writeHead(401).end(); return }
        worker.wake()
        res.writeHead(202, { 'content-type': 'application/json' }).end('{"ok":true}')
        return
      }
      res.writeHead(404).end()
    }).listen(port, () => deps.log.info({ port }, 'worker listening for wake calls'))
  : null

deps.log.info({ db: handle.driver, idle, storage: deps.store.driver }, 'Character Studio worker running')
const shutdown = async () => {
  server?.close()
  await worker()
  await handle.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
