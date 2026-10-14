import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

// Deployment settings. Provider keys are never read from here; they live in
// the encrypted per-account vault.
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().optional().default(''),
  // Optional direct (unpooled) address for migrations; derived from a Neon
  // pooled DATABASE_URL when unset.
  DATABASE_URL_UNPOOLED: z.string().optional().default(''),
  PGLITE_DIR: z.string().default('.data/pg'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.data/blobs'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  STUDIO_MASTER_KEYS: z.string().optional().default(''),
  STUDIO_SESSION_SECRET: z.string().optional().default(''),
  STUDIO_OWNER_EMAIL: z.string().optional().default(''),
  STUDIO_OWNER_PASSPHRASE: z.string().optional().default(''),
  STUDIO_PUBLIC_URL: z.string().optional().default(''),
  STUDIO_API_PORT: z.coerce.number().default(8787),
  // Face models for identity QA (npm run models downloads them here).
  STUDIO_MODELS_DIR: z.string().default('.data/models'),
  // The owner's Higgsfield API key (KEY_ID:KEY_SECRET), server side only. It
  // serves the owner's own account; customers add their own key in Settings.
  HF_CREDENTIALS: z.string().optional().default(''),
  // The owner's ElevenLabs API key (voice lines, speech to speech), server
  // side only, for the owner's own account. Without it voice lines say how
  // to add it; tests and local dev use the mock.
  ELEVENLABS_API_KEY: z.string().optional().default(''),
  // The owner's Vercel AI Gateway key, server side only: Kling 3.0 Motion
  // Control for "Recreate from a real clip" on the API path. The worker runs
  // on Railway (outside Vercel), so it needs the key itself.
  AI_GATEWAY_API_KEY: z.string().optional().default(''),
  // The job worker's address (Railway), woken when jobs are queued.
  STUDIO_WORKER_URL: z.string().optional().default(''),
  // Worker loop: "poll" checks every second (local dev); "wake" sleeps when
  // nothing is queued until the API wakes it, so the database can suspend.
  STUDIO_WORKER_IDLE: z.enum(['poll', 'wake']).default('poll'),
})

export type Env = z.infer<typeof schema> & { isProduction: boolean }

// A production deployment without its settings. The message names what is
// missing and never shows a value.
export class NotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`This deployment is not set up yet. Add these environment variables, then redeploy: ${missing.join(', ')}.`)
    this.name = 'NotConfiguredError'
  }
}

let cached: Env | null = null

export function loadEnv(overrides: Partial<Record<string, string>> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached
  // .env.local first (never committed), then .env; real environment wins.
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file)
  }
  const parsed = schema.parse({ ...process.env, ...overrides })
  // On Vercel, NODE_ENV is never set as a project variable (it would make the
  // build skip devDependencies), so a Vercel deployment counts as production.
  const env: Env = { ...parsed, isProduction: parsed.NODE_ENV === 'production' || process.env.VERCEL === '1' }

  // Production must set its real settings. The message lists names only,
  // never values: it is shown on a deployment that is not set up yet.
  if (env.isProduction) {
    const missing = [
      !env.DATABASE_URL && 'DATABASE_URL',
      !env.STUDIO_MASTER_KEYS && 'STUDIO_MASTER_KEYS',
      !env.STUDIO_SESSION_SECRET && 'STUDIO_SESSION_SECRET',
      env.STORAGE_DRIVER !== 's3' && 'STORAGE_DRIVER=s3',
      ...(env.STORAGE_DRIVER === 's3' ? (['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter(k => !env[k]) : []),
    ].filter((k): k is string => !!k)
    if (missing.length) throw new NotConfiguredError(missing)
  }
  // Local development: generate throwaway keys once so a fresh checkout runs
  // with zero setup.
  if (!env.STUDIO_MASTER_KEYS || !env.STUDIO_SESSION_SECRET) {
    const devKeys = localDevKeys()
    env.STUDIO_MASTER_KEYS ||= devKeys.master
    env.STUDIO_SESSION_SECRET ||= devKeys.session
  }
  if (Object.keys(overrides).length === 0) cached = env
  return env
}

function localDevKeys(): { master: string; session: string } {
  const file = resolve('.data/dev-keys.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const keys = {
    master: `dev1:${randomBytes(32).toString('base64')}`,
    session: randomBytes(32).toString('base64'),
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 })
  return keys
}
