import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness'
import { registerPipelineHooks } from './hooks'
import { estimateAction, runAction, type StudioAction } from './actions'
import { importCharacter } from './files'
import { candidatesFor, getRef } from './characters'
import type { QaReport } from '../core/qa/marks'
import type { GenRequest } from '../providers/types'

// Rule zero in the pipeline: an upscale or edit that smooths the face is
// caught by the texture check, and a smoothed upscale never replaces the
// hero. Demo mode (mock providers) only; nothing is spent.

let h: Harness
let characterId: string
const blur = { upscale: false, edit: false }

async function run(action: StudioAction) {
  const { quote } = await estimateAction(h.deps, h.ctx, action)
  await runAction(h.deps, h.ctx, action, quote.id, true)
  await drain(h, 60)
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness({
    mockTransform: async (req: GenRequest, data: Buffer) => {
      if ((req.kind === 'upscale' && blur.upscale) || (req.kind === 'image_edit' && blur.edit)) return sharp(data).blur(5).png().toBuffer()
      return data
    },
  })
  const md = readFileSync(join(process.cwd(), 'fixtures/callie/character-callie.md'), 'utf8')
  const face = readFileSync(join(process.cwd(), 'fixtures/faces/person-a-1.jpg'))
  const { characterId: id } = await importCharacter(h.deps, h.ctx, md, { images: { 'REF-00': { data: face, mime: 'image/jpeg' } } })
  characterId = id
}, 120_000)

afterAll(async () => { await h?.close() })

describe('texture check in the pipeline', () => {
  it('a smoothed upscale is flagged and never replaces REF-00', async () => {
    const before = (await getRef(h.deps, h.ctx, characterId, 'REF-00')).approvedCandidateId
    blur.upscale = true
    try { await run({ type: 'upscale', characterId }) } finally { blur.upscale = false }
    const ref = await getRef(h.deps, h.ctx, characterId, 'REF-00')
    expect(ref.approvedCandidateId).toBe(before)
    const flagged = (await candidatesFor(h.deps, h.ctx, characterId)).find(c => c.refId === 'REF-00' && c.status === 'qa_failed')!
    const report = flagged.qaReport as QaReport
    expect(report.verdict).toBe('regenerate')
    expect(report.reasons).toContain('skin_smoothed')
    expect(report.texture?.smoothed).toBe(true)
    expect(report.findings[0]!.message).toMatch(/Skin smoothed.*Run the upscale again/)
  })

  it('a clean upscale replaces REF-00 and records the texture it kept', async () => {
    await run({ type: 'upscale', characterId })
    const ref = await getRef(h.deps, h.ctx, characterId, 'REF-00')
    const approved = (await candidatesFor(h.deps, h.ctx, characterId)).find(c => c.id === ref.approvedCandidateId)!
    expect((approved.qaReport as QaReport).texture?.smoothed).toBe(false)
  })

  it('a sheet shot whose skin came back smoothed fails QA, even with the face matching', async () => {
    blur.edit = true
    try { await run({ type: 'sheet', characterId, refId: 'REF-01', variations: 1, withQa: true, refsMode: 'ref00_only' }) } finally { blur.edit = false }
    const c = (await candidatesFor(h.deps, h.ctx, characterId)).find(x => x.refId === 'REF-01')!
    const report = c.qaReport as QaReport
    expect(c.status).toBe('qa_failed')
    expect(report.findings.map(f => f.code)).toContain('skin_smoothed')
    expect(report.texture?.smoothed).toBe(true)
  })

  it('an unsmoothed sheet shot keeps its texture', async () => {
    await run({ type: 'sheet', characterId, refId: 'REF-02', variations: 1, withQa: true, refsMode: 'ref00_only' })
    const c = (await candidatesFor(h.deps, h.ctx, characterId)).find(x => x.refId === 'REF-02')!
    const report = c.qaReport as QaReport
    expect(report.findings.map(f => f.code)).not.toContain('skin_smoothed')
    expect(report.texture?.smoothed).toBe(false)
  })
})
