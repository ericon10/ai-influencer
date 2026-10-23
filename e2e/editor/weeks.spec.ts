import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// Weeks (UX-PLAN.md section 37) like a person, in demo mode: a 20-row
// plan CSV imported on Weeks, Fill empty slots (the draw shown first, a
// Redraw and a Lock, then Save), Fit to voice (priced, before and after,
// Use all), Check (free: 18 person rows without an outfit flagged), Make
// the week (one price: the 2 rows that pass, each still then its video),
// Review (A on the keyboard and an Approve click), Google Drive connected
// in Settings (a fake Google on localhost) with a test root folder, then
// Send to Drive: the files named date_slot_account_rowid and the manifest
// with Device ID and Account first.

const run = Date.now().toString(36).slice(-5)
const MONDAY = '2027-01-04'
const DAYS = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10']
const CALLIE = `callie_tt_${run}`, DOUG = `doug_tt_${run}`
const DRIVE = process.env.E2E_DRIVE_URL ?? ''
const OUT = join(process.cwd(), 'e2e', '.out', 'weeks')

const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
function planCsv(): string {
  const head = ['row_id', 'account', 'date', 'slot', 'post_type', 'story_beat', 'line', 'outfit', 'scene', 'clip_action', 'caption', 'hashtags', 'device_id']
  const rows: string[][] = []
  // Callie: 18 rows; only C0a has an outfit (the other 17 are flagged by Check), two lines given.
  DAYS.forEach((d, i) => {
    rows.push([`C${i}a${run}`, CALLIE, d, '1', 'clip', `day ${i + 1}: her roommate checks the portal`, i === 0 ? 'my roommate got rejected at 7:02am and made pancakes anyway' : '', i === 0 ? 'oversized gray hoodie, black leggings' : '', 'their small kitchen, morning light', 'she reads the email and puts the phone face down', 'monday again', 'roommate', ''])
    if (i < 5) rows.push([`C${i}b${run}`, CALLIE, d, '2', 'photo', `day ${i + 1}: the evening`, i === 4 ? 'the landlord texted happy friday and raised rent $400' : '', '', 'the couch at night, one lamp on', '', '', '', ''])
  })
  for (let i = 0; i < 6; i++) rows.push([`C${i}c${run}`, CALLIE, DAYS[i]!, '3', 'clip', 'late night', '', '', 'her bedroom at 1am', 'she stares at the ceiling', '', '', ''])
  // Doug: 2 faceless rows (no outfit needed).
  rows.push([`D0${run}`, DOUG, DAYS[0]!, '1', 'faceless', 'checking the mailbox in the rain', '', '', '', '', 'day 41', 'unemployed', 'DEVICE-07'])
  rows.push([`D1${run}`, DOUG, DAYS[1]!, '1', 'faceless', 'the portal is down again', '', '', '', '', 'day 42', 'unemployed', 'DEVICE-07'])
  return [head.join(','), ...rows.slice(0, 20).map(r => r.map(q).join(','))].join('\n') + '\n'
}
// Lines for the bank: life and job, every voice fit, across pains, emotions and formats.
function linesCsv(): string {
  const pains = ['ghosted', 'lowball pay', 'unpaid test', 'layoff', 'no reply', 'rent', 'family', 'entry level'], emotions = ['angry', 'sad', 'frustrated', 'crying', 'infuriated'], formats = ['finished damage', 'meme setup', 'question', 'list']
  // Every line its own words (Import lines drops near-matches: 80% of the words shared).
  const words = (i: number) => Array.from({ length: 6 }, (_, k) => `${run}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i * 7 + k * 3) % 26))}${k}${i}`).join(' ')
  const rows = Array.from({ length: 70 }, (_, i) => [`${run} ${words(i)} at ${i + 2}am`, 'claude', String(500 - i), pains[i % 8]!, emotions[i % 5]!, formats[(i * 3) % 4]!, ['both', 'secondhand', 'first'][i % 3]!, i % 3 === 0 ? 'life' : 'job'])
  return ['text,source,source_likes,pain,emotion,format,voice_fit,life_or_job', ...rows.map(r => r.map(q).join(','))].join('\n') + '\n'
}

