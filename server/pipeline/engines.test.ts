import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { startFakeProviders, type FakeProviders } from '../testing/fakeProviders.js'
import { registerPipelineHooks } from './hooks.js'
import { setSetting } from './settings.js'
import { pickView, routeModel, setPick, withRunProvider } from './engines.js'
import { runModel } from './sceneActions.js'
import { estimateAction, runAction } from './actions.js'
import { runFacts } from './sent.js'
import { quoteJobs, runJobs, type JobSpec } from '../jobs/runner.js'
import { jobViews } from '../jobs/jobView.js'
import { saveCredential } from '../providers/credentials.js'
import { jobs } from '../db/schema.js'
import { providerOf } from '../core/engines.js'
import { loadConfig } from '../config/load.js'
import { createKieAdapter } from '../providers/kie.js'
import { createWavespeedAdapter } from '../providers/wavespeed.js'

// Step > model > provider (UX-PLAN.md section 40): Higgsfield stays the
// default; a pick for the step, the character or a whole run moves the same
// model to Kie.ai or WaveSpeed; the picker prices every provider side by
// side; a live still runs on Kie.ai end to end (a fake Kie on localhost); a
// failed run offers the next provider with its price and only runs on a
// click. Never a real provider.

let h: Harness
let fake: FakeProviders
const local = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!/^http:\/\/127\.0\.0\.1:/.test(String(url))) throw new Error(`Tests never call ${String(url)}`)
  return fetch(url, init)
}) as typeof fetch

beforeAll(async () => {
  registerPipelineHooks()
  fake = await startFakeProviders()
  // The real adapters against the fake; outputs fetched straight from it
  // (the runner refuses loopback addresses, as it should).
  const grab = async (o: { url: string }) => Buffer.from(await (await fetch(o.url)).arrayBuffer())
  const config = loadConfig()
  h = await createHarness({
    fetchImpl: local, env: { KIE_API_BASE: fake.url, WAVESPEED_API_BASE: fake.url },
    overrides: { gen: {
      kie: { ...createKieAdapter({ apiKey: fake.goodKey.kie, config, baseUrl: fake.url }), download: grab },
      wavespeed: { ...createWavespeedAdapter({ apiKey: fake.goodKey.wavespeed, config, baseUrl: fake.url }), download: grab },
    } },
  })
})
afterAll(async () => { await fake?.stop() })

describe('the table', () => {
  it('every family runs its default first (Higgsfield where it runs the model), each provider priced', () => {
    for (const f of h.deps.config.engines.families) {
      if (f.providers.some(r => r.startsWith('higgsfield/'))) expect(providerOf(f.providers[0]!)).toBe('higgsfield')
    }
    expect(h.deps.config.engines.families.find(f => f.id === 'nano-banana-2.1')!.providers).toEqual(['higgsfield/nano-banana-2.1', 'google/nano-banana-2.1', 'kie/nano-banana-2.1', 'wavespeed/nano-banana-2.1'])
  })
})

