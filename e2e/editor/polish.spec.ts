import { expect, test, type Page } from '@playwright/test'
import { api, seedData, snap } from './helpers'

// The polish sweep (UX-PLAN.md section 42 F): on every main page, at desktop
// and phone width, no help chip ("How this works") overlaps a title, and
// every priced button fits inside its card. Measured in the page, like a
// person would see it.

// A week with posts on it, so Weeks is swept with its grid.
const run = Date.now().toString(36).slice(-5)
const MONDAY = '2027-04-05'
test.beforeAll(async () => {
  const account = `callie_polish_${run}`
  await api('PUT', `/social-accounts/${account}`, { characterId: seedData().callie, slotsPerDay: 2 })
  const rows = [['row_id', 'account', 'date', 'slot', 'post_type', 'line'], [`P1${run}`, account, MONDAY, '1', 'text_only', `a polish sweep line ${run}`], [`P2${run}`, account, '2027-04-07', '2', 'photo', `another polish line ${run}`]]
  await api('POST', '/weeks/import', { csv: rows.map(r => r.join(',')).join('\n'), rows: rows.slice(1).map(r => r[0]) })
  await api('POST', `/weeks/${MONDAY}/check`, {})
})

const pages = () => {
  const s = seedData()
  return [
    '/studio', `/studio/weeks?week=${MONDAY}`, `/studio/weeks?week=${MONDAY}&step=make`, `/studio/weeks?week=${MONDAY}&step=review`, '/studio/accounts', '/studio/line-bank', '/studio/library',
    '/studio/settings', '/studio/settings?tab=models', `/studio/characters/${s.callie}`, `/studio/characters/${s.callie}?tab=file`,
    `/studio/posts/${s.basePost}`, '/studio/guide',
  ]
}

type Box = { x: number; y: number; width: number; height: number }

async function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const r = (el: Element) => el.getBoundingClientRect()
    const visible = (el: Element) => { const b = r(el); const st = getComputedStyle(el); return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' }
    const hit = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
    const titles = [...document.querySelectorAll('h1, h2, h3, .st-h1, .st-h2, .st-h3, .st-label')].filter(visible)
    // The text of a title, not its box: a title row may hold the chip.
    const textBox = (el: Element): Box | null => {
      const range = document.createRange()
      const nodes = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())
      if (!nodes.length) return null
      range.setStartBefore(nodes[0]!); range.setEndAfter(nodes[nodes.length - 1]!)
      const b = range.getBoundingClientRect()
      return b.width ? b : null
    }
    for (const chip of [...document.querySelectorAll('.gd-howto')].filter(visible)) {
      const c = r(chip)
      for (const t of titles) {
        if (t.contains(chip) && !textBox(t)) continue
        const tb = textBox(t)
        if (tb && hit(c, tb)) out.push(`help chip "${chip.textContent?.trim()}" overlaps the title "${t.textContent?.trim().slice(0, 40)}"`)
      }
    }
    for (const btn of [...document.querySelectorAll('.st-pricebtn-row > button')].filter(visible)) {
      const card = btn.closest('.st-card, .st-drawer, .st-reviewcard, .st-batchrow')
      if (!card) continue
      const b = r(btn), k = r(card)
      if (b.right > k.right + 1 || b.left < k.left - 1) out.push(`priced button "${btn.textContent?.trim().slice(0, 50)}" sticks out of its card (${Math.round(b.left)}-${Math.round(b.right)} vs ${Math.round(k.left)}-${Math.round(k.right)})`)
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      // The outermost element past the right edge, outside any scroller.
      const clipped = (el: Element) => { for (let p = el.parentElement; p; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true } return false }
      const wide = [...document.querySelectorAll('body *')].filter(el => visible(el) && r(el).right > window.innerWidth + 1 && !clipped(el))
      const top = wide.filter(el => !wide.some(o => o !== el && o.contains(el) && o !== document.body)).slice(0, 3)
      out.push(`the page is wider than the screen (${document.documentElement.scrollWidth} > ${window.innerWidth}): ${top.map(el => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${el.getAttribute('data-field') ? `[${el.getAttribute('data-field')}]` : ''}`).join(', ')}`)
    }
    return [...new Set(out)]
  })
}

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
  test(`${name}: help chips never overlap a title, priced buttons fit their cards`, async ({ page }, info) => {
    test.setTimeout(240_000)
    await page.setViewportSize(viewport)
    const found: string[] = []
    for (const path of pages()) {
      await page.goto(path)
      // The page itself, not only the sidebar.
      await page.locator('.st-page, .st-post, .st-workspace, [data-field="post"]').first().waitFor({ timeout: 30_000 })
      // Prices and lazy cards settle.
      await page.waitForLoadState('networkidle').catch(() => undefined)
      for (const p of await problems(page)) found.push(`${path}: ${p}`)
    }
    if (found.length) { console.log(`POLISH ${name}:\n${found.join('\n')}`); await snap(page, info, `${name}: last page swept`) }
    expect(found).toEqual([])
  })
}
