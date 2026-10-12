import { randomBytes } from 'node:crypto'

// Prefixed, time-sortable ids (for example "chr_01hx...") so a log line or a
// database row says what it is at a glance, and ids sort by creation time.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export type IdPrefix =
  | 'acct' | 'usr' | 'ses' | 'cred' | 'chr' | 'rev' | 'cpt' | 'ast' | 'ref'
  | 'cand' | 'job' | 'jev' | 'led' | 'bud' | 'qte' | 'aud' | 'req'

export function newId(prefix: IdPrefix, now = Date.now()): string {
  let time = ''
  let n = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[n % 32] + time
    n = Math.floor(n / 32)
  }
  let rand = ''
  for (const b of randomBytes(12)) rand += ALPHABET[b & 31]
  return `${prefix}_${time}${rand}`
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
