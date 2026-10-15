import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { createHarness, type Harness } from '../testing/harness.js'
import { assets, candidates, contentItems, jobs, refImages } from '../db/schema.js'
import { newId } from '../lib/ids.js'
import { saveAsset, thumbnail, thumbKeyOf } from '../storage/assets.js'
import { createCharacter } from './characters.js'
import { createContent } from './content.js'
import { libraryView } from './clips.js'
import { createScene, sceneCandidates } from './scenes.js'
import { autoClean, listTrash, purgeDue, restore, trash, trashWarnings, TRASH_DAYS } from './trash.js'

// Delete and the Trash (owner, 2026-10-15): an item deleted in the Library
// waits 7 days in the Trash, restorable, then its files leave storage for
// good, thumbnails included. A sheet ref or an item a post uses warns first.
// Auto-clean moves never-kept takes there N days after the post is finished;
// starred takes never.

const DAY = 86_400_000
let h: Harness
let callie: string

async function still(label = '') {
  const png = await sharp({ create: { width: 64, height: 96, channels: 3, background: { r: 200, g: 150, b: 120 } } }).png().toBuffer()
  const a = await saveAsset(h.deps, h.ctx, { data: png, origin: 'generated' })
  const id = newId('cand')
  await h.deps.db.insert(candidates).values({ id, accountId: h.ctx.accountId, characterId: callie, target: 'scene', op: 'upload_image', label, assetId: a.id, status: 'approved' })
  return { id, assetId: a.id, key: a.storageKey }
}

// A take, without probing a real video (the bytes are never played here).
async function take(opts: { sceneId?: string | null; jobId?: string | null; status?: string; favorite?: boolean; op?: string } = {}) {
  const aid = newId('ast')
  const key = `acct/${h.ctx.accountId}/2026/10/${aid}.mp4`
  await h.deps.store.put(key, Buffer.from('take'), 'video/mp4')
  await h.deps.db.insert(assets).values({ id: aid, accountId: h.ctx.accountId, kind: 'video', storageKey: key, mime: 'video/mp4', bytes: 4, checksumSha256: aid, origin: 'generated' })
  const id = newId('cand')
  await h.deps.db.insert(candidates).values({ id, accountId: h.ctx.accountId, characterId: callie, target: 'scene', sceneId: opts.sceneId ?? null, jobId: opts.jobId ?? null, op: opts.op ?? 'video', assetId: aid, status: opts.status ?? 'in_review', favorite: opts.favorite ?? false })
  return { id, assetId: aid, key }
}

beforeAll(async () => {
  h = await createHarness()
  callie = (await createCharacter(h.deps, h.ctx, { name: 'Callie' })).id
})
afterAll(async () => { await h.close() })