describe('picks', () => {
  it('Higgsfield stays the default; a step pick, a character pick and a run pick move the same model, in that order of strength', async () => {
    expect(await routeModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image')).toBe('higgsfield/nano-banana-2.1')
    await setPick(h.deps, h.ctx, { step: 'still', family: 'nano-banana-2.1', provider: 'kie' })
    expect(await routeModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image')).toBe('kie/nano-banana-2.1')
    // Edits are their own step: still the default there.
    expect(await routeModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image_edit')).toBe('higgsfield/nano-banana-2.1')
    await setPick(h.deps, h.ctx, { step: 'still', family: 'nano-banana-2.1', provider: 'wavespeed', characterId: 'chr_callie' })
    expect(await routeModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image', { characterId: 'chr_callie' })).toBe('wavespeed/nano-banana-2.1')
    expect(await routeModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image', { characterId: 'chr_other' })).toBe('kie/nano-banana-2.1')
    // A whole run's provider (Weeks > Make the week) wins where it runs the model.
    expect(await withRunProvider('google', () => routeModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image', { characterId: 'chr_callie' }))).toBe('google/nano-banana-2.1')
    // ... and leaves a model it does not run alone.
    expect(await withRunProvider('google', () => routeModel(h.deps, h.ctx, 'higgsfield/kling-3.0-pro', 'video'))).toBe('higgsfield/kling-3.0-pro')
    // Back to the default.
    await setPick(h.deps, h.ctx, { step: 'still', family: 'nano-banana-2.1', provider: null })
    await setPick(h.deps, h.ctx, { step: 'still', family: 'nano-banana-2.1', provider: null, characterId: 'chr_callie' })
    expect(await routeModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image', { characterId: 'chr_callie' })).toBe('higgsfield/nano-banana-2.1')
    await expect(setPick(h.deps, h.ctx, { step: 'video', family: 'seedance-1.5-pro', provider: 'higgsfield' })).rejects.toThrow(/does not run Seedance 1.5 Pro/)
  })

  it('the picker: every provider\'s price side by side, the cheapest marked, "needs a key" until one is saved', async () => {
    const v = await pickView(h.deps, h.ctx, { step: 'video', model: 'higgsfield/kling-3.0-pro', seconds: 5 })
    expect(v.family).toEqual({ id: 'kling-3.0-pro', label: 'Kling 3.0 Pro' })
    expect(v.rows.map(r => [r.providerLabel, r.price, r.cheapest, r.ready, r.chosen])).toEqual([
      // Higgsfield's confirmed $0.084 a second is the cheapest Kling 3.0 Pro.
      ['Higgsfield', '$0.42', true, true, true],
      ['Kie.ai', '$0.45', false, false, false],
      ['WaveSpeed', '$0.56', false, false, false],
    ])
    expect(v.rows[1]!.checked).toBe('2026-10-23')
    await saveCredential(h.deps, h.ctx, 'kie', fake.goodKey.kie)
    expect((await pickView(h.deps, h.ctx, { step: 'video', model: 'higgsfield/kling-3.0-pro' })).rows[1]!.ready).toBe(true)
  })
})

describe('a live run on Kie.ai, and a failure that offers the next provider', () => {
  let failedId = ''
  it('a still picked onto Kie.ai is quoted at Kie\'s price, sent to Kie, fetched into storage, and its record names Kie.ai', async () => {
    await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
    await saveCredential(h.deps, h.ctx, 'kie', fake.goodKey.kie)
    await setPick(h.deps, h.ctx, { step: 'still', family: 'nano-banana-2.1', provider: 'kie' })
    const run = await runModel(h.deps, h.ctx, 'higgsfield/nano-banana-2.1', 'image')
    expect(run.model).toBe('kie/nano-banana-2.1')
    const spec = { type: 'gen', stage: 'scene', purpose: 'engines_test', label: 'A still on Kie.ai', request: { kind: 'image', model: run.model, prompt: 'A kitchen at night. REALISM: Natural skin texture, not retouched.', aspect: '9:16', resolution: '2k' } } as unknown as JobSpec
    const q = await quoteJobs(h.deps, h.ctx, { purpose: 'engines_test', characterId: null, specs: [spec] })
    expect(q.totalMicros).toBe(30_000)
    const [job] = await runJobs(h.deps, h.ctx, { quoteId: q.id, confirmed: true, purpose: 'engines_test', characterId: null, specs: [spec] })
    await drain(h, 20)
    const [done] = await h.deps.db.select().from(jobs).where(eq(jobs.id, job!.id))
    expect(done!.status).toBe('completed')
    expect(done!.provider).toBe('kie')
    expect(fake.calls.find(c => c.path === '/api/v1/jobs/createTask' && (c.body?.model === 'nano-banana-2-1'))?.body).toMatchObject({ input: { resolution: '2K', aspect_ratio: '9:16' } })
    expect(runFacts(h.deps, done!)).toMatchObject({ provider: 'kie', providerLabel: 'Kie.ai', pathLabel: 'Kie.ai API', quoted: '$0.03' })
  })

  it('a run Kie.ai fails says why and offers WaveSpeed with its price; nothing runs until it is clicked', async () => {
    await saveCredential(h.deps, h.ctx, 'wavespeed', fake.goodKey.wavespeed)
    const spec = { type: 'gen', stage: 'scene', purpose: 'engines_test', label: 'A still that fails', request: { kind: 'image', model: 'kie/nano-banana-2.1', prompt: 'FAIL this one. REALISM: Natural skin texture, not retouched.', aspect: '9:16', resolution: '2k' } } as unknown as JobSpec
    const q = await quoteJobs(h.deps, h.ctx, { purpose: 'engines_test', characterId: null, specs: [spec] })
    const [job] = await runJobs(h.deps, h.ctx, { quoteId: q.id, confirmed: true, purpose: 'engines_test', characterId: null, specs: [spec] })
    await drain(h, 20)
    const [failed] = await h.deps.db.select().from(jobs).where(eq(jobs.id, job!.id))
    expect(failed!.status).toBe('failed')
    failedId = failed!.id
    const before = fake.calls.filter(c => c.provider === 'wavespeed' && c.method === 'POST').length
    const [view] = await jobViews(h.deps, h.ctx.accountId, [failed!], new Map())
    expect(view!.error).toMatch(/Internal error/)
    expect(view!.providerLabel).toBe('Kie.ai')
    // Higgsfield and WaveSpeed run it and are ready; Google has no key.
    expect(view!.next.map(n => [n.label, n.price])).toEqual([['Higgsfield', expect.any(String)], ['WaveSpeed', '$0.07']])
    // Offering never spends.
    expect(fake.calls.filter(c => c.provider === 'wavespeed' && c.method === 'POST').length).toBe(before)
  })

  it('Try on WaveSpeed: priced first, then the same request runs on WaveSpeed', async () => {
    const { quote, preview } = await estimateAction(h.deps, h.ctx, { type: 'retry_on', jobId: failedId, provider: 'wavespeed' })
    expect(preview.title).toBe('Try on WaveSpeed: A still that fails')
    expect(quote.totalMicros).toBe(68_000)
    const started = await runAction(h.deps, h.ctx, { type: 'retry_on', jobId: failedId, provider: 'wavespeed' }, quote.id, true) as unknown as { jobs: Array<{ id: string }> }
    await drain(h, 20)
    const [again] = await h.deps.db.select().from(jobs).where(eq(jobs.id, started.jobs[0]!.id))
    expect([again!.status, again!.provider]).toEqual(['completed', 'wavespeed'])
    const sent = fake.calls.filter(c => c.provider === 'wavespeed' && c.method === 'POST').at(-1)!
    expect(sent.path).toBe('/api/v3/google/nano-banana-2.1/text-to-image')
    expect(sent.body).toMatchObject({ prompt: expect.stringContaining('FAIL this one'), resolution: '2k' })
  })
})
