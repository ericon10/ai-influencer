import { describe, expect, it } from 'vitest'
import { identityForModel, withIdentityBlock } from './identity'
import type { CharacterIdentity } from './character'

const soul: CharacterIdentity = { provider: 'higgsfield', kind: 'trained', name: 'Callie', externalId: 'soul-1', status: 'ready', model: 'higgsfield/soul-2', promptBlock: 'Honey-blonde hair, light brown brows.' }
const element: CharacterIdentity = { provider: 'higgsfield', kind: 'element', name: 'Callie-1', externalId: 'el-1', status: 'ready' }

describe('saved identities', () => {
  it('uses the trained identity made for the model, only when it is ready', () => {
    expect(identityForModel([element, soul], 'higgsfield/soul-2')).toBe(soul)
    expect(identityForModel([element, soul], 'higgsfield/gpt-image-2.5')).toBeUndefined()
    expect(identityForModel([{ ...soul, status: 'queued' }], 'higgsfield/soul-2')).toBeUndefined()
  })

  it('adds the prompt block once', () => {
    const once = withIdentityBlock('Chest-up portrait.', soul)
    expect(once).toBe('Chest-up portrait. Honey-blonde hair, light brown brows.')
    expect(withIdentityBlock(once, soul)).toBe(once)
    expect(withIdentityBlock('Chest-up portrait.', undefined)).toBe('Chest-up portrait.')
  })
})
