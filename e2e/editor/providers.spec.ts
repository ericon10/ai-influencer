import { expect, test, type Page } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// Kie.ai and WaveSpeed (UX-PLAN.md section 40) like a person, in demo mode
// with a fake Kie and WaveSpeed on localhost: each key saved, Test key with
// the balance; Settings > Models > Providers prices every provider of a
// model side by side with the cheapest marked, and a pick moves the model
// (then back to the default); the picker sits on a Recreate post's stills
// and motion; Make the week has Provider for this run. Nothing paid runs.

const KEYS = { kie: 'kie-test-key-1234', wavespeed: 'ws-test-key-5678' }
type Item = { id: string; characterId: string | null; spec?: Record<string, unknown> }

async function openRecreate(page: Page, post: string) {
  // Serve the post without a chosen clip, so the Video step opens on the
  // Recreate panel (nothing is saved).
  await page.route(/\/api\/v1\/content(\/[^/?]+)?(\?.*)?$/, async r => {
    if (r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch().catch(() => null)
    if (!res) return r.abort().catch(() => undefined)
    const body = await res.json().catch(() => null) as { items?: Item[]; item?: Item } | null
    for (const i of [...(body?.items ?? []), ...(body?.item ? [body.item] : [])]) if (i.id === post && i.spec) i.spec = { ...i.spec, clipId: null }
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

test.describe.configure({ mode: 'serial' })

test('keys: Kie.ai and WaveSpeed saved and verified; Test key shows each balance', async ({ page }, info) => {
  test.skip(!process.env.E2E_PROVIDERS_URL, 'The fake providers run with the hermetic suite')
  await page.goto('/studio/settings?tab=general')
  for (const [id, label, balance] of [['kie', 'Kie.ai', 'Balance: 1,234.5 credits (about $6.17).'], ['wavespeed', 'WaveSpeed', 'Balance: $7.25.']] as const) {
    const box = page.locator(`[data-field="key-${id}"]`)
    // The row shows the key field (no key yet) or Test key (a key saved).
    await page.locator(`[data-field="key-${id}"], [data-field="key-test-${id}"]`).first().waitFor({ timeout: 30_000 })
    if (await box.count()) {
      await box.locator('input').fill(KEYS[id])
      await box.locator('xpath=ancestor::div[contains(@class,"st-col")][1]').getByRole('button', { name: 'Save and verify' }).click()
      await expect(page.locator('.st-toast').filter({ hasText: `${label} key saved and verified.` })).toBeVisible({ timeout: 15_000 })
    }
    await page.locator(`[data-field="key-test-${id}"]`).click()
    await expect(page.locator(`[data-field="key-balance-${id}"]`)).toHaveText(balance, { timeout: 15_000 })
  }
  await snap(page, info, 'settings: Kie.ai and WaveSpeed keys with their balance')
})

test('Settings > Models > Providers: every provider\'s price side by side, the cheapest marked; a pick moves the model, Default goes back', async ({ page }, info) => {
  await page.goto('/studio/settings?tab=models')
  const pick = page.locator('[data-field="settings-engines"] [data-field="engines-step-still"] [data-field="provider-pick-still-nano-banana-2.1"]')
  await expect(pick).toBeVisible({ timeout: 30_000 })
  for (const p of ['higgsfield', 'google', 'kie', 'wavespeed']) await expect(pick.locator(`[data-field="provider-pick-still-nano-banana-2.1-${p}"]`)).toBeVisible()
  const kie = pick.locator('[data-field="provider-pick-still-nano-banana-2.1-kie"]')
  await expect(kie).toContainText('$0.03')
  await expect(kie).toContainText('Cheapest')
  await expect(pick.locator('[data-field="provider-pick-still-nano-banana-2.1-higgsfield"]')).toHaveAttribute('aria-pressed', 'true')
  if (await kie.isEnabled()) {
    await kie.click()
    await expect(kie).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
    const v = await api<{ rows: Array<{ provider: string; chosen: boolean }> }>('GET', '/engines/pick?step=still&model=higgsfield/nano-banana-2.1')
    expect(v.rows.find(r => r.chosen)?.provider).toBe('kie')
    await snap(page, info, 'settings: Providers, Kie.ai picked for Nano Banana 2.1 stills')
    // Back to the default (Higgsfield) for every other test.
    await pick.locator('[data-field="provider-pick-still-nano-banana-2.1-higgsfield"]').click()
    await expect(pick.locator('[data-field="provider-pick-still-nano-banana-2.1-higgsfield"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  }
  // Higgsfield's confirmed Kling 3.0 Pro is the cheapest Kling 3.0 Pro.
  const kling = page.locator('[data-field="provider-pick-video-kling-3.0-pro"]')
  await expect(kling.locator('[data-field="provider-pick-video-kling-3.0-pro-higgsfield"]')).toContainText('Cheapest')
})

test('the picker on a Recreate post\'s stills and motion; Make the week has Provider for this run', async ({ page }, info) => {
  await openRecreate(page, seedData().recreatePost)
  const stills = page.locator('[data-field="provider-pick-recreate_still-nano-banana-2.1"]')
  await expect(stills).toBeVisible({ timeout: 30_000 })
  await expect(stills.getByRole('button')).toContainText(['Higgsfield', 'Google AI Studio', 'Kie.ai', 'WaveSpeed'])
  // A pick for this character only, or for every character.
  await expect(stills.getByRole('radio', { name: 'Every character' })).toBeVisible()
  await snap(page, info, 'recreate: who runs the stills')
  await page.goto('/studio/weeks?step=make')
  await expect(page.locator('[data-field="weeks-make-provider"]')).toContainText('Provider for this run', { timeout: 30_000 })
  await expect(page.getByLabel('Provider for this run').locator('option')).toContainText(['Each post\'s own pick (Higgsfield unless you picked another)', 'Kie.ai, where it runs the post\'s model', 'WaveSpeed, where it runs the post\'s model'])
})
