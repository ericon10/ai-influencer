import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema.js'

export type Schema = typeof schema
export type Db = PgDatabase<PgQueryResultHKT, Schema>

export interface DbHandle {
  db: Db
  driver: 'pglite' | 'postgres'
  close(): Promise<void>
}

// Next to this file in the source tree; from the working directory when the
// code runs bundled (the worker image, the Vercel function).
const MIGRATIONS = [join(dirname(fileURLToPath(import.meta.url)), 'migrations'), resolve(process.cwd(), 'server/db/migrations')]
  .find(dir => existsSync(join(dir, 'meta', '_journal.json'))) ?? resolve(process.cwd(), 'server/db/migrations')

// Postgres everywhere: a real server (Neon) when DATABASE_URL is set,
// otherwise embedded PGlite in a local folder, or in memory for tests.
export async function openDb(opts: { url?: string; migrateUrl?: string; pgliteDir?: string; memory?: boolean }): Promise<DbHandle> {
  if (opts.url) {
    const { default: pg } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    // Migrations run on one direct connection under an advisory lock, so the
    // API and the worker can boot at the same moment on a fresh database.
    // Neon's pooled address cannot hold a session lock, so the lock uses the
    // direct address of the same database.
    const mc = new pg.Client({ connectionString: sslUrl(opts.migrateUrl || directUrl(opts.url)), connectionTimeoutMillis: 15_000 })
    await mc.connect()
    try {
      await mc.query('select pg_advisory_lock($1)', [MIGRATION_LOCK])
      await migrate(drizzle(mc, { schema }), { migrationsFolder: MIGRATIONS })
    } finally {
      await mc.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined)
      await mc.end()
    }
    // Small pool, short idle life: serverless functions open few connections,
    // and closing idle ones lets Neon suspend the database between bursts.
    const pool = new pg.Pool({ connectionString: sslUrl(opts.url), max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 })
    const db = drizzle(pool, { schema })
    return { db: db as unknown as Db, driver: 'postgres', close: () => pool.end() }
  }

  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  if (opts.memory) {
    // Tests: migrate once per process, then clone the migrated data directory
    // for each database (about 6x faster than running migrations every time).
    template ??= (async () => {
      const seed = new PGlite()
      await migrate(drizzle(seed, { schema }), { migrationsFolder: MIGRATIONS })
      const dump = await seed.dumpDataDir('none')
      await seed.close()
      return dump
    })()
    const client = new PGlite({ loadDataDir: await template })
    await client.waitReady
    return { db: drizzle(client, { schema }) as unknown as Db, driver: 'pglite', close: () => client.close() }
  }
  const dir = resolve(opts.pgliteDir || '.data/pg')
  mkdirSync(dir, { recursive: true })
  const client = new PGlite(dir)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  return { db: db as unknown as Db, driver: 'pglite', close: () => client.close() }
}

let template: Promise<File | Blob> | null = null

const MIGRATION_LOCK = 727274

// Neon names its pooled endpoint "<endpoint>-pooler.<region>..."; the same
// host without "-pooler" is the direct endpoint of the same database.
export function directUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hostname = u.hostname.replace(/-pooler\./, '.')
    return u.toString()
  } catch {
    return url
  }
}

// pg treats sslmode prefer, require and verify-ca as verify-full today and
// warns about it on every connection (906 warnings in a week of production
// logs). Saying verify-full keeps exactly today's behavior without the
// warning; the environment's address is left as it is.
export function sslUrl(url: string): string {
  try {
    const u = new URL(url)
    const mode = u.searchParams.get('sslmode')
    if (mode === 'prefer' || mode === 'require' || mode === 'verify-ca') u.searchParams.set('sslmode', 'verify-full')
    return u.toString()
  } catch {
    return url
  }
}