async function pay(page: Page, button: Locator) {
  await expect(button).toContainText(/\$\d|credits|Free/, { timeout: 30_000 })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  await button.click()
  const confirm = page.getByRole('button', { name: /^Confirm / })
  if (await confirm.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirm.first().click()
}
const step = (page: Page, id: string) => page.locator(`[data-field="weeks-step-${id}"]`)

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  const { callie } = seedData()
  const doug = await api<{ id: string }>('POST', '/characters', { name: `Doug ${run}`, kind: 'faceless', template: 'doug' })
  await api('PUT', `/social-accounts/${CALLIE}`, { characterId: callie, deviceId: 'DEVICE-01', slotsPerDay: 3 })
  await api('PUT', `/social-accounts/${DOUG}`, { characterId: doug.id })
  await api('POST', '/line-bank/lines/import', { csv: linesCsv(), name: `e2e ${run}` })
})

test('Weeks: import a 20-row CSV, fill, check, make 2 posts, approve, send to a test Drive folder', async ({ page }, info) => {
  test.setTimeout(600_000)
  const file = join(OUT, `plan-${run}.csv`)
  writeFileSync(file, planCsv())
  await page.goto(`/studio/weeks?week=${MONDAY}`)
  // The sidebar's order (owner, 2026-10-22).
  await expect(page.locator('.st-nav .st-nav-item')).toHaveText(['New post', 'Characters', 'Weeks', 'Posts', 'Line bank', 'Library', 'Accounts', 'Settings', 'Guide'])
  await expect(page.locator('[data-field="weeks-steps"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-field="weeks-template"]')).toBeVisible()
  await page.locator('[data-field="weeks-spec"]').click()
  await expect(page.locator('[data-field="weeks-spec-doc"]')).toContainText('row_id')
  await page.keyboard.press('Escape')

  // Import: the free preview, every row ticked, Import 20 rows; the next step.
  await step(page, 'import').click()
  await page.locator('[data-field="weeks-file"]').setInputFiles(file)
  const preview = page.locator('[data-field="weeks-preview"]')
  await expect(preview).toContainText('20 of 20 rows', { timeout: 30_000 })
  await snap(page, info, 'weeks: the preview')
  await page.getByRole('button', { name: /^Import 20 rows \(free\)/ }).click()
  const done = page.locator('[data-field="weeks-import-done"]')
  await expect(done).toContainText('20 drafts made. Next: Fill 18 empty slots, free.', { timeout: 60_000 })
  const grid = page.locator('[data-field="weeks-grid"]')
  await expect(grid.locator(`[data-field="weeks-row-${CALLIE}"]`)).toBeVisible()
  await expect(grid.locator('.st-weekslot:not(.none)').filter({ hasText: run })).toHaveCount(20)
  await snap(page, info, 'weeks: 20 drafts on the grid')

  // Fill: the draw first, Redraw one slot, Lock one, Save.
  await done.getByRole('button', { name: 'Fill empty slots' }).click()
  await page.getByRole('button', { name: /^Fill empty slots \(free\)/ }).click()
  const draw = page.locator('[data-field="weeks-draw"]')
  await expect(draw).toContainText(/\d+ drawn/, { timeout: 30_000 })
  const row = draw.locator(`[data-field="weeks-draw-C1a${run}"]`)
  const before = await row.locator('td').nth(3).innerText()
  await row.getByRole('button', { name: `Redraw C1a${run}` }).click()
  await expect.poll(async () => row.locator('td').nth(3).innerText(), { timeout: 15_000 }).not.toBe(before)
  await draw.locator(`[data-field="weeks-draw-D0${run}"]`).getByRole('button', { name: `Lock D0${run}` }).click()
  await expect(draw.locator(`[data-field="weeks-draw-D0${run}"]`).getByRole('button', { name: `Unlock D0${run}` })).toBeVisible()
  await snap(page, info, 'weeks: the draw')
  await page.locator('[data-field="weeks-save-draw"]').click()
  await expect(page.locator('.st-toast').filter({ hasText: /lines saved/ })).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await api<{ counts: { noLine: number } }>('GET', `/weeks/${MONDAY}`)).counts.noLine, { timeout: 30_000 }).toBeLessThanOrEqual(2)

  // Fit to voice: priced, before and after with the lint, then Use all.
  const fit = page.locator('[data-field="weeks-fit"]')
  await pay(page, fit.getByRole('button', { name: /^Fit \d+ lines to voice/ }))
  const fits = page.locator('[data-field="weeks-fit-list"]')
  await expect(fits).toBeVisible({ timeout: 120_000 })
  await expect(fits.locator('.st-lintdots').first()).toBeVisible()
  await snap(page, info, 'weeks: fit to voice, before and after')
  await fits.getByRole('button', { name: 'Use all' }).click()
  await expect(fits).toHaveCount(0, { timeout: 30_000 })

  // Check (free): the 17 person rows with no outfit are flagged.
  await step(page, 'check').click()
  await page.locator('[data-field="weeks-run-check"]').click()
  await expect(page.locator('[data-field="weeks-check-result"]')).toContainText('posts ready to make', { timeout: 30_000 })
  const v = await api<{ cells: Array<{ rowId: string; flags: string[] }> }>('GET', `/weeks/${MONDAY}`)
  const mine = v.cells.filter(c => c.rowId.endsWith(run))
  const ready = mine.filter(c => !c.flags.length).map(c => c.rowId)
  expect(ready).toEqual(expect.arrayContaining([`C0a${run}`, `D0${run}`]))
  expect(mine.filter(c => c.flags.includes('No outfit')).length).toBeGreaterThanOrEqual(16)
  await snap(page, info, 'weeks: check')

  // Kill D1 so exactly two posts are made (a person clip and a faceless post).
  await api('PUT', `/weeks/posts/${(await api<{ cells: Array<{ rowId: string; postId: string }> }>('GET', `/weeks/${MONDAY}`)).cells.find(c => c.rowId === `D1${run}`)!.postId}/review`, { call: 'killed' })

  // Make: one total price, one click; stills first, each video from its still.
  await page.reload()
  await step(page, 'make').click()
  const make = page.locator('[data-field="weeks-make"]')
  await pay(page, make.getByRole('button', { name: /^Make the week \(2 posts\)/ }))
  await expect.poll(async () => {
    const w = await api<{ cells: Array<{ rowId: string; made: boolean }> }>('GET', `/weeks/${MONDAY}`)
    return w.cells.filter(c => [`C0a${run}`, `D0${run}`].includes(c.rowId) && c.made).length
  }, { timeout: 240_000, intervals: [3000] }).toBe(2)
  await snap(page, info, 'weeks: made')

  // Review: A on the keyboard approves the focused post; a click approves the other.
  await page.reload()
  await step(page, 'review').click()
  const review = page.locator('[data-field="weeks-review"]')
  const first = review.locator(`[data-field="weeks-review-C0a${run}"]`)
  await first.click()
  await page.keyboard.press('a')
  await expect(first).toHaveClass(/approved/, { timeout: 15_000 })
  await review.locator(`[data-field="weeks-review-D0${run}"]`).getByRole('button', { name: 'Approve' }).click()
  await expect(review.locator(`[data-field="weeks-review-D0${run}"]`)).toHaveClass(/approved/, { timeout: 15_000 })
  await expect(page.locator('[data-field="weeks-approved-count"]')).toContainText(/^\d+ of \d+ approved$/)
  await snap(page, info, 'weeks: review')

  // Settings: the OAuth client, Connect Google Drive, a test root folder.
  test.skip(!DRIVE, 'The fake Google runs with the hermetic suite (E2E_HERMETIC)')
  await page.goto('/studio/settings?tab=general')
  await page.locator('[data-field="key-google_oauth"] input').fill('1234-e2e.apps.googleusercontent.com:GOCSPX-e2e-secret')
  await page.getByRole('button', { name: 'Save and verify', disabled: false }).click()
  await expect(page.locator('.st-toast').filter({ hasText: /Google Drive \(OAuth client\) key saved/ })).toBeVisible({ timeout: 15_000 })
  const card = page.locator('[data-field="settings-drive"]')
  await card.getByRole('button', { name: 'Connect Google Drive' }).click()
  await expect(page).toHaveURL(/drive=connected/, { timeout: 30_000 })
  await expect(card.locator('[data-field="drive-connected"]')).toContainText('Connected as owner@example.com', { timeout: 30_000 })
  await card.getByLabel('New root folder name').fill(`Test Drive folder ${run}`)
  await card.getByRole('button', { name: 'Make it the root folder' }).click()
  await expect(card.locator('[data-field="drive-connected"]')).toContainText(`Root folder: Test Drive folder ${run}`, { timeout: 30_000 })
  await snap(page, info, 'settings: Google Drive')

  // Send to Drive (free).
  await page.goto(`/studio/weeks?week=${MONDAY}&step=drive`)
  const send = page.locator('[data-field="weeks-drive"]')
  await send.locator('[data-field="weeks-send"]').click()
  await expect(send.locator('[data-field="weeks-send-status"]')).toContainText('Sent', { timeout: 240_000 })
  await snap(page, info, 'weeks: sent to Drive')
  const files = (await (await fetch(`${DRIVE}/__files`)).json() as { files: Array<{ id: string; name: string; parents: string[]; size: number; mimeType: string; text?: string }> }).files
  const root = files.find(f => f.name === `Test Drive folder ${run}`)!
  const callieDir = files.find(f => f.parents.includes(root.id) && f.name === 'Callie')!
  const week = files.find(f => f.parents.includes(callieDir.id) && f.name === `week of ${MONDAY}`)!
  expect(files.find(f => f.parents.includes(week.id) && f.name === `${MONDAY}_1_${CALLIE}_C0a${run}.mp4`)?.size).toBeGreaterThan(1000)
  const csv = files.find(f => f.parents.includes(week.id) && f.name === `manifest ${MONDAY}.csv`)!
  expect(csv.text!.split('\n')[0]).toBe('Device ID,Account,file_name,caption,hashtags,date,slot,sound_name,ad_label')
  expect(csv.text!.split('\n')[1]).toMatch(new RegExp(`^DEVICE-01,${CALLIE},${MONDAY}_1_${CALLIE}_C0a${run}\\.mp4,`))
  expect(files.find(f => f.parents.includes(week.id) && f.name === `manifest ${MONDAY}` && f.mimeType === 'application/vnd.google-apps.spreadsheet')).toBeTruthy()
  const dougDir = files.find(f => f.parents.includes(root.id) && f.name === `Doug ${run}`)!
  const dougWeek = files.find(f => f.parents.includes(dougDir.id) && f.name === `week of ${MONDAY}`)!
  expect(files.find(f => f.parents.includes(dougWeek.id) && f.name === `${MONDAY}_1_${DOUG}_D0${run}.mp4`)).toBeTruthy()
})

