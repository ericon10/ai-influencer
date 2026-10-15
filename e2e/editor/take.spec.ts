import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { api, captionBlocks, clipBlocks, seedPost, seek, snap } from './helpers'
import { editorReady, LIVE, startLive, type Live } from './r2'

// The editor opens with the take (owner, 2026-10-15): "Open editor brings
// in the caption but not the take I picked." The Studio runs here behind a
// proxy that serves media the way the live site does (see r2.ts), with the
// browser's cache on. The editor is opened from every path, by clicks: a
// Recreate review (Use this take), a finished post, Library > Clips, and
// Make another like this.

let live: Live
test.beforeAll(async () => { live = await startLive() })
test.afterAll(async () => { await live.close() })
test.beforeEach(() => { live.refuse = false; live.keptRedirect = false; live.hits = []; live.proxied = 0 })

type Item = { id: string; kind: string; status: string; characterId: string | null; spec?: Record<string, any> }
const posts = async () => (await api<{ items: Item[] }>('GET', '/content')).items

// What the post should put on the timeline: its shots and their lengths.
async function expected(post: string) {
  const m = await api<{ media: { id: string; role: string; in: number; out: number | null }[]; captions: { text: string }[] }>('GET', `/content/${post}/editor`)
  return { shots: m.media.filter(x => x.role === 'clip'), captions: m.captions }
}

// The post page plays the take in a <video>, as the review does: the
// browser keeps storage's answer, which has no CORS header.
async function playOnPostPage(page: Page, post: string, assetId: string) {
  await page.goto(`${LIVE}/studio/posts/${post}`)
  await page.locator('.st-stepper, [data-field="step-video"]').first().waitFor({ timeout: 30_000 })
  const played = await page.evaluate(id => new Promise<boolean>(done => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.oncanplaythrough = () => done(true)
    v.onerror = () => done(false)
    v.src = `/api/v1/assets/${id}/content`
    document.body.append(v)
  }), assetId)
  expect(played).toBe(true)
}

// The clip blocks' lengths in seconds, read from the timeline.
async function blockSeconds(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const root = document.querySelector('#editor-panel-timeline')!
    const ticks = [...root.querySelectorAll('*')].filter(e => e.children.length === 0 && /^00:0[05]$/.test((e.textContent ?? '').trim()))
      .map(e => ({ t: (e.textContent ?? '').trim(), r: e.getBoundingClientRect() })).filter(e => e.r.height > 0)
    const top = Math.min(...ticks.map(t => t.r.y))
    const row = ticks.filter(t => t.r.y < top + 4)
    const pps = (row.find(t => t.t === '00:05')!.r.x - row.find(t => t.t === '00:00')!.r.x) / 5
    return [...root.querySelectorAll('[aria-label^="Select clip"]')].map(b => Math.round((b.getBoundingClientRect().width / pps) * 10) / 10)
  })
}

// The take is on the timeline at its reviewed length, with the caption when
// one is on, and nothing is named as missing in the bar.
async function takeIsThere(page: Page, post: string, info: TestInfo, name: string) {
  await editorReady(page)
  const want = await expected(post)
  await expect(page.getByRole('status').filter({ hasText: 'Opened without' })).toHaveCount(0)
  await expect(clipBlocks(page)).toHaveCount(want.shots.length)
  const lengths = await blockSeconds(page)
  for (const [i, s] of want.shots.entries()) if (s.out != null) expect(Math.abs(lengths[i]! - (s.out - s.in))).toBeLessThan(0.3)
  if (want.captions.length) await expect(captionBlocks(page).first()).toBeVisible()
  else await expect(captionBlocks(page)).toHaveCount(0)
  expect(live.hits.some(h => h.cors && want.shots.some(s => s.id === h.id))).toBe(true)
  // A click on the ruler draws the frame there in the player.
  await seek(page, 1)
  await page.waitForTimeout(800)
  await snap(page, info, name)
}

const toFinish = async (page: Page, post: string) => {
  await page.goto(`${LIVE}/studio/posts/${post}?step=finish`)
  await page.locator('[data-field="post-timeline"]').waitFor({ timeout: 30_000 })
}
const openFromFinish = async (page: Page) => {
  await page.locator('[data-field="post-timeline"]').getByRole('button', { name: /Open the editor/ }).click()
  await page.waitForURL(/\/editor\/\?studio=/, { timeout: 30_000 })
}

