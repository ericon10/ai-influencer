import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { unzipSync } from 'fflate'
import { API, api, snap } from './helpers'

// The slideshow power-up (UX-PLAN.md section 27), like a user, in demo
// mode: hooks from the vault, Use this hook (its price on the button), the
// locked scene and Generate the set, Reroll one slide, a special slide, a
// text style and dragged words, the CTA with a typed handle, #ad, Export
// (both sizes and post.json), Make variations, and a batch with its review.

const press = (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

async function characterId(): Promise<string> {
  const { characters } = await api<{ characters: { id: string; progress: { approved: number } }[] }>('GET', '/characters')
  return (characters.find(c => c.progress.approved > 0) ?? characters[0]!).id
}

// A price button: its price shows before it can be pressed; above the
// confirm threshold it asks once more.
async function pay(page: Page, button: Locator, phone: boolean, scope?: Locator) {
  await expect(button).toContainText(/\$\d|credits|Free/, { timeout: 30_000 })
  await press(button, phone)
  const confirm = (scope ?? page.locator('body')).getByRole('button', { name: /^Confirm / })
  if (await confirm.first().isVisible({ timeout: 1500 }).catch(() => false)) await press(confirm.first(), phone)
}

async function waitPictures(page: Page) {
  const cards = page.locator('[data-field="slide-cards"] .st-slidecard')
  await expect(cards.first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-field="slide-cards"] .st-slideframe-empty')).toHaveCount(0, { timeout: 120_000 })
}

async function flow(page: Page, phone: boolean, info: TestInfo) {
  test.setTimeout(420_000)
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId: await characterId(), accountTag: 'e2e.slides', idea: 'job hunting after college' })
  await page.goto(`/studio/posts/${id}`)
  await expect(page.locator('[data-field="slideshow-hook"]')).toBeVisible({ timeout: 30_000 })

  // The post's product (section 29): a new post has none, so no vault. Pick SideStep.
  const product = page.locator('[data-field="post-product"]')
  await expect(product.getByRole('radio', { name: 'No product' })).toHaveAttribute('aria-checked', 'true')
  await press(product.getByRole('radio', { name: 'SideStep' }), phone)
  await expect(product.getByRole('radio', { name: /SideStep/ })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })

  // Idea: 10 from the vault (free), each tagged by pattern.
  await press(page.getByRole('button', { name: /10 from the vault/ }), phone)
  const rows = page.locator('[data-field="hook-ideas"] .st-hookrow')
  await expect(rows).toHaveCount(10, { timeout: 30_000 })
  await expect(rows.first().locator('.tag')).toContainText(/vault/)
  await snap(page, info, `${phone ? 'phone: ' : ''}hooks from the vault`)
  // Use this hook: priced, drafts every slide.
  await pay(page, rows.first().getByRole('button', { name: /Use this hook/ }), phone)
  await expect(page.locator('[data-field="slide-cards"] .st-slidecard')).toHaveCount(6, { timeout: 60_000 })

  // Stills: the locked scene filled by the draft, Generate the set.
  await expect(page.locator('[data-field="slideshow-scene"] input').first()).not.toHaveValue('', { timeout: 20_000 })
  await pay(page, page.getByRole('button', { name: /Generate the set/ }), phone, page.locator('[data-field="slideshow-generate"]'))
  await waitPictures(page)
  await snap(page, info, `${phone ? 'phone: ' : ''}the set in one camera roll`)
  const before = (await api<{ item: { spec: { stillIds: string[] } } }>('GET', `/content/${id}`)).item.spec.stillIds
  // Reroll slide 2 only.
  const card2 = page.locator('[data-field="slide-card-1"]')
  await pay(page, card2.getByRole('button', { name: /Reroll/ }), phone)
  await expect.poll(async () => (await api<{ item: { spec: { stillIds: string[] } } }>('GET', `/content/${id}`)).item.spec.stillIds[1], { timeout: 60_000 }).not.toBe(before[1])
  const after = (await api<{ item: { spec: { stillIds: string[] } } }>('GET', `/content/${id}`)).item.spec.stillIds
  expect(after.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1))
  // Slide 4 becomes a text thread (free).
  await page.locator('[data-field="slide-card-3"] select').selectOption('text_thread')

  // Slides: Note style, drag slide 1's words, the CTA with a handle, #ad.
  await press(page.locator('.st-step', { hasText: 'Slides' }), phone)
  await press(page.getByRole('radio', { name: /^Note/ }), phone)
  const frame = page.locator('[data-field="slide-preview"] .st-slideframe')
  await frame.scrollIntoViewIfNeeded()
  if (!phone) {
    const b = (await frame.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.6, { steps: 6 })
    await page.mouse.up()
  } else {
    await frame.focus()
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown')
  }
  await expect.poll(async () => (await api<{ item: { spec: { textPos: Array<{ y: number } | null> } } }>('GET', `/content/${id}`)).item.spec.textPos[0]?.y ?? 0, { timeout: 15_000 }).toBeGreaterThan(0.4)
  await page.locator('[data-field="slideshow-cta"] select').selectOption('handle')
  await page.getByLabel('Handle').fill('e2e.slides')
  await press(page.locator('[data-field="slideshow-ad"] [role="switch"]'), phone)
  await expect(page.locator('[data-field="slideshow-caption"] pre')).toContainText(/^Ad: /, { timeout: 15_000 })
  await snap(page, info, `${phone ? 'phone: ' : ''}text style, dragged words, CTA and #ad`)
  // The draft ends on its payoff, so the CTA slide is added after it
  // (UX-PLAN.md section 28, Jenga drafts) and needs its picture.
  const slides = async () => 1 + (await api<{ item: { spec: { slides: string[] } } }>('GET', `/content/${id}`)).item.spec.slides.length
  await expect.poll(slides, { timeout: 15_000 }).toBe(7)
  await press(page.locator('.st-step', { hasText: 'Stills' }), phone)
  await pay(page, page.getByRole('button', { name: /Generate the set/ }), phone, page.locator('[data-field="slideshow-generate"]'))
  await waitPictures(page)

  // Finish: Export (free), both sizes and post.json.
  await press(page.locator('.st-step', { hasText: 'Finish' }), phone)
  const exp = page.getByRole('button', { name: /^Export images/ })
  await expect(exp).toBeEnabled({ timeout: 30_000 })
  await press(exp, phone)
  await expect(page.locator('[data-field="slideshow-outputs"]')).toBeVisible({ timeout: 120_000 })
  const item = (await api<{ item: { outputs: { zipAssetId: string; imageAssetIds: string[]; instagramAssetIds: string[] } } }>('GET', `/content/${id}`)).item
  // TikTok only (THE STANDARD v1.2): the Instagram set is an option, off.
  expect(item.outputs.imageAssetIds).toHaveLength(7)
  expect(item.outputs.instagramAssetIds ?? []).toHaveLength(0)
  await expect(page.locator('[data-field="slideshow-instagram"] [role="switch"]')).toHaveAttribute('aria-checked', 'false')
  const zip = unzipSync(new Uint8Array(await (await fetch(`${API}/assets/${item.outputs.zipAssetId}/content`)).arrayBuffer()))
  const json = JSON.parse(Buffer.from(zip['post.json']!).toString())
  expect(json.slideshow).toMatchObject({ text_style: 'note', cta: { text: 'Follow @e2e.slides for more' } })
  expect(json.slides[3].special.type).toBe('text_thread')
  expect(Buffer.from(zip['caption.txt']!).toString().startsWith('Ad: ')).toBe(true)
  await snap(page, info, `${phone ? 'phone: ' : ''}exported, both sizes`)
  return id
}

