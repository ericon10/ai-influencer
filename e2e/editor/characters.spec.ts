import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test } from '@playwright/test'
import { api, snap } from './helpers'

// Characters, Tier 1 item 3 (owner, 2026-10-22; UX-PLAN.md section 35), like
// a user: any uploaded image is picked as the hero; a ref is replaced and
// removed in its drawer without a rebuild; Delete character (a half-built
// one) goes to the Trash with one confirm and Restore brings it back.

const OUT = join(process.cwd(), 'e2e', '.out')
async function png(name: string, hue: number): Promise<string> {
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, name)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="hsl(${hue},26%,80%)"/><ellipse cx="300" cy="300" rx="100" ry="120" fill="hsl(${hue},20%,52%)"/></svg>`
  writeFileSync(file, await sharp(Buffer.from(svg)).png().toBuffer())
  return file
}
const tag = Date.now().toString(36).slice(-5)

test('an uploaded image is the hero; a ref is replaced and removed in its drawer, nothing goes stale', async ({ page }, info) => {
  const { id } = await api<{ id: string }>('POST', '/characters', { name: `Hero ${tag}` })
  await page.goto(`/studio/characters/${id}?tab=hero`)
  const up = page.locator('[data-field="hero-upload"]')
  await expect(up).toBeVisible({ timeout: 30_000 })
  await up.getByLabel('Hero image').setInputFiles(await png(`hero-${tag}.png`, 30))
  await expect(page.getByText('Your image is REF-00, the hero.')).toBeVisible({ timeout: 30_000 })
  await snap(page, info, 'an uploaded image is REF-00')
  const v = await api<{ sheet: { shots: Array<{ id: string; status: string }> } }>('GET', `/characters/${id}`)
  expect(v.sheet.shots.find(s => s.id === 'REF-00')!.status).toBe('approved')

  // The Sheet tab: add REF-09 by hand, then remove it.
  await page.goto(`/studio/characters/${id}?tab=sheet`)
  await page.locator('.st-tile', { hasText: 'REF-09' }).click()
  const edit = page.locator('[data-field="ref-edit"]')
  await edit.getByLabel('Image for REF-09').setInputFiles(await png(`ref09-${tag}.png`, 200))
  await expect(page.getByText('REF-09 added.')).toBeVisible({ timeout: 30_000 })
  await expect(edit.getByRole('button', { name: 'Replace REF-09' })).toBeVisible()
  await snap(page, info, 'REF-09 added by hand')
  await edit.getByRole('button', { name: 'Remove REF-09' }).click()
  await expect(page.getByText('REF-09 removed.')).toBeVisible()
  await expect(edit.getByRole('button', { name: 'Add an image as REF-09' })).toBeVisible()
})

test('Delete character: one confirm, to the Trash; Restore brings it back', async ({ page }, info) => {
  const name = `Half ${tag}`
  await api('POST', '/characters', { name })
  await page.goto('/studio/characters')
  const card = page.locator('.st-casting', { hasText: name })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.getByRole('button', { name: `Delete ${name}` }).click()
  const confirm = page.locator('[data-field="delete-character-confirm"]')
  await expect(confirm).toContainText(`Delete ${name}?`)
  await snap(page, info, 'Delete character: one confirm')
  await confirm.getByRole('button', { name: 'Move to the Trash' }).click()
  await expect(page.locator('.st-casting', { hasText: name })).toHaveCount(0, { timeout: 30_000 })
  await page.goto('/studio/library')
  await page.getByRole('tab', { name: 'Trash' }).click()
  const tile = page.locator('.st-tile', { hasText: `Character: ${name}` })
  await tile.getByRole('button', { name: 'Restore' }).click()
  await page.goto('/studio/characters')
  await expect(page.locator('.st-casting', { hasText: name })).toBeVisible({ timeout: 30_000 })
})
