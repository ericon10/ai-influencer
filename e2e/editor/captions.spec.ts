import { expect, test } from '@playwright/test'
import { CAPTION, captionBlock, captionBlocks, centerOf, countColor, deselect, frame, framePoint, inlineEditor, noSelection, openEditor, presetCard, ruler, seedPost, seek, snap, textBox } from './helpers'

// Captions in the editor, driven like a user (editor QA, 2026-10-15). The
// audit found captions could not be selected or edited in the preview, long
// ones ran off the frame and karaoke moved and lost them.

test.describe('captions', () => {
  let post: string
  test.beforeEach(async ({ page }) => {
    post = await seedPost()
    await openEditor(page, post)
    await seek(page, 1)
  })

  test('a click on the caption in the preview selects it', async ({ page }, info) => {
    await expect(noSelection(page)).toBeVisible()
    const p = await framePoint(page, 0.5, 0.26)
    await page.mouse.click(p.x, p.y)
    await expect(noSelection(page)).toBeHidden()
    await expect(textBox(page)).toBeVisible()
    // The box sits on the caption, inside the frame.
    const f = await frame(page)
    const box = (await textBox(page).boundingBox())!
    expect(box.y).toBeLessThan(p.y)
    expect(box.y + box.height).toBeGreaterThan(p.y)
    expect(box.x).toBeGreaterThanOrEqual(f.x - 2)
    expect(box.x + box.width).toBeLessThanOrEqual(f.x + f.width + 2)
    await snap(page, info, 'caption selected from the preview')
  })

  test('double-click in the preview edits the words in place', async ({ page }, info) => {
    const p = await framePoint(page, 0.5, 0.26)
    await page.mouse.dblclick(p.x, p.y)
    await expect(inlineEditor(page)).toBeVisible()
    await expect(inlineEditor(page)).toHaveValue(CAPTION)
    await snap(page, info, 'editing in place')
    await page.keyboard.press('Control+A')
    await page.keyboard.type('new words here')
    await page.keyboard.press('Enter')
    await expect(inlineEditor(page)).toBeHidden()
    await expect(captionBlock(page, 'new words here')).toBeVisible()
    // One undo step brings the old words back.
    await page.keyboard.press('Control+z')
    await expect(captionBlock(page, CAPTION)).toBeVisible()
    await snap(page, info, 'after the edit and undo')
  })

  test('double-click on the timeline block edits it; Escape cancels', async ({ page }, info) => {
    await captionBlock(page, CAPTION).dblclick()
    await expect(inlineEditor(page)).toBeVisible()
    await page.keyboard.type(' and more')
    await snap(page, info, 'editing from the timeline')
    await page.keyboard.press('Escape')
    await expect(inlineEditor(page)).toBeHidden()
    await expect(captionBlock(page, CAPTION)).toBeVisible()
    // Shift+Enter makes a second line; Enter saves.
    await captionBlock(page, CAPTION).dblclick()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('line two')
    await page.keyboard.press('Enter')
    await expect(captionBlocks(page).first()).toHaveAttribute('aria-label', `Select text clip ${CAPTION}\nline two`)
  })

  test('a long caption wraps inside the frame', async ({ page }, info) => {
    const long = 'when you finally fix the bug at 3am and realise you broke two other things in the process'
    await captionBlock(page, CAPTION).dblclick()
    await page.keyboard.press('Control+A')
    await page.keyboard.type(long)
    await page.keyboard.press('Enter')
    await captionBlock(page, long).click()
    await expect(textBox(page)).toBeVisible()
    const f = await frame(page)
    const box = (await textBox(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(f.x)
    expect(box.x + box.width).toBeLessThanOrEqual(f.x + f.width)
    // Several lines: much taller than it is wide per line.
    expect(box.height).toBeGreaterThan(f.height * 0.06)
    // The edges of the frame stay clear of the caption's white box (with
    // nothing selected, so the handles are not counted).
    await deselect(page)
    await expect(textBox(page)).toBeHidden()
    await page.waitForTimeout(500)
    const band = { y: box.y + 2, height: Math.max(4, box.height - 4) }
    const edge = Math.max(3, Math.round(f.width * 0.025))
    expect(await countColor(page, { x: f.x + 1, y: band.y, width: edge, height: band.height }, [255, 255, 255], 8)).toBeLessThan(edge * band.height * 0.2)
    expect(await countColor(page, { x: f.x + f.width - edge - 1, y: band.y, width: edge, height: band.height }, [255, 255, 255], 8)).toBeLessThan(edge * band.height * 0.2)
    await snap(page, info, 'long caption wrapped')
  })

  test('drag the caption in the preview to move it', async ({ page }, info) => {
    const p = await framePoint(page, 0.5, 0.26)
    await page.mouse.click(p.x, p.y)
    const before = await centerOf(textBox(page))
    await page.mouse.move(before.x + 30, before.y)
    await page.mouse.down()
    await page.mouse.move(before.x + 30, before.y + 90, { steps: 10 })
    await page.mouse.up()
    const after = await centerOf(textBox(page))
    expect(after.y - before.y).toBeGreaterThan(60)
    await snap(page, info, 'caption moved down')
    // One undo puts the whole drag back.
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    const back = await centerOf(textBox(page))
    expect(Math.abs(back.y - before.y)).toBeLessThan(3)
  })

  test('karaoke keeps the caption in place, lights its words and stays editable', async ({ page }, info) => {
    const p = await framePoint(page, 0.5, 0.26)
    await page.mouse.click(p.x, p.y)
    const before = await centerOf(textBox(page))
    await presetCard(page, 'Each word lights up as it is said.').click()
    await page.waitForTimeout(600)
    // Same caption, same place.
    await expect(captionBlock(page, CAPTION)).toBeVisible()
    // Selected from its block (a second click on the selected words would
    // edit them, owner 2026-10-22).
    await captionBlock(page, CAPTION).click()
    await expect(textBox(page)).toBeVisible()
    const after = await centerOf(textBox(page))
    expect(Math.abs(after.y - before.y)).toBeLessThan(4)
    // Partway through, some words are lit (the Studio's karaoke yellow).
    const lit = await countColor(page, after.box, [255, 214, 10], 45)
    expect(lit).toBeGreaterThan(50)
    await snap(page, info, 'karaoke lit partway')
    // Still editable in place.
    await page.mouse.dblclick(p.x, p.y)
    await expect(inlineEditor(page)).toHaveValue(CAPTION)
    await page.keyboard.press('Escape')
  })

  test('the caption looks restyle it; delete and undo', async ({ page }, info) => {
    await presetCard(page, 'White text with a black stroke.').click()
    await page.waitForTimeout(500)
    await captionBlock(page, CAPTION).click()
    const box = (await textBox(page).boundingBox())!
    expect(await countColor(page, box, [255, 255, 255], 20)).toBeGreaterThan(30)
    await snap(page, info, 'outline look')
    await page.keyboard.press('Delete')
    await expect(captionBlock(page, CAPTION)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(captionBlock(page, CAPTION)).toBeVisible()
  })

  test('resize the caption from a corner handle; the handle follows the cursor; one undo puts it back', async ({ page }, info) => {
    // A short caption, so there is room to grow before it wraps.
    await captionBlock(page, CAPTION).dblclick()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('so true')
    await page.keyboard.press('Enter')
    const p = await framePoint(page, 0.5, 0.26)
    // Still selected after the edit (a click on it now would edit again).
    await expect(textBox(page)).toBeVisible()
    await page.waitForTimeout(300)
    const before = (await textBox(page).boundingBox())!
    const f = await frame(page)
    const band = { x: f.x, y: f.y + f.height * 0.12, width: f.width, height: f.height * 0.3 }
    // The bottom-right corner handle sits on the box's corner; the box grows
    // from its center, so its right edge should land under the cursor.
    const cx = before.x + before.width, cy = before.y + before.height
    await page.mouse.move(cx + 4, cy + 4)
    await page.mouse.down()
    await page.mouse.move(cx + 19, cy + 9, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = (await textBox(page).boundingBox())!
    expect(after.width).toBeGreaterThan(before.width + 20)
    expect(Math.abs(after.x + after.width - (cx + 15))).toBeLessThan(8)
    // Bigger, still inside the frame.
    expect(after.x).toBeGreaterThanOrEqual(f.x - 2)
    expect(after.x + after.width).toBeLessThanOrEqual(f.x + f.width + 2)
    await snap(page, info, 'caption resized bigger')
    // The words are drawn bigger too: more white box on the frame.
    await deselect(page)
    const bigWhite = await countColor(page, band, [255, 255, 255], 8)
    // One undo puts the whole drag back.
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const smallWhite = await countColor(page, band, [255, 255, 255], 8)
    expect(bigWhite).toBeGreaterThan(smallWhite * 1.3)
    await captionBlock(page, 'so true').click()
    const undone = (await textBox(page).boundingBox())!
    expect(Math.abs(undone.width - before.width)).toBeLessThan(3)
    // A big drag keeps the caption inside the frame (it wraps instead).
    const cx2 = undone.x + undone.width, cy2 = undone.y + undone.height
    await page.mouse.move(cx2 + 4, cy2 + 4)
    await page.mouse.down()
    await page.mouse.move(cx2 + 80, cy2 + 20, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const big = (await textBox(page).boundingBox())!
    expect(big.x).toBeGreaterThanOrEqual(f.x - 2)
    expect(big.x + big.width).toBeLessThanOrEqual(f.x + f.width + 2)
    expect(big.width).toBeGreaterThan(undone.width * 2)
    await snap(page, info, 'big drag stays in the frame')
  })

  test('retime the caption on the timeline: move it later, shorten it, undo', async ({ page }, info) => {
    const r = await ruler(page)
    const pps = r.x(1) - r.x(0)
    const block = captionBlock(page, CAPTION)
    const b0 = (await block.boundingBox())!
    // Drag the block 1 s later.
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width / 2 + pps, b0.y + b0.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const b1 = (await block.boundingBox())!
    expect(b1.x - b0.x).toBeGreaterThan(pps * 0.7)
    await snap(page, info, 'caption moved 1 s later')
    // Before its new start, the frame shows no caption.
    await deselect(page)
    await seek(page, (b1.x - r.x(0)) / pps - 0.4)
    await page.waitForTimeout(500)
    const f = await frame(page)
    const band = { x: f.x, y: f.y + f.height * 0.15, width: f.width, height: f.height * 0.2 }
    expect(await countColor(page, band, [255, 255, 255], 8)).toBeLessThan(200)
    // Shorten it: drag its right edge 1 s to the left.
    const b2 = (await block.boundingBox())!
    await page.mouse.move(b2.x + b2.width - 2, b2.y + b2.height / 2)
    await page.mouse.down()
    await page.mouse.move(b2.x + b2.width - 2 - pps, b2.y + b2.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const b3 = (await block.boundingBox())!
    expect(b2.width - b3.width).toBeGreaterThan(pps * 0.7)
    expect(Math.abs(b3.x - b2.x)).toBeLessThan(4)
    await snap(page, info, 'caption shortened by 1 s')
    // Two undos put it back where it was.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    const b4 = (await block.boundingBox())!
    expect(Math.abs(b4.x - b0.x)).toBeLessThan(4)
    expect(Math.abs(b4.width - b0.width)).toBeLessThan(4)
  })

  test('redo brings back what undo took away', async ({ page }) => {
    await captionBlock(page, CAPTION).click()
    await page.keyboard.press('Delete')
    await expect(captionBlock(page, CAPTION)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(captionBlock(page, CAPTION)).toBeVisible()
    await page.keyboard.press('Control+Shift+z')
    await expect(captionBlock(page, CAPTION)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(captionBlock(page, CAPTION)).toBeVisible()
  })
})
