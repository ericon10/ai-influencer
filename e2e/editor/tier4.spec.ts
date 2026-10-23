import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { API, api, guideShot, planWithShots, seedData, snap as attach, gotoLaunchPlan } from './helpers'

// Tier 4 (owner, 2026-10-22; UX-PLAN section 36): help chips never on a
// title, generation progress grouped by post, the viewer on Trash and Posts
// thumbnails, and one slideshow made for three platforms. Driven like a
// user, in demo mode.

const SHOTS = join(process.cwd(), 'e2e', '.out', 'shots')
async function snap(page: Page, info: TestInfo, name: string) {
  await attach(page, info, name)
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), await page.screenshot())
}

// Item 25: every help chip ("How this works") sits apart from every title
// and label: no chip's box crosses the words of a heading, a section title
// or a field label, other than its own.
async function chipOverlaps(page: Page): Promise<{ chips: number; hits: string[] }> {
  return page.evaluate(() => {
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    const chips = Array.from(document.querySelectorAll('.gd-howto')).filter(visible)
    const titles = Array.from(document.querySelectorAll('h1, h2, h3, h4, .st-h1, .st-h2, .st-h3, .st-label, .st-kicker, .st-field-label, .st-step-title, label, b, legend, .st-card-head .grow > div:first-child')).filter(visible)
    // The boxes of the words themselves (a title's line may be wider).
    const wordBoxes = (el: Element) => {
      const out: DOMRect[] = []
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent?.trim()) continue
        if ((n.parentElement?.closest('.gd-howto'))) continue
        const r = document.createRange(); r.selectNodeContents(n)
        for (const b of Array.from(r.getClientRects())) if (b.width && b.height) out.push(b)
      }
      return out
    }
    const cross = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
    const hits: string[] = []
    for (const c of chips) {
      const cr = c.getBoundingClientRect()
      for (const t of titles) {
        if (t.contains(c) && wordBoxes(t).length === 0) continue
        for (const w of wordBoxes(t)) {
          if (cross(cr, w)) { hits.push(`"${(c.textContent ?? '').trim()}" on "${(t.textContent ?? '').trim().slice(0, 50)}"`); break }
        }
      }
    }
    // Placement: right after its title on the same line, or right-aligned
    // in its header row; never in a kicker line above a title.
    for (const c of chips) {
      const cr = c.getBoundingClientRect()
      const label = `"${(c.textContent ?? '').trim() || (c as HTMLElement).title}"`
      if (c.closest('.st-kicker')) { hits.push(`${label} sits in a kicker line`); continue }
      const mid = (cr.top + cr.bottom) / 2
      // (A button counts as the title of an area that has none: the chip
      // follows the action it explains.)
      const near = [...titles, ...Array.from(document.querySelectorAll('.st-btn')).filter(visible)]
      const after = near.some(t => wordBoxes(t).some(w => mid > w.top - 4 && mid < w.bottom + 4 && cr.left >= w.right - 2 && cr.left - w.right < 140))
      let row = c.parentElement
      while (row && getComputedStyle(row).display !== 'flex' && getComputedStyle(row).display !== 'inline-flex' && getComputedStyle(row).display !== 'grid') row = row.parentElement
      const rr = row?.getBoundingClientRect()
      // Right in its header: in the right half of its row, with no title
      // words after it on that line (a status badge may follow).
      const right = !!rr && cr.left > rr.left + rr.width / 2 && !titles.some(t => wordBoxes(t).some(w => w.left > cr.right && mid > w.top - 4 && mid < w.bottom + 4))
      if (!after && !right) hits.push(`${label} is neither after a title nor right in its header`)
    }
    return { chips: chips.length, hits: [...new Set(hits)] }
  })
}

