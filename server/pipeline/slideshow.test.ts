import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { and, eq } from 'drizzle-orm'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { buildAction, estimateAction, runAction, type StudioAction } from './actions.js'
import { importCharacter } from './files.js'
import { createContent, getContent, startRender, updateContent, type ContentOutputs } from './content.js'
import { batchView, familyView, listSlideScenes, reuseReport, reviewBatchItem, saveSlideScene, archiveSlideScene, slideStillChoices, vaultHookIdeas } from './slideshow.js'
import { importKit, starterKit } from './scaleKit.js'
import { setSetting } from './settings.js'
import { saveCredential } from '../providers/credentials.js'
import { setRuleSwitch } from './rules.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { candidates, contentItems, jobs } from '../db/schema.js'
import { emptySpecial, slideList } from '../core/slides.js'
import { productShotBox } from '../core/slideSvg.js'
import type { SlideshowSpec } from '../core/slideshowSpec.js'
import type { GenRequest } from '../providers/types.js'

// The slideshow power-up (UX-PLAN.md section 27) in demo mode: hooks from
// the vault (free) and from Claude (priced), a draft from one hook, the
// stills of one locked scene (the character, or a topic), one slide
// rerolled, the export with both sizes and post.json, variations in a
// family, a batch from pasted hooks with its review, the no-reuse warning
// and the Scene library. Everything paid is priced first; nothing real runs.

let h: Harness
let characterId: string

const spec = async (id: string) => (await getContent(h.deps, h.ctx, id)).spec as SlideshowSpec

async function run(action: StudioAction) {
  const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
  expect(quote.status).toBe('open')
  expect(quote.totalMicros).toBeGreaterThan(0)
  const { jobs } = await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 120)
  return { quote, preview, jobs }
}

async function drafted(extra: Partial<SlideshowSpec> = {}, tag = 'callie.jobs') {
  const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: tag, idea: 'job hunting after college', spec: extra })
  await run({ type: 'slideshow_draft', contentId: post.id, hook: 'My manager said I would never get promoted', pattern: 'doubt' })
  return post.id
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  await importKit(h.deps, h.ctx, starterKit(), 'SideStep')
}, 120_000)

describe('hook first', () => {
  it('10 from the vault: free, tagged by pattern, from the kit\'s own hooks', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, idea: 'job hunting' })
    const row = await vaultHookIdeas(h.deps, h.ctx, post.id)
    const s = row.spec as SlideshowSpec
    expect(s.hookIdeas).toHaveLength(10)
    expect(s.hookIdeas.every(x => x.source === 'vault' && x.pattern)).toBe(true)
    expect(s.productId).toMatch(/^prd_/)
    const again = (await vaultHookIdeas(h.deps, h.ctx, post.id, { offset: 5 })).spec as SlideshowSpec
    expect(again.hookIdeas[0]!.text).not.toBe(s.hookIdeas[0]!.text)
  })

  it('Write 10 with Claude, the playbook way: one price for the writer and a separate reviewer; each hook has a moment, a code, effects, an alt hook and a score; only 1s and 2s show', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'F2', idea: 'job hunting', spec: { mode: 'topic' } })
    const { quote, preview, jobs: ran } = await run({ type: 'slideshow_hooks', contentId: post.id })
    expect(quote.models).toEqual(['Demo mock, free'])
    expect(ran).toHaveLength(2)
    expect(preview.prompts.map(p => p.label)).toEqual(['Hook writer', 'Reviewer'])
    const writer = preview.prompts[0]!.text
    expect(writer).toContain('Hooks from the vault')
    expect(writer).toContain('S11 Contrast pair')
    expect(writer).toContain('E1 "That\'s literally me"')
    // F2's primary and backup from the playbook's fit table.
    expect(writer).toContain('the primary is L14 Museum exhibit')
    expect(writer).toContain('The backup is S1 Levels')
    expect(preview.prompts[1]!.text).toContain('separate reviewer')
    const s = await spec(post.id)
    expect(s.hookReview).toBe('done')
    expect(s.hookIdeas).toHaveLength(10)
    expect(s.hookIdeas.every(x => x.source === 'claude' && x.code && x.effectOpen && x.moment && x.alt && x.reviewed)).toBe(true)
    // The mock reviewer gives 3 of 10 a 3 or 4: those are hidden.
    expect(s.hookIdeas.filter(x => (x.score ?? 9) <= 2)).toHaveLength(7)
    expect(s.hookIdeas.filter(x => x.code === 'L14').length).toBeGreaterThanOrEqual(2)
  })

  it('never the same code twice in a row: the account\'s last post\'s code is out of the writer\'s list', async () => {
    const before = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'F6', idea: 'rounds', spec: { mode: 'topic', plan: { structure: 'S6' } } })
    expect(before.id).toBeTruthy()
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'F6', idea: 'rounds', spec: { mode: 'topic' } })
    const { preview } = await run({ type: 'slideshow_hooks', contentId: post.id })
    expect(preview.prompts[0]!.text).toContain('Never use S6 Teaser: the account\'s last post used it.')
    expect((await spec(post.id)).hookIdeas.some(x => x.code === 'S6')).toBe(false)
  })

  it('Use this hook: every slide drafted (6 by default), the hook word for word, a shot each, special slides never first and at most 2, the scene, the caption, at most 5 hashtags', async () => {
    const id = await drafted()
    const s = await spec(id)
    expect(s.hook).toBe('My manager said I would never get promoted')
    expect(1 + s.slides.length).toBe(6)
    expect(s.shots).toHaveLength(6)
    expect(s.shots.every(x => x.length > 3)).toBe(true)
    expect(s.specials[0]).toBeNull()
    expect(s.specials.filter(Boolean).length).toBeLessThanOrEqual(2)
    expect(s.lock).toMatchObject({ place: 'a small home office by a window', light: 'window', camera: 'friend_phone', outfit: 'a gray cotton crewneck sweater' })
    expect(s.lock.details).toHaveLength(2)
    expect(s.caption).toContain('My manager said')
    expect(s.hashtags.length).toBeLessThanOrEqual(5)
    expect(s.pattern).toBe('doubt')
  })

  it('a scene field the owner typed is never replaced by a draft', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, idea: 'jobs', spec: { lock: { place: 'a rooftop bar at dusk', ownerSet: ['place'] } } })
    await run({ type: 'slideshow_draft', contentId: post.id, hook: 'POV: the recruiter finally calls back' })
    expect((await spec(post.id)).lock.place).toBe('a rooftop bar at dusk')
  })
})

