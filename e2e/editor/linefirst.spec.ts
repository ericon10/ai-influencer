import { expect, test, type Locator, type Page } from '@playwright/test'
import { api, guideShot, snap } from './helpers'

// Line first, both doors (UX-PLAN.md rule 2 and section 43) like a person,
// in demo mode. New post for Doug: the Line drawer opens first, a money line
// is picked from the bank, the gas station is suggested first with its
// still, Reuse this still: $0 puts it on the post (pulled free, no run), and
// the post card shows the line and place_id; a tap opens the row with Open
// post. Weeks Fill on 2 Doug slots reuses the place-bank stills at $0, and
// Make lists them as Reused, $0.

const run = Date.now().toString(36).slice(-5)
const MONDAY = '2027-03-01'
const NEWPOST = `dougnp_${run}`, WEEK = `dougwk_${run}`
// Three run words, so a line of an earlier run is never a near-match (80% of the words shared) that Import lines drops.
const MONEY = `rent went up $400 and i have $12 left ${run}a ${run}b ${run}c`
let doug = ''

const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
// Two places with a still on the owner's Higgsfield account (pulled free;
// demo mode reads a placeholder): the gas station and the mailbox.
const PLACES = [
  ['place_id', 'scene', 'motion', 'still_job_id'],
  [`GS${run}`, 'Vertical 9:16 iPhone photo, upright portrait, under the bright canopy of a small-town gas station at night, the pumps lit, wet concrete. Level, unedited. Sharp, real phone grain, muted color. No people.', 'Rain falls past the canopy edge, the lights buzz. 6 seconds, 9:16.', '0a1b2c3d-1111-4a2b-9c3d-000000000001'],
  [`MB${run}`, 'Vertical 9:16 iPhone photo, upright portrait, a rusty mailbox at the end of a gravel driveway in steady rain, its door hanging open. Level, unedited. Sharp, real phone grain, muted color. No people.', 'Rain falls, the open mailbox door sways. 6 seconds, 9:16.', '0a1b2c3d-1111-4a2b-9c3d-000000000002'],
].map(r => r.map(q).join(',')).join('\n') + '\n'
const LINES = ['text,source,source_likes,pain,emotion,format,voice_fit,life_or_job', [MONEY, 'comment', '99999', 'rent', 'sad', 'finished damage', 'first', 'job'], [`the portal logged me out mid application again ${run}a ${run}b ${run}c`, 'comment', '99998', 'portal', 'frustrated', 'finished damage', 'first', 'job'], [`four interviews then a form email ${run}a ${run}b ${run}c`, 'comment', '99997', 'ghosted', 'angry', 'finished damage', 'first', 'job']]
  .map(r => (Array.isArray(r) ? r.map(q).join(',') : r)).join('\n') + '\n'

