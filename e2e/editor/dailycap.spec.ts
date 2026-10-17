import { expect, test, type Page } from '@playwright/test'
import { api, snap } from './helpers'

// The daily spend cap (UX-PLAN.md section 31), like a user, in demo mode:
// Settings > Budgets and usage has Per day ($10 by default, today in UTC);
// every paid button shows today's spend next to its price, on desktop and
// on a phone; a run that would pass the cap waits and says so, with
// today's spend and the run's price. The cap is set through the API around
// today's real (mock) spend, so nothing depends on what the database holds;
// it is put back to $10 at the end. Nothing real runs.

interface Usage { day: { spentMicros: number; heldMicros: number; capMicros: number; label: string } }
const today = async () => { const u = await api<Usage>('GET', '/usage'); return u.day.spentMicros + u.day.heldMicros }
const setDay = (usd: number) => api('PUT', '/settings/budgets', { day: usd })
// Money and caps as the Studio writes them ("$0.0042", "$0.12"; a cap of whole dollars "$10").
const usd = (micros: number) => { const v = micros / 1e6; return `$${v === 0 ? '0.00' : Math.abs(v) < 0.01 ? v.toFixed(4) : v.toFixed(2)}` }
const capUsd = (v: number) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`)

// A topic slideshow (no one in the photos, so no sheet is needed) at its
// Stills step, with three photo slides to price.
async function post(): Promise<string> {
  const { id: characterId } = await api<{ id: string }>('POST', '/characters', { name: `Cap test ${Date.now()}` })
  const { id } = await api<{ id: string }>('POST', '/content', {
    kind: 'slideshow', characterId, accountTag: 'e2e.cap', idea: 'an office lobby', step: 'stills',
    spec: { mode: 'topic', hook: 'The lobby at 8am', slides: ['the badge reader', 'the elevator'], shots: ['a glass lobby at 8am', 'a badge reader by the gate', 'an elevator bank'], lock: { place: 'a glass-walled office lobby' } },
  })
  return id
}

async function openStills(page: Page, id: string) {
  await page.goto(`/studio/posts/${id}`)
  const generate = page.locator('[data-field="slideshow-generate"]')
  await expect(generate).toBeVisible({ timeout: 30_000 })
  return generate
}

test.afterAll(async () => { await setDay(10) })

test('Per day in Settings, and today\'s spend next to the price on every paid button, desktop and phone', async ({ page }, info) => {
  test.setTimeout(180_000)
  await setDay(10)
  await page.goto('/studio/settings?tab=usage')
  const perDay = page.locator('label.st-field', { hasText: 'Per day' })
  await expect(perDay.locator('input')).toHaveValue('10')
  await expect(perDay).toContainText('today, UTC')
  await expect(page.locator('[data-field="usage-today"]')).toContainText(/spent today \(UTC\) of your \$10 daily cap/)
  await snap(page, info, 'Settings, Budgets and usage: Per day and today')

  const id = await post()
  const generate = await openStills(page, id)
  const button = generate.getByRole('button', { name: /Generate the set/ })
  await expect(button).toContainText(/\$\d/, { timeout: 30_000 })
  const tag = generate.locator('[data-field="today-spend"]').first()
  await expect(tag).toHaveText(/^today \$\d+\.\d\d of \$10$/)
  await generate.scrollIntoViewIfNeeded()
  await snap(page, info, 'today\'s spend next to the price')

  // Run it (the mock, $0.12): today's spend goes up by the run.
  const before = await today()
  await button.click()
  await expect(page.locator('[data-field="slide-cards"] .st-slideframe-empty')).toHaveCount(0, { timeout: 120_000 })
  await expect.poll(today, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 120_000)
  const reroll = page.locator('[data-field="slide-card-0"]')
  await page.reload()
  await expect(reroll.getByRole('button', { name: /Reroll/ })).toContainText(/\$\d/, { timeout: 30_000 })
  await expect(reroll.locator('[data-field="today-spend"]')).toHaveText(`today ${usd(await today())} of $10`)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  // On a phone: the slide card's Reroll, the same price and today's spend.
  const phone = page.locator('[data-field="slide-card-0"]')
  await expect(phone.getByRole('button', { name: /Reroll/ })).toContainText(/\$\d/, { timeout: 30_000 })
  const small = phone.locator('[data-field="today-spend"]').first()
  await expect(small).toBeVisible()
  await expect(small).toHaveText(/^today \$\d+\.\d\d of \$10$/)
  const box = (await small.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await phone.scrollIntoViewIfNeeded()
  await snap(page, info, 'phone: today\'s spend next to the price')
})

test('a run that would pass the daily cap waits and says so, with today\'s spend and the run\'s price', async ({ page }, info) => {
  test.setTimeout(180_000)
  const id = await post()
  // A cap one cent over today's spend: the three stills ($0.12 on the mock) would pass it.
  const used = await today()
  const cap = Math.ceil((used + 10_000) / 10_000) / 100
  try {
    await setDay(cap)
    const generate = await openStills(page, id)
    const button = generate.getByRole('button', { name: /Generate the set/ })
    await expect(button).toContainText('Waits', { timeout: 30_000 })
    await expect(button).toBeDisabled()
    const block = generate.locator('[data-field="budget-block"]')
    await expect(block).toContainText(`Waits: today's spend ${usd(used)} + this run $0.12 would pass your ${capUsd(cap)} daily cap. Raise the cap in Settings > Budgets and usage, or run it tomorrow (UTC). Nothing is charged while it waits.`)
    await expect(block.getByRole('link', { name: 'Budgets and usage' })).toHaveAttribute('href', '/studio/settings?tab=usage')
    await generate.scrollIntoViewIfNeeded()
    await snap(page, info, 'over the daily cap: the run waits and says why')
    // Raise the cap: the same button runs.
    await setDay(10)
    await page.reload()
    await expect(page.locator('[data-field="slideshow-generate"]').getByRole('button', { name: /Generate the set/ })).toContainText(/\$0\.12/, { timeout: 30_000 })
  } finally {
    await setDay(10)
  }
})
