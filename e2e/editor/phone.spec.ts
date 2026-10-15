import { expect, test } from '@playwright/test'
import { CAPTION, captionBlock, framePoint, inlineEditor, openEditor, presetCard, seedPost, snap } from './helpers'

// The editor at phone width, by touch (editor QA, 2026-10-15). The audit
// found the bottom tabs (Timeline, Media, Edit, AI) pushed off the screen,
// so the presets and the inspector could not be reached.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test('phone: tabs on screen, presets and inspector reachable, captions tap to select and double-tap to edit', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const nav = page.getByRole('navigation', { name: 'Editor workspace' })
  const box = (await nav.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(844 + 1)
  await snap(page, info, 'phone: timeline')

  await nav.getByRole('button', { name: 'Media' }).tap()
  await expect(presetCard(page, 'Each word lights up as it is said.')).toBeVisible()
  await snap(page, info, 'phone: presets')

  await nav.getByRole('button', { name: 'Timeline' }).tap()
  const p = await framePoint(page, 0.5, 0.26)
  await page.touchscreen.tap(p.x, p.y)
  await nav.getByRole('button', { name: 'Edit' }).tap()
  await expect(page.locator('#editor-panel-inspector').getByText('No selection', { exact: true })).toBeHidden()
  await snap(page, info, 'phone: caption in the inspector')

  await nav.getByRole('button', { name: 'Timeline' }).tap()
  const q = await framePoint(page, 0.5, 0.26)
  await page.touchscreen.tap(q.x, q.y)
  await page.waitForTimeout(60)
  await page.touchscreen.tap(q.x, q.y)
  await expect(inlineEditor(page)).toBeVisible()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('typed on a phone')
  await page.keyboard.press('Enter')
  await expect(captionBlock(page, 'typed on a phone')).toBeVisible()
  await expect(captionBlock(page, CAPTION)).toHaveCount(0)
  await snap(page, info, 'phone: caption edited')
})
