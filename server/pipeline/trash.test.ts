import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { createHarness, type Harness } from '../testing/harness.js'
import { assets, candidates, characters, contentItems, jobs, refImages } from '../db/schema.js'
import { newId } from '../lib/ids.js'
import { saveAsset, thumbnail, thumbKeyOf } from '../storage/assets.js'
import { createCharacter } from './characters.js'
import { createContent } from './content.js'
import { libraryView } from './clips.js'
import { createScene, sceneCandidates } from './scenes.js'
import { autoClean, autoCleanPlan, listTrash, purgeDue, restore, trash, trashWarnings, TRASH_DAYS } from './trash.js'
import { autoCleanPreview, runClean, startAutoClean, storageView } from './storage.js'

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
async function take(opts: { sceneId?: string | null; jobId?: string | null; status?: string; favorite?: boolean; op?: string; parentId?: string; meta?: Record<string, unknown> } = {}) {
  const aid = newId('ast')
  const key = `acct/${h.ctx.accountId}/2026/10/${aid}.mp4`
  await h.deps.store.put(key, Buffer.from('take'), 'video/mp4')
  await h.deps.db.insert(assets).values({ id: aid, accountId: h.ctx.accountId, kind: 'video', storageKey: key, mime: 'video/mp4', bytes: 4, checksumSha256: aid, origin: 'generated' })
  const id = newId('cand')
  await h.deps.db.insert(candidates).values({ id, accountId: h.ctx.accountId, characterId: callie, target: 'scene', sceneId: opts.sceneId ?? null, jobId: opts.jobId ?? null, op: opts.op ?? 'video', assetId: aid, status: opts.status ?? 'in_review', favorite: opts.favorite ?? false, parentId: opts.parentId ?? null, meta: opts.meta ?? {} })
  return { id, assetId: aid, key }
}

// A scene still (made, edited, cropped...), never picked unless said.
async function sceneStill(sceneId: string, opts: { status?: string; op?: string; target?: string; parentId?: string; assetId?: string; favorite?: boolean } = {}) {
  const assetId = opts.assetId ?? (await saveAsset(h.deps, h.ctx, { data: await sharp({ create: { width: 32, height: 48, channels: 3, background: { r: 90, g: 120, b: Math.floor(Math.random() * 255) } } }).png().toBuffer(), origin: 'generated' })).id
  const id = newId('cand')
  await h.deps.db.insert(candidates).values({ id, accountId: h.ctx.accountId, characterId: callie, target: opts.target ?? 'scene', sceneId, op: opts.op ?? 'generate', assetId, status: opts.status ?? 'in_review', parentId: opts.parentId ?? null, favorite: opts.favorite ?? false })
  return { id, assetId }
}

