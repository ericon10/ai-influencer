import { defineConfig } from '@playwright/test'

// The browser suite (editor QA, 2026-10-15; hermetic since 2026-10-17, G63):
// drives the Studio and the OpenReel editor like a user (clicks, drags,
// double-clicks and typing) in demo mode, so every provider is the mock.
//
//   npm run e2e:editor                      the whole suite
//   npm run e2e:editor -- launchplan.spec   one spec (any spec runs alone)
//
// Each run starts its own Studio (global-setup.ts): server/dev.ts on a
// fresh PGlite database and blob folder in e2e/.out/run-<time>/, Vite on its
// own port serving the built editor (dist-editor; npm run build:editor),
// then the seed (seed.ts: Callie, Solei, a base post with a take, a voice
// line, music, two Recreate posts) through the API, ids in seed.json. The
// Studio stops when the run ends; its logs stay in the run folder. Needs only
// npm ci, the built editor and the face models (npm run models). Specs never
// assume what a database holds: they read the seed or make their own records,
// and one that renames, archives or deletes works on its own copy.
//
// E2E_WEB_PORT, E2E_API_PORT   the run's own Studio (default 5190 and 8790)
// E2E_BASE, E2E_API            use a Studio that is already running instead
//                              (demo mode; API default E2E_BASE/api/v1). The
//                              seed is made once there and reused (E2E_RESEED=1
//                              makes a new one); npm run e2e:seed makes it alone.
// E2E_LIVE_PORT, E2E_R2_PORT   the live-site proxy and fake storage (r2.ts),
//                              free ports by default
// PW_CHROMIUM                  a Chromium binary when Playwright's own is not installed
//
// retries stays 0: a failure is a bug in the Studio or in the test, never noise.
if (!process.env.E2E_BASE || process.env.E2E_HERMETIC) {
  process.env.E2E_HERMETIC = '1'
  process.env.E2E_BASE = `http://localhost:${process.env.E2E_WEB_PORT || 5190}`
  process.env.E2E_API = `http://127.0.0.1:${process.env.E2E_API_PORT || 8790}/api/v1`
} else {
  process.env.E2E_API ||= `${process.env.E2E_BASE.replace(/\/$/, '')}/api/v1`
}

export default defineConfig({
  testDir: './editor',
  outputDir: './.out/results',
  globalSetup: './global-setup.ts',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: './.out/report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE,
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
