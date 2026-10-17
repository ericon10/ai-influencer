import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { createFakeHiggsfield, type FakeHiggsfield } from '../testing/fakeHiggsfield.js'
import { registerPipelineHooks } from './hooks.js'
import { buildAction, estimateAction, runAction } from './actions.js'
import { importCharacter } from './files.js'
import { createContent } from './content.js'
import { createScene } from './scenes.js'
import { setSetting } from './settings.js'
import { slideStillOptions } from './slideshow.js'
import { saveBilling } from '../providers/billing.js'
import { saveCredential, storeSecret } from '../providers/credentials.js'
import { ACCOUNT_PROVIDER } from '../providers/higgsfieldOAuth.js'
import { estimateGen } from '../costs/pricebook.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { characters, jobs, ledgerEntries } from '../db/schema.js'
import type { GenRequest, ProviderAdapter } from '../providers/types.js'

// Section 30, live paths against an in-memory Higgsfield (nothing real
// runs): the stills path is the owner's pick and each slide's model follows
// who is in it. The fix: GPT Image 2.5 Flare on the plan path used to carry
// no billing path (only a model the API does not offer was sent to the
// account), so the runner gave it the account's Higgsfield default, which
// is the API in production: the quote, the hold and the charge were the
// API's dollars. Now the plan path bills the account: plan credits, 1 a
// still at Standard, through the MCP adapter.

let h: Harness
let fake: FakeHiggsfield
let callie: string
const FLARE = 'higgsfield/gpt-image-2.5-flare'

beforeAll(async () => {
  registerPipelineHooks()
  fake = createFakeHiggsfield()
  // The REST API prices from the price book and never submits here.
  const rest: ProviderAdapter = {
    id: 'higgsfield', listModels: async () => [], estimate: async req => estimateGen(h.deps.config, req),
    submit: async () => { throw new Error('The API path must not run in these tests.') },
    status: async () => { throw new Error('unused') }, result: async () => [],
  }
  h = await createHarness({ fetchImpl: fake.fetch, overrides: { gen: { higgsfield: rest } } })
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  // Callie's character file, template v1.6: "Scene stills: GPT Image 2.5
  // Flare by default", Nano Banana 2.1 as the alternative.
  await h.deps.db.update(characters).set({ preferredModels: { scene_still: FLARE, scene_still_alt: 'higgsfield/nano-banana-2.1', edit: 'higgsfield/nano-banana-2.1' } }).where(eq(characters.id, callie))
  await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
  await storeSecret(h.deps, h.ctx, ACCOUNT_PROVIDER, JSON.stringify({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() + 3600_000, clientId: 'client-1' }), 'Higgsfield account', '')
  await saveCredential(h.deps, h.ctx, 'higgsfield', 'kid_test:secret_test')
  // Production's Higgsfield default is the API: the plan path must not follow it.
  await saveBilling(h.deps, h.ctx, { default: 'api', creditUsd: 0 })
}, 180_000)

afterAll(async () => { await h?.close() })

const topicPost = () => createContent(h.deps, h.ctx, {
  kind: 'slideshow', characterId: callie, accountTag: 'F2', idea: 'rejection emails',
  spec: { mode: 'topic', hook: 'Rejected at 2:14am', slides: ['the email', 'the sign-off'], shots: ['a phone face up on a nightstand', 'a laptop on a couch pillow', 'a white gallery placard'], lock: { place: 'a dim living room' } },
})

