import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { linkInspiration } from './characters.js'
import { pickHero } from './review.js'
import { scoreDistinctness, scoreIdentity } from './identity.js'
import { saveAsset } from '../storage/assets.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { candidates } from '../db/schema.js'
import { newId } from '../lib/ids.js'
import { evaluateSheetShot, finalize } from '../core/qa/marks.js'
import { idealObservation } from '../core/qa/ideal.js'
import type { FaceAnalysis, FaceMatcher } from '../qa/faces.js'

// Identity and distinctness wiring (SPEC 6), with a stand-in face matcher
// whose embeddings the test sets per image. The real models are covered in
// server/qa/faces.test.ts.

const FIX = join(process.cwd(), 'fixtures', 'callie')
const callie = JSON.parse(readFileSync(join(FIX, 'appendix-a.json'), 'utf8'))

const vec = (...xs: number[]) => Float32Array.from([...xs, ...new Array(128 - xs.length).fill(0)])
const embeddings = new Map<string, Float32Array | null>()
let available = true
const stub: FaceMatcher = {
  status: async () => (available ? { available: true } : { available: false, reason: 'models missing' }),
  detect: async () => [],
  analyze: async (_image, key) => {
    const e = key ? embeddings.get(key) : undefined
    if (e === undefined) throw new Error(`test forgot to set a face for ${key}`)
    return e ? ({ face: { box: { x: 0, y: 0, w: 10, h: 10 }, landmarks: [], score: 1 }, faces: 1, embedding: e } satisfies FaceAnalysis) : null
  },
}

let h: Harness
let characterId: string
const shot = (id: string) => h.deps.config.pipeline.sheet.shots.find(s => s.id === id)!

async function image(label: string, face: Float32Array | null): Promise<string> {
  const a = await saveAsset(h.deps, h.ctx, { data: await renderPlaceholderPortrait(label), origin: 'upload' })
  embeddings.set(a.checksumSha256!, face)
  return a.id
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness({ faces: stub })
  const md = [
    '---', `name: Callie`, `age: ${callie.age ?? 24}`, '---', '',
    '## Card', callie.card ?? 'A woman in her mid-twenties with warm brown eyes.', '',
  ].join('\n')
  const images: Record<string, { data: Buffer }> = {}
  for (const id of ['REF-00', 'REF-01']) images[id] = { data: await renderPlaceholderPortrait(`callie ${id}`) }
  const imported = await importCharacter(h.deps, h.ctx, md, { images })
  characterId = imported.characterId
  // The imported refs: REF-01 is REF-00 turned a little.
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  embeddings.set(sha(images['REF-00']!.data), vec(1, 0, 0))
  embeddings.set(sha(images['REF-01']!.data), vec(0.6, 0.8, 0))
}, 120_000)

afterAll(async () => { await h?.close() })

