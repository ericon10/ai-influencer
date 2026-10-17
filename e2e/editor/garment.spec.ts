import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { allPosts, api, snap } from './helpers'

// Name the garment (owner, 2026-10-16; UX-PLAN section 26): an outfit the
// clip reader wrote with no garment type warns on the Recreate stills
// price, and Read the outfit again fixes it (the mock reader here, free).
// Never on the owner's own words. Driven like a user.

const press = (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

type CloneSpec = { assetId?: string | null; outfit: { choice: string; text: string; lookId: string | null }; typed: { outfit: boolean; keep: string[] } }
type Item = { id: string; characterId: string | null; spec?: { clone?: CloneSpec | null } }

async function recreatePost(): Promise<Item> {
  const items = await allPosts<Item>()
  // The oldest one: the editor tests copy posts, and a copy is not set up the same way.
  const p = [...items].reverse().find(i => i.spec?.clone?.assetId && i.characterId)
  if (!p) throw new Error('No post with a Recreate source. Start one from a real clip in demo mode first.')
  return p
}

async function openRecreate(page: Page, post: string) {
  // Serve the post without a chosen clip, so the Video step opens on the
  // Recreate panel (nothing is saved).
  await page.route(/\/api\/v1\/content(\/[^/?]+)?(\?.*)?$/, async r => {
    if (r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch().catch(() => null)
    if (!res) return r.abort().catch(() => undefined)
    const body = await res.json().catch(() => null) as { items?: Item[]; item?: Item } | null
    for (const i of [...(body?.items ?? []), ...(body?.item ? [body.item] : [])]) if (i.id === post && i.spec) i.spec = { ...i.spec, clipId: null } as Item['spec']
    await r.fulfill({ response: res, json: body })
  })
  await page.goto(`/studio/posts/${post}`)
  const vstep = page.locator('[data-field="step-video"]')
  await vstep.waitFor()
  await expect(async () => {
    if (await vstep.locator('.st-clone').count()) return
    const open = vstep.getByRole('button', { name: 'Change', exact: true })
    if (await open.count()) await open.click()
    const real = vstep.getByRole('button', { name: /Start from a real clip/ })
    if (await real.count()) await real.first().click()
    await expect(vstep.locator('.st-clone')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20_000 })
}

async function garment(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(180_000)
  const post = await recreatePost()
  const original = post.spec!.clone!
  // The clip reader answered "black top" (the owner did not type it).
  await api('PATCH', `/content/${post.id}`, { spec: { clone: { ...original, outfit: { choice: 'source', text: 'black top', lookId: null }, typed: { ...original.typed, outfit: false } } } })
  try {
    await openRecreate(page, post.id)
    const warn = page.locator('[data-field="outfit-garment"]')
    await expect(warn).toContainText('No garment type in "black top": name the garment: tank top, t-shirt...', { timeout: 30_000 })
    // A warning, never a block: the stills price is still there to press.
    const stills = page.getByRole('button', { name: /Make \d+ (new )?stills/ }).first()
    await expect(stills).toBeEnabled({ timeout: 20_000 })
    await warn.scrollIntoViewIfNeeded()
    await snap(page, info, phone ? 'phone: name the garment' : 'name the garment')
    // The one-tap fix, priced on its own button.
    const fix = warn.getByRole('button', { name: /Read the outfit again/ })
    await expect(fix).toBeEnabled({ timeout: 20_000 })
    await expect(fix).toContainText(/\$|Free|credits/)
    await press(fix, phone)
    const box = page.getByRole('textbox', { name: 'The outfit' })
    await expect(box).toHaveValue('black ribbed tank top with thin straps, going-out look', { timeout: 60_000 })
    await expect(warn).toHaveCount(0, { timeout: 30_000 })
    await snap(page, info, phone ? 'phone: the outfit read again' : 'the outfit read again')
    // Typed by the owner: theirs, as written, with no warning.
    await box.scrollIntoViewIfNeeded()
    await press(box, phone)
    await box.fill('black top')
    const saved = page.waitForResponse(r => r.url().includes(`/content/${post.id}/clone`) && r.request().method() !== 'GET', { timeout: 10_000 }).catch(() => undefined)
    await box.blur()
    await saved
    await expect.poll(async () => (await api<{ item: Item }>('GET', `/content/${post.id}`)).item.spec?.clone?.typed.outfit, { timeout: 10_000 }).toBe(true)
    await expect(stills).toBeEnabled({ timeout: 20_000 })
    await expect(page.locator('[data-field="outfit-garment"]')).toHaveCount(0)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await api('PATCH', `/content/${post.id}`, { spec: { clone: original } })
  }
}

test.describe.configure({ mode: 'serial' })

test('an outfit the clip reader wrote with no garment type warns on the price; Read the outfit again fixes it; typed words never warn', async ({ page }, info) => { await garment(page, info, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: name the garment, and the one-tap fix', async ({ page }, info) => { await garment(page, info, true) })
})
