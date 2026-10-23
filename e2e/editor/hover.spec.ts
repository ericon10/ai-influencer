import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// Hover and focus on every control (owner, 2026-10-23; UX-PLAN section 38):
// hover never lowers contrast. Each visible, enabled button, link-button,
// chip, menu item, tab and icon button on Weeks, Posts, a post workspace,
// Line bank, Characters and Settings is hovered like a person, its pixels
// read, and the text (or icon) measured against the fill under it: 4.5:1
// for text, 3:1 for an icon alone. The keyboard focus ring must show on
// every one. Pixels, not computed styles, so gradients and filters count.

const SHOTS = join(process.cwd(), 'e2e', '.out', 'shots')
const CONTROLS = 'button, a.st-btn, a.st-chip, [role="tab"], [role="menuitem"], .st-nav-item, .st-chip'

const lum = ([r, g, b]: number[]) => {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!)
}
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05) }

// The fill is the most common color; the ink is the pixel that differs from
// it most. Rendered at 2x so thin text keeps its full color in its strokes.
export async function inkContrast(png: Buffer): Promise<{ ratio: number; fill: number[]; ink: number[] }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const counts = new Map<number, number>()
  const px = (i: number) => [data[i]!, data[i + 1]!, data[i + 2]!]
  for (let i = 0; i < data.length; i += info.channels) {
    const k = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  let fill = [0, 0, 0], n = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const k = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3)
    if (k === top) { const p = px(i); fill = fill.map((v, j) => v + p[j]!); n++ }
  }
  fill = fill.map(v => Math.round(v / n))
  let best = 1, ink = fill
  for (let i = 0; i < data.length; i += info.channels) { const p = px(i), r = ratio(p, fill); if (r > best) { best = r; ink = p } }
  return { ratio: best, fill, ink }
}

interface Probe { sig: string; label: string; hasText: boolean }

// One of each kind of control on the page (same classes and same kind of
// content), visible, enabled and not covered by something else.
async function probes(page: Page): Promise<Probe[]> {
  return page.evaluate((sel) => {
    const out: { sig: string; label: string; hasText: boolean }[] = []
    const seen = new Set<string>()
    let n = 0
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.hasAttribute('data-hover-probe')) { seen.add(el.getAttribute('data-hover-sig') ?? ''); continue }
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue
      if (el.closest('[inert], [aria-hidden="true"]')) continue
      const r = el.getBoundingClientRect()
      if (r.width < 12 || r.height < 12) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.6) continue
      // Content that is a picture is not text on a fill.
      if (el.querySelector('img, video, canvas')) continue
      const text = (el.innerText || '').trim()
      const hasText = text.length > 0
      const sig = `${el.tagName}.${(el.className || '').toString().trim().split(/\s+/).sort().join('.')}|${el.getAttribute('role') ?? ''}|${hasText ? 't' : 'i'}`
      if (seen.has(sig)) continue
      seen.add(sig)
      const id = `hv${Date.now().toString(36)}${n++}`
      el.setAttribute('data-hover-probe', id)
      el.setAttribute('data-hover-sig', sig)
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || ''
      out.push({ sig: id, label: `${sig.split('|')[0]}${hasText ? ` "${text.slice(0, 30).replace(/\s+/g, ' ')}"` : ` (icon${name ? `: ${name.slice(0, 40)}` : ''})`}`, hasText })
    }
    return out
  }, CONTROLS)
}

async function measure(page: Page, el: Locator): Promise<number | null> {
  await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined)
  // Wait for the page to stop moving (a step click scrolls smoothly).
  let box = await el.boundingBox()
  for (let i = 0; i < 20 && box; i++) {
    await page.waitForTimeout(80)
    const next = await el.boundingBox()
    if (next && Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5) break
    box = next
  }
  if (!box || box.y < 0 || box.y + box.height > (page.viewportSize()?.height ?? 900)) return null
  // Covered by another element (a drawer, a menu): it cannot be hovered.
  const free = await el.evaluate((node, [x, y]) => { const top = document.elementFromPoint(x!, y!); return !!top && (node === top || node.contains(top)) }, [box.x + box.width / 2, box.y + box.height / 2])
  if (!free) return null
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(260)
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height }, animations: 'disabled' })
  return (await inkContrast(png)).ratio
}