describe('stills in one locked scene', () => {
  it('Generate the set: one still per empty photo slide, the locked lines and REALISM in every prompt, the sheet attached, each still in its own slide with the free checks', async () => {
    const id = await drafted()
    const before = slideList(await spec(id))
    const photos = before.filter(s => !s.special).length
    const built = await buildAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: id })
    expect(built.specs).toHaveLength(photos)
    for (const sp of built.specs) {
      const req = sp.request as GenRequest
      expect(req.prompt).toContain('a small home office by a window')
      expect(req.prompt).toContain('one camera roll')
      expect(req.prompt).toContain('a gray cotton crewneck sweater')
      expect(req.prompt).toMatch(/REALISM:/)
      expect(req.refs?.length).toBeGreaterThan(0)
      expect(req.aspect).toBe('9:16')
    }
    // Only the moment changes from slide to slide.
    expect(new Set(built.specs.map(x => (x.request as GenRequest).prompt)).size).toBe(photos)
    await run({ type: 'slideshow_stills', contentId: id })
    const after = slideList(await spec(id))
    expect(after.every(s => s.stillId || s.special)).toBe(true)
    const rows = await h.deps.db.select().from(candidates).where(eq(candidates.accountId, h.ctx.accountId))
    const mine = rows.filter(r => after.some(s => s.stillId === r.id))
    expect(mine).toHaveLength(photos)
    expect(mine.every(r => r.target === 'scene' && r.op === 'generate' && r.status === 'in_review' && r.qaReport)).toBe(true)
  })

  it('Reroll one slide: a new still for that slide only, the rest untouched', async () => {
    const id = await drafted()
    await run({ type: 'slideshow_stills', contentId: id })
    const before = (await spec(id)).stillIds
    const target = slideList(await spec(id)).find(s => s.index > 0 && !s.special)!.index
    const { quote } = await run({ type: 'slideshow_stills', contentId: id, slides: [target] })
    expect(quote.items).toHaveLength(1)
    const after = (await spec(id)).stillIds
    expect(after[target]).not.toBe(before[target])
    expect(after.filter((x, i) => i !== target)).toEqual(before.filter((x, i) => i !== target))
  })

  it('Instagram 3:4: the stills are made at 3:4', async () => {
    const id = await drafted({ made: 'instagram' })
    const built = await buildAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: id })
    expect(built.specs.every(x => (x.request as GenRequest).aspect === '3:4')).toBe(true)
  })

  it('a topic slideshow: no one in the photos, no refs, the REALISM line still in every prompt, no face check', async () => {
    const id = await drafted({ mode: 'topic' })
    const built = await buildAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: id })
    for (const sp of built.specs) {
      const req = sp.request as GenRequest
      expect(sp.stage).toBe('slideshow')
      expect(req.refs ?? []).toHaveLength(0)
      expect(req.prompt).toContain('No one in focus and no faces')
      expect(req.prompt).toMatch(/REALISM: A real phone photo/)
      expect(req.prompt).not.toContain('Callie')
    }
    await run({ type: 'slideshow_stills', contentId: id })
    const list = slideList(await spec(id))
    const ids = list.map(s => s.stillId).filter((x): x is string => !!x)
    const rows = await h.deps.db.select().from(candidates).where(eq(candidates.accountId, h.ctx.accountId))
    expect(rows.filter(r => ids.includes(r.id)).every(r => r.op === 'slide_topic' && r.sceneId === null && r.qaReport === null)).toBe(true)
  })

  it('works on the Higgsfield API, not only the plan: with only an API key the stills run on GPT Image 2.5 Flare, billed to the API', async () => {
    await setSetting(h.deps, h.ctx, 'provider_mode', 'live')
    try {
      const none = await slideStillChoices(h.deps, h.ctx)
      expect(none.choices.find(c => c.path === 'account')!.problem).toMatch(/Higgsfield plan/)
      await saveCredential(h.deps, h.ctx, 'higgsfield', 'kid_test:secret_test')
      const { choices, pick } = await slideStillChoices(h.deps, h.ctx)
      expect(pick).toBe('higgsfield/gpt-image-2.5-flare')
      expect(choices.find(c => c.ref === pick)!.problem).toBeNull()
      const id = await (async () => { await setSetting(h.deps, h.ctx, 'provider_mode', 'demo'); const x = await drafted(); await setSetting(h.deps, h.ctx, 'provider_mode', 'live'); return x })()
      const built = await buildAction(h.deps, h.ctx, { type: 'slideshow_stills', contentId: id })
      expect(built.specs.every(x => (x.request as GenRequest).model === 'higgsfield/gpt-image-2.5-flare' && (x.request as GenRequest).billing === 'api')).toBe(true)
    } finally {
      await setSetting(h.deps, h.ctx, 'provider_mode', 'demo')
    }
  })
})

