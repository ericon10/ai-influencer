import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

export type Schema = typeof schema
export type Db = PgDatabase<PgQueryResultHKT, Schema>

export interface DbHandle {
  db: Db
  driver: 'pglite' | 'postgres'
  close(): Promise<void>
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

// Postgres everywhere: a real server (Neon) when DATABASE_URL is set,
// otherwise embedded PGlite in a local folder, or in memory for tests.
export async function openDb(opts: { url?: string; pgliteDir?: string; memory?: boolean }): Promise<DbHandle> {
  if (opts.url) {
    const { Pool } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const pool = new Pool({ connectionString: opts.url, max: 10 })
    const db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder: MIGRATIONS })
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
