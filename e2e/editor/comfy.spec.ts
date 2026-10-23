import { expect, test } from '@playwright/test'
import { API, api, seedData, snap } from './helpers'

// ComfyUI and the engine lever (UX-PLAN.md section 41) like a person, in
// demo mode: Make the agent token (shown once), the card online after the
// agent's heartbeat (sent here as the agent would), Test connection
// answered, the environment check, Pause; the engine lever at the top of
// Settings with what ComfyUI cannot do and the table; the lever on Make the
// week; Train LoRA on the character file tab (the free mock in demo mode)
// and Compare providers. Nothing paid runs.

const lock = {
  version: 1, comfyui: 'd07dff4565ea9804277fff8cdfa0c817e08c3d44', pytorch: '2.8.0+cu128',
  nodes: { 'ComfyUI-KJNodes': '74b7f1731cfd0208ae50b9ffc55145564c25e65f', 'ComfyUI-segment-anything-2': '0c35fff5f382803e2310103357b5e985f5437f32', comfyui_controlnet_aux: 'a587a4c1594524c1d2de5cd1a86cd868ff448e1c' },
  models: Object.fromEntries(['clip_vision/clip_vision_h.safetensors', 'diffusion_models/krea2_raw.safetensors', 'diffusion_models/krea2_turbo.safetensors', 'diffusion_models/qwen_image_edit_2511_bf16.safetensors', 'diffusion_models/wan2.2_animate_14B_bf16.safetensors', 'diffusion_models/wan2.2_i2v_high_noise_14B_fp16.safetensors', 'diffusion_models/wan2.2_i2v_low_noise_14B_fp16.safetensors', 'sam2/sam2.1_hiera_large.safetensors', 'text_encoders/krea2_text_encoder.safetensors', 'text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors', 'text_encoders/umt5_xxl_fp16.safetensors', 'vae/krea2_vae.safetensors', 'vae/qwen_image_vae.safetensors', 'vae/wan_2.1_vae.safetensors', '@comfy/custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose/dw-ll_ucoco_384.onnx', '@comfy/custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose/yolox_l.onnx'].map(k => [k, null])),
}
const beat = (token: string, env = lock) => fetch(`${API}/comfy/agent/heartbeat`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ agentVersion: '1.0.0', comfyOk: true, gpu: 'NVIDIA RTX 6000 Ada', vramTotalMb: 49140, vramFreeMb: 45000, comfyQueue: 0, models: ['diffusion_models/qwen_image_edit_2511_bf16.safetensors'], env, loadedFamily: null, running: [] }) }).then(r => r.json())

test.describe.configure({ mode: 'serial' })