async function chipSweep(page: Page, info: TestInfo, phone: boolean, light = false) {
  test.setTimeout(420_000)
  if (light) await page.addInitScript(() => { try { localStorage.setItem('theme_default_v2', '1'); localStorage.setItem('theme', 'light') } catch { /* the sweep still runs */ } })
  const { basePost, callie, recreatePost } = seedData()
  const items = (await api<{ items: Array<{ id: string; kind: string }> }>('GET', '/content')).items
  const batch = items.find(i => i.kind === 'batch')
  const slideshow = items.find(i => i.kind === 'slideshow')
  const pages: string[] = [
    '/studio', `/studio/posts/${basePost}`, `/studio/posts/${recreatePost}`, ...(batch ? [`/studio/posts/${batch.id}`] : []), ...(slideshow ? [`/studio/posts/${slideshow.id}`] : []),
    '/studio/characters', '/studio/weeks', '/studio/accounts', '/studio/line-bank', `/studio/characters/${callie}`, '/studio/library', '/studio/library?tab=trash', '/studio/settings', '/studio/settings?tab=rules', '/studio/settings?tab=usage', '/studio/guide',
  ]
  const found: string[] = []
  let chips = 0
  if (light) { await page.goto('/studio/posts'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light') }
  for (const url of pages) {
    await page.goto(url)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(800)
    const steps = url.includes('/posts/') ? await page.locator('.st-poststeps button').count() : 0
    for (let i = 0; i <= steps; i++) {
      if (i > 0) { await page.locator('.st-poststeps button').nth(i - 1).click().catch(() => undefined); await page.waitForTimeout(700) }
      const r = await chipOverlaps(page)
      chips += r.chips
      for (const h of r.hits) found.push(`${light ? 'light ' : ''}${url}${i ? ` step ${i}` : ''}: ${h}`)
    }
  }
  console.log(`[chips] ${chips} chips checked on ${pages.length} pages${phone ? ' (phone)' : ''}`)
  await snap(page, info, `${phone ? 'phone: ' : ''}help chips sweep, last page`)
  expect(chips).toBeGreaterThan(20)
  expect([...new Set(found)]).toEqual([])
}

// Item 26: Generate 2 posts from the launch plan, scrolled away: one line
// per post on the card ("P007: 4 of 6 stills done") and one toast per post
// when its stills are in, never one toast per still.
interface PlanPost { id: string; rowId: string; account: string; need: number; have: number }
const planPosts = async () => (await api<{ posts: PlanPost[] }>('GET', '/plan')).posts
async function planDrafts(): Promise<PlanPost[]> {
  if ((await planPosts()).some(p => p.account === 'F2' && p.have < p.need)) return planPosts()
  const csv = readFileSync(planWithShots(), 'utf8')
  const sideStep = seedData().sideStep
  const { rows } = await api<{ rows: { rowId: string; account: string }[] }>('POST', '/plan/preview', { csv, productId: sideStep })
  await api('POST', '/plan/import', { csv, productId: sideStep, rows: rows.filter(r => r.account === 'F2').map(r => r.rowId), mode: 'add' })
  return planPosts()
}
async function pay(page: Page, button: Locator) {
  await expect(button).toContainText(/\$\d|credits|Free/, { timeout: 30_000 })
  await button.click()
  const confirm = page.getByRole('button', { name: /^Confirm / })
  if (await confirm.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirm.first().click()
}

async function progress(page: Page, info: TestInfo) {
  test.setTimeout(420_000)
  // Every toast shown, kept as it appears (they leave after a few seconds).
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __toasts: string[] }).__toasts = [])
    new MutationObserver(() => { for (const t of Array.from(document.querySelectorAll('.st-toast'))) { const k = (t as HTMLElement).dataset.seen; if (!k) { (t as HTMLElement).dataset.seen = '1'; seen.push((t.textContent ?? '').trim()) } } }).observe(document, { childList: true, subtree: true })
  })
  const need = (await planDrafts()).filter(p => p.account === 'F2' && p.have < p.need).slice(0, 2)
  expect(need).toHaveLength(2)
  await gotoLaunchPlan(page)
  const card = page.locator('[data-field="launch-plan"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const head = card.getByRole('button', { name: /Launch plan/ })
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  const posts = card.locator('[data-field="plan-posts"]')
  await posts.getByLabel('Account').selectOption('F2')
  for (const p of need) await posts.getByLabel(`Pick ${p.rowId}`).check()
  await pay(page, posts.getByRole('button', { name: /^Generate 2 posts/ }))
  // One line per post while it runs.
  const line = card.locator('[data-field="post-progress"]')
  await expect(line.first()).toContainText(new RegExp(`^(${need.map(n => n.rowId).join('|')}): \\d+ of \\d+ stills done`), { timeout: 60_000 })
  await line.first().scrollIntoViewIfNeeded()
  await snap(page, info, 'progress grouped by post')
  // Scroll away: the toasts tell it, one per post.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator('.st-pagehead').first().scrollIntoViewIfNeeded()
  await card.evaluate(el => { el.style.marginTop = '4000px' })
  await expect.poll(async () => (await planPosts()).filter(p => need.some(n => n.id === p.id)).every(p => p.have >= p.need), { timeout: 240_000, intervals: [3000] }).toBe(true)
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)).filter(t => /^P\d+: \d+ of \d+ stills done/.test(t)).length, { timeout: 30_000 }).toBe(2)
  const toasts = await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)
  console.log('[toasts]', JSON.stringify(toasts))
  // Never a toast for a single still.
  expect(toasts.filter(t => /slide \d|still \d|: done\./i.test(t))).toEqual([])
  for (const n of need) expect(toasts.some(t => t.startsWith(`${n.rowId}: `))).toBe(true)
}

