// Editor and worker parity (editor phase D, G32): the same timeline,
// exported by the editor in the browser (Done) and rendered by the worker
// (Export MP4), frames compared. Run against a local Studio (npm run
// studio) with Playwright's Chromium:
//   node scripts/editor-parity.mjs <playwright-core dir> <chromium> <clip.webm> <out dir> <character id>
// The browser gets the clip as VP9 WebM (a Chromium without H.264), the
// Studio the same clip as H.264 MP4. Captions are left out of the compare:
// the editor draws them with the browser's fonts, the worker with the
// bundled TikTok Sans.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [pw, chrome, webmPath, out, characterId] = process.argv.slice(2)
const { chromium } = await import(join(pw, 'index.mjs'))
const base = 'http://localhost:5173'
const mp4 = join(out, 'parity-clip.mp4')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4])
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--headless=new'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const webm = readFileSync(webmPath)
await page.route(/\/api\/v1\/assets\/ast_[a-z0-9]+\/content$/, r => r.request().resourceType() === 'fetch' ? r.fulfill({ status: 200, contentType: 'video/webm', body: webm }) : r.continue())
await page.goto(`${base}/studio`)
const api = (method, path, body) => page.evaluate(async ([m, p, b]) => {
  const res = await fetch(`/api/v1${p}`, { method: m, headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: b ? JSON.stringify(b) : undefined })
  return res.json()
}, [method, path, body])
const sleep = ms => new Promise(r => setTimeout(r, ms))
// The clip, as the Studio stores it.
const bytes = readFileSync(mp4)
const { slots } = await api('POST', '/uploads', { files: [{ name: 'parity.mp4', type: 'video/mp4', size: bytes.length }] })
const put = await context.request.put(`${base}${slots[0].url}`, { headers: { ...slots[0].headers, 'x-studio-request': '1' }, data: bytes })
if (!put.ok()) throw new Error(`upload ${put.status()}`)
const clip = await api('POST', `/characters/${characterId}/clips`, { uploadId: slots[0].uploadId, name: 'parity.mp4' })
for (let i = 0; i < 60; i++) {
  const lib = await api('GET', '/library')
  if (lib.clips?.find(c => c.id === clip.id)?.status === 'approved') break
  await sleep(2000)
}
const { id } = await api('POST', '/content', { kind: 'meme', characterId, spec: { clipId: clip.id, caption: 'parity' } })
console.log('POST', id)
// In the editor: Snap zoom (Strong) at the payoff, then Done.
await page.goto(`${base}/editor/?studio=${id}`)
await page.waitForFunction(() => /Editing:/.test(document.querySelector('[role="toolbar"]')?.textContent || ''), null, { timeout: 120000 })
await page.waitForSelector('[data-studio="presets"]')
await page.locator('[data-studio="presets"] button:has-text("Payoff ·")').first().click()
await page.locator('[data-studio="presets"] section button:has-text("Snap zoom")').first().click()
await page.locator('[data-studio-preset="snap_zoom"]').last().click()
await page.locator('[role="dialog"] button:has-text("Strong")').click()
await page.locator('[role="dialog"] button:has-text("Close")').click()
await page.locator('[role="toolbar"] button:has-text("Done")').click()
await page.waitForURL(/\/studio\/posts\//, { timeout: 300000 })
const wait = async test => { for (let i = 0; i < 150; i++) { const p = (await api('GET', '/content')).items.find(x => x.id === id); if (p && test(p)) return p; await sleep(2000) } throw new Error('timed out') }
const edited = await wait(p => p.status === 'ready' && p.outputs.fromEditor)
await api('POST', `/content/${id}/render`, {})
const worker = await wait(p => p.status === 'ready' && p.outputs.fromTimeline)
const save = async (assetId, name) => { const r = await context.request.get(`${base}/api/v1/assets/${assetId}/content`); const f = join(out, name); writeFileSync(f, await r.body()); return f }
const a = await save(edited.outputs.videoAssetId, 'parity-editor.mp4'), b = await save(worker.outputs.videoAssetId, 'parity-worker.mp4')
await browser.close()
// The bottom two thirds (no caption), frame by frame.
const frame = (file, t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'crop=1080:1280:0:640,scale=270:320', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
const psnr = (x, y) => { let se = 0; for (let i = 0; i < x.length; i++) se += (x[i] - y[i]) ** 2; return 10 * Math.log10((255 * 255) / Math.max(1e-9, se / x.length)) }
const rows = []
for (const t of [1, 3, 4.05, 4.2, 4.6, 5.0]) rows.push({ t, psnr: Math.round(psnr(frame(a, t), frame(b, t)) * 10) / 10 })
console.log(JSON.stringify({ post: id, editor: edited.outputs.videoAssetId, worker: worker.outputs.videoAssetId, frames: rows }))
