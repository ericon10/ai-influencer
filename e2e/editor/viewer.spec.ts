import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'
import { api, snap, uploadFile } from './helpers'

// The Library viewer, filters and collections (owner, 2026-10-17; UX-PLAN.md
// section 34). Everything it needs is made here through the API in demo
// mode: a character of its own, three uploaded images, an uploaded clip,
// a topic slideshow whose two stills a free mock run makes, and a video
// post that uses one upload. Every check is scoped to that character.

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'viewer')
mkdirSync(DIR, { recursive: true })
test.describe.configure({ mode: 'serial' })

type Still = { id: string; assetId: string; sceneTitle: string; op: string }
type Clip = { id: string; assetId: string; title: string; status: string; posterId: string | null }
const RUN = Date.now().toString(36)
let characterId = ''
let uploads: Still[] = []
let made: Still[] = []
let clip: Clip
let usingPost = ''

async function image(name: string, rgb: [number, number, number], w = 900, h = 1600) {
  const path = join(DIR, name)
  writeFileSync(path, await sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer())
  return path
}
const library = async () => api<{ stills: Still[]; clips: Clip[] }>('GET', `/library?characterId=${characterId}`)

test.beforeAll(async () => {
  test.setTimeout(300_000)
  characterId = (await api<{ id: string }>('POST', '/characters', { name: `Viewer ${RUN}` })).id
  // Three uploaded images (free, kept as uploaded).
  const ups = []
  for (const [i, rgb] of ([[200, 120, 90], [60, 140, 200], [90, 180, 110]] as Array<[number, number, number]>).entries()) {
    const name = `view-${RUN}-${i + 1}.png`
    ups.push({ uploadId: await uploadFile(await image(name, rgb), name, 'image/png'), name, type: 'image/png' })
  }
  await api('POST', `/characters/${characterId}/stills`, { uploads: ups })
  // A short clip, prepared by the worker (its first frame becomes its picture).
  const video = join(DIR, `clip-${RUN}.mp4`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=360x640:rate=24', '-pix_fmt', 'yuv420p', video])
  await api('POST', `/characters/${characterId}/clips`, { uploadId: await uploadFile(video, `clip-${RUN}.mp4`, 'video/mp4'), name: `clip-${RUN}.mp4` })
  // A topic slideshow with two slides; its stills from a free mock run.
  const { id: show } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId, title: `Viewer slideshow ${RUN}`, spec: { mode: 'topic', hook: 'the office on day one', slides: ['the desk by the window'] } })
  const action = { type: 'slideshow_stills', contentId: show }
  const est = await api<{ quote: { id: string } }>('POST', '/actions/estimate', { action })
  await api('POST', '/actions/run', { action, quoteId: est.quote.id, confirmed: true })
  await expect.poll(async () => {
    const lib = await library()
    return lib.stills.filter(s => s.op === 'slide_topic').length === 2 && lib.clips.some(c => c.status === 'approved')
  }, { timeout: 180_000, intervals: [2000] }).toBe(true)
  const lib = await library()
  uploads = lib.stills.filter(s => s.op === 'upload_image').sort((a, b) => a.sceneTitle.localeCompare(b.sceneTitle))
  made = lib.stills.filter(s => s.op === 'slide_topic')
  clip = lib.clips.find(c => c.status === 'approved')!
  // A video post that uses the first upload.
  usingPost = (await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId, title: `Uses a still ${RUN}`, spec: { stillId: uploads[0]!.id } })).id
})

// Every request for a file: its asset and the width asked for (none: the full file).
function files(page: Page) {
  const seen: Array<{ id: string; w: number | null }> = []
  page.on('request', (r: Request) => {
    const m = /\/api\/v1\/assets\/([^/]+)\/content(\?.*)?$/.exec(r.url())
    if (!m) return
    const q = new URLSearchParams((m[2] ?? '').slice(1))
    if (q.get('download')) return
    seen.push({ id: m[1]!, w: q.get('w') ? Number(q.get('w')) : null })
  })
  return seen
}
const viewer = (page: Page) => page.getByRole('dialog')
const tile = (page: Page, name: string) => page.getByRole('button', { name: `View ${name}`, exact: true })
const title = (s: Still) => s.sceneTitle

