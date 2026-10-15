import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createHarness, type Harness } from '../testing/harness.js'
import { createCharacter } from './characters.js'
import { addStills, libraryView } from './clips.js'
import { createContent } from './content.js'
import { editorLibrary } from './editorMedia.js'
import { readAsset } from '../storage/assets.js'
import { createUploadSlots, uploadKey } from '../storage/uploads.js'

// Upload images (owner, 2026-10-15): several at once, into Library > Stills
// for the character picked, kept exactly as uploaded (never downscaled,
// recompressed or converted), and offered in the editor's Studio picker.

let h: Harness
let callie: string, maya: string
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex')

async function put(name: string, type: string, data: Buffer) {
  const { slots } = await createUploadSlots(h.deps, h.ctx, [{ name, type, size: data.length }])
  await h.deps.store.put(uploadKey(h.ctx.accountId, slots[0]!.uploadId), data, type)
  return { uploadId: slots[0]!.uploadId, name, type }
}

beforeAll(async () => {
  h = await createHarness()
  callie = (await createCharacter(h.deps, h.ctx, { name: 'Callie' })).id
  maya = (await createCharacter(h.deps, h.ctx, { name: 'Maya' })).id
})
afterAll(async () => { await h.close() })

describe('upload images', () => {
  it('keeps every image byte for byte at full size, as kept stills of the character picked', async () => {
    // A large photo (4032 x 3024, like a phone's), a PNG with transparency
    // and a WebP: nothing is resized, recompressed or turned into JPEG.
    const photo = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 180, g: 120, b: 90 } } }).jpeg({ quality: 97 }).toBuffer()
    const png = await sharp({ create: { width: 1170, height: 2532, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } } }).png().toBuffer()
    const webp = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp({ lossless: true }).toBuffer()
    const ups = [await put('IMG_0001.JPG', 'image/jpeg', photo), await put('screen.png', 'image/png', png), await put('look.webp', 'image/webp', webp)]
    const { stills } = await addStills(h.deps, h.ctx, { characterId: callie, uploads: ups })
    expect(stills.map(s => s.name)).toEqual(['IMG_0001', 'screen', 'look'])
    for (const [i, src] of [photo, png, webp].entries()) {
      const { row, data } = await readAsset(h.deps, h.ctx, stills[i]!.assetId)
      expect(sha(data)).toBe(sha(src))
      expect(row.bytes).toBe(src.length)
      expect(row.mime).toBe(['image/jpeg', 'image/png', 'image/webp'][i])
    }
    const photoRow = (await readAsset(h.deps, h.ctx, stills[0]!.assetId)).row
    expect([photoRow.width, photoRow.height]).toEqual([4032, 3024])
    // The slots are freed once the images are kept.
    expect(await h.deps.store.exists(uploadKey(h.ctx.accountId, ups[0]!.uploadId))).toBe(false)

    // In Library > Stills for Callie only, named by the file.
    const lib = await libraryView(h.deps, h.ctx, { characterId: callie })
    expect(lib.stills.filter(s => s.op === 'upload_image').map(s => s.sceneTitle).sort()).toEqual(['IMG_0001', 'look', 'screen'])
    expect((await libraryView(h.deps, h.ctx, { characterId: maya })).stills).toHaveLength(0)

    // In the editor's Studio picker, under the character's stills.
    const post = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, spec: {} })
    const { groups } = await editorLibrary(h.deps, h.ctx, post.id)
    const mine = groups.find(g => g.id === 'stills')!
    expect(mine.label).toBe("Callie's stills")
    expect(mine.items.map(x => x.id).sort()).toEqual(stills.map(s => s.assetId).sort())
    expect(mine.items.every(x => x.kind === 'image' && x.thumb?.endsWith('?w=320'))).toBe(true)
  })

  it('refuses what is not an image, names HEIC, and checks the post belongs to the character', async () => {
    const clip = await put('clip.mp4', 'video/mp4', Buffer.from('not really a video'))
    await expect(addStills(h.deps, h.ctx, { characterId: maya, uploads: [clip] })).rejects.toThrow(/is not an image/)
    await expect(createUploadSlots(h.deps, h.ctx, [{ name: 'IMG_2.HEIC', type: 'image/heic', size: 100 }])).rejects.toThrow(/HEIC photo.*JPEG/)
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, spec: {} })
    const img = await put('a.png', 'image/png', await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer())
    await expect(addStills(h.deps, h.ctx, { characterId: maya, uploads: [img], contentId: post.id })).rejects.toThrow(/another character/)
  })
})