test('a slideshow from a hook: vault hooks, the drafted slides, one camera roll, reroll, a special slide, text style and drag, CTA, #ad, export', async ({ page }, info) => {
  const id = await flow(page, false, info)
  // Make variations: a family, each with new words and pictures.
  const card = page.locator('[data-field="slideshow-variations"]')
  await card.locator('select').selectOption('2')
  await pay(page, card.getByRole('button', { name: /Make 2 variations/ }), false, card)
  await expect(page.locator('[data-field="slideshow-family"] a')).toHaveCount(2, { timeout: 120_000 })
  const fam = await api<{ items: { id: string; isThis: boolean; variationOf: string | null }[] }>('GET', `/content/${id}/slideshow/family`)
  expect(fam.items.filter(x => !x.isThis).every(x => x.variationOf === id)).toBe(true)
  await snap(page, info, 'variations in a family')
})

test('Batch from hooks: paste, Make 3 (one price), review with Approve and Reject', async ({ page }, info) => {
  test.setTimeout(420_000)
  const { id } = await api<{ id: string }>('POST', '/content', { kind: 'slideshow', characterId: await characterId(), accountTag: 'e2e.slides', idea: 'job hunting' })
  await page.goto(`/studio/posts/${id}`)
  await page.getByRole('button', { name: /Batch from hooks/ }).click()
  await page.locator('[data-field="slideshow-batch"] textarea').fill('Things nobody tells you about your first job\nRed flags in a job posting I ignored\nPOV: the recruiter finally calls back')
  const card = page.locator('[data-field="slideshow-batch"]')
  await pay(page, card.getByRole('button', { name: /Make 3 slideshows/ }), false, card)
  await expect(page.locator('[data-field="batch-row-2"]')).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('[data-field="batch-review"]')).not.toContainText(/\d+ stills? coming/, { timeout: 180_000 })
  await expect(card).toContainText(/Batch still: \d+ of \d+ done \(\d+ not needed\)/)
  await page.locator('[data-field="batch-row-0"]').getByRole('button', { name: /^Approve/ }).click()
  await page.locator('[data-field="batch-row-2"]').getByRole('button', { name: /Reject/ }).click()
  await expect(page.locator('[data-field="batch-row-0"]')).toContainText('Approved, exported', { timeout: 120_000 })
  await expect(page.locator('[data-field="batch-row-2"]')).toContainText('Rejected')
  await snap(page, info, 'the batch review')
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: a slideshow from a hook, nudged with the arrow keys, exported', async ({ page }, info) => {
    await flow(page, true, info)
    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392)
  })
})
