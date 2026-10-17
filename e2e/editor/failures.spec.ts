import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { allPosts, api, snap } from './helpers'

// Earlier failures in one gray line (owner, 2026-10-15): in the Recreate
// stills grid and in the run rows, only the run just started shows its
// failures red; the earlier ones are counted in one gray line with Show and
// Clear. The lists are served by the test (nothing runs).

async function recreatePost(): Promise<{ id: string; characterId: string }> {
  const items = await allPosts<{ id: string; characterId: string | null; spec?: { clone?: { assetId?: string | null } | null } }>()
  // The oldest one: the editor tests copy posts, and a copy is not set up the same way.
  const p = [...items].reverse().find(i => i.spec?.clone?.assetId && i.characterId)
  if (!p) throw new Error('No post with a Recreate source. Start one from a real clip in demo mode first.')
  return { id: p.id, characterId: p.characterId! }
}

const gate = { ok: true, face: 0.6, likeness: 0.2, margin: 0.4, reasons: [], note: null }
function still(id: string, o: Partial<Record<string, unknown>>) {
  return { id, characterId: 'c', characterName: 'Callie', assetId: null, status: 'failed', kept: false, error: null, findings: [], createdAt: new Date().toISOString(), parentId: null, pass: 'still', faceScore: null, sourceScore: null, note: null, gate, runId: 'q2', failure: null, ...o }
}

async function openStills(page: Page, post: string) {
  // Serve the post without a chosen clip, so the Video step opens on the
  // Recreate panel and stays there (nothing is saved).
  await page.route(/\/api\/v1\/content(\/[^/?]+)?(\?.*)?$/, async r => {
    if (r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch().catch(() => null)
    if (!res) return r.abort().catch(() => undefined)
    const body = await res.json().catch(() => null) as { items?: { id: string; spec?: Record<string, unknown> }[]; item?: { id: string; spec?: Record<string, unknown> } } | null
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

// A click on a computer, a tap on a phone.
const press = (l: Locator, phone: boolean) => (phone ? l.tap() : l.click())

async function stillsGrid(page: Page, info: TestInfo, phone: boolean) {
  const { id, characterId } = await recreatePost()
  await api('PATCH', `/content/${id}`, { spec: { failuresClearedAt: null } })
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const blocked = 'The provider content filter blocked this result.'
  const stills = [
    still('ok1', { characterId, assetId: 'ast_ok', status: 'approved' }),
    still('fresh-bad', { characterId, error: blocked, failure: 'blocked', jobId: 'job_fresh', triggers: ['tight', 'boy shorts'], safer: true }),
    ...[1, 2, 3, 4].map(i => still(`old-b${i}`, { characterId, error: blocked, failure: 'blocked', runId: 'q1', createdAt: hourAgo })),
    ...[1, 2].map(i => still(`old-f${i}`, { characterId, pass: 'face', error: 'No still came out usable, so the face pass did not run.', failure: 'not_run', runId: 'q1', createdAt: hourAgo })),
  ]
  await page.route(`**/api/v1/content/${id}/clone-stills`, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stills }) }))
  await openStills(page, id)
  const line = page.locator('[data-field="failure-line"]').filter({ hasText: 'blocked by the filter' })
  await expect(line).toHaveText(/4 blocked by the filter, refunded; 2 face passes not run\. Nothing charged\./)
  // The run just started keeps its failure as a tile; the earlier six are folded.
  const grid = page.locator('.st-grid.scenes').first()
  await expect(grid.locator('.st-tile')).toHaveCount(2)
  // A refusal names the likely trigger words and offers the safer retry.
  const bad = grid.locator('.st-tile').filter({ hasText: 'Likely trigger words' })
  await expect(bad.locator('[data-field="trigger-words"]')).toHaveText(/^Likely trigger words: tight, boy shorts\./)
  await expect(bad.getByRole('button', { name: /Retry with safer wording/ })).toBeVisible()
  await snap(page, info, 'one gray line')
  await press(line.getByRole('button', { name: 'Show' }), phone)
  await expect(page.locator('[data-field="earlier-failures"] .st-tile')).toHaveCount(6)
  await snap(page, info, 'shown')
  await press(line.getByRole('button', { name: 'Clear' }), phone)
  await expect(line).toHaveCount(0)
  // Cleared for good on this post: saved with it.
  await expect.poll(async () => (await api<{ items: { id: string; spec?: { failuresClearedAt?: string | null } }[] }>('GET', '/content')).items.find(i => i.id === id)?.spec?.failuresClearedAt ?? null, { timeout: 10_000 }).not.toBeNull()
  await api('PATCH', `/content/${id}`, { spec: { failuresClearedAt: null } })
}

