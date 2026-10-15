import { expect, test } from '@playwright/test'
import { api, captionBlock, openEditor, seedPost, snap } from './helpers'

// Caption sources the editor opens with (editor QA, 2026-10-15): a hook
// picked in the Caption step reaches the editor's timeline as the caption.

test('Pick a hook in the Caption step becomes the caption in the editor', async ({ page }, info) => {
  const post = await seedPost({ caption: '' })
  await page.goto(`/studio/posts/${post}`)
  const step = page.locator('[data-field="step-text"]')
  await step.getByRole('button', { name: 'Pick a hook' }).click()
  const drawer = page.getByRole('dialog').filter({ hasText: 'Pick a hook' })
  const first = drawer.locator('.st-hookpick').first()
  await expect(first).toBeVisible({ timeout: 20_000 })
  // The hook's words, without its number badge and kind.
  const words = (await first.evaluate(el => [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim()))
  expect(words.length).toBeGreaterThan(3)
  await first.click()
  await expect(step.locator('textarea').first()).toHaveValue(words)
  await snap(page, info, 'hook picked in the Caption step')
  // Saved to the post, then opened in the editor.
  await expect.poll(async () => (await api<{ items: { id: string; spec?: { caption?: string } }[] }>('GET', '/content')).items.find(i => i.id === post)?.spec?.caption, { timeout: 15_000 }).toBe(words)
  await openEditor(page, post)
  await expect(captionBlock(page, words)).toBeVisible()
  await snap(page, info, 'the hook on the editor timeline')
})
