import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { api, snap } from './helpers'

// Character files from the Claude project (long run part 3, owner
// 2026-10-15): "Import a character file" first, the free check against
// character template v1.6, the update that keeps posts, the Brand card on
// the character page, and Punch it up's brand check. Driven like a user.

const ROOT = process.cwd()
const CALLIE = join(ROOT, 'fixtures', 'callie', 'character-callie.md')
const WREN = join(ROOT, 'fixtures', 'template', 'character-wren.md')
const press = async (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

type Chars = { characters: { id: string; name: string }[] }
const byName = async (name: string) => (await api<Chars>('GET', '/characters')).characters.find(c => c.name === name)

// Twelve sheet images named like the owner's folder ("REF 00" to "REF 11").
async function wrenSheet(): Promise<string[]> {
  const dir = join(ROOT, 'e2e', '.out', 'wren-sheet')
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  for (let i = 0; i <= 11; i++) {
    const f = join(dir, `REF ${String(i).padStart(2, '0')}.png`)
    writeFileSync(f, await sharp({ create: { width: 384, height: 512, channels: 3, background: { r: 120 + i * 5, g: 110, b: 100 } } }).png().toBuffer())
    files.push(f)
  }
  return files
}

async function openImport(page: Page, phone: boolean) {
  await page.goto('/studio/characters')
  // Import a character file is the first choice in the header.
  const first = page.locator('.st-pagehead .st-btn').first()
  await expect(first).toHaveText('Import a character file')
  await expect(page.locator('.st-pagehead .st-btn').nth(1)).toHaveText('Start from a concept')
  await press(first, phone)
  await expect(page.getByText('Import a character file', { exact: true }).last()).toBeVisible()
}

const dialogFile = (page: Page) => page.locator('.st-modal input[type="file"][accept=".md,image/*"]')

async function callieCheck(page: Page, info: TestInfo, phone: boolean) {
  await openImport(page, phone)
  await dialogFile(page).setInputFiles(CALLIE)
  const check = page.locator('[data-field="template-check"]')
  await expect(check).toBeVisible({ timeout: 20_000 })
  await expect(check.locator('[data-field="template-summary"]')).toHaveText('Everything the template needs')
  for (const id of ['realism', 'models', 'scene-rules', 'video-rules', 'recipe-candid', 'recipe-recreate', 'age', 'mark', 'refs', 'element']) await expect(check.locator(`[data-item="${id}"]`)).toHaveClass(/ok/)
  await expect(check.locator('[data-field="template-optional"]')).toContainText('Brand, Why people watch')
  // Callie is already here: the import updates her by default.
  const update = page.getByRole('radio', { name: /Update Callie/ })
  await expect(update).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Update Callie', exact: true })).toBeEnabled()
  await snap(page, info, phone ? 'phone: Callie\'s file checked against the template' : 'Callie\'s file checked against the template')
  await press(page.getByRole('button', { name: 'Cancel' }), phone)
}

async function wrenImport(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(180_000)
  // Start clean: a Wren left from an earlier run is archived.
  const old = await byName('Wren')
  if (old) await api('DELETE', `/characters/${old.id}`)
  const sheet = await wrenSheet()

  // A new character from a v1.6 file and its folder.
  await openImport(page, phone)
  await dialogFile(page).setInputFiles([WREN, ...sheet])
  await expect(page.locator('[data-field="template-summary"]')).toHaveText('Everything the template needs', { timeout: 20_000 })
  await expect(page.locator('[data-field="template-optional"]')).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /Update Wren/ })).toHaveCount(0)
  await press(page.getByRole('button', { name: 'Import character', exact: true }), phone)
  await expect(page.getByText('Here is what the Studio read')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.st-modal')).toContainText('12 approved sheet shots')
  const wren = (await byName('Wren'))!
  const post = (await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: wren.id, idea: 'Wren at the trailhead' })).id
  await press(page.getByRole('button', { name: 'Open character' }), phone)
  await page.waitForURL(new RegExp(`/studio/characters/${wren.id}`))

  // The same file again: Update Wren is the default, and the post stays.
  await openImport(page, phone)
  await dialogFile(page).setInputFiles([WREN, ...sheet])
  await expect(page.getByRole('radio', { name: /Update Wren/ })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
  await press(page.getByRole('button', { name: 'Update Wren', exact: true }), phone)
  await expect(page.locator('.st-modal')).toContainText('posts, takes and the sheet stayed', { timeout: 60_000 })
  await expect(page.locator('.st-modal')).toContainText('Already in the sheet, unchanged: all 12.')
  await snap(page, info, phone ? 'phone: Wren updated, nothing lost' : 'Wren updated, nothing lost')
  expect((await byName('Wren'))!.id).toBe(wren.id)
  const items = (await api<{ items: { id: string }[] }>('GET', '/content')).items
  expect(items.some(i => i.id === post)).toBe(true)
  await api('DELETE', `/content/${post}`)
}