async function runRows(page: Page, info: TestInfo, phone: boolean) {
  // Library > Hooks always shows its run list, so the served jobs land there.
  const now = Date.now()
  const job = (n: number, at: number, o: Record<string, unknown>) => ({
    id: `job_t${n}`, label: 'Hook variants', purpose: `hook_variants:t${n}`, stage: 'content', status: 'failed', kind: 'llm', model: 'claude', modelName: 'Claude', characterId: null,
    estimate: '$0.01', actual: '$0.00', phase: 'failed', phaseLabel: 'Failed', since: new Date(at).toISOString(), typicalSec: 10, error: 'It failed.', detail: null, charged: 'no', retry: false, triggers: [], safer: false,
    createdAt: new Date(at).toISOString(), completedAt: new Date(at + 1000).toISOString(), ...o,
  })
  const jobs = [
    job(1, now - 600_000, { error: 'The provider content filter blocked this result.' }),
    job(2, now - 500_000, { error: 'The provider content filter blocked this result.' }),
    job(3, now - 400_000, { status: 'canceled', phase: 'canceled', error: 'Canceled.' }),
    job(4, now - 1000, { kind: 'image', model: 'higgsfield/nano-banana-2.1', modelName: 'Nano Banana 2.1', error: 'The provider\'s content filter blocked this result.', retry: true, triggers: ['tight', 'boy shorts'], safer: true }),
  ]
  await page.route(/\/api\/v1\/jobs(\?|$)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs }) }))
  await page.goto('/studio/library?tab=hooks')
  const rows = page.locator('.st-runs').filter({ hasText: 'Earlier:' }).first()
  await expect(rows.locator('.st-run.bad')).toHaveCount(1)
  await expect(rows.locator('[data-field="failure-line"]')).toHaveText(/Earlier: 2 blocked by the filter, refunded; 1 not run\. Nothing charged\./)
  // The run just refused: its likely trigger words and the safer retry.
  const fresh = rows.locator('.st-run.bad')
  await expect(fresh.locator('[data-field="trigger-words"]')).toHaveText(/^Likely trigger words: tight, boy shorts\./)
  await expect(fresh.getByRole('button', { name: /Retry with safer wording/ })).toBeVisible()
  await snap(page, info, 'one red row, one gray line')
  await press(rows.getByRole('button', { name: 'Show' }), phone)
  await expect(rows.locator('.st-run.bad')).toHaveCount(4)
  await press(rows.getByRole('button', { name: 'Clear' }), phone)
  await expect(page.locator('[data-field="failure-line"]')).toHaveCount(0)
  await expect(page.locator('.st-run.bad')).toHaveCount(1)
  // Remembered in this browser.
  await page.reload()
  await expect(page.locator('.st-run.bad')).toHaveCount(1)
  await expect(page.locator('[data-field="failure-line"]')).toHaveCount(0)
  await page.evaluate(() => localStorage.removeItem('studio.clearedRuns'))
}

