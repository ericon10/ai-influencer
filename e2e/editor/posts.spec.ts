import { expect, test } from '@playwright/test'
import { allPosts, api, seedData, snap } from './helpers'

// Posts home past the newest 200 posts (owner, 2026-10-17): Show older
// posts loads more, and a filter applies to the older pages too, so every
// post stays reachable. Makes posts (free drafts) until there are more than
// 200, so the older pages always have something on them.

test('Posts home: Show older posts pages past the newest 200, and a filter finds an older post', async ({ page }, info) => {
  test.setTimeout(180_000)
  const have = (await allPosts()).length
  for (let i = have; i < 230; i += 10) {
    await Promise.all(Array.from({ length: Math.min(10, 230 - i) }, (_, k) => api('POST', '/content', { kind: 'meme', characterId: seedData().callie, accountTag: 'e2e.older', title: `An older post ${i + k + 1}`, idea: 'an older post' })))
  }
  const first = await api<{ items: { id: string }[]; next: string | null }>('GET', '/content')
  expect(first.next, 'more than 200 posts').toBeTruthy()
  await page.goto('/studio')
  const cards = page.locator('.st-postcard-name')
  await expect(cards).toHaveCount(200, { timeout: 30_000 })
  const older = page.locator('[data-field="posts-older"]')
  await older.scrollIntoViewIfNeeded()
  await snap(page, info, 'Show older posts under the newest 200')
  await older.getByRole('button', { name: 'Show older posts' }).click()
  await expect.poll(async () => cards.count(), { timeout: 30_000 }).toBeGreaterThan(200)

  // The oldest post, found through its account's filter and the older pages.
  const all = await allPosts<{ id: string; accountTag: string }>()
  const oldest = [...all].reverse().find(p => p.accountTag)!
  await page.reload()
  await page.getByRole('button', { name: oldest.accountTag, exact: true }).first().click()
  const link = page.locator(`a.st-postcard-name[href="/studio/posts/${oldest.id}"]`)
  for (let i = 0; i < 20 && !(await link.count()); i++) {
    const more = page.locator('[data-field="posts-older"]').getByRole('button', { name: 'Show older posts' })
    if (!(await more.isVisible().catch(() => false))) break
    await more.click()
    await page.waitForTimeout(800)
  }
  await expect(link).toBeVisible({ timeout: 20_000 })
  await link.scrollIntoViewIfNeeded()
  await snap(page, info, 'the oldest post of an account, found with its filter')
})
