import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { candidates } from '../db/schema.js'
import type { Ctx, Deps } from '../context.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { CollectionError, addItems, byName, collectionsOf, deleteCollection, readState, removeItems, renameCollection, type CollectionsState } from '../core/collections.js'
import { getSetting, setSetting } from './settings.js'

// Collections (UX-PLAN.md section 34): named sets of Library items, stored
// per account in one setting (`library.collections`). An item is a still or
// a clip of the account (a candidate); trashed items stay in a collection
// and show again when restored. Deleting a collection never deletes items.

export const COLLECTIONS_KEY = 'library.collections'
export interface CollectionView { id: string; name: string; count: number; createdAt: string }

const GONE = ['trashed', 'purged']

export async function readCollections(deps: Deps, ctx: Ctx): Promise<CollectionsState> {
  return readState(await getSetting<unknown>(deps.db, ctx.accountId, COLLECTIONS_KEY, null))
}

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn() } catch (e) {
    if (e instanceof CollectionError) throw new AppError('bad_request', e.message)
    throw e
  }
}

// Each collection with how many of its items are in the Library now.
export async function listCollections(deps: Deps, ctx: Ctx): Promise<CollectionView[]> {
  const state = await readCollections(deps, ctx)
  const all = [...new Set(state.list.flatMap(c => c.items))]
  const live = new Set(all.length ? (await deps.db.select({ id: candidates.id }).from(candidates)
    .where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, all), notInArray(candidates.status, GONE)))).map(r => r.id) : [])
  return byName(state).map(c => ({ id: c.id, name: c.name, count: c.items.filter(x => live.has(x)).length, createdAt: c.createdAt }))
}

// The items of one collection (the Library's Collection filter).
export async function collectionItemIds(deps: Deps, ctx: Ctx, id: string): Promise<string[]> {
  const col = (await readCollections(deps, ctx)).list.find(c => c.id === id)
  if (!col) throw new AppError('not_found', 'That collection does not exist any more.')
  return col.items
}

export async function collectionNamesOf(deps: Deps, ctx: Ctx, itemId: string): Promise<Array<{ id: string; name: string }>> {
  return collectionsOf(await readCollections(deps, ctx), itemId).map(c => ({ id: c.id, name: c.name }))
}

// Only the account's own stills and clips go in.
async function ownItems(deps: Deps, ctx: Ctx, items: string[]): Promise<string[]> {
  const ids = [...new Set(items)]
  if (!ids.length) throw new AppError('bad_request', 'Pick at least one item.')
  const rows = await deps.db.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.accountId, ctx.accountId), inArray(candidates.id, ids)))
  if (rows.length !== ids.length) throw new AppError('bad_request', 'One of those items is not in your Library.')
  return ids
}

// Into a collection named by id, or by name (made when no collection has it).
export async function addToCollection(deps: Deps, ctx: Ctx, input: { id?: string | null; name?: string | null; items: string[] }): Promise<{ id: string; name: string; added: number; created: boolean }> {
  const items = await ownItems(deps, ctx, input.items)
  return wrap(async () => {
    const out = addItems(await readCollections(deps, ctx), { id: input.id, name: input.name }, items, deps.clock.now().toISOString(), () => newId('col'))
    await setSetting(deps, ctx, COLLECTIONS_KEY, out.state)
    return { id: out.collection.id, name: out.collection.name, added: out.added, created: out.created }
  })
}

export async function removeFromCollection(deps: Deps, ctx: Ctx, id: string, items: string[]): Promise<{ removed: number }> {
  return wrap(async () => {
    const out = removeItems(await readCollections(deps, ctx), id, items, deps.clock.now().toISOString())
    if (out.removed) await setSetting(deps, ctx, COLLECTIONS_KEY, out.state)
    return { removed: out.removed }
  })
}

export async function renameLibraryCollection(deps: Deps, ctx: Ctx, id: string, name: string): Promise<{ ok: true }> {
  return wrap(async () => {
    await setSetting(deps, ctx, COLLECTIONS_KEY, renameCollection(await readCollections(deps, ctx), id, name, deps.clock.now().toISOString()))
    return { ok: true as const }
  })
}

// The collection goes; its items stay where they are.
export async function deleteLibraryCollection(deps: Deps, ctx: Ctx, id: string): Promise<{ ok: true }> {
  return wrap(async () => {
    await setSetting(deps, ctx, COLLECTIONS_KEY, deleteCollection(await readCollections(deps, ctx), id))
    return { ok: true as const }
  })
}
