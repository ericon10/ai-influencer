import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from './db/client.js'
import { users } from './db/schema.js'
import { createLocalStore, createS3Store, type BlobStore } from './storage/blobStore.js'
import { createKeyVault } from './lib/vault.js'
import { loadEnv, NotConfiguredError, type Env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { loadConfig } from './config/load.js'
import { createRegistry } from './providers/registry.js'
import { readAsset } from './storage/assets.js'
import { createAccount } from './auth/accounts.js'
import { hashPassword, verifyPassword } from './lib/passwords.js'
import { registerPipelineHooks } from './pipeline/hooks.js'
import { createFaceMatcher } from './qa/faces.js'
import { systemClock, type Deps } from './context.js'
import { setWakeFailureHandler } from './jobs/wake.js'
import { recordWakeFailure } from './jobs/workerStatus.js'

// Builds every service from the environment. Used by the dev server, the
// worker, and the Vercel function.

export async function buildDeps(env: Env = loadEnv()): Promise<{ deps: Deps; handle: DbHandle }> {
  const config = loadConfig()
  const handle = await openDb({ url: env.DATABASE_URL || undefined, migrateUrl: env.DATABASE_URL_UNPOOLED || undefined, pgliteDir: env.PGLITE_DIR })
  const store: BlobStore = env.STORAGE_DRIVER === 's3'
    ? await createS3Store({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY })
    : createLocalStore(env.STORAGE_LOCAL_DIR)
  const vault = createKeyVault(env.STUDIO_MASTER_KEYS)
  const depsRef: { current?: Deps } = {}
  const providers = createRegistry({
    db: handle.db, vault, config, store,
    serverKeys: { ownerEmail: env.STUDIO_OWNER_EMAIL || 'owner@studio.local', higgsfield: env.HF_CREDENTIALS || undefined, elevenlabs: env.ELEVENLABS_API_KEY || undefined, vercel: env.AI_GATEWAY_API_KEY || undefined },
    voiceMock: !env.isProduction,
    loadAsset: async (accountId, assetId) => (await readAsset(depsRef.current!, { accountId, userId: null, role: 'admin', email: '', requestId: 'mock', log: logger }, assetId)).data,
  })
  const faces = createFaceMatcher({ modelsDir: env.STUDIO_MODELS_DIR, log: logger })
  const deps: Deps = { db: handle.db, store, vault, env, config, providers, faces, clock: systemClock, log: logger }
  depsRef.current = deps
  registerPipelineHooks()
  // A wake call the worker refused or never received shows as "Worker down".
  setWakeFailureHandler(message => recordWakeFailure(deps, message).catch(() => undefined))
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
    if (deps.env.isProduction && (!pass || !deps.env.STUDIO_OWNER_EMAIL)) {
      throw new NotConfiguredError([!deps.env.STUDIO_OWNER_EMAIL && 'STUDIO_OWNER_EMAIL', !pass && 'STUDIO_OWNER_PASSPHRASE'].filter((k): k is string => !!k))
    }
    try {
      await createAccount(deps.db, { name: 'My Studio', ownerEmail: email, passwordHash: pass ? await hashPassword(pass) : null })
      deps.log.info({ email }, 'created owner account')
    } catch (e) {
      // The API and the worker can boot together on a fresh database; the
      // other one created the owner first.
      if (!(await deps.db.select().from(users).where(eq(users.email, email))).length) throw e
    }
    return
  }
  const [owner] = await deps.db.select().from(users).where(eq(users.email, email))
  // The deployment's passphrase is the source of truth for the owner: set it,
  // or change it in the environment and redeploy to rotate it.
  if (owner && pass && (!owner.passwordHash || !(await verifyPassword(pass, owner.passwordHash)))) {
    await deps.db.update(users).set({ passwordHash: await hashPassword(pass) }).where(eq(users.id, owner.id))
    deps.log.info({ email }, 'owner passphrase set from the environment')
  }
}