test('the viewer: a still full size, arrows, Esc, X and a tap outside; facts, the posts that use it, Download, Use in a new post; grids load small copies, the viewer the full file', async ({ page }, info) => {
  test.setTimeout(180_000)
  const seen = files(page)
  await page.goto(`/studio/library?tab=stills&c=${characterId}`)
  await expect(tile(page, title(uploads[0]!))).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  // The grid: only small copies (480 wide).
  const grid = seen.filter(x => [...uploads, ...made].some(s => s.assetId === x.id))
  expect(grid.length).toBeGreaterThanOrEqual(5)
  expect(grid.every(x => x.w === 480), JSON.stringify(grid)).toBe(true)
  seen.length = 0

  // Newest first in the grid; open the middle upload.
  const order = await page.locator('.st-scene-tile .st-tile-label').allTextContents()
  const at = order.indexOf(title(uploads[1]!))
  await tile(page, title(uploads[1]!)).click()
  const v = viewer(page)
  await expect(v).toBeVisible()
  await expect(v.getByRole('heading', { name: title(uploads[1]!) })).toBeVisible()
  await expect(v).toHaveAttribute('aria-modal', 'true')
  await expect(v.locator('[data-field="viewer-image"]')).toHaveJSProperty('complete', true)
  await expect(v.locator('[data-field="viewer-model"]')).toHaveText('Uploaded')
  await expect(v.locator('[data-field="viewer-cost"]')).toHaveText('Free (uploaded)')
  await expect(v).toContainText(`Viewer ${RUN}`)
  await expect(v.locator('[data-field="viewer-used"]')).toContainText('Not used in a post yet')
  await expect(v).toContainText(`${at + 1} of ${order.length}`)
  // Only the open item loads its full file; the ones next to it, small copies.
  await expect.poll(() => [...new Set(seen.filter(x => x.w === null).map(x => x.id))]).toEqual([uploads[1]!.assetId])
  expect(seen.filter(x => x.id !== uploads[1]!.assetId).every(x => x.w === 480)).toBe(true)
  await snap(page, info, 'the viewer: a still full size with its facts')

  // Arrow keys and the arrow buttons go to the next and previous items.
  await page.keyboard.press('ArrowRight')
  await expect(v.getByRole('heading', { name: order[at + 1]! })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(v.getByRole('heading', { name: title(uploads[1]!) })).toBeVisible()
  await v.getByRole('button', { name: 'Previous' }).click()
  await expect(v.getByRole('heading', { name: order[at - 1]! })).toBeVisible()
  await v.getByRole('button', { name: 'Next' }).click()
  await expect(v.getByRole('heading', { name: title(uploads[1]!) })).toBeVisible()

  // Esc closes and puts the focus back on the tile.
  await page.keyboard.press('Escape')
  await expect(v).toHaveCount(0)
  await expect(tile(page, title(uploads[1]!))).toBeFocused()
  // The X closes.
  await tile(page, title(uploads[1]!)).click()
  await v.getByRole('button', { name: 'Close' }).click()
  await expect(v).toHaveCount(0)
  // A tap outside the picture closes.
  await tile(page, title(uploads[1]!)).click()
  const stage = (await v.locator('[data-field="viewer-stage"]').boundingBox())!
  await page.mouse.click(stage.x + 8, stage.y + 10)
  await expect(v).toHaveCount(0)
  // Focus stays inside while it is open (Tab wraps).
  await tile(page, title(uploads[1]!)).click()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  expect(await v.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')

  // The upload a post uses: the post is named, and its link opens it.
  await tile(page, title(uploads[0]!)).click()
  await expect(v.locator('[data-field="viewer-used"]')).toContainText('Used in 1 post')
  await expect(v.getByRole('link', { name: `Uses a still ${RUN}` })).toHaveAttribute('href', `/studio/posts/${usingPost}`)
  // Download: the original file under its name.
  const dl = page.waitForEvent('download')
  await v.locator('[data-field="viewer-download"]').click()
  const file = await dl
  expect(file.suggestedFilename()).toBe(`${title(uploads[0]!)}.png`)
  await page.keyboard.press('Escape')

  // A still a run made: the model it ran on and its cost (free in demo).
  await tile(page, made[0]!.sceneTitle).first().click()
  await expect(v.locator('[data-field="viewer-model"]')).not.toHaveText('Uploaded')
  await expect(v.locator('[data-field="viewer-model"]')).toHaveText(/\S/)
  await expect(v.locator('[data-field="viewer-cost"]')).toHaveText('Free (demo)')
  await expect(v.locator('[data-field="viewer-used"]')).toContainText('Used in 1 post')
  await snap(page, info, 'the viewer: a still a mock run made')
  await page.keyboard.press('Escape')

  // Use in a new post, from the viewer: a new video post with the still.
  await tile(page, title(uploads[2]!)).click()
  await v.getByRole('button', { name: 'Use in a new post' }).click()
  await page.waitForURL(/\/studio\/posts\/cnt_/, { timeout: 30_000 })
  const id = /posts\/(cnt_[0-9a-z]+)/.exec(page.url())![1]!
  const post = await api<{ item: { spec: { stillId: string } } }>('GET', `/content/${id}`)
  expect(post.item.spec.stillId).toBe(uploads[2]!.id)
})

test('the viewer: a clip plays with its controls, sound off; the Clips grid loads its picture, not the video', async ({ page }, info) => {
  const seen = files(page)
  await page.goto(`/studio/library?tab=clips&c=${characterId}`)
  await expect(tile(page, clip.title)).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  expect(clip.posterId).toBeTruthy()
  expect(seen.some(x => x.id === clip.posterId && x.w === 480)).toBe(true)
  expect(seen.some(x => x.id === clip.assetId)).toBe(false)
  await tile(page, clip.title).click()
  const video = viewer(page).locator('[data-field="viewer-video"]')
  await expect(video).toBeVisible()
  await expect(video).toHaveAttribute('controls', '')
  await expect(video).toHaveJSProperty('muted', true)
  await expect(viewer(page).locator('[data-field="viewer-model"]')).toHaveText('Uploaded')
  await expect(viewer(page).getByRole('button', { name: 'Make a video post' })).toBeVisible()
  await expect.poll(() => seen.some(x => x.id === clip.assetId && x.w === null)).toBe(true)
  await snap(page, info, 'the viewer: a clip, muted, with controls')
})

test('the viewer in a post: the Library drawer\'s view button, Esc closes only the viewer, Use in this post picks it; a slideshow\'s slide cards open their photos', async ({ page }, info) => {
  const { id: post } = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId, title: `Viewer drawer ${RUN}`, step: 'stills' })
  await page.goto(`/studio/posts/${post}`)
  await page.getByRole('button', { name: 'Pick a still from the Library' }).click()
  const drawer = page.locator('.st-drawer')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: `View ${title(uploads[2]!)} full size` }).click()
  const v = viewer(page).filter({ has: page.locator('[data-field="viewer-stage"]') })
  await expect(v.getByRole('heading', { name: title(uploads[2]!) })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(v).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: `View ${title(uploads[2]!)} full size` }).click()
  await snap(page, info, 'the viewer over the Library drawer in a post')
  await v.getByRole('button', { name: 'Use in this post' }).click()
  await expect(v).toHaveCount(0)
  await expect.poll(async () => (await api<{ item: { spec: { stillId: string | null } } }>('GET', `/content/${post}`)).item.spec.stillId, { timeout: 15_000 }).toBe(uploads[2]!.id)

  // The slideshow's slide cards: a tap on a photo opens it, the other slide beside it.
  const shows = await api<{ items: Array<{ id: string; title: string }> }>('GET', '/content')
  const show = shows.items.find(i => i.title === `Viewer slideshow ${RUN}`)!
  await page.goto(`/studio/posts/${show.id}`)
  await page.locator('.st-step', { hasText: 'Stills' }).click()
  await page.getByRole('button', { name: 'View slide 1 full size' }).click()
  await expect(viewer(page).getByRole('heading', { name: /^Slide 1/ })).toBeVisible()
  await expect(viewer(page).locator('[data-field="viewer-cost"]')).toHaveText('Free (demo)')
  await page.keyboard.press('ArrowRight')
  await expect(viewer(page).getByRole('heading', { name: /^Slide 2/ })).toBeVisible()
  await snap(page, info, 'the viewer from a slideshow slide card')
})