test('Accounts: each account\'s Device ID, platform, slots a day and blend; rename updates every post', async ({ page }, info) => {
  const tag = `acct_ig_${run}`
  const { callie } = seedData()
  await api('PUT', `/social-accounts/${tag}`, { characterId: callie })
  const post = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: callie, accountTag: tag })
  await page.goto('/studio/accounts')
  const row = page.locator(`[data-field="account-${tag}"]`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.getByLabel(`Platform for ${tag}`)).toHaveValue('instagram')
  await expect(row.getByLabel(`Life share for ${tag}`)).toHaveValue('70')
  await row.getByLabel(`Device ID for ${tag}`).fill('DEVICE-09')
  await row.getByLabel(`Slots a day for ${tag}`).fill('4')
  await row.getByLabel(`Life share for ${tag}`).fill('60')
  await row.getByLabel(`Life share for ${tag}`).blur()
  await expect.poll(async () => (await api<{ accounts: Array<{ tag: string; deviceId: string; slotsPerDay: number; lifeShare: number }> }>('GET', '/social-accounts')).accounts.find(a => a.tag === tag), { timeout: 15_000 }).toMatchObject({ deviceId: 'DEVICE-09', slotsPerDay: 4, lifeShare: 60 })
  await snap(page, info, 'accounts')
  await row.getByRole('button', { name: `Rename ${tag}` }).click()
  const input = row.getByLabel(`New name for ${tag}`)
  await input.fill(`${tag}_b`)
  await input.press('Enter')
  await expect(page.locator(`[data-field="account-${tag}_b"]`)).toBeVisible({ timeout: 15_000 })
  expect((await api<{ item: { accountTag: string } }>('GET', `/content/${post.id}`)).item.accountTag).toBe(`${tag}_b`)
})

