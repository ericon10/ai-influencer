import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Envelope encryption for per-account provider keys. Each secret gets its own
// random data key (AES-256-GCM); the data key is wrapped with a versioned
// master key. Rotating the master key only rewraps data keys. The additional
// authenticated data binds a ciphertext to its account and provider, so a row
// copied into another account cannot be decrypted. Behind this interface a
// cloud KMS can replace the env master keys later.

export interface Envelope {
  v: 1
  kv: string // master key version
  wk: string // wrapped data key
  wiv: string
  wtag: string
  iv: string
  tag: string
  ct: string
}

export interface KeyVault {
  currentVersion: string
  seal(plaintext: string, aad: string): { keyVersion: string; envelope: string }
  open(envelope: string, aad: string): string
}

function gcmEncrypt(key: Buffer, data: Buffer, aad: Buffer) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(aad)
  const ct = Buffer.concat([c.update(data), c.final()])
  return { iv, tag: c.getAuthTag(), ct }
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, iv)
  d.setAAD(aad)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}

export function parseMasterKeys(spec: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>()
  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(':')
    if (idx < 1) throw new Error('Master key entries must look like "version:base64key".')
    const version = part.slice(0, idx)
    const key = Buffer.from(part.slice(idx + 1), 'base64')
    if (key.length !== 32) throw new Error(`Master key "${version}" must be 32 bytes (base64).`)
    keys.set(version, key)
  }
  if (keys.size === 0) throw new Error('No master keys configured.')
  return keys
}

export function createKeyVault(masterKeysSpec: string): KeyVault {
  const keys = parseMasterKeys(masterKeysSpec)
  const currentVersion = keys.keys().next().value as string
  const b64 = (b: Buffer) => b.toString('base64')
  const unb64 = (s: string) => Buffer.from(s, 'base64')

  return {
    currentVersion,
    seal(plaintext, aad) {
      const master = keys.get(currentVersion)!
      const aadBuf = Buffer.from(aad)
      const dek = randomBytes(32)
      const inner = gcmEncrypt(dek, Buffer.from(plaintext, 'utf8'), aadBuf)
      const wrapped = gcmEncrypt(master, dek, aadBuf)
      const env: Envelope = {
        v: 1, kv: currentVersion,
        wk: b64(wrapped.ct), wiv: b64(wrapped.iv), wtag: b64(wrapped.tag),
        iv: b64(inner.iv), tag: b64(inner.tag), ct: b64(inner.ct),
      }
      return { keyVersion: currentVersion, envelope: JSON.stringify(env) }
    },
    open(envelope, aad) {
      const env = JSON.parse(envelope) as Envelope
      const master = keys.get(env.kv)
      if (!master) throw new Error(`Master key version "${env.kv}" is not configured.`)
      const aadBuf = Buffer.from(aad)
      const dek = gcmDecrypt(master, unb64(env.wiv), unb64(env.wtag), unb64(env.wk), aadBuf)
      return gcmDecrypt(dek, unb64(env.iv), unb64(env.tag), unb64(env.ct), aadBuf).toString('utf8')
    },
  }
}
