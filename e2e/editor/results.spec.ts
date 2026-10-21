import { expect, test, type Page } from '@playwright/test'
import { api, snap } from './helpers'

// Results (UX-PLAN.md section 32), like a user, in demo mode: a small plan
// imported through the API (so the posts have row_ids), results typed on a
// post's card (saved as typed, the decision chip), a CSV pasted by row_id
// and post_id on the Results card (the free preview: matched posts, what
// changes, the row_id not found, the column not used; then Apply), the
// Results view's numbers with the Account filter on, and both hints.
// Every record is made here; nothing is assumed of the database.

const PLAN_COLUMNS = ['row_id', 'date', 'slot', 'account', 'format', 'moment_id', 'structure', 'hook', 'slide_2', 'slide_3', 'slide_4', 'slide_5', 'slide_6', 'scene', 'caption', 'hashtags']
const csvOf = (rows: string[][]) => [PLAN_COLUMNS.join(','), ...rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))].join('\n')

interface Item { id: string; title: string; accountTag: string; spec: { results?: { views72h: number | null; follows72h: number | null; decision: string | null } | null; plan?: { rowId: string } } }
const item = async (id: string) => (await api<{ item: Item }>('GET', `/content/${id}`)).item

async function openCard(page: Page, title: string) {
  const card = page.locator('.st-postcard', { hasText: title })
  await expect(card).toBeVisible({ timeout: 30_000 })
  return card
}