describe('export', () => {
  it('both sizes, numbered, caption.txt with Ad: first, post.json with every field, the dragged place and the CTA', async () => {
    const id = await drafted({ ad: true, textStyle: 'note' })
    await run({ type: 'slideshow_stills', contentId: id })
    await updateContent(h.deps, h.ctx, id, { spec: { textPos: [{ x: 0.5, y: 0.7 }], cta: { kind: 'handle', handle: 'callie.jobs', word: '' } } })
    await startRender(h.deps, h.ctx, id)
    await drain(h, 30)
    const done = await getContent(h.deps, h.ctx, id)
    expect(done.status).toBe('ready')
    const o = done.outputs as ContentOutputs
    expect(o.imageAssetIds).toHaveLength(6)
    expect(o.instagramAssetIds).toHaveLength(6)
    expect(await sharp((await readAsset(h.deps, h.ctx, o.imageAssetIds![0]!)).data).metadata()).toMatchObject({ width: 1080, height: 1920, format: 'jpeg' })
    expect(await sharp((await readAsset(h.deps, h.ctx, o.instagramAssetIds![0]!)).data).metadata()).toMatchObject({ width: 1080, height: 1440, format: 'jpeg' })
    const zip = unzipSync(new Uint8Array((await readAsset(h.deps, h.ctx, o.zipAssetId!)).data))
    expect(Object.keys(zip).filter(k => k.startsWith('tiktok/'))).toHaveLength(6)
    expect(Object.keys(zip).filter(k => k.startsWith('instagram/'))).toHaveLength(6)
    const caption = Buffer.from(zip['caption.txt']!).toString()
    expect(caption.startsWith('Ad: ')).toBe(true)
    expect(caption).toContain('AI-generated content label')
    const json = JSON.parse(Buffer.from(zip['post.json']!).toString())
    expect(json).toMatchObject({ format: 'character-studio.post', post: { id, account: 'callie.jobs' }, slideshow: { text_style: 'note', cta: { kind: 'handle', handle: 'callie.jobs', text: 'Follow @callie.jobs for more' } }, caption: { ad: true } })
    expect(json.slides[0].text_position).toEqual({ x: 0.5, y: 0.7 })
    expect(json.slides).toHaveLength(6)
    expect(JSON.parse((await readAsset(h.deps, h.ctx, o.jsonAssetId!)).data.toString()).post.id).toBe(id)
  })

  it('a slide with no picture holds the export and says which', async () => {
    const id = await drafted()
    await expect(startRender(h.deps, h.ctx, id)).rejects.toThrow(/needs? a picture/)
  })

  it('a Product screenshot slide: the owner\'s upload as it is, in both sizes; with no upload the export waits for it', async () => {
    const id = await drafted()
    await run({ type: 'slideshow_stills', contentId: id })
    const s = await spec(id)
    const specials = [...s.specials]
    while (specials.length < 3) specials.push(null)
    specials[2] = { ...emptySpecial('product_shot'), ratio: 0.46 }
    await updateContent(h.deps, h.ctx, id, { spec: { specials } })
    await expect(startRender(h.deps, h.ctx, id)).rejects.toThrow(/Slide 3 needs the product screenshot/)
    // A plain green screenshot, 460 x 1000, as the owner would upload it.
    const png = await sharp({ create: { width: 460, height: 1000, channels: 3, background: { r: 20, g: 210, b: 60 } } }).png().toBuffer()
    const asset = await saveAsset(h.deps, h.ctx, { data: png, mime: 'image/png', origin: 'upload', label: 'screen' })
    specials[2] = { ...emptySpecial('product_shot'), ratio: 0.46, assetId: asset.id }
    await updateContent(h.deps, h.ctx, id, { spec: { specials } })
    await startRender(h.deps, h.ctx, id)
    await drain(h, 30)
    const o = (await getContent(h.deps, h.ctx, id)).outputs as ContentOutputs
    for (const [ids, frame] of [[o.imageAssetIds!, { width: 1080, height: 1920 }], [o.instagramAssetIds!, { width: 1080, height: 1440 }]] as const) {
      const box = productShotBox({ scale: 0.72, variant: '', ratio: 0.46 }, frame)
      const img = sharp((await readAsset(h.deps, h.ctx, ids[2]!)).data)
      const { data } = await img.extract({ left: Math.round(box.x + box.w / 2) - 5, top: Math.round(box.y + box.h / 2) - 5, width: 10, height: 10 }).raw().toBuffer({ resolveWithObject: true })
      const [r, g, b] = [data[0]!, data[1]!, data[2]!]
      expect(g).toBeGreaterThan(170)
      expect(r).toBeLessThan(70)
      expect(b).toBeLessThan(100)
    }
    const zip = unzipSync(new Uint8Array((await readAsset(h.deps, h.ctx, o.zipAssetId!)).data))
    const json = JSON.parse(Buffer.from(zip['post.json']!).toString())
    expect(json.slides[2]).toMatchObject({ picture: 'special', special: { type: 'product_shot', asset_id: asset.id } })
  })
})

