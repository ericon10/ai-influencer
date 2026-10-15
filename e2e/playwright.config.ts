import { defineConfig } from '@playwright/test'

// The editor e2e suite (editor QA, 2026-10-15): drives the OpenReel editor
// like a user (clicks, drags, double-clicks and typing) against a running
// Studio in demo mode, so every provider is the mock. Start it first with
// `npm run studio` (API and worker on 8787, Vite on 5173 serving the built
// editor from dist-editor), then `npm run e2e:editor`.
//
// E2E_BASE    where the Studio runs (default http://localhost:5173)
// E2E_API     its API (default http://localhost:8787/api/v1)
// E2E_POST    a post with a picked clip to copy (default: the first found)
// PW_CHROMIUM a Chromium binary when Playwright's own is not installed
export default defineConfig({
  testDir: './editor',
  outputDir: './.out/results',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: './.out/report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    actionTimeout: 20_000,
    screenshot: 'on',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
})