async function pay(page: Page, button: Locator) {
  await expect(button).toContainText(/\$\d|credits|Free/, { timeout: 30_000 })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  await button.click()
  const confirm = page.getByRole('button', { name: /^Confirm / })
  if (await confirm.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirm.first().click()
}

test.beforeAll(async () => {
  doug = (await api<{ id: string }>('POST', '/characters', { name: `Doug ${run}`, kind: 'faceless', template: 'doug' })).id
  await api('POST', `/characters/${doug}/places/import`, { csv: PLACES })
  await api('PUT', `/social-accounts/${NEWPOST}`, { characterId: doug })
  await api('PUT', `/social-accounts/${WEEK}`, { characterId: doug, slotsPerDay: 1 })
  await api('POST', '/line-bank/lines/import', { csv: LINES, name: `line first ${run}` })
})

test('New post for Doug: the line first, the gas station suggested for a money line, its still reused at $0, the line on the post card', async ({ page }, info) => {
  test.setTimeout(300_000)
  // New post, Doug (step 1, as today).
  const { id: post } = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: doug, accountTag: NEWPOST, spec: { faceless: { posted: false } } })
  await page.goto(`/studio/posts/${post}`)

  // 2. Line: the first drawer, open: the slot with the 3 best fits for Doug
  // and this post's product (none), in his voice (section 45).
  const line = page.locator('[data-field="faceless-line"]')
  await expect(line.locator('[data-field="line-slot"]')).toBeVisible({ timeout: 30_000 })
  const pick = line.locator('[data-field="line-best-item"]', { hasText: MONEY })
  await expect(pick).toBeVisible({ timeout: 30_000 })
  await pick.getByRole('button', { name: 'Use' }).click()
  // The drawer folds to its summary (the line and its pain) and Visual opens.
  await expect(line.locator('.st-hint').first()).toContainText('rent, sad', { timeout: 20_000 })

  // 3. Visual: opens next; the gas station first, its still reused for $0.
  const visual = page.locator('[data-field="faceless-still"]')
  const first = visual.locator('[data-field="place-suggestions"] .st-placecard').first()
  await expect(first).toBeVisible({ timeout: 30_000 })
  await expect(first).toContainText(`GS${run}`)
  await expect(first).toContainText(/gas station/i)
  await expect(first.locator('[data-field="place-why"]')).toContainText('money')
  await expect(line.locator('.st-hint').first()).toContainText(MONEY.slice(0, 30))
  await guideShot(page, page.locator('[data-field="faceless-post"]'), 'line-first-post', [
    [line.locator('button[aria-expanded]').first(), 'Line, first: the line from the bank (or your own, or No line), with its pain and emotion'],
    [first, 'The places that fit the line come first: the gas station for a money line, with its place_id and still'],
    [first.getByRole('button', { name: 'Reuse this still: $0' }), 'Reuse this still: $0, no generation'],
  ])
  await first.getByRole('button', { name: 'Reuse this still: $0' }).click()
  await expect(visual.locator('[data-field="faceless-still-reused"]')).toContainText(`Reused from GS${run}: $0`, { timeout: 60_000 })
  await expect(visual.locator('img').first()).toBeVisible()
  // No paid run was made for it: no faceless still job on this post.
  const jobs = await api<{ jobs: Array<{ purpose: string; postId?: string | null }> }>('GET', '/jobs?limit=200').catch(() => ({ jobs: [] }))
  expect(jobs.jobs.filter(j => j.purpose === `faceless_still:${post}`)).toHaveLength(0)
  // 4. Video: the motion prefilled from the place.
  await page.locator('[data-field="faceless-video"] button[aria-expanded]').click()
  await expect(page.getByLabel('Video prompt')).toHaveValue('Rain falls past the canopy edge, the lights buzz. 6 seconds, 9:16.')
  // 6. Text: the on-screen line from the line.
  await page.locator('[data-field="faceless-text"] button[aria-expanded]').click()
  await expect(page.getByLabel('On-screen line', { exact: true })).toHaveValue(MONEY)
  await snap(page, info, 'new post: line, visual reused at $0, video and text filled')

  // The post card: the line under the picture, and the place_id.
  await page.goto('/studio')
  const card = page.locator('.st-postcard', { has: page.locator(`[data-field="line-tag-${post}"]`) })
  await expect(card.locator('img').first()).toBeVisible({ timeout: 30_000 })
  const tag = card.locator(`[data-field="line-tag-${post}"]`)
  await expect(tag).toContainText(MONEY)
  await expect(tag.locator('[data-field="line-tag-place"]')).toHaveText(`GS${run}`)
  await snap(page, info, 'posts: the line and place_id under the picture')
  // A tap opens the full row, with Open post.
  await tag.click()
  const row = page.locator('[data-field="post-row"]')
  await expect(row.locator('[data-field="post-row-line"]')).toContainText(MONEY)
  await expect(row.locator('[data-field="post-row-line"]')).toContainText('pain: rent')
  await expect(row.locator('[data-field="post-row-place"]')).toContainText(`GS${run}`)
  await expect(row.locator('[data-field="post-row-still-from"]')).toHaveText('Reused from the place, $0')
  await guideShot(page, page.locator('.st-drawer'), 'line-first-row', [
    [row.locator('[data-field="post-row-line"]'), 'The line, with its pain, emotion and source'],
    [row.locator('[data-field="post-row-place"]'), 'The place_id and its scene'],
    [row.locator('[data-field="post-row-open"]'), 'Open post: back to the workspace'],
  ])
  await row.locator('[data-field="post-row-open"]').click()
  await expect(page).toHaveURL(new RegExp(`/studio/posts/${post}$`))
  await expect(page.locator('[data-field="faceless-post"]')).toBeVisible()
})

