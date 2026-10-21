import { expect, test } from '@playwright/test'
import { api, seedData, seedPost, snap } from './helpers'

// The Oct 22 follow-ups (UX-PLAN.md section 35), clicked like a person:
// Build refs on a character's sheet (REF-12 and REF-13 join the shots),
// Finished damage on a person's video post (the Video step's take filled
// in at 7 s), and a faceless post's Sound drawer (the sound and the
// voiceover words with Copy, PlayPhrase.me and GetYarn.io searches in a
// new tab with the words filled in, nothing fetched).

test('Build refs: REF-12 and REF-13 join the sheet, and leave it again', async ({ page }, info) => {
  const { callie } = seedData()
  await page.goto(`/studio/characters/${callie}?tab=sheet`)
  const sw = page.locator('[data-field="build-refs"]').getByRole('switch', { name: 'Build refs' })
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  const tiles = page.locator('.st-grid.sheet .st-tile')
  await expect(tiles.filter({ hasText: 'REF-12' })).toHaveCount(0)
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(tiles.filter({ hasText: 'REF-12' })).toHaveCount(1)
  await expect(tiles.filter({ hasText: 'REF-13' })).toHaveCount(1)
  await snap(page, info, 'Build refs on: REF-12 and REF-13 in the sheet')
  // Put the seeded character back.
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expect(tiles.filter({ hasText: 'REF-12' })).toHaveCount(0)
})

test('Finished damage on a person\'s post fills the Video step with a 7 s just-existing take', async ({ page }, info) => {
  const post = await seedPost()
  // No take picked yet, so the Video step opens on the take to make.
  await api('PATCH', `/content/${post}`, { spec: { clipId: null } })
  await page.goto(`/studio/posts/${post}`)
  const box = page.locator('[data-field="finished-damage"]')
  const sw = box.getByRole('switch', { name: 'Finished damage' })
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(box).toContainText('Left:')
  await expect(box).toContainText('the 7 s just-existing take')
  // Open the Video step: its take is filled in at 7 s.
  await page.getByRole('button', { name: 'Video', exact: true }).first().click()
  await expect(page.locator('.st-chip.on', { hasText: /^7 s$/ }).first()).toBeVisible({ timeout: 30_000 })
  await snap(page, info, 'Finished damage on: what is left, the take at 7 s')
  await expect.poll(async () => (await api<{ item: { spec: { recipe?: string } } }>('GET', `/content/${post}`)).item.spec.recipe, { timeout: 15_000 }).toBe('finished_damage')
})

test('the Sound drawer: the sound and the voiceover words with Copy, and quote searches in a new tab', async ({ page }, info) => {
  const tag = Date.now().toString(36).slice(-5)
  const { id } = await api<{ id: string }>('POST', '/characters', { name: `Doug sound ${tag}`, kind: 'faceless', template: 'doug' })
  const { id: post } = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: id, accountTag: `dougsound${tag}`, spec: { caption: 'they replaced me with a macro' } })
  await page.goto(`/studio/posts/${post}`)
  await page.locator('[data-field="faceless-sound"] button[aria-expanded]').click()
  const name = page.getByRole('combobox', { name: 'Sound name' })
  await name.fill('Sad piano bed')
  await expect(page.getByRole('button', { name: 'Copy the sound name' })).toBeEnabled()
  const words = page.getByRole('textbox', { name: 'Voiceover search words' })
  const play = page.locator('[data-field="search-PlayPhrase.me"]')
  await expect(play).toHaveCount(0)
  await words.fill('it is what it is')
  await expect(page.getByRole('button', { name: 'Copy the voiceover search words' })).toBeEnabled()
  await expect(play).toHaveAttribute('href', 'https://www.playphrase.me/#/search?q=it%20is%20what%20it%20is')
  await expect(play).toHaveAttribute('target', '_blank')
  const yarn = page.locator('[data-field="search-GetYarn.io"]')
  await expect(yarn).toHaveAttribute('href', 'https://getyarn.io/yarn-find?text=it%20is%20what%20it%20is')
  await expect(yarn).toHaveAttribute('target', '_blank')
  // A click opens a new tab (stopped before it leaves for the site).
  await page.context().route(/playphrase\.me/, r => r.fulfill({ status: 200, body: 'ok' }))
  const [tab] = await Promise.all([page.context().waitForEvent('page'), play.click()])
  expect(tab.url()).toContain('playphrase.me')
  await tab.close()
  await snap(page, info, 'the Sound drawer: name, words, Copy, the two searches')
  // The export notes it: "Add this sound in the app".
  await expect.poll(async () => (await api<{ item: { spec: { faceless?: { voiceover?: { search?: string } } } } }>('GET', `/content/${post}`)).item.spec.faceless?.voiceover?.search, { timeout: 15_000 }).toBe('it is what it is')
})