// Item 27: the viewer from a Trash tile and from a post's cover on Posts
// home; Restore in the viewer and Open the post from it.
async function viewers(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(240_000)
  const press = (l: Locator) => (phone ? l.tap() : l.click())
  // Posts home: a post with a picture opens full size from its cover.
  await page.goto('/studio')
  const view = page.getByRole('button', { name: /^View .* full size$/ }).first()
  await expect(view).toBeVisible({ timeout: 30_000 })
  await press(view)
  const dialog = page.locator('[data-field="viewer"]')
  await expect(dialog).toBeVisible()
  await snap(page, info, `${phone ? 'phone: ' : ''}a post's picture in the viewer`)
  await press(dialog.getByRole('button', { name: 'Open the post' }))
  await expect(page).toHaveURL(/\/studio\/posts\/cnt_/)
  // The Trash: a still moved there opens full size, and Restore from the
  // viewer puts it back (the seed's still, restored by the test itself).
  const still = seedData().stills[0]!
  const { ids } = await api<{ ids: string[] }>('POST', '/trash', { items: [{ kind: 'candidate', id: still }] })
  try {
    await page.goto('/studio/library?tab=trash')
    const tile = page.getByRole('button', { name: /^View .* full size$/ }).first()
    await expect(tile).toBeVisible({ timeout: 30_000 })
    await press(tile)
    await expect(dialog).toBeVisible()
    await snap(page, info, `${phone ? 'phone: ' : ''}a Trash item in the viewer`)
    await press(dialog.getByRole('button', { name: 'Restore' }))
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await api<{ items: Array<{ id: string }> }>('GET', '/trash')).items.some(x => ids.includes(x.id)), { timeout: 20_000 }).toBe(false)
  } finally {
    await api('POST', '/trash/restore', { ids }).catch(() => undefined)
  }
}