describe('variations and batch', () => {
  it('Make variations: one price for the new words and a new image set each; a family with new captions, another account, never a shared picture', async () => {
    await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'careerwins.daily', idea: 'x' })
    const id = await drafted({}, 'callie.jobs')
    await run({ type: 'slideshow_stills', contentId: id })
    const photos = slideList(await spec(id)).filter(s => !s.special).length
    const { quote } = await run({ type: 'slideshow_variations', contentId: id, count: 2 })
    expect(quote.items).toHaveLength(1 + 2 * photos)
    const fam = await familyView(h.deps, h.ctx, id)
    expect(fam.items).toHaveLength(3)
    const kids = fam.items.filter(x => !x.isThis)
    const source = await spec(id)
    for (const k of kids) {
      const row = await getContent(h.deps, h.ctx, k.id)
      const s = row.spec as SlideshowSpec
      expect(row.variationOf).toBe(id)
      // Another account of the same kind: never a faceless feeder (F2, F6).
      expect(row.accountTag).toBe('careerwins.daily')
      expect(s.caption).not.toBe(source.caption)
      expect(s.hook).not.toBe(source.hook)
      expect(slideList(s).every(x => x.stillId || x.special)).toBe(true)
      expect(s.stillIds.filter(Boolean).some(x => source.stillIds.includes(x))).toBe(false)
    }
    // A variation of a variation stays in the same family.
    expect((await familyView(h.deps, h.ctx, kids[0]!.id)).root).toBe(id)
  })

  it('a listicle\'s variations reorder the middle slides', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'a', idea: 'apps' })
    await run({ type: 'slideshow_draft', contentId: post.id, hook: '5 apps that saved my job search', pattern: 'listicle' })
    await run({ type: 'slideshow_variations', contentId: post.id, count: 1 })
    const kid = (await familyView(h.deps, h.ctx, post.id)).items.find(x => !x.isThis)!
    const src = await spec(post.id), v = await spec(kid.id)
    expect(v.shots[0]).toBe(src.shots[0])
    expect(v.shots.at(-1)).toBe(src.shots.at(-1))
    expect(v.shots).not.toEqual(src.shots)
  })

  it('Batch from hooks: one price, a slideshow per hook (drafted, then its stills), special slides released and not charged, then Approve exports and Reject archives', async () => {
    const parent = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'callie.jobs', idea: 'jobs', spec: { batchHooks: ['Things nobody tells you about your first job', 'Red flags in a job posting I ignored', 'POV: the recruiter finally calls back'] } })
    const { quote } = await run({ type: 'slideshow_batch', contentId: parent.id })
    expect(quote.items).toHaveLength(3 * (1 + 6))
    const view = await batchView(h.deps, h.ctx, parent.id)
    expect(view.items.map(x => x.spec.hook)).toEqual(['Things nobody tells you about your first job', 'Red flags in a job posting I ignored', 'POV: the recruiter finally calls back'])
    for (const x of view.items) {
      expect(x.spec.review).toBe('pending')
      expect(slideList(x.spec).every(s => s.stillId || s.special)).toBe(true)
      for (const sid of x.spec.stillIds.filter(Boolean)) expect(view.assets[sid]).toMatch(/^ast_/)
    }
    const released = await h.deps.db.select().from(jobs).where(and(eq(jobs.accountId, h.ctx.accountId), eq(jobs.purpose, `slide_still:${parent.id}:b`), eq(jobs.status, 'canceled')))
    expect(released.length).toBe(view.items.reduce((n, x) => n + x.spec.specials.filter(Boolean).length, 0))
    expect(released.every(j => (j.error as { message: string }).message.startsWith('Not needed:') && j.actualMicros === 0)).toBe(true)
    const [a, , c] = view.items
    await reviewBatchItem(h.deps, h.ctx, parent.id, a!.id, 'approve', id => startRender(h.deps, h.ctx, id))
    await reviewBatchItem(h.deps, h.ctx, parent.id, c!.id, 'reject', async () => undefined)
    await drain(h, 30)
    expect((await getContent(h.deps, h.ctx, a!.id)).status).toBe('ready')
    const [rejected] = await h.deps.db.select().from(contentItems).where(eq(contentItems.id, c!.id))
    expect(rejected!.archivedAt).not.toBeNull()
  })
})

