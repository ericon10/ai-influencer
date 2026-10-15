import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import { API, api, seedPost, snap } from './helpers'
import { editorReady, LIVE, startLive, type Live } from './r2'

// Upload images (owner, 2026-10-15): in Library > Stills and in a
// slideshow's Stills step; several at once; drag and drop on a computer,
// the camera roll (the file picker) on a phone; tagged to the character
// picked; shown in the editor's Studio picker; kept exactly as uploaded.

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'uploads')
mkdirSync(DIR, { recursive: true })
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
let live: Live
test.beforeAll(async () => { live = await startLive() })
test.afterAll(async () => { await live.close() })

// Real image files, different each run so they are easy to find.
async function files(tag: string) {
  const run = `${tag}-${Date.now().toString(36)}`
  const out: { name: string; path: string; mimeType: string; buffer: Buffer }[] = []
  const photo = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 200, g: 140, b: 110 } } }).composite([{ input: Buffer.from(`<svg width="4032" height="3024"><text x="200" y="600" font-size="400">${run}</text></svg>`) }]).jpeg({ quality: 96 }).toBuffer()
  const png = await sharp({ create: { width: 1170, height: 2532, channels: 4, background: { r: 30, g: 160, b: 90, alpha: 0.6 } } }).png().toBuffer()
  const webp = await sharp({ create: { width: 900, height: 1600, channels: 3, background: { r: 90, g: 60, b: 160 } } }).webp({ quality: 90 }).toBuffer()
  for (const [name, mimeType, buffer] of [[`${run}-photo.jpg`, 'image/jpeg', photo], [`${run}-screen.png`, 'image/png', png], [`${run}-look.webp`, 'image/webp', webp]] as const) {
    const path = join(DIR, name)
    writeFileSync(path, buffer)
    out.push({ name, path, mimeType, buffer })
  }
  return out
}

type Still = { id: string; assetId: string; sceneTitle: string; characterId: string; op: string }
async function uploaded(characterId: string, names: string[]): Promise<Still[]> {
  const lib = await api<{ stills: Still[] }>('GET', `/library?characterId=${characterId}`)
  return lib.stills.filter(s => s.op === 'upload_image' && names.includes(s.sceneTitle))
}
// Every byte the same as the file on disk.
async function sameBytes(stills: Still[], fs: { name: string; buffer: Buffer }[]) {
  for (const s of stills) {
    const f = fs.find(x => x.name.replace(/\.[a-z]+$/, '') === s.sceneTitle)!
    const got = Buffer.from(await (await fetch(`${API}/assets/${s.assetId}/content`, { headers: { 'x-studio-request': '1' } })).arrayBuffer())
    expect(sha(got), s.sceneTitle).toBe(sha(f.buffer))
  }
}
const titles = (fs: { name: string }[]) => fs.map(f => f.name.replace(/\.[a-z]+$/, ''))
const characterOf = async (post: string) => (await api<{ items: { id: string; characterId: string }[] }>('GET', '/content')).items.find(i => i.id === post)!.characterId

async function chooseFor(page: Page, characterId: string) {
  const pick = page.getByLabel('Upload for')
  if (await pick.count()) await pick.selectOption(characterId)
}