describe('identity QA on sheet shots', () => {
  it('passes a shot whose face matches REF-00 and records the score', async () => {
    const assetId = await image('same face', vec(0.95, 0.1, 0.05))
    const r = await scoreIdentity(h.deps, h.ctx, { characterId, shot: shot('REF-02'), assetId })
    expect(r.identity).toMatchObject({ kind: 'identity', against: 'REF-00' })
    expect(r.identity!.score).toBeGreaterThan(0.9)
    expect(r.findings).toEqual([expect.objectContaining({ code: 'identity_match', severity: 'info' })])
    expect(finalize(r.findings, 'three_quarter_right').verdict).toBe('post')
  })

  it('fails face drift as regenerate, never an edit (SPEC 5.3 rule 25)', async () => {
    const assetId = await image('someone else', vec(0, 0, 1))
    const r = await scoreIdentity(h.deps, h.ctx, { characterId, shot: shot('REF-09'), assetId })
    expect(r.findings[0]).toMatchObject({ code: 'face_drift', severity: 'fail' })
    expect(r.findings[0]!.message).toMatch(/match 0\.00, needs 0\.36/)
    const s = shot('REF-09')
    const report = evaluateSheetShot({
      shot: s, views: h.deps.config.pipeline.views, marks: callie.marks, eyeColor: 'brown',
      observation: idealObservation(s, h.deps.config.pipeline.views, callie.marks, callie.eyes), extraFindings: r.findings,
    })
    expect(report.verdict).toBe('regenerate')
    expect(report.summary).toMatch(/does not match REF-00/)
    expect(report.reasons).toContain('face_drift')
  })

  it('a face drift stands even when the vision model contradicted itself', () => {
    const report = finalize([{ code: 'face_drift', severity: 'fail', message: 'drift' }, { code: 'uncertain', severity: 'warn', message: 'mirror' }], 'front', true)
    expect(report.verdict).toBe('regenerate')
  })

  it('uses the closest-angle ref when it matches better than REF-00', async () => {
    const assetId = await image('turned', vec(0.62, 0.78, 0))
    const r = await scoreIdentity(h.deps, h.ctx, { characterId, shot: shot('REF-10'), assetId })
    expect(r.identity?.against).toBe('REF-01')
  })

  it('skips profiles and backs, where the face is not in view', async () => {
    const assetId = await image('profile', vec(1, 0, 0))
    for (const id of ['REF-03', 'REF-05', 'REF-07']) {
      const r = await scoreIdentity(h.deps, h.ctx, { characterId, shot: shot(id), assetId })
      expect(r.identity).toBeNull()
      expect(r.findings[0]).toMatchObject({ code: 'identity_skipped', severity: 'info' })
    }
  })

  it('asks for a person when no face is found', async () => {
    const assetId = await image('no face', null)
    const r = await scoreIdentity(h.deps, h.ctx, { characterId, shot: shot('REF-06'), assetId })
    expect(r.findings[0]).toMatchObject({ code: 'uncertain', severity: 'warn' })
  })

  it('skips demo images and says so when the models are missing', async () => {
    const assetId = await image('demo', vec(1, 0, 0))
    expect((await scoreIdentity(h.deps, h.ctx, { characterId, shot: shot('REF-02'), assetId, demo: true })).findings[0]!.message).toMatch(/Demo images/)
    available = false
    try {
      const r = await scoreIdentity(h.deps, h.ctx, { characterId, shot: shot('REF-02'), assetId })
      expect(r.findings[0]).toMatchObject({ code: 'identity_skipped' })
      expect(r.findings[0]!.message).toMatch(/models missing/)
    } finally { available = true }
  })
})

describe('distinctness on heroes', () => {
  it('flags a hero that is the inspiration person and blocks picking it', async () => {
    const insp = await image('inspiration person', vec(0, 1, 0))
    await linkInspiration(h.deps, h.ctx, characterId, insp)
    const lookalike = await image('lookalike hero', vec(0.1, 0.99, 0))
    const r = (await scoreDistinctness(h.deps, h.ctx, { characterId, assetId: lookalike }))!
    expect(r.findings[0]).toMatchObject({ code: 'too_similar', severity: 'fail' })
    expect(r.identity).toMatchObject({ kind: 'distinctness', against: 'inspiration 1' })

    const report = { ...finalize(r.findings, null), identity: r.identity }
    expect(report.verdict).toBe('regenerate')
    const id = newId('cand')
    await h.deps.db.insert(candidates).values({ id, accountId: h.ctx.accountId, characterId, target: 'hero', assetId: lookalike, status: 'qa_failed', qaReport: report, qaVerdict: report.verdict })
    await expect(pickHero(h.deps, h.ctx, id)).rejects.toThrow(/too close to the inspiration/)
  })

  it('passes a hero that is a new person', async () => {
    const fresh = await image('new person hero', vec(0, 0, 1))
    const r = (await scoreDistinctness(h.deps, h.ctx, { characterId, assetId: fresh }))!
    expect(r.findings[0]).toMatchObject({ code: 'identity_match', severity: 'info' })
    expect(r.identity!.score).toBeLessThan(h.deps.config.pipeline.review.qa.distinctness_max_similarity)
  })
})