async function brandCard(page: Page, info: TestInfo, phone: boolean) {
  const wren = await byName('Wren')
  test.skip(!wren, 'The import test makes Wren first.')
  await page.goto(`/studio/characters/${wren!.id}?tab=file`)
  const card = page.locator('[data-field="brand-card"]')
  await expect(card).toBeVisible({ timeout: 20_000 })
  const statement = card.locator('[data-field="brand-statement"] input')
  await expect(statement).toHaveValue(/slow trail runner/)
  await expect(card.locator('[data-field="brand-winningStack"] textarea')).toHaveValue('The mishap in the first second\nOut-of-breath voiceover\nGolden-hour trail')
  const line = `Wren, the slow trail runner on a budget (${phone ? 'phone' : 'desktop'})`
  await press(statement, phone)
  await statement.fill(line)
  const saved = page.waitForResponse(r => r.url().includes(`/characters/${wren!.id}/brand`) && r.request().method() === 'PUT')
  await press(card.locator('[data-field="brand-arc"] input'), phone)
  await saved
  // A growth log entry, newest first.
  const entry = card.getByRole('textbox', { name: 'This month\'s entry' })
  await press(entry, phone)
  await entry.fill('top 5 shared the fall colors; testing Trail ratings')
  await press(card.getByRole('button', { name: /Add this month's entry/ }), phone)
  await expect(card.locator('.st-growth').first()).toContainText('top 5 shared the fall colors')
  // The template check of the character's own file.
  await expect(page.locator('[data-field="template-summary"]')).toHaveText('Everything the template needs')
  await page.reload()
  await expect(page.locator('[data-field="brand-statement"] input')).toHaveValue(line)
  await card.scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: the Brand card' : 'the Brand card')
  // Written into the file itself.
  const md = await (await fetch(`${process.env.E2E_API ?? 'http://localhost:8787/api/v1'}/characters/${wren!.id}/export`, { headers: { 'x-studio-request': '1' } })).text()
  expect(md).toContain(`- Brand statement: ${line}`)
}

async function offBrand(page: Page, info: TestInfo, phone: boolean) {
  const wren = await byName('Wren')
  test.skip(!wren, 'The import test makes Wren first.')
  const post = (await api<{ id: string }>('POST', '/content', { kind: 'meme', characterId: wren!.id, idea: 'Wren at a trail race' })).id
  // The mock writer says every moment fits; one is served as off brand.
  await page.route('**/api/v1/jobs/*', async r => {
    if (r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch().catch(() => null)
    if (!res) return r.abort().catch(() => undefined)
    const body = await res.json() as { result?: { options?: Array<Record<string, unknown>> } }
    const o = body.result?.options
    if (o?.[1]) { o[1].fits_brand = false; o[1].brand_note = 'a dressed-up night out is not a trail story' }
    await r.fulfill({ response: res, json: body })
  })
  await page.goto(`/studio/posts/${post}`)
  await press(page.getByRole('button', { name: /Punch it up/ }), phone)
  const note = page.locator('[data-field="off-brand"]')
  await expect(note).toHaveCount(1, { timeout: 30_000 })
  await expect(note).toHaveText('Off brand: a dressed-up night out is not a trail story. You can still use it.')
  await note.scrollIntoViewIfNeeded()
  await snap(page, info, phone ? 'phone: an off-brand moment from Punch it up' : 'an off-brand moment from Punch it up')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await api('DELETE', `/content/${post}`)
}

test.describe.configure({ mode: 'serial' })

test('Import a character file comes first; Callie\'s current file is checked against the template and updates her by default', async ({ page }, info) => { await callieCheck(page, info, false) })
test('a v1.6 file and its 12 REF images make a new character; the same file again updates it and keeps its post', async ({ page }, info) => { await wrenImport(page, info, false) })
test('the Brand card edits the brand layer in place and writes it into the file', async ({ page }, info) => { await brandCard(page, info, false) })
test('Punch it up marks a moment that does not fit the brand statement', async ({ page }, info) => { await offBrand(page, info, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: Callie\'s file checked against the template', async ({ page }, info) => { await callieCheck(page, info, true) })
  test('phone: a new character from its file, then an update that keeps the post', async ({ page }, info) => { await wrenImport(page, info, true) })
  test('phone: the Brand card', async ({ page }, info) => { await brandCard(page, info, true) })
  test('phone: an off-brand moment from Punch it up', async ({ page }, info) => { await offBrand(page, info, true) })
})
