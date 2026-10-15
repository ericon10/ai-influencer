import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'
import sharp from 'sharp'
import { api, seedPost, snap, uploadFile } from './helpers'
import { emptyTransfer, LIVE, startLive, type Live } from './r2'

// Storage, traffic and auto-clean (owner, 2026-10-15), driven like a user
// on the live site's media path: Delete one item (Undo), Select many,
// the warning for an item a post uses, the Trash and Restore, Settings >
// Storage (the readout, Measure now, Auto-clean), images and thumbnails by
// redirect, and the Studio's own transfer for a normal session under the
// old rules and the new.

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '.out')
const DIR = join(OUT, 'storage')
mkdirSync(DIR, { recursive: true })
let live: Live
test.beforeAll(async () => { live = await startLive() })
test.afterAll(async () => { await live.close() })

type Still = { id: string; assetId: string; sceneTitle: string; characterId: string; op: string }

// Uploaded images with names unique to this run, as kept stills.
async function stills(characterId: string, tag: string, n: number): Promise<Still[]> {
  const run = `${tag}-${Date.now().toString(36)}`
  const ups: { uploadId: string; name: string; type: string }[] = []
  for (let i = 0; i < n; i++) {
    const name = `${run}-${i + 1}.png`
    const path = join(DIR, name)
    writeFileSync(path, await sharp({ create: { width: 720, height: 1280, channels: 3, background: { r: 40 + i * 50, g: 120, b: 200 - i * 40 } } }).png().toBuffer())
    ups.push({ uploadId: await uploadFile(path, name, 'image/png'), name, type: 'image/png' })
  }
  await api('POST', `/characters/${characterId}/stills`, { uploads: ups })
  const lib = await api<{ stills: Still[] }>('GET', `/library?characterId=${characterId}`)
  return lib.stills.filter(s => s.sceneTitle.startsWith(run)).sort((a, b) => a.sceneTitle.localeCompare(b.sceneTitle))
}
const characterOf = async (post: string) => (await api<{ items: { id: string; characterId: string }[] }>('GET', '/content')).items.find(i => i.id === post)!.characterId
const inLibrary = async (characterId: string, id: string) => (await api<{ stills: Still[] }>('GET', `/library?characterId=${characterId}`)).stills.some(s => s.id === id)
const inTrash = async (refId: string) => (await api<{ items: { refId: string; daysLeft: number; reason: string }[] }>('GET', '/trash')).items.find(t => t.refId === refId) ?? null
const tile = (page: Page, name: string) => page.locator('.st-tile').filter({ has: page.locator('.st-tile-label', { hasText: name }) })

async function openStills(page: Page, characterId: string) {
  await page.goto(`${LIVE}/studio/library?tab=stills&c=${characterId}`)
  await page.locator('[data-field="still-upload"]').waitFor({ timeout: 30_000 })
}

test('Library: Delete one still goes to the Trash with Undo; a still a post uses warns first', async ({ page }, info) => {
  test.setTimeout(240_000)
  const post = await seedPost()
  const characterId = await characterOf(post)
  const [one, used] = await stills(characterId, 'del', 2)
  // A post that uses the second still.
  const { id: usingPost } = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId, title: 'Uses the still', spec: { stillId: used!.id } })
  await openStills(page, characterId)

  // One click: no warning, straight to the Trash, Undo in the toast.
  await tile(page, one!.sceneTitle).getByRole('button', { name: `Delete ${one!.sceneTitle}` }).click()
  await expect(page.getByText(`Moved "${one!.sceneTitle}" to the Trash. It stays there 7 days.`)).toBeVisible()
  await snap(page, info, 'Library: a still deleted, with Undo')
  await expect.poll(() => inLibrary(characterId, one!.id)).toBe(false)
  expect((await inTrash(one!.id))?.daysLeft).toBe(7)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => inLibrary(characterId, one!.id)).toBe(true)
  await expect(tile(page, one!.sceneTitle)).toBeVisible()
  expect(await inTrash(one!.id)).toBeNull()

  // Used in a post: asks first, names the post, and Cancel keeps it.
  await tile(page, used!.sceneTitle).getByRole('button', { name: `Delete ${used!.sceneTitle}` }).click()
  const warn = page.locator('[data-field="trash-warn"]')
  await expect(warn).toContainText('Used in 1 post: Uses the still')
  await snap(page, info, 'Library: the warning for a still a post uses')
  await warn.getByRole('button', { name: 'Cancel' }).click()
  await expect(warn).toBeHidden()
  expect(await inLibrary(characterId, used!.id)).toBe(true)
  // Move it anyway; the post keeps working until the Trash empties.
  await tile(page, used!.sceneTitle).getByRole('button', { name: `Delete ${used!.sceneTitle}` }).click()
  await warn.getByRole('button', { name: 'Move to the Trash anyway' }).click()
  await expect.poll(() => inLibrary(characterId, used!.id)).toBe(false)
  await api('POST', '/trash/restore', { ids: [(await api<{ items: { id: string; refId: string }[] }>('GET', '/trash')).items.find(t => t.refId === used!.id)!.id] })
  await api('DELETE', `/content/${usingPost}`).catch(() => undefined)
})

