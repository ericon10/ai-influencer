import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { createHarness, type Harness } from '../testing/harness.js'
import { assets, candidates, contentItems, jobs, products } from '../db/schema.js'
import { newId } from '../lib/ids.js'
import { saveAsset } from '../storage/assets.js'
import { createCharacter } from './characters.js'
import { createContent } from './content.js'
import { libraryItem, libraryView } from './clips.js'
import { addToCollection, collectionItemIds, deleteLibraryCollection, listCollections, readCollections, removeFromCollection, renameLibraryCollection } from './collections.js'
import { restore, trash } from './trash.js'
import { parseLibraryQuery, type LibraryQuery } from '../core/libraryFilter.js'

// The Library's filters, its viewer facts and collections (UX-PLAN.md
// section 34): filters run on the server (character, type, model, date,
// used or unused, product, collection); one item's model, cost, the posts
// that use it and its collections; collections stored per account, and
// deleting one never deletes its items.

const DAY = 86_400_000
let h: Harness
let callie: string, wren: string

const q = (x: Record<string, string>): LibraryQuery => parseLibraryQuery(x)
const ids = (r: { stills: Array<{ id: string }>; clips: Array<{ id: string }> }) => [...r.stills, ...r.clips].map(x => x.id).sort()

async function png() {
  return sharp({ create: { width: 32, height: 48, channels: 3, background: { r: 120, g: Math.floor(Math.random() * 255), b: 90 } } }).png().toBuffer()
}
// A run that made something: the model asked for, the plan or the API.
async function run(opts: { model: string; provider?: string; billing?: 'account'; credits?: number; micros?: number; kind?: string }) {
  const id = newId('job')
  await h.deps.db.insert(jobs).values({
    id, accountId: h.ctx.accountId, stage: 'scene', purpose: `scene:${id}`, provider: opts.provider ?? 'higgsfield', model: 'x', kind: opts.kind ?? 'image',
    idempotencyKey: id, estimateMicros: opts.micros ?? 40_000, status: 'completed',
    request: { kind: 'image', model: opts.model, modelRef: opts.provider === 'local' ? undefined : opts.model, prompt: 'p', ...(opts.billing ? { billing: opts.billing } : {}), ...(opts.credits != null ? { quotedCredits: opts.credits } : {}) },
  })
  return id
}
async function still(characterId: string, opts: { op?: string; jobId?: string | null; label?: string; sceneId?: string | null; at?: Date; meta?: Record<string, unknown> } = {}) {
  const a = await saveAsset(h.deps, h.ctx, { data: await png(), origin: 'generated' })
  const id = newId('cand')
  await h.deps.db.insert(candidates).values({
    id, accountId: h.ctx.accountId, characterId, target: 'scene', op: opts.op ?? 'generate', label: opts.label ?? '', assetId: a.id, status: 'approved',
    jobId: opts.jobId ?? null, sceneId: opts.sceneId ?? null, meta: opts.meta ?? {}, ...(opts.at ? { createdAt: opts.at } : {}),
  })
  return { id, assetId: a.id }
}
async function clip(characterId: string, opts: { op?: string; jobId?: string | null; meta?: Record<string, unknown> } = {}) {
  const aid = newId('ast')
  const key = `acct/${h.ctx.accountId}/2026/10/${aid}.mp4`
  await h.deps.store.put(key, Buffer.from('clip'), 'video/mp4')
  await h.deps.db.insert(assets).values({ id: aid, accountId: h.ctx.accountId, kind: 'video', storageKey: key, mime: 'video/mp4', bytes: 4, checksumSha256: aid, origin: 'generated', durationMs: 5000 })
  const id = newId('cand')
  await h.deps.db.insert(candidates).values({ id, accountId: h.ctx.accountId, characterId, target: 'scene', op: opts.op ?? 'video', assetId: aid, status: 'approved', jobId: opts.jobId ?? null, label: 'A clip', meta: opts.meta ?? {} })
  return { id, assetId: aid }
}

let nano: { id: string; assetId: string }, gpt: { id: string; assetId: string }, upload: { id: string; assetId: string }, crop: { id: string; assetId: string }
let old: { id: string; assetId: string }, wrens: { id: string; assetId: string }, take: { id: string; assetId: string }, uploadClip: { id: string; assetId: string }
let productId: string, productPost: string

