import { expect, test } from '@playwright/test'
import { CAPTION, captionBlock, clipBlocks, frame, framePoint, noSelection, openEditor, presetCard, seedPost, seek, snap, textBox, timeline } from './helpers'

// The usability fixes the owner picked from the editor audit (2026-10-15):
// small caption handles and no Locked button, a caption no taller than the
// frame, markers for freeze and speed ramp, a bigger preview, click away to
// deselect, named tracks and the speed on the clip.

test('caption handles: four small dots outside the caption, no Locked button', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 1)
  const p = await framePoint(page, 0.5, 0.26)
  await page.mouse.click(p.x, p.y)
  const box = (await textBox(page).boundingBox())!
  const handles = page.locator('[data-studio^="text-handle-"]')
  await expect(handles).toHaveCount(4)
  for (let i = 0; i < 4; i++) {
    const h = (await handles.nth(i).boundingBox())!
    // Finger-sized hit areas that stay off the caption.
    expect(h.width).toBeGreaterThanOrEqual(20)
    const overlapX = Math.min(h.x + h.width, box.x + box.width) - Math.max(h.x, box.x)
    const overlapY = Math.min(h.y + h.height, box.y + box.height) - Math.max(h.y, box.y)
    expect(overlapX <= 1 || overlapY <= 1).toBeTruthy()
    // The visible dot is small.
    const dot = (await handles.nth(i).locator('span').boundingBox())!
    expect(dot.width).toBeLessThanOrEqual(12)
  }
  await expect(page.getByRole('button', { name: /Lock aspect ratio|Unlock aspect ratio/ })).toHaveCount(0)
  await snap(page, info, 'small handles, no Locked')
})

test('a caption never grows taller than the frame', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 1)
  const p = await framePoint(page, 0.5, 0.26)
  await page.mouse.click(p.x, p.y)
  const b = (await textBox(page).boundingBox())!
  await page.mouse.move(b.x + b.width + 6, b.y + b.height + 6)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width + 420, b.y + b.height + 200, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const f = await frame(page)
  const after = (await textBox(page).boundingBox())!
  expect(after.height).toBeGreaterThan(b.height * 3)
  expect(after.height).toBeLessThanOrEqual(f.height + 2)
  await snap(page, info, 'as big as the frame allows')
})

test('freeze and speed ramp get a marker on the Presets track that opens the Speed panel', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 1)
  await presetCard(page, 'Holds the frame for a beat (add a text pop or the record scratch).').click()
  await seek(page, 3.5)
  await presetCard(page, 'Eases from full speed into slow motion for the moment.').click()
  const freeze = timeline(page).locator('[data-studio-marker="freeze"]')
  const ramp = timeline(page).locator('[data-studio-marker="ramp"]')
  await expect(freeze).toHaveCount(1)
  await expect(ramp).toHaveCount(1)
  await snap(page, info, 'markers on the Presets track')
  await ramp.click()
  await expect(noSelection(page)).toBeHidden()
  const curves = page.locator('#editor-panel-inspector').getByRole('button', { name: /Speed Curves/ }).first()
  await expect(curves).toHaveAttribute('aria-expanded', 'true')
  await snap(page, info, 'the Speed panel open from the marker')
})

test('the preview is bigger, and a click away clears the selection', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const f = await frame(page)
  // At 1440 x 900 the frame was 253 px tall before.
  expect(f.height).toBeGreaterThan(380)
  await seek(page, 1)
  const p = await framePoint(page, 0.5, 0.26)
  await page.mouse.click(p.x, p.y)
  await expect(textBox(page)).toBeVisible()
  // The empty stage beside the frame.
  await page.mouse.click(f.x - 60, f.y + f.height / 2)
  await expect(textBox(page)).toBeHidden()
  await expect(noSelection(page)).toBeVisible()
  // And a spot on the frame where nothing is.
  await page.mouse.click(p.x, p.y)
  await expect(textBox(page)).toBeVisible()
  const q = await framePoint(page, 0.5, 0.9)
  await page.mouse.click(q.x, q.y)
  await expect(textBox(page)).toBeHidden()
  await snap(page, info, 'bigger preview, nothing selected')
})

test('the Studio names its tracks, and a shot shows its speed', async ({ page }, info) => {
  await openEditor(page, await seedPost({ music: true, voice: true }), { mp3: true })
  const names = timeline(page)
  for (const n of ['Captions', 'Shots', 'Voice', 'Music']) await expect(names.getByText(n, { exact: true }).first()).toBeAttached()
  await expect(names.getByText(/^Track \d+$/)).toHaveCount(0)
  await expect(captionBlock(page, CAPTION).or(timeline(page).locator('[aria-label^="Select text clip"]').first())).toBeVisible()
  await clipBlocks(page).first().click()
  const section = page.locator('#editor-panel-inspector').getByText('Speed & Direction', { exact: true })
  await section.scrollIntoViewIfNeeded()
  await section.click()
  const set2x = page.getByRole('button', { name: 'Set speed to 2×' })
  await set2x.scrollIntoViewIfNeeded()
  await set2x.click()
  await expect(timeline(page).locator('[data-studio="clip-speed"]').first()).toHaveText('2x')
  await snap(page, info, 'named tracks, 2x on the shot')
})
