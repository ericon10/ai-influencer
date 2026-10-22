import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { seedData, snap as attach } from './helpers'

// Modals (owner, 2026-10-22): every modal keeps the same padding on all
// sides and nothing in it sticks out past its edges, at desktop and phone
// width. The New character modal shows which card is picked (a mouse or the
// keyboard), starts with neither picked and its button disabled, and names
// what comes next: "Start from a concept" for a person, "Set up the persona"
// for a faceless account.

const SHOTS = join(process.cwd(), 'e2e', '.out', 'shots')
async function snap(page: Page, info: TestInfo, name: string) {
  await attach(page, info, name)
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), await page.screenshot())
}

// The open modal's room: its own box, and the box of everything in it (the
// whole scrolled content, not only what shows).
async function room(page: Page) {
  const modal = page.locator('.st-modal').last()
  await expect(modal).toBeVisible()
  return modal.evaluate(m => {
    const box = m.getBoundingClientRect()
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.position !== 'fixed' }
    // What a person sees: the words, and the things with their own edge
    // (buttons, fields, cards, pictures). Wrappers without an edge of
    // their own are not content.
    // Content inside its own scroll box (a prompt viewer) counts as that box.
    const scroller = (el: Element | null) => {
      for (let x = el; x && x !== m; x = x.parentElement) { const o = getComputedStyle(x); if (/(auto|scroll)/.test(o.overflowX + o.overflowY)) return x }
      return null
    }
    const clip = (r: DOMRect, el: Element | null): DOMRect => { const sc = scroller(el); return sc ? sc.getBoundingClientRect() : r }
    const rects: Array<{ r: DOMRect; what: string }> = []
    const walk = document.createTreeWalker(m, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent?.trim() || !n.parentElement || !shown(n.parentElement)) continue
      const range = document.createRange(); range.selectNodeContents(n)
      for (const r of Array.from(range.getClientRects())) if (r.width && r.height) rects.push({ r: clip(r, n.parentElement), what: `"${n.textContent.trim().slice(0, 30)}"` })
    }
    for (const el of Array.from(m.querySelectorAll('button, input, select, textarea, img, svg, video, canvas, label, .st-choice, .st-card, .st-callout, [role="radio"]'))) {
      if (!shown(el)) continue
      const s = getComputedStyle(el)
      const edged = el.matches('button, input, select, textarea, img, svg, video, canvas') || s.borderTopWidth !== '0px' || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent')
      if (edged) rects.push({ r: clip(el.getBoundingClientRect(), el.parentElement), what: `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"` })
    }
    const left = Math.min(...rects.map(x => x.r.left)), right = Math.max(...rects.map(x => x.r.right))
    const top = Math.min(...rects.map(x => x.r.top)) + m.scrollTop, bottom = Math.max(...rects.map(x => x.r.bottom)) + m.scrollTop
    const out = rects.filter(x => x.r.left < box.left - 0.5 || x.r.right > box.right + 0.5).map(x => x.what)
    return {
      pad: { left: Math.round(left - box.left), right: Math.round(box.right - right), top: Math.round(top - box.top), bottom: Math.round(box.top + m.scrollHeight - bottom) },
      sideways: m.scrollWidth > m.clientWidth + 1,
      out: [...new Set(out)].slice(0, 5),
    }
  })
}

async function checkRoom(page: Page, name: string, phone: boolean) {
  const r = await room(page)
  const min = phone ? 14 : 18
  expect.soft(r.out, `${name}: nothing sticks out of the modal`).toEqual([])
  expect.soft(r.sideways, `${name}: no sideways scroll in the modal`).toBe(false)
  for (const side of ['left', 'right', 'top', 'bottom'] as const) expect.soft(r.pad[side], `${name}: ${side} padding`).toBeGreaterThanOrEqual(min)
  // The same padding on every side (within a few pixels).
  expect.soft(Math.max(r.pad.left, r.pad.right) - Math.min(r.pad.left, r.pad.right), `${name}: left and right padding match`).toBeLessThanOrEqual(2)
}