test('Weeks Fill on 2 Doug slots reuses the place-bank stills at $0, and Make lists them', async ({ page }, info) => {
  test.setTimeout(300_000)
  const head = ['row_id', 'account', 'date', 'slot', 'post_type', 'story_beat', 'caption', 'product']
  // Story beats that fit the two places with stills (a mailbox, gas money).
  const rows = [[`W1${run}`, WEEK, '2027-03-01', '1', 'faceless', 'checked the mailbox in the rain, nothing', 'day 60', 'none'], [`W2${run}`, WEEK, '2027-03-02', '1', 'faceless', 'gas money ran out at the pump', 'day 61', 'none']]
  const csv = [head, ...rows].map(r => r.map(q).join(',')).join('\n') + '\n'
  await api('POST', '/weeks/import', { csv, rows: rows.map(r => r[0]) })
  await page.goto(`/studio/weeks?week=${MONDAY}&step=fill`)
  await page.getByRole('button', { name: /^Fill empty slots \(free\)/ }).click()
  await expect(page.locator('[data-field="weeks-draw"]')).toContainText(/\d+ drawn/, { timeout: 30_000 })
  await page.locator('[data-field="weeks-save-draw"]').click()
  const saved = page.locator('[data-field="weeks-fill-saved"]')
  await expect(saved).toContainText('2 place stills reused at $0', { timeout: 30_000 })
  await expect(saved).toContainText('0 new stills')
  // The pulls land (free, on the worker): both posts have their place's still.
  await expect.poll(async () => {
    const w = await api<{ cells: Array<{ rowId: string; have: number; stillFrom: string | null; placeId: string | null }> }>('GET', `/weeks/${MONDAY}`)
    return w.cells.filter(c => c.rowId.endsWith(run) && c.have === 1 && c.stillFrom === 'place' && c.placeId).length
  }, { timeout: 90_000, intervals: [2000] }).toBe(2)
  await snap(page, info, 'weeks: fill saved, 2 place stills reused at $0')
  // The grid: each cell shows its line and place_id; a click opens the row.
  await page.reload()
  const cell = page.locator(`[data-field="weeks-cell-W1${run}"]`)
  await expect(cell).toContainText(/(MB|GS)/)
  await cell.click()
  await expect(page.locator('[data-field="post-row-still-from"]')).toHaveText('Reused from the place, $0')
  await page.keyboard.press('Escape')
  // Check, then Make: the stills are listed as reused at $0; only the videos are priced.
  await api('POST', `/weeks/${MONDAY}/check`, {})
  await page.goto(`/studio/weeks?week=${MONDAY}&step=make`)
  const stills = page.locator('[data-field="weeks-make-stills"]')
  await expect(stills).toContainText('reused from the place bank, $0', { timeout: 30_000 })
  await stills.getByRole('button', { name: 'Show each post' }).click()
  const list = page.locator('[data-field="weeks-make-still-list"]')
  await expect(list.locator('li', { hasText: `W1${run}` })).toContainText('Reused, $0')
  await expect(list.locator('li', { hasText: `W2${run}` })).toContainText('Reused, $0')
  await snap(page, info, 'weeks: make lists each post\'s still as Reused, $0')
})
