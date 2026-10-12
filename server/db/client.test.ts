import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { openDb } from './client'

describe('openDb', () => {
  it('applies migrations to an in-memory PGlite database', async () => {
    const h = await openDb({ memory: true })
    const rows = await h.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`)
    const names = (rows as unknown as { rows: { table_name: string }[] }).rows.map(r => r.table_name)
    expect(names).toEqual(expect.arrayContaining(['accounts', 'characters', 'jobs', 'ledger_entries', 'ref_images', 'candidates']))
    await h.close()
  })
})