const close = async (page: Page) => { await page.keyboard.press('Escape'); await expect(page.locator('.st-modal')).toHaveCount(0) }

async function newCharacter(page: Page, info: TestInfo, phone: boolean) {
  const tap = (l: Locator) => (phone ? l.tap() : l.click())
  await page.goto('/studio/characters')
  await tap(page.getByRole('button', { name: /^New character/ }).first())
  const modal = page.locator('.st-modal [data-field="new-character-kind"]')
  await expect(modal).toBeVisible()
  const person = modal.getByRole('radio', { name: /^Person/ }), faceless = modal.getByRole('radio', { name: /^Faceless/ })
  const go = modal.locator('[data-field="new-character-go"]')
  // Nothing picked to start; the button waits for a pick.
  await expect(person).toHaveAttribute('aria-checked', 'false')
  await expect(faceless).toHaveAttribute('aria-checked', 'false')
  await expect(go).toBeDisabled()
  await checkRoom(page, 'New character', phone)
  // The picked card is clearly picked: the accent border and a check mark.
  await tap(person)
  await expect(person).toHaveAttribute('aria-checked', 'true')
  await expect(person.locator('[data-field="choice-check"]')).toBeVisible()
  await expect(faceless.locator('[data-field="choice-check"]')).toHaveCount(0)
  const accent = await page.evaluate(() => getComputedStyle(document.querySelector('.st-root')!).getPropertyValue('--st-accent').trim())
  const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
  // Under the mouse too (the pointer is still on the card just clicked).
  await expect.poll(() => person.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(rgb(accent))
  await expect(go).toBeEnabled()
  await expect(go).toHaveText('Start from a concept')
  await checkRoom(page, 'New character, Person picked', phone)
  await snap(page, info, `${phone ? 'phone: ' : ''}new character, person picked`)
  // The keyboard moves the pick (arrow keys, like any radio group).
  await person.focus()
  await page.keyboard.press('ArrowDown')
  await expect(faceless).toHaveAttribute('aria-checked', 'true')
  await expect(faceless).toBeFocused()
  await expect(go).toHaveText('Set up the persona')
  await checkRoom(page, 'New character, Faceless picked', phone)
  await snap(page, info, `${phone ? 'phone: ' : ''}new character, faceless picked`)
  await close(page)
}

// Every other modal the Studio has, opened like a person would.
async function everyModal(page: Page, info: TestInfo, phone: boolean) {
  test.setTimeout(240_000)
  const tap = (l: Locator) => (phone ? l.tap() : l.click())
  await page.goto('/studio/characters')
  await tap(page.getByRole('button', { name: /^Import a character file/ }).first())
  await checkRoom(page, 'Import a character file', phone)
  await close(page)

  await page.goto(`/studio/characters/${seedData().callie}`)
  await tap(page.getByRole('button', { name: 'Edit card' }))
  await checkRoom(page, 'Edit card', phone)
  await close(page)
  await tap(page.getByRole('button', { name: /^Voice$/ }))
  await checkRoom(page, 'Voice', phone)
  await close(page)
  await tap(page.locator('[data-field="delete-character"]').first())
  await checkRoom(page, 'Delete character', phone)
  await snap(page, info, `${phone ? 'phone: ' : ''}delete character modal`)
  await close(page)

  // A price's Details.
  await page.goto(`/studio/posts/${seedData().basePost}`)
  await tap(page.locator('.st-poststeps button').filter({ hasText: 'Stills' }).first())
  const details = page.getByRole('button', { name: 'Price details' }).first()
  await expect(details).toBeVisible({ timeout: 30_000 })
  await tap(details)
  await checkRoom(page, 'Price details', phone)
  await close(page)

}

test('New character: padded, nothing picked to start, the pick shows (mouse and keyboard), the button names the next step', async ({ page }, info) => { await newCharacter(page, info, false) })
test('every modal: the same padding on all sides, nothing past its edges', async ({ page }, info) => { await everyModal(page, info, false) })

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('phone: New character', async ({ page }, info) => { await newCharacter(page, info, true) })
  test('phone: every modal', async ({ page }, info) => { await everyModal(page, info, true) })
})
