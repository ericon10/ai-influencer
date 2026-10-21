import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { API, api, snap } from './helpers'

// Download day (UX-PLAN.md section 33), like a user, in demo mode: a small
// plan imported through the API (two accounts, two slots, one day), its
// stills made with the mock, two posts approved on their cards and one
// not; Download day's free preview (in posting order, the one left out and
// why); Make the zip; the zip unzipped here (the folder tree, checklist.txt,
// left-out.txt); then, at phone width, the third post approved and a second
// zip that leaves the first two out as packed. Every record is made here.

const PLAN_COLUMNS = ['row_id', 'date', 'slot', 'account', 'format', 'hook', 'slide_2', 'slide_3', 'slide_4', 'slide_5', 'slide_6', 'scene', 'caption', 'hashtags', 'ad']
const csvOf = (rows: string[][]) => [PLAN_COLUMNS.join(','), ...rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))].join('\n')
interface PlanPost { id: string; rowId: string; need: number; have: number }

async function zipAt(page: Page): Promise<Record<string, Uint8Array>> {
  const href = await page.locator('[data-field="day-download"]').getAttribute('href')
  const id = href!.match(/assets\/([^/]+)\/content/)![1]!
  const r = await fetch(`${API}/assets/${id}/content?download=1`)
  expect(r.ok).toBe(true)
  return unzipSync(new Uint8Array(await r.arrayBuffer()))
}
const text = (files: Record<string, Uint8Array>, path: string) => Buffer.from(files[path]!).toString('utf8')

async function approveOnCard(page: Page, tag: string, rowId: string) {
  await page.getByRole('button', { name: tag, exact: true }).click()
  const card = page.locator('.st-postcard', { hasText: `${rowId}:` })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.getByRole('button', { name: 'Approve for posting' }).click()
  await expect(card.locator('[data-field="approve-chip"]')).toHaveText('Approved', { timeout: 15_000 })
  return card
}