test('Library: Select several, Delete them together, then Restore them from the Trash', async ({ page }, info) => {
  test.setTimeout(240_000)
  const characterId = await characterOf(await seedPost())
  const picked = await stills(characterId, 'sel', 3)
  await openStills(page, characterId)
  await page.locator('[data-field="library-select"]').click()
  for (const s of picked) await tile(page, s.sceneTitle).getByRole('button', { name: `Select ${s.sceneTitle}` }).click()
  const bar = page.locator('[data-field="library-selectbar"]')
  await expect(bar).toContainText('3 selected')
  await snap(page, info, 'Library: Select mode, three stills picked')
  await bar.getByRole('button', { name: /^Delete 3/ }).click()
  await expect(page.getByText('Moved 3 items to the Trash. They stay there 7 days.')).toBeVisible()
  for (const s of picked) await expect.poll(() => inLibrary(characterId, s.id)).toBe(false)

  // The Trash: days left, who deleted it, Restore many.
  await page.getByRole('tab', { name: 'Trash' }).click()
  const trash = page.locator('[data-field="library-trash"]')
  for (const s of picked) await expect(tile(page, s.sceneTitle)).toContainText('Deleted by you')
  await expect(tile(page, picked[0]!.sceneTitle)).toContainText('7 days left')
  await snap(page, info, 'Library > Trash')
  await trash.getByRole('button', { name: 'Select', exact: true }).click()
  for (const s of picked.slice(0, 2)) await tile(page, s.sceneTitle).getByRole('button', { name: `Select ${s.sceneTitle}` }).click()
  await page.locator('[data-field="library-selectbar"]').getByRole('button', { name: /^Restore 2/ }).click()
  await expect(page.getByText('Restored 2 items.')).toBeVisible()
  await tile(page, picked[2]!.sceneTitle).getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText(`Restored "${picked[2]!.sceneTitle}".`)).toBeVisible()
  for (const s of picked) await expect.poll(() => inLibrary(characterId, s.id)).toBe(true)
})

test('Settings > Storage: the readout, Measure now, and Auto-clean (a choice or Off)', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto(`${LIVE}/studio/settings`)
  const card = page.locator('[data-field="settings-storage"]')
  await card.waitFor({ timeout: 30_000 })
  await card.getByRole('button', { name: 'Measure now' }).click()
  await expect(card.locator('[data-field="storage-usage"]')).toContainText(/GB/, { timeout: 90_000 })
  await expect(card.locator('[data-field="storage-usage"]')).toContainText(/a month/)
  const auto = card.getByRole('radiogroup', { name: 'Auto-clean' })
  await auto.getByRole('radio', { name: 'Off' }).click()
  await expect.poll(async () => (await api<{ autoCleanDays: number | null }>('GET', '/settings/storage')).autoCleanDays).toBeNull()
  await auto.getByRole('radio', { name: '30 days' }).click()
  await expect.poll(async () => (await api<{ autoCleanDays: number | null }>('GET', '/settings/storage')).autoCleanDays).toBe(30)
  await auto.getByRole('radio', { name: '14 days' }).click()
  await expect.poll(async () => (await api<{ autoCleanDays: number | null }>('GET', '/settings/storage')).autoCleanDays).toBe(14)
  await card.scrollIntoViewIfNeeded()
  await snap(page, info, 'Settings > Storage')
})

test('images come from storage: grids ask for thumbnails, the Studio sends no image bytes', async ({ page }, info) => {
  test.setTimeout(180_000)
  const characterId = await characterOf(await seedPost())
  await stills(characterId, 'thumb', 2)
  live.hits.length = 0
  live.transfer = emptyTransfer()
  await openStills(page, characterId)
  await page.locator('.st-scene-tile img').first().waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  const images = live.hits.filter(x => x.w)
  expect(images.length).toBeGreaterThan(0)
  expect(images.every(x => x.w === 480)).toBe(true)
  expect(live.transfer.media).toBe(0)
  expect(live.transfer.redirects).toBeGreaterThan(0)
  await snap(page, info, 'Library > Stills: thumbnails straight from storage')
})

