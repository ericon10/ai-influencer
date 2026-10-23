import { describe, expect, it } from 'vitest'
import { videoPostExportJson } from './postExport.js'
import { planMetaSchema } from './planMeta.js'

// post.json gaps (UX-PLAN.md section 42 E): the post's product, and the
// plan row's sound to add with its type.
describe('a video post\'s post.json', () => {
  it('names the product and the sound to add', () => {
    const plan = planMetaSchema.parse({ rowId: 'C1', soundName: 'sad violin', soundType: 'music' })
    const j = videoPostExportJson({
      post: { id: 'cnt_1', kind: 'meme', title: 't', idea: '', accountTag: 'callie_tt_01', characterId: null, characterName: null, variationOf: null, batchOf: null, createdAt: '', updatedAt: '', product: { id: 'prd_1', name: 'SideStep' } },
      video: { file: 'video.mp4', assetId: 'ast_1', durationSec: 6, onScreenText: 'x', captionOff: false },
      caption: { text: 'c', hashtags: [], ctaLine: '', ad: false, asPosted: 'c' },
      plan, aiLabel: 'AI', exportedAt: '', sound: { music: 'sad violin', voiceover: '', type: 'music' },
    }) as { post: { product: unknown }; plan: { sound_name: string; sound_type: string }; sound_to_add: { music: string; sound_type: string; note: string } }
    expect(j.post.product).toEqual({ id: 'prd_1', name: 'SideStep' })
    expect(j.plan).toMatchObject({ sound_name: 'sad violin', sound_type: 'music' })
    expect(j.sound_to_add).toMatchObject({ music: 'sad violin', sound_type: 'music', note: 'Add this sound in the app.' })
  })
})
