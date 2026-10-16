import { expect, test, type Locator, type Page } from '@playwright/test'
import { api } from './helpers'

// A new post tapped before the characters have loaded waits for them; it
// never reads "still loading" as "no characters" (found 2026-10-16: on a
// busy server a phone landed on Characters instead of the new post).

const press = (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

async function earlyTap(page: Page, phone: boolean) {
  // The characters arrive 3 seconds late.
  await page.route(/\/api\/v1\/characters(\?.*)?$/, async r => {
    if (r.request().method() !== 'GET') return r.fallback()
    await new Promise(res => setTimeout(res, 3000))
    await r.fallback()
  })
  await page.goto('/studio')
  const go = page.getByRole('button', { name: 'Video post', exact: true }).first()
  await press(go, phone)
  // The button shows it is working while it waits.
  await expect(go).toBeDisabled({ timeout: 2000 })
  await page.waitForURL(/\/studio\/posts\/cnt_/, { timeout: 30_000 })
  expect(page.url()).not.toContain('/studio/characters')
  const id = page.url().match(/cnt_[a-z0-9]+/)![0]
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await api('DELETE', `/content/${id}`)
}

test('Video post tapped before the characters load still opens a new post', async ({ page }) => { await earlyTap(page, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: Video post tapped before the characters load still opens a new post', async ({ page }) => { await earlyTap(page, true) })
})
