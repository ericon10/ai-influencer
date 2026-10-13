import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../testing/harness.js'
import { codeVersion } from '../lib/codeVersion.js'
import { enqueueLocalJob } from './runner.js'
import { expectedVersion, readWorkerStatus, recordWakeFailure, reportWorkerStart, touchWorker } from './workerStatus.js'

// The worker light in the header: ready, restarting after a push, or down.
// Read from the database, so checking it never wakes a sleeping worker.

let h: Harness
const remote = () => ({ ...h.deps, env: { ...h.deps.env, STUDIO_WORKER_URL: 'https://worker.example.com' } })

beforeAll(async () => { h = await createHarness() })
afterAll(async () => { await h.close() })

describe('worker status', () => {
  it('is ready when the worker runs inside the Studio (local development)', async () => {
    expect(await readWorkerStatus(h.deps)).toMatchObject({ state: 'ready', inProcess: true })
  })

  it('is restarting until the worker reports the code the API runs', async () => {
    expect((await readWorkerStatus(remote())).state).toBe('restarting')
    await reportWorkerStart(h.deps, { version: 'old0000000', commit: 'abc1234' })
    expect(await readWorkerStatus(remote())).toMatchObject({ state: 'restarting', version: 'old0000000', commit: 'abc1234' })
    // A deploy that never arrives turns red after 20 minutes.
    h.clock.advance(21 * 60_000)
    const stuck = await readWorkerStatus(remote())
    expect(stuck.state).toBe('down')
    expect(stuck.message).toMatch(/has not updated to the new code in \d+ min/)
    await reportWorkerStart(h.deps, { version: expectedVersion(), commit: 'def5678' })
    expect(await readWorkerStatus(remote())).toMatchObject({ state: 'ready', version: expectedVersion(), commit: 'def5678' })
  })

  it('is down when a wake call fails, until the worker is seen again', async () => {
    h.clock.advance(1_000)
    await recordWakeFailure(h.deps, 'the worker answered 502')
    const down = await readWorkerStatus(remote())
    expect(down.state).toBe('down')
    expect(down.message).toContain('the worker answered 502')
    h.clock.advance(30_000)
    await touchWorker(h.deps)
    expect((await readWorkerStatus(remote())).state).toBe('ready')
  })

  it('is down when work waits minutes while the worker stays quiet', async () => {
    await enqueueLocalJob(h.deps, h.ctx, { stage: 'content', purpose: 'content_render:cnt_x', label: 'test', characterId: null, request: {} })
    h.clock.advance(60_000)
    expect((await readWorkerStatus(remote())).state).toBe('ready')
    h.clock.advance(4 * 60_000)
    const down = await readWorkerStatus(remote())
    expect(down.state).toBe('down')
    expect(down.message).toMatch(/Work has waited \d+ min/)
  })
})

describe('code version', () => {
  it('hashes the files the worker is built from, and only those', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codever-'))
    try {
      await mkdir(join(root, 'server', 'lib'), { recursive: true })
      await mkdir(join(root, 'config'), { recursive: true })
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'server', 'lib', 'a.ts'), 'export const a = 1\n')
      await writeFile(join(root, 'config', 'x.yaml'), 'a: 1\n')
      await writeFile(join(root, 'package.json'), '{}')
      const v1 = codeVersion(root)
      expect(v1).toMatch(/^[0-9a-f]{10}$/)
      // A UI change does not change it (the worker is not redeployed).
      await writeFile(join(root, 'src', 'page.tsx'), 'x')
      await writeFile(join(root, 'server', 'lib', 'notes.md'), 'x')
      expect(codeVersion(root)).toBe(v1)
      await writeFile(join(root, 'config', 'x.yaml'), 'a: 2\n')
      expect(codeVersion(root)).not.toBe(v1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
    expect(codeVersion(join(tmpdir(), 'nothing-here'))).toBeNull()
  })
})
