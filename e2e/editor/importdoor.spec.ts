import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { api, snap } from './helpers'

// Batches, imports and deletes (owner, 2026-10-22; UX-PLAN.md section 35,
// Tier 1 item 2), like a user: the one Import button reads a plan CSV and
// opens it in the Launch plan card, Select all and shift-click tick the rows,
// the import ends on the next step with its Generate button, an import again
// asks Replace or Add (never updates silently), Clear sends drafts to the
// Trash with one confirm, and Restore brings them back. A plan CSV dropped
// into the older batch importer is refused with where it goes.

const OUT = join(process.cwd(), 'e2e', '.out')
const tag = `E${Date.now().toString(36).slice(-5).toUpperCase()}`
const ids = [`${tag}1`, `${tag}2`, `${tag}3`]
function planFile(): string {
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, `plan-${tag}.csv`)
  writeFileSync(file, [
    'row_id,date,slot,account,format,hook,scene,outfit,moment',
    `${ids[0]},2026-11-02,AM,CALLIE,character photo,When the alarm goes off for the third interview,her desk at dawn,a gray hoodie,Callie at her desk at dawn`,
    `${ids[1]},2026-11-02,PM,CALLIE,character photo,The recruiter said they would circle back in March,a kitchen at night,a black tee,Callie at the kitchen counter`,
    `${ids[2]},2026-11-03,AM,CALLIE,character photo,I was so angry I folded the rejection into a swan,a bus stop in rain,a rain jacket,Callie at a bus stop in the rain`,
  ].join('\n'))
  return file
}

async function home(page: Page) {
  await page.goto('/studio')
  await expect(page.locator('[data-field="import-door"]')).toBeVisible({ timeout: 30_000 })
}

test('one Import door: a plan CSV opens in the Launch plan; Select all, shift-click, Import, the next step; again asks Replace or Add; Clear to the Trash; Restore', async ({ page }, info) => {
  test.setTimeout(300_000)
  const file = planFile()
  await home(page)
  await page.locator('[data-field="import-door-file"]').setInputFiles(file)
  await expect(page.getByText(/is a launch plan .*opened in the Launch plan card/)).toBeVisible()
  const card = page.locator('[data-field="launch-plan"]')
  const preview = card.locator('[data-field="plan-preview"]')
  await expect(preview).toBeVisible({ timeout: 60_000 })
  await card.getByLabel('This plan is for').selectOption('none')
  const rows = card.locator('[data-field="plan-rows"]')
  await rows.getByLabel('Account').selectOption('CALLIE')

  // Select all ticks every row shown; Clear selection; shift-click a range.
  const all = rows.getByLabel(/^Tick the \d+ rows shown/)
  await all.check()
  const count = rows.locator('[data-field="selection-count"]')
  await expect(count).toContainText(/\d+ selected/)
  await count.getByRole('button', { name: 'Clear selection' }).click()
  await expect(count).toHaveCount(0)
  await rows.getByLabel(`Import ${ids[0]}`).click()
  await rows.getByLabel(`Import ${ids[2]}`).click({ modifiers: ['Shift'] })
  await expect(count).toContainText('3 selected')
  for (const id of ids) await expect(rows.getByLabel(`Import ${id}`)).toBeChecked()
  await snap(page, info, 'three rows ticked with a shift-click')

  const importBtn = card.locator('[data-field="plan-step-4"]').getByRole('button', { name: /^Import/ })
  await expect(importBtn).toHaveText('Import 3 rows (free)')
  await importBtn.click()
  // The last line is the next step, with its priced button.
  const done = card.locator('[data-field="plan-done"]')
  await expect(done).toContainText('3 drafts made. Next: Generate 3 posts', { timeout: 60_000 })
  await expect(done.getByRole('button', { name: /^Generate 3 posts/ })).toContainText(/\$\d|credit/, { timeout: 30_000 })
  await snap(page, info, 'the next step after the import')

  // An import again: the matches are named, nothing imports until a choice.
  await expect(rows.getByLabel(`Import ${ids[0]}`)).toBeVisible({ timeout: 30_000 })
  await rows.getByLabel(`Import ${ids[0]}`).click()
  await rows.getByLabel(`Import ${ids[2]}`).click({ modifiers: ['Shift'] })
  const existing = card.locator('[data-field="plan-existing"]')
  await expect(existing).toContainText('3 rows match posts you already have')
  await expect(importBtn).toBeDisabled()
  await snap(page, info, 'Replace or Add as new')
  await existing.getByRole('button', { name: 'Replace them (their pictures go to Trash)' }).click()
  await importBtn.click()
  await expect(done).toContainText('3 drafts made (3 replaced', { timeout: 60_000 })

  // Clear the ticked ones: one confirm, to the Trash.
  const posts = card.locator('[data-field="plan-posts"]')
  for (const id of ids) await posts.getByLabel(`Pick ${id}`).click()
  await expect(posts.locator('[data-field="selection-count"]')).toContainText('3 selected')
  await posts.getByRole('button', { name: 'Clear...' }).click()
  const clear = posts.locator('[data-field="plan-clear"]')
  await expect(clear.getByLabel('The ticked ones (3)')).toBeChecked()
  await expect(clear.locator('[data-field="plan-clear-count"]')).toContainText('3 posts go to Library > Trash (restorable for 7 days).')
  await snap(page, info, 'Clear: one confirm')
  await clear.getByRole('button', { name: 'Clear 3 posts' }).click()
  for (const id of ids) await expect(posts.getByLabel(`Pick ${id}`)).toHaveCount(0, { timeout: 30_000 })
  const plan = async () => (await api<{ posts: Array<{ rowId: string }> }>('GET', '/plan')).posts.filter(p => ids.includes(p.rowId)).length
  expect(await plan()).toBe(0)

  // Library > Trash: Select, Select all, Restore.
  await page.goto('/studio/library')
  await page.getByRole('tab', { name: 'Trash' }).click()
  const trash = page.locator('[data-field="library-trash"]')
  await expect(trash.getByText(new RegExp(`^Post: ${ids[0]}`)).first()).toBeVisible({ timeout: 30_000 })
  await trash.getByRole('button', { name: 'Select' }).click()
  for (const id of ids) await trash.getByLabel(new RegExp(`^Select Post: ${id}`)).first().click()
  await expect(page.locator('[data-field="library-selectbar"]')).toContainText('3 selected')
  await page.locator('[data-field="library-selectbar"]').getByRole('button', { name: /^Restore 3/ }).click()
  await expect.poll(plan, { timeout: 30_000 }).toBe(3)
})