// The Guide's pictures of the pages this tier changed (item 27: refresh
// the Guide screenshots): Posts home, Library, its Trash, Characters. The
// files are written only with GUIDE_SHOTS=1; the checks always run.
async function guidePictures(page: Page) {
  test.setTimeout(240_000)
  const write = !!process.env.GUIDE_SHOTS
  const shot = async (box: ReturnType<Page['locator']>, id: string, spots: Array<[ReturnType<Page['locator']>, string]>) => {
    for (const [l] of spots) await expect(l.first()).toBeVisible({ timeout: 30_000 })
    if (write) await guideShot(page, box, id, spots)
  }
  await page.goto('/studio')
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const main = page.locator('main')
  await shot(main, 'posts-home', [
    [page.locator('.st-pagehead .gd-howto'), 'The Guide for this page, right after its title'], [page.locator('[data-field="posts-moved"]'), 'A week\'s plan is on Weeks, each account on Accounts'],
    [page.locator('.st-postcard').first(), 'A post: open it to keep going where you left off'], [page.locator('.st-postcard-view').first(), 'Its picture full size, in the viewer'],
  ])
  await page.goto('/studio/library')
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await shot(main, 'library', [
    [page.locator('.st-pagehead .gd-howto'), 'The Guide for this page, right after its title'], [page.getByRole('tab', { name: /Stills/ }).first(), 'Stills you made'], [page.locator('main .st-grid').first(), 'Open any item full size, or start a new post from it'],
  ])
  await page.goto('/studio/characters')
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await shot(main, 'characters', [
    [page.locator('.st-pagehead .gd-howto'), 'The Guide for this page, right after its title'], [page.locator('.st-casting').first(), 'A character: open it to see the setup steps'],
  ])
  const still = seedData().stills[1]!
  const { ids } = await api<{ ids: string[] }>('POST', '/trash', { items: [{ kind: 'candidate', id: still }] })
  try {
    await page.goto('/studio/library?tab=trash')
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await shot(main, 'library-trash', [
      [page.locator('[data-field="library-trash"] .gd-howto'), 'About the Trash'], [page.getByRole('button', { name: /^View .* full size$/ }).first(), 'Tap one to see it full size (Restore is there too)'],
      [page.locator('[data-field="library-trash"] .st-badge').first(), 'Days left before it is removed for good'], [page.locator('[data-field="library-trash"]').getByRole('button', { name: 'Restore' }).first(), 'Restore puts it back where it was'],
    ])
  } finally {
    await api('POST', '/trash/restore', { ids }).catch(() => undefined)
  }
}