// The face strip under a Recreate take (owner, 2026-10-15): drift is marked
// under the video rule's face number, 0.45, so the strip and the rule agree.
// The local face models are not installed, so the test serves known scores
// over the real take; the line itself comes from the API (the video rule in
// the gate check). The take's own review may be running again when the page
// opens (it asks for missing text frames), so the test never waits on it.
async function faceStrip(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(180_000)
  const gate = await api<{ video: { current: { face_min: number } } }>('GET', '/recreate/gate-check')
  const faceMin = gate.video.current.face_min
  expect(faceMin).toBe(0.45)
  type Review = { faceMin: number; step: number; duration: number; samples: Array<{ t: number; face: number | null; likeness: number | null }>; drift: Array<{ start: number; end: number }>; text: unknown[]; cuts: number[]; notes: string[] }
  type Clones = { clones: Array<{ id: string; assetId: string | null; needsFrames?: boolean; review: Review | null }> }
  // The oldest Recreate post with a take (copies are not set up the same way).
  const items = await allPosts<{ id: string; characterId: string | null; spec?: { clone?: { assetId?: string | null } | null } }>()
  let id = ''
  let take: Clones['clones'][number] | undefined
  for (const p of [...items].reverse().filter(i => i.spec?.clone?.assetId && i.characterId)) {
    take = (await api<Clones>('GET', `/content/${p.id}/clones`)).clones.find(c => c.assetId)
    if (take) { id = p.id; break }
  }
  if (!take) throw new Error('No Recreate post with a take. Run one in demo mode first.')
  const faces = [0.62, 0.58, 0.47, 0.45, 0.44, 0.31, 0.5, 0.6, null, 0.55, 0.52, 0.49]
  const step = 0.5
  const samples = faces.map((face, i) => ({ t: i * step, face, likeness: null }))
  const review: Review = { faceMin, step, duration: faces.length * step, samples, drift: [{ start: 2, end: 3 }], text: [], cuts: [], notes: [] }
  await page.route(`**/api/v1/content/${id}/clones`, async r => {
    const res = await r.fetch().catch(() => null)
    if (!res) return r.abort().catch(() => undefined)
    const body = await res.json() as Clones
    for (const c of body.clones) if (c.id === take!.id) { c.review = { ...(c.review ?? {}), ...review } as Review; c.needsFrames = false }
    await r.fulfill({ response: res, json: body })
  })
  await openStills(page, id)
  const strip = page.locator('.st-strip').first()
  await strip.scrollIntoViewIfNeeded()
  await expect(strip).toBeVisible({ timeout: 30_000 })
  const cells = strip.locator('.st-strip-cell')
  await expect(cells).toHaveCount(samples.length)
  // Under 0.45 is drift; 0.45 and above match; no face found is its own mark.
  for (const [i, f] of faces.entries()) await expect(cells.nth(i)).toHaveClass(new RegExp(f == null ? 'none' : f < 0.45 ? 'drift' : 'ok'))
  await expect(page.getByText('face under 0.45 (the video rule)')).toBeVisible()
  await expect(page.getByText('Drift at 2.0 to 3.0 s')).toBeVisible()
  // A cell takes you to its moment.
  await press(cells.nth(5), phone)
  await snap(page, info, phone ? 'phone: face strip, drift under 0.45' : 'face strip, drift under 0.45')
}

// A route still answering when a test ends is not a failure of the screen.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })

test('the stills grid: earlier failures fold into one gray line with Show and Clear', async ({ page }, info) => { await stillsGrid(page, info, false) })
test('the run rows: only the run just started is red; earlier failures are one gray line', async ({ page }, info) => { await runRows(page, info, false) })
test('the face strip marks drift under 0.45, the video rule', async ({ page }, info) => { await faceStrip(page, info, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: the stills grid folds earlier failures into one gray line', async ({ page }, info) => { await stillsGrid(page, info, true) })
  test('phone: the run rows show one red row and one gray line', async ({ page }, info) => { await runRows(page, info, true) })
  test('phone: the face strip marks drift under 0.45', async ({ page }, info) => { await faceStrip(page, info, true) })
})