test('a plan CSV dropped into the older batch importer is refused with where it goes', async ({ page }) => {
  const file = planFile()
  await home(page)
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'batch', characterId: (await api<{ characters: Array<{ id: string; name: string }> }>('GET', '/characters')).characters.find(c => c.name === 'Callie')!.id })
  await page.goto(`/studio/posts/${id}`)
  const box = page.locator('[data-field="batch-import"]')
  await expect(box).toBeVisible({ timeout: 30_000 })
  await box.locator('input[type="file"]').setInputFiles(file)
  await box.getByRole('button', { name: /^Preview \(free\)/ }).click()
  await expect(page.getByText(/is a launch plan .*not a video batch sheet\. Use Import on Posts home/)).toBeVisible()
})

test('Select all on Posts home and in the Library: the header box ticks what the filters show, "N selected" with Clear selection, shift-click a range', async ({ page }, info) => {
  await home(page)
  await page.getByRole('button', { name: 'Select', exact: true }).first().click()
  const bar = page.locator('[data-field="library-selectbar"]')
  await expect(bar).toBeVisible()
  const cards = page.getByLabel(/^Select /).filter({ has: page.locator('.st-check') })
  const n = await cards.count()
  expect(n).toBeGreaterThan(2)
  await cards.nth(0).click()
  await cards.nth(2).click({ modifiers: ['Shift'] })
  await expect(bar).toContainText('3 selected')
  await bar.getByRole('button', { name: 'Clear selection' }).click()
  await expect(bar).toContainText('0 selected')
  await bar.getByLabel(/^Select all \d+/).check()
  await expect(bar).toContainText(`${n} selected`)
  await snap(page, info, 'Posts home: Select all')
  await bar.getByRole('button', { name: 'Cancel' }).click()

  await page.goto('/studio/library')
  await page.getByRole('tab', { name: 'Stills' }).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const lbar = page.locator('[data-field="library-selectbar"]')
  await lbar.getByLabel(/^Select all \d+/).check()
  await expect(lbar).toContainText(/[1-9]\d* selected/)
  await lbar.getByLabel(/^Select all \d+/).uncheck()
  await expect(lbar).toContainText('0 selected')
})
