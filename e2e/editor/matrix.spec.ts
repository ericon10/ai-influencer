import { expect, test, type Page } from '@playwright/test'
import { captionBlock, CAPTION, clipBlocks, countColor, deselect, frame, inlineEditor, openEditor, presetCard, seedPost, seek, snap, timeline } from './helpers'

// The rest of the editor matrix, driven like a user (editor QA,
// 2026-10-15): camera presets on the Presets track, every Pack 1 preset,
// text presets, speed, ripple trim, the beat, saved styles and Add Title.

const status = (page: Page) => page.locator('[data-studio="presets"] [role="status"]').first()
const presetBlocks = (page: Page) => timeline(page).locator('[data-studio-preset]')

test('a camera preset: place, drag, Strong, delete, undo', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 3)
  await presetCard(page, 'A quick push-in that lands on the beat.').click()
  const block = timeline(page).locator('[data-studio-preset="punch_in"]')
  await expect(block).toHaveAttribute('aria-label', 'Punch-in on beat preset, normal')
  // Drag it later.
  const b = (await block.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  expect((await block.boundingBox())!.x).toBeGreaterThan(b.x + 25)
  // Strong from its panel.
  await block.click()
  const panel = page.getByRole('dialog', { name: 'Punch-in on beat preset' })
  await panel.getByRole('button', { name: 'Strong', exact: true }).click()
  await expect(block).toHaveAttribute('aria-label', 'Punch-in on beat preset, strong')
  await snap(page, info, 'punch-in, strong, moved')
  // Delete, then undo.
  await page.keyboard.press('Delete')
  await expect(block).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(timeline(page).locator('[data-studio-preset="punch_in"]')).toHaveCount(1)
})

test('Pack 1: every preset places or says what it needs', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const pack1: [string, string][] = [
    ['crash_zoom', 'Slams into the face and cuts hard to the next shot.'],
    ['speed_ramp', 'Eases from full speed into slow motion for the moment.'],
    ['punch_in', 'A quick push-in that lands on the beat.'],
    ['freeze_pop', 'Holds the frame for a beat (add a text pop or the record scratch).'],
    ['flash_cut', 'A white flash right on the cut.'],
    ['shake', 'A short hard shake that dies away.'],
    ['word_pop', 'The caption pops in one word at a time.'],
    ['whip_pan', 'A fast blurred pan carries one shot into the next.'],
    ['hand_lens', 'The frame goes dark as if a hand covers the lens, then opens on the next shot.'],
    ['zoom_through', 'Pushes through the frame into the next shot.'],
  ]
  const said: string[] = []
  for (const [id, line] of pack1) {
    await seek(page, 2.5)
    const blocksBefore = await presetBlocks(page).count()
    await presetCard(page, line).click()
    await expect(status(page)).toBeVisible()
    const text = (await status(page).innerText()).trim()
    said.push(`${id}: ${text}`)
    const placed = (await presetBlocks(page).count()) > blocksBefore
    // Either it placed something or it says what it needs; never silent.
    expect(placed || text.length > 10, `${id} did something or said why not`).toBeTruthy()
  }
  info.annotations.push({ type: 'pack 1', description: said.join(' | ') })
  await snap(page, info, 'Pack 1 placed')
})

test('word-by-word pop shows the words one at a time', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 1)
  await presetCard(page, 'The caption pops in one word at a time.').click()
  await deselect(page)
  const f = await frame(page)
  const band = { x: f.x, y: f.y + f.height * 0.18, width: f.width, height: f.height * 0.18 }
  await seek(page, 0.15)
  await page.waitForTimeout(800)
  const early = await countColor(page, band, [255, 255, 255], 12)
  await seek(page, 2.5)
  await page.waitForTimeout(800)
  const late = await countColor(page, band, [255, 255, 255], 12)
  info.annotations.push({ type: 'white box pixels', description: `0.15 s: ${early}, 2.5 s: ${late}` })
  expect(late).toBeGreaterThan(early * 1.5)
  await snap(page, info, 'all words in')
})

test('speed 2x halves the shot', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  const before = (await clipBlocks(page).first().boundingBox())!
  await clipBlocks(page).first().click()
  // In the inspector's Speed & Direction section (collapsed at first).
  const section = page.locator('#editor-panel-inspector').getByText('Speed & Direction', { exact: true })
  await section.scrollIntoViewIfNeeded()
  await section.click()
  const set2x = page.getByRole('button', { name: 'Set speed to 2×' })
  await set2x.scrollIntoViewIfNeeded()
  await set2x.click()
  await expect.poll(async () => (await clipBlocks(page).first().boundingBox())!.width).toBeLessThan(before.width * 0.6)
  await snap(page, info, 'shot at 2x')
})

test('ripple trim: trimming a shot slides the next one over', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 2)
  await clipBlocks(page).first().click()
  await page.keyboard.press('s')
  await expect(clipBlocks(page)).toHaveCount(2)
  // The playhead sits on the cut after a split and covers the handles.
  await seek(page, 4.5)
  const sorted = async () => (await clipBlocks(page).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))).sort((p, q) => p.x - q.x)
  const [a, b] = await sorted()
  // Near the top of the edge: the middle of a cut is the transition badge.
  await page.mouse.move(a!.x + a!.w - 3, a!.y + 9)
  await page.mouse.down()
  await page.mouse.move(a!.x + a!.w - 33, a!.y + 9, { steps: 8 })
  await page.mouse.up()
  const [, b2] = await sorted()
  expect(b2!.x).toBeLessThan(b!.x - 20)
  await snap(page, info, 'rippled')
})

test('the beat of the post music is found when it opens', async ({ page }, info) => {
  await openEditor(page, await seedPost({ music: true }), { mp3: true })
  await expect(page.locator('[data-studio="presets"]')).toContainText(/\d+ beats at 1[12]\d BPM/)
  await snap(page, info, 'beat found')
})

test('a saved style: save it, place it on another post, delete it', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 3)
  await presetCard(page, 'A quick push-in that lands on the beat.').click()
  const styles = page.locator('[data-studio="styles"]')
  await styles.getByRole('button', { name: /^Save as a style/ }).click()
  const name = `E2E style ${Date.now() % 100000}`
  await styles.getByLabel('Style name').fill(name)
  await styles.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(styles.getByText(name)).toBeVisible()
  // Another post: one click places it.
  await openEditor(page, await seedPost())
  await page.locator('[data-studio="styles"]').getByText(name).click()
  await expect(timeline(page).locator('[data-studio-preset="punch_in"]')).toHaveCount(1)
  await snap(page, info, 'style placed on another post')
  await page.locator('[data-studio="styles"]').getByRole('button', { name: `Delete ${name}` }).click()
  await expect(page.locator('[data-studio="styles"]').getByText(name)).toHaveCount(0)
})

test('Add Title from the Text tab, then edit it in place', async ({ page }, info) => {
  await openEditor(page, await seedPost())
  await seek(page, 0.5)
  await page.getByRole('button', { name: 'Text', exact: true }).first().click()
  await page.getByRole('button', { name: 'Add Title' }).click()
  await expect(captionBlock(page, 'New Title')).toBeVisible()
  await captionBlock(page, 'New Title').dblclick()
  await expect(inlineEditor(page)).toHaveValue('New Title')
  await page.keyboard.press('Control+A')
  await page.keyboard.type('a title of my own')
  await page.keyboard.press('Enter')
  await expect(captionBlock(page, 'a title of my own')).toBeVisible()
  await expect(captionBlock(page, CAPTION)).toBeVisible()
  await snap(page, info, 'title added and edited')
})
