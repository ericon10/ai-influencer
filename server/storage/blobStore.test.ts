import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalStore } from './blobStore'

describe('local blob store', () => {
  it('writes, reads, checks and deletes', async () => {
    const store = createLocalStore(await mkdtemp(join(tmpdir(), 'blobs-')))
    await store.put('acct_1/a/b.png', Buffer.from('png'), 'image/png')
    expect((await store.get('acct_1/a/b.png')).toString()).toBe('png')
    expect(await store.exists('acct_1/a/b.png')).toBe(true)
    await store.delete('acct_1/a/b.png')
    expect(await store.exists('acct_1/a/b.png')).toBe(false)
  })

  it('rejects keys that try to escape the root', async () => {
    const store = createLocalStore(await mkdtemp(join(tmpdir(), 'blobs-')))
    await expect(store.put('../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow(/Unsafe/)
    await expect(store.put('/abs/path', Buffer.from('x'), 'text/plain')).rejects.toThrow(/Unsafe/)
  })
})