// Item 28: a finished slideshow made for three platforms in one free
// click: the carousel (1080 x 1440), the reel (1080 x 1920, 2 to 3 s a
// slide, silent) and the Shorts copy, in one zip.
async function threePlatforms(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(420_000)
  const press = (l: Locator) => (phone ? l.tap() : l.click())
  // A plan post with its pictures (the progress test made them).
  const done = (await planDrafts()).find(p => p.have >= p.need && p.need > 0)
  expect(done).toBeTruthy()
  await page.goto(`/studio/posts/${done!.id}`)
  await press(page.locator('.st-poststeps button').filter({ hasText: 'Finish' }).first())
  const out = page.locator('[data-field="slideshow-outputs"]')
  if (!(await out.isVisible({ timeout: 3000 }).catch(() => false))) {
    const exp = page.getByRole('button', { name: /^Export images/ })
    await expect(exp).toBeEnabled({ timeout: 30_000 })
    await press(exp)
    await expect(out).toBeVisible({ timeout: 120_000 })
  }
  type Out = { outputs: { platforms?: { madeAt: string } } }
  const before = (await api<{ item: Out }>('GET', `/content/${done!.id}`)).item.outputs.platforms?.madeAt ?? ''
  const card = page.locator('[data-field="three-platforms"]')
  await card.scrollIntoViewIfNeeded()
  await press(card.getByRole('button', { name: /^Make (all three|them again) \(free\)$/ }))
  // A set made by this click (an earlier run's set may already show).
  await expect.poll(async () => (await api<{ item: Out }>('GET', `/content/${done!.id}`)).item.outputs.platforms?.madeAt ?? '', { timeout: 180_000, intervals: [2000] }).not.toBe(before)
  const set = card.locator('[data-field="platform-set"]')
  await expect(set).toBeVisible({ timeout: 180_000 })
  await expect(set.locator('video')).toHaveCount(2)
  await set.scrollIntoViewIfNeeded()
  await snap(page, info, `${phone ? 'phone: ' : ''}one post, three platforms`)
  if (!phone && process.env.GUIDE_SHOTS) {
    // This Chromium has no H.264, so the players would show a spinner
    // forever: the picture shows their posters (the files are checked below).
    await set.locator('video').evaluateAll(v => v.forEach(x => { x.removeAttribute('src'); x.removeAttribute('controls'); (x as HTMLVideoElement).load() }))
    await guideShot(page, card, 'slideshow-platforms', [
      [card.getByRole('button', { name: /^Make them again \(free\)$/ }), 'One free click: the carousel, the reel and the Shorts copy'],
      [set.locator('video').first(), 'The reel: 2 to 3 s a slide, a slow zoom, silent (add the sound in the app)'],
      [card.getByText(/^Download all three/).first(), 'Everything in one zip, with the caption'],
    ])
  }
  const item = (await api<{ item: { outputs: { imageAssetIds: string[]; platforms: { carouselIds: string[]; reelId: string; shortsId: string; zipId: string; slideSec: number[]; reelSec: number } } } }>('GET', `/content/${done!.id}`)).item
  const p = item.outputs.platforms
  expect(p.carouselIds).toHaveLength(item.outputs.imageAssetIds.length)
  expect(p.slideSec.every(x => x >= 2 && x <= 3)).toBe(true)
  // The files themselves: sizes, length, no sound; the zip's parts.
  const probe = (id: string) => {
    const file = join(process.cwd(), 'e2e', '.out', `${id}.mp4`)
    return fetch(`${API}/assets/${id}/content`).then(r => r.arrayBuffer()).then(b => {
      writeFileSync(file, Buffer.from(b))
      return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]).toString()) as { streams: Array<{ codec_type: string; width?: number; height?: number }>; format: { duration: string } }
    })
  }
  for (const id of [p.reelId, p.shortsId]) {
    const r = await probe(id)
    expect(r.streams.map(x => x.codec_type)).toEqual(['video'])
    expect([r.streams[0]!.width, r.streams[0]!.height]).toEqual([1080, 1920])
    expect(Math.abs(Number(r.format.duration) - p.slideSec.reduce((a, b) => a + b, 0))).toBeLessThan(0.5)
  }
  const zip = unzipSync(new Uint8Array(await (await fetch(`${API}/assets/${p.zipId}/content`)).arrayBuffer()))
  expect(Object.keys(zip).filter(k => k.startsWith('carousel/'))).toHaveLength(p.carouselIds.length)
  expect(Object.keys(zip)).toEqual(expect.arrayContaining(['reel.mp4', 'shorts.mp4', 'caption.txt']))
  const sharp = (await import('sharp')).default
  const meta = await sharp(Buffer.from(zip[Object.keys(zip).find(k => k.startsWith('carousel/'))!]!)).metadata()
  expect([meta.width, meta.height]).toEqual([1080, 1440])
}

test.describe.configure({ mode: 'serial' })

test('every help chip sits after its title or right in its header, never on a title, on every page and post step', async ({ page }, info) => { await chipSweep(page, info, false) })

test('generation progress is grouped by post: one line and one toast per post, never one per still', async ({ page }, info) => { await progress(page, info) })
test('the viewer opens from a post\'s cover and from a Trash tile; Open the post and Restore from it', async ({ page }, info) => { await viewers(page, info, false) })
test('one post, three platforms: the carousel, the reel and the Shorts copy in one free click', async ({ page }, info) => { await threePlatforms(page, info, false) })
test('the Guide\'s pictures of Posts home, Library, Characters and the Trash show the chips and the viewer', async ({ page }) => { await guidePictures(page) })
test('light theme: every help chip sits after its title or right in its header', async ({ page }, info) => { await chipSweep(page, info, false, true) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: one post, three platforms', async ({ page }, info) => { await threePlatforms(page, info, true) })
  test('phone: the viewer from a cover and from the Trash', async ({ page }, info) => { await viewers(page, info, true) })
  test('phone: every help chip sits apart from every title', async ({ page }, info) => { await chipSweep(page, info, true) })
})