test('the live failure, reproduced: after the post page plays the take, the old fetch is refused; the editor still gets the take', async ({ page }, info) => {
  const post = await seedPost()
  const { shots } = await expected(post)
  live.keptRedirect = true
  await playOnPostPage(page, post, shots[0]!.id)
  await page.goto(`${LIVE}/editor/?studio=${post}`)
  // The old way: the kept redirect, then storage's kept answer without a
  // CORS header. This is what kept the take off the timeline.
  const old = await page.evaluate(id => fetch(`/api/v1/assets/${id}/content`, { credentials: 'same-origin' }).then(r => r.ok).catch(() => false), shots[0]!.id)
  expect(old).toBe(false)
  // The new way: a fresh direct link, never the kept copy.
  await takeIsThere(page, post, info, 'the take after the post page played it')
})

test('storage refuses the browser: the Studio sends the file in parts', async ({ page }, info) => {
  const post = await seedPost()
  live.refuse = true
  await page.goto(`${LIVE}/editor/?studio=${post}`)
  await editorReady(page)
  await expect(clipBlocks(page)).toHaveCount(1)
  expect(live.proxied).toBeGreaterThan(0)
  await snap(page, info, 'take through the Studio in parts')
})

test('every path opens the editor with the take: Recreate review, a finished post, Library, Make another like this', async ({ page }, info) => {
  test.setTimeout(600_000)
  const all = await posts()

  // 1. A Recreate review: Keep and Use this take, then Open the editor.
  let rec: Item | undefined
  for (const p of all.filter(p => p.kind === 'meme' && p.spec?.clone?.assetId && p.characterId)) {
    const { groups } = await api<{ groups: { id: string; items: { kind: string; name: string }[] }[] }>('GET', `/content/${p.id}/editor/media`)
    if (groups.find(g => g.id === 'post')?.items.some(x => x.kind === 'video' && /^Take/.test(x.name))) { rec = p; break }
  }
  if (!rec) throw new Error('No Recreate post with a take. Make one in demo mode first.')
  await api('PATCH', `/content/${rec.id}`, { spec: { clipId: null, captionOff: false } })
  await page.goto(`${LIVE}/studio/posts/${rec.id}`)
  const vstep = page.locator('[data-field="step-video"]')
  await vstep.waitFor({ timeout: 30_000 })
  const take = vstep.locator('.st-take').filter({ has: page.locator('video') }).first()
  await expect(async () => {
    if (await take.count()) return
    const change = vstep.getByRole('button', { name: 'Change', exact: true })
    if (await change.count()) await change.click()
    await expect(take).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 60_000 })
  if (await take.getByRole('button', { name: 'Keep this take' }).count()) await take.getByRole('button', { name: 'Keep this take' }).click()
  await take.getByRole('button', { name: 'Use this take' }).click()
  await expect.poll(async () => (await posts()).find(p => p.id === rec.id)?.spec?.clipId ?? null, { timeout: 30_000 }).not.toBeNull()
  await toFinish(page, rec.id)
  await openFromFinish(page)
  await takeIsThere(page, rec.id, info, 'path 1: Recreate review, Use this take')

  // 2. A finished post: Export MP4 (free, on the worker), then Open the
  // editor. While it renders, its run row pulses (owner, 2026-10-15).
  const done = await seedPost()
  await toFinish(page, done)
  await page.getByRole('button', { name: /^Export MP4/ }).click()
  const row = page.locator('.st-run.live').first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  expect(await row.evaluate(e => getComputedStyle(e).animationName)).toBe('st-run-pulse')
  await row.scrollIntoViewIfNeeded()
  await snap(page, info, 'the run row pulses while it renders')
  await expect(page.getByRole('button', { name: /Export MP4 again/ })).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('.st-run.live')).toHaveCount(0)
  await openFromFinish(page)
  await takeIsThere(page, done, info, 'path 2: a finished post')

  // 3. Library > Clips: Make a video post, then the Finish step.
  await page.goto(`${LIVE}/studio/library?tab=clips`)
  const make = page.getByRole('button', { name: 'Make a video post' }).first()
  await make.waitFor({ timeout: 30_000 })
  await make.click()
  await page.waitForURL(/\/studio\/posts\/cnt_/, { timeout: 30_000 })
  const fromLib = page.url().match(/posts\/(cnt_[a-z0-9]+)/)![1]!
  await toFinish(page, fromLib)
  await openFromFinish(page)
  await takeIsThere(page, fromLib, info, 'path 3: Library, Make a video post')

  // 4. Make another like this, from the Recreate post's Finish step.
  await toFinish(page, rec.id)
  await page.getByRole('button', { name: 'Make another like this' }).first().click()
  await page.waitForURL(u => /\/studio\/posts\/cnt_/.test(u.toString()) && !u.toString().includes(rec.id), { timeout: 30_000 })
  const copy = page.url().match(/posts\/(cnt_[a-z0-9]+)/)![1]!
  await toFinish(page, copy)
  await openFromFinish(page)
  await takeIsThere(page, copy, info, 'path 4: Make another like this')
})
