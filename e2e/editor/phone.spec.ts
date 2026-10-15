import { expect, test } from '@playwright/test'
import { CAPTION, captionBlock, clipBlocks, frame, framePoint, inlineEditor, openEditor, presetCard, seedPost, snap, timeline } from './helpers'

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

// The usability fixes at phone width (owner, 2026-10-15), by touch.
test('phone: small caption handles outside the caption, no Locked button', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const p = await framePoint(page, 0.5, 0.26)
  await page.touchscreen.tap(p.x, p.y)
  const box = (await page.locator('[data-studio="text-box"]').boundingBox())!
  const handles = page.locator('[data-studio^="text-handle-"]')
  await expect(handles).toHaveCount(4)
  for (let i = 0; i < 4; i++) {
    const h = (await handles.nth(i).boundingBox())!
    // A finger-sized hit area that stays off the caption, with a small dot.
    expect(h.width).toBeGreaterThanOrEqual(20)
    const overlapX = Math.min(h.x + h.width, box.x + box.width) - Math.max(h.x, box.x)
    const overlapY = Math.min(h.y + h.height, box.y + box.height) - Math.max(h.y, box.y)
    expect(overlapX <= 1 || overlapY <= 1).toBeTruthy()
    expect((await handles.nth(i).locator('span').boundingBox())!.width).toBeLessThanOrEqual(12)
  }
  const nav = page.getByRole('navigation', { name: 'Editor workspace' })
  await nav.getByRole('button', { name: 'Edit' }).tap()
  await expect(page.getByRole('button', { name: /Lock aspect ratio|Unlock aspect ratio/ })).toHaveCount(0)
  await snap(page, info, 'phone: small handles, no Locked')
})

test('phone: a caption never grows taller than the frame', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const p = await framePoint(page, 0.5, 0.26)
  await page.touchscreen.tap(p.x, p.y)
  const box = page.locator('[data-studio="text-box"]')
  const b = (await box.boundingBox())!
  // A long pull on the corner handle, well past the bottom of the frame.
  await touchDrag(page, { x: b.x + b.width + 8, y: b.y + b.height + 8 }, { x: b.x + b.width + 40, y: b.y + b.height + 600 })
  await page.waitForTimeout(400)
  const f = await frame(page)
  const a = (await box.boundingBox())!
  expect(a.height).toBeGreaterThan(b.height)
  expect(a.height).toBeLessThanOrEqual(f.height + 2)
  await snap(page, info, 'phone: as big as the frame allows')
})

test('phone: a tap beside the frame clears the selection', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const p = await framePoint(page, 0.5, 0.26)
  await page.touchscreen.tap(p.x, p.y)
  await expect(page.locator('[data-studio="text-box"]')).toBeVisible()
  // A spot on the frame where nothing is.
  const q = await framePoint(page, 0.5, 0.9)
  await page.touchscreen.tap(q.x, q.y)
  await expect(page.locator('[data-studio="text-box"]')).toBeHidden()
  await snap(page, info, 'phone: nothing selected')
})

test('phone: the Studio names its tracks, and a shot shows its speed', async ({ page }, info) => {
  await openEditor(page, await seedPost({ music: true }), { mp3: true })
  for (const n of ['Captions', 'Shots', 'Music']) await expect(timeline(page).getByText(n, { exact: true }).first()).toBeAttached()
  await expect(timeline(page).getByText(/^Track \d+$/)).toHaveCount(0)
  await clipBlocks(page).first().tap()
  const nav = page.getByRole('navigation', { name: 'Editor workspace' })
  await nav.getByRole('button', { name: 'Edit' }).tap()
  const section = page.locator('#editor-panel-inspector').getByText('Speed & Direction', { exact: true })
  await section.scrollIntoViewIfNeeded()
  await section.tap()
  const set2x = page.getByRole('button', { name: 'Set speed to 2×' })
  await set2x.scrollIntoViewIfNeeded()
  await set2x.tap()
  await nav.getByRole('button', { name: 'Timeline' }).tap()
  await expect(timeline(page).locator('[data-studio="clip-speed"]').first()).toHaveText('2x')
  await snap(page, info, 'phone: named tracks, 2x on the shot')
})