test('results: typed on a card, pasted from a CSV by row_id, the Results view and its hints', async ({ page }, info) => {
  test.setTimeout(300_000)
  const stamp = Date.now().toString(36).slice(-5).toUpperCase()
  const tag = `res-${stamp.toLowerCase()}`
  const rid = (n: number) => `R${stamp}${n}`
  // A character to file the topic posts' pictures under, and the plan.
  await api('POST', '/characters', { name: `Res ${stamp}` })
  const plan = csvOf([
    [rid(1), '2031-03-10', 'AM', tag, 'slideshow story', `M${stamp}1`, 'S3', 'the recruiter said friday. it is march', 'two', 'three', 'four', 'five', 'six', 'An office at night. Slide 1: a laptop. Slides 2 to 6: the desk lamp and a mug', 'cap one', 'jobtok'],
    [rid(2), '2031-03-10', 'PM', tag, 'slideshow story', `M${stamp}2`, 'S11', 'entry level. 5 years required. founded in 2029', 'two', 'three', 'four', 'five', 'six', 'A bus at 8am. Slide 1: a phone. Slides 2 to 6: the bus window and a seat', 'cap two', 'jobtok'],
    [rid(3), '2031-03-11', 'AM', tag, 'slideshow story', `M${stamp}3`, 'S3', 'my offer letter had a typo in my salary', 'two', 'three', 'four', 'five', 'six', 'A kitchen. Slide 1: a letter. Slides 2 to 6: the kettle and a sink', 'cap three', 'jobtok'],
  ])
  const imported = await api<{ created: number; posts: Array<{ rowId: string; id: string }> }>('POST', '/plan/import', { csv: plan, productId: null, rows: [rid(1), rid(2), rid(3)] })
  expect(imported.created).toBe(3)
  const id = (n: number) => imported.posts.find(p => p.rowId === rid(n))!.id
  // A copy of post 3 (Make another like this keeps its plan moment: one hook family).
  const copy = (await api<{ id: string }>('POST', `/content/${id(3)}/duplicate`)).id
  await api('PATCH', `/content/${copy}`, { title: `Copy of ${rid(3)}` })

  await page.goto('/studio')
  await page.locator('[data-field="posts-product-filter"]').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => undefined)
  await page.getByRole('button', { name: tag, exact: true }).click()

  // 1. Typed on the card: saved as typed, the decision as a chip.
  const one = await openCard(page, `${rid(1)}:`)
  await one.getByRole('button', { name: /^Results/ }).click()
  await one.getByLabel('Views in 72 hours').fill('12.4K')
  await one.getByLabel('Follows in 72 hours').fill('31')
  await one.getByLabel('Saves in 72 hours').fill('1,203')
  await one.getByRole('button', { name: 'Keep', exact: true }).click()
  await expect(one.locator('[data-field="results-status"]')).toHaveText(/Saved/, { timeout: 15_000 })
  await expect(one.locator('[data-field="decision-chip"]')).toHaveText('Keep')
  await expect.poll(async () => (await item(id(1))).spec.results, { timeout: 15_000 }).toMatchObject({ views72h: 12400, follows72h: 31, decision: 'keep' })
  await expect(one.getByLabel('Views in 72 hours')).toHaveAttribute('inputmode', 'numeric')
  await snap(page, info, 'results typed on a card, the Keep chip')

  // 2. The Results card: paste a CSV by row_id (and post_id for the copy).
  const card = page.locator('[data-field="results-card"]')
  const head = card.getByRole('button', { name: /^Results/ }).first()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  const csv = [
    'row_id,post_id,views_72h,follows_72h,saves_72h,shares_72h,decision,posted_at,Watch time',
    `${rid(2)},,61.2K,240,3.1K,410,Make 3 variations,3/10/2031 6:05 PM,0:09`,
    `${rid(3)},,800,2,,,,2031-03-11 09:01,`,
    `,${copy},400,1,,,drop,,`,
    `${rid(9)},,5K,3,,,,,`,
  ].join('\n')
  await card.getByLabel('Results CSV').fill(csv)
  await card.getByRole('button', { name: 'Preview (free)' }).click()
  const preview = card.locator('[data-field="results-preview"]')
  await expect(preview).toBeVisible({ timeout: 20_000 })
  await expect(preview).toContainText('Columns not used: Watch time.')
  await expect(card.locator('[data-field="results-unmatched"]')).toHaveText(`Not found: ${rid(9)}`)
  await expect(card.locator('[data-field="results-preview-totals"]')).toContainText('4 rows: 3 matched a post, 3 change something')
  await expect(preview.locator(`[data-field="results-row-${rid(2)}"]`)).toContainText('Views (72h): empty to 61200')
  await expect(preview.locator(`[data-field="results-row-${rid(2)}"]`)).toContainText('Decision: empty to Make 3 variations')
  // Nothing is written by the preview.
  expect((await item(id(2))).spec.results ?? null).toBeNull()
  await snap(page, info, 'the CSV preview: matched posts, what changes, the row_id not found')
  await card.getByRole('button', { name: /^Apply 3 changes/ }).click()
  await expect(card.locator('[data-field="results-applied"]')).toHaveText(/^3 posts updated/, { timeout: 20_000 })
  expect((await item(id(2))).spec.results).toMatchObject({ views72h: 61200, follows72h: 240, decision: 'variations' })

  // 3. The Results view, the Account filter on: 4 posts, follows per post first.
  await expect(card.locator('[data-field="results-posts"]')).toHaveText('4', { timeout: 20_000 })
  await expect(card.locator('[data-field="results-follows"]')).toHaveText('274')
  await expect(card.locator('[data-field="results-fpp"]')).toHaveText('68.5')
  await expect(card.locator('[data-field="results-views"]')).toHaveText((12400 + 61200 + 800 + 400).toLocaleString('en-US'))
  await card.getByRole('button', { name: 'Hook structure', exact: true }).click()
  const table = card.locator('[data-field="results-table"]')
  await expect(table.locator('tbody tr').first()).toContainText('S11 Contrast pair')
  await expect(table.locator('tbody tr').first()).toContainText('240')
  await expect(table).toContainText('S3 Untold Story')
  // A date range on posted_at: only post 2 went up on March 10.
  await card.getByLabel('Posted from').fill('2031-03-10')
  await card.getByLabel('Posted to').fill('2031-03-10')
  await expect(card.locator('[data-field="results-posts"]')).toHaveText('1', { timeout: 20_000 })
  await card.getByRole('button', { name: 'Any date' }).click()
  await expect(card.locator('[data-field="results-posts"]')).toHaveText('4', { timeout: 20_000 })

  // 4. The hints: never automatic, on the card and in the Results view.
  await expect(card.locator('[data-field="results-hints"]')).toContainText('50K+ views: make 3 variations')
  await expect(card.locator('[data-field="results-hints"]')).toContainText('Under 1K twice: drop the hook family')
  const two = await openCard(page, `${rid(2)}:`)
  await expect(two.locator('[data-field="result-hints"]')).toContainText('50K+ views: make 3 variations')
  await expect(two.locator('[data-field="decision-chip"]')).toHaveText('Make 3 variations')
  await expect(two.getByRole('link', { name: 'Make variations' })).toBeVisible()
  const three = await openCard(page, `${rid(3)}:`)
  await expect(three.locator('[data-field="result-hints"]')).toContainText('Under 1K twice: drop the hook family')
  await card.scrollIntoViewIfNeeded()
  await snap(page, info, 'the Results card: totals, by hook structure, the hints')

  // 5. The same fields in the post's Finish step.
  await page.goto(`/studio/posts/${id(2)}`)
  await page.getByRole('button', { name: /Finish/ }).first().click()
  const finish = page.locator('[data-field="post-results-finish"]')
  await expect(finish).toBeVisible({ timeout: 30_000 })
  await expect(finish.getByLabel('Views in 72 hours')).toHaveValue('61200')
  await finish.getByLabel('Notes').fill('the contrast pair works on this account')
  await expect(finish.locator('[data-field="results-status"]')).toHaveText(/Saved/, { timeout: 15_000 })
  await expect.poll(async () => (await api<{ item: { spec: { results: { notes: string } } } }>('GET', `/content/${id(2)}`)).item.spec.results.notes, { timeout: 15_000 }).toBe('the contrast pair works on this account')
  await snap(page, info, 'Results in the Finish step')
})
