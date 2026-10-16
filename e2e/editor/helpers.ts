import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

// Helpers for the editor e2e suite. Everything a test does to the editor
// goes through the mouse and keyboard; the API is used only to make a fresh
// post to open (mock providers, nothing paid).

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '..', '.out', 'cache')
mkdirSync(CACHE, { recursive: true })

export const API = process.env.E2E_API ?? 'http://localhost:8787/api/v1'
const H = { 'x-studio-request': '1', 'content-type': 'application/json' }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : {}) as T
}

// A post to copy: E2E_POST, or the oldest with one shot (see below).
let basePost: string | null = process.env.E2E_POST ?? null
async function findBasePost(): Promise<string> {
  if (basePost) return basePost
  const { items } = await api<{ items: { id: string; characterId: string | null; spec?: { clipId?: string | null; editor?: { stack?: unknown } | null } }[] }>('GET', '/content')
  // A live character only: the character file test archives any Wren left
  // from an earlier run, and her posts with her.
  const live = new Set((await api<{ characters: { id: string }[] }>('GET', '/characters')).characters.map(c => c.id))
  // The oldest post with one shot and no saved editor presets, so copies
  // of posts this suite saved never leak their presets into the next test.
  for (const p of items.filter(i => i.spec?.clipId && !i.spec?.editor?.stack && i.characterId && live.has(i.characterId)).reverse()) {
    const m = await api<{ media: { kind: string }[] }>('GET', `/content/${p.id}/editor`).catch(() => null)
    if (m?.media.filter(x => x.kind === 'video').length === 1) return (basePost = p.id)
  }
  throw new Error('No post with a picked clip. Make one in the Studio (demo mode) or set E2E_POST.')
}

export async function uploadFile(path: string, name: string, type: string): Promise<string> {
  const data = readFileSync(path)
  const { slots } = await api<{ slots: { uploadId: string; url: string; headers?: Record<string, string> }[] }>('POST', '/uploads', { files: [{ name, type, size: data.length }] })
  const slot = slots[0]!
  const url = slot.url.startsWith('http') ? slot.url : `${new URL(API).origin}${slot.url}`
  const r = await fetch(url, { method: 'PUT', headers: { 'x-studio-request': '1', ...(slot.headers ?? { 'content-type': type }) }, body: data })
  if (!r.ok) throw new Error(`upload ${r.status} ${await r.text()}`)
  return slot.uploadId
}

// A music bed as the Studio stores uploads (AAC in an M4A): 12 s, a click
// every half second (120 BPM) over a low tone.
async function musicSound(): Promise<string> {
  const file = join(CACHE, 'beat-120.m4a')
  if (!existsSync(file)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=110:duration=12', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.04),sin(2*PI*1500*t),0)':d=12", '-filter_complex', 'amix=inputs=2:weights=1 3', '-c:a', 'aac', file])
  }
  const uploadId = await uploadFile(file, 'e2e-beat-120.m4a', 'audio/mp4')
  const sound = await api<{ id: string }>('POST', '/sounds', { uploadId, name: 'e2e-beat-120.m4a', kind: 'music', title: 'E2E beat 120' })
  for (let i = 0; i < 60; i++) {
    const { sounds } = await api<{ sounds: { id: string; status: string }[] }>('GET', '/sounds')
    if (sounds.find(s => s.id === sound.id)?.status === 'ready') break
    await new Promise(r => setTimeout(r, 1000))
  }
  return sound.id
}

export const CAPTION = 'me when the code finally works'

// A fresh copy of the base post: its clip, a caption, and optionally a
// music bed and the first ready voice line (whose words become captions).
export async function seedPost(opts: { caption?: string; music?: boolean; voice?: boolean } = {}): Promise<string> {
  const { id } = await api<{ id: string }>('POST', `/content/${await findBasePost()}/duplicate`)
  const music = opts.music ? await musicSound() : null
  let voice: { id: string; at: number; captions: boolean } | null = null
  if (opts.voice) {
    const { lines } = await api<{ lines: { id: string; status: string }[] }>('GET', '/voice-lines')
    const ready = lines.find(l => l.status === 'ready')
    if (ready) voice = { id: ready.id, at: 0.5, captions: true }
  }
  await api('PATCH', `/content/${id}`, {
    title: 'Editor e2e',
    spec: { caption: opts.caption ?? CAPTION, sound: { music, musicLevel: 'normal', duck: true, clipSound: true, voice }, editor: null },
  })
  return id
}