// Photo-like 2K stills (1536 x 2752, several MB each as PNG, like the
// stills Nano Banana returns): the local mock images are tiny, which would
// make the old rules look cheap.
async function realisticStills(characterId: string, n: number): Promise<number> {
  const marker = join(DIR, `realistic-${characterId}.txt`)
  if (existsSync(marker)) return Number(readFileSync(marker, 'utf8'))
  const W = 1536, H = 2752
  let bytes = 0
  const ups: { uploadId: string; name: string; type: string }[] = []
  for (let i = 0; i < n; i++) {
    const raw = Buffer.alloc(W * H * 3)
    let x = 2463534242 + i * 7919
    for (let p = 0; p < raw.length; p += 3) {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0
      const row = Math.floor(p / 3 / W) / H
      raw[p] = 150 + (x & 63) - row * 60; raw[p + 1] = 110 + ((x >>> 8) & 63) - row * 40; raw[p + 2] = 90 + ((x >>> 16) & 63)
    }
    const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).blur(1.4).png().toBuffer()
    const name = `transfer-${i + 1}.png`
    const path = join(DIR, name)
    writeFileSync(path, png)
    bytes += png.length
    ups.push({ uploadId: await uploadFile(path, name, 'image/png'), name, type: 'image/png' })
    if (ups.length === 6 || i === n - 1) { await api('POST', `/characters/${characterId}/stills`, { uploads: ups.splice(0) }) }
  }
  writeFileSync(marker, String(Math.round(bytes / n)))
  return Math.round(bytes / n)
}

// A normal session: Posts home, the Library's stills (all characters, then
// one character's 2K stills) and clips, a post open at its steps, a
// Recreate post, Settings. A fresh browser each time (nothing cached).
async function session(browser: Browser, mode: 'through' | 'redirect', characterId: string) {
  live.images = mode
  live.transfer = emptyTransfer()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const go = async (path: string) => { await page.goto(`${LIVE}${path}`); await page.waitForLoadState('networkidle').catch(() => undefined); await page.waitForTimeout(800) }
  const scroll = async () => { for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(300) } await page.waitForLoadState('networkidle').catch(() => undefined) }
  await go('/studio')
  await go('/studio/library?tab=stills')
  await scroll()
  await go(`/studio/library?tab=stills&c=${characterId}`)
  await scroll()
  await go('/studio/library?tab=clips')
  const { items } = await api<{ items: { id: string; kind: string; step: string }[] }>('GET', '/content')
  const post = items.find(i => i.kind === 'slideshow') ?? items[0]!
  await go(`/studio/posts/${post.id}`)
  const recreate = join(OUT, 'cache', 'recreate-post.txt')
  if (existsSync(recreate)) await go(`/studio/posts/${readFileSync(recreate, 'utf8').trim()}`)
  await go('/studio/settings')
  const t = { ...live.transfer, byPath: Object.fromEntries(Object.entries(live.transfer.byPath).sort((a, b) => b[1] - a[1]).slice(0, 8)) }
  await ctx.close()
  live.images = 'redirect'
  return t
}

test('transfer: the Studio\'s own bytes for a normal session, old rules and new', async ({ browser }, info) => {
  test.setTimeout(600_000)
  const characterId = await characterOf(await seedPost())
  const avgStill = await realisticStills(characterId, 12)
  const before = await session(browser, 'through', characterId)
  const after = await session(browser, 'redirect', characterId)
  const mb = (n: number) => Math.round(n / 1e4) / 100
  const report = {
    note: 'Measured locally on the live-site path (a proxy playing the deployed Studio, a fake R2), same client, old serving rules (image bytes through the Studio) and new (every file a redirect). Bytes the Studio API sent: what Vercel counts as origin transfer. Static files are not counted.',
    session: 'Posts home, Library > Stills (all, then 12 photo-like 2K stills of one character), Library > Clips, a post, a Recreate post, Settings; fresh browser, nothing cached',
    averageStillMb: mb(avgStill),
    before: { ...before, totalMb: mb(before.json + before.media), jsonMb: mb(before.json), mediaMb: mb(before.media) },
    after: { ...after, totalMb: mb(after.json + after.media), jsonMb: mb(after.json), mediaMb: mb(after.media) },
  }
  writeFileSync(join(OUT, 'transfer.json'), JSON.stringify(report, null, 2))
  await info.attach('transfer.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  expect(after.media).toBe(0)
  expect(before.media).toBeGreaterThan(after.media)
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: Delete a still and Restore it from the Trash', async ({ page }, info) => {
    test.setTimeout(180_000)
    const characterId = await characterOf(await seedPost())
    const [s] = await stills(characterId, 'phone', 1)
    await openStills(page, characterId)
    await tile(page, s!.sceneTitle).getByRole('button', { name: `Delete ${s!.sceneTitle}` }).tap()
    await expect(page.getByText(`Moved "${s!.sceneTitle}" to the Trash. It stays there 7 days.`)).toBeVisible()
    await expect.poll(() => inLibrary(characterId, s!.id)).toBe(false)
    // The tab row scrolls inside itself; the page never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await page.getByRole('tab', { name: 'Trash' }).tap()
    await tile(page, s!.sceneTitle).scrollIntoViewIfNeeded()
    await snap(page, info, 'phone: Library > Trash')
    await tile(page, s!.sceneTitle).getByRole('button', { name: 'Restore' }).tap()
    await expect.poll(() => inLibrary(characterId, s!.id)).toBe(true)
  })
})
