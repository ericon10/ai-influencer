import { expect, test, type Page } from '@playwright/test'
import { captionBlock, captionBlocks, centerOf, countColor, deselect, frame, inlineEditor, openEditor, seedPost, seek, snap, textBox } from './helpers'

// Text presets work like CapCut (owner, 2026-10-22, Tier 1 item 1). On
// 0621a61 adding Caption (or any preset with a bottom or left alignment)
// drew the words above their selection box and left the box empty below.
// Now the words render inside their box, a two-line caption grows the box,
// one click selects, a drag moves, a second click or typing edits in place,
// and a double-click edits too. Every Text preset is checked on a 9:16 post,
// and each is sized relative to the frame's height so it reads on a phone.

const PRESETS: Array<{ name: string; text: string }> = [
  { name: 'Heading', text: 'Heading' },
  { name: 'Subtitle', text: 'Subtitle text' },
  { name: 'Lower Third', text: 'Name Here' },
  { name: 'Caption', text: 'Caption text here' },
  { name: 'Hero', text: 'MAKE IT MOVE' },
  { name: 'Quote', text: '“Tell a better story.”' },
  { name: 'Outline', text: 'OUTLINE' },
  { name: 'Badge', text: 'NEW RELEASE' },
]

async function openTextTab(page: Page) {
  const tab = page.getByRole('tab', { name: 'Text', exact: true }).first()
  if (await tab.count()) await tab.click()
  else await page.getByRole('button', { name: 'Text', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Caption', exact: true })).toBeVisible()
}

// How much of the words' white ink sits inside the box, against a band the
// same height just above it (the frame behind is beige and brown; every
// preset draws white words). Counted with nothing selected, so the box and
// its handles are not in the picture.
async function inkInsideAndAbove(page: Page) {
  const box = (await textBox(page).boundingBox())!
  const f = await frame(page)
  const above = { x: box.x, y: Math.max(f.y, box.y - box.height - 2), width: box.width, height: Math.min(box.height, box.y - 2 - f.y) }
  await deselect(page)
  await page.waitForTimeout(400)
  const inside = await countColor(page, box, [255, 255, 255], 30)
  const over = above.height > 1 ? await countColor(page, above, [255, 255, 255], 30) : 0
  return { inside, above: over, box }
}

test.describe('text presets', () => {
  let post: string
  test.beforeEach(async ({ page }) => {
    post = await seedPost({ caption: '' })
    await openEditor(page, post)
    await seek(page, 1)
    await openTextTab(page)
  })

  for (const p of PRESETS) {
    test(`${p.name}: the words render inside their selection box`, async ({ page }, info) => {
      await deselect(page)
      await page.getByRole('button', { name: p.name, exact: true }).click()
      await expect(textBox(page)).toBeVisible()
      await snap(page, info, `${p.name} added`)
      const ink = await inkInsideAndAbove(page)
      // The words are drawn in the box, not above it.
      expect(ink.inside).toBeGreaterThan(15)
      expect(ink.above).toBeLessThan(ink.inside * 0.25)
      // Sized for the 9:16 frame (owner, 2026-10-22): every preset is at
      // least 2.5% of the frame's height, so it reads on a phone (Caption
      // was 24 px, 1.5%, before).
      const f = await frame(page)
      expect(ink.box.height / f.height).toBeGreaterThanOrEqual(0.025)
    })
  }

  test('9:16 two-line caption: click the words, drag, edit', async ({ page }, info) => {
    await deselect(page)
    await page.getByRole('button', { name: 'Caption', exact: true }).click()
    await expect(textBox(page)).toBeVisible()
    // Type straight onto the selected caption: the letter starts the edit.
    await page.keyboard.press('W')
    await expect(inlineEditor(page)).toBeVisible()
    await expect(inlineEditor(page)).toHaveValue('W')
    const oneLine = (await inlineEditor(page).boundingBox())!
    await page.keyboard.type('hen the alarm')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('goes off at 6')
    // A second line makes the edit box taller.
    const twoLines = (await inlineEditor(page).boundingBox())!
    expect(twoLines.height).toBeGreaterThan(oneLine.height + 4)
    await page.keyboard.press('Enter')
    const words = 'When the alarm\ngoes off at 6'
    await expect(captionBlocks(page).first()).toHaveAttribute('aria-label', `Select text clip ${words}`)
    await snap(page, info, 'two-line caption')

    // The two lines render inside the box, which is two lines tall.
    await expect(textBox(page)).toBeVisible()
    const ink = await inkInsideAndAbove(page)
    expect(ink.inside).toBeGreaterThan(15)
    expect(ink.above).toBeLessThan(ink.inside * 0.25)
    const f = await frame(page)
    expect(ink.box.height).toBeGreaterThan(f.height * 0.025)

    // One click on the words (where they are drawn) selects them.
    const word = { x: ink.box.x + ink.box.width / 2, y: ink.box.y + ink.box.height * 0.3 }
    await page.mouse.click(word.x, word.y)
    await expect(textBox(page)).toBeVisible()
    await expect(inlineEditor(page)).toBeHidden()

    // Drag moves them.
    const start = await centerOf(textBox(page))
    const dx = start.box.width * 0.3
    await page.mouse.move(start.x + dx, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + dx, start.y - 120, { steps: 10 })
    await page.mouse.up()
    const moved = await centerOf(textBox(page))
    expect(start.y - moved.y).toBeGreaterThan(90)
    await expect(inlineEditor(page)).toBeHidden()
    await snap(page, info, 'caption dragged up')

    // A second click on the selected words edits them in place.
    await page.waitForTimeout(400)
    await page.mouse.click(moved.x + dx, moved.y)
    await expect(inlineEditor(page)).toBeVisible()
    await expect(inlineEditor(page)).toHaveValue(words)
    await page.keyboard.press('Control+A')
    await page.keyboard.type('edited in place')
    await page.keyboard.press('Enter')
    await expect(captionBlock(page, 'edited in place')).toBeVisible()

    // Double-click edits too.
    await deselect(page)
    await page.mouse.dblclick(moved.x, moved.y)
    await expect(inlineEditor(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(inlineEditor(page)).toBeHidden()
    await snap(page, info, 'edited')
  })
})

