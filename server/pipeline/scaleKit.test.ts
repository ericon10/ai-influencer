import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { getCharacter, toData } from './characters.js'
import { estimateAction, runAction } from './actions.js'
import { createContent, updateContent } from './content.js'
import { addHook, importStarterKit, listProducts, productView, saveSocialAccount, scoreboard, updateProduct, useKitVoice } from './scaleKit.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'

// The scale kit (overnight item 5). Mock adapters only: the variant writer
// is priced first and answered by the mock.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness, callie: string, maya: string

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  const md = readFileSync(join(FIX, 'character-callie.md'), 'utf8').replace(/Callie/g, 'Maya')
  maya = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
}, 240_000)

let productId: string

describe('products: hook vault, claims sheet, buyer language', () => {
  it('the owner\'s account starts with the SideStep kit; a customer\'s starts empty and cannot load it', async () => {
    const [p] = await listProducts(h.deps, h.ctx)
    expect(p!.name).toBe('SideStep')
    expect(p!.writing).toBe('sidestep')
    expect((await productView(h.deps, h.ctx, p!.id)).hooks).toHaveLength(50)
    // Callie's live card from the kit fills her empty voice card.
    const v = toData(await getCharacter(h.deps, h.ctx, callie)).persona.voice!
    expect(v.uses).toContain('be so for real')
    expect(v.never).toContain('synergy')
    productId = p!.id
    const customer = await h.newAccount('Customer')
    expect(await listProducts(h.deps, customer)).toEqual([])
    await expect(importStarterKit(h.deps, customer)).rejects.toThrow(/owner/)
    expect(await listProducts(h.deps, customer)).toEqual([])
  })

  it('reads the vault, the claims and the buyer language', async () => {
    const p = await productView(h.deps, h.ctx, productId)
    expect(p.hooks[0]).toMatchObject({ number: 1, kind: 'Relatable pain' })
    expect(p.hooks.at(-1)).toMatchObject({ number: 50, kind: 'Soft product' })
    expect(p.claims.groups.map(g => g.label)).toEqual(['What it is', 'What it does', 'Price', 'How to say it (approved phrasings)', 'Never say'])
    expect(p.claims.watch).toEqual(expect.arrayContaining(['interviews', 'callbacks', 'beats', 'tricks', 'hired']))
    expect(p.language.groups.map(g => [g.label, g.items.length])).toEqual([['Pain', 18], ['Feelings', 7], ['Small wins', 4]])
    expect(p.voices.map(v => [v.name, v.status])).toEqual([['Callie', 'live'], ['The ex-recruiter', 'proposed'], ['The career switcher', 'proposed']])
    expect(p.notes).toMatch(/80\/20 mix/)
  })

  it('edits stay inline: a new hook is numbered next, claims and language save', async () => {
    const hook = await addHook(h.deps, h.ctx, productId, { text: 'Nobody reads the cover letter. Except this one time.', kind: 'Myth bust' })
    expect(hook.number).toBe(51)
    await updateProduct(h.deps, h.ctx, productId, { claims: { watch: ['interviews', 'guaranteed'] }, language: { groups: [{ label: 'Pain', items: ['ghost jobs'] }] } })
    const p = await productView(h.deps, h.ctx, productId)
    expect(p.claims.watch).toEqual(['interviews', 'guaranteed'])
    expect(p.claims.groups).toHaveLength(5)
    expect(p.language.groups).toEqual([{ label: 'Pain', items: ['ghost jobs'] }])
  })

  it('a kit\'s proposed voice card can be used for a character, keeping its ElevenLabs voice', async () => {
    await useKitVoice(h.deps, h.ctx, productId, 'The ex-recruiter', maya)
    const v = toData(await getCharacter(h.deps, h.ctx, maya)).persona.voice!
    expect(v.pov).toMatch(/insider/i)
    expect(v.emoji).toMatch(/👀/)
  })
})

describe('hook variants in each character\'s voice', () => {
  it('quotes first, then writes one variant per character inside the claims sheet', async () => {
    const p = await productView(h.deps, h.ctx, productId)
    const hook = p.hooks.find(x => x.number === 47)!
    const action = { type: 'hook_variants' as const, hookId: hook.id, characterIds: [callie, maya] }
    const { quote, preview } = await estimateAction(h.deps, h.ctx, action)
    expect(quote.status).toBe('open')
    expect(quote.totalMicros).toBeGreaterThan(0)
    expect(preview.title).toBe('Write 2 variants of hook 47')
    const text = preview.prompts[0]!.text
    // The writer gets each voice card, the claims sheet and buyer language.
    expect(text).toMatch(/Callie's voice card/)
    expect(text).toMatch(/Maya's voice card/)
    expect(text).toMatch(/SideStep claims sheet/)
    expect(text).toMatch(/Never say/)
    expect(text).toMatch(/How real buyers talk/)
    expect(text.includes(String.fromCharCode(8212))).toBe(false)
    await runAction(h.deps, h.ctx, action, quote.id, true)
    await drain(h, 10)
    const after = (await productView(h.deps, h.ctx, productId)).hooks.find(x => x.number === 47)!
    expect(after.variants.map(v => v.characterId).sort()).toEqual([callie, maya].sort())
    expect(after.variants.every(v => v.text.includes('match score'))).toBe(true)
  })

  it('a variant that promises results next to the product gets a warning, never a block', async () => {
    const { claimFlags } = await import('../core/scriptKit.js')
    const p = await productView(h.deps, h.ctx, productId)
    expect(claimFlags('SideStep got me 3 interviews in a week', p.claims)).toHaveLength(1)
    expect(claimFlags('finally got a callback after 3 months', p.claims)).toEqual([])
  })
})

describe('the voice card in the writers', () => {
  it('the batch caption writer writes in the character\'s voice', async () => {
    const batch = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId: callie })).id
    await updateContent(h.deps, h.ctx, batch, { spec: { topic: 'ghost jobs', count: 3 } })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'content_captions', characterId: callie, contentId: batch })
    expect(preview.prompts[0]!.text).toMatch(/Callie's voice card/)
    expect(preview.prompts[0]!.text).toMatch(/be so for real/)
  })
})

describe('accounts: tracked links, promo codes, signups', () => {
  it('ranks accounts by signups, never by views; tags from posts show up on their own', async () => {
    await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, accountTag: 'callie.jobs' })
    await createContent(h.deps, h.ctx, { kind: 'meme', characterId: maya, accountTag: 'maya.recruits' })
    await saveSocialAccount(h.deps, h.ctx, '@callie.jobs', { link: 'https://sidestep.example/r/callie', code: 'CALLIE10', signups: 4, views: 900_000 })
    await saveSocialAccount(h.deps, h.ctx, 'maya.recruits', { signups: 11, views: 1200 })
    const s = await scoreboard(h.deps, h.ctx)
    expect(s.accounts.map(a => [a.rank, a.tag, a.signups])).toEqual([[1, 'maya.recruits', 11], [2, 'callie.jobs', 4]])
    expect(s.accounts[1]).toMatchObject({ link: 'https://sidestep.example/r/callie', code: 'CALLIE10', characterId: callie, posts: 1 })
    expect(s.totalSignups).toBe(15)
    await expect(saveSocialAccount(h.deps, h.ctx, 'x', { link: 'sidestep.example' })).rejects.toThrow(/https/)
  })
})
