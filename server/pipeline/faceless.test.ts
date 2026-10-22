import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { createContent, getContent } from './content.js'
import { createFacelessCharacter, facelessOf, kindOf, saveFaceless } from './faceless.js'
import { getCharacter } from './characters.js'
import { characterSummary } from '../api/views.js'
import { DOUG, FACELESS_ENDING } from '../core/faceless.js'
import { PERSON_WORDS } from '../core/realism.js'
import { saveAsset } from '../storage/assets.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'

// Faceless characters (owner, 2026-10-22; UX-PLAN.md section 35, item 4) in
// demo mode: Doug from his file, a still from his place bank (Soul 2.0,
// 9:16, the faceless rules, priced first), the video from that still, no
// face check anywhere; a product post on an edit model with the photo.

let h: Harness
let doug: string
beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  doug = (await createFacelessCharacter(h.deps, h.ctx, { name: '', template: 'doug' })).id
}, 60_000)

const post = async (faceless: Record<string, unknown>) => (await createContent(h.deps, h.ctx, { kind: 'meme', characterId: doug, title: 'Doug', accountTag: 'doug.tiktok', spec: { caption: 'they replaced me with a spreadsheet macro', faceless } })).id

describe('faceless', () => {
  it('Doug is a faceless character with his file; his card says Faceless; nothing asks for a face', async () => {
    const row = await getCharacter(h.deps, h.ctx, doug)
    expect(row.name).toBe('Doug')
    expect(kindOf(row)).toBe('faceless')
    expect(facelessOf(row)).toEqual(DOUG.file)
    expect((await characterSummary(h.deps, h.ctx, row)).kind).toBe('faceless')
    const edited = await saveFaceless(h.deps, h.ctx, doug, { ...DOUG.file, places: [...DOUG.file.places, { id: 'diner', name: 'Diner booth', line: 'an empty diner booth in the rain' }] })
    expect(edited.places.at(-1)!.id).toBe('diner')
  })

  it('a still from the place bank: priced first, Soul 2.0 at 9:16 with the faceless rules; it lands on the post with no face check', async () => {
    const id = await post({ placeId: 'car-rain' })
    const action = { type: 'faceless_still' as const, contentId: id }
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.id).toBeTruthy()
    const p = preview.prompts[0]!.text
    expect(p).toMatch(/^the inside of a parked used sedan/)
    expect(p).toMatch(/REALISM:/)
    // No person in frame: no skin, face or body words, and the faceless
    // ending comes last (owner, 2026-10-22).
    expect(p.trim().endsWith(FACELESS_ENDING)).toBe(true)
    expect(p).not.toMatch(PERSON_WORDS)
    expect(preview.title).toMatch(/Soul 2\.0|Soul/)
    const ran = await runAction(h.deps, h.ctx, action, quote.id, true)
    expect(ran.jobs).toHaveLength(1)
    await drain(h, 30)
    const spec = (await getContent(h.deps, h.ctx, id)).spec as { stillId: string | null }
    expect(spec.stillId).toMatch(/^cand_/)

    // The video from that still: the prompt prefilled from the row, priced.
    await h.deps.db.update((await import('../db/schema.js')).contentItems).set({ spec: { ...(spec as object), faceless: { placeId: 'car-rain', videoPrompt: 'rain runs down the windshield, the wipers stay off' } } }).where((await import('drizzle-orm')).eq((await import('../db/schema.js')).contentItems.id, id))
    const video = { type: 'faceless_video' as const, contentId: id }
    const v = await estimateAction(h.deps, h.ctx, video)
    expect(v.preview.prompts[0]!.text).toMatch(/^rain runs down the windshield.*No people\./)
    await runAction(h.deps, h.ctx, video, v.quote.id, true)
    await drain(h, 30)
    expect(((await getContent(h.deps, h.ctx, id)).spec as { clipId: string | null }).clipId).toMatch(/^cand_/)
  })

  it('a product post switches to an edit model with the product photo', async () => {
    const photo = await saveAsset(h.deps, h.ctx, { data: await renderPlaceholderPortrait('product'), mime: 'image/png', origin: 'upload', label: 'product' })
    const id = await post({ line: 'a car cup holder, rain on the window', product: { assetId: photo.id, name: 'energy drink can' } })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'faceless_still', contentId: id })
    expect(preview.title).toMatch(/Nano Banana/)
    expect(preview.prompts[0]!.text).toMatch(/label and packaging unchanged/)
  })

  it('a written line with hands or a sign gets warnings; nothing is blocked', async () => {
    const id = await post({ line: 'his hands on the steering wheel, a stop sign ahead, slightly tilted' })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'faceless_still', contentId: id })
    expect(preview.warnings.map(w => w.ruleId)).toEqual(expect.arrayContaining(['faceless-person', 'faceless-text', 'faceless-tilt']))
    expect(preview.prompts[0]!.text).not.toMatch(/tilted/)
  })
})
