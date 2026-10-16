import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { API, api, snap } from './helpers'

// Launch ready (UX-PLAN.md section 28), like a user, in demo mode: the plan
// CSV uploaded, Preview (free) by day and account, Make the drafts (free),
// Generate 2 posts (its price on the button, ten at a time), the Plan line
// on a post; the playbook hook writer with its reviewer (only 1s and 2s
// show), the language notes, the alt hook swap, a new mock screen and the
// owner's Product screenshot, then the export with post.json and "Ad:".
// Needs a local Solei (Callie's file with the name replaced) so the
// plan's SOLEI rows match, as they do in production.

const CSV = join(process.cwd(), 'docs', 'content', 'launch-plan-v2-posts.csv')

interface PlanPost { id: string; rowId: string; account: string; need: number; have: number }
const planPosts = async () => (await api<{ posts: PlanPost[] }>('GET', '/plan')).posts

async function pay(page: Page, button: Locator, scope?: Locator) {
  await expect(button).toContainText(/\$\d|credits|Free/, { timeout: 30_000 })
  await button.click()
  const confirm = (scope ?? page.locator('body')).getByRole('button', { name: /^Confirm / })
  if (await confirm.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirm.first().click()
}

async function openPlan(page: Page) {
  await page.goto('/studio')
  const card = page.locator('[data-field="launch-plan"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const head = card.getByRole('button', { name: /Launch plan/ })
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  return card
}

test('the launch plan: upload the CSV, Preview (free), Make the drafts (free), Generate 2 posts (priced), the Plan line on a post', async ({ page }, info) => {
  test.setTimeout(420_000)
  const card = await openPlan(page)
  const again = card.getByRole('button', { name: /Import a plan CSV again/ })
  if (await again.isVisible({ timeout: 2000 }).catch(() => false)) await again.click()
  await card.locator('[data-field="plan-import"] input[type="file"]').setInputFiles(CSV)
  await expect(card.getByLabel('Plan rows')).not.toHaveValue('', { timeout: 10_000 })
  await card.getByRole('button', { name: /^Preview \(free\)/ }).click()
  const preview = card.locator('[data-field="plan-preview"]')
  await expect(preview).toBeVisible({ timeout: 60_000 })
  // Every row reads: 140 posts, the 4 feeders as topic accounts, a price for all the stills.
  await expect(card.locator('[data-field="plan-totals"]')).toContainText(/140 posts/)
  await expect(card.locator('[data-field="plan-totals"]')).toContainText(/about \$\d+\.\d\d/)
  await expect(preview.locator('tbody tr', { hasText: 'Topic account' })).toHaveCount(4)
  await expect(preview.locator('tbody tr', { hasText: 'Character: Solei' })).toHaveCount(1)
  await expect(card.locator('[data-field="plan-grid"] .st-planchip')).toHaveCount(140)
  await expect(card.locator('[data-field="plan-errors"]')).toHaveCount(0)
  await card.locator('[data-field="plan-grid"]').scrollIntoViewIfNeeded()
  await snap(page, info, 'the plan preview by day and account')

  // Make 140 drafts (free): nothing paid runs.
  await card.getByRole('button', { name: /^Make 140 drafts \(free\)/ }).click()
  await expect(card.locator('[data-field="plan-done"]')).toContainText(/drafts made/, { timeout: 120_000 })
  expect((await planPosts()).length).toBe(140)

  // Generate 2 posts: F2's first two that still need pictures, one price.
  const posts = card.locator('[data-field="plan-posts"]')
  await posts.getByLabel('Account').selectOption('F2')
  const need = (await planPosts()).filter(p => p.account === 'F2' && p.have < p.need).slice(0, 2)
  expect(need).toHaveLength(2)
  for (const p of need) await posts.getByLabel(`Pick ${p.rowId}`).check()
  const go = posts.getByRole('button', { name: /^Generate 2 posts/ })
  await posts.scrollIntoViewIfNeeded()
  await snap(page, info, 'two posts ticked, the price on the button')
  await pay(page, go, posts)
  await expect.poll(async () => (await planPosts()).filter(p => need.some(n => n.id === p.id)).every(p => p.have >= p.need), { timeout: 240_000, intervals: [3000] }).toBe(true)
  await expect(posts.locator(`[data-field="plan-post-${need[0]!.rowId}"]`)).toContainText(/(\d+) of \1/, { timeout: 30_000 })

  // The post: the Plan line, the hook as written, every slide filled.
  await posts.locator(`[data-field="plan-post-${need[0]!.rowId}"]`).getByRole('link').click()
  const line = page.locator('[data-field="plan-line"]')
  await expect(line).toContainText(`Plan ${need[0]!.rowId}`, { timeout: 30_000 })
  await line.getByRole('button').click()
  await expect(line).toContainText('Alt hook:')
  await snap(page, info, 'an imported post with its Plan line')
})

test('Write 10 with Claude to THE STANDARD: a moment, a code, effects, pain, an alt hook and a score each; the reviewer\'s stop test and ladder hide the rest; language notes; Swap with the alt hook', async ({ page }, info) => {
  test.setTimeout(300_000)
  const p = (await planPosts()).find(x => x.account === 'F2')
  expect(p, 'import the plan first (the test above)').toBeTruthy()
  // A fresh F2 topic post, so the plan's own words stay as they are.
  const characters = (await api<{ characters: { id: string; name: string }[] }>('GET', '/characters')).characters
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId: characters.find(c => c.name === 'Callie')!.id, accountTag: 'F2', idea: 'rejection emails', spec: { mode: 'topic' } })
  await page.goto(`/studio/posts/${id}`)
  await expect(page.locator('[data-field="slideshow-hook"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-field="account-structures"]')).toContainText(/primary L14 Museum exhibit/)

  await pay(page, page.getByRole('button', { name: /Write 10 with Claude/ }))
  const cards = page.locator('[data-field="hook-ideas"] [data-field="hook-card"]')
  await expect(page.locator('[data-field="hooks-hidden"]')).toContainText(/4 scored 3 to 5 and are hidden \(only a 1 or 2 ships\); 4 of them failed the stop test/, { timeout: 120_000 })
  await expect(cards).toHaveCount(6)
  const first = cards.first()
  await expect(first.locator('.st-score')).toHaveText(/^[12]$/)
  await expect(first).toContainText(/[SL]\d{1,2} /)
  await expect(first).toContainText(/E\d/)
  await expect(first).toContainText(/Alt:/)
  await expect(first).toContainText(/Pain [78]\/10/)
  // Every hook shown reads to THE STANDARD: no language notes on the cards.
  await expect(page.locator('[data-field="hook-ideas"] [data-field="lint"]')).toHaveCount(0)
  await snap(page, info, 'the playbook hook cards, reviewed')

  // The language notes as you type (free, warnings only).
  const hook = page.locator('[data-field="slideshow-hook"] input').first()
  await hook.fill(`You should just unlock your dream job ${String.fromCharCode(0x2014)} today`)
  const notes = page.locator('[data-field="hook-lint"]')
  await expect(notes).toContainText(/dash/i)
  await expect(notes).toContainText(/should/)
  await expect(notes).toContainText(/just/)
  await expect(notes).toContainText(/unlock|dream job/)
  await expect(notes).toContainText(/You/)
  await snap(page, info, 'language notes under the hook')
  // THE STANDARD's three: a label to open, stacked quotes, over 15 words.
  await hook.fill("Exhibit 1: recruiter said 'talk Friday' and then 'end of week' and then nothing at all for weeks")
  await expect(notes).toContainText(/Opens with "Exhibit"/)
  await expect(notes).toContainText(/2 quoted phrases/)
  await expect(notes).toContainText(/\d+ words\. Slide 1 reads in one go/)

  // Swap with the alt hook (free).
  await hook.fill('Applied 11:52pm. Rejected 2:14am.')
  await page.getByLabel('Alt hook').fill('Exhibit 1: a rejection received at 2:14am.')
  await expect(notes).toHaveCount(0)
  await page.getByRole('button', { name: /Swap with the alt hook/ }).click()
  await expect(hook).toHaveValue('Exhibit 1: a rejection received at 2:14am.')
  await expect(page.getByLabel('Alt hook')).toHaveValue('Applied 11:52pm. Rejected 2:14am.')
  await expect.poll(async () => (await api<{ item: { spec: { hook: string; plan: { altHook: string } } } }>('GET', `/content/${id}`)).item.spec.plan.altHook, { timeout: 15_000 }).toBe('Applied 11:52pm. Rejected 2:14am.')
})

