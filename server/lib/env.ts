import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

// Deployment settings. Provider keys are never read from here; they live in
// the encrypted per-account vault.
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().optional().default(''),
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
})

export type Env = z.infer<typeof schema> & { isProduction: boolean }

let cached: Env | null = null

export function loadEnv(overrides: Partial<Record<string, string>> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached
  if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env')
  const parsed = schema.parse({ ...process.env, ...overrides })
  const env: Env = { ...parsed, isProduction: parsed.NODE_ENV === 'production' }

  // Local development: generate throwaway keys once so a fresh checkout runs
  // with zero setup. Production must set real keys.
  if (!env.STUDIO_MASTER_KEYS || !env.STUDIO_SESSION_SECRET) {
    if (env.isProduction) throw new Error('STUDIO_MASTER_KEYS and STUDIO_SESSION_SECRET must be set in production.')
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
