import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { api, guideShot, seedData, snap as attach } from './helpers'

// Tier 3 (owner, 2026-10-22; UX-PLAN section 36): the Recreate stills models
// (no GPT Image 2.5; Nano Banana 2.1 on the plan or Google AI Studio, then
// Seedream 4.5 edit on fal), Stills first on a replace, the gate decimals
// and your call on every take, and every priced button inside its card at
// desktop and phone width. Driven like a user, in demo mode (mock providers).

const press = (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

// Each shot is attached to the report and kept by name in e2e/.out/shots
// (the report's evidence, and the Guide's screenshots are cut from them).
const SHOTS = join(process.cwd(), 'e2e', '.out', 'shots')
async function snap(page: Page, info: TestInfo, name: string) {
  await attach(page, info, name)
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), await page.screenshot())
}

type Item = { id: string; characterId: string | null; spec?: Record<string, unknown> }

async function openRecreate(page: Page, post: string) {
  // Serve the post without a chosen clip, so the Video step opens on the
  // Recreate panel (nothing is saved).
  await page.route(/\/api\/v1\/content(\/[^/?]+)?(\?.*)?$/, async r => {
    if (r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch().catch(() => null)
    if (!res) return r.abort().catch(() => undefined)
    const body = await res.json().catch(() => null) as { items?: Item[]; item?: Item } | null
    for (const i of [...(body?.items ?? []), ...(body?.item ? [body.item] : [])]) if (i.id === post && i.spec) i.spec = { ...i.spec, clipId: null }
    await r.fulfill({ response: res, json: body })
  })
  await page.goto(`/studio/posts/${post}`)
  const vstep = page.locator('[data-field="step-video"]')
  await vstep.waitFor()
  await expect(async () => {
    if (await vstep.locator('.st-clone').count()) return
    const open = vstep.getByRole('button', { name: 'Change', exact: true })
    if (await open.count()) await open.click()
    const real = vstep.getByRole('button', { name: /Start from a real clip/ })
    if (await real.count()) await real.first().click()
    await expect(vstep.locator('.st-clone')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20_000 })
}

// Every priced button (a button with its price on it), with the tags beside
// it, lies inside the card, tile or choice it sits in; the page never
// scrolls sideways.
async function spills(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    for (const b of Array.from(document.querySelectorAll('button')).filter(x => x.querySelector('.st-price'))) {
      const box = b.closest('.st-tile, .st-choice, .st-card, .st-modal')
      if (!box || !(b as HTMLElement).offsetParent) continue
      const outer = box.getBoundingClientRect()
      const row = b.parentElement!
      for (const el of [b, ...Array.from(row.children)] as HTMLElement[]) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > outer.right + 1 || r.left < outer.left - 1) out.push(`"${(b.textContent ?? '').trim().slice(0, 60)}": ${el.tagName.toLowerCase()}.${el.className.split(' ')[0]} ends at ${Math.round(r.right)}, its box at ${Math.round(outer.right)}`)
      }
    }
    const doc = document.scrollingElement!
    if (doc.scrollWidth > window.innerWidth + 1) out.push(`the page scrolls sideways: ${doc.scrollWidth} > ${window.innerWidth}`)
    return [...new Set(out)]
  })
}

async function pricesIn(page: Page, where: Locator) {
  // Prices come in one by one; wait until none is still loading.
  await expect(where.locator('.st-price').first()).toBeVisible({ timeout: 30_000 })
  await expect(where.locator('.st-price.loading')).toHaveCount(0, { timeout: 30_000 })
}

