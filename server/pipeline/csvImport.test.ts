import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { createContent, getContent, type ContentOutputs, type MemeSpec } from './content.js'
import { addClip } from './clips.js'
import { previewImport, runImport } from './csvImport.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { makeClip } from '../media/testClips.js'
import { uploadKey } from '../storage/uploads.js'

// Spreadsheet import inside a batch (overnight item 3). Mock adapter only:
// nothing paid runs; the preview prices the new rows from the price book.

const FIX = join(process.cwd(), 'fixtures', 'callie')
let h: Harness, characterId: string, batchId: string, dir: string

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  dir = await mkdtemp(join(tmpdir(), 'import-'))
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`Callie REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, readFileSync(join(FIX, 'character-callie.md'), 'utf8'), { images })).characterId
  const src = join(dir, 'clip.mp4')
  await makeClip(src, { width: 360, height: 640, fps: 30, durationSec: 3, audio: false })
  const uploadId = 'upl_' + 'i'.repeat(20)
  await h.deps.store.put(uploadKey(h.ctx.accountId, uploadId), await readFile(src), 'video/mp4')
  await addClip(h.deps, h.ctx, { characterId, uploadId, name: 'dance-take.mp4' })
  await drain(h, 20)
  batchId = (await createContent(h.deps, h.ctx, { kind: 'batch', characterId, accountTag: 'callie main' })).id
}, 240_000)

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const CSV = [
  'character,account,clip,video,caption,style',
  'Callie,@callie.jobs,Dance Take,,entry level but 5 years experience,Crash zoom cut',
  'Callie,,"still: at her desk at night, laptop open",she sighs and looks up,ghosted after the final round,',
  'Mara,x,dance take,,hi,',
  'Callie,callie.jobs,dance-take.mp4,,applying feels like a full-time job,',
].join('\n')

describe('importing a spreadsheet into a batch', () => {
  it('previews every row with its status and the total price, free', async () => {
    const p = await previewImport(h.deps, h.ctx, batchId, CSV)
    expect(p.rows.map(r => r.status)).toEqual(['reuse', 'generate', 'problem', 'reuse'])
    expect(p.rows[0]).toMatchObject({ accountTag: 'callie.jobs', style: 'crash_zoom', priceUsd: 0 })
    expect(p.rows[1]!.priceUsd).toBeGreaterThan(0)
    expect(p.totals).toMatchObject({ rows: 4, reuse: 2, generate: 1, problem: 1 })
    expect(p.totals.usd).toBe(p.rows[1]!.priceUsd)
    expect(p.priceNote).toMatch(/still/)
    expect(p.rows[2]!.problems).toEqual(['No character named "Mara"'])
  })

  it('makes one video post per good row and exports the free ones', async () => {
    const r = await runImport(h.deps, h.ctx, batchId, { csv: CSV, exportFree: true })
    expect(r.created.map(c => c.status)).toEqual(['reuse', 'generate', 'reuse'])
    expect(r).toMatchObject({ exporting: 1, skipped: 1 })
    // The crash zoom row waits for shot B, and says so.
    expect(r.notExported).toEqual([{ line: 2, id: r.created[0]!.id, reason: expect.stringMatching(/shot B/) }])
    const reuse = await getContent(h.deps, h.ctx, r.created[0]!.id)
    expect(reuse).toMatchObject({ kind: 'meme', accountTag: 'callie.jobs', step: 'finish' })
    expect((reuse.spec as MemeSpec).caption).toBe('entry level but 5 years experience')
    expect((reuse.spec as MemeSpec).edit.style).toBe('crash_zoom')
    const fresh = await getContent(h.deps, h.ctx, r.created[1]!.id)
    expect(fresh).toMatchObject({ step: 'stills', accountTag: 'callie main' })
    expect(fresh.idea).toBe('at her desk at night, laptop open\nIn the video: she sighs and looks up')
    await drain(h, 40)
    const exported = await getContent(h.deps, h.ctx, r.created[2]!.id)
    expect(exported.status).toBe('ready')
    expect((exported.outputs as ContentOutputs).videoAssetId).toBeTruthy()
  }, 240_000)

  it('refuses when no row is ready, and only from a batch', async () => {
    await expect(runImport(h.deps, h.ctx, batchId, { csv: 'character,clip,caption\nMara,x,y' })).rejects.toThrow(/No row is ready/)
    // A body without the CSV is a 400, not a server error.
    await expect(runImport(h.deps, h.ctx, batchId, {})).rejects.toMatchObject({ code: 'bad_request', status: 400 })
    const post = (await createContent(h.deps, h.ctx, { kind: 'meme', characterId })).id
    await expect(previewImport(h.deps, h.ctx, post, CSV)).rejects.toThrow(/from a batch/)
  })
})