describe('plan-path Flare bills plan credits (the fix)', () => {
  it('a topic slideshow on Your Higgsfield plan: GPT Image 2.5 Flare, 1 credit a still, quoted through the account', async () => {
    const post = await topicPost()
    fake.calls.length = 0
    const { quote } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'account' })
    expect(quote.models).toEqual(['GPT Image 2.5 Flare'])
    expect(quote.credits).toBe(3)
    expect(quote.display).toBe('3 credits')
    expect(quote.items.every(i => i.model === FLARE && i.amount === '1 credit')).toBe(true)
    // Priced by Higgsfield's own preflight on the account (MCP), as Flare.
    expect(fake.tool('generate_image')[0]!.args.params).toMatchObject({ model: 'gpt_image_2_5', variant: 'flare', quality: 'medium', resolution: '2k', get_cost: true })

    const { jobs: ran } = await runAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'account' }, quote.id, true)
    const rows = await h.deps.db.select().from(jobs).where(inArray(jobs.id, ran.map(j => j.id)))
    expect(rows.every(r => (r.request as GenRequest).billing === 'account' && (r.request as GenRequest).quotedCredits === 1)).toBe(true)
    // The hold is in credits.
    const holds = await h.deps.db.select().from(ledgerEntries).where(and(inArray(ledgerEntries.jobId, ran.map(j => j.id)), eq(ledgerEntries.entryType, 'hold')))
    expect(holds.map(x => [x.quantity, x.unit])).toEqual([[1, 'credit'], [1, 'credit'], [1, 'credit']])
    await drain(h, 60)
    // The run went to the account and the charge recorded 1 credit a still.
    expect(fake.tool('generate_image_batch').length).toBeGreaterThan(0)
    expect(fake.tool('generate_image_batch')[0]!.args.requests[0].params).toMatchObject({ model: 'gpt_image_2_5', variant: 'flare', quality: 'medium', resolution: '2k', use_unlim: false })
    const charges = await h.deps.db.select().from(ledgerEntries).where(and(inArray(ledgerEntries.jobId, ran.map(j => j.id)), eq(ledgerEntries.entryType, 'charge')))
    expect(charges.map(x => [x.quantity, x.unit, x.note])).toEqual([[1, 'credit', '1 plan credits'], [1, 'credit', '1 plan credits'], [1, 'credit', '1 plan credits']])
  })

  it('the same slides on the Higgsfield API: Flare in dollars, billed to the API', async () => {
    const post = await topicPost()
    const { quote } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'api' })
    expect(quote.models).toEqual(['GPT Image 2.5 Flare'])
    expect(quote.credits).toBe(0)
    expect(quote.totalMicros).toBe(3 * 62_500)
    const built = await buildAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'api' })
    expect(built.specs.every(s => (s.request as GenRequest).billing === 'api')).toBe(true)
  })
})

