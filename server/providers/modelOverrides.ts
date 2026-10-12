import { and, eq } from 'drizzle-orm'
import { accountSettings } from '../db/schema'
import type { Db } from '../db/client'
import type { ModelEntry, StudioConfig } from '../config/load'

// Per-account model confirmation. An owner or admin enters a model's REST
// path from Higgsfield's official Model API Reference; the model counts as
// confirmed only after one small paid test passes. Stored in the account's
// settings, so one account's confirmation never changes another's.

export const MODEL_OVERRIDES_KEY = 'model_overrides'

export interface ModelTestResult { at: string; ok: boolean; message: string; jobId: string }

export interface ModelOverride {
  endpoint?: string
  confirmedAt?: string
  confirmedBy?: string | null
  lastTest?: ModelTestResult
  // The test now running and the endpoint it is testing.
  pendingTest?: { jobId: string; endpoint: string }
}

export type ModelOverrides = Record<string, ModelOverride>

export async function readModelOverrides(db: Db, accountId: string): Promise<ModelOverrides> {
  const [row] = await db.select().from(accountSettings).where(and(eq(accountSettings.accountId, accountId), eq(accountSettings.key, MODEL_OVERRIDES_KEY)))
  return (row?.value as ModelOverrides | undefined) ?? {}
}

export interface EffectiveModel extends ModelEntry {
  endpointSource: 'config' | 'account' | 'none'
  confirmed: boolean
}

export function effectiveModel(entry: ModelEntry, o: ModelOverride | undefined): EffectiveModel {
  const endpoint = o?.endpoint ?? entry.endpoint
  const confirmed = (entry.verified && !!entry.endpoint && !o?.endpoint) || (!!o?.confirmedAt && !!endpoint)
  return { ...entry, endpoint, verified: confirmed, confirmed, endpointSource: o?.endpoint ? 'account' : entry.endpoint ? 'config' : 'none' }
}

export function withModelOverrides(config: StudioConfig, overrides: ModelOverrides): StudioConfig {
  if (!Object.keys(overrides).length) return config
  return { ...config, models: { ...config.models, models: config.models.models.map(m => effectiveModel(m, overrides[m.ref])) } }
}

// A REST path as the reference shows it, for example
// "bytedance/seedance-2.5/image-to-video" or "/v1/text2image/soul". Never a
// full URL: requests only ever go to the Higgsfield API host.
export function isValidEndpoint(path: string): boolean {
  return /^\/?[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i.test(path) && !path.includes('..') && path.length <= 200
}