describe('never reuse across accounts, and the Scene library', () => {
  it('a shared picture or the exact caption in another account\'s slideshow is named on the export; the rule can be switched off', async () => {
    const id = await drafted({}, 'callie.jobs')
    await run({ type: 'slideshow_stills', contentId: id })
    const s = await spec(id)
    const other = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'other.account', spec: { stillIds: [s.stillIds[0]!], caption: s.caption } })
    const hits = (await reuseReport(h.deps, h.ctx, id)).hits
    expect(hits.map(x => [x.kind, x.slide, x.postId])).toEqual([['image', 0, other.id], ['caption', null, other.id]])
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'slideshow-no-reuse', on: false })
    try { expect((await reuseReport(h.deps, h.ctx, id)).hits).toEqual([]) } finally { await setRuleSwitch(h.deps, h.ctx, { ruleId: 'slideshow-no-reuse', on: null }) }
  })

  it('save a scene for a character or a topic, list it, delete it', async () => {
    const a = await saveSlideScene(h.deps, h.ctx, { name: 'Home office', characterId, place: 'a small home office by a window', light: 'window', camera: 'friend_phone', details: ['a mug', 'a sticky note', 'a third'] })
    const b = await saveSlideScene(h.deps, h.ctx, { name: 'Lobby', characterId: null, topic: 'office life', place: 'a glass office lobby' })
    expect(a.details).toEqual(['a mug', 'a sticky note'])
    expect((await listSlideScenes(h.deps, h.ctx)).map(x => x.name)).toEqual(['Lobby', 'Home office'])
    await archiveSlideScene(h.deps, h.ctx, b.id)
    expect((await listSlideScenes(h.deps, h.ctx)).map(x => x.id)).toEqual([a.id])
    await expect(saveSlideScene(h.deps, h.ctx, { name: 'x', place: ' ' })).rejects.toThrow(/place/)
  })
})
