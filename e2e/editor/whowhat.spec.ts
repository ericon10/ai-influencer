import { expect, test, type Page } from '@playwright/test'
import { api, guideShot, seedData, snap } from './helpers'

// Who and what first (UX-PLAN.md rule 3 and section 45) like a person, in
// demo mode. New post shows only the start sheet until the character and
// the product are picked; Callie with No product gets the honest empty line
// state, never SideStep's lines; Callie with SideStep gets only secondhand
// lines and the 3 best in the slot; Browse opens the line picker and Use
// fills the slot; changing the product clears the line; a Weeks row with no
// product is flagged and skipped by Fill.

const run = Date.now().toString(36).slice(-5)
const MONDAY = '2027-06-07'
const ACCOUNT = `callie_ww_${run}`
// SideStep lines: three told secondhand (Callie's way) and two in the first person (Doug's).
// Three run words each, so no line of an earlier run is a near-match that Import lines drops.
const w = `${run}a ${run}b ${run}c`
const SECOND = [`my roommate got ghosted after four rounds ${w}`, `my sister heard nothing back for six weeks ${w}`, `my friend redid the same unpaid test three times ${w}`]
const FIRST = [`they ghosted me after round four ${w}`, `i applied to ninety jobs and got one bot email ${w}`]
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

async function pick(page: Page, character: string, product: string) {
  const sheet = page.locator('[data-field="start-sheet"]')
  await expect(sheet).toBeVisible({ timeout: 30_000 })
  await sheet.locator('[data-field="start-character"]').getByRole('radio', { name: new RegExp(`^${character}`) }).first().click()
  await sheet.locator('[data-field="start-product"]').getByRole('radio', { name: product, exact: true }).click()
}
async function newVideoPost(page: Page): Promise<string> {
  await page.goto('/studio')
  await page.getByRole('button', { name: 'Video post', exact: true }).first().click()
  await page.waitForURL(/\/studio\/posts\/cnt_/, { timeout: 30_000 })
  return page.url().match(/cnt_[a-z0-9]+/)![0]
}

test.beforeAll(async () => {
  const { callie, sideStep } = seedData()
  await api('PUT', '/line-bank/stance', { characterId: callie, stance: 'secondhand' })
  // Likes that grow with each run, so this run's lines are the best fits even beside an earlier run's.
  const base = 100_000 + Math.floor(Date.now() / 1000) % 1_000_000
  const rows = [...SECOND.map((t, i) => [t, 'comment', String(base - i), 'ghosted', 'sad', 'finished damage', 'secondhand', 'job']), ...FIRST.map((t, i) => [t, 'comment', String(base + 10 - i), 'ghosted', 'angry', 'finished damage', 'first', 'job'])]
  const csv = ['text,source,source_likes,pain,emotion,format,voice_fit,life_or_job', ...rows.map(r => r.map(q).join(','))].join('\n') + '\n'
  await api('POST', '/line-bank/lines/import', { csv, name: `who and what ${run}`, productId: sideStep })
  await api('PUT', `/social-accounts/${ACCOUNT}`, { characterId: callie, slotsPerDay: 1 })
})

test('New post with no picks shows only the start sheet', async ({ page }, info) => {
  await newVideoPost(page)
  const sheet = page.locator('[data-field="start-sheet"]')
  await expect(sheet).toBeVisible({ timeout: 30_000 })
  // Nothing of the post loads underneath: no stepper, no Line step, no Idea box.
  await expect(page.locator('.st-poststeps')).toHaveCount(0)
  await expect(page.locator('[data-field="step-line"]')).toHaveCount(0)
  await expect(page.locator('[data-field="post-idea"]')).toHaveCount(0)
  // Neither pick is made for the owner.
  await expect(sheet.locator('[data-field="start-character"] [aria-checked="true"]')).toHaveCount(0)
  await expect(sheet.locator('[data-field="start-product"] [aria-checked="true"]')).toHaveCount(0)
  await expect(sheet.locator('[data-field="start-go"]')).toBeDisabled()
  await expect(sheet.locator('[data-field="start-left"]')).toHaveText('Left: the character and the product (or No product).')
  await sheet.locator('[data-field="start-character"]').getByRole('radio', { name: /^Callie/ }).first().click()
  await expect(sheet.locator('[data-field="start-go"]')).toBeDisabled()
  await expect(sheet.locator('[data-field="start-left"]')).toHaveText('Left: the product (or No product).')
  await guideShot(page, sheet, 'who-what', [
    [sheet.locator('[data-field="start-character"]'), '1. The character: nothing is picked for you'],
    [sheet.locator('[data-field="start-product"]'), '2. The product, or No product (a real choice)'],
    [sheet.locator('[data-field="start-go"]'), 'Start the post: on once both are set'],
  ])
  await snap(page, info, 'the start sheet, character picked, product left')
})

test('Callie + No product shows the empty line state, never SideStep lines', async ({ page }, info) => {
  const id = await newVideoPost(page)
  await pick(page, 'Callie', 'No product')
  await page.locator('[data-field="start-go"]').click()
  const step = page.locator('[data-field="step-line"]')
  await expect(step).toBeVisible({ timeout: 30_000 })
  // Line is step 1 of the stepper.
  await expect(page.locator('.st-poststeps .st-step').first()).toContainText('Line')
  const p = await api<{ total: number; lines: Array<{ text: string }> }>('GET', `/content/${id}/line-picks`)
  for (const t of [...SECOND, ...FIRST]) expect(p.lines.map(l => l.text)).not.toContain(t)
  if (p.total === 0) await expect(step.locator('[data-field="line-empty"]')).toHaveText('No lines for Callie and no product yet.')
  else await expect(step.locator('[data-field="line-browse"]')).toHaveText(`Browse all ${p.total}`)
  for (const t of [...SECOND, ...FIRST]) await expect(step).not.toContainText(t)
  await expect(step.getByRole('button', { name: 'Write my own' })).toBeVisible()
  await expect(step.locator('[data-field="line-none"]')).toBeVisible()
  await snap(page, info, 'Callie and No product: no SideStep lines')
})