async function recreateStills(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(180_000)
  const post = seedData().recreatePost
  await openRecreate(page, post)
  const choices = page.getByRole('radiogroup', { name: 'Stills model' })
  await expect(choices).toBeVisible({ timeout: 30_000 })
  // Item 18: no GPT Image 2.5 on a recreate; Nano Banana 2.1 on the plan or
  // Google AI Studio, then Seedream 4.5 edit on fal, each with its price.
  await expect(choices.getByRole('radio')).toHaveCount(3)
  await expect(choices).not.toContainText('GPT Image')
  await expect(choices.getByRole('radio').nth(1)).toContainText('Google AI Studio')
  await expect(choices.getByRole('radio').nth(2)).toContainText('Seedream 4.5 edit')
  await expect(choices.getByRole('radio').nth(2)).toContainText('fal, untested for recreates')
  for (let i = 0; i < 3; i++) await expect(choices.getByRole('radio').nth(i)).toContainText(/a still/, { timeout: 30_000 })
  // Picking the fallback says so on the stills button.
  await press(choices.getByRole('radio').nth(2), phone)
  await expect(page.getByRole('button', { name: /Seedream 4\.5 edit, untested for recreates/ })).toBeVisible()
  await press(choices.getByRole('radio').nth(1), phone)
  await expect(choices.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true')
  if (!phone && process.env.GUIDE_SHOTS) await guideShot(page, choices, 'recreate-stillmodel', [
    [choices.getByRole('radio').nth(0), 'Nano Banana 2.1 on your Higgsfield plan (credits)'], [choices.getByRole('radio').nth(1), 'Nano Banana 2.1 on Google AI Studio (dollars)'], [choices.getByRole('radio').nth(2), 'Seedream 4.5 edit on fal, the fallback'],
  ])
  // Item 22: every priced button stays inside its card, tile or choice.
  const panel = page.locator('.st-clone')
  await pricesIn(page, panel)
  await page.locator('[data-field="recreate-stills"] .st-grid.scenes').first().scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: recreate stills row' : 'recreate stills row')
  expect(await spills(page)).toEqual([])
  await page.unrouteAll({ behavior: 'ignoreErrors' })
}

async function takeCall(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(180_000)
  const { recreatePost, recreateTake } = seedData()
  // A take nobody has called yet asks Keep or Reject; one already called
  // (an earlier run) starts from a reject, so both paths are clicked.
  const fresh = !(await api<{ calls: Array<{ candidateId: string }> }>('GET', '/recreate/take-calls')).calls.some(c => c.candidateId === recreateTake)
  if (!fresh) await api('POST', `/content/${recreatePost}/clones/${recreateTake}/try-again`)
  await openRecreate(page, recreatePost)
  const take = page.locator('.st-take').first()
  const call = take.locator('[data-field="take-call"]')
  await expect(call).toBeVisible({ timeout: 30_000 })
  await call.scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: your call on a take' : 'your call on a take')
  if (!phone && process.env.GUIDE_SHOTS) await guideShot(page, take, 'take-call', [[call, 'Your call on every take, a passing one too: Keep or Reject']])
  if (fresh) {
    await expect(call).toContainText('It passed the video rule. Your call:')
    await press(call.getByRole('button', { name: 'Reject', exact: true }), phone)
  }
  await expect(take.getByText('You rejected it')).toBeVisible()
  await press(take.getByRole('button', { name: 'Keep', exact: true }), phone)
  await expect(take.getByText('You kept it')).toBeVisible()
  await expect(call).toHaveCount(0)
  // Both calls are logged with the take's scores, in Settings > Rules.
  const calls = (await api<{ calls: Array<{ candidateId: string; call: string }> }>('GET', '/recreate/take-calls')).calls
  expect(calls.find(c => c.candidateId === recreateTake)?.call).toBe('kept')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.goto('/studio/settings?tab=rules')
  const card = page.locator('[data-field="take-calls"]')
  await expect(card).toContainText('Your calls on takes')
  await expect(card.locator('tbody tr').first()).toContainText('Kept')
  await card.scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: your calls on takes' : 'your calls on takes')
  if (!phone && process.env.GUIDE_SHOTS) await guideShot(page, card, 'take-calls', [[card.locator('tbody tr').first(), 'Each call with the take\'s scores, to three decimals']])
  expect(await spills(page)).toEqual([])
}

async function stillsFirst(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(180_000)
  const post = seedData().recreatePost
  await openRecreate(page, post)
  await press(page.getByRole('radio', { name: /Replace the person/ }), phone)
  // Item 20: Stills first is on by default and the replace waits for a still.
  const sw = page.getByRole('switch', { name: 'Stills first' })
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('[data-field="clone-still"]').first()).toBeVisible()
  // Switched off: a warning on the panel and on the price before the run.
  await press(sw, phone)
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('This clone runs without stills')).toBeVisible()
  const clone = page.getByRole('button', { name: /^Clone it/ })
  await expect(clone).toContainText(/\$|credits|Free/, { timeout: 30_000 })
  // On the price, before any click.
  const warn = page.locator('[data-field="clone-no-stills"]')
  await expect(warn).toContainText(/Runs without stills for/, { timeout: 20_000 })
  await warn.scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: a clone without stills warns' : 'a clone without stills warns')
  if (!phone && process.env.GUIDE_SHOTS) await guideShot(page, page.locator('.st-clone'), 'clone-stills-first', [
    [page.locator('[data-field="clone-stills-first"]'), 'Stills first: on by default'], [page.getByText('This clone runs without stills'), 'Off: a warning on the panel'], [warn, 'and on the price, before the click'],
  ])
  expect(await spills(page)).toEqual([])
  await page.unrouteAll({ behavior: 'ignoreErrors' })
}

