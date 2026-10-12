import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from './db/client'
import { users } from './db/schema'
import { createLocalStore, createS3Store, type BlobStore } from './storage/blobStore'
import { createKeyVault } from './lib/vault'
import { loadEnv, type Env } from './lib/env'
import { logger } from './lib/logger'
import { loadConfig } from './config/load'
import { createRegistry } from './providers/registry'
import { readAsset } from './storage/assets'
import { createAccount } from './auth/accounts'
import { hashPassword } from './lib/passwords'
import { registerPipelineHooks } from './pipeline/hooks'
import { createFaceMatcher } from './qa/faces'
import { systemClock, type Deps } from './context'

// Builds every service from the environment. Used by the dev server, the
// worker, and the Vercel function.

export async function buildDeps(env: Env = loadEnv()): Promise<{ deps: Deps; handle: DbHandle }> {
  const config = loadConfig()
  const handle = await openDb({ url: env.DATABASE_URL || undefined, pgliteDir: env.PGLITE_DIR })
  const store: BlobStore = env.STORAGE_DRIVER === 's3'
    ? await createS3Store({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY })
    : createLocalStore(env.STORAGE_LOCAL_DIR)
  const vault = createKeyVault(env.STUDIO_MASTER_KEYS)
  const depsRef: { current?: Deps } = {}
  const providers = createRegistry({
    db: handle.db, vault, config, store,
    loadAsset: async (accountId, assetId) => (await readAsset(depsRef.current!, { accountId, userId: null, role: 'admin', email: '', requestId: 'mock', log: logger }, assetId)).data,
  })
  const faces = createFaceMatcher({ modelsDir: env.STUDIO_MODELS_DIR, log: logger })
  const deps: Deps = { db: handle.db, store, vault, env, config, providers, faces, clock: systemClock, log: logger }
  depsRef.current = deps
  registerPipelineHooks()
  await ensureOwner(deps)
  return { deps, handle }
}

// First boot: create the owner account. In production a passphrase is
// required; locally the owner can work without one (auto sign-in).
export async function ensureOwner(deps: Deps): Promise<void> {
  const existing = await deps.db.select().from(users).limit(1)
  const email = (deps.env.STUDIO_OWNER_EMAIL || 'owner@studio.local').toLowerCase()
  const pass = deps.env.STUDIO_OWNER_PASSPHRASE
  if (!existing.length) {
    if (deps.env.isProduction && !pass) throw new Error('Set STUDIO_OWNER_EMAIL and STUDIO_OWNER_PASSPHRASE for the first production boot.')
    await createAccount(deps.db, { name: 'My Studio', ownerEmail: email, passwordHash: pass ? await hashPassword(pass) : null })
    deps.log.info({ email }, 'created owner account')
    return
  }
  const [owner] = await deps.db.select().from(users).where(eq(users.email, email))
  if (owner && pass && !owner.passwordHash) {
    await deps.db.update(users).set({ passwordHash: await hashPassword(pass) }).where(eq(users.id, owner.id))
  }
}