test('filters: model, used, date and the collection, run on the server, as chips with an x, kept per tab in the address', async ({ page }, info) => {
  await page.goto(`/studio/library?tab=stills&c=${characterId}`)
  const tiles = page.locator('.st-scene-tile')
  await expect(tiles).toHaveCount(5, { timeout: 30_000 })
  const filters = page.locator('[data-field="library-filters"]')
  // Model: Uploaded.
  await filters.getByLabel('Model').selectOption('upload')
  await expect(tiles).toHaveCount(3)
  await expect(page.locator('[data-field="library-chips"]')).toContainText('Model: Uploaded')
  expect(page.url()).toContain('stills.model=upload')
  // Used: not used (the first upload is in a post).
  await filters.getByLabel('Used').selectOption('unused')
  await expect(tiles).toHaveCount(1)
  await expect(page.locator('.st-tile-label')).toHaveText([title(uploads[1]!)])
  // A date range that ends before today: nothing matches, with a way out.
  await filters.getByLabel('Date').selectOption('range')
  await filters.getByLabel('From').fill('2026-01-01')
  await filters.getByLabel('To').fill('2026-01-02')
  await expect(page.getByText('Nothing here matches these filters.')).toBeVisible()
  await snap(page, info, 'filters: nothing matches, as chips')
  // Each chip's x clears just that filter.
  await page.getByRole('button', { name: /^Clear Jan 1 to Jan 2/ }).click()
  await expect(tiles).toHaveCount(1)
  await filters.getByLabel('Date').selectOption('today')
  await expect(tiles).toHaveCount(1)
  // The Clips tab keeps its own filters (none); Stills keeps its own.
  await page.getByRole('tab', { name: 'Clips' }).click()
  await expect(page.locator('[data-field="library-chips"]')).toContainText(`Character: Viewer ${RUN}`)
  await expect(page.locator('[data-field="library-chips"]')).not.toContainText('Not used')
  await expect(tiles).toHaveCount(1)
  await page.getByRole('tab', { name: 'Stills' }).click()
  await expect(page.locator('[data-field="library-chips"]')).toContainText('Not used')
  await expect(tiles).toHaveCount(1)
  // A reload keeps them (the address).
  await page.reload()
  await expect(page.locator('[data-field="library-chips"]')).toContainText('Today')
  await expect(tiles).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear Not used' }).click()
  await expect(tiles).toHaveCount(3)
  await page.getByRole('button', { name: 'Clear Model: Uploaded' }).click()
  await expect(tiles).toHaveCount(5)
  // The Model filter lists the model the mock run asked for.
  const options = await filters.getByLabel('Model').locator('option').allTextContents()
  expect(options).toEqual(expect.arrayContaining(['Any model', 'Uploaded', 'Made on the Studio']))
  expect(options.length).toBeGreaterThanOrEqual(4)
})

