import { expect, test } from '@playwright/test'
import { openEditor, seedPost, snap, timeline } from './helpers'

// Sound in the editor (editor QA, 2026-10-15): a post with uploaded music
// (stored as M4A) and a voiceover. The audit found the M4A stopped the
// whole post from opening and the music was never ducked under the voice.

test('music, voiceover and ducking open with the post', async ({ page }, info) => {
  await openEditor(page, await seedPost({ music: true, voice: true }))
  await expect(page.getByText('Opened without', { exact: false })).toHaveCount(0)
  const music = timeline(page).locator('[aria-label^="Select clip E2E beat 120"]')
  await expect(music).toBeVisible()
  await expect(timeline(page).locator('[aria-label^="Select clip Voice"]')).toBeVisible()
  // The voice's words are the captions.
  await expect(timeline(page).locator('[aria-label^="Select text clip"]').first()).toBeVisible()
  // A music bed longer than the post ends with the post (the export too).
  await expect(page.locator('.editor-stage')).toContainText('00:05:00')
  await expect(page.locator('.editor-stage')).not.toContainText('00:12:')
  await snap(page, info, 'music and voice on the timeline')
  // The music is ducked under the voice.
  await music.click()
  const inspector = page.locator('#editor-panel-inspector')
  await inspector.getByText('Audio Ducking', { exact: true }).first().click()
  await expect(inspector.getByText('Ducking Applied', { exact: false })).toBeVisible()
  await snap(page, info, 'ducking applied on the music')
})
