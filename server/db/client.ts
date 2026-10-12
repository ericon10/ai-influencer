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
  let client
  if (opts.memory) {
    client = new PGlite()
  } else {
    const dir = resolve(opts.pgliteDir || '.data/pg')
    mkdirSync(dir, { recursive: true })
    client = new PGlite(dir)
  }
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  return { db: db as unknown as Db, driver: 'pglite', close: () => client.close() }
}
