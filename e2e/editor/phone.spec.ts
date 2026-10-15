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

// A finger drag, sent as real touch events (Playwright's touchscreen only taps).
async function touchDrag(page: import('@playwright/test').Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page)
  const pt = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) })
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('phone: drag a caption with a finger to move it, and resize it', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const p = await framePoint(page, 0.5, 0.26)
  await page.touchscreen.tap(p.x, p.y)
  const box = page.locator('[data-studio="text-box"]')
  await expect(box).toBeVisible()
  const b = (await box.boundingBox())!
  // The middle of the caption (its move dot): the handles sit outside it.
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await touchDrag(page, from, { x: from.x, y: from.y + 60 })
  await page.waitForTimeout(400)
  const a = (await box.boundingBox())!
  expect(a.y - b.y).toBeGreaterThan(35)
  await snap(page, info, 'phone: caption dragged down')
  // And bigger from its corner handle (just outside the box).
  await touchDrag(page, { x: a.x + a.width + 8, y: a.y + a.height + 8 }, { x: a.x + a.width + 20, y: a.y + a.height + 12 })
  await page.waitForTimeout(400)
  const c = (await box.boundingBox())!
  // At phone width it already fills the frame's width, so bigger text wraps
  // taller: the box's area grows.
  expect(c.width * c.height).toBeGreaterThan(a.width * a.height * 1.3)
  await snap(page, info, 'phone: caption made bigger')
})

test('phone: a freeze marker opens the Edit tab with the Speed panel', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const nav = page.getByRole('navigation', { name: 'Editor workspace' })
  await nav.getByRole('button', { name: 'Media' }).tap()
  await presetCard(page, 'Holds the frame for a beat (add a text pop or the record scratch).').tap()
  await nav.getByRole('button', { name: 'Timeline' }).tap()
  const marker = page.locator('[data-studio-marker="freeze"]')
  await expect(marker).toHaveCount(1)
  await marker.tap()
  const curves = page.locator('#editor-panel-inspector').getByRole('button', { name: /Speed Curves/ }).first()
  await expect(curves).toBeVisible()
  await expect(curves).toHaveAttribute('aria-expanded', 'true')
  await snap(page, info, 'phone: the Speed panel from the marker')
})