test('Settings > ComfyUI: the token once, online after a heartbeat, Test connection answered, an environment mismatch said, Pause', async ({ page }, info) => {
  await page.goto('/studio/settings')
  const card = page.locator('[data-field="settings-comfy"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.locator('[data-field="comfy-make-token"]').click()
  const shown = card.locator('[data-field="comfy-token"]')
  await expect(shown).toContainText('cfy.', { timeout: 15_000 })
  const token = (await shown.locator('pre, code, textarea').first().textContent())?.trim().match(/cfy\.[A-Za-z0-9_.-]+/)?.[0]
  expect(token).toBeTruthy()
  // The machine's agent calls in with it.
  const r = await beat(token!)
  expect(r.env.ok).toBe(true)
  await expect(card.locator('[data-field="comfy-online"]')).toHaveText('Online', { timeout: 20_000 })
  await expect(card.locator('[data-field="comfy-status"]')).toContainText('NVIDIA RTX 6000 Ada')
  await card.locator('[data-field="comfy-test"]').click()
  await expect(card.locator('[data-field="comfy-test-answer"]')).toContainText('Waiting for the machine', { timeout: 15_000 })
  await beat(token!)
  await expect(card.locator('[data-field="comfy-test-answer"]')).toContainText('Answered', { timeout: 20_000 })
  await expect(card.locator('[data-field="comfy-wf-qwen-image-edit-2511"]')).toContainText('Not confirmed')
  await expect(card.locator('[data-field="comfy-wf-krea-2-turbo"]')).toContainText('License check')
  await snap(page, info, 'settings: ComfyUI online')
  // A machine that drifted gets no jobs, and the card says why.
  await beat(token!, { ...lock, comfyui: 'ffffffffffffffffffffffffffffffffffffffff' })
  await expect(card.locator('[data-field="comfy-env"]')).toContainText('ComfyUI is at ffffffffffff, expected d07dff4565ea', { timeout: 20_000 })
  await expect(card.locator('[data-field="comfy-accept-env"]')).toBeVisible()
  await beat(token!)
  await expect(card.locator('[data-field="comfy-env"]')).toContainText('matches the expected environment', { timeout: 20_000 })
  await card.locator('[data-field="comfy-pause"]').click()
  await expect(card.locator('[data-field="comfy-pause"]')).toHaveText(/Resume the queue/, { timeout: 15_000 })
  await card.locator('[data-field="comfy-pause"]').click()
  await expect(card.locator('[data-field="comfy-pause"]')).toHaveText(/Pause the queue/, { timeout: 15_000 })
})

test('the engine lever: ComfyUI for every step it can do, what it cannot do said, the table; back to each step\'s own model', async ({ page }, info) => {
  await page.goto('/studio/settings')
  const lever = page.locator('[data-field="engine-lever"]').first()
  await expect(lever).toBeVisible({ timeout: 30_000 })
  await lever.getByLabel('Engine').selectOption('comfy')
  await expect(lever.locator('[data-field="engine-note"]').first()).toContainText('ComfyUI cannot do recreate stills and face pass', { timeout: 15_000 })
  await lever.locator('[data-field="engine-table-toggle"]').click()
  const table = lever.locator('[data-field="engine-table"]')
  await expect(table).toContainText('Wan 2.2 I2V (ComfyUI)')
  await expect(table).toContainText('$0 API, about')
  const v = await api<{ engine: string | null }>('GET', '/engines/lever')
  expect(v.engine).toBe('comfy')
  await snap(page, info, 'settings: the engine lever on ComfyUI')
  // On Make the week too (one switch, two places).
  await page.goto('/studio/weeks?step=make')
  await expect(page.locator('[data-field="engine-lever"]').getByLabel('Engine')).toHaveValue('comfy', { timeout: 30_000 })
  await page.locator('[data-field="engine-lever"]').getByLabel('Engine').selectOption('')
  await expect.poll(async () => (await api<{ engine: string | null }>('GET', '/engines/lever')).engine, { timeout: 15_000 }).toBeNull()
})

test('the character file tab: Train LoRA (demo mock) lists Qwen v1 active; Compare providers opens', async ({ page }, info) => {
  const { callie } = seedData()
  await page.goto(`/studio/characters/${callie}?tab=file`)
  const card = page.locator('[data-field="character-loras"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const before = (await api<{ loras: unknown[] }>('GET', `/characters/${callie}/loras`)).loras.length
  const train = card.getByRole('button', { name: /^Train (the|a new version of the) Qwen LoRA/ })
  await expect(train).toBeEnabled({ timeout: 30_000 })
  await train.click()
  // Demo mode asks for no confirmation on a free run; a confirm dialog may show.
  const confirm = page.getByRole('button', { name: /^(Run|Start|Confirm)/ })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect.poll(async () => (await api<{ loras: Array<{ state: string }> }>('GET', `/characters/${callie}/loras`)).loras.filter(l => l.state === 'ready').length, { timeout: 60_000 }).toBeGreaterThan(before)
  await expect(card.locator('[data-field="lora-list"]')).toContainText('Active', { timeout: 20_000 })
  await snap(page, info, 'character: LoRAs on ComfyUI')
  await card.locator('[data-field="open-compare"]').click()
  await expect(page.locator('[data-field="compare-drawer"]')).toBeVisible()
  const drawer = page.locator('[data-field="compare-drawer"]')
  const runIt = drawer.getByRole('button', { name: /Run the comparison/ })
  await expect(runIt).toContainText(/\$\d|credits|Free/, { timeout: 30_000 })
  // Demo mode: free mocks stand in; each still gets its face and skin scores.
  await runIt.click()
  const confirmRun = page.getByRole('button', { name: /^Confirm / })
  if (await confirmRun.first().isVisible({ timeout: 1500 }).catch(() => false)) await confirmRun.first().click()
  await expect(drawer.locator('[data-field="compare-summary"]')).toContainText(/Face .*, skin \d/, { timeout: 120_000 })
  await snap(page, info, 'character: Compare providers with face and skin scores')
})
