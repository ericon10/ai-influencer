import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { api, frame, openEditor, seedPost, snap } from './helpers'

// Long run part 4 (owner, 2026-10-15): Export for TikTok, Reels or Shorts,
// the cover, hook variants (one timeline, a different first 2 seconds),
// and the safe zones in the editor. Driven like a user; all free.

const press = async (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

async function openFinish(page: Page, post: string) {
  await page.goto(`/studio/posts/${post}?step=finish`)
  await page.locator('[data-field="post-timeline"]').waitFor({ timeout: 30_000 })
  await expect(page.locator('[data-field="export-for"]')).toBeVisible({ timeout: 20_000 })
}

async function finishExtras(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(600_000)
  const post = await seedPost({ caption: 'the payoff line' })
  await openFinish(page, post)

  // Export for: Shorts, its numbers on the line.
  await press(page.getByRole('radio', { name: 'Shorts' }), phone)
  await expect(page.locator('[data-field="export-preset-line"]')).toHaveText('Shorts: up to 60 s, 10 Mbps, -14 LUFS.')
  await page.waitForResponse(r => r.url().includes(`/content/${post}`) && r.request().method() === 'PATCH', { timeout: 10_000 }).catch(() => undefined)
  await press(page.getByRole('button', { name: /^Export MP4/ }), phone)
  await expect(page.locator('[data-field="export-made-for"]')).toContainText('Made for Shorts', { timeout: 240_000 })

  // The cover: a frame and its text.
  const cover = page.locator('[data-field="cover-card"]')
  await cover.scrollIntoViewIfNeeded()
  const slider = cover.getByRole('slider', { name: 'Cover frame' })
  await slider.focus()
  for (let i = 0; i < 20; i++) await slider.press('ArrowRight')
  await expect(cover.locator('[data-field="cover-at"]')).toHaveText('Frame at 1.00 s')
  await cover.getByRole('textbox', { name: /Cover text/ }).fill('day 1 of trying')
  await press(cover.getByRole('button', { name: /Make the cover/ }), phone)
  await expect(cover.locator('[data-field="cover-result"] img')).toBeVisible({ timeout: 60_000 })
  await expect(cover.locator('[data-field="cover-result"]')).toContainText('At 1.00 s: day 1 of trying')
  await snap(page, info, phone ? 'phone: the cover' : 'the cover')

  // Hook variants: A and B change the words, B also opens with a crash
  // zoom, C opens on another shot.
  const hooks = page.locator('[data-field="hook-variants"]')
  await hooks.scrollIntoViewIfNeeded()
  await hooks.getByRole('textbox', { name: 'Hook A' }).fill('nobody warned me about this part')
  await hooks.getByRole('textbox', { name: 'Hook B' }).fill('day 1 of acting normal')
  await hooks.getByRole('combobox', { name: 'First edit B' }).selectOption({ label: 'Crash zoom cut' })
  const shotC = hooks.getByRole('combobox', { name: 'First shot C' })
  await expect(shotC.locator('optgroup')).not.toHaveCount(0, { timeout: 20_000 })
  const firstShot = await shotC.locator('option').nth(1).textContent()
  await shotC.selectOption({ index: 1 })
  const go = hooks.getByRole('button', { name: /Export 3 versions/ })
  await expect(go).toBeEnabled({ timeout: 10_000 })
  await press(go, phone)
  const results = hooks.locator('[data-field="hook-variant-results"] video')
  await expect(results).toHaveCount(3, { timeout: 400_000 })
  const list = hooks.locator('[data-field="hook-variant-results"]')
  await expect(list).toContainText('A. nobody warned me about this part')
  await expect(list).toContainText('B. day 1 of acting normal · First edit: Crash zoom cut')
  await expect(list).toContainText(`C. First shot: ${firstShot!.replace(/ \(still\)$/, '')}`)
  await expect(hooks.getByRole('link', { name: 'Download C' })).toBeVisible()
  await snap(page, info, phone ? 'phone: hook variants' : 'hook variants')
  // The post's own export is still there.
  const item = (await api<{ item: { outputs: { videoAssetId?: string; variants?: unknown[]; preset?: string } } }>('GET', `/content/${post}`)).item
  expect(item.outputs.videoAssetId).toBeTruthy()
  expect(item.outputs.preset).toBe('shorts')
  expect(item.outputs.variants).toHaveLength(3)
}

async function safeZones(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(300_000)
  const post = await seedPost()
  await openEditor(page, post)
  const pick = page.getByRole('combobox', { name: 'Safe zones' })
  await pick.selectOption('tiktok')
  const zones = page.locator('[data-studio="safe-zones"][data-app="tiktok"]')
  await expect(zones).toBeVisible()
  const bands = zones.locator('[data-studio-band]')
  await expect(bands).toHaveCount(3)
  // Every band sits on the frame.
  const f = await frame(page)
  for (let i = 0; i < 3; i++) {
    const b = (await bands.nth(i).boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(f.x - 2)
    expect(b.x + b.width).toBeLessThanOrEqual(f.x + f.width + 2)
    expect(b.y).toBeGreaterThanOrEqual(f.y - 2)
    expect(b.y + b.height).toBeLessThanOrEqual(f.y + f.height + 2)
  }
  await expect(zones).toContainText('TikTok: Buttons')
  await snap(page, info, phone ? 'phone: TikTok safe zones in the editor' : 'TikTok safe zones in the editor')
  await pick.selectOption('reels')
  await expect(page.locator('[data-studio="safe-zones"][data-app="reels"]')).toContainText('Reels: Caption and audio')
  // Remembered in this browser.
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Safe zones' })).toHaveValue('reels', { timeout: 120_000 })
  await page.getByRole('combobox', { name: 'Safe zones' }).selectOption('off')
  await expect(page.locator('[data-studio="safe-zones"]')).toHaveCount(0)
}

test('Export for Shorts, a cover with text, and three hook variants (words, a first edit, a first shot) from one timeline', async ({ page }, info) => { await finishExtras(page, info, false) })
test('the editor draws TikTok or Reels safe zones over the preview, remembered, never exported', async ({ page }, info) => { await safeZones(page, info, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: Export for, the cover and hook variants', async ({ page }, info) => { await finishExtras(page, info, true) })
  test('phone: safe zones in the editor', async ({ page }, info) => { await safeZones(page, info, true) })
})