test('a mock screen drawn by code and the owner\'s Product screenshot, then the export: post.json with the plan and "Ad:" first', async ({ page }, info) => {
  test.setTimeout(420_000)
  // A product slideshow from the plan (an ad), its pictures made in the test above or here.
  const all = await planPosts()
  const rows = await Promise.all(all.filter(p => p.account !== 'CALLIE' && p.account !== 'SOLEI').slice(0, 60).map(async p => ({ p, item: (await api<{ item: { kind: string; spec: { plan: { product: boolean }; mode: string } } }>('GET', `/content/${p.id}`)).item })))
  const pick = rows.find(r => r.item.kind === 'slideshow' && r.item.spec.plan.product)
  expect(pick, 'a product slideshow in the plan').toBeTruthy()
  const id = pick!.p.id
  if (pick!.p.have < pick!.p.need) {
    const action = { type: 'plan_generate', postIds: [id] }
    const est = await api<{ quote: { id: string } }>('POST', '/actions/estimate', { action })
    await api('POST', '/actions/run', { action, quoteId: est.quote.id, confirmed: true })
    await expect.poll(async () => (await planPosts()).find(p => p.id === id)!.have >= pick!.p.need, { timeout: 180_000, intervals: [3000] }).toBe(true)
  }
  await page.goto(`/studio/posts/${id}`)
  await page.locator('.st-step', { hasText: 'Stills' }).click()
  const cards = page.locator('[data-field="slide-cards"] .st-slidecard')
  await expect(cards.first()).toBeVisible({ timeout: 60_000 })
  const n = await cards.count()
  // The second slide: a lock screen with a notification stack (free).
  await page.locator('[data-field="slide-card-1"] select').selectOption('lock_screen')
  // The last slide: the owner's own screenshot of the product.
  const last = page.locator(`[data-field="slide-card-${n - 1}"]`)
  await last.locator('select').selectOption('product_shot')
  await expect(last.locator(`[data-field="product-shot-${n - 1}"]`)).toContainText('The Studio never draws a product screen')
  mkdirSync(info.outputDir, { recursive: true })
  const shot = join(info.outputDir, 'product-screenshot.png')
  writeFileSync(shot, await screenshotPng(page))
  const chooser = page.waitForEvent('filechooser')
  await last.getByRole('button', { name: /Upload the screenshot/ }).click()
  await (await chooser).setFiles(shot)
  await expect(last.getByRole('button', { name: /Replace the screenshot/ })).toBeVisible({ timeout: 60_000 })
  await snap(page, info, 'a lock screen and the product screenshot')

  // Slides: the special slide's editor and the language notes under each slide and the caption.
  await page.locator('.st-step', { hasText: 'Slides' }).click()
  await page.locator('[data-field="slide-text-1"] textarea, [data-field="slide-text-1"] input').first().focus()
  await expect(page.locator('[data-field="special-editor"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-field="slideshow-caption"] pre')).toContainText(/^Ad: /, { timeout: 15_000 })
  await snap(page, info, 'the lock screen editor and Ad: first')

  // Finish: Export, post.json with the plan's fields.
  await page.locator('.st-step', { hasText: 'Finish' }).click()
  const exp = page.getByRole('button', { name: /^Export images/ })
  await expect(exp).toBeEnabled({ timeout: 30_000 })
  await exp.click()
  await expect(page.locator('[data-field="slideshow-outputs"]')).toBeVisible({ timeout: 120_000 })
  const item = (await api<{ item: { outputs: { zipAssetId: string } } }>('GET', `/content/${id}`)).item
  const zip = unzipSync(new Uint8Array(await (await fetch(`${API}/assets/${item.outputs.zipAssetId}/content`)).arrayBuffer()))
  const json = JSON.parse(Buffer.from(zip['post.json']!).toString())
  expect(json.version).toBe(2)
  expect(json.plan).toMatchObject({ row_id: pick!.p.rowId, product: true })
  expect(json.slides[1].special.type).toBe('lock_screen')
  expect(json.slides[n - 1].special).toMatchObject({ type: 'product_shot', asset_id: expect.stringMatching(/^ast_/) })
  expect(Buffer.from(zip['caption.txt']!).toString().startsWith('Ad: ')).toBe(true)
  await snap(page, info, 'exported with the plan in post.json')
})

// A stand-in screenshot: the Studio's own page as a PNG, tall like a phone's.
async function screenshotPng(page: Page): Promise<Buffer> {
  return page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 844 }, type: 'png' })
}