beforeAll(async () => {
  h = await createHarness()
  callie = (await createCharacter(h.deps, h.ctx, { name: 'Callie' })).id
  wren = (await createCharacter(h.deps, h.ctx, { name: 'Wren' })).id
  nano = await still(callie, { jobId: await run({ model: 'higgsfield/nano-banana-2', billing: 'account', credits: 8.24 }), label: 'Kitchen' })
  gpt = await still(callie, { jobId: await run({ model: 'higgsfield/gpt-image-2.5', micros: 120_000 }) })
  upload = await still(callie, { op: 'upload_image', label: 'My photo' })
  crop = await still(callie, { op: 'crop', jobId: await run({ model: 'scene_crop', provider: 'local', kind: 'check' }) })
  old = await still(callie, { op: 'upload_image', label: 'Old one', at: new Date(h.clock.now().getTime() - 40 * DAY) })
  wrens = await still(wren, { op: 'upload_image', label: 'Wren photo' })
  take = await clip(callie, { jobId: await run({ model: 'higgsfield/kling-3.0-pro', kind: 'video', billing: 'account', credits: 30 }) })
  uploadClip = await clip(callie, { op: 'upload', meta: { poster: 'ast_poster0000000001' } })
  // Posts: one uses the Nano still and the take; an archived one uses the
  // GPT still (archived posts do not count); a product's post uses Wren's.
  await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, spec: { stillId: nano.id, clipId: take.id } })
  const archived = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, spec: { stillId: gpt.id } })
  await h.deps.db.update(contentItems).set({ archivedAt: h.clock.now() }).where(eq(contentItems.id, archived.id))
  productId = newId('prd')
  await h.deps.db.insert(products).values({ id: productId, accountId: h.ctx.accountId, name: 'SideStep' })
  productPost = (await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: wren, productId, spec: { stillIds: [wrens.id] } })).id
}, 60_000)
afterAll(async () => { await h.close() })

