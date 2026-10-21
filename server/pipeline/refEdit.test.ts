import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { clearRefImage, importCharacter, setRefImage } from './files.js'
import { createCharacter, listCharacters } from './characters.js'
import { characterView } from '../api/views.js'
import { listTrash, restore, trash } from './trash.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'

// Characters, Tier 1 item 3 (owner, 2026-10-22; UX-PLAN.md section 35): a
// finished character imported in one go lands complete; any REF can be
// added, replaced or removed by hand without a rebuild; any uploaded image
// can be the hero; Delete character goes to the Trash and comes back.

let h: Harness
let callie: string
beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
}, 120_000)

describe('characters (item 3)', () => {
  it('a finished character imported with its file and REF-00 to REF-11 lands complete: no hero run, no likeness check', async () => {
    const v = await characterView(h.deps, h.ctx, callie)
    expect(v.sheet.progress).toMatchObject({ approved: 12, total: 12, complete: true })
    expect(v.stage).toBeGreaterThanOrEqual(5)
  })

  it('replace a ref without a rebuild: the shots built on it stay approved, not stale; remove one; REF-00 is replaced, never removed', async () => {
    const before = await characterView(h.deps, h.ctx, callie)
    const old = before.sheet.shots.find(s => s.id === 'REF-01')!.approved!.assetId
    await setRefImage(h.deps, h.ctx, callie, 'REF-01', { data: await renderPlaceholderPortrait('a new REF-01'), mime: 'image/png' })
    const after = await characterView(h.deps, h.ctx, callie)
    expect(after.sheet.shots.find(s => s.id === 'REF-01')!.approved!.assetId).not.toBe(old)
    // REF-03 and REF-10 are built on REF-01: nothing goes stale.
    expect(after.sheet.progress).toMatchObject({ approved: 12, stale: 0, complete: true })
    await clearRefImage(h.deps, h.ctx, callie, 'REF-11')
    expect((await characterView(h.deps, h.ctx, callie)).sheet.progress.approved).toBe(11)
    await expect(clearRefImage(h.deps, h.ctx, callie, 'REF-00')).rejects.toThrow(/replace it instead/)
    await setRefImage(h.deps, h.ctx, callie, 'REF-11', { data: await renderPlaceholderPortrait('REF-11 back'), mime: 'image/png' })
    expect((await characterView(h.deps, h.ctx, callie)).sheet.progress.approved).toBe(12)
  })

  it('any uploaded image can be the hero: it becomes REF-00 and the sheet is next', async () => {
    const { id } = { id: (await createCharacter(h.deps, h.ctx, { name: 'Upload Hero' })).id }
    await setRefImage(h.deps, h.ctx, id, 'REF-00', { data: await renderPlaceholderPortrait('my own hero'), mime: 'image/png' })
    const v = await characterView(h.deps, h.ctx, id)
    expect(v.sheet.shots.find(s => s.id === 'REF-00')!.status).toBe('approved')
    expect(v.stage).toBe(4)
  })

  it('Delete character goes to the Trash, half-built ones too, and Restore brings it back', async () => {
    const half = (await createCharacter(h.deps, h.ctx, { name: 'Half Built' })).id
    await trash(h.deps, h.ctx, [{ kind: 'character', id: half }])
    expect((await listCharacters(h.deps, h.ctx)).some(c => c.id === half)).toBe(false)
    const t = (await listTrash(h.deps, h.ctx)).find(x => x.kind === 'character' && x.refId === half)!
    expect(t.label).toBe('Character: Half Built')
    await restore(h.deps, h.ctx, [t.id])
    expect((await listCharacters(h.deps, h.ctx)).some(c => c.id === half)).toBe(true)
  })
})

describe('build refs (item 3e, 2026-10-22)', () => {
  it('Build refs adds REF-12 and REF-13 to the sheet steps; their prompts are waist-up with the build; off, the sheet is complete at 12', async () => {
    const { buildSheetPrompt } = await import('../core/prompts.js')
    const { setBuildRefs, getCharacter, toData } = await import('./characters.js')
    expect((await characterView(h.deps, h.ctx, callie)).sheet.progress).toMatchObject({ total: 12, complete: true })
    await setBuildRefs(h.deps, h.ctx, callie, true)
    const v = await characterView(h.deps, h.ctx, callie)
    expect(v.buildRefs).toBe(true)
    expect(v.sheet.progress).toMatchObject({ approved: 12, total: 14, complete: false })
    expect(v.sheet.next).toMatchObject({ refId: 'REF-12', action: 'generate' })
    const shot = h.deps.config.pipeline.sheet.shots.find(s => s.id === 'REF-13')!
    const p = buildSheetPrompt(h.deps.config.pipeline.templates, h.deps.config.pipeline.views, shot, toData(await getCharacter(h.deps, h.ctx, callie)))
    expect(p).toMatch(/Waist-up framing/)
    expect(p).toMatch(/Build: /)
    expect(p).toMatch(/Bare face, no makeup/)
    // An imported REF-12 lands like any shot; off again, it stays (one exists).
    await setRefImage(h.deps, h.ctx, callie, 'REF-12', { data: await renderPlaceholderPortrait('REF-12'), mime: 'image/png' })
    await setBuildRefs(h.deps, h.ctx, callie, false)
    expect((await characterView(h.deps, h.ctx, callie)).sheet.progress).toMatchObject({ approved: 13, total: 13 })
  })

  it('a waist-up scene sends the closest build ref; the character file names each Element and the REFs that built it', async () => {
    const { pickSceneRefs } = await import('../core/scenes.js')
    const { refsIn } = await import('../core/characterFile.js')
    const cfg = h.deps.config.pipeline
    const approved = new Set(['REF-00', 'REF-01', 'REF-06', 'REF-12', 'REF-13'])
    const picks = pickSceneRefs(cfg.sheet.shots, cfg.views, approved, { view: 'three_quarter_left', framing: 'waist_up', expression: 'neutral' }, cfg.scenes)
    expect(picks).toContainEqual({ refId: 'REF-13', role: 'body' })
    expect(refsIn('Higgsfield Element "Callie build": 4b2a1c3d-0000-4000-8000-000000000001, built from REF-00, REF 12 and ref_13')).toEqual(['REF-00', 'REF-12', 'REF-13'])
  })
})
