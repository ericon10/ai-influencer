import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { api, guideShot, seedData, snap as attach } from './helpers'

// Tier 5 (owner, 2026-10-22; UX-PLAN section 36, item 29): the line bank.
// Driven like a user in demo mode: import an Apify comment scrape in the
// post workspace's drawer (free, with its first pass), tag, write and
// review (priced), filter, Keep and Reject, Use this line on a slideshow,
// and Write the week on the Launch plan card.

const SHOTS = join(process.cwd(), 'e2e', '.out', 'shots')
async function snap(page: Page, info: TestInfo, name: string) {
  await attach(page, info, name)
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), await page.screenshot())
}

const HEAD = 'comment_likes,replies,comment,themes,video_account,video_views,liked_by_creator,video_url\n'
const V = 'https://www.tiktok.com/@reb/video/7667755283665472782'
const GOOD = [
  'They laid me off 2 weeks before Christmas and asked me to train my replacement',
  'applied to 300 jobs since May and got ONE interview and they ghosted me',
  '6 rounds of interviews for a job that pays less than my old internship',
  'my mom asks how the job search is going every single dinner',
  'entry level job wanted 5 years of experience and a masters degree',
  'the recruiter said they would be in touch. that was in march',
  'got rejected by an AI before a human ever saw my resume',
  'my rent is due friday and the only offer i got is $14 an hour',
  'i have a degree and i am working the same retail shift as in high school',
  'they reposted the same job 4 times and never called me back once',
  'my manager took credit for my project then laid me off the next week',
  'final round interview went great and then silence for 6 weeks',
]
// Each run its own words, so the bank's own duplicate check never hides them.
const csvFor = (run: string) => HEAD + [
  ...GOOD.map((c, i) => `${5000 - i * 37},4,"${c} (${run})",,@reb,13911804,yes,${V}`),
  `3,0,"${GOOD[0]} (${run})",,@reb,100,,${V}`,
  `1,0,"my boss fired me for being late once (${run})",,@reb,100,,${V}`,
  `40,1,"so true bestie",,@reb,100,,${V}`,
  `30,2,"ang hirap humanap ng trabaho, any advice naman po sa mga job",,@reb,100,,${V}`,
  `60,0,"she looks exactly like my cousin from ohio lol (${run})",,@reb,100,,${V}`,
].join('\n')
const videos = `url,text,authorMeta.name\n${V},this is vulnerableeee but I'm emo today,reb\n`

const press = (phone: boolean, l: Locator) => (phone ? l.tap() : l.click())

// A slideshow on its own account, opened at its Idea step.
async function slideshow(page: Page, tag: string) {
  const made = await api('POST', '/content', { kind: 'slideshow', characterId: seedData().callie, accountTag: tag, idea: 'job hunting', productId: seedData().sideStep })
  const id = made.item?.id ?? made.id
  await page.goto(`/studio/posts/${id}`)
  await page.locator('.st-poststeps button').filter({ hasText: 'Idea' }).first().click()
  return id as string
}

// Every priced button in the drawer stays inside its card (item 22's rule).
async function priceInside(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.st-drawer .st-pricebtn')).filter(b => {
    const card = b.closest('.st-bankline, .st-card, .st-drawer-body')!
    const r = b.getBoundingClientRect(), c = card.getBoundingClientRect()
    return r.width > 0 && (r.left < c.left - 1 || r.right > c.right + 1)
  }).length)
}

