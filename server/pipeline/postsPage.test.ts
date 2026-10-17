import { beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../testing/harness.js'
import { registerPipelineHooks } from './hooks.js'
import { createCharacter } from './characters.js'
import { LIST_SIZE, contentPage, contentView, createContent, updateContent } from './content.js'

// Posts home past the newest 200 (owner, 2026-10-17): the list holds the
// newest 200 posts; Show older posts pages past them, with the account and
// character filters applied on the server, so every post stays reachable.

let h: Harness
let a: string
let b: string
const ids: string[] = []

beforeAll(async () => {
  registerPipelineHooks()
  h = await createHarness()
  a = (await createCharacter(h.deps, h.ctx, { name: 'Ava' })).id
  b = (await createCharacter(h.deps, h.ctx, { name: 'Bea' })).id
  // 205 posts, oldest first; every 10th is on the "old.account" tag and Bea's.
  for (let i = 0; i < LIST_SIZE + 5; i++) {
    const tenth = i % 10 === 0
    const p = await createContent(h.deps, h.ctx, { kind: 'slideshow', characterId: tenth ? b : a, accountTag: tenth ? 'old.account' : 'main.account', idea: `post ${i}` })
    ids.push(p.id)
  }
}, 120_000)

describe('Posts home past 200 posts', () => {
  it('the list holds the newest 200 and says where older ones start; the chips come from every post', async () => {
    const v = await contentView(h.deps, h.ctx)
    expect(v.items).toHaveLength(LIST_SIZE)
    expect(v.next).toBe(v.items[LIST_SIZE - 1]!.id)
    expect(v.accountTags.sort()).toEqual(['main.account', 'old.account'])
    expect(v.characterIds.sort()).toEqual([a, b].sort())
  })

  it('Show older posts: each page starts right after the last post shown, until every post is reached once', async () => {
    const v = await contentView(h.deps, h.ctx)
    const seen = v.items.map(i => i.id)
    let next = v.next
    while (next) {
      const page = await contentPage(h.deps, h.ctx, { before: next, limit: 2 })
      seen.push(...page.items.map(i => i.id))
      next = page.next
    }
    expect(seen).toHaveLength(ids.length)
    expect(new Set(seen).size).toBe(ids.length)
    // Newest first: the reverse of the order they were made in.
    expect(seen).toEqual([...ids].reverse())
  })

  it('a filter applies on the server: older posts of one account or character are found', async () => {
    const v = await contentView(h.deps, h.ctx)
    const listed = v.items.filter(i => i.accountTag === 'old.account').length
    const older = await contentPage(h.deps, h.ctx, { before: v.next, accountTag: 'old.account', limit: 200 })
    expect(older.items.every(i => i.accountTag === 'old.account')).toBe(true)
    expect(listed + older.items.length).toBe(21)
    expect(older.next).toBeNull()
    const bea = await contentPage(h.deps, h.ctx, { before: v.next, characterId: b, limit: 200 })
    expect(bea.items.every(i => i.characterId === b)).toBe(true)
    expect(bea.items.map(i => i.id)).toEqual(older.items.map(i => i.id))
  })

  it('a post changed since moves to the top of the list; pages stay in order', async () => {
    const oldest = ids[0]!
    // (A new post takes the database's time; an edit takes the clock's.)
    h.clock.set(new Date(Date.now() + 60_000))
    await updateContent(h.deps, h.ctx, oldest, { title: 'Back on top' })
    const v = await contentView(h.deps, h.ctx)
    expect(v.items[0]!.id).toBe(oldest)
    const page = await contentPage(h.deps, h.ctx, { before: v.next, limit: 200 })
    expect(page.items.map(i => i.id)).not.toContain(oldest)
    expect(v.items.length + page.items.length).toBe(ids.length)
  })
})