async function keysAndPrices(page: Page, info: TestInfo) {
  // Item 19: the API path's keys live in Settings > Provider keys only.
  await page.goto('/studio/settings')
  const keys = page.locator('.st-card').filter({ has: page.getByText('Provider keys', { exact: true }) }).filter({ hasText: 'Stored encrypted' }).first()
  await expect(keys).toContainText('Google AI Studio')
  await expect(keys).toContainText('fal')
  await keys.getByText('Google AI Studio', { exact: true }).scrollIntoViewIfNeeded()
  await snap(page, info, 'provider keys: Google AI Studio and fal')
}

// Item 22, the sweep: every page with priced buttons, every priced button
// inside its card. Each step of a post is opened in turn.
async function sweep(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(300_000)
  const { basePost, callie, recreatePost } = seedData()
  const slideshow = (await api<{ items: Array<{ id: string; kind: string }> }>('GET', '/content')).items.find(i => i.kind === 'slideshow')
  const pages: Array<[string, string]> = [
    ['/studio', 'Posts home'], [`/studio/posts/${basePost}`, 'a video post'], [`/studio/posts/${recreatePost}`, 'a Recreate post'],
    [`/studio/characters/${callie}`, 'a character'], ['/studio/library', 'Library'], ['/studio/settings', 'Settings'],
    ...(slideshow ? [[`/studio/posts/${slideshow.id}`, 'a slideshow'] as [string, string]] : []),
  ]
  const found: string[] = []
  let checked = 0
  for (const [url, name] of pages) {
    await page.goto(url)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    // Open every step of a post, one at a time, and read its prices.
    const steps = page.locator('.st-poststeps button, [data-field^="step-"] .st-step-head')
    const n = url.includes('/posts/') ? await page.locator('.st-poststeps button').count() : 0
    for (let i = 0; i <= n; i++) {
      if (i > 0) await page.locator('.st-poststeps button').nth(i - 1).click().catch(() => undefined)
      await expect(page.locator('.st-price.loading')).toHaveCount(0, { timeout: 30_000 }).catch(() => undefined)
      checked += await page.locator('button:has(.st-price)').count()
      for (const s of await spills(page)) found.push(`${name}${i ? ` (step ${i})` : ''}: ${s}`)
    }
    void steps
    await snap(page, info, `${phone ? 'phone: ' : ''}priced buttons, ${name}`)
  }
  console.log(`[sweep] ${checked} priced buttons checked on ${pages.length} pages`)
  expect(checked).toBeGreaterThan(10)
  expect([...new Set(found)]).toEqual([])
}

// Item 24, mass recreate, like a person: the sheet's CSV chosen, the
// TikTok links fetched one at a time (priced), the free first pass, ticked
// rows with one total, the stills in one click, Keep or Reject, the kept
// row's video, and the review queue's source and result side by side.
async function press2(page: Page, l: Locator, phone: boolean) {
  await l.scrollIntoViewIfNeeded()
  await press(l, phone)
  // A priced run over the confirm limit asks once more.
  const confirm = page.getByRole('button', { name: /^Confirm/ })
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await press(confirm, phone)
}

