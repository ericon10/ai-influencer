import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import { API, api, captionBlocks, clipBlocks, seedPost, snap, CAPTION } from './helpers'
import { editorReady, LIVE, startLive, type Live } from './r2'

// No caption (owner, 2026-10-15): a clear "No caption" next to the caption
// styles; with it, no caption track in the editor and none in the export;
// it can be switched back; it is kept with the post. And a caption is never
// required: an empty one exports a video with no caption.

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'cache')
mkdirSync(OUT, { recursive: true })
let live: Live
test.beforeAll(async () => { live = await startLive() })
test.afterAll(async () => { await live.close() })

const step = (page: Page, name: string) => page.locator('.st-step', { hasText: name })
async function captionStep(page: Page, post: string) {
  await page.goto(`${LIVE}/studio/posts/${post}`)
  await step(page, 'Caption').waitFor({ timeout: 30_000 })
  await step(page, 'Caption').click()
  await expect(page.getByRole('radio', { name: 'No caption' })).toBeVisible({ timeout: 20_000 })
}
async function finish(page: Page) {
  await step(page, 'Finish').click()
  await page.locator('[data-field="post-timeline"]').waitFor({ timeout: 20_000 })
}
async function openEditor(page: Page) {
  await page.locator('[data-field="post-timeline"]').getByRole('button', { name: /Open the editor/ }).click()
  await page.waitForURL(/\/editor\/\?studio=/, { timeout: 30_000 })
  await editorReady(page)
}
async function exportNow(page: Page) {
  const btn = page.getByRole('button', { name: /^Export MP4/ })
  await expect(btn).toBeEnabled()
  await btn.click()
  await expect(page.getByRole('button', { name: /Export MP4 again/ })).toBeVisible({ timeout: 180_000 })
}
// Pure white pixels in the upper third of the exported video at 1 s: the
// white caption box, or none.
async function whiteInCaptionZone(post: string, name: string): Promise<number> {
  const items = (await api<{ items: { id: string; outputs?: { videoAssetId?: string } }[] }>('GET', '/content')).items
  const id = items.find(i => i.id === post)!.outputs!.videoAssetId!
  const mp4 = join(OUT, `${name}.mp4`), png = join(OUT, `${name}.png`)
  writeFileSync(mp4, Buffer.from(await (await fetch(`${API}/assets/${id}/content`, { headers: { 'x-studio-request': '1' } })).arrayBuffer()))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1', png])
  const { data, info } = await sharp(png).extract({ left: 0, top: 0, width: 1080, height: 640 }).raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let i = 0; i < data.length; i += info.channels) if (data[i]! > 245 && data[i + 1]! > 245 && data[i + 2]! > 245) n++
  return n
}

test('No caption: chosen in the Caption step, kept with the post; no caption in the editor or the export; switched back, it returns', async ({ page }, info) => {
  test.setTimeout(600_000)
  const post = await seedPost()
  await captionStep(page, post)
  await page.getByRole('radio', { name: 'No caption' }).click()
  await expect(page.locator('[data-field="caption-off"]')).toBeVisible()
  await expect(page.getByLabel('Caption (off)')).toHaveValue(CAPTION)
  await snap(page, info, 'No caption chosen; the words are kept')
  await expect.poll(async () => (await api<{ items: { id: string; spec: { captionOff?: boolean } }[] }>('GET', '/content')).items.find(i => i.id === post)?.spec.captionOff, { timeout: 15_000 }).toBe(true)

  // The Finish step says so, and nothing asks for a caption.
  await finish(page)
  await expect(page.locator('[data-field="timeline-no-caption"]')).toBeVisible()
  await expect(page.getByText('Write the caption')).toHaveCount(0)
  await snap(page, info, 'Finish: No caption on the timeline card')

  // The editor: the take, no caption track.
  await openEditor(page)
  await expect(clipBlocks(page)).toHaveCount(1)
  await expect(captionBlocks(page)).toHaveCount(0)
  await expect(page.locator('#editor-panel-timeline').getByText('Captions', { exact: true })).toHaveCount(0)
  await snap(page, info, 'the editor with No caption: the take, no caption track')

  // The export: no white caption box.
  await page.getByRole('button', { name: 'Back to the post' }).click()
  await page.waitForURL(/\/studio\/posts\//)
  await page.locator('[data-field="post-timeline"]').waitFor({ timeout: 30_000 })
  await exportNow(page)
  const off = await whiteInCaptionZone(post, `${post}-off`)

  // Switched back on: the same words return, in the editor and the export.
  await captionStep(page, post)
  await page.getByRole('radio', { name: 'White box' }).click()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(CAPTION)
  await finish(page)
  await openEditor(page)
  await expect(page.locator(`[aria-label="Select text clip ${CAPTION}"]`)).toBeVisible()
  await page.getByRole('button', { name: 'Back to the post' }).click()
  await page.waitForURL(/\/studio\/posts\//)
  await page.locator('[data-field="post-timeline"]').waitFor({ timeout: 30_000 })
  await exportNow(page)
  const on = await whiteInCaptionZone(post, `${post}-on`)
  expect(off).toBeLessThan(500)
  expect(on).toBeGreaterThan(off + 5000)
})

test('a caption is never required: an empty caption exports a video with no caption', async ({ page }, info) => {
  test.setTimeout(300_000)
  const post = await seedPost({ caption: '' })
  await page.goto(`${LIVE}/studio/posts/${post}`)
  await finish(page)
  await expect(page.getByText('Write the caption')).toHaveCount(0)
  await snap(page, info, 'Finish: nothing asks for a caption')
  await exportNow(page)
  expect(await whiteInCaptionZone(post, `${post}-empty`)).toBeLessThan(500)
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: No caption is one tap, and the editor opens without a caption track', async ({ page }, info) => {
    const post = await seedPost()
    await captionStep(page, post)
    const choice = page.getByRole('radio', { name: 'No caption' })
    const box = (await choice.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await choice.tap()
    await expect(page.locator('[data-field="caption-off"]')).toBeVisible()
    await snap(page, info, 'phone: No caption')
    await expect.poll(async () => (await api<{ items: { id: string; spec: { captionOff?: boolean } }[] }>('GET', '/content')).items.find(i => i.id === post)?.spec.captionOff, { timeout: 15_000 }).toBe(true)
    await page.goto(`${LIVE}/editor/?studio=${post}`)
    await editorReady(page)
    await page.getByRole('navigation', { name: 'Editor workspace' }).getByRole('button', { name: 'Timeline' }).tap()
    await expect(captionBlocks(page)).toHaveCount(0)
    await expect(clipBlocks(page)).toHaveCount(1)
    await snap(page, info, 'phone: the editor with No caption')
  })
})
