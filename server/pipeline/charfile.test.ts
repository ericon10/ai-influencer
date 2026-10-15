import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createHarness, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction } from './actions.js'
import { exportCharacter, importCharacter } from './files.js'
import { getCharacter, sheetState, toData, updateCharacter } from './characters.js'
import { characterBrand, importCheck, updateBrand } from './brand.js'
import { createContent } from './content.js'
import { createScene } from './scenes.js'
import { setRuleSwitch } from './rules.js'
import { characterView } from '../api/views.js'
import { candidates, contentItems } from '../db/schema.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { parseComboLog } from '../core/scenes.js'

// Character files from the Claude project (character template v1.6; owner,
// 2026-10-15, long run part 3): the check before an import, a re-import that
// keeps posts, takes, refs and the combo log, the brand layer on the
// character, and the writers carrying the winning stack and the brand check.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const CALLIE = read('fixtures/callie/character-callie.md')
const WREN = read('fixtures/template/character-wren.md')
let h: Harness
let callie: string
const images: Record<string, { data: Buffer }> = {}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, CALLIE, { images })).characterId
}, 120_000)

const count = async (table: typeof contentItems | typeof candidates, characterId: string) =>
  (await h.deps.db.select({ id: table.id }).from(table).where(and(eq(table.accountId, h.ctx.accountId), eq(table.characterId, characterId)))).length

describe('the check before an import', () => {
  it('names the character of the same name, so the import updates it', async () => {
    const r = await importCheck(h.deps, h.ctx, CALLIE)
    expect(r.name).toBe('Callie')
    expect(r.match).toEqual({ id: callie, name: 'Callie' })
    expect(r.report.complete).toBe(true)
    expect((await importCheck(h.deps, h.ctx, WREN)).match).toBeNull()
  })
})

describe('a re-import keeps posts, takes, refs and the combo log', () => {
  it('the file\'s words replace the old ones; nothing else is lost', async () => {
    await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, idea: 'Callie at the market' })
    await createScene(h.deps, h.ctx, callie, { brief: 'Callie at the market' })
    // The Studio logged a scene since the file was written.
    const ch = toData(await getCharacter(h.deps, h.ctx, callie))
    await updateCharacter(h.deps, h.ctx, callie, { sections: ch.sections.map(s => (/^combo log/i.test(s.title) ? { ...s, body: `${s.body}\n- 2026-10-15 Caught you / Friend shot / Morning light / Market / half-up claw clip` } : s)) }, 'combo log')
    const posts = await count(contentItems, callie), takes = await count(candidates, callie)
    const before = await sheetState(h.deps, h.ctx, callie)
    // The new file from the Claude project: new words, no saved identity, the same 12 images.
    const next = CALLIE.replace('full light-brown brows, full lips', 'full light-brown brows, full soft lips').replace(/- Saved identity: Higgsfield Elements[^\n]*\n/, '')
    const r = await importCharacter(h.deps, h.ctx, next, { images, characterId: callie })
    expect(r.characterId).toBe(callie)
    expect(r.importedShots).toEqual([])
    expect(r.unchangedShots).toHaveLength(12)
    const after = toData(await getCharacter(h.deps, h.ctx, callie))
    expect(after.card).toContain('full soft lips')
    expect(await count(contentItems, callie)).toBe(posts)
    expect(await count(candidates, callie)).toBe(takes)
    const state = await sheetState(h.deps, h.ctx, callie)
    expect(state.progress).toEqual(before.progress)
    expect(state.progress.stale).toBe(0)
    // The Studio's combo entry is still there, and the file's own.
    const combos = parseComboLog(after.sections.find(s => /^combo log/i.test(s.title))!.body)
    expect(combos.at(-1)).toMatchObject({ date: '2026-10-15', location: 'Market', hair: 'half-up claw clip' })
    expect(combos.some(c => c.location === 'Rooftop')).toBe(true)
    // The saved identity stays when the file has none.
    expect(after.identities.map(i => i.externalId)).toContain('705d2b7d-596d-468e-bd2c-b171799cd7a6')
  })
})

describe('the brand layer and the writers (template v1.6)', () => {
  let wren: string
  it('a v1.6 file: the brand layer on the character, the check complete', async () => {
    wren = (await importCharacter(h.deps, h.ctx, WREN)).characterId
    const v = await characterView(h.deps, h.ctx, wren)
    expect(v.brand.statement).toBe('Wren, the slow trail runner who shows the real side of getting outside on a budget')
    expect(v.brand.winningStack).toHaveLength(3)
    expect(v.template.needed.filter(n => !n.ok).map(n => n.id)).toEqual([])
    expect(toData(await getCharacter(h.deps, h.ctx, wren)).makeup).toMatchObject({ default: 'natural', glam: 'soft glam', glam_when: ['nights_out'] })
  })
  it('an edit is written into the file and comes back on export', async () => {
    const b = await updateBrand(h.deps, h.ctx, wren, { statement: 'Wren, the slow trail runner on a budget', growthLog: [...(await characterBrand(h.deps, h.ctx, wren)).growthLog, '2026-10: top 5 shared the fall colors'] })
    expect(b.statement).toBe('Wren, the slow trail runner on a budget')
    const md = (await exportCharacter(h.deps, h.ctx, wren)).markdown
    expect(md).toContain('- Brand statement: Wren, the slow trail runner on a budget')
    expect(md).toContain('- 2026-10: top 5 shared the fall colors')
    expect(md).toContain('- Sub-interest (optional): the slowest runner in every race')
  })
  it('Punch it up checks its moments against the brand statement; the writers carry the winning stack', async () => {
    const ideas = await estimateAction(h.deps, h.ctx, { type: 'scene_ideas', characterId: wren, idea: 'Wren at a trail race' })
    const ideasText = ideas.preview.prompts[0]!.text
    expect(ideasText).toContain('Brand statement: Wren, the slow trail runner on a budget. Check each option against it')
    expect(ideasText).toContain('Winning stack from the last growth review')
    const scene = await createScene(h.deps, h.ctx, wren, { brief: 'Wren tying her trail shoes at the trailhead' })
    const still = await estimateAction(h.deps, h.ctx, { type: 'scene_prompt', characterId: wren, sceneId: scene.id, target: 'still' })
    expect(still.preview.prompts[0]!.text).toContain('every post carries these for the next 30 days, where they fit this shot and inside the fixed rules: The mishap in the first second; Out-of-breath voiceover; Golden-hour trail.')
    const plan = await estimateAction(h.deps, h.ctx, { type: 'scene_plan', characterId: wren, sceneId: scene.id })
    expect(plan.preview.prompts[0]!.text).toContain('Winning stack from the last growth review')
    // Defaults: switched off, neither line is sent.
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'brand-check', characterId: wren, on: false })
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'brand-winning-stack', characterId: wren, on: false })
    const off = (await estimateAction(h.deps, h.ctx, { type: 'scene_ideas', characterId: wren, idea: 'Wren at a trail race' })).preview.prompts[0]!.text
    expect(off).not.toContain('Brand statement:')
    expect(off).not.toContain('Winning stack')
  })
})