async function mass(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(420_000)
  const { callie } = seedData()
  const made = await api<{ id?: string; item?: { id: string } }>('POST', '/content', { kind: 'batch', characterId: callie, idea: `Mass recreate ${phone ? 'phone' : 'desktop'}` })
  const batch = made.item?.id ?? made.id!
  const csv = ['url,character,keep place or new set,motion model,notes', 'https://www.tiktok.com/@a/video/1,Callie,keep,Wan 3.0,', 'https://www.tiktok.com/@b/video/2,"Callie, Solei",new set,Genjutsu,a kitchen at night', 'https://www.tiktok.com/@c/video/3,Nobody,keep,,'].join('\n')
  await page.goto(`/studio/posts/${batch}`)
  const vstep = page.locator('[data-field="step-video"]')
  await vstep.waitFor()
  await expect(async () => {
    if (await page.locator('[data-field="mass-recreate"]').count()) return
    const open = page.getByRole('button', { name: 'Recreate a batch of clips' })
    if (await open.count()) await open.first().click()
    else { const step = page.locator('.st-poststeps button').filter({ hasText: 'Video' }); if (await step.count()) await step.first().click() }
    await expect(page.locator('[data-field="mass-recreate"]')).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 30_000 })
  const panel = page.locator('[data-field="mass-recreate"]')
  await panel.getByLabel('The sheet as a CSV file').setInputFiles({ name: 'sheet.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const rows = panel.locator('[data-field="mass-row"]')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(2)).toContainText('No character named "Nobody"')
  // Fetch, priced, one at a time.
  const fetch = panel.getByRole('button', { name: /Fetch 2 TikTok clips, one at a time/ })
  await expect(fetch).toContainText(/\$/, { timeout: 30_000 })
  await press2(page, fetch, phone)
  // The free first pass: both ready, with their prices; the total.
  await expect(rows.nth(0)).toContainText('Next: stills', { timeout: 120_000 })
  await expect(rows.nth(1)).toContainText('Next: stills', { timeout: 120_000 })
  await expect(rows.nth(1)).toContainText('Callie + Solei')
  await expect(rows.nth(0).locator('[data-field="mass-row-price"]')).toContainText(/Stills \$.* \+ video \$/, { timeout: 30_000 })
  const total = panel.locator('[data-field="mass-total"]')
  await expect(total).toContainText('Ticked: 2 rows')
  // Swap the pair, untick and tick again: the total follows.
  await press(rows.nth(1).getByRole('button', { name: /^Swap/ }), phone)
  await expect(rows.nth(1)).toContainText('Solei + Callie')
  await press(rows.nth(1).getByRole('checkbox'), phone)
  await expect(total).toContainText('Ticked: 1 row')
  await press(rows.nth(1).getByRole('checkbox'), phone)
  await expect(total).toContainText('Ticked: 2 rows')
  await total.scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: mass recreate, ticked rows and the total' : 'mass recreate, ticked rows and the total')
  if (!phone && process.env.GUIDE_SHOTS) await guideShot(page, panel, 'mass-rows', [
    [panel.getByLabel('Google Sheet link'), 'The sheet: a link, or its CSV'], [panel.getByLabel('Google Drive folder link'), 'Or a Drive folder of clips, synced'],
    [rows.nth(1), 'A row: its clip, characters (Swap), place, model, the free first pass and its price'], [rows.nth(2), 'A skipped row says why'],
    [total, 'The ticked rows\' one total'], [panel.getByRole('button', { name: /Make stills for/ }), 'One click: the stills, one row at a time'],
  ])
  expect(await spills(page)).toEqual([])
  // One click: the stills for both rows.
  await press2(page, panel.getByRole('button', { name: /Make stills for 2 ticked rows/ }), phone)
  await expect(rows.nth(0)).toContainText('Keep or reject the still', { timeout: 180_000 })
  await expect(rows.nth(1)).toContainText('Keep or reject the still', { timeout: 180_000 })
  await rows.nth(0).locator('[data-field="mass-still"]').scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: mass recreate, keep or reject each still' : 'mass recreate, keep or reject each still')
  await press(rows.nth(0).getByRole('button', { name: 'Keep', exact: true }), phone)
  await press(rows.nth(1).getByRole('button', { name: 'Reject', exact: true }), phone)
  await expect(rows.nth(1)).toContainText('Out')
  // Only the kept row goes to video.
  const videos = panel.getByRole('button', { name: /Make videos for 1 kept row/ })
  await expect(videos).toContainText(/\$/, { timeout: 30_000 })
  await press2(page, videos, phone)
  const review = rows.nth(0).locator('[data-field="mass-review"]')
  await expect(review).toBeVisible({ timeout: 180_000 })
  await expect(review.locator('video')).toHaveCount(2)
  await review.scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: mass recreate, the review queue' : 'mass recreate, the review queue')
  await press(review.getByRole('button', { name: 'Keep the take' }), phone)
  await expect(rows.nth(0)).toContainText('You kept this take.')
  expect(await spills(page)).toEqual([])
  await api('POST', `/content/${batch}/archive`).catch(() => undefined)
}

test.describe.configure({ mode: 'serial' })

test('Recreate stills: no GPT Image 2.5, Nano Banana 2.1 on the plan or Google, Seedream on fal, each priced; every priced button inside its card', async ({ page }, info) => { await recreateStills(page, info, false) })
test('a replace starts with Stills first on; off, the panel and the price warn before the run', async ({ page }, info) => { await stillsFirst(page, info, false) })
test('every take asks for your call, a passing one too; the calls are logged with their scores', async ({ page }, info) => { await takeCall(page, info, false) })
test('every priced button sits inside its card on every page', async ({ page }, info) => { await sweep(page, info, false) })
test('mass recreate: the sheet, fetched one at a time, the free first pass, ticked rows and one total, stills, keep or reject, the kept video, the review queue', async ({ page }, info) => { await mass(page, info, false) })
test('Settings has the Google AI Studio and fal keys', async ({ page }, info) => { await keysAndPrices(page, info) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: Recreate stills models and priced buttons inside their cards', async ({ page }, info) => { await recreateStills(page, info, true) })
  test('phone: Stills first and the warning', async ({ page }, info) => { await stillsFirst(page, info, true) })
  test('phone: every priced button sits inside its card on every page', async ({ page }, info) => { await sweep(page, info, true) })
  test('phone: mass recreate', async ({ page }, info) => { await mass(page, info, true) })
  test('phone: your call on a take', async ({ page }, info) => { await takeCall(page, info, true) })
})
