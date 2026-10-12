import type { CharacterIdentity } from './character'

// A character's saved identities (a trained Soul character, an element) and
// what every request that uses one must carry.

// The identity a request to `model` uses: a ready, trained identity made for
// that model (for example the Soul character on Soul).
export function identityForModel(identities: CharacterIdentity[], model: string): CharacterIdentity | undefined {
  return identities.find(i => i.status === 'ready' && i.kind === 'trained' && i.model === model)
}

// Adds the identity's prompt block (for example SOUL IDENTITY) once, at the
// end, so the character does not drift.
export function withIdentityBlock(prompt: string, identity: CharacterIdentity | undefined): string {
  const block = identity?.promptBlock?.trim()
  if (!block || prompt.includes(block)) return prompt
  return `${prompt.trimEnd()} ${block}`
}