test('collections: Select, Add to collection (a new name), the Collection filter, Remove from it, rename and delete; the items stay', async ({ page }, info) => {
  const name = `Launch ${RUN}`
  await page.goto(`/studio/library?tab=stills&c=${characterId}`)
  const tiles = page.locator('.st-scene-tile')
  await expect(tiles).toHaveCount(5, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: `Select ${title(uploads[0]!)}` }).click()
  await page.getByRole('button', { name: `Select ${title(uploads[2]!)}` }).click()
  await page.locator('[data-field="add-to-collection"]').click()
  const dialog = page.locator('[data-field="add-to-collection-dialog"]')
  await dialog.getByLabel('New collection name').fill(name)
  await snap(page, info, 'Add to collection')
  await dialog.getByRole('button', { name: `Add to "${name}"` }).click()
  await expect(page.getByText(`Added 2 to "${name}".`)).toBeVisible()
  const filters = page.locator('[data-field="library-filters"]')
  const set = (await api<{ collections: Array<{ id: string; name: string; count: number }> }>('GET', '/library/collections')).collections.find(c => c.name === name)!
  expect(set.count).toBe(2)
  await filters.getByLabel('Collection').selectOption(set.id)
  await expect(tiles).toHaveCount(2)
  await expect(page.locator('[data-field="library-chips"]')).toContainText(`Collection: ${name}`)
  // The viewer names the collection.
  await tile(page, title(uploads[0]!)).click()
  await expect(viewer(page).locator('[data-field="viewer-collections"]')).toContainText(name)
  await page.keyboard.press('Escape')
  // Remove one from it: it stays in the Library.
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: `Select ${title(uploads[2]!)}` }).click()
  await page.getByRole('button', { name: `Remove from ${name}` }).click()
  await expect(tiles).toHaveCount(1)
  // Rename, then delete the collection; every still stays.
  await filters.getByRole('button', { name: 'Collections' }).click()
  const drawer = page.locator('[data-field="collections-drawer"]')
  const field = drawer.getByLabel(`Name of ${name}`)
  await field.fill(`${name} final`)
  await field.press('Enter')
  await expect.poll(async () => (await api<{ collections: Array<{ name: string }> }>('GET', '/library/collections')).collections.some(c => c.name === `${name} final`)).toBe(true)
  await drawer.getByRole('button', { name: `Delete the collection ${name}` }).click()
  await snap(page, info, 'Collections: delete asks first, the items stay')
  await drawer.getByRole('button', { name: 'Delete the collection', exact: true }).click()
  await expect(page.getByText(/Its items stay in the Library/).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tiles).toHaveCount(5)
  expect((await library()).stills).toHaveLength(5)
  expect(page.url()).not.toContain('stills.set=')
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: full screen, a swipe goes to the next item, the facts scroll under it, 44 px tap targets', async ({ page }, info) => {
    await page.goto(`/studio/library?tab=stills&c=${characterId}`)
    await expect(tile(page, title(uploads[1]!))).toBeVisible({ timeout: 30_000 })
    const order = await page.locator('.st-scene-tile .st-tile-label').allTextContents()
    const at = order.indexOf(title(uploads[1]!))
    await tile(page, title(uploads[1]!)).tap()
    const v = viewer(page)
    await expect(v.getByRole('heading', { name: title(uploads[1]!) })).toBeVisible()
    const box = (await v.boundingBox())!
    expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 })
    // A real swipe (touch events from the device): right to left is next.
    const stage = (await v.locator('[data-field="viewer-stage"]').boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    const y = stage.y + stage.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y }] })
    for (const x of [280, 220, 160, 100]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(v.getByRole('heading', { name: order[at + 1]! })).toBeVisible()
    // And back.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y }] })
    for (const x of [140, 200, 260, 320]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(v.getByRole('heading', { name: title(uploads[1]!) })).toBeVisible()
    // The facts and buttons sit under the asset and scroll into view.
    const download = v.locator('[data-field="viewer-download"]')
    await download.scrollIntoViewIfNeeded()
    await expect(download).toBeInViewport()
    expect(await v.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await snap(page, info, 'phone: the facts under the asset')
    for (const b of [v.getByRole('button', { name: 'Close' }), v.getByRole('button', { name: 'Next' }), v.getByRole('button', { name: 'Previous' }), download, v.getByRole('button', { name: 'Use in a new post' })]) {
      const r = (await b.boundingBox())!
      expect(r.height, await b.textContent() ?? '').toBeGreaterThanOrEqual(44)
      expect(r.width, await b.textContent() ?? '').toBeGreaterThanOrEqual(44)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await v.getByRole('button', { name: 'Close' }).tap()
    await expect(v).toHaveCount(0)
  })
})