test('Line bank page: filters and Download as CSV', async ({ page }, info) => {
  await page.goto('/studio/line-bank')
  await expect(page.locator('[data-field="line-bank-page-counts"]')).toBeVisible({ timeout: 30_000 })
  const filters = page.locator('[data-field="line-bank-page-filters"]')
  await filters.getByLabel('Life or job').selectOption('life')
  await filters.getByLabel('Search lines').fill(run)
  const table = page.locator('[data-field="line-bank-table"] tbody tr')
  await expect(table.first()).toBeVisible({ timeout: 15_000 })
  for (const r of (await table.allInnerTexts()).slice(0, 10)) expect(r).toMatch(/\blife\b/)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-field="line-bank-download"]').click()])
  const text = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c).toString('utf8'))
  expect(text.split('\n')[0]).toBe('id,text,source,source_likes,pain,emotion,format,voice_fit,life_or_job,used_on_account,used_on_date')
  await snap(page, info, 'line bank page')
})

// Weeks from Google Sheets (UX-PLAN.md section 39): a sheet the owner made
// in Drive, read from its pasted link with the same preview, imported; the
// Plans / CHARACTER folders made on first use; the sheet edited, then
// Re-sync (its free preview, then Apply); Import lines from a sheet.
async function ensureDrive(page: Page) {
  const d = await api<{ client: boolean; connected: boolean; root: { name: string } | null; sheets: boolean }>('GET', '/drive')
  if (d.connected && d.root && d.sheets) return
  await page.goto('/studio/settings?tab=general')
  if (!d.client) {
    await page.locator('[data-field="key-google_oauth"] input').fill('1234-e2e.apps.googleusercontent.com:GOCSPX-e2e-secret')
    await page.getByRole('button', { name: 'Save and verify', disabled: false }).click()
    await expect(page.locator('.st-toast').filter({ hasText: /Google Drive \(OAuth client\) key saved/ })).toBeVisible({ timeout: 15_000 })
  }
  const card = page.locator('[data-field="settings-drive"]')
  await card.getByRole('button', { name: /^(Connect|Reconnect) Google Drive$/ }).first().click()
  await expect(page).toHaveURL(/drive=connected/, { timeout: 30_000 })
  await expect(card.locator('[data-field="drive-connected"]')).toContainText('Connected as owner@example.com', { timeout: 30_000 })
  if (!(await api<{ root: unknown }>('GET', '/drive')).root) {
    await card.getByLabel('New root folder name').fill(`Test Drive folder ${run}`)
    await card.getByRole('button', { name: 'Make it the root folder' }).click()
    await expect(card.locator('[data-field="drive-connected"]')).toContainText('Root folder: Test Drive folder', { timeout: 30_000 })
  }
}
const sheetCall = async (body: unknown) => (await (await fetch(`${DRIVE}/__sheet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as { id: string; name: string }

test('Weeks from Google Sheets: paste a link, the same preview, import; Re-sync pulls the edits; Import lines from a sheet', async ({ page }, info) => {
  test.skip(!DRIVE, 'The fake Google runs with the hermetic suite (E2E_HERMETIC)')
  test.setTimeout(240_000)
  await ensureDrive(page)
  const WEEK = '2027-01-11'
  const head = 'row_id,account,date,slot,post_type,story_beat,line,outfit,scene'
  const row = (id: string, day: string, line: string) => [`${id}${run}`, CALLIE, day, '1', 'photo', `beat ${id}`, line, 'gray hoodie', 'the kitchen'].map(q).join(',')
  const sheet = await sheetCall({ name: `Callie week of Jan 11 ${run}`, csv: [head, row('G1', WEEK, 'the recruiter said circle back. it is january'), row('G2', '2027-01-12', 'my mom asked if i tried linkedin'), row('G3', '2027-01-13', 'the portal logged me out mid answer')].join('\n') })

  await page.goto(`/studio/weeks?week=${WEEK}&step=import`)
  await page.locator('[data-field="weeks-from-sheets"]').click()
  const picker = page.locator('[data-field="weeks-sheets"]')
  await expect(picker.locator('[data-field="weeks-sheets-list"]')).toContainText(`Callie week of Jan 11 ${run}`, { timeout: 30_000 })
  await picker.getByLabel('Google Sheets link').fill(`https://docs.google.com/spreadsheets/d/${sheet.id}/edit#gid=0`)
  await picker.locator('[data-field="weeks-sheets-read-link"]').click()
  const preview = page.locator('[data-field="weeks-preview"]')
  await expect(preview).toContainText('3 of 3 rows', { timeout: 30_000 })
  await expect(page.locator('[data-field="weeks-file-name"]')).toContainText(`Google Sheet: Callie week of Jan 11 ${run}`)
  await snap(page, info, 'weeks: from Google Sheets, the preview')
  await preview.getByRole('button', { name: /^Import 3 rows \(free\)$/ }).click()
  await expect(page.locator('[data-field="weeks-import-done"]')).toContainText('3 drafts made', { timeout: 30_000 })
  // ROOT / Plans / CHARACTER / made on first use.
  const files = (await (await fetch(`${DRIVE}/__files`)).json() as { files: Array<{ id: string; name: string; parents: string[] }> }).files
  const plans = files.find(f => f.name === 'Plans')!
  expect(files.some(f => f.name === 'Callie' && f.parents.includes(plans.id))).toBe(true)

  // The owner edits the sheet: G1 changed, G3 gone, G4 new.
  await sheetCall({ id: sheet.id, csv: [head, row('G1', WEEK, 'the recruiter said circle back. it is january now'), row('G2', '2027-01-12', 'my mom asked if i tried linkedin'), row('G4', '2027-01-14', 'the job post was reposted the day after my interview')].join('\n') })
  await page.goto(`/studio/weeks?week=${WEEK}&step=import`)
  await page.locator(`[data-field="weeks-resync-${sheet.id}"]`).click()
  const resync = page.locator('[data-field="weeks-resync"]')
  await expect(resync).toContainText('1 new row, 1 changed draft, 0 changed posts with pictures, 1 unchanged, 1 gone from the sheet', { timeout: 30_000 })
  await snap(page, info, 'weeks: Re-sync, the preview')
  await resync.locator('[data-field="weeks-resync-apply"]').click()
  await expect(page.locator('.st-toast').filter({ hasText: '1 added, 1 updated' })).toBeVisible({ timeout: 30_000 })
  const grid = await api<{ cells: Array<{ rowId: string; line: string }> }>('GET', `/weeks/${WEEK}`)
  expect(grid.cells.find(c => c.rowId === `G1${run}`)?.line).toMatch(/january now/)
  expect(grid.cells.some(c => c.rowId === `G4${run}`)).toBe(true)
  expect(grid.cells.some(c => c.rowId === `G3${run}`)).toBe(true)

  // Line bank > Import lines from a Google Sheet.
  const lines = await sheetCall({ name: `lines ${run}`, csv: `text,source,pain,emotion,format,voice_fit,life_or_job\n"${run} the offer came with a personality test",inventory,unpaid test,angry,finished damage,both,job\n` })
  await page.goto('/studio/line-bank')
  const box = page.locator('[data-field="line-bank-import-lines"]')
  await box.getByLabel('Google Sheets link for lines').fill(`https://docs.google.com/spreadsheets/d/${lines.id}/edit`)
  await box.locator('[data-field="line-bank-lines-sheet"]').click()
  await expect(box.locator('[data-field="line-bank-lines-preview"]')).toContainText(`lines ${run}: 1 lines, 1 new`, { timeout: 30_000 })
  await box.getByRole('button', { name: 'Import 1 line (free)' }).click()
  await expect(page.locator('.st-toast').filter({ hasText: '1 lines added to the bank.' })).toBeVisible({ timeout: 15_000 })
})