describe('the filter query on the server', () => {
  it('a plain call is unchanged: both lists, no facts', async () => {
    const r = await libraryView(h.deps, h.ctx)
    expect(r.models).toBeUndefined()
    expect(r.stills.every(s => s.used === undefined)).toBe(true)
    expect(ids(r)).toEqual([nano, gpt, upload, crop, old, wrens, take, uploadClip].map(x => x.id).sort())
  })

  it('type: only stills or only clips', async () => {
    const s = await libraryView(h.deps, h.ctx, { query: q({ type: 'still' }) })
    expect(s.clips).toEqual([])
    expect(s.stills).toHaveLength(6)
    const c = await libraryView(h.deps, h.ctx, { query: q({ type: 'clip' }) })
    expect(c.stills).toEqual([])
    expect(c.clips.map(x => x.id).sort()).toEqual([take.id, uploadClip.id].sort())
    // An uploaded clip's own first frame is its poster.
    expect(c.clips.find(x => x.id === uploadClip.id)!.posterId).toBe('ast_poster0000000001')
  })

  it('character', async () => {
    const r = await libraryView(h.deps, h.ctx, { query: q({ type: 'still', characterId: wren }) })
    expect(ids(r)).toEqual([wrens.id])
  })

  it('model: a model asked for, Uploaded, Made on the Studio; the choices list what made the tab', async () => {
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ type: 'still', model: 'higgsfield/nano-banana-2' }) }))).toEqual([nano.id])
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ type: 'still', model: 'upload' }) }))).toEqual([upload.id, old.id, wrens.id].sort())
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ type: 'still', model: 'studio' }) }))).toEqual([crop.id])
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ type: 'clip', model: 'higgsfield/kling-3.0-pro' }) }))).toEqual([take.id])
    const { models } = await libraryView(h.deps, h.ctx, { query: q({ type: 'still' }) })
    expect(models!.map(m => m.id)).toEqual(expect.arrayContaining(['higgsfield/nano-banana-2', 'higgsfield/gpt-image-2.5', 'upload', 'studio']))
    expect(models!.map(m => m.id)).not.toContain('higgsfield/kling-3.0-pro')
    expect(models!.slice(-2).map(m => m.label)).toEqual(['Uploaded', 'Made on the Studio'])
  })

  it('date: from and to', async () => {
    const now = h.clock.now().getTime()
    const recent = await libraryView(h.deps, h.ctx, { query: q({ type: 'still', from: new Date(now - 30 * DAY).toISOString() }) })
    expect(ids(recent)).not.toContain(old.id)
    expect(recent.stills).toHaveLength(5)
    const before = await libraryView(h.deps, h.ctx, { query: q({ type: 'still', to: new Date(now - 30 * DAY).toISOString() }) })
    expect(ids(before)).toEqual([old.id])
  })

  it('used or unused: by a live post (an archived post does not count), with each item\'s count', async () => {
    const used = await libraryView(h.deps, h.ctx, { query: q({ used: 'used' }) })
    expect(ids(used)).toEqual([nano.id, take.id, wrens.id].sort())
    expect(used.stills.find(s => s.id === nano.id)!.used).toBe(1)
    const unused = await libraryView(h.deps, h.ctx, { query: q({ type: 'still', used: 'unused' }) })
    expect(ids(unused)).toEqual([gpt.id, upload.id, crop.id, old.id].sort())
    expect(unused.stills.every(s => s.used === 0)).toBe(true)
  })

  it('used counts a saved editor timeline too, read once and kept', async () => {
    const project = await saveAsset(h.deps, h.ctx, { data: Buffer.from(JSON.stringify({ studioMedia: { a: upload.assetId } })), mime: 'application/json', origin: 'derived' })
    const post = await createContent(h.deps, h.ctx, { kind: 'meme', characterId: callie, spec: { editor: { projectAssetId: project.id, savedAt: null, stack: null } } })
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ type: 'still', used: 'used' }) }))).toContain(upload.id)
    // The second time the file is not read again.
    const reads: string[] = []
    const watched = { ...h.deps, store: { ...h.deps.store, get: async (k: string) => { reads.push(k); return h.deps.store.get(k) } } }
    expect(ids(await libraryView(watched, h.ctx, { query: q({ type: 'still', used: 'used' }) }))).toContain(upload.id)
    expect(reads).toEqual([])
    await h.deps.db.update(contentItems).set({ archivedAt: h.clock.now() }).where(eq(contentItems.id, post.id))
  })

  it('product: made in or used by a post of that product', async () => {
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ product: productId }) }))).toEqual([wrens.id])
    const own = await still(wren, { op: 'slide_topic', jobId: await run({ model: 'higgsfield/nano-banana-2' }), meta: { slideshow: productPost } })
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ product: productId }) }))).toEqual([wrens.id, own.id].sort())
  })

  it('filters combine', async () => {
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ type: 'still', characterId: callie, model: 'upload', used: 'unused', from: new Date(h.clock.now().getTime() - 7 * DAY).toISOString() }) }))).toEqual([upload.id])
  })

  it('a query that does not read is refused in plain words', () => {
    expect(() => q({ type: 'gif' })).toThrow('The type is a still or a clip.')
    expect(() => q({ used: 'maybe' })).toThrow(/Used is/)
    expect(() => q({ from: 'yesterday' })).toThrow('The start date does not read.')
    expect(() => q({ from: '2026-10-10T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toThrow('The start date is after the end date.')
    expect(() => q({ set: 'x' })).toThrow('That collection does not exist.')
  })
})

describe('the viewer\'s facts for one item', () => {
  it('a run on the plan: the model and its credits; the posts that use it', async () => {
    const v = await libraryItem(h.deps, h.ctx, nano.id)
    expect(v).toMatchObject({ name: 'Kitchen', media: 'image', characterName: 'Callie', model: 'Nano Banana 2', cost: '8.24 credits', costNote: 'Your Higgsfield plan, the price quoted' })
    expect(v.usedIn).toHaveLength(1)
    expect(v.usedIn[0]!.name).toBe('Untitled post')
  })

  it('a run on the API: dollars; an archived post is not listed', async () => {
    const v = await libraryItem(h.deps, h.ctx, gpt.id)
    expect(v.cost).toMatch(/^\$0\.12/)
    expect(v.costNote).toBe('Higgsfield API, the price quoted')
    expect(v.usedIn).toEqual([])
  })

  it('uploads and local renders are free; a demo run says so', async () => {
    expect(await libraryItem(h.deps, h.ctx, upload.id)).toMatchObject({ model: 'Uploaded', cost: 'Free (uploaded)' })
    expect(await libraryItem(h.deps, h.ctx, crop.id)).toMatchObject({ model: 'Made on the Studio', cost: 'Free (made on the Studio)' })
    const demo = await still(callie, { jobId: await run({ model: 'higgsfield/nano-banana-2', provider: 'mock' }) })
    expect(await libraryItem(h.deps, h.ctx, demo.id)).toMatchObject({ cost: 'Free (demo)', costNote: null })
    expect(await libraryItem(h.deps, h.ctx, take.id)).toMatchObject({ media: 'video', cost: '30 credits', durationSec: 5 })
  })

  it('another account\'s item is not found', async () => {
    const other = await h.newAccount('Other')
    await expect(libraryItem(h.deps, other, nano.id)).rejects.toThrow('That item is not in your Library any more.')
  })
})

describe('collections, stored per account', () => {
  it('add by a new name, then by id; the filter shows only its items; counts', async () => {
    const a = await addToCollection(h.deps, h.ctx, { name: '  Launch   week ', items: [nano.id, take.id] })
    expect(a).toMatchObject({ name: 'Launch week', added: 2, created: true })
    expect(a.id).toMatch(/^col_/)
    // The same name (any case) adds to it; an item already in it stays once.
    const b = await addToCollection(h.deps, h.ctx, { name: 'launch WEEK', items: [take.id, upload.id] })
    expect(b).toMatchObject({ id: a.id, added: 1, created: false })
    expect(await collectionItemIds(h.deps, h.ctx, a.id)).toEqual([nano.id, take.id, upload.id])
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ set: a.id }) }))).toEqual([nano.id, take.id, upload.id].sort())
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ type: 'clip', set: a.id }) }))).toEqual([take.id])
    expect((await libraryItem(h.deps, h.ctx, nano.id)).collections).toEqual([{ id: a.id, name: 'Launch week' }])
    await addToCollection(h.deps, h.ctx, { name: 'Faves', items: [gpt.id] })
    expect((await listCollections(h.deps, h.ctx)).map(c => [c.name, c.count])).toEqual([['Faves', 1], ['Launch week', 3]])
  })

  it('a trashed item leaves the view and the count, and comes back with Restore', async () => {
    const [col] = (await listCollections(h.deps, h.ctx)).filter(c => c.name === 'Faves')
    const { ids: t } = await trash(h.deps, h.ctx, [{ kind: 'candidate', id: gpt.id }])
    expect((await listCollections(h.deps, h.ctx)).find(c => c.id === col!.id)!.count).toBe(0)
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ set: col!.id }) }))).toEqual([])
    await restore(h.deps, h.ctx, t)
    expect(ids(await libraryView(h.deps, h.ctx, { query: q({ set: col!.id }) }))).toEqual([gpt.id])
  })

  it('remove from a collection, rename, and delete: the items stay in the Library', async () => {
    const col = (await listCollections(h.deps, h.ctx)).find(c => c.name === 'Launch week')!
    expect(await removeFromCollection(h.deps, h.ctx, col.id, [upload.id])).toEqual({ removed: 1 })
    expect(await collectionItemIds(h.deps, h.ctx, col.id)).toEqual([nano.id, take.id])
    await renameLibraryCollection(h.deps, h.ctx, col.id, 'Week one')
    await expect(renameLibraryCollection(h.deps, h.ctx, col.id, 'faves')).rejects.toThrow('There is already a collection called "Faves".')
    await expect(renameLibraryCollection(h.deps, h.ctx, col.id, '   ')).rejects.toThrow('Type a name for the collection.')
    await deleteLibraryCollection(h.deps, h.ctx, col.id)
    expect((await listCollections(h.deps, h.ctx)).map(c => c.name)).toEqual(['Faves'])
    // Deleting a collection never deletes its items.
    const all = ids(await libraryView(h.deps, h.ctx))
    for (const x of [nano, take, upload]) expect(all).toContain(x.id)
    const [row] = await h.deps.db.select().from(candidates).where(eq(candidates.id, nano.id))
    expect(row!.status).toBe('approved')
    await expect(collectionItemIds(h.deps, h.ctx, col.id)).rejects.toThrow('That collection does not exist any more.')
  })

  it('only the account\'s own items go in; another account sees none of them', async () => {
    const other = await h.newAccount('Other studio')
    await expect(addToCollection(h.deps, other, { name: 'Mine', items: [nano.id] })).rejects.toThrow('One of those items is not in your Library.')
    expect(await listCollections(h.deps, other)).toEqual([])
    expect((await readCollections(h.deps, h.ctx)).list).toHaveLength(1)
  })
})
