import { expect, test } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// Weeks, the overnight stack (UX-PLAN.md section 42) like a person, in demo
// mode: text-only posts imported from a plan, Render N $0 posts on Make the
// week (no quote), each one made into a video on the worker; Generate the
// rest of one day, priced on its own button. Nothing paid runs.

const run = Date.now().toString(36).slice(-5)
const MONDAY = '2027-02-01'
const ACCOUNT = `callie_free_${run}`
// The viewer test uses the posts the first one renders.
test.describe.configure({ mode: 'serial' })
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

test('Make the week: Render 2 $0 posts makes the text posts; Generate the rest of one day is priced', async ({ page }, info) => {
  test.setTimeout(300_000)
  const { callie } = seedData()
  await api('PUT', `/social-accounts/${ACCOUNT}`, { characterId: callie, slotsPerDay: 3 })
  const rows = [
    ['row_id', 'account', 'date', 'slot', 'post_type', 'line', 'text_style', 'outfit', 'scene', 'clip_action'],
    [`T1${run}`, ACCOUNT, '2027-02-01', '1', 'text_only', 'my manager: any questions? / me: is this job real ' + run, 'two_beat', '', '', ''],
    [`T2${run}`, ACCOUNT, '2027-02-02', '1', 'text_only', 'Her: are you ok / Me: define ok ' + run, 'dialogue', '', '', ''],
    [`K1${run}`, ACCOUNT, '2027-02-01', '2', 'clip', 'the dryer ate my one good sweater ' + run, '', 'faded band tee', 'a laundromat at night', 'she holds up the tiny sweater'],
    [`K2${run}`, ACCOUNT, '2027-02-03', '2', 'clip', 'my plant died on my day off ' + run, '', 'gray hoodie', 'her small kitchen', 'she looks at the dead plant'],
  ]
  await api('POST', '/weeks/import', { csv: rows.map((r, i) => [...r, i ? 'none' : 'product'].map(q).join(',')).join('\n'), rows: rows.slice(1).map(r => r[0]) })
  await api('POST', `/weeks/${MONDAY}/check`, {})
  await page.goto(`/studio/weeks?week=${MONDAY}&step=make`)
  const make = page.locator('[data-field="weeks-make"]')
  await expect(make).toBeVisible({ timeout: 30_000 })
  const render = make.locator('[data-field="weeks-render-free-button"]')
  await expect(render).toHaveText('Render 2 $0 posts')
  // The paid Make counts only the clips.
  await expect(make.getByRole('button', { name: /^Make the week \(2 posts\)/ })).toBeVisible()
  const day = make.locator('[data-field="weeks-make-day"]')
  await expect(day).toBeVisible()
  await expect(day.getByRole('button', { name: /^Generate the rest of Mon/ })).toContainText(/\$\d|credits|Free/, { timeout: 30_000 })
  await snap(page, info, 'weeks: Render $0 posts and Generate the rest of a day')
  await render.click()
  await expect.poll(async () => {
    const w = await api<{ cells: Array<{ rowId: string; made: boolean }> }>('GET', `/weeks/${MONDAY}`)
    return w.cells.filter(c => [`T1${run}`, `T2${run}`].includes(c.rowId) && c.made).length
  }, { timeout: 180_000, intervals: [3000] }).toBe(2)
  await page.reload()
  await expect(page.locator('[data-field="weeks-render-free-button"]')).toHaveCount(0, { timeout: 30_000 })
})

test('Posts home: the viewer opens a post cover full size and moves to the next and previous post', async ({ page }) => {
  await page.goto('/studio')
  // The two text posts rendered above have video covers.
  await page.getByRole('button', { name: ACCOUNT, exact: true }).click()
  const views = page.locator('.st-postcard-view')
  await expect(views.nth(1)).toBeVisible({ timeout: 30_000 })
  await views.first().click()
  const viewer = page.locator('[data-field="viewer"]')
  await expect(viewer).toBeVisible()
  // What is on screen: the picture or clip shown full size.
  const title = async () => (await viewer.locator('[data-field="viewer-image"], [data-field="viewer-video"]').first().getAttribute('src'))
  const first = await title()
  await viewer.getByRole('button', { name: 'Next' }).click()
  await expect.poll(title).not.toBe(first)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(title).toBe(first)
  await viewer.getByRole('button', { name: 'Close' }).click()
  await expect(viewer).toHaveCount(0)
})
