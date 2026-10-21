import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, drain, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { estimateAction, runAction } from './actions.js'
import { importCharacter } from './files.js'
import { createContent, getContent, updateContent } from './content.js'
import { autoPlace } from './facePlace.js'
import { renderPlaceholderPortrait } from '../providers/mock.js'
import type { FaceMatcher } from '../qa/faces.js'
import type { SlideshowSpec } from '../core/slideshowSpec.js'

// R1 on slide stills (item 8), in demo mode with a stand-in face finder: a
// still that lands moves its words off the face; a drag by the owner
// sticks; no face, no move; Auto-place all runs over every slide.

let h: Harness
let characterId: string
let face: { x: number; y: number; w: number; h: number } | null = { x: 0.3, y: 0.2, w: 0.4, h: 0.2 }
const faces: FaceMatcher = {
  status: async () => ({ available: true }),
  detect: async (img: Buffer) => {
    if (!face) return []
    const m = await sharp(img).metadata()
    return [{ box: { x: face.x * m.width!, y: face.y * m.height!, w: face.w * m.width!, h: face.h * m.height! }, landmarks: [], score: 0.99 }]
  },
  analyze: async () => { throw new Error('not in this test') },
}

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness({ faces })
  const md = readFileSync(join(process.cwd(), 'fixtures', 'callie', 'character-callie.md'), 'utf8')
  const images: Record<string, { data: Buffer }> = {}
  for (let i = 0; i <= 11; i++) images[`REF-${String(i).padStart(2, '0')}`] = { data: await renderPlaceholderPortrait(`REF-${i}`) }
  characterId = (await importCharacter(h.deps, h.ctx, md, { images })).characterId
}, 120_000)

const spec = async (id: string) => (await getContent(h.deps, h.ctx, id)).spec as SlideshowSpec

describe('captions never on a face, slide stills (R1)', () => {
  it('a still that lands moves its words off the face; a drag sticks; no face keeps the place', async () => {
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId, accountTag: 'r1', idea: 'jobs', spec: { mode: 'topic', hook: 'they replaced me with a spreadsheet macro', slides: ['two', 'three'] } as never })
    const action = { type: 'slideshow_stills' as const, contentId: post.id, slides: [0] }
    const { quote } = await estimateAction(h.deps, h.ctx, action)
    await runAction(h.deps, h.ctx, action, quote.id, true)
    await drain(h, 60)
    const s = await spec(post.id)
    expect(s.stillIds[0]).toBeTruthy()
    expect(s.textPos[0]).toMatchObject({ by: 'auto' })
    // The default place (0.28 of the height) sat on the face (0.2 to 0.4):
    // the words go below it, clear by 4%.
    expect(s.textPos[0]!.y).toBeGreaterThan(0.44)

    await updateContent(h.deps, h.ctx, post.id, { spec: { textPos: [{ x: 0.5, y: 0.3, by: 'owner' }] } as never })
    expect((await autoPlace(h.deps, h.ctx, post.id))[0]).toEqual({ slide: 0, how: 'owner' })
    expect((await spec(post.id)).textPos[0]).toEqual({ x: 0.5, y: 0.3, by: 'owner' })

    face = null
    await updateContent(h.deps, h.ctx, post.id, { spec: { textPos: [] } as never })
    // The face boxes are kept with the still: found once.
    expect((await autoPlace(h.deps, h.ctx, post.id))[0]!.how).not.toBe('kept')
  })
})
