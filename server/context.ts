import type { Db } from './db/client'
import type { BlobStore } from './storage/blobStore'
import type { KeyVault } from './lib/vault'
import type { Env } from './lib/env'
import type { Logger } from './lib/logger'
import type { StudioConfig } from './config/load'
import type { ProviderRegistry } from './providers/registry'

export type Role = 'owner' | 'admin' | 'member' | 'viewer'

// Who is acting. Every service call takes one; no query runs without an
// account id, so tenant isolation does not depend on remembering a filter.
export interface Principal {
  accountId: string
  userId: string | null
  role: Role
  email: string
}

export interface Ctx extends Principal {
  requestId: string
  log: Logger
}

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() }

export interface Deps {
  db: Db
  store: BlobStore
  vault: KeyVault
  env: Env
  config: StudioConfig
  providers: ProviderRegistry
  clock: Clock
  log: Logger
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }
export function hasRole(ctx: Principal, min: Role): boolean {
  return RANK[ctx.role] >= RANK[min]
}
