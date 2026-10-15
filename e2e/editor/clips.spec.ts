import { expect, test } from '@playwright/test'
import { clipBlocks, frame, openEditor, seedPost, seek, snap } from './helpers'

// Shots on the timeline, driven like a user (editor QA, 2026-10-15): split,
// undo and redo, trim, and reorder by dragging (the audit found a drop onto
// another shot stacked it on a new track instead of swapping).

test.describe('clips', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page, await seedPost())
  })

  test('split with S, undo and redo', async ({ page }, info) => {
    await seek(page, 2)
    await clipBlocks(page).first().click()
    await page.keyboard.press('s')
    await expect(clipBlocks(page)).toHaveCount(2)
    await page.keyboard.press('Control+z')
    await expect(clipBlocks(page)).toHaveCount(1)
    await page.keyboard.press('Control+Shift+z')
    await expect(clipBlocks(page)).toHaveCount(2)
    await snap(page, info, 'split in two')
  })

  test('trim a shot by dragging its edge', async ({ page }, info) => {
    const b = (await clipBlocks(page).first().boundingBox())!
    await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width - 42, b.y + b.height / 2, { steps: 8 })
    await page.mouse.up()
    const a = (await clipBlocks(page).first().boundingBox())!
    expect(Math.abs(a.width - (b.width - 40))).toBeLessThan(8)
    await snap(page, info, 'trimmed')
  })

  test('drag a shot onto another to swap them on the same track', async ({ page }, info) => {
    await seek(page, 2)
    await clipBlocks(page).first().click()
    await page.keyboard.press('s')
    await expect(clipBlocks(page)).toHaveCount(2)
    const placed = (await clipBlocks(page).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))).sort((p, q) => p.x - q.x)
    const a = placed[0]!
    const b = placed[1]!
    // The 3 s piece (right) dropped onto the start of the 2 s piece (left).
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + b.width / 2 + 4, b.y + b.height / 2, { steps: 14 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const boxes = (await clipBlocks(page).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width } }))).sort((p, q) => p.x - q.x)
    expect(boxes).toHaveLength(2)
    // Same track (same row), back to back, the long piece first.
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2)
    expect(Math.abs(boxes[0]!.x - a.x)).toBeLessThan(4)
    expect(boxes[0]!.w).toBeGreaterThan(boxes[1]!.w)
    expect(Math.abs(boxes[0]!.x + boxes[0]!.w - boxes[1]!.x)).toBeLessThan(6)
    // One undo puts them back.
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    const back = (await clipBlocks(page).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width } }))).sort((p, q) => p.x - q.x)
    expect(back[0]!.w).toBeLessThan(back[1]!.w)
    await snap(page, info, 'reordered then undone')
  })

  test('the preview shows the first frame without pressing Play', async ({ page }, info) => {
    const f = await frame(page)
    await expect.poll(async () => {
      const png = await page.screenshot({ clip: f })
      return page.evaluate(async b64 => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d')!
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        let s = 0
        for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!
        return s / (d.length / 4) / 3
      }, png.toString('base64'))
    }, { timeout: 8000 }).toBeGreaterThan(20)
    await snap(page, info, 'first frame on open')
  })
})