test('Download day: the preview in posting order, the zip (folders, checklist.txt, left-out.txt), then packed posts left out of the next one, at phone width', async ({ page }, info) => {
  test.setTimeout(420_000)
  const now = Date.now()
  const stamp = now.toString(36).slice(-5).toUpperCase()
  const day = `${2032 + (now % 60)}-${String(1 + (Math.floor(now / 60) % 12)).padStart(2, '0')}-${String(1 + (Math.floor(now / 720) % 28)).padStart(2, '0')}`
  const A = `dd-a-${stamp.toLowerCase()}`, B = `dd-b-${stamp.toLowerCase()}`
  const rid = (n: number) => `D${stamp}${n}`
  await api('POST', '/characters', { name: `Day ${stamp}` })
  const row = (n: number, account: string, slot: string, ad: string) => [rid(n), day, slot, account, 'slideshow story', `${rid(n)} the recruiter said friday`, 'two', 'three', 'four', 'five', 'six', 'An office at night. Slide 1: a laptop. Slides 2 to 6: the desk lamp and a mug', `${rid(n)} caption`, 'jobtok', ad]
  const imported = await api<{ created: number; posts: Array<{ rowId: string; id: string }> }>('POST', '/plan/import', { csv: csvOf([row(1, A, 'AM', 'no'), row(2, B, 'PM', 'yes'), row(3, A, 'PM', 'no')]), productId: null, rows: [rid(1), rid(2), rid(3)] })
  expect(imported.created).toBe(3)
  const ids = imported.posts.map(p => p.id)
  // Their stills, with the mock (one quote, then the run).
  const action = { type: 'plan_generate', postIds: ids }
  const { quote } = await api<{ quote: { id: string } }>('POST', '/actions/estimate', { action })
  await api('POST', '/actions/run', { action, quoteId: quote.id, confirmed: true })
  await expect.poll(async () => (await api<{ posts: PlanPost[] }>('GET', '/plan')).posts.filter(p => ids.includes(p.id)).every(p => p.need > 0 && p.have >= p.need), { timeout: 240_000, intervals: [3000] }).toBe(true)

  // Approve two on their cards; the third stays as it is.
  await page.goto('/studio')
  await approveOnCard(page, A, rid(1))
  await approveOnCard(page, B, rid(2))
  await snap(page, info, 'Approve for posting on a card')

  // The preview (free): posting order, each in or left out and why.
  const card = page.locator('[data-field="download-day"]')
  const head = card.getByRole('button', { name: /^Download day/ }).first()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await card.getByLabel('Day').fill(day)
  const rows = card.locator('[data-field="day-list"] > li')
  await expect(rows).toHaveCount(3, { timeout: 30_000 })
  await expect(card.locator('[data-field="day-counts"]')).toHaveText('2 go in, 1 left out. 2 will be exported first (free).')
  await expect(rows.nth(0)).toContainText('AM · 09:00')
  await expect(rows.nth(0)).toContainText(`Goes in: ${A}/1-AM-0900/ (exported first, free)`)
  await expect(rows.nth(1)).toContainText(`${rid(3)} the recruiter said friday`)
  await expect(rows.nth(1)).toContainText('Left out: Not approved for posting')
  await expect(rows.nth(2)).toContainText(`Goes in: ${B}/1-PM-1800/`)
  await expect(rows.nth(2)).toContainText('Ad')
  await card.scrollIntoViewIfNeeded()
  await snap(page, info, 'Download day: the preview in posting order')

  // Make the zip (free, on the worker), then its contents.
  const make = card.getByRole('button', { name: /^Make the zip · 2 posts/ })
  await expect(make).toContainText('Free')
  await make.click()
  await expect(card.locator('[data-field="day-download"]')).toBeVisible({ timeout: 180_000 })
  await expect(card.locator('[data-field="day-download"]')).toContainText('2 posts')
  const files = await zipAt(page)
  const slides = (dir: string) => ['01', '02', '03', '04', '05', '06'].map(n => `${day}/${dir}/${n}.jpg`)
  expect(Object.keys(files).sort()).toEqual([
    ...slides(`${A}/1-AM-0900`), `${day}/${A}/1-AM-0900/caption.txt`, `${day}/${A}/1-AM-0900/post.json`,
    ...slides(`${B}/1-PM-1800`), `${day}/${B}/1-PM-1800/caption.txt`, `${day}/${B}/1-PM-1800/post.json`,
    `${day}/checklist.txt`, `${day}/left-out.txt`,
  ].sort())
  expect(text(files, `${day}/checklist.txt`).split('\n').filter(l => l.startsWith('[ ]'))).toEqual([
    `[ ] 1. ${A} | 09:00 (AM) | Hook: "${rid(1)} the recruiter said friday" | Ad: no | AI-generated label: on | ${A}/1-AM-0900/`,
    `[ ] 2. ${B} | 18:00 (PM) | Hook: "${rid(2)} the recruiter said friday" | Ad: yes | AI-generated label: on | ${B}/1-PM-1800/`,
  ])
  expect(text(files, `${day}/left-out.txt`)).toContain(`${A} | 18:00 (PM) | Hook: "${rid(3)} the recruiter said friday" | Not approved for posting`)
  expect(text(files, `${day}/${B}/1-PM-1800/caption.txt`)).toMatch(new RegExp(`^Ad: ${rid(2)} caption`))
  expect(JSON.parse(text(files, `${day}/${A}/1-AM-0900/post.json`)).posting).toMatchObject({ date: day, slot: 'AM', slot_time: '09:00', ai_label: 'on' })
  // Each post that went in shows Packed on its card.
  await page.getByRole('button', { name: A, exact: true }).click()
  await expect(page.locator('.st-postcard', { hasText: `${rid(1)}:` }).locator('[data-field="packed-chip"]')).toContainText('Packed', { timeout: 20_000 })
  await expect(page.locator('.st-postcard', { hasText: `${rid(3)}:` }).locator('[data-field="packed-chip"]')).toHaveCount(0)
  await snap(page, info, 'the zip made: Download the zip, Packed on the card')

  // At phone width: approve the third post on its card, then a second zip
  // of the day leaves the first two out as packed.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/studio')
  await approveOnCard(page, A, rid(3))
  await page.goto(`/studio?day=${day}`)
  const phone = page.locator('[data-field="download-day"]')
  await expect(phone.locator('[data-field="day-list"] > li')).toHaveCount(3, { timeout: 30_000 })
  await expect(phone.locator('[data-field="day-counts"]')).toHaveText('1 go in, 2 left out. 1 will be exported first (free).')
  await expect(phone.locator('[data-field="day-list"] > li').nth(0)).toContainText('Left out: Already packed')
  const again = phone.getByRole('button', { name: /^Make the zip · 1 post/ })
  await again.scrollIntoViewIfNeeded()
  const box = (await again.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(40)
  expect(box.width).toBeGreaterThan(300)
  // Nothing sits off the side of the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392)
  await snap(page, info, 'Download day on a phone: the list and the button')
  await again.click()
  await expect(phone.locator('[data-field="day-download"]')).toContainText('1 post', { timeout: 180_000 })
  const second = await zipAt(page)
  expect(Object.keys(second).filter(f => f.endsWith('post.json'))).toEqual([`${day}/${A}/1-PM-1800/post.json`])
  const left = text(second, `${day}/left-out.txt`)
  expect(left).toContain(`${A} | 09:00 (AM) | Hook: "${rid(1)} the recruiter said friday" | Already packed`)
  expect(left).toContain(`${B} | 18:00 (PM) | Hook: "${rid(2)} the recruiter said friday" | Already packed`)
  await snap(page, info, 'the second zip on a phone')

  // The post's Finish step: approved, its day and slot from the plan, Packed.
  await page.goto(`/studio/posts/${imported.posts.find(p => p.rowId === rid(3))!.id}`)
  const posting = page.locator('[data-field="post-posting-finish"]')
  await posting.scrollIntoViewIfNeeded({ timeout: 30_000 })
  await expect(posting.getByRole('switch', { name: 'Approve for posting' })).toHaveAttribute('aria-checked', 'true')
  await expect(posting.getByLabel('Post on')).toHaveValue(day)
  await expect(posting.getByLabel('Slot')).toHaveValue('PM')
  await expect(posting.locator('[data-field="packed-chip"]')).toContainText('Packed')
  await snap(page, info, 'Posting in the Finish step on a phone')
})
