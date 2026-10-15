import { expect, test, type Page } from '@playwright/test'
import { api, snap } from './helpers'

// Earlier failures in one gray line (owner, 2026-10-15): in the Recreate
// stills grid and in the run rows, only the run just started shows its
// failures red; the earlier ones are counted in one gray line with Show and
// Clear. The lists are served by the test (nothing runs).

async function recreatePost(): Promise<{ id: string; characterId: string }> {
  const { items } = await api<{ items: { id: string; characterId: string | null; spec?: { clone?: { assetId?: string | null } | null } }[] }>('GET', '/content')
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
    const res = await r.fetch()
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

test('the stills grid: earlier failures fold into one gray line with Show and Clear', async ({ page }, info) => {
  const { id, characterId } = await recreatePost()
  await api('PATCH', `/content/${id}`, { spec: { failuresClearedAt: null } })
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const blocked = 'The provider content filter blocked this result.'
  const stills = [
    still('ok1', { characterId, assetId: 'ast_ok', status: 'approved' }),
    still('fresh-bad', { characterId, error: blocked, failure: 'blocked' }),
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
  await snap(page, info, 'one gray line')
  await line.getByRole('button', { name: 'Show' }).click()
  await expect(page.locator('[data-field="earlier-failures"] .st-tile')).toHaveCount(6)
  await snap(page, info, 'shown')
  await line.getByRole('button', { name: 'Clear' }).click()
  await expect(line).toHaveCount(0)
  // Cleared for good on this post: saved with it.
  await expect.poll(async () => (await api<{ items: { id: string; spec?: { failuresClearedAt?: string | null } }[] }>('GET', '/content')).items.find(i => i.id === id)?.spec?.failuresClearedAt ?? null, { timeout: 10_000 }).not.toBeNull()
  await api('PATCH', `/content/${id}`, { spec: { failuresClearedAt: null } })
})

test('the run rows: only the run just started is red; earlier failures are one gray line', async ({ page }, info) => {
  // Library > Hooks always shows its run list, so the served jobs land there.
  const now = Date.now()
  const job = (n: number, at: number, o: Record<string, unknown>) => ({
    id: `job_t${n}`, label: 'Hook variants', purpose: `hook_variants:t${n}`, stage: 'content', status: 'failed', kind: 'llm', model: 'claude', modelName: 'Claude', characterId: null,
    estimate: '$0.01', actual: '$0.00', phase: 'failed', phaseLabel: 'Failed', since: new Date(at).toISOString(), typicalSec: 10, error: 'It failed.', detail: null, charged: 'no', retry: false,
    createdAt: new Date(at).toISOString(), completedAt: new Date(at + 1000).toISOString(), ...o,
  })
  const jobs = [
    job(1, now - 600_000, { error: 'The provider content filter blocked this result.' }),
    job(2, now - 500_000, { error: 'The provider content filter blocked this result.' }),
    job(3, now - 400_000, { status: 'canceled', phase: 'canceled', error: 'Canceled.' }),
    job(4, now - 1000, { error: 'Claude did not answer in time.' }),
  ]
  await page.route(/\/api\/v1\/jobs(\?|$)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs }) }))
  await page.goto('/studio/library?tab=hooks')
  const rows = page.locator('.st-runs').filter({ hasText: 'Earlier:' }).first()
  await expect(rows.locator('.st-run.bad')).toHaveCount(1)
  await expect(rows.locator('[data-field="failure-line"]')).toHaveText(/Earlier: 2 blocked by the filter, refunded; 1 not run\. Nothing charged\./)
  await snap(page, info, 'one red row, one gray line')
  await rows.getByRole('button', { name: 'Show' }).click()
  await expect(rows.locator('.st-run.bad')).toHaveCount(4)
  await rows.getByRole('button', { name: 'Clear' }).click()
  await expect(page.locator('[data-field="failure-line"]')).toHaveCount(0)
  await expect(page.locator('.st-run.bad')).toHaveCount(1)
  // Remembered in this browser.
  await page.reload()
  await expect(page.locator('.st-run.bad')).toHaveCount(1)
  await expect(page.locator('[data-field="failure-line"]')).toHaveCount(0)
  await page.evaluate(() => localStorage.removeItem('studio.clearedRuns'))
})
