import { expect, test } from '@playwright/test'
import { api, guideShot, seedData } from './helpers'

// Guide screenshots with numbered callouts (UX-PLAN.md section 42 F16):
// Weeks, Accounts, Line bank, From Google Sheets, Providers, ComfyUI and the
// engine lever, cut from the live screens in demo mode into
// public/studio-guide with their hotspots in src/studio/guide/shots.json.

const run = Date.now().toString(36).slice(-5)
const MONDAY = '2027-03-01'
const ACCOUNT = `callie_guide_${run}`
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1360, height: 900 } })
// They write into the repo, so they run on purpose: GUIDE_SHOTS=1.
test.skip(!process.env.GUIDE_SHOTS, 'Run with GUIDE_SHOTS=1 to cut the Guide screenshots')

test('Weeks: the steps and the grid; From Google Sheets', async ({ page }) => {
  const { callie } = seedData()
  await api('PUT', `/social-accounts/${ACCOUNT}`, { characterId: callie, slotsPerDay: 2 })
  const rows = [
    ['row_id', 'account', 'date', 'slot', 'post_type', 'line', 'outfit', 'scene', 'clip_action'],
    [`G1${run}`, ACCOUNT, '2027-03-01', '1', 'clip', 'the laundromat ate my quarters and my last clean shirt', 'faded band tee', 'a laundromat at night', 'she holds up the shirt'],
    [`G2${run}`, ACCOUNT, '2027-03-02', '1', 'text_only', 'hr: we are like a family / me: so you will ignore my calls', '', '', ''],
    [`G3${run}`, ACCOUNT, '2027-03-03', '2', 'slideshow', 'things my first boss said that still live in my head', 'gray hoodie', 'her desk at night', ''],
  ]
  await api('POST', '/weeks/import', { csv: rows.map((r, i) => [...r, i ? 'none' : 'product'].map(q).join(',')).join('\n'), rows: rows.slice(1).map(r => r[0]) })
  await api('POST', `/weeks/${MONDAY}/check`, {})
  await page.goto(`/studio/weeks?week=${MONDAY}`)
  const weeks = page.locator('[data-field="weeks"]')
  await expect(page.locator('[data-field="weeks-grid"]')).toBeVisible({ timeout: 30_000 })
  await guideShot(page, weeks, 'weeks', [
    [page.locator('[data-field="weeks-steps"]'), 'The steps: Import, Fill, Check, Make, Review, Send to Drive; the first one with work left is open'],
    [page.locator('[data-field="weeks-grid"]').locator('th.acct'), 'One row per account, one column per day'],
    [page.locator('[data-field="weeks-grid"]').locator('tbody tr').first().locator('td').nth(1), 'A post: its line, its type and where it stands'],
  ])
  await page.goto(`/studio/weeks?week=${MONDAY}&step=import`)
  await page.locator('[data-field="weeks-from-sheets"]').click()
  const card = page.locator('[data-field="weeks-import"]')
  const said = card.getByText(/Connect Google Drive first|plans|sheet/i).last()
  await expect(said).toBeVisible({ timeout: 30_000 })
  await guideShot(page, card, 'weeks-sheets', [
    [page.locator('[data-field="weeks-from-sheets"]'), 'From Google Sheets: your plan sheets in Drive, read with your own Google sign-in'],
    [said, 'Connect Google Drive first (Settings > General); then pick a sheet, the preview is free, and import the ticked rows'],
  ])
})

test('Accounts and the Line bank', async ({ page }) => {
  await page.goto('/studio/accounts')
  const acc = page.locator('[data-field="accounts-page"]')
  await expect(acc).toBeVisible({ timeout: 30_000 })
  await guideShot(page, acc, 'accounts', [
    [acc.locator('table, .st-card').first(), 'Each account: its character, Device ID, slots per day and life/job blend'],
  ])
  await page.goto('/studio/line-bank')
  const bank = page.locator('[data-field="line-bank-page"]')
  await expect(bank).toBeVisible({ timeout: 30_000 })
  await guideShot(page, bank, 'line-bank-page', [
    [page.locator('[data-field="line-bank-page-counts"]'), 'How many lines, used and unused'],
    [page.locator('[data-field="line-bank-page-filters"]'), 'Filter by pain, emotion, format, life or job'],
    [page.locator('[data-field="line-bank-import-lines"]'), 'Import lines from a CSV (the preview is free)'],
  ])
})

test('Providers, ComfyUI and the engine lever', async ({ page }) => {
  await page.goto('/studio/settings?tab=models')
  const prov = page.locator('[data-field="settings-engines"]')
  await expect(prov.locator('[data-field="engines-step-still"]')).toBeVisible({ timeout: 30_000 })
  const nano = prov.locator('[data-field="provider-pick-still-nano-banana-2.1"]')
  await guideShot(page, prov, 'providers', [
    [nano.locator('.st-label').first(), 'A model on a step: every provider that runs it'],
    [nano.locator('.st-provider').first(), 'Each price side by side; the default is Higgsfield'],
    [nano.locator('.st-cheapest').first(), 'The cheapest, marked'],
  ])
  await page.goto('/studio/settings')
  const comfy = page.locator('[data-field="settings-comfy"]')
  await expect(comfy).toBeVisible({ timeout: 30_000 })
  await guideShot(page, comfy, 'comfy', [
    [comfy.locator('[data-field="comfy-online"]'), 'Online, offline or not connected'],
    [comfy.locator('[data-field="comfy-make-token"]'), 'Make the agent token (shown once) and Test connection'],
    [comfy.locator('[data-field="comfy-status"]'), 'The GPU, its memory, the queue and the models found'],
    [comfy.locator('[data-field="comfy-env"]'), 'The environment check: the machine must match the lock'],
    [comfy.locator('[data-field="comfy-pause"]'), 'Pause the queue, and Max jobs at once'],
    [comfy.locator('[data-field="comfy-workflows"]'), 'The workflows, their times, and Upload a workflow'],
  ])
  const lever = page.locator('[data-field="engine-lever"]').first()
  await lever.locator('[data-field="engine-table-toggle"]').click()
  await expect(lever.locator('[data-field="engine-table"]')).toBeVisible()
  await guideShot(page, lever, 'engine', [
    [lever.getByLabel('Engine'), 'The engine: every step follows it'],
    [lever.locator('[data-field="engine-table"] thead'), 'Each engine\'s model per step, with its price in its own units'],
    [lever.locator('[data-field="engine-table"] tbody tr').first().locator('td').last(), 'Every engine: one model for a step whatever the engine'],
  ])
})