describe('a character slideshow: her slides on her file\'s default, the rest on the cheapest', () => {
  it('Callie\'s slides run Flare with "bare natural lips, no gloss" and her sheet refs (no element: Flare does not take one); a slide of a thing has no one in it', async () => {
    const post = await createContent(h.deps, h.ctx, {
      kind: 'slideshow', characterId: callie, accountTag: 'CALLIE', idea: 'job hunting at 6am',
      spec: { mode: 'character', hook: 'It was 6am', slides: ['then this', 'and this'], shots: ['sitting up in bed squinting at the phone', 'the laptop open on the duvet, screen not legible', 'Callie flopped back on the pillow'], lock: { place: 'her bedroom at 6am', outfit: 'a blue striped cotton pajama shirt' } },
    })
    const built = await buildAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'account' })
    const reqs = built.specs.map(s => s.request as GenRequest)
    expect(reqs.every(r => r.model === FLARE && r.billing === 'account')).toBe(true)
    expect(built.specs.map(s => s.stage)).toEqual(['scene', 'slideshow', 'scene'])
    expect(reqs[0]!.prompt).toContain('Bare natural lips, no gloss.')
    expect(reqs[0]!.refs?.length).toBeGreaterThan(0)
    expect(reqs[0]!.prompt).not.toContain('<<<')
    expect(reqs[1]!.prompt).not.toContain('Bare natural lips')
    expect(reqs[1]!.prompt).toContain('No one in focus and no faces')
    expect(built.preview.warnings.some(w => w.ruleId === 'slideshow-no-one')).toBe(true)
    const { quote } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'account' })
    expect(quote.display).toBe('3 credits')
  })

  it('a file whose default the API cannot run: Nano Banana 2.1 on the plan, Flare on the API, and "2 models" shows only when they differ', async () => {
    await h.deps.db.update(characters).set({ preferredModels: { scene_still: 'higgsfield/nano-banana-2.1', scene_still_alt: FLARE } }).where(eq(characters.id, callie))
    try {
      const o = await slideStillOptions(h.deps, h.ctx, callie)
      const plan = o.paths.find(p => p.path === 'account')!, api = o.paths.find(p => p.path === 'api')!
      expect(plan.character).toMatchObject({ label: 'Nano Banana 2.1', from: 'file', perStill: '1.5 credits' })
      expect(plan.empty).toMatchObject({ label: 'GPT Image 2.5 Flare', from: 'cheapest', perStill: '1 credit' })
      expect(api.character).toMatchObject({ label: 'GPT Image 2.5 Flare', from: 'file', perStill: '$0.06' })
      const post = await createContent(h.deps, h.ctx, {
        kind: 'slideshow', characterId: callie, accountTag: 'CALLIE', idea: 'a cafe morning',
        spec: { mode: 'character', hook: 'Morning', slides: ['the latte'], shots: ['typing at the cafe table', 'a latte beside the laptop'], lock: { place: 'a cafe corner table' } },
      })
      const { quote } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'account' })
      // One run, two models: both named, and Details lists each still.
      expect(quote.models).toEqual(['Nano Banana 2.1', 'GPT Image 2.5 Flare'])
      expect(quote.items.map(i => i.modelLabel)).toEqual(['Nano Banana 2.1', 'GPT Image 2.5 Flare'])
    } finally {
      await h.deps.db.update(characters).set({ preferredModels: { scene_still: FLARE, scene_still_alt: 'higgsfield/nano-banana-2.1' } }).where(eq(characters.id, callie))
    }
  })
})

describe('the launch plan\'s clip rows follow the path picked on the card', () => {
  it('a clip\'s opening still is the character\'s default, billed to the plan or the API as picked', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Callie at a cafe window seat on a weekday morning, a printed job posting and a latte.', title: 'P015', fields: { moment: 'Callie highlighting a printed job posting at a cafe window seat', setting: 'a neighborhood cafe window seat, soft daylight', outfit: 'a light-wash denim jacket over a white cotton crewneck tee' } })
    const clip = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'CALLIE', sceneId: scene.id, idea: 'the cafe', step: 'stills', spec: { plan: { rowId: 'P015', planId: 'plan-x', date: '2026-10-20', slot: 'AM' } } })
    for (const path of ['account', 'api'] as const) {
      const built = await buildAction(h.deps, h.ctx, { type: 'plan_generate', postIds: [clip.id], path })
      const reqs = built.specs.filter(s => s.type === 'gen').map(s => s.request as GenRequest)
      expect(reqs.length).toBe(1)
      expect(reqs[0]).toMatchObject({ model: FLARE, billing: path })
    }
    const { quote } = await estimateAction(h.deps, h.ctx, { type: 'plan_generate', postIds: [clip.id], path: 'account' })
    expect(quote.display).toBe('1 credit')
  })
})

describe('demo mode names the model a mock stands in for', () => {
  it('the button reads as it will live: "GPT Image 2.5 Flare (demo mock, free)"', async () => {
    await setSetting(h.deps, h.ctx, 'provider_mode', 'demo')
    try {
      const post = await topicPost()
      const { quote } = await estimateAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: post.id, path: 'account' })
      expect(quote.models).toEqual(['GPT Image 2.5 Flare (demo mock, free)'])
      expect(quote.items[0]!.modelLabel).toBe('GPT Image 2.5 Flare (demo mock, free)')
    } finally {
      await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
    }
  })
})