describe('delete and the Trash', () => {
  it('moves a still to the Trash, out of the Library, and Restore puts it back', async () => {
    const s = await still('Kitchen')
    expect((await libraryView(h.deps, h.ctx)).stills.map(x => x.id)).toContain(s.id)
    const { moved, ids } = await trash(h.deps, h.ctx, [{ kind: 'candidate', id: s.id }])
    expect(moved).toBe(1)
    expect((await libraryView(h.deps, h.ctx)).stills.map(x => x.id)).not.toContain(s.id)
    const [row] = await listTrash(h.deps, h.ctx)
    expect(row).toMatchObject({ id: ids[0], refId: s.id, label: 'Kitchen', reason: 'owner', media: 'image', daysLeft: TRASH_DAYS })
    // Nothing leaves storage while it is in the Trash.
    expect(await h.deps.store.exists(s.key)).toBe(true)
    // Twice is a no-op.
    expect((await trash(h.deps, h.ctx, [{ kind: 'candidate', id: s.id }])).moved).toBe(0)
    expect((await restore(h.deps, h.ctx, ids)).restored).toBe(1)
    const back = (await libraryView(h.deps, h.ctx)).stills.find(x => x.id === s.id)
    expect(back?.status).toBe('approved')
    expect(await listTrash(h.deps, h.ctx)).toHaveLength(0)
  })

  it('warns before deleting a sheet ref or something a post uses', async () => {
    const s = await still('Sheet shot')
    await h.deps.db.update(refImages).set({ status: 'approved', approvedCandidateId: s.id }).where(and(eq(refImages.characterId, callie), eq(refImages.refId, 'REF-03')))
    const t = await take()
    await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, title: 'Morning coffee', spec: { clipId: t.id } })
    const loose = await still('Loose')
    const w = await trashWarnings(h.deps, h.ctx, [{ kind: 'candidate', id: s.id }, { kind: 'candidate', id: t.id }, { kind: 'candidate', id: loose.id }])
    expect(w.find(x => x.id === s.id)?.text).toMatch(/REF-03 of Callie's sheet/)
    expect(w.find(x => x.id === t.id)?.text).toMatch(/Used in 1 post: Morning coffee/)
    expect(w.some(x => x.id === loose.id)).toBe(false)
  })

  it('removes files and thumbnails for good after 7 days, keeping a file something else still uses', async () => {
    const s = await still('Gone')
    const row = (await h.deps.db.select().from(assets).where(eq(assets.id, s.assetId)))[0]!
    await thumbnail(h.deps, h.ctx, row, 320)
    await thumbnail(h.deps, h.ctx, row, 160)
    expect(await h.deps.store.exists(thumbKeyOf(s.key, 320))).toBe(true)
    // A second item with the same file (a copy) is not deleted.
    const twin = newId('cand')
    await h.deps.db.insert(candidates).values({ id: twin, accountId: h.ctx.accountId, characterId: callie, target: 'scene', op: 'crop', assetId: s.assetId, status: 'approved' })
    const other = await still('Also gone')
    await trash(h.deps, h.ctx, [{ kind: 'candidate', id: s.id }, { kind: 'candidate', id: other.id }])

    h.clock.advance(6 * DAY)
    expect((await purgeDue(h.deps, h.ctx)).items).toBe(0)
    h.clock.advance(1 * DAY + 1000)
    const purged = await purgeDue(h.deps, h.ctx)
    expect(purged.items).toBe(2)
    // The shared file stays (its twin is live); the other one is gone.
    expect(await h.deps.store.exists(s.key)).toBe(true)
    expect(await h.deps.store.exists(other.key)).toBe(false)
    // Then the twin goes too: its file and every thumbnail leave storage.
    const { ids } = await trash(h.deps, h.ctx, [{ kind: 'candidate', id: twin }])
    h.clock.advance(8 * DAY)
    await purgeDue(h.deps, h.ctx)
    for (const key of [s.key, thumbKeyOf(s.key, 320), thumbKeyOf(s.key, 160)]) expect(await h.deps.store.exists(key)).toBe(false)
    expect((await h.deps.db.select().from(candidates).where(eq(candidates.id, s.id)))[0]!.status).toBe('purged')
    // Gone for good is gone: Restore has nothing to bring back.
    expect((await restore(h.deps, h.ctx, ids)).restored).toBe(0)
  })

  it('a render: the post goes back to a draft, Restore brings the files back', async () => {
    const s = await still('Slide')
    const post = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, spec: {} })
    await h.deps.db.update(contentItems).set({ status: 'ready', outputs: { imageAssetIds: [s.assetId], renderedAt: h.clock.now().toISOString() } }).where(eq(contentItems.id, post.id))
    const { ids } = await trash(h.deps, h.ctx, [{ kind: 'render', id: post.id }])
    let [p] = await h.deps.db.select().from(contentItems).where(eq(contentItems.id, post.id))
    expect(p!.status).toBe('draft')
    expect(p!.outputs).toEqual({})
    await restore(h.deps, h.ctx, ids)
    ;[p] = await h.deps.db.select().from(contentItems).where(eq(contentItems.id, post.id))
    expect(p!.status).toBe('ready')
    expect((p!.outputs as { imageAssetIds: string[] }).imageAssetIds).toEqual([s.assetId])
  })

  it('trashed takes leave the post views and lists', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Kitchen' })
    const t = await take({ sceneId: scene.id })
    expect((await sceneCandidates(h.deps, h.ctx, [scene.id])).map(c => c.id)).toContain(t.id)
    await trash(h.deps, h.ctx, [{ kind: 'candidate', id: t.id }])
    expect((await sceneCandidates(h.deps, h.ctx, [scene.id])).map(c => c.id)).not.toContain(t.id)
  })
})

describe('auto-clean', () => {
  it('moves never-kept takes N days after the post is finished; starred, kept and used takes stay', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Balcony' })
    const loose = await take({ sceneId: scene.id })
    const starred = await take({ sceneId: scene.id, favorite: true })
    const kept = await take({ sceneId: scene.id, status: 'approved' })
    const used = await take({ sceneId: scene.id })
    const upload = await take({ sceneId: scene.id, op: 'upload' })
    // A Recreate take, found by its run.
    const post = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, sceneId: scene.id, spec: { clipId: used.id } })
    const jobId = newId('job')
    await h.deps.db.insert(jobs).values({ id: jobId, accountId: h.ctx.accountId, stage: 'content', purpose: `clone:${post.id}:${callie}`, provider: 'mock', model: 'mock', kind: 'video', idempotencyKey: jobId, estimateMicros: 0, status: 'completed', request: {} })
    const recreate = await take({ jobId })
    const finished = h.clock.now()
    await h.deps.db.update(contentItems).set({ status: 'ready', outputs: { videoAssetId: kept.assetId, renderedAt: finished.toISOString() } }).where(eq(contentItems.id, post.id))

    // Off, or not yet 14 days: nothing moves.
    expect((await autoClean(h.deps, h.ctx, null)).moved).toBe(0)
    h.clock.advance(13 * DAY)
    expect((await autoClean(h.deps, h.ctx, 14)).moved).toBe(0)
    h.clock.advance(1 * DAY + 1000)
    expect((await autoClean(h.deps, h.ctx, 14)).moved).toBe(2)
    const inTrash = await listTrash(h.deps, h.ctx)
    expect(inTrash.filter(x => x.reason === 'auto').map(x => x.refId).sort()).toEqual([loose.id, recreate.id].sort())
    for (const stay of [starred, kept, used, upload]) expect(inTrash.some(x => x.refId === stay.id)).toBe(false)
    // Once in the Trash it is not moved again.
    expect((await autoClean(h.deps, h.ctx, 14)).moved).toBe(0)
  })
})
