import { describe, expect, it } from 'vitest'
import { EMPTY_COLLECTIONS, MAX_ITEMS, addItems, byName, cleanName, collectionsOf, deleteCollection, readState, removeItems, renameCollection, type CollectionsState } from './collections.js'

// Collections (UX-PLAN.md section 34): the pure operations on the stored
// setting. Taking an item out or deleting a collection never touches the
// item; names are unique whatever their case.

let n = 0
const makeId = () => `col_test${String(++n).padStart(8, '0')}`
const NOW = '2026-10-17T12:00:00.000Z'
const LATER = '2026-10-17T13:00:00.000Z'

describe('collections', () => {
  it('a new name makes a collection; the same name in any case adds to it', () => {
    const a = addItems(EMPTY_COLLECTIONS, { name: '  Launch   week ' }, ['cand_a', 'cand_b', 'cand_a'], NOW, makeId)
    expect(a.created).toBe(true)
    expect(a.added).toBe(2)
    expect(a.collection).toMatchObject({ name: 'Launch week', items: ['cand_a', 'cand_b'], createdAt: NOW })
    const b = addItems(a.state, { name: 'LAUNCH WEEK' }, ['cand_b', 'cand_c'], LATER, makeId)
    expect(b).toMatchObject({ created: false, added: 1 })
    expect(b.state.list).toHaveLength(1)
    expect(b.collection.items).toEqual(['cand_a', 'cand_b', 'cand_c'])
    expect(b.collection.updatedAt).toBe(LATER)
  })

  it('by id; a missing id or an empty name is refused', () => {
    const a = addItems(EMPTY_COLLECTIONS, { name: 'Faves' }, ['cand_a'], NOW, makeId)
    expect(addItems(a.state, { id: a.collection.id }, ['cand_z'], NOW, makeId).collection.items).toEqual(['cand_a', 'cand_z'])
    expect(() => addItems(a.state, { id: 'col_gone0000' }, ['cand_z'], NOW, makeId)).toThrow('That collection does not exist any more.')
    expect(() => addItems(a.state, { name: '   ' }, ['cand_z'], NOW, makeId)).toThrow('Type a name for the collection.')
  })

  it('a collection holds up to the most items there can be', () => {
    const big = addItems(EMPTY_COLLECTIONS, { name: 'Big' }, Array.from({ length: MAX_ITEMS }, (_, i) => `cand_${i}`), NOW, makeId)
    expect(() => addItems(big.state, { name: 'Big' }, ['cand_more'], NOW, makeId)).toThrow(`A collection holds up to ${MAX_ITEMS} items`)
  })

  it('remove takes items out of the set only', () => {
    const a = addItems(EMPTY_COLLECTIONS, { name: 'Faves' }, ['cand_a', 'cand_b'], NOW, makeId)
    const r = removeItems(a.state, a.collection.id, ['cand_a', 'cand_x'], LATER)
    expect(r.removed).toBe(1)
    expect(r.state.list[0]!.items).toEqual(['cand_b'])
    expect(removeItems(r.state, a.collection.id, ['cand_x'], LATER).state.list[0]!.updatedAt).toBe(LATER)
  })

  it('rename: names stay unique (any case), never empty', () => {
    let s: CollectionsState = addItems(EMPTY_COLLECTIONS, { name: 'Faves' }, ['cand_a'], NOW, makeId).state
    const week = addItems(s, { name: 'Week' }, ['cand_b'], NOW, makeId)
    s = week.state
    expect(() => renameCollection(s, week.collection.id, 'faves', LATER)).toThrow('There is already a collection called "Faves".')
    expect(() => renameCollection(s, week.collection.id, ' ', LATER)).toThrow('Type a name for the collection.')
    // Renaming to its own name in another case is fine.
    s = renameCollection(s, week.collection.id, 'WEEK one', LATER)
    expect(byName(s).map(c => c.name)).toEqual(['Faves', 'WEEK one'])
  })

  it('delete: the set goes, nothing else', () => {
    const a = addItems(EMPTY_COLLECTIONS, { name: 'Faves' }, ['cand_a'], NOW, makeId)
    const b = addItems(a.state, { name: 'Other' }, ['cand_a'], NOW, makeId)
    const s = deleteCollection(b.state, a.collection.id)
    expect(s.list.map(c => c.name)).toEqual(['Other'])
    expect(collectionsOf(s, 'cand_a').map(c => c.name)).toEqual(['Other'])
    expect(() => deleteCollection(s, a.collection.id)).toThrow('That collection does not exist any more.')
  })

  it('a stored setting that does not read becomes no collections; names are cut to 60 characters', () => {
    expect(readState(null)).toEqual({ list: [] })
    expect(readState({ list: [{ id: 1 }, { id: 'col_x', name: 'X', items: ['cand_a', 3] }] }).list).toEqual([{ id: 'col_x', name: 'X', items: ['cand_a'], createdAt: '', updatedAt: '' }])
    expect(cleanName('a'.repeat(80))).toHaveLength(60)
  })
})
