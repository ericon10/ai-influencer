import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { directUrl, openDb } from './client.js'

describe('openDb', () => {
  it('applies migrations to an in-memory PGlite database', async () => {
    const h = await openDb({ memory: true })
    const rows = await h.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`)
    const names = (rows as unknown as { rows: { table_name: string }[] }).rows.map(r => r.table_name)
    expect(names).toEqual(expect.arrayContaining(['accounts', 'characters', 'jobs', 'ledger_entries', 'ref_images', 'candidates']))
    await h.close()
  })

  it('derives Neon\'s direct address from its pooled one, for the migration lock', () => {
    expect(directUrl('postgresql://u:p@ep-cool-fog-a1b2c3-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require'))
      .toBe('postgresql://u:p@ep-cool-fog-a1b2c3.us-east-1.aws.neon.tech/neondb?sslmode=require')
    expect(directUrl('postgresql://u:p@db.internal:5432/app')).toBe('postgresql://u:p@db.internal:5432/app')
  })
})
