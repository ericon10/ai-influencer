import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { getJob, quoteJobs, runJobs, tick, type JobSpec } from './runner.js'
import { jobs } from '../db/schema.js'
import { explainFailure, jobViews } from './jobView.js'
import { estimateAction, runAction } from '../pipeline/actions.js'
import { finalizeImagePrompt } from '../core/realism.js'

// The live status of a run (owner, 2026-10-13): the phase from the runner's
// real state, the typical time, and failures in plain words with the money
// and a priced Retry.

let h: Harness
const still = (tag = ''): JobSpec => ({
  type: 'gen', stage: 'hero', purpose: 'hero:test', label: 'Test still',
  request: { kind: 'image', model: 'mock/image', prompt: finalizeImagePrompt(`A woman on a bench ${tag}`, { stage: 'hero' }).prompt, aspect: '3:4', resolution: '2k', quality: 'high' },
})
async function start(spec: JobSpec) {
  const q = await quoteJobs(h.deps, h.ctx, { purpose: 'test', characterId: null, specs: [spec] })
  const [row] = await runJobs(h.deps, h.ctx, { quoteId: q.id, confirmed: true, purpose: 'test', characterId: null, specs: [spec] })
  return row!
}
const view = async (id: string) => (await jobViews(h.deps, h.ctx.accountId, [await getJob(h.deps, h.ctx, id)], new Map([[id, 'Test still']])))[0]!

beforeAll(async () => { h = await createHarness() })
afterAll(async () => { await h.close() })

describe('live status', () => {
  it('follows the runner: queued, sent, generating, done; with a typical time', async () => {
    const row = await start(still())
    expect(await view(row.id)).toMatchObject({ phase: 'queued', phaseLabel: 'Queued', typicalSec: 45 })
    await tick(h.deps)
    const sent = await view(row.id)
    expect(['sent', 'generating', 'provider_queued', 'downloading', 'done']).toContain(sent.phase)
    await drain(h, 20)
    const done = await view(row.id)
    expect(done).toMatchObject({ phase: 'done', phaseLabel: 'Done', error: null, retry: false })
    expect(done.completedAt).toBeTruthy()
  })

  it('a failed run says what happened in plain words, that nothing was charged, and offers a priced Retry', async () => {
    const row = await start(still('[mock:fail]'))
    await drain(h, 20)
    const v = await view(row.id)
    expect(v).toMatchObject({ phase: 'failed', charged: 'no', retry: true, error: 'Mock generation failed.' })
    const { quote } = await estimateAction(h.deps, h.ctx, { type: 'retry', jobId: row.id })
    expect(quote.status).toBe('open')
    const { jobs: again } = await runAction(h.deps, h.ctx, { type: 'retry', jobId: row.id }, quote.id, true)
    expect(again).toHaveLength(1)
    const retried = await getJob(h.deps, h.ctx, again[0]!.id)
    expect(retried.purpose).toBe('hero:test')
    expect((retried.request as { prompt: string }).prompt).toBe((row.request as { prompt: string }).prompt)
    // A run that did not fail cannot be retried.
    await expect(estimateAction(h.deps, h.ctx, { type: 'retry', jobId: retried.id })).rejects.toThrow(/Only a failed run/)
  })

  it("uses the account's own median once there is history for a model", async () => {
    for (let i = 0; i < 3; i++) await start(still(`run ${i}`))
    await drain(h, 30)
    const done = await h.deps.db.select().from(jobs).where(eq(jobs.status, 'completed'))
    expect(done.length).toBeGreaterThanOrEqual(3)
    const v = await view(done[0]!.id)
    expect(v.typicalSec).not.toBeNull()
    expect(v.typicalSec).toBeLessThan(45)
  })
})

describe('failures in plain words', () => {
  it('translates what the provider said, and keeps the raw message for Details', () => {
    const preset = explainFailure('Higgsfield generate_video_batch failed: {"jobs":[{"index":0,"status":"submission_failed","error":"Preset \\"IN THE DARK\\" was recommended instead of submitting a job."}]}')
    expect(preset.plain).toMatch(/suggested one of its presets/)
    expect(preset.detail).toContain('submission_failed')
    expect(explainFailure('The provider content filter blocked this result.').plain).toMatch(/content filter/)
    expect(explainFailure('Not enough credits on your plan').plain).toMatch(/enough credits/)
    expect(explainFailure('Something short and clear.')).toEqual({ plain: 'Something short and clear.', detail: null })
    expect(explainFailure('{"weird":"json"}').plain).toBe('The provider reported a failure.')
  })
})
