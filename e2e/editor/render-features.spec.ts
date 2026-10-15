import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { captionBlock, clipBlocks, countColor, deselect, duration, exportFrame, exportWithDone, frame, framePoint, imageDiff, openEditor, presetCard, previewPng, ruler, seedTimerPost, seek, snap, textBox, timeline } from './helpers'

// The render check, feature by feature (editor QA, 2026-10-15): each edit is
// made by hand, exported with Done through the worker, and the MP4 compared
// with the preview at several moments. The clip shows time (a moving bar and
// the frame number), so a timing slip shows in the frame, not only a look.

async function previews(page: Page, name: string, times: number[]): Promise<string[]> {
  await deselect(page)
  const out: string[] = []
  const f = await frame(page)
  const black = async () => (await countColor(page, f, [0, 0, 0], 12)) > f.width * f.height * 0.5
  for (const t of times) {
    // Headless Chromium decodes in software and, late in a long run, a frame
    // can stay undrawn until the playhead moves again: scrub away and back,
    // as a person would, up to three times (the clip is never black).
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) { await seek(page, Math.max(0, t - 0.4)); await page.waitForTimeout(500) }
      await seek(page, t)
      // One frame on and back: the playhead sits exactly on a frame, as every
      // frame of the export does (the preview draws any moment in between).
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')
      for (let i = 0; i < 10 && (await black()); i++) await page.waitForTimeout(300)
      if (!(await black())) break
    }
    await page.waitForTimeout(400)
    out.push(await previewPng(page, `${name}-preview-${t}`))
  }
  return out
}

// A click on the ruler lands within about half a frame of the time asked
// for, then snaps to a frame, so the export is compared with the frames
// around it (30 fps) and the closest counts: a slip of more than two
// frames, or a different look, still fails.
async function compare(info: TestInfo, mp4: string, name: string, times: number[], shots: string[]) {
  for (const [i, t] of times.entries()) {
    const k0 = Math.round(t * 30)
    const tries = [-2, -1, 0, 1].map((dk) => { const k = Math.max(0, k0 + dk); const f = exportFrame(mp4, (k + 0.5) / 30, `${name}-export-${t}-f${k}`); return { f, d: imageDiff(shots[i]!, f) } })
    const { f: png, d } = tries.reduce((a, b) => (b.d < a.d ? b : a))
    info.annotations.push({ type: `${name} ${t} s`, description: `mean difference ${d.toFixed(1)} of 255` })
    await info.attach(`${name} preview ${t} s`, { path: shots[i]!, contentType: 'image/png' })
    await info.attach(`${name} export ${t} s`, { path: png, contentType: 'image/png' })
    expect(d, `${name} at ${t} s`).toBeLessThan(14)
  }
}

test('caption edits (resized, moved, shortened, retimed) export as previewed', async ({ page }, info) => {
  test.setTimeout(480_000)
  const post = await seedTimerPost({ caption: 'so true' })
  await openEditor(page, post)
  await seek(page, 1)
  // Bigger from the corner handle, then dragged down.
  const p = await framePoint(page, 0.5, 0.26)
  await page.mouse.click(p.x, p.y)
  const b = (await textBox(page).boundingBox())!
  await page.mouse.move(b.x + b.width + 4, b.y + b.height + 4)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width + 19, b.y + b.height + 9, { steps: 10 })
  await page.mouse.up()
  const c = (await textBox(page).boundingBox())!
  await page.mouse.move(c.x + c.width / 2 + 10, c.y + c.height / 2)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width / 2 + 10, c.y + c.height / 2 + 40, { steps: 10 })
  await page.mouse.up()
  // Shortened by 2 s at its end, then moved 1 s later: on screen 1 s to 5 s.
  const r = await ruler(page)
  const pps = r.x(1) - r.x(0)
  const block = captionBlock(page, 'so true')
  const k = (await block.boundingBox())!
  await page.mouse.move(k.x + k.width - 2, k.y + k.height / 2)
  await page.mouse.down()
  await page.mouse.move(k.x + k.width - 2 - 2 * pps, k.y + k.height / 2, { steps: 12 })
  await page.mouse.up()
  const k2 = (await block.boundingBox())!
  await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height / 2)
  await page.mouse.down()
  await page.mouse.move(k2.x + k2.width / 2 + pps, k2.y + k2.height / 2, { steps: 12 })
  await page.mouse.up()
  await snap(page, info, 'caption edited')
  const times = [0.6, 2.0, 3.5, 5.5]
  const shots = await previews(page, 'caption', times)
  const mp4 = await exportWithDone(page, post, 'caption')
  expect(duration(mp4)).toBeGreaterThan(5.6)
  expect(duration(mp4)).toBeLessThan(6.4)
  await compare(info, mp4, 'caption', times, shots)
})

