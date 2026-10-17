import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { API, api, snap } from './helpers'

// Launch ready (UX-PLAN.md sections 28 and 29), like a user, in demo mode:
// the plan CSV uploaded (shown as its name and rows), Preview (free), the
// plan's product (SideStep), F2's rows ticked and imported (free, only
// those), Generate 2 posts (its price on the button, ten at a time), the Plan line
// on a post; the playbook hook writer with its reviewer (only 1s and 2s
// show), the language notes, the alt hook swap, a new mock screen and the
// owner's Product screenshot, then the export with post.json and "Ad:".
// Needs a local Solei (Callie's file with the name replaced) so the
// plan's SOLEI rows match, as they do in production.

const CSV = join(process.cwd(), 'docs', 'content', 'launch-plan-v2-posts.csv')

interface PlanPost { id: string; rowId: string; account: string; need: number; have: number }
const planPosts = async () => (await api<{ posts: PlanPost[] }>('GET', '/plan')).posts
const sideStepId = async () => (await api<{ products: { id: string; name: string }[] }>('GET', '/products')).products.find(p => p.name === 'SideStep')!.id

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

test('the launch plan: upload the CSV, Preview (free), the plan\'s product, tick F2\'s rows and Import them (free), Generate 2 posts (priced), the Plan line on a post', async ({ page }, info) => {
  test.setTimeout(420_000)
  const sideStep = await sideStepId()
  const card = await openPlan(page)
  const again = card.getByRole('button', { name: /Import plan rows again/ })
  if (await again.isVisible({ timeout: 2000 }).catch(() => false)) await again.click()
  await card.locator('[data-field="plan-import"] input[type="file"]').setInputFiles(CSV)
  // The file shows as its name and rows, not its raw text.
  await expect(card.locator('[data-field="plan-file"]')).toHaveText('launch-plan-v2-posts.csv · 140 rows loaded', { timeout: 10_000 })
  await expect(card.getByLabel('Plan rows')).toHaveCount(0)
  await card.getByRole('button', { name: /^Preview \(free\)/ }).click()
  const preview = card.locator('[data-field="plan-preview"]')
  await expect(preview).toBeVisible({ timeout: 60_000 })
  await expect(preview.locator('tbody tr', { hasText: 'Topic account' })).toHaveCount(4)
  await expect(preview.locator('tbody tr', { hasText: 'Character: Solei' })).toHaveCount(1)
  await expect(card.locator('[data-field="plan-errors"]')).toHaveCount(0)
  // Nothing imports before the product (this older file's product column
  // is yes or no, so every row takes the plan's pick) and a ticked row.
  const importBtn = card.locator('[data-field="plan-step-4"]').getByRole('button', { name: /^Import/ })
  await card.getByLabel('This plan is for').selectOption(sideStep)
  await expect(preview.locator('[data-field="plan-product"]')).toContainText(/SideStep rules/, { timeout: 30_000 })
  await expect(importBtn).toBeDisabled()
  await expect(card.locator('[data-field="plan-step-4"] .st-todo')).toContainText('Tick the rows to import')
  // Tick F2's rows (28), each with its product and Ad on its ad rows.
  const rows = card.locator('[data-field="plan-rows"]')
  await rows.getByLabel('Account').selectOption('F2')
  await rows.getByRole('button', { name: /^Tick the \d+ shown/ }).click()
  const totals = card.locator('[data-field="plan-totals"]')
  await expect(totals).toContainText(/^\d+ of \d+ rows ticked/)
  const t = await totals.innerText()
  const ticked = Number(t.match(/^(\d+) of/)![1])
  expect(ticked).toBeGreaterThan(0)
  expect(ticked).toBeLessThanOrEqual(28)
  // (Rows made with pictures in an earlier run are kept and not listed.)
  const listed = await rows.locator('tbody tr[data-field^="plan-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-field')!.replace('plan-row-', '')))
  expect(listed.length).toBe(ticked)
  await expect(rows.locator(`[data-field="plan-row-${listed[0]}"]`)).toContainText('SideStep (plan)')
  const adRow = ['P037', 'P051', 'P087', 'P101', 'P137'].find(r => listed.includes(r))
  if (adRow) await expect(rows.locator(`[data-field="plan-row-${adRow}"]`)).toContainText('Ad')
  await rows.scrollIntoViewIfNeeded()
  await snap(page, info, 'the plan\'s product and F2\'s rows ticked')

  // Import (free): only the ticked rows, each written for SideStep; nothing paid runs.
  await expect(importBtn).toHaveText(`Import ${ticked} rows (free)`)
  await importBtn.click()
  await expect(card.locator('[data-field="plan-done"]')).toContainText(/drafts made/, { timeout: 120_000 })
  const f2 = (await planPosts()).filter(p => p.account === 'F2')
  expect(f2.length).toBeGreaterThanOrEqual(ticked)
  const firstRow = await api<{ item: { productId: string | null; spec: { ad: boolean } } }>('GET', `/content/${f2.find(p => p.rowId === listed[0])!.id}`)
  expect(firstRow.item.productId).toBe(sideStep)
  if (adRow) expect((await api<{ item: { productId: string | null; spec: { ad: boolean } } }>('GET', `/content/${f2.find(p => p.rowId === adRow)!.id}`)).item).toMatchObject({ productId: sideStep, spec: { ad: true } })

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
  // The card reads the plan again when the stills are done: no reload.
  await expect(posts.locator(`[data-field="plan-post-${need[0]!.rowId}"]`)).toContainText(/(\d+) of \1/, { timeout: 30_000 })
  await expect(posts.locator(`[data-field="plan-post-${need[1]!.rowId}"]`)).toContainText(/(\d+) of \1/, { timeout: 30_000 })
  await snap(page, info, 'both posts filled after Generate, no reload')

  // The post: the Plan line, the hook as written, every slide filled.
  await posts.locator(`[data-field="plan-post-${need[0]!.rowId}"]`).getByRole('link').click()
  const line = page.locator('[data-field="plan-line"]')
  await expect(line).toContainText(`Plan ${need[0]!.rowId}`, { timeout: 30_000 })
  await line.getByRole('button').click()
  await expect(line).toContainText('Alt hook:')
  await snap(page, info, 'an imported post with its Plan line')
})

