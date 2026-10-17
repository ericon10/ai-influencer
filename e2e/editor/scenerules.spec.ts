import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// Character template v1.6 scene rules (long run part 2, owner 2026-10-15):
// makeup by setting (no makeup at home or the gym, soft everyday makeup out
// in public) and a hair styling rotated per scene from the bank, never one
// of the last 5, logged in the combo log. Driven like a user: a new video
// post, the idea typed in the box, More control opened.

const BANK = ['behind both shoulders', 'tucked behind one ear', 'blowing back off the face', 'half-up claw clip', 'low loose ponytail', 'high sleek ponytail', 'messy top bun', 'sunglasses as a headband', 'damp and air-dried', 'parted on the other side']

const press = async (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

// The seeded Callie.
const callie = async (): Promise<string> => seedData().callie

// A new video post for Callie with the idea typed in, and More control open.
async function newPost(page: Page, characterId: string, idea: string, phone: boolean): Promise<string> {
  await page.addInitScript(id => { try { localStorage.setItem('st-last-character', id) } catch { /* private */ } }, characterId)
  // Posts home, then Video post (the header button).
  await page.goto('/studio')
  await press(page.getByRole('button', { name: 'Video post', exact: true }).first(), phone)
  await page.waitForURL(/\/studio\/posts\/cnt_/)
  const id = page.url().match(/cnt_[a-z0-9]+/)![0]
  const box = page.locator('[data-field="post-idea"] textarea')
  await press(box, phone)
  await box.fill(idea)
  await box.blur()
  const more = page.getByRole('button', { name: /More control/ })
  if ((await more.getAttribute('aria-expanded')) !== 'true') await press(more, phone)
  await expect(page.locator('[data-field="scene-hair"]')).toBeVisible({ timeout: 30_000 })
  return id
}

const hairOf = (page: Page) => page.locator('[data-field="scene-hair"] input')
const makeupOn = (page: Page) => page.locator('[data-field="scene-makeup"] .st-chip.on')

async function sceneRules(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(120_000)
  const characterId = await callie()

  // At home: no makeup, and a styling from the bank.
  const home = await newPost(page, characterId, 'Callie flipping pancakes in her kitchen at home on a Sunday morning', phone)
  await expect(makeupOn(page)).toHaveText('No makeup')
  await expect(page.locator('[data-field="makeup-by-setting"]')).toHaveText(/By setting: no makeup at home, the gym, an early beach or waking up; soft everyday makeup out in public\. Your choice wins\./)
  await expect(hairOf(page)).not.toHaveValue('')
  const first = await hairOf(page).inputValue()
  expect(BANK).toContain(first)
  await expect(page.locator('[data-field="scene-hair"]')).toContainText('Rotated per scene from the styling bank, never one of the last 5.')
  await page.locator('[data-field="scene-makeup"]').scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: at home, no makeup, a rotated styling' : 'at home, no makeup, a rotated styling')

  // Out in public: soft everyday makeup, and a different styling.
  const market = await newPost(page, characterId, 'Callie picks out peaches at a busy farmers market stall', phone)
  await expect(makeupOn(page)).toHaveText('Soft everyday')
  const second = await hairOf(page).inputValue()
  expect(BANK).toContain(second)
  expect(second).not.toBe(first)
  await page.locator('[data-field="scene-makeup"]').scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: at the market, soft everyday makeup, the next styling' : 'at the market, soft everyday makeup, the next styling')

  // The owner's choice wins: a tap on Soft glam stays, and a styling named in
  // the idea is the styling.
  await press(page.locator('[data-field="scene-makeup"]').getByRole('button', { name: 'Soft glam' }), phone)
  await expect(makeupOn(page)).toHaveText('Soft glam')
  const bun = await newPost(page, characterId, 'Callie at the gym in a messy bun, refilling her water bottle between sets', phone)
  await expect(makeupOn(page)).toHaveText('No makeup')
  await expect(hairOf(page)).toHaveValue('messy bun')

  for (const id of [home, market, bun]) await api('DELETE', `/content/${id}`).catch(() => undefined)
}

// The combo log shows the styling as its fifth column (Library > Stills).
async function comboLog(page: Page, info: TestInfo, phone: boolean) {
  const characterId = await callie()
  await page.route(`**/api/v1/characters/${characterId}/scenes`, async r => {
    const res = await r.fetch()
    const body = await res.json() as { combos: Array<Record<string, string>> }
    body.combos = [...body.combos, { date: '2026-10-15', moment: 'Caught you', camera: 'Friend shot', light: 'Morning light', location: 'Farmers market', hair: 'half-up claw clip' }]
    await r.fulfill({ response: res, json: body })
  })
  await page.goto(`/studio/library?tab=stills&c=${characterId}`)
  const hair = page.locator('[data-field="combo-hair"]').first()
  await hair.scrollIntoViewIfNeeded()
  await expect(hair).toHaveText('half-up claw clip')
  await snap(page, info, phone ? 'phone: combo log with the hair styling' : 'combo log with the hair styling')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
}

test('makeup by setting and the rotated hair styling fill the scene; your choice and your words win', async ({ page }, info) => { await sceneRules(page, info, false) })
test('the combo log shows the hair styling', async ({ page }, info) => { await comboLog(page, info, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: makeup by setting and the rotated hair styling', async ({ page }, info) => { await sceneRules(page, info, true) })
  test('phone: the combo log shows the hair styling', async ({ page }, info) => { await comboLog(page, info, true) })
})
