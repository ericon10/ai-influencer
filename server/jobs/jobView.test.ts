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

  it('a refusal names the likely trigger words and offers Retry with safer wording (free rewording, priced run)', async () => {
    const row = await start(still('in a tight black tank top and boy shorts [mock:fail]'))
    await drain(h, 20)
    // Not a filter refusal: no trigger words, no safer retry.
    expect(await view(row.id)).toMatchObject({ triggers: [], safer: false })
    await h.deps.db.update(jobs).set({ error: { message: 'The provider content filter blocked this result.' } }).where(eq(jobs.id, row.id))
    const v = await view(row.id)
    expect(v).toMatchObject({ error: 'The provider\'s content filter blocked this result.', safer: true, retry: true })
    expect([...v.triggers].sort()).toEqual(['boy shorts', 'tight'])
    const { quote, preview } = await estimateAction(h.deps, h.ctx, { type: 'retry_safer', jobId: row.id })
    expect(quote.status).toBe('open')
    expect(preview.title).toBe('Retry with safer wording: Test still')
    expect(preview.prompts[0]!.text).toContain('in a black tank top and bike shorts')
    expect(preview.warnings.find(w => w.ruleId === 'wording-safer')?.message).toMatch(/^Changed: (tight, boy shorts|boy shorts, tight)\. Only the words change, never the outfit\./)
    const { jobs: again } = await runAction(h.deps, h.ctx, { type: 'retry_safer', jobId: row.id }, quote.id, true)
    const retried = await getJob(h.deps, h.ctx, again[0]!.id)
    const sent = (retried.request as { prompt: string }).prompt
    expect(sent).toContain('A woman on a bench in a black tank top and bike shorts')
    expect(sent).not.toMatch(/\btight\b|boy shorts/)
    // The REALISM block stays (rule zero).
    expect(sent).toMatch(/REALISM:/)
    // Nothing to reword: the plain Retry is the way.
    const plain = await start(still('[mock:fail]'))
    await drain(h, 20)
    await h.deps.db.update(jobs).set({ error: { message: 'The provider content filter blocked this result.' } }).where(eq(jobs.id, plain.id))
    expect(await view(plain.id)).toMatchObject({ triggers: [], safer: false, retry: true })
    await expect(estimateAction(h.deps, h.ctx, { type: 'retry_safer', jobId: plain.id })).rejects.toThrow(/No likely trigger words/)
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

  it('a render on the worker never blames the provider', () => {
    const ffmpeg = 'ffmpeg exited with code 1: Error reinitializing filters! | Failed to inject frame into filter network: Invalid argument'
    expect(explainFailure(ffmpeg, { local: true })).toEqual({ plain: 'The render failed on our side. Nothing was charged.', detail: ffmpeg })
    expect(explainFailure('Add shot B for the crash zoom cut (Video step).', { local: true }).plain).toMatch(/Add shot B/)
    expect(explainFailure(ffmpeg).plain).not.toMatch(/our side/)
  })
})
