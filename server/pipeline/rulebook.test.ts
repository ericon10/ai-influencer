import { beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { blocking, lintPrompt, type RuleContext } from '../core/rules.js'
import { createHarness, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { createCharacter } from './characters.js'
import { estimateAction } from './actions.js'
import { makeSwitches, ruleSwitches, rulesView, setRuleSwitch } from './rules.js'
import { validateCharacter } from '../core/character.js'

// Owner ruling G1, "defaults, not locks": only the fixed rules may block a
// run. Every default is on unless switched off, and at most a warning, even
// if someone edits rules.yaml to say "error".

const cfg = loadConfig()
const rules = cfg.pipeline.rules
const EM = String.fromCharCode(0x2014)

const FIXED = ['adult-21', 'no-explicit', 'distinct-person', 'recreate-gates', 'ai-label', 'realism-block', 'realism-banned-words', 'realism-beautify-off', 'realism-texture', 'natural-baseline', 'price-first', 'budget-caps', 'keys-server-side']

// Prompts and requests that trip every default the prompt lint checks.
const REALISM = '\nREALISM: Candid phone photo, natural skin texture with visible pores, no retouching.\nAVOID: plastic skin.'
const cases: Array<[string, RuleContext]> = [
  ['Chest-up portrait, white tee and jeans, a C cup, measurements 34-24-36' + REALISM + ' Bare face, no makeup, no retouching.', {
    stage: 'hero', framing: 'chest_up', kind: 'image', request: { kind: 'image', refs: [{ assetId: 'a' }] },
  }],
  ['Sheet shot of her face, white tee and jeans' + REALISM + ' Bare face, no makeup, no retouching.', {
    stage: 'sheet', framing: 'chest_up', kind: 'image_edit', marks: [{ name: 'mole', description: 'small mole', side: 'LEFT', region: 'brow', kind: 'skin' }],
    request: { kind: 'image_edit', model: 'higgsfield/nano-banana-2', quality: 'low', resolution: '1k', aspect: '1:1' },
    sheetLock: { model: 'higgsfield/gpt-image-2.5' }, aspectByFraming: { chest_up: '3:4', full_body: '9:16' }, identityBlock: 'SOUL IDENTITY block',
  }],
  [`She sits at a cafe in the same outfit as before, shot from a low angle ${EM} tight crop on her legs` + REALISM, {
    stage: 'scene', framing: 'waist_up', kind: 'image_edit', request: { kind: 'image_edit', refs: [{ assetId: 'r' }], aspect: '16:9' },
  }],
  ['Upscale 4x', { kind: 'upscale', request: { kind: 'upscale', scale: 4 as never } }],
  ['Her mouth moving as she talks, singing loudly', { kind: 'video', request: { kind: 'video', audio: true } }],
]

const lintable = rules.rules.filter(r => r.bucket === 'default' && r.check.type !== 'behavior' && r.check.type !== 'code').map(r => r.id)

describe('the rule book', () => {
  it('has exactly the owner\'s fixed rules; everything else is a default', () => {
    expect(rules.rules.filter(r => r.bucket === 'fixed').map(r => r.id).sort()).toEqual([...FIXED].sort())
    expect(new Set(rules.rules.map(r => r.id)).size).toBe(rules.rules.length)
  })

  it('no default rule can block a run, even if rules.yaml says "error"', () => {
    const edited = { ...rules, rules: rules.rules.map(r => ({ ...r, severity: 'error' as const })) }
    const hit = new Set<string>()
    for (const [prompt, ctx] of cases) {
      const v = lintPrompt(edited, prompt, ctx)
      for (const x of v) if (rules.rules.find(r => r.id === x.ruleId)?.bucket === 'default') hit.add(x.ruleId)
      // Only fixed rules can be in the blocking list.
      for (const b of blocking(v)) expect(FIXED, `${b.ruleId} blocked a run`).toContain(b.ruleId)
    }
    // The cases above trip every default the lint checks, so this is exhaustive.
    expect([...hit].sort()).toEqual([...lintable].sort())
  })

  it('a default switched off is not checked; a fixed rule cannot be switched off', () => {
    const allOff = makeSwitches(rules, { global: Object.fromEntries(rules.rules.map(r => [r.id, { on: false }])) })
    for (const [prompt, ctx] of cases) expect(lintPrompt(rules, prompt, { ...ctx, switches: allOff }).filter(v => lintable.includes(v.ruleId))).toEqual([])
    for (const id of FIXED) expect(allOff.on(id)).toBe(true)
    expect(blocking(lintPrompt(rules, 'A nude portrait' + REALISM, { kind: 'image', switches: allOff })).map(v => v.ruleId)).toContain('no-explicit')
    expect(blocking(lintPrompt(rules, 'A portrait with flawless skin', { kind: 'image', switches: allOff })).map(v => v.ruleId)).toEqual(expect.arrayContaining(['realism-block', 'realism-banned-words']))
  })

  it('21 or older is fixed', () => {
    expect(validateCharacter({ age: 20, card: 'x', marks: [], body: '' }).filter(i => i.severity === 'error').map(i => i.field)).toEqual(['age'])
  })
})

describe('rule switches: global and per character', () => {
  let h: Harness
  let a: string
  let b: string
  beforeAll(async () => {
    registerPipelineHooks()
    h = await createHarness()
    a = (await createCharacter(h.deps, h.ctx, { name: 'Ava', data: { age: 26, card: '26, short dark hair' } })).id
    b = (await createCharacter(h.deps, h.ctx, { name: 'Bea', data: { age: 30, card: '30, long red hair' } })).id
  }, 120_000)

  it('a character setting wins over global; clearing it follows global again', async () => {
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-brand-free', on: false })
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-brand-free', characterId: a, on: true })
    expect((await ruleSwitches(h.deps, h.ctx, a)).on('scene-brand-free')).toBe(true)
    expect((await ruleSwitches(h.deps, h.ctx, b)).on('scene-brand-free')).toBe(false)
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-brand-free', characterId: a, on: null })
    expect((await ruleSwitches(h.deps, h.ctx, a)).on('scene-brand-free')).toBe(false)
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'scene-brand-free', on: null })
  })

  it('refuses to switch off a fixed rule', async () => {
    await expect(setRuleSwitch(h.deps, h.ctx, { ruleId: 'no-explicit', on: false })).rejects.toThrow(/fixed rule/)
    await expect(setRuleSwitch(h.deps, h.ctx, { ruleId: 'realism-block', characterId: a, on: false })).rejects.toThrow(/fixed rule/)
  })

  it('the sheet background is an editable value, per character', async () => {
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'sheet-background', characterId: a, value: 'Plain warm white background, soft window light' })
    const { preview } = await estimateAction(h.deps, h.ctx, { type: 'hero', characterId: a, runsPerPrompt: 4 })
    expect(preview.prompts[0]!.text).toContain('Plain warm white background, soft window light.')
    expect(preview.prompts[0]!.text).toContain('Bare face, no makeup, no retouching.')
    await setRuleSwitch(h.deps, h.ctx, { ruleId: 'sheet-background', characterId: b, on: false })
    const other = await estimateAction(h.deps, h.ctx, { type: 'hero', characterId: b, runsPerPrompt: 4 })
    // No background line of its own (the block's own background words may stay).
    expect(other.preview.prompts[0]!.text).not.toMatch(/Plain (?:light gray|warm white) background/i)
    const view = await rulesView(h.deps, h.ctx, a)
    expect(view.rules.find(r => r.id === 'sheet-background')!.character).toMatchObject({ on: true, value: 'Plain warm white background, soft window light', valueSet: true })
    expect(view.rules.find(r => r.id === 'no-explicit')!.bucket).toBe('fixed')
  })
})
