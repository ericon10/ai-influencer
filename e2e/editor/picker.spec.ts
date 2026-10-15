import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { api, clipBlocks, ruler, seedPost, snap, timeline } from './helpers'
import { editorReady, LIVE, startLive, type Live } from './r2'

// Add media, Studio first (owner, 2026-10-15): "Add media in the editor
// opens my computer's files even when the clip is already in the Studio."
// Add media opens a picker: this post's takes and stills, this character's
// clips and stills, then the Library; From computer is the second tab. One
// tap adds at the playhead; drag puts it exactly where it is dropped. Media
// is served the way the live site does (r2.ts).

let live: Live
test.beforeAll(async () => { live = await startLive() })
test.afterAll(async () => { await live.close() })

const picker = (page: Page) => page.locator('[data-studio-media]')
const group = (page: Page, id: string) => picker(page).locator(`[data-group="${id}"]`)

async function openPicker(page: Page, phone = false) {
  if (phone) await page.getByRole('navigation', { name: 'Editor workspace' }).getByRole('button', { name: 'Media' }).tap()
  // The Media section of the panel (on a phone, under the bottom tab).
  const media = page.locator('button', { hasText: /^Media$/ }).filter({ hasNot: page.locator('xpath=ancestor::nav') }).first()
  if (phone) await media.tap(); else if (await media.isVisible()) await media.click()
  const add = page.getByRole('button', { name: 'Add media', exact: true }).first()
  await add.waitFor({ timeout: 20_000 })
  if (phone) await add.tap(); else await add.click()
  await expect(picker(page)).toBeVisible()
  await expect(picker(page).getByRole('tab', { name: 'Studio' })).toHaveAttribute('aria-selected', 'true')
  await expect(group(page, 'post')).toBeVisible({ timeout: 30_000 })
}

test('Add media opens the Studio first: tap adds at the playhead, drag drops on a track, From computer is the second tab, and it all opens again after Done', async ({ page }, info) => {
  test.setTimeout(420_000)
  const post = await seedPost()
  await page.goto(`${LIVE}/editor/?studio=${post}`)
  await editorReady(page)
  await expect(clipBlocks(page)).toHaveCount(1)
  await openPicker(page)
  // Studio first: this post's own take, then the character's clips and
  // stills, then the Library.
  await expect(group(page, 'post').getByRole('button', { name: 'Add The clip in this post' })).toBeVisible()
  const order = await picker(page).locator('[data-group]').evaluateAll(gs => gs.map(g => g.getAttribute('data-group')))
  expect(order[0]).toBe('post')
  expect(order.indexOf('clips')).toBeLessThan(order.indexOf('library') === -1 ? 99 : order.indexOf('library'))
  await snap(page, info, 'the Studio picker')

  // One tap: a still from the character's stills, at the playhead.
  const still = group(page, 'stills').locator('button[data-media]').first()
  const stillId = await still.getAttribute('data-media')
  await still.click()
  await expect(picker(page).getByRole('status')).toContainText('Added', { timeout: 60_000 })
  await expect(clipBlocks(page)).toHaveCount(2)
  await snap(page, info, 'a still added with one tap')

  // A drag: a clip of the character onto the Shots track, at 6 s.
  const clip = group(page, 'clips').locator('button[data-media]').first()
  const clipId = await clip.getAttribute('data-media')
  await clip.scrollIntoViewIfNeeded()
  const shot = (await clipBlocks(page).first().boundingBox())!
  const r = await ruler(page)
  const from = (await clip.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x(6), shot.y + shot.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(clipBlocks(page)).toHaveCount(3, { timeout: 60_000 })
  // It landed on the Shots track, where it was dropped.
  const blocks = await clipBlocks(page).evaluateAll(bs => bs.map(b => { const x = b.getBoundingClientRect(); return { x: x.x, y: x.y + x.height / 2 } }))
  expect(blocks.some(b => Math.abs(b.y - (shot.y + shot.height / 2)) < 6 && Math.abs(b.x - r.x(6)) < 30)).toBe(true)
  await snap(page, info, 'a clip dragged onto the Shots track')

  // From computer: the second tab, the computer's own file picker.
  await picker(page).getByRole('tab', { name: 'From computer' }).click()
  const chooser = page.waitForEvent('filechooser')
  await picker(page).getByRole('button', { name: 'Choose files' }).click()
  const file = (await chooser)
  await file.setFiles({ name: 'from-my-computer.png', mimeType: 'image/png', buffer: readFileSync(join(process.cwd(), 'public', 'hf-icon.png')) })
  await expect(page.getByText('from-my-computer.png').first()).toBeVisible({ timeout: 30_000 })
  await expect(picker(page)).toBeHidden()
  await snap(page, info, 'From computer, in the Media tab')

  // Done: the picked still and clip are saved with the post, by Studio id.
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForURL(/\/studio\/posts\//, { timeout: 240_000 })
  const m = await api<{ project: { studioMedia?: Record<string, string> } | null }>('GET', `/content/${post}/editor`)
  expect(Object.values(m.project?.studioMedia ?? {})).toEqual(expect.arrayContaining([stillId, clipId]))
  await page.goto(`${LIVE}/editor/?studio=${post}`)
  await editorReady(page)
  await expect(clipBlocks(page)).toHaveCount(3)
  await snap(page, info, 'opened again: the picked media is still there')
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: Add media opens the Studio picker as a bottom sheet; a tap adds', async ({ page }, info) => {
    const post = await seedPost()
    await page.goto(`${LIVE}/editor/?studio=${post}`)
    await editorReady(page)
    await openPicker(page, true)
    const box = (await picker(page).boundingBox())!
    expect(Math.round(box.width)).toBe(390)
    expect(Math.round(box.y + box.height)).toBe(844)
    await snap(page, info, 'phone: the Studio picker')
    await group(page, 'stills').locator('button[data-media]').first().tap()
    await expect(picker(page).getByRole('status')).toContainText('Added', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Close' }).first().tap()
    await page.getByRole('navigation', { name: 'Editor workspace' }).getByRole('button', { name: 'Timeline' }).tap()
    await expect(timeline(page).locator('[aria-label^="Select clip"]')).toHaveCount(2)
    await snap(page, info, 'phone: added on the timeline')
  })
})
