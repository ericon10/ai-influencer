import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { api, snap } from './helpers'

// Faceless characters (owner, 2026-10-22; UX-PLAN.md section 35, item 4),
// like a user in demo mode: New character asks Person or Faceless; Doug's
// file; his card says Faceless; a post's Still (a place from the bank,
// priced), Video (the prompt, image-to-video, priced), Text with Copy and
// Posted; the still on the post card; a faceless plan CSV through the one
// Import door, routed to Doug's account.

async function pay(page: Page, button: Locator) {
  await expect(button).toContainText(/\$\d|credit|Free/, { timeout: 30_000 })
  await button.click()
  const confirm = page.getByRole('button', { name: /^Confirm / })
  if (await confirm.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirm.first().click()
}
const tag = Date.now().toString(36).slice(-5)

test('Person or Faceless: Doug from his file; a post\'s still and video; the still on the card', async ({ page }, info) => {
  test.setTimeout(240_000)
  await page.goto('/studio/characters')
  await page.locator('[data-field="new-character"]').click()
  const ask = page.locator('[data-field="new-character-kind"]')
  await expect(ask).toContainText('A person or faceless?')
  await ask.getByRole('radio', { name: /Faceless/ }).click()
  await ask.getByRole('textbox').fill(`Doug ${tag}`)
  await snap(page, info, 'Person or Faceless, Doug\'s file')
  await ask.getByRole('button', { name: 'Set up the persona' }).click()
  const pageEl = page.locator('[data-field="faceless-character"]')
  await expect(pageEl).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-field="faceless-places"]').getByLabel('Place name').first()).toHaveValue('Car, rain on the windshield')
  await expect(page.getByText('Hero portrait')).toHaveCount(0)
  await snap(page, info, 'Doug\'s file: persona, places, look, voice, sounds')
  const id = page.url().split('/').pop()!
  await page.goto('/studio/characters')
  await expect(page.locator('.st-casting', { hasText: `Doug ${tag}` }).locator('[data-field="faceless-label"]')).toHaveText('Faceless')

  // A post: the drawers.
  const { id: post } = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: id, accountTag: `doug${tag}`, spec: { caption: 'so angry they replaced me with a macro', faceless: { videoPrompt: 'rain runs down the windshield' } } })
  await page.goto(`/studio/posts/${post}`)
  const still = page.locator('[data-field="faceless-still"]')
  await expect(still).toBeVisible({ timeout: 30_000 })
  await still.getByLabel('Place').selectOption({ label: 'Car, rain on the windshield' })
  await pay(page, still.getByRole('button', { name: /^Make the still/ }))
  await expect(still.locator('img').first()).toBeVisible({ timeout: 60_000 })
  await snap(page, info, 'the still from the place bank')
  await page.locator('[data-field="faceless-video"] button[aria-expanded]').click()
  const video = page.locator('[data-field="faceless-video"]')
  await expect(video.getByLabel('Video prompt')).toHaveValue('rain runs down the windshield')
  await pay(page, video.getByRole('button', { name: /^Make the video/ }))
  await expect(video.locator('video')).toBeVisible({ timeout: 90_000 })
  await page.locator('[data-field="faceless-text"] button[aria-expanded]').click()
  const text = page.locator('[data-field="faceless-text"]')
  await expect(text.getByLabel('On-screen line', { exact: true })).toHaveValue('so angry they replaced me with a macro')
  await expect(text.getByRole('button', { name: 'Copy the on-screen line' })).toBeEnabled()
  await page.locator('[data-field="faceless-posted"]').getByRole('switch', { name: 'Posted' }).click()
  await expect(page.locator('[data-field="faceless-posted"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await snap(page, info, 'the faceless post: still, video, text, posted')
  await page.waitForTimeout(1200)
  await page.goto('/studio')
  await expect(page.locator('.st-postcard', { hasText: `doug${tag}` }).locator('img').first()).toBeVisible({ timeout: 30_000 })
})

test('a faceless plan CSV through Import routes to the account\'s faceless character', async ({ page }, info) => {
  test.setTimeout(180_000)
  const { id } = await api<{ id: string }>('POST', '/characters', { name: `Doug csv ${tag}`, kind: 'faceless', template: 'doug' })
  await api('PUT', `/social-accounts/${encodeURIComponent(`dougcsv${tag}`)}`, { characterId: id })
  const out = join(process.cwd(), 'e2e', '.out')
  mkdirSync(out, { recursive: true })
  const file = join(out, `faceless-${tag}.csv`)
  const csv = readFileSync(join(process.cwd(), 'fixtures', 'faceless', 'sample-3-rows.csv'), 'utf8').replace('JOB_FROM_TEST', '').replace(/DG0(\d)/g, `X${tag}$1`)
  writeFileSync(file, `account,${csv.split('\n')[0]}\n${csv.split('\n').slice(1).filter(Boolean).map(l => `dougcsv${tag},${l}`).join('\n')}\n`)
  await page.goto('/studio')
  await page.locator('[data-field="import-door-file"]').setInputFiles(file)
  await expect(page.getByText(/is a faceless account's plan/)).toBeVisible()
  const box = page.locator('[data-field="faceless-import"]')
  await expect(box.getByLabel('Faceless account')).toHaveValue(id, { timeout: 30_000 })
  // The third row has neither a scene nor a still here: it is named and left out.
  await expect(box.locator('[data-field="faceless-rows"]')).toContainText('No scene and no still')
  await box.getByLabel(/^Tick the 2 rows shown/).check()
  await snap(page, info, 'the faceless plan, routed to its account')
  await box.getByRole('button', { name: 'Import 2 rows (free)' }).click()
  await expect(box.locator('[data-field="faceless-done"]')).toContainText('2 drafts made', { timeout: 30_000 })
  await expect(box.locator('[data-field="faceless-done"]').getByRole('button', { name: /^Generate 2 posts/ })).toContainText(/\$\d|credit/, { timeout: 30_000 })
})