// A post on the scene, exported now (finished), with what it uses.
async function finished(sceneId: string | null, spec: Record<string, unknown> = {}, outputs: Record<string, unknown> = {}) {
  const post = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, sceneId, spec })
  await h.deps.db.update(contentItems).set({ status: 'ready', outputs: { renderedAt: h.clock.now().toISOString(), ...outputs } }).where(eq(contentItems.id, post.id))
  return post.id
}
const plannedFor = async (postId: string, days = 14) => (await autoCleanPlan(h.deps, h.ctx, days)).filter(x => x.postId === postId).map(x => x.id).sort()

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
  it('only takes never kept and stills never picked, only after N days, never when Off', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Balcony' })
    const loose = await take({ sceneId: scene.id })
    const unpicked = await sceneStill(scene.id)
    const picked = await sceneStill(scene.id, { status: 'approved' })
    const post = await finished(scene.id, { stillId: picked.id })
    h.clock.advance(13 * DAY)
    expect(await plannedFor(post)).toEqual([])
    h.clock.advance(1 * DAY + 1000)
    expect(await plannedFor(post)).toEqual([loose.id, unpicked.id].sort())
    expect(await autoCleanPlan(h.deps, h.ctx, null)).toEqual([])
    expect((await autoClean(h.deps, h.ctx, null)).moved).toBe(0)
    expect((await autoClean(h.deps, h.ctx, 14)).moved).toBeGreaterThanOrEqual(2)
    const auto = (await listTrash(h.deps, h.ctx)).filter(x => x.reason === 'auto').map(x => x.refId)
    expect(auto).toEqual(expect.arrayContaining([loose.id, unpicked.id]))
    expect(auto).not.toContain(picked.id)
    // Once in the Trash it is not planned again.
    expect(await plannedFor(post)).toEqual([])
  })

  it('1. never a sheet ref, a hero, anything in a character file, or a still sharing one of their files', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Gym' })
    const ref = await sceneStill(scene.id)
    await h.deps.db.update(refImages).set({ status: 'approved', approvedCandidateId: ref.id }).where(and(eq(refImages.characterId, callie), eq(refImages.refId, 'REF-05')))
    const twin = await sceneStill(scene.id, { assetId: ref.assetId, op: 'crop' })
    const hero = await sceneStill(scene.id, { target: 'hero' })
    const sheet = await sceneStill(scene.id, { target: 'sheet' })
    const inFile = await sceneStill(scene.id)
    await h.deps.db.update(characters).set({ breakdown: { portrait: inFile.assetId } }).where(eq(characters.id, callie))
    const loose = await sceneStill(scene.id)
    const post = await finished(scene.id)
    h.clock.advance(15 * DAY)
    expect(await plannedFor(post)).toEqual([loose.id])
    for (const keep of [ref, twin, hero, sheet, inFile]) expect(await plannedFor(post)).not.toContain(keep.id)
  })

  it('2. never a take kept with Keep this take or Use this take, or starred', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Kitchen' })
    const used = await take({ sceneId: scene.id, status: 'approved' })
    const keptOnly = await take({ sceneId: scene.id, meta: { decision: { kind: 'kept', at: h.clock.now().toISOString() } } })
    const starred = await take({ sceneId: scene.id, favorite: true })
    const loose = await take({ sceneId: scene.id })
    const post = await finished(scene.id)
    h.clock.advance(15 * DAY)
    expect(await plannedFor(post)).toEqual([loose.id])
    const planned = await plannedFor(post)
    for (const keep of [used, keptOnly, starred]) expect(planned).not.toContain(keep.id)
  })

  it('3. never anything a post uses: live, exported, archived, in its render or its editor timeline', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Desk' })
    const own = await take({ sceneId: scene.id })
    const inArchived = await take({ sceneId: scene.id })
    const inRender = await take({ sceneId: scene.id })
    const onTimeline = await take({ sceneId: scene.id })
    const inSlideshow = await sceneStill(scene.id)
    const loose = await take({ sceneId: scene.id })
    // The editor's saved timeline (Done) lists the media picked into it.
    const project = await saveAsset(h.deps, h.ctx, { data: Buffer.from(JSON.stringify({ tracks: [], studioMedia: { 'media-1': onTimeline.assetId } })), mime: 'application/json', origin: 'derived' })
    const post = await finished(scene.id, { clipId: own.id, editor: { projectAssetId: project.id, savedAt: null, stack: null } }, { videos: [{ caption: '', assetId: 'ast_rendered0001', clipId: inRender.id }] })
    const archived = await finished(null, { clipId: inArchived.id })
    await h.deps.db.update(contentItems).set({ archivedAt: h.clock.now() }).where(eq(contentItems.id, archived))
    await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: callie, spec: { stillIds: [inSlideshow.id] } })
    h.clock.advance(15 * DAY)
    const names = new Map([[own.id, 'own'], [inArchived.id, 'archived'], [inRender.id, 'render'], [onTimeline.id, 'timeline'], [inSlideshow.id, 'slideshow'], [loose.id, 'loose']])
    expect((await plannedFor(post)).map(id => names.get(id))).toEqual(['loose'])
  })

  it('a saved timeline that cannot be read stops Auto-clean and the Trash emptying; deleting warns about a timeline', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Studio' })
    const loose = await take({ sceneId: scene.id })
    const picked = await take({ sceneId: scene.id, status: 'approved' })
    const project = await saveAsset(h.deps, h.ctx, { data: Buffer.from(JSON.stringify({ studioMedia: { a: picked.assetId } })), mime: 'application/json', origin: 'derived' })
    const post = await finished(scene.id, { editor: { projectAssetId: project.id, savedAt: null, stack: null } })
    // Deleting the take a timeline uses names the post.
    const w = await trashWarnings(h.deps, h.ctx, [{ kind: 'candidate', id: picked.id }])
    expect(w.some(x => /Used in 1 post/.test(x.text))).toBe(true)
    h.clock.advance(15 * DAY)
    expect(await plannedFor(post)).toEqual([loose.id])
    const row = (await h.deps.db.select().from(assets).where(eq(assets.id, project.id)))[0]!
    const broken = { ...h.deps, store: { ...h.deps.store, get: async (key: string) => { if (key === row.storageKey) throw new Error('storage timeout'); return h.deps.store.get(key) } } }
    expect(await autoCleanPlan(broken, h.ctx, 14)).toEqual([])
    await trash(h.deps, h.ctx, [{ kind: 'candidate', id: loose.id }])
    h.clock.advance(8 * DAY)
    expect(await purgeDue(broken, h.ctx)).toEqual({ items: 0, files: 0 })
    expect(await h.deps.store.exists(loose.key)).toBe(true)
  })

  it('4. never the stills, start and end frames a kept take was made from', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Park' })
    const first = await sceneStill(scene.id)
    const edited = await sceneStill(scene.id, { op: 'edit', parentId: first.id })
    const end = await sceneStill(scene.id, { op: 'end_frame' })
    const jobId = newId('job')
    await h.deps.db.insert(jobs).values({ id: jobId, accountId: h.ctx.accountId, stage: 'scene', purpose: `scene_video:${scene.id}`, provider: 'mock', model: 'mock', kind: 'video', idempotencyKey: jobId, estimateMicros: 0, status: 'completed', request: { candidateId: edited.id, endCandidateId: end.id } })
    const kept = await take({ sceneId: scene.id, status: 'approved', parentId: edited.id, jobId })
    const loose = await sceneStill(scene.id)
    const post = await finished(scene.id, { clipId: kept.id })
    h.clock.advance(15 * DAY)
    expect(await plannedFor(post)).toEqual([loose.id])
  })

  it('5. never saved clips and images in the Library: uploads, kept clips, kept clones', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Street' })
    const uploaded = await take({ sceneId: scene.id, op: 'upload', status: 'approved' })
    const uploadedBroken = await take({ sceneId: scene.id, op: 'upload', status: 'failed' })
    const clone = await take({ sceneId: scene.id, op: 'clone', status: 'approved' })
    const image = await sceneStill(scene.id, { op: 'upload_image' })
    const loose = await take({ sceneId: scene.id, op: 'clone' })
    const post = await finished(scene.id)
    h.clock.advance(15 * DAY)
    expect(await plannedFor(post)).toEqual([loose.id])
    for (const keep of [uploaded, uploadedBroken, clone, image]) expect(await plannedFor(post)).not.toContain(keep.id)
  })

  it('leaves a scene alone while another post on it is not finished', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Beach' })
    await take({ sceneId: scene.id })
    const post = await finished(scene.id)
    await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, sceneId: scene.id, spec: {} })
    h.clock.advance(15 * DAY)
    expect(await plannedFor(post)).toEqual([])
  })

  it('the first Auto-clean waits until the owner has seen its list and pressed Start', async () => {
    const scene = await createScene(h.deps, h.ctx, callie, { brief: 'Library' })
    const loose = await take({ sceneId: scene.id })
    await finished(scene.id)
    h.clock.advance(15 * DAY)
    const preview = await autoCleanPreview(h.deps, h.ctx)
    expect(preview).toMatchObject({ days: 14, started: false })
    expect(preview.items.map(x => x.id)).toContain(loose.id)
    expect(preview.items.find(x => x.id === loose.id)).toMatchObject({ kind: 'take', media: 'video', postName: expect.any(String) })
    expect((await storageView(h.deps, h.ctx)).autoCleanNext).toBe(preview.items.length)
    // The daily clean runs, but Auto-clean does not move anything yet.
    expect((await runClean(h.deps, h.ctx)).autoCleaned).toBe(0)
    expect((await listTrash(h.deps, h.ctx)).some(x => x.refId === loose.id)).toBe(false)
    await startAutoClean(h.deps, h.ctx)
    expect((await runClean(h.deps, h.ctx)).autoCleaned).toBe(preview.items.length)
    expect((await listTrash(h.deps, h.ctx)).find(x => x.refId === loose.id)?.reason).toBe('auto')
    expect((await storageView(h.deps, h.ctx)).autoCleanNext).toBe(0)
  })
})
