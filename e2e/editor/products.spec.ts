import { expect, test } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// Products (owner, 2026-10-17; UX-PLAN.md section 29), like a user, in demo
// mode: a Callie video post with No product gets no SideStep notes (the
// dash check only); the same post picked as SideStep gets them; Posts home
// filters by product; an account's product is the default of its new
// posts; a product's writing rules on its card.

const products = async () => (await api<{ products: { id: string; name: string }[] }>('GET', '/products')).products
// The seeded Callie; SideStep is the owner's starter kit (the seed checks it is there).
const callieId = async () => seedData().callie

test('a video post with No product gets the dash check only; picked as SideStep, its notes come back', async ({ page }, info) => {
  test.setTimeout(120_000)
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: await callieId(), accountTag: 'callie.tiktok', productId: null, step: 'text', spec: { caption: 'Do boys even know what it\'s like to be a girl?' } })
  await page.goto(`/studio/posts/${id}`)
  const caption = page.getByLabel('Caption', { exact: true })
  await expect(caption).toHaveValue('Do boys even know what it\'s like to be a girl?', { timeout: 30_000 })
  // No product: no "No job word", nothing of SideStep.
  await expect(page.locator('[data-field="hook-lint"]')).toHaveCount(0)
  await snap(page, info, 'no product: no SideStep notes under the caption')
  // The long dash check runs on every post.
  await caption.fill(`Do boys even know ${String.fromCharCode(0x2014)} what it's like`)
  await expect(page.locator('[data-field="hook-lint"]')).toContainText(/long dash/)
  await expect(page.locator('[data-field="hook-lint"]')).not.toContainText(/job/)

  // The Idea step: the Product row. Pick SideStep and its notes come back.
  await page.locator('.st-step', { hasText: 'Idea' }).click()
  const row = page.locator('[data-field="post-product"]')
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.getByRole('radio', { name: 'No product' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('[data-field="post-product-rules"]')).toContainText('the general standard')
  await snap(page, info, 'the Idea step: the Product row')
  await row.getByRole('radio', { name: 'SideStep' }).click()
  await expect(row.getByRole('radio', { name: /SideStep/ })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
  await expect(page.locator('[data-field="post-product-rules"]')).toContainText('SideStep rules')
  await page.locator('.st-step', { hasText: 'Caption' }).click()
  await caption.fill('Do boys even know what it\'s like to be a girl?')
  await expect(page.locator('[data-field="hook-lint"]')).toContainText(/No job word/, { timeout: 15_000 })
  expect((await api<{ item: { productId: string | null } }>('GET', `/content/${id}`)).item.productId).toBe((await products()).find(p => p.name === 'SideStep')!.id)
})

test('Posts home filters by product; an account\'s product is the default of its new posts; a product\'s writing rules', async ({ page }, info) => {
  test.setTimeout(120_000)
  const sideStep = seedData().sideStep
  const tag = 'e2e.products'
  // The Accounts card: this account's product is SideStep.
  await api('PUT', `/social-accounts/${tag}`, { productId: null })
  const before = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: await callieId(), accountTag: tag })
  expect((await api<{ item: { productId: string | null } }>('GET', `/content/${before.id}`)).item.productId).toBeNull()
  await page.goto('/studio')
  const accounts = page.locator('[data-field="accounts"]')
  await expect(accounts).toBeVisible({ timeout: 30_000 })
  const head = accounts.getByRole('button', { name: /Accounts/ }).first()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  const select = accounts.getByLabel(`Product for ${tag}`)
  await select.selectOption(sideStep)
  await expect.poll(async () => (await api<{ accounts: { tag: string; productId: string | null }[] }>('GET', '/social-accounts')).accounts.find(a => a.tag === tag)?.productId, { timeout: 15_000 }).toBe(sideStep)
  await accounts.locator(`[data-field="account-product-${tag}"]`).scrollIntoViewIfNeeded()
  await snap(page, info, 'the Accounts card: each account\'s product')
  const after = await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: await callieId(), accountTag: tag })
  expect((await api<{ item: { productId: string | null } }>('GET', `/content/${after.id}`)).item.productId).toBe(sideStep)

  // Posts home: the Product filter.
  await page.reload()
  const filter = page.locator('[data-field="posts-product-filter"]')
  await expect(filter).toBeVisible({ timeout: 30_000 })
  await filter.getByRole('button', { name: 'No product', exact: true }).click()
  await expect(page.locator(`a.st-postcard-name[href="/studio/posts/${before.id}"]`)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(`a.st-postcard-name[href="/studio/posts/${after.id}"]`)).toHaveCount(0)
  await filter.getByRole('button', { name: 'SideStep', exact: true }).click()
  await expect(page.locator(`a.st-postcard-name[href="/studio/posts/${after.id}"]`)).toBeVisible({ timeout: 15_000 })
  await filter.scrollIntoViewIfNeeded()
  await snap(page, info, 'Posts home: the Product filter')

  // Library > Hooks: SideStep's writing rules on its card.
  await page.goto('/studio/library?tab=hooks')
  const writing = page.locator('[data-field="product-writing"]')
  await expect(writing).toBeVisible({ timeout: 30_000 })
  await expect(writing.getByLabel(/Writing rules for/)).toHaveValue(/sidestep|^$/)
  await snap(page, info, 'Library > Hooks: a product\'s writing rules')
})
