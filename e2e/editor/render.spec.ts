import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { api, API, captionBlocks, countColor, deselect, frame, openEditor, presetCard, seedPost, seek, snap, timeline } from './helpers'

// The render check (editor QA, 2026-10-15): what the preview shows is what
// Done exports through the worker. A post with music and a voiceover; the
// caption is edited long (wraps), karaoke lights its words, a punch-in sits
// at the payoff. The worker's MP4 is compared with the preview frame by
// frame, its length with the post, and its music with the ducking.

const OUT = join(process.cwd(), 'e2e', '.out', 'render')
mkdirSync(OUT, { recursive: true })
const LONG = 'when the code finally works and you have no idea why it works'

async function previewPng(page: Page, name: string): Promise<string> {
  const f = await frame(page)
  const file = join(OUT, `${name}.png`)
  writeFileSync(file, await page.screenshot({ clip: f }))
  return file
}

// Mean difference (0 to 255) of two images scaled to 108 x 192, gray.
function diff(a: string, b: string): number {
  const gray = (f: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=108:192,format=gray', '-f', 'rawvideo', '-'])
  const x = gray(a), y = gray(b)
  let s = 0
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i]! - y[i]!)
  return s / x.length
}

// The 1500 Hz click of the test music, in dB, between two times.
function clickLevel(file: string, from: number, to: number): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-to', String(to), '-i', file, '-af', 'bandpass=f=1500:w=60,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1] ?? NaN)
}

test('Done exports what the preview shows', async ({ page }, info) => {
  test.setTimeout(480_000)
  const post = await seedPost({ music: true, voice: true })
  await openEditor(page, post, { mp3: true })

  // The voice line's caption, made long and karaoke.
  const cap = captionBlocks(page).first()
  await cap.dblclick()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(LONG)
  await page.keyboard.press('Enter')
  await captionBlocks(page).first().click()
  await presetCard(page, 'Each word lights up as it is said.').click()
  // A punch-in at the payoff (3 s).
  await seek(page, 3)
  await presetCard(page, 'A quick push-in that lands on the beat.').click()
  await page.waitForTimeout(600)
  await deselect(page)

  const times = [1.2, 3.4]
  const previews: string[] = []
  for (const t of times) {
    await seek(page, t)
    await page.waitForTimeout(1200)
    previews.push(await previewPng(page, `preview-${t}`))
  }
  await seek(page, 1.2)
  await page.waitForTimeout(1000)
  const f = await frame(page)
  const litPreview = await countColor(page, { x: f.x, y: f.y + f.height * 0.15, width: f.width, height: f.height * 0.25 }, [255, 214, 10], 45)
  expect(litPreview).toBeGreaterThan(20)
  await snap(page, info, 'before Done')

  const started = Date.now()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/editor/'), { timeout: 240_000 })

  // The worker makes the browser's export a plain MP4.
  let video: string | null = null
  for (let i = 0; i < 120 && !video; i++) {
    const { items } = await api<{ items: { id: string; status: string; outputs?: { videoAssetId?: string; fromEditor?: boolean; renderedAt?: string } | null }[] }>('GET', '/content')
    const p = items.find(x => x.id === post)
    if (p?.status === 'ready' && p.outputs?.fromEditor && p.outputs.videoAssetId && Date.parse(p.outputs.renderedAt ?? '') > started) video = p.outputs.videoAssetId
    else await new Promise(r => setTimeout(r, 2000))
  }
  expect(video, 'the worker saved the export').toBeTruthy()
  const mp4 = join(OUT, 'export.mp4')
  const res = await fetch(`${API}/assets/${video}/content`, { headers: { 'x-studio-request': '1' } })
  writeFileSync(mp4, Buffer.from(await res.arrayBuffer()))

  // The post's length, not the music's.
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }))
  expect(duration).toBeGreaterThan(4.6)
  expect(duration).toBeLessThan(5.5)

  // Frame by frame against the preview.
  for (const [i, t] of times.entries()) {
    const png = join(OUT, `export-${t}.png`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', png])
    const d = diff(previews[i]!, png)
    info.annotations.push({ type: 'diff', description: `${t} s: mean difference ${d.toFixed(1)} of 255` })
    expect(d).toBeLessThan(14)
    await info.attach(`export at ${t} s`, { path: png, contentType: 'image/png' })
    await info.attach(`preview at ${t} s`, { path: previews[i]!, contentType: 'image/png' })
  }

  // Ducking: the music's clicks are quieter under the voice (0.5 s to its end).
  const before = clickLevel(mp4, 0, 0.45)
  const under = clickLevel(mp4, 1.0, 2.6)
  info.annotations.push({ type: 'ducking', description: `clicks ${before.toFixed(1)} dB before the voice, ${under.toFixed(1)} dB under it` })
  expect(before - under).toBeGreaterThan(5)

  // "Make another like this" carries the presets into the copy.
  await page.goto(`/studio/posts/${post}`)
  await page.getByRole('button', { name: /Make another like this/ }).first().click()
  await page.waitForURL(u => /\/studio\/posts\/cnt_/.test(u.pathname) && !u.pathname.endsWith(post), { timeout: 30_000 })
  const copy = new URL(page.url()).pathname.split('/').pop()!
  await openEditor(page, copy, { mp3: true })
  await expect(timeline(page).locator('[data-studio-preset="punch_in"]')).toHaveCount(1)
  await snap(page, info, 'the copy opens with the punch-in')
})
