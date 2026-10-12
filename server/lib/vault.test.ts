import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createKeyVault } from './vault'

const key = () => randomBytes(32).toString('base64')

describe('key vault', () => {
  it('round-trips a secret bound to its account and provider', () => {
    const vault = createKeyVault(`v1:${key()}`)
    const sealed = vault.seal('hf-key-id:hf-secret', 'acct_1|higgsfield')
    expect(sealed.envelope).not.toContain('hf-secret')
    expect(vault.open(sealed.envelope, 'acct_1|higgsfield')).toBe('hf-key-id:hf-secret')
  })

  it('refuses to open a secret under another account', () => {
    const vault = createKeyVault(`v1:${key()}`)
    const sealed = vault.seal('secret', 'acct_1|higgsfield')
    expect(() => vault.open(sealed.envelope, 'acct_2|higgsfield')).toThrow()
  })

  it('reads secrets sealed under an older master key after rotation', () => {
    const oldKey = key()
    const before = createKeyVault(`v1:${oldKey}`).seal('secret', 'a|p')
    const after = createKeyVault(`v2:${key()},v1:${oldKey}`)
    expect(after.currentVersion).toBe('v2')
    expect(after.open(before.envelope, 'a|p')).toBe('secret')
  })
})