test('Library > Stills: pick several files, and drop more; kept byte for byte at full size, for the character picked, and in the editor picker', async ({ page }, info) => {
  test.setTimeout(300_000)
  const post = await seedPost()
  const characterId = await characterOf(post)
  await page.goto(`${LIVE}/studio/library?tab=stills`)
  const zone = page.locator('[data-field="still-upload"]')
  await zone.waitFor({ timeout: 30_000 })
  await chooseFor(page, characterId)

  // The file picker: three at once.
  const picked = await files('pick')
  const chooser = page.waitForEvent('filechooser')
  await zone.getByRole('button', { name: 'Upload images' }).click()
  const fc = await chooser
  expect(fc.isMultiple()).toBe(true)
  await fc.setFiles(picked.map(f => f.path))
  await expect(page.getByText(/Added 3 images to Library > Stills/)).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => (await uploaded(characterId, titles(picked))).length, { timeout: 30_000 }).toBe(3)
  await sameBytes(await uploaded(characterId, titles(picked)), picked)
  await snap(page, info, 'Library > Stills: three images uploaded')

  // Drag and drop: two files dropped on the zone.
  const dropped = (await files('drop')).slice(0, 2)
  const dt = await page.evaluateHandle(fs => {
    const d = new DataTransfer()
    for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, { type: f.type }))
    return d
  }, dropped.map(f => ({ name: f.name, type: f.mimeType, b64: f.buffer.toString('base64') })))
  await zone.dispatchEvent('dragover', { dataTransfer: dt })
  await expect(zone).toHaveClass(/over/)
  await zone.dispatchEvent('drop', { dataTransfer: dt })
  await expect(page.getByText(/Added 2 images to Library > Stills/)).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => (await uploaded(characterId, titles(dropped))).length, { timeout: 30_000 }).toBe(2)
  await sameBytes(await uploaded(characterId, titles(dropped)), dropped)
  // Shown in the grid under their file names.
  await expect(page.locator('.st-tile-label', { hasText: titles(dropped)[0]! })).toBeVisible()
  await snap(page, info, 'Library > Stills: dropped images in the grid')

  // In the editor's Studio picker, with the character's stills.
  await page.goto(`${LIVE}/editor/?studio=${post}`)
  await editorReady(page)
  await page.getByRole('button', { name: 'Media', exact: true }).first().click()
  await page.getByRole('button', { name: 'Add media', exact: true }).first().click()
  const stills = page.locator('[data-studio-media] [data-group="stills"]')
  await expect(stills.getByRole('button', { name: `Add ${titles(picked)[0]}` })).toBeVisible({ timeout: 30_000 })
  await stills.getByRole('button', { name: `Add ${titles(picked)[0]}` }).scrollIntoViewIfNeeded()
  await snap(page, info, 'the uploads in the editor picker')
})

test('a slideshow: Upload in the Stills step adds them to the slideshow, and it exports with no words', async ({ page }, info) => {
  test.setTimeout(300_000)
  const base = await seedPost()
  const characterId = await characterOf(base)
  const { id: post } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId, title: 'Upload e2e' })
  await page.goto(`${LIVE}/studio/posts/${post}`)
  const stepChip = page.locator('.st-step', { hasText: 'Stills' })
  await stepChip.waitFor({ timeout: 30_000 })
  const zone = page.locator('[data-field="still-upload"]')
  if (!(await zone.isVisible())) await stepChip.click()
  await zone.waitFor({ timeout: 30_000 })
  const fs = (await files('slides')).slice(0, 2)
  const chooser = page.waitForEvent('filechooser')
  await zone.getByRole('button', { name: 'Upload images' }).click()
  await (await chooser).setFiles(fs.map(f => f.path))
  await expect(page.getByText(/Added 2 images .* and to this slideshow/)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.st-picked')).toHaveCount(2)
  await snap(page, info, 'slideshow: uploaded into the Stills step')
  // No words needed (a caption is never required): Export images.
  await page.locator('.st-step', { hasText: 'Finish' }).click()
  const exp = page.getByRole('button', { name: /^Export images/ })
  await expect(exp).toBeEnabled({ timeout: 30_000 })
  await exp.click()
  await expect(page.getByRole('button', { name: /Export images again/ })).toBeVisible({ timeout: 120_000 })
  const item = (await api<{ items: { id: string; outputs?: { imageAssetIds?: string[] } }[] }>('GET', '/content')).items.find(i => i.id === post)!
  expect(item.outputs?.imageAssetIds).toHaveLength(2)
  await snap(page, info, 'slideshow exported with no words')
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: Upload images opens the camera roll (the file picker) and keeps the files as they are', async ({ page }, info) => {
    const post = await seedPost()
    const characterId = await characterOf(post)
    await page.goto(`${LIVE}/studio/library?tab=stills`)
    const zone = page.locator('[data-field="still-upload"]')
    await zone.waitFor({ timeout: 30_000 })
    const box = (await zone.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await chooseFor(page, characterId)
    const fs = (await files('phone')).slice(0, 2)
    const chooser = page.waitForEvent('filechooser')
    await zone.getByRole('button', { name: 'Upload images' }).tap()
    await (await chooser).setFiles(fs.map(f => f.path))
    await expect(page.getByText(/Added 2 images/)).toBeVisible({ timeout: 60_000 })
    await expect.poll(async () => (await uploaded(characterId, titles(fs))).length, { timeout: 30_000 }).toBe(2)
    await sameBytes(await uploaded(characterId, titles(fs)), fs)
    await snap(page, info, 'phone: uploaded from the camera roll')
    expect(readFileSync(fs[0]!.path).length).toBeGreaterThan(0)
  })
})