// Playwright's Chromium has no H.264 or AAC decoder (Chrome has both):
// clips are served as VP9 WebM, and with `mp3` the Studio's M4A sound as
// MP3 so the beat and the export's music can be checked.
async function vp9Route(page: Page, opts: { mp3?: boolean } = {}) {
  await page.route(/\/api\/v1\/assets\/[^/]+\/content/, async route => {
    // The page may close while a file is still loading (the test is done).
    const res = await route.fetch().catch(() => null)
    if (!res) return route.abort().catch(() => undefined)
    const type = res.headers()['content-type'] ?? ''
    if (opts.mp3 && type.startsWith('audio/mp4')) {
      const id = route.request().url().match(/assets\/([^/]+)\/content/)![1]!
      const out = join(CACHE, `${id}.mp3`)
      if (!existsSync(out)) {
        const src = join(CACHE, `${id}.m4a`)
        writeFileSync(src, await res.body())
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libmp3lame', '-b:a', '192k', out])
      }
      return route.fulfill({ status: 200, headers: { 'content-type': 'audio/mpeg', 'cross-origin-resource-policy': 'same-origin' }, body: readFileSync(out) })
    }
    if (!type.startsWith('video/')) return route.fulfill({ response: res })
    const id = route.request().url().match(/assets\/([^/]+)\/content/)![1]!
    const out = join(CACHE, `${id}.webm`)
    if (!existsSync(out)) {
      const src = join(CACHE, `${id}.src`)
      writeFileSync(src, await res.body())
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libvpx-vp9', '-b:v', '1.5M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', out])
    }
    await route.fulfill({ status: 200, headers: { 'content-type': 'video/webm', 'cross-origin-resource-policy': 'same-origin' }, body: readFileSync(out) })
  })
}

export async function openEditor(page: Page, post: string, opts: { mp3?: boolean } = {}) {
  await vp9Route(page, opts)
  await page.goto(`/editor/?studio=${post}`)
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('body')).not.toContainText(/Opening the post|Adding the|Placing the|Ducking the music/, { timeout: 120_000 })
  await page.waitForTimeout(1200)
}

export async function snap(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

// ── The timeline ──

export const timeline = (page: Page) => page.locator('#editor-panel-timeline')
export const clipBlocks = (page: Page) => timeline(page).locator('[aria-label^="Select clip"]')
export const captionBlocks = (page: Page) => timeline(page).locator('[aria-label^="Select text clip"]')
export const captionBlock = (page: Page, text: string) => timeline(page).locator(`[aria-label="Select text clip ${text}"]`)

// Seconds to x on the ruler, from its "00:00" and "00:05" labels.
export async function ruler(page: Page): Promise<{ x: (t: number) => number; y: number }> {
  const ticks = await timeline(page).evaluate(root => [...root.querySelectorAll('*')]
    .filter(e => e.children.length === 0 && /^00:0[05]$/.test((e.textContent ?? '').trim()))
    .map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent ?? '').trim(), x: r.x, y: r.y, h: r.height } })
    .filter(e => e.h > 0))
  const top = Math.min(...ticks.map(t => t.y))
  const row = ticks.filter(t => t.y < top + 4)
  const t0 = row.find(t => t.t === '00:00')!
  const t5 = row.find(t => t.t === '00:05')!
  const pps = (t5.x - t0.x) / 5
  return { x: t => t0.x + t * pps, y: t0.y + t0.h / 2 }
}

// A click on an empty part of the timeline clears the selection.
export async function deselect(page: Page) {
  const b = (await timeline(page).boundingBox())!
  await page.mouse.click(b.x + b.width * 0.47, b.y + b.height - 50)
  await page.waitForTimeout(300)
}

export async function seek(page: Page, seconds: number) {
  const r = await ruler(page)
  await page.mouse.click(r.x(seconds), r.y)
  await page.waitForTimeout(300)
}

// ── The preview ──

const PROJECT = { width: 1080, height: 1920 }

// The frame inside the preview canvas (the canvas is letterboxed).
export async function frame(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  // At phone width the preview can mount a moment after the post opens.
  await page.locator('.editor-stage canvas').first().waitFor({ state: 'visible', timeout: 15_000 })
  const boxes = await page.locator('.editor-stage canvas').evaluateAll(cs => cs.map(c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
  const c = boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0]!
  const aspect = PROJECT.width / PROJECT.height
  if (c.width / c.height > aspect) {
    const w = c.height * aspect
    return { x: c.x + (c.width - w) / 2, y: c.y, width: w, height: c.height }
  }
  const h = c.width / aspect
  return { x: c.x, y: c.y + (c.height - h) / 2, width: c.width, height: h }
}

// A point in the frame, as fractions of its width and height.
export async function framePoint(page: Page, fx: number, fy: number) {
  const f = await frame(page)
  return { x: f.x + f.width * fx, y: f.y + f.height * fy }
}

export const textBox = (page: Page) => page.locator('[data-studio="text-box"]')
export const inlineEditor = (page: Page) => page.getByLabel('Edit the caption text')
export const noSelection = (page: Page) => page.locator('#editor-panel-inspector').getByText('No selection', { exact: true })

export async function centerOf(l: Locator) {
  const b = (await l.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}

// Pixels near a color inside a rectangle of the page.
export async function countColor(page: Page, rect: { x: number; y: number; width: number; height: number }, rgb: [number, number, number], tol = 40): Promise<number> {
  const png = await page.screenshot({ clip: rect })
  return page.evaluate(async ([b64, rgb, tol]) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i]! - rgb[0]) < tol && Math.abs(d[i + 1]! - rgb[1]) < tol && Math.abs(d[i + 2]! - rgb[2]) < tol) n++
    }
    return n
  }, [png.toString('base64'), rgb, tol] as const)
}