test('the Pictures column ends on the full count even when the run starts and ends between two reads of the jobs list', async ({ page }, info) => {
  test.setTimeout(300_000)
  const p = (await planPosts()).find(x => x.account === 'F2' && x.have < x.need)
  expect(p, 'import the plan first (the test above)').toBeTruthy()
  // The jobs list never shows a still running, as when the run is over
  // before the list is read again. The card still reads the plan when the
  // run is done (it stayed "0 of 6" until a reload, owner, 2026-10-17).
  await page.route(/\/api\/v1\/jobs\?.*live=1/, async r => {
    const res = await r.fetch().catch(() => null)
    if (!res) return r.abort().catch(() => undefined)
    const body = await res.json() as { jobs: { status: string; phase?: string }[] }
    const active = ['waiting', 'queued', 'submitting', 'running', 'ingesting', 'needs_attention']
    await r.fulfill({ response: res, json: { ...body, jobs: body.jobs.filter(j => !active.includes(j.status) && j.phase !== 'checking') } })
  })
  const card = await openPlan(page)
  const posts = card.locator('[data-field="plan-posts"]')
  await posts.getByLabel('Account').selectOption('F2')
  const row = posts.locator(`[data-field="plan-post-${p!.rowId}"]`)
  await expect(row).toContainText(`${p!.have} of ${p!.need}`)
  await posts.getByLabel(`Pick ${p!.rowId}`).check()
  await pay(page, posts.getByRole('button', { name: /^Generate 1 post/ }), posts)
  await expect.poll(async () => (await planPosts()).some(x => x.id === p!.id && x.have >= x.need), { timeout: 120_000, intervals: [2000] }).toBe(true)
  await expect(row).toContainText(`${p!.need} of ${p!.need}`, { timeout: 30_000 })
  await snap(page, info, 'filled after a run the jobs list never showed running')
})

test('Write 10 with Claude on a SideStep post, to THE STANDARD: a moment, a code, effects, pain, an alt hook and a score each; the reviewer\'s stop test and ladder hide the rest; language notes; Swap with the alt hook', async ({ page }, info) => {
  test.setTimeout(300_000)
  const p = (await planPosts()).find(x => x.account === 'F2')
  expect(p, 'import the plan first (the test above)').toBeTruthy()
  // A fresh F2 topic post, so the plan's own words stay as they are.
  const characters = (await api<{ characters: { id: string; name: string }[] }>('GET', '/characters')).characters
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId: characters.find(c => c.name === 'Callie')!.id, accountTag: 'F2', idea: 'rejection emails', spec: { mode: 'topic' }, productId: await sideStepId() })
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
  // THE STANDARD's three: a label to open, stacked quotes, over 22 words.
  await hook.fill("Exhibit 1: recruiter said 'talk Friday' and then 'end of week' and then nothing at all for weeks and weeks while rent came due twice")
  await expect(notes).toContainText(/Opens with "Exhibit"/)
  await expect(notes).toContainText(/2 quoted phrases/)
  await expect(notes).toContainText(/\d+ words\. Slide 1 reads in one go/)
  // THE STANDARD v1.2: a hook with no job word.
  await hook.fill('set a 6am alarm to apply in the first hour. 100+ people already beat me')
  await expect(notes).toContainText(/No job word/)

  // Swap with the alt hook (free).
  await hook.fill('applied for the job at 11:52pm. rejected at 2:14am.')
  await page.getByLabel('Alt hook').fill('job rejection at 2:14am. who is up doing this')
  await expect(notes).toHaveCount(0)
  await page.getByRole('button', { name: /Swap with the alt hook/ }).click()
  await expect(hook).toHaveValue('job rejection at 2:14am. who is up doing this')
  await expect(page.getByLabel('Alt hook')).toHaveValue('applied for the job at 11:52pm. rejected at 2:14am.')
  await expect.poll(async () => (await api<{ item: { spec: { hook: string; plan: { altHook: string } } } }>('GET', `/content/${id}`)).item.spec.plan.altHook, { timeout: 15_000 }).toBe('applied for the job at 11:52pm. rejected at 2:14am.')
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
  await page.locator('[data-field="slide-card-1"] select[aria-label$="picture"]').selectOption('lock_screen')
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
  // An earlier run may have exported this post: wait for this export's own zip.
  const read = async () => (await api<{ item: { status: string; outputs: { zipAssetId?: string } | null } }>('GET', `/content/${id}`)).item
  const before = (await read()).outputs?.zipAssetId ?? null
  await exp.click()
  await expect.poll(async () => { const x = await read(); return x.status === 'ready' && !!x.outputs?.zipAssetId && x.outputs.zipAssetId !== before }, { timeout: 120_000, intervals: [2000] }).toBe(true)
  await expect(page.locator('[data-field="slideshow-outputs"]')).toBeVisible({ timeout: 30_000 })
  const item = (await read()) as { outputs: { zipAssetId: string } }
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