test('Callie + SideStep: only secondhand lines, the 3 best in the slot; Browse opens the picker and Use fills the slot; changing the product clears the line', async ({ page }, info) => {
  await newVideoPost(page)
  await pick(page, 'Callie', 'SideStep')
  await page.locator('[data-field="start-go"]').click()
  const step = page.locator('[data-field="step-line"]')
  const best = step.locator('[data-field="line-best-item"]')
  await expect(best).toHaveCount(3, { timeout: 30_000 })
  for (const t of SECOND) await expect(step.locator('[data-field="line-best"]')).toContainText(t)
  for (const t of FIRST) await expect(step).not.toContainText(t)
  await guideShot(page, step, 'line-first-slot', [
    [best.first(), 'The 3 best-fit lines for this character and product, with Use'],
    [step.locator('[data-field="line-browse"]'), 'Browse all: the line picker'],
    [step.locator('[data-field="line-none"]'), 'Write my own, or No line'],
  ])

  // Browse opens the centered picker: search, chips, compact rows; Use fills the slot.
  await step.locator('[data-field="line-browse"]').click()
  const sheet = page.locator('[data-field="line-sheet"]')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('[data-field="line-sheet-scope"]')).toContainText('Lines for Callie and SideStep')
  for (const t of FIRST) await expect(sheet).not.toContainText(t)
  await sheet.getByLabel('Search lines').fill(SECOND[1]!)
  const row = sheet.locator('[data-field="line-row"]', { hasText: SECOND[1]! })
  await expect(row).toBeVisible()
  await expect(sheet.locator('[data-field="line-row"]')).toHaveCount(1)
  await row.locator('.st-linerow-text').click()
  await expect(row.locator('[data-field="line-row-source"]')).toContainText('Source: comment')
  await guideShot(page, sheet, 'line-first-sheet', [
    [sheet.getByLabel('Search lines'), 'Search the lines and their comments'],
    [sheet.locator('[data-field="line-filter-emotion"]'), 'Filter chips: pain, emotion, format, life or job'],
    [row, 'A compact row: tap for the source comment; Use fills the slot'],
  ])
  await row.getByRole('button', { name: 'Use' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('[data-field="step-line"] .st-poststep-sum')).toContainText(SECOND[1]!.slice(0, 40), { timeout: 20_000 })
  await snap(page, info, 'the line picked from the picker, in the slot')

  // Changing the product clears the line, with one line of warning first.
  await page.locator('[data-field="who-what"]').getByRole('button', { name: 'Change' }).click()
  const change = page.locator('[data-field="start-sheet"]')
  await expect(change.locator('[data-field="start-product"] [aria-checked="true"]')).toHaveText(/SideStep/)
  await change.locator('[data-field="start-product"]').getByRole('radio', { name: 'No product', exact: true }).click()
  await expect(change.locator('[data-field="start-clears"]')).toHaveText('Changing the product clears this post\'s line.')
  await change.locator('[data-field="start-go"]').click()
  await expect(page.locator('.st-toast').filter({ hasText: /line was cleared/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-field="who-what"]')).toContainText('No product')
  await expect(page.locator('[data-field="step-line"] [data-field="line-current"]')).toHaveCount(0)
  await expect(page.locator('[data-field="step-line"]')).not.toContainText(SECOND[1]!)
  await snap(page, info, 'the product changed: the line is cleared')
})

test('a Weeks row with no product is flagged at import and skipped by Fill', async ({ page }, info) => {
  const head = ['row_id', 'account', 'date', 'slot', 'post_type', 'product', 'outfit', 'scene']
  const rows = [[`WB${run}`, ACCOUNT, '2027-06-07', '1', 'clip', '', 'gray hoodie', 'her kitchen'], [`WN${run}`, ACCOUNT, '2027-06-08', '1', 'clip', 'none', 'gray hoodie', 'her kitchen']]
  const csv = [head, ...rows].map(r => r.map(q).join(',')).join('\n') + '\n'
  const pv = await api<{ rows: Array<{ rowId: string; warnings: string[] }> }>('POST', '/weeks/preview', { csv })
  expect(pv.rows.find(r => r.rowId === `WB${run}`)!.warnings.join(' ')).toMatch(/^No product/)
  expect(pv.rows.find(r => r.rowId === `WN${run}`)!.warnings.join(' ')).not.toMatch(/No product/)
  await api('POST', '/weeks/import', { csv, rows: rows.map(r => r[0]) })
  await page.goto(`/studio/weeks?week=${MONDAY}&step=fill`)
  await expect(page.locator(`[data-field="weeks-cell-WB${run}"]`)).toContainText('No product', { timeout: 30_000 })
  await page.getByRole('button', { name: /^Fill empty slots \(free\)/ }).click()
  const draw = page.locator('[data-field="weeks-draw"]')
  await expect(draw).toContainText(/\d+ drawn/, { timeout: 30_000 })
  await expect(draw.locator(`[data-field="weeks-draw-WN${run}"]`)).toBeVisible()
  await expect(draw.locator(`[data-field="weeks-draw-WB${run}"]`)).toHaveCount(0)
  await snap(page, info, 'Weeks: the row with no product is flagged and left out of the draw')
})