// The Studio panel's preset card, by its one-line description.
export const presetCard = (page: Page, line: string) => page.locator(`button[title="${line}"]`).first()

// A post whose clip shows time: a 6 s 9:16 clip with a red bar that moves
// across and the frame number in large type, so a timing slip (speed,
// split, freeze) shows in a frame. Uploaded as the post's own clip.
export async function seedTimerPost(opts: { caption?: string } = {}): Promise<string> {
  const post = await seedPost({ caption: opts.caption })
  const file = join(CACHE, 'timer-6s.mp4')
  if (!existsSync(file)) {
    const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x223344:s=1080x1920:r=30:d=6',
      '-f', 'lavfi', '-i', 'color=c=red:s=140x1920:r=30:d=6',
      '-filter_complex', `[0][1]overlay=x='t*156':y=0,drawtext=fontfile=${font}:text='%{n}':fontsize=260:fontcolor=white:x=(w-text_w)/2:y=h*0.62,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', file])
  }
  const before = await api<{ media: { id: string }[] }>('GET', `/content/${post}/editor`)
  const { items } = await api<{ items: { id: string; characterId: string | null }[] }>('GET', '/content')
  const characterId = items.find(i => i.id === post)!.characterId!
  const uploadId = await uploadFile(file, 'e2e-timer-6s.mp4', 'video/mp4')
  await api('POST', `/characters/${characterId}/clips`, { uploadId, name: 'e2e-timer-6s.mp4', contentId: post })
  for (let i = 0; i < 90; i++) {
    const m = await api<{ media: { id: string; kind: string }[] }>('GET', `/content/${post}/editor`).catch(() => null)
    const v = m?.media.filter(x => x.kind === 'video') ?? []
    if (v.length === 1 && v[0]!.id !== before.media[0]?.id) return post
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('The timer clip did not become the post clip.')
}

// ── The render check ──

export const RENDER_OUT = join(HERE, '..', '.out', 'render')
mkdirSync(RENDER_OUT, { recursive: true })

// The frame of the preview, saved as a PNG.
export async function previewPng(page: Page, name: string): Promise<string> {
  const f = await frame(page)
  const file = join(RENDER_OUT, `${name}.png`)
  writeFileSync(file, await page.screenshot({ clip: f }))
  return file
}

// Mean difference (0 to 255) of two images scaled to 108 x 192, gray.
export function imageDiff(a: string, b: string): number {
  const gray = (f: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=108:192,format=gray', '-f', 'rawvideo', '-'])
  const x = gray(a), y = gray(b)
  let s = 0
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i]! - y[i]!)
  return s / x.length
}

// Done in the editor, then the worker's MP4 for this post, saved locally.
export async function exportWithDone(page: Page, post: string, name: string): Promise<string> {
  const started = Date.now()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/editor/'), { timeout: 240_000 })
  for (let i = 0; i < 120; i++) {
    const { items } = await api<{ items: { id: string; status: string; outputs?: { videoAssetId?: string; fromEditor?: boolean; renderedAt?: string } | null }[] }>('GET', '/content')
    const p = items.find(x => x.id === post)
    if (p?.status === 'ready' && p.outputs?.fromEditor && p.outputs.videoAssetId && Date.parse(p.outputs.renderedAt ?? '') > started) {
      const mp4 = join(RENDER_OUT, `${name}.mp4`)
      const res = await fetch(`${API}/assets/${p.outputs.videoAssetId}/content`, { headers: { 'x-studio-request': '1' } })
      writeFileSync(mp4, Buffer.from(await res.arrayBuffer()))
      return mp4
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('The worker did not save the export.')
}

export function exportFrame(mp4: string, t: number, name: string): string {
  const png = join(RENDER_OUT, `${name}.png`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', png])
  return png
}

export function duration(mp4: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }))
}