async function sweep(page: Page, info: TestInfo, light: boolean) {
  test.setTimeout(600_000)
  if (light) await page.addInitScript(() => { try { localStorage.setItem('theme_default_v2', '1'); localStorage.setItem('theme', 'light') } catch { /* the sweep still runs */ } })
  const { basePost, recreatePost, callie } = seedData()
  const items = (await api<{ items: Array<{ id: string; kind: string }> }>('GET', '/content')).items
  const slideshow = items.find(i => i.kind === 'slideshow')
  const batch = items.find(i => i.kind === 'batch')
  const pages = [
    '/studio/weeks', '/studio', `/studio/posts/${basePost}`, `/studio/posts/${recreatePost}`, ...(slideshow ? [`/studio/posts/${slideshow.id}`] : []), ...(batch ? [`/studio/posts/${batch.id}`] : []),
    '/studio/line-bank', '/studio/characters', `/studio/characters/${callie}`, '/studio/accounts', '/studio/library', '/studio/settings', '/studio/settings?tab=general', '/studio/settings?tab=rules', '/studio/guide',
  ]
  const low: string[] = [], noRing: string[] = []
  let checked = 0
  for (const url of pages) {
    await page.goto(url)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(700)
    // A post workspace: every step, as the owner walks through it.
    const steps = url.includes('/posts/') ? await page.locator('.st-poststeps button').count() : 0
    for (let step = 0; step <= steps; step++) {
    if (step > 0) { await page.locator('.st-poststeps button').nth(step - 1).click().catch(() => undefined); await page.waitForTimeout(600) }
    for (const p of await probes(page)) {
      const el = page.locator(`[data-hover-probe="${p.sig}"]`).first()
      const r = await measure(page, el)
      if (r === null) continue
      checked++
      const need = p.hasText ? 4.5 : 3
      if (r < need) low.push(`${light ? 'light ' : ''}${url}: ${p.label} on hover ${r.toFixed(2)}:1 (needs ${need}:1)`)
      // The focus ring, as a keyboard user gets it (the mouse moved off first,
      // so a hover glow is not taken for the ring).
      await page.mouse.move(2, (page.viewportSize()?.height ?? 800) - 2)
      await page.waitForTimeout(200)
      await page.keyboard.press('Shift')
      // A ring counts only when focus changes how the control looks: an
      // outline, or a shadow it does not have at rest.
      const ring = await el.evaluate((node) => {
        const rest = getComputedStyle(node).boxShadow
        ;(node as HTMLElement).focus({ preventScroll: true })
        if (document.activeElement !== node) return true
        const st = getComputedStyle(node)
        const shown = (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0) || (st.boxShadow !== 'none' && st.boxShadow !== rest)
        ;(node as HTMLElement).blur()
        return shown
      })
      if (!ring) noRing.push(`${light ? 'light ' : ''}${url}: ${p.label} has no focus ring`)
    }
    }
  }
  console.log(`[hover] ${checked} controls hovered on ${pages.length} pages${light ? ' (light)' : ''}; ${low.length} low, ${noRing.length} without a ring`)
  await page.goto('/studio')
  const newPost = page.locator('.st-nav-new')
  await newPost.hover()
  await page.waitForTimeout(300)
  await snap(page, info, `${light ? 'light: ' : ''}New post on hover`)
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `new-post-hover-${light ? 'light' : 'dark'}.png`), await page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 220 } }))
  expect(checked).toBeGreaterThan(40)
  expect([...new Set([...low, ...noRing])]).toEqual([])
}

test.use({ deviceScaleFactor: 2 })

test('hover never lowers contrast and every control shows a focus ring: Weeks, Posts, a post, Line bank, Characters, Settings', async ({ page }, info) => { await sweep(page, info, false) })
test('light theme: hover never lowers contrast and every control shows a focus ring', async ({ page }, info) => { await sweep(page, info, true) })
