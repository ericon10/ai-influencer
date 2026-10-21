import { expect, test } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// Line lint (owner, 2026-10-22; UX-PLAN.md section 35, item 5), like a user:
// on every post, any product, a video's on-screen line and a slideshow's
// slide 1 get a free note when they open on the setup instead of the hit,
// or carry no clear emotion. Shown under the field, never blocking.

test('a video post\'s on-screen line: setup first and no emotion are flagged; a line with the hit up front reads clean', async ({ page }, info) => {
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: seedData().callie, accountTag: 'callie.tiktok', productId: null, step: 'text', spec: { caption: 'Furious that the recruiter ghosted me after round four' } })
  await page.goto(`/studio/posts/${id}`)
  const caption = page.getByLabel('Caption', { exact: true })
  await expect(caption).toHaveValue(/Furious/, { timeout: 30_000 })
  const notes = page.locator('[data-field="hook-lint"]')
  await expect(notes).toHaveCount(0)
  await caption.fill('So I went to the third interview on Tuesday')
  await expect(notes).toContainText('Opens on the setup ("So...")')
  await expect(notes).toContainText('No clear emotion')
  await snap(page, info, 'the line lint under the on-screen line')
  await caption.fill('Infuriated: the third interview was a group quiz')
  await expect(notes).toHaveCount(0)
})

test('a slideshow\'s slide 1 gets the same notes; slides 2 to 6 do not', async ({ page }) => {
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId: seedData().callie, accountTag: 'callie.tiktok', productId: null, step: 'text', spec: { hook: 'Story time about my last job interview', slides: ['The recruiter said circle back', 'They never did'] } })
  await page.goto(`/studio/posts/${id}`)
  await expect(page.locator('[data-field="slide-lint-0"]')).toContainText('Opens on the setup', { timeout: 30_000 })
  await expect(page.locator('[data-field="slide-lint-0"]')).toContainText('No clear emotion')
  await expect(page.locator('[data-field="slide-lint-1"]')).toHaveCount(0)
})