async function lineBank(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(300_000)
  const run = `${phone ? 'p' : 'd'}${Date.now().toString(36)}`
  const tag = `callie.bank${run}`
  const postId = await slideshow(page, tag)
  await press(phone, page.getByRole('button', { name: 'Pick from the bank' }))
  const drawer = page.locator('.st-drawer')
  await expect(drawer.locator('.st-drawer-head .st-titlerow')).toContainText('Line bank')
  // Import (free): the comments and the videos as CSV files.
  const imp = drawer.locator('[data-field="line-bank-import"]')
  // The bank has loaded (its box says what to import) before the box is read.
  await expect(imp.locator('summary')).toBeVisible()
  await expect(drawer.locator('.st-skel')).toHaveCount(0)
  if (!(await imp.evaluate(el => (el as HTMLDetailsElement).open))) await press(phone, imp.locator('summary'))
  await expect.poll(() => imp.evaluate(el => (el as HTMLDetailsElement).open)).toBe(true)
  await imp.getByLabel('The comments as a CSV file').setInputFiles({ name: `apify-${run}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csvFor(run)) })
  await imp.getByLabel('The videos as a CSV file').setInputFiles({ name: 'videos.csv', mimeType: 'text/csv', buffer: Buffer.from(videos) })
  await press(phone, imp.getByRole('button', { name: 'Import (free)' }))
  const summary = imp.locator('[data-field="line-bank-import-summary"]')
  await expect(summary).toContainText(`apify-${run}.csv`)
  await expect(summary).toContainText('17 comments')
  await expect(summary).toContainText('12 kept')
  await expect(summary).toContainText('1 with 0 or 1 likes')
  await expect(summary).toContainText('1 not English')
  // The priced run: one price for the tags, the writer and the reviewer.
  const runBox = drawer.locator('[data-field="line-bank-run"]')
  await expect(runBox).toBeVisible()
  await runBox.getByLabel('How many comments to run').selectOption({ index: (await runBox.getByLabel('How many comments to run').locator('option').count()) - 1 })
  const go = runBox.getByRole('button', { name: /^Tag, write and review [\d,]+ comments?/ })
  await expect(go).toContainText(/\$\d/)
  await snap(page, info, `${phone ? 'phone: ' : ''}line bank: import and the price`)
  await press(phone, go)
  const lines = drawer.locator('[data-field="bank-line"]')
  await expect.poll(() => lines.count(), { timeout: 120_000 }).toBeGreaterThan(0)
  await expect(drawer.locator('[data-field="line-bank-counts"]')).toContainText(/rejected by the reviewer \(never shown\)/, { timeout: 60_000 })
  // Each line: its source comment with its likes, its tags and its scores.
  const first = lines.first()
  await expect(first.locator('.st-bankline-source')).toContainText(/From a comment with [\d.]+k? likes/)
  await expect(first.locator('[data-field="bank-line-scores"]')).toContainText(/gut \d+ · specific \d+ · real \d+/)
  // Filters: the character's way of telling lines, then a topic.
  await expect(drawer.locator('[data-field="line-bank-stance"]')).toBeVisible()
  await press(phone, drawer.locator('[data-field="line-bank-stance"]').getByRole('radio', { name: 'First person (out of work)' }))
  await expect(drawer.locator('[data-field="line-bank-stance"]').getByRole('radio', { name: 'First person (out of work)' })).toHaveAttribute('aria-checked', 'true')
  // Keep and Reject are logged on the line.
  // (a line nobody has called yet: Keep on a kept line takes the call back)
  const fresh = drawer.locator('[data-field="bank-line"][data-call=""]').first()
  const freshId = (await fresh.getAttribute('data-id'))!
  await press(phone, fresh.getByRole('button', { name: 'Keep' }))
  await expect(drawer.locator(`[data-field="bank-line"][data-id="${freshId}"]`)).toHaveAttribute('data-call', 'kept')
  expect(await priceInside(page)).toBe(0)
  // Use this line: priced, in Callie's voice, placed on slide 1.
  const pick = lines.first()
  const text = (await pick.locator('.st-bankline-text').textContent())!.trim()
  const lineId = (await pick.getAttribute('data-id'))!
  await press(phone, pick.getByRole('button', { name: 'Use this line' }))
  const use = pick.locator('.st-pricebtn').getByRole('button', { name: /^Use this line/ })
  await expect(use).toContainText(/\$\d/)
  expect(await priceInside(page)).toBe(0)
  await snap(page, info, `${phone ? 'phone: ' : ''}line bank: the lines`)
  if (!phone && process.env.GUIDE_SHOTS) await guideShot(page, drawer.locator('.st-drawer-body'), 'line-bank', [
    [drawer.locator('[data-field="line-bank-counts"]'), 'What passed; what the reviewer rejected never shows'],
    [drawer.locator('[data-field="line-bank-filters"]'), 'Filter by character (how they tell lines), emotion, topic and pain point'],
    [pick.locator('.st-bankline-text'), 'The line, starting at 70'],
    [pick.locator('.st-bankline-source'), 'Its source comment and likes'],
    [pick.getByRole('button', { name: 'Keep' }), 'Keep or Reject: the writer and the reviewer learn from it'],
    [use, 'Use this line: in her voice, placed on slide 1'],
  ])
  await press(phone, use)
  await expect(drawer).toBeHidden({ timeout: 60_000 })
  await expect.poll(async () => ((await api('GET', `/content/${postId}`)).item.spec.hook as string), { timeout: 60_000 }).toBe(text)
  // The hook box on the page shows it (no reload).
  await expect(page.locator('[data-field="slideshow-hook"] input.st-input').first()).toHaveValue(text)
  // Never for another account.
  const other = await api('GET', `/line-bank?characterId=${seedData().callie}&accountTag=someone.else${run}`)
  expect(other.lines.some((l: { id: string }) => l.id === lineId)).toBe(false)
  const here = await api('GET', `/line-bank?characterId=${seedData().callie}&accountTag=${tag}`)
  expect(here.lines.some((l: { id: string }) => l.id === lineId)).toBe(true)
}

async function writeTheWeek(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(240_000)
  const run = `${phone ? 'p' : 'd'}${Date.now().toString(36)}`
  const tag = `callie.week${run}`
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  for (const [i, n] of [1, 2].entries()) await api('POST', '/content', { kind: 'slideshow', characterId: seedData().callie, accountTag: tag, idea: `week ${i}`, spec: { plan: { rowId: `W${run}${i}`, date: day(n), format: 'character slideshow' } } })
  // Lines to fill them (the drawer's run, through the API here).
  await api('POST', '/line-bank/import', { comments: { csv: csvFor(`w${run}`) }, productId: seedData().sideStep })
  const est = await api('POST', '/actions/estimate', { action: { type: 'bank_run', limit: null } })
  await api('POST', '/actions/run', { action: { type: 'bank_run', limit: null }, quoteId: est.quote.id, confirmed: true })
  await expect.poll(async () => (await api('GET', '/line-bank')).counts.running, { timeout: 120_000 }).toBe(0)
  await page.goto('/studio')
  const plan = page.locator('[data-field="launch-plan"]')
  if (!(await plan.locator('[data-field="write-the-week"]').isVisible().catch(() => false))) await press(phone, plan.locator('.st-card-head button').first())
  const week = plan.locator('[data-field="write-the-week"]')
  await week.scrollIntoViewIfNeeded()
  await week.getByLabel('Account').selectOption(tag)
  await expect(week.locator('.st-weeklist li')).toHaveCount(2)
  const go = week.getByRole('button', { name: /^Write the week: 2 posts/ })
  await expect(go).toContainText(/\$\d/)
  await snap(page, info, `${phone ? 'phone: ' : ''}write the week`)
  if (!phone && process.env.GUIDE_SHOTS) await guideShot(page, week, 'write-the-week', [
    [week.locator('.gd-howto'), 'How the line bank works'],
    [week.getByLabel('Account'), 'The account'],
    [week.locator('.st-weeklist'), 'Its posts dated in the next 7 days, each with the line it gets'],
    [go, 'One price: every line in its character\'s voice, placed'],
  ])
  await press(phone, go)
  await expect.poll(async () => (await api('GET', `/line-bank/week?accountTag=${tag}`)).posts.length, { timeout: 90_000 }).toBe(0)
}

test.describe.configure({ mode: 'serial' })

test('line bank: import free with the first pass, tag, write and review for one price, filter, keep, and use a line on a slideshow', async ({ page }, info) => { await lineBank(page, info, false) })
test('line bank: Write the week fills an account\'s dated posts from the bank', async ({ page }, info) => { await writeTheWeek(page, info, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('phone: the line bank drawer, start to finish', async ({ page }, info) => { await lineBank(page, info, true) })
  test('phone: Write the week', async ({ page }, info) => { await writeTheWeek(page, info, true) })
})
