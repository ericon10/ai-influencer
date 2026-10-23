import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { importCharacter } from './files.js'
import { saveSocialAccount } from './scaleKit.js'
import { checkWeek, importWeek, weekView } from './weeks.js'
import { getContent, type ContentOutputs } from './content.js'
import { startCardRenders } from './weekRender.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import { candidates } from '../db/schema.js'
import { newId } from '../lib/ids.js'
import { readAsset, saveAsset } from '../storage/assets.js'
import { probeMedia } from '../media/ffmpeg.js'
import { dialogueLines, dumpFrames, textFrames, twoBeats } from '../core/cardRender.js'

// Text-only and photo-dump posts (UX-PLAN.md section 42 A, B): imported from
// the plan CSV, checked, rendered free on the worker into a 9:16 mp4, made in
// the Weeks grid like any post. No generation, no quote.

let h: Harness
let callie = ''
const MONDAY = '2026-10-26'

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  callie = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
  await saveSocialAccount(h.deps, h.ctx, 'callie_tt_01', { characterId: callie, slotsPerDay: 3 })
}, 180_000)

describe('the frames', () => {
  it('two beats split on " / " or after the first sentence; dialogue stacks the speakers; 6 to 8 s by length; a dump is 6 s', () => {
    expect(twoBeats('my manager: any questions? / me: is this job real')).toEqual(['my manager: any questions?', 'me: is this job real'])
    expect(twoBeats('I applied to 200 jobs. They all said no.')).toEqual(['I applied to 200 jobs.', 'They all said no.'])
    expect(dialogueLines('Her: are you ok / Me: define ok')).toEqual(['Her: are you ok', 'Me: define ok'])
    const f = textFrames('my manager: any questions? / me: is this job real', 'two_beat')
    expect(f[0]).toEqual({ text: 'my manager: any questions?', seconds: 2 })
    expect(f[1]!.text).toBe('my manager: any questions?\n\nme: is this job real')
    expect(f.reduce((a, x) => a + x.seconds, 0)).toBeGreaterThanOrEqual(6)
    expect(textFrames('a very long line '.repeat(20), 'centered')[0]!.seconds).toBe(8)
    expect(dumpFrames(6)).toEqual([1, 1, 1, 1, 1, 1])
    expect(dumpFrames(5).reduce((a, b) => a + b, 0)).toBeCloseTo(6)
  })
})

describe('Weeks', () => {
  it('imports text_only and photo_dump rows, flags a dump without 5 stills, renders both free into 9:16 mp4s', async () => {
    const csv = [
      'row_id,account,date,slot,post_type,line,text_style,bg_color,bg_motion',
      `T1,callie_tt_01,${MONDAY},1,text_only,"my manager: any questions? / me: is this job real",two_beat,#1a2b3c,`,
      `T2,callie_tt_01,${MONDAY},2,photo_dump,october so far a recap,,,zoom`,
    ].join('\n')
    const r = await importWeek(h.deps, h.ctx, csv, { rows: ['T1', 'T2'] })
    expect(r.created).toBe(2)
    await checkWeek(h.deps, h.ctx, MONDAY)
    let v = await weekView(h.deps, h.ctx, MONDAY)
    const t1 = v.cells.find(c => c.rowId === 'T1')!, t2 = v.cells.find(c => c.rowId === 'T2')!
    expect(t1).toMatchObject({ postType: 'text_only', flags: [], made: false, video: false })
    expect(t2.flags.join(' ')).toMatch(/A photo dump needs 5 approved stills; none found/)
    const post = await getContent(h.deps, h.ctx, t1.postId)
    expect((post.spec as { card?: unknown }).card).toEqual({ type: 'text_only', bgColor: '#1a2b3c', textStyle: 'two_beat', motion: 'none', placeId: null, stillIds: [] })
    // Six approved stills of hers, then the dump checks clean.
    for (let i = 0; i < 6; i++) {
      const a = await saveAsset(h.deps, h.ctx, { data: await renderPlaceholderPortrait(`still ${i}`, '9:16'), mime: 'image/png', origin: 'upload' })
      await h.deps.db.insert(candidates).values({ id: newId('cand'), accountId: h.ctx.accountId, characterId: callie, target: 'scene', op: 'generate', status: 'approved', assetId: a.id, prompt: 'x', createdAt: new Date(Date.UTC(2026, 9, 20, 10, i)) })
    }
    await checkWeek(h.deps, h.ctx, MONDAY)
    v = await weekView(h.deps, h.ctx, MONDAY)
    expect(v.cells.find(c => c.rowId === 'T2')!.flags).toEqual([])
    expect(await startCardRenders(h.deps, h.ctx, [t1.postId, t2.postId])).toEqual({ started: 2 })
    // A second click while they run starts nothing new.
    expect(await startCardRenders(h.deps, h.ctx, [t1.postId])).toEqual({ started: 0 })
    await drain(h, 20)
    v = await weekView(h.deps, h.ctx, MONDAY)
    for (const [row, min, max] of [['T1', 6, 8.2], ['T2', 5.8, 6.3]] as const) {
      const c = v.cells.find(x => x.rowId === row)!
      expect(c.made, row).toBe(true)
      const out = (await getContent(h.deps, h.ctx, c.postId)).outputs as ContentOutputs
      const probe = await probeMedia((await readAsset(h.deps, h.ctx, out.videoAssetId!)).data)
      expect(probe).toMatchObject({ width: 1080, height: 1920 })
      expect(probe.durationSec!).toBeGreaterThanOrEqual(min)
      expect(probe.durationSec!).toBeLessThanOrEqual(max)
    }
  }, 180_000)
})
