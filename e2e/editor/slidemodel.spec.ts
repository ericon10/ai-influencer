import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test, type Locator } from '@playwright/test'
import { API, api, snap } from './helpers'

// The slide image model (UX-PLAN.md section 30), like a user, in demo mode:
// the Stills step's path chips (Your Higgsfield plan or the Higgsfield
// API), the line that says which model the character's slides and the
// slides with no one get, each slide card's "who is in it", and the model
// and price on Generate the set and on the Launch plan card's Generate N
// posts. Every record is made here through the API; nothing paid runs.

const ROOT = process.cwd()
const NAME = 'Juno'

// A character from a template v1.6 file ("Scene stills: GPT Image 2.5
// Flare by default"), with a sheet of 12 plain images.
async function juno(): Promise<string> {
  const have = (await api<{ characters: { id: string; name: string }[] }>('GET', '/characters')).characters.find(c => c.name === NAME)
  if (have) return have.id
  const md = readFileSync(join(ROOT, 'fixtures', 'template', 'character-wren.md'), 'utf8').replace(/\bWren\b/g, NAME)
  const form = new FormData()
  form.append('file', new Blob([md], { type: 'text/markdown' }), 'character-juno.md')
  for (let i = 0; i <= 11; i++) {
    const png = await sharp({ create: { width: 384, height: 512, channels: 3, background: { r: 120 + i * 5, g: 110, b: 100 } } }).png().toBuffer()
    form.append('images', new Blob([new Uint8Array(png)], { type: 'image/png' }), `REF-${String(i).padStart(2, '0')}.png`)
  }
  const r = await fetch(`${API}/characters/import`, { method: 'POST', headers: { 'x-studio-request': '1' }, body: form })
  if (!r.ok) throw new Error(`import ${r.status} ${await r.text()}`)
  return (await r.json() as { characterId: string }).characterId
}

const priced = async (button: Locator) => expect(button).toContainText(/\$\d|credits?/, { timeout: 30_000 })

test('the Stills step: the path chips, the model each slide gets, who is in each slide, model and price on Generate the set', async ({ page }, info) => {
  test.setTimeout(240_000)
  const characterId = await juno()
  const { id } = await api<{ id: string }>('POST', '/content', {
    kind: 'slideshow', characterId, accountTag: 'e2e.slidemodel', idea: 'a cafe morning', step: 'stills',
    spec: { mode: 'character', hook: 'It was 6am and the inbox had one new email', slides: ['so i opened it', 'reader, it was a no'], shots: ['typing at the cafe table', 'a latte beside the laptop, screen not legible', 'laughing at the lens'], lock: { place: 'a cafe corner table by the window' } },
  })
  await page.goto(`/studio/posts/${id}`)
  const generate = page.locator('[data-field="slideshow-generate"]')
  await expect(generate).toBeVisible({ timeout: 30_000 })

  // The path is the pick; the plan is picked in demo mode.
  const paths = generate.locator('[data-field="still-paths"]')
  await expect(paths.getByRole('radio', { name: /Your Higgsfield plan/ })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
  const line = paths.locator('[data-field="still-models"]')
  await expect(line).toContainText(`${NAME}'s slides: GPT Image 2.5 Flare (${NAME}'s file), 1 credit a still`)
  await expect(line).toContainText('Slides with no one: GPT Image 2.5 Flare (the cheapest on this path), 1 credit a still')

  // Who is in each slide, read from its shot; the latte is no one.
  await expect(page.locator('[data-field="slide-who-0"]')).toHaveValue('character')
  await expect(page.locator('[data-field="slide-who-1"]')).toHaveValue('none')
  await expect(page.locator('[data-field="slide-who-2"]')).toHaveValue('character')

  // Model and price on the button (demo mode names the model the mock stands in for).
  const button = generate.getByRole('button', { name: /Generate the set/ })
  await priced(button)
  await expect(generate.locator('.st-model-tag').first()).toHaveText('GPT Image 2.5 Flare (demo mock, free)')
  await generate.scrollIntoViewIfNeeded()
  await snap(page, info, 'stills on the plan: the model line and Generate the set with its model and price')

  // The Higgsfield API: dollars a still, the same models here.
  await paths.getByRole('radio', { name: /Higgsfield API/ }).click()
  await expect(paths.getByRole('radio', { name: /Higgsfield API/ })).toHaveAttribute('aria-checked', 'true')
  await expect(line).toContainText(`${NAME}'s slides: GPT Image 2.5 Flare (${NAME}'s file), $0.06 a still`)
  await priced(button)

  // The owner switches a slide: the latte gets Juno in it.
  await page.locator('[data-field="slide-who-1"]').selectOption('character')
  await expect.poll(async () => (await api<{ item: { spec: { people: string[] } } }>('GET', `/content/${id}`)).item.spec.people?.[1], { timeout: 15_000 }).toBe('character')
  await expect(line).not.toContainText('Slides with no one')
})

test('the Launch plan card: path chips and Generate N posts with its model and price', async ({ page }, info) => {
  test.setTimeout(240_000)
  const characterId = await juno()
  // One feeder row from the plan, under its own row id and account.
  const lines = readFileSync(join(ROOT, 'docs', 'content', 'launch-plan-v2-posts.csv'), 'utf8').split('\n')
  const row = lines.find(l => l.startsWith('P001,'))!.replace(/^P001,/, 'SM001,').replace(',F2,', ',SMF2,')
  const csv = `${lines[0]}\n${row}\n`
  await api('POST', '/plan/import', { csv, store: { SMF2: characterId }, productId: null, rows: ['SM001'] })

  await page.goto('/studio')
  const card = page.locator('[data-field="launch-plan"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const head = card.getByRole('button', { name: /Launch plan/ })
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  const posts = card.locator('[data-field="plan-posts"]')
  await posts.getByLabel('Account').selectOption('SMF2')
  const pick = posts.getByLabel('Pick SM001')
  await expect(pick).toBeVisible({ timeout: 30_000 })
  if (await pick.isEnabled()) await pick.check()
  else test.skip(true, 'SM001 already has its pictures from an earlier run')

  const chips = posts.locator('[data-field="plan-generate-path"]')
  await expect(chips.getByRole('radio', { name: /Your Higgsfield plan/ })).toBeVisible()
  await expect(chips.locator('[data-field="still-models"]')).toContainText('Slides with no one: GPT Image 2.5 Flare (the cheapest on this path)')
  const go = posts.getByRole('button', { name: /^Generate 1 post/ })
  await priced(go)
  await expect(posts.locator('.st-model-tag').first()).toHaveText('GPT Image 2.5 Flare (demo mock, free)')
  await posts.scrollIntoViewIfNeeded()
  await snap(page, info, 'the launch plan: Generate 1 post with its model and price')
})
