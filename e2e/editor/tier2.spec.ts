import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { api, seedData, snap, gotoLaunchPlan } from './helpers'

// Tier 2 of the Oct 22 build (UX-PLAN.md section 35), like a person, in
// demo mode: the plan preview's free pre-check (no outfit, no shot line),
// the product line that needs your screenshot, a drawn screen by default,
// a notes badge that opens on a tap, Punch up's before and after and Use
// these; on a slideshow, a slide's framing and As written; Auto-place all.

const tag = Date.now().toString(36).slice(-5)
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const HEAD = ['row_id', 'date', 'slot', 'account', 'format', 'hook', 'slide_2', 'slide_3', 'outfit', 'slide_1_image', 'slide_2_image', 'slide_3_image']
const row = (o: Record<string, string>) => HEAD.map(k => q(o[k] ?? '')).join(',')

function csvFile(): string {
  const text = [HEAD.join(','),
    row({ row_id: `A${tag}`, date: '2026-12-01', slot: 'AM', account: 'CALLIE', format: 'character slideshow', hook: 'you need to stop applying at 2am', slide_2: 'the recruiter wrote back', slide_3: 'then this', outfit: 'a gray hoodie', slide_1_image: 'Callie on the couch', slide_2_image: "mock email 'Thank you for your interest' 'Dear Candidate'", slide_3_image: 'the SideStep app on her phone' }),
    row({ row_id: `B${tag}`, date: '2026-12-01', slot: 'PM', account: 'CALLIE', format: 'character slideshow', hook: 'no outfit here', slide_2: 'two', slide_3: 'three', slide_1_image: 'Callie at the desk', slide_2_image: 'Callie at the window', slide_3_image: 'Callie by the door' }),
  ].join('\n')
  const dir = join(process.cwd(), 'e2e', '.out')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `tier2-${tag}.csv`)
  writeFileSync(file, text)
  return file
}

async function openPlan(page: Page) {
  await gotoLaunchPlan(page)
  const card = page.locator('[data-field="launch-plan"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const head = card.getByRole('button', { name: /Launch plan/ })
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  const again = card.getByRole('button', { name: /^Import a CSV$/ })
  if (await again.isVisible({ timeout: 2000 }).catch(() => false)) await again.click()
  return card
}

test('the plan preview: the free pre-check, your screenshot, a drawn screen, notes on a tap, Punch up before and after', async ({ page }, info) => {
  test.setTimeout(240_000)
  const card = await openPlan(page)
  await card.locator('[data-field="plan-import"] input[type="file"]').setInputFiles(csvFile())
  await expect(card.getByRole('switch', { name: 'Draw screens by code' })).toHaveAttribute('aria-checked', 'true')
  await card.getByRole('button', { name: /^Preview \(free\)/ }).click()
  const preview = card.locator('[data-field="plan-preview"]')
  await expect(preview).toBeVisible({ timeout: 60_000 })
  const product = preview.getByLabel('This plan is for')
  if (await product.isVisible().catch(() => false)) await product.selectOption(seedData().sideStep)
  // The pre-check names the row with no outfit, with the fix.
  await expect(preview).toContainText('A character post needs an outfit')
  // Row A: its product line is your screenshot; its notes open on a tap.
  const a = preview.locator(`[data-field="plan-row-A${tag}"]`)
  await expect(a.locator(`[data-field="needs-screenshot-A${tag}"]`)).toContainText('Needs your screenshot: slide 3')
  const notes = a.locator(`[data-field="notes-A${tag}"]`)
  await notes.getByRole('button').click()
  await expect(notes.getByRole('note')).toBeVisible()
  await expect(notes.getByRole('note')).toContainText('aimed at "you"')
  await snap(page, info, 'the preview: pre-check, your screenshot, notes open')
  await notes.getByRole('button').click()
  await expect(notes.getByRole('note')).toHaveCount(0)
  // Punch up row A's thin line: priced, before and after, Use these.
  await a.getByRole('checkbox', { name: `Import A${tag}` }).check()
  const punch = card.locator('[data-field="plan-punch-up"]')
  const button = punch.getByRole('button', { name: /^Punch up 1 thin line/ })
  await expect(button).toContainText(/\$\d|credit|Free/, { timeout: 30_000 })
  await button.click()
  const confirm = page.getByRole('button', { name: /^Confirm / })
  if (await confirm.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirm.first().click()
  const result = punch.locator('[data-field="punch-up-result"]')
  await expect(result).toBeVisible({ timeout: 60_000 })
  await expect(result).toContainText('Callie on the couch, shot on a phone')
  await snap(page, info, 'Punch up: before and after')
  await result.getByRole('button', { name: /^Use this line/ }).click()
  await expect(result).toHaveCount(0)
  await expect(card.locator('[data-field="plan-punch-up"]').getByRole('button', { name: /^Punch up 0 thin lines/ })).toBeVisible({ timeout: 30_000 })
})

test('a slide card: the framing from the mix, As written; Auto-place all in the Slides step', async ({ page }, info) => {
  test.setTimeout(180_000)
  const { callie } = seedData()
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId: callie, accountTag: `t2${tag}`, spec: { hook: 'my manager took credit again', slides: ['in the meeting', 'and then this'], shots: ['Callie at her desk', 'Callie in the meeting room', 'Callie walking out'], asWritten: [true, false, false] } })
  await page.goto(`/studio/posts/${id}?step=stills`)
  const framing = page.locator('[data-field="slide-framing-1"]')
  await expect(framing).toBeVisible({ timeout: 30_000 })
  await expect(framing.locator('option').first()).toHaveText('Mix: Mid')
  await framing.selectOption('hands')
  await expect(page.getByRole('checkbox', { name: 'Slide 1: send the line as written' })).toBeChecked()
  await page.getByRole('checkbox', { name: 'Slide 2: send the line as written' }).check()
  await snap(page, info, 'slide cards: framing and As written')
  await expect.poll(async () => (await api<{ item: { spec: { framings: string[]; asWritten: boolean[] } } }>('GET', `/content/${id}`)).item.spec, { timeout: 15_000 }).toMatchObject({ framings: expect.arrayContaining(['hands']), asWritten: [true, true, false] })
  await page.goto(`/studio/posts/${id}?step=text`)
  const place = page.locator('[data-field="auto-place"]').getByRole('button', { name: 'Auto-place all' })
  await expect(place).toBeVisible({ timeout: 30_000 })
  await place.click()
  await expect(page.getByText(/No slide had words on a face|Moved the words off a face/)).toBeVisible({ timeout: 30_000 })
})
