// Collections (UX-PLAN.md section 34): named sets of Library items (stills
// and clips, of any character), stored per account as one setting. These
// are the pure operations; `server/pipeline/collections.ts` reads and
// writes the setting and checks the items are the account's. Deleting a
// collection or taking an item out of one never touches the item itself.

export interface LibraryCollection {
  id: string
  name: string
  // Item ids (stills and clips are candidates), oldest first.
  items: string[]
  createdAt: string
  updatedAt: string
}
export interface CollectionsState { list: LibraryCollection[] }

export const EMPTY_COLLECTIONS: CollectionsState = { list: [] }
export const MAX_COLLECTIONS = 200
export const MAX_ITEMS = 2000
export const MAX_NAME = 60

export class CollectionError extends Error {}

// A name as typed: trimmed, inner spaces collapsed, at most 60 characters.
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim()
}
const same = (a: string, b: string) => a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US')
export const findByName = (state: CollectionsState, name: string) => state.list.find(c => same(c.name, cleanName(name))) ?? null
export const findById = (state: CollectionsState, id: string) => state.list.find(c => c.id === id) ?? null

// A setting read back from storage: anything that does not read is left out.
export function readState(value: unknown): CollectionsState {
  const list = (value as { list?: unknown } | null)?.list
  if (!Array.isArray(list)) return { list: [] }
  return {
    list: list.filter((c): c is LibraryCollection => !!c && typeof (c as LibraryCollection).id === 'string' && typeof (c as LibraryCollection).name === 'string' && Array.isArray((c as LibraryCollection).items))
      .map(c => ({ id: c.id, name: c.name, items: c.items.filter(x => typeof x === 'string'), createdAt: c.createdAt ?? '', updatedAt: c.updatedAt ?? c.createdAt ?? '' })),
  }
}

// Adds items to a collection named by id, or by name (a new one when no
// collection has that name). Items already in it stay where they are.
export function addItems(state: CollectionsState, target: { id?: string | null; name?: string | null }, items: string[], now: string, makeId: () => string): { state: CollectionsState; collection: LibraryCollection; added: number; created: boolean } {
  let col = target.id ? findById(state, target.id) : null
  if (target.id && !col) throw new CollectionError('That collection does not exist any more.')
  let created = false
  if (!col) {
    const name = cleanName(target.name ?? '')
    if (!name) throw new CollectionError('Type a name for the collection.')
    col = findByName(state, name)
    if (!col) {
      if (state.list.length >= MAX_COLLECTIONS) throw new CollectionError(`You have ${MAX_COLLECTIONS} collections, the most there can be. Delete one first.`)
      col = { id: makeId(), name, items: [], createdAt: now, updatedAt: now }
      created = true
    }
  }
  const have = new Set(col.items)
  const fresh = [...new Set(items)].filter(x => !have.has(x))
  if (col.items.length + fresh.length > MAX_ITEMS) throw new CollectionError(`A collection holds up to ${MAX_ITEMS} items; "${col.name}" has ${col.items.length}.`)
  const next = { ...col, items: [...col.items, ...fresh], updatedAt: fresh.length || created ? now : col.updatedAt }
  return { state: { list: created ? [...state.list, next] : state.list.map(c => (c.id === next.id ? next : c)) }, collection: next, added: fresh.length, created }
}

// Takes items out of a collection (the items themselves stay in the Library).
export function removeItems(state: CollectionsState, id: string, items: string[], now: string): { state: CollectionsState; removed: number } {
  const col = findById(state, id)
  if (!col) throw new CollectionError('That collection does not exist any more.')
  const out = new Set(items)
  const kept = col.items.filter(x => !out.has(x))
  const removed = col.items.length - kept.length
  return { state: { list: state.list.map(c => (c.id === id ? { ...c, items: kept, updatedAt: removed ? now : c.updatedAt } : c)) }, removed }
}

export function renameCollection(state: CollectionsState, id: string, name: string, now: string): CollectionsState {
  const col = findById(state, id)
  if (!col) throw new CollectionError('That collection does not exist any more.')
  const clean = cleanName(name)
  if (!clean) throw new CollectionError('Type a name for the collection.')
  const other = findByName(state, clean)
  if (other && other.id !== id) throw new CollectionError(`There is already a collection called "${other.name}".`)
  return { list: state.list.map(c => (c.id === id ? { ...c, name: clean, updatedAt: now } : c)) }
}

// The collection goes; its items stay in the Library.
export function deleteCollection(state: CollectionsState, id: string): CollectionsState {
  if (!findById(state, id)) throw new CollectionError('That collection does not exist any more.')
  return { list: state.list.filter(c => c.id !== id) }
}

export const collectionsOf = (state: CollectionsState, itemId: string) => state.list.filter(c => c.items.includes(itemId))

// The list as the page shows it: by name.
export const byName = (state: CollectionsState) => [...state.list].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }))