test('clip edits (split, speed 2x, reorder) export as previewed', async ({ page }, info) => {
  test.setTimeout(480_000)
  const post = await seedTimerPost()
  await openEditor(page, post)
  const sorted = async () => (await clipBlocks(page).evaluateAll(els => els.map((e, i) => { const r = e.getBoundingClientRect(); return { i, x: r.x, y: r.y, w: r.width, h: r.height } }))).sort((p, q) => p.x - q.x)
  // Split at 2 s.
  await seek(page, 2)
  await clipBlocks(page).first().click()
  await page.keyboard.press('s')
  await expect(clipBlocks(page)).toHaveCount(2)
  // The second piece at 2x.
  await seek(page, 5.5)
  const [, second] = await sorted()
  await clipBlocks(page).nth(second!.i).click()
  const section = page.locator('#editor-panel-inspector').getByText('Speed & Direction', { exact: true })
  await section.scrollIntoViewIfNeeded()
  await section.click()
  const set2x = page.getByRole('button', { name: 'Set speed to 2×' })
  await set2x.scrollIntoViewIfNeeded()
  await set2x.click()
  await expect.poll(async () => (await sorted())[1]!.w).toBeLessThan(second!.w * 0.6)
  // Then dragged in front of the first.
  const [a, bb] = await sorted()
  await page.mouse.move(bb!.x + bb!.w / 2, bb!.y + bb!.h / 2)
  await page.mouse.down()
  await page.mouse.move(a!.x + a!.w * 0.3, a!.y + a!.h / 2, { steps: 15 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await snap(page, info, 'split, 2x, reordered')
  const times = [0.5, 1.5, 2.5, 3.5]
  const shots = await previews(page, 'clips', times)
  const mp4 = await exportWithDone(page, post, 'clips')
  // 2 s at normal speed and 4 s at 2x.
  expect(duration(mp4)).toBeGreaterThan(3.6)
  expect(duration(mp4)).toBeLessThan(4.4)
  await compare(info, mp4, 'clips', times, shots)
})

test('Pack 1 presets (freeze, flash cut, shake, speed ramp, word pop) export as previewed', async ({ page }, info) => {
  test.setTimeout(480_000)
  const post = await seedTimerPost()
  await openEditor(page, post)
  const status = page.locator('[data-studio="presets"] [role="status"]').first()
  const said: string[] = []
  const place = async (t: number, line: string) => {
    await seek(page, t)
    await presetCard(page, line).click()
    await page.waitForTimeout(500)
    said.push((await status.innerText()).trim())
  }
  await place(0.5, 'The caption pops in one word at a time.')
  await place(1.0, 'Holds the frame for a beat (add a text pop or the record scratch).')
  await place(2.5, 'A white flash right on the cut.')
  await place(3.5, 'A short hard shake that dies away.')
  await place(4.5, 'Eases from full speed into slow motion for the moment.')
  // Flash and shake sit on the Presets track; the freeze and the ramp
  // change the shot itself, and word pop the caption. Each says so.
  await expect(timeline(page).locator('[data-studio-preset]')).toHaveCount(2)
  info.annotations.push({ type: 'presets said', description: said.join(' | ') })
  expect(said[1]).toMatch(/Freeze frame at/)
  expect(said[4]).toMatch(/Speed ramp on the shot/)
  await snap(page, info, 'presets placed')
  const times = [0.3, 1.2, 2.55, 3.6, 4.8]
  const shots = await previews(page, 'presets', times)
  const mp4 = await exportWithDone(page, post, 'presets')
  await compare(info, mp4, 'presets', times, shots)
})
