import type { Db } from '../db/client.js'
import type { Ctx, Deps } from '../context.js'
import { getSetting, setSetting } from '../pipeline/settings.js'
import type { GenRequest, HiggsfieldBilling } from './types.js'

// Which Higgsfield balance pays, per account. "api" (the default) is the
// pay-per-use REST API: customers and production. "account" is the owner's
// own Higgsfield account and its plan credits, through the MCP connector.

export const BILLING_KEY = 'higgsfield_billing'

export interface BillingSetting {
  default: HiggsfieldBilling
  // What one plan credit is worth in USD, so credit runs count toward
  // budgets and cost reports. 0 unless the owner sets it.
  creditUsd: number
}

export async function readBilling(db: Db, accountId: string): Promise<BillingSetting> {
  const v = await getSetting<Partial<BillingSetting>>(db, accountId, BILLING_KEY, {})
  return {
    default: v.default === 'account' ? 'account' : 'api',
    creditUsd: typeof v.creditUsd === 'number' && Number.isFinite(v.creditUsd) && v.creditUsd >= 0 ? v.creditUsd : 0,
  }
}

export async function saveBilling(deps: Deps, ctx: Ctx, next: BillingSetting): Promise<void> {
  await setSetting(deps, ctx, BILLING_KEY, next)
}

// Stamps the path into a Higgsfield request when it is quoted, so the quote
// fingerprint covers it: switching the default needs a new estimate, and a
// running job keeps the path it was started on. A model test always uses the
// API, because it confirms an API endpoint.
export async function withBilling(db: Db, accountId: string, req: GenRequest): Promise<GenRequest> {
  if (!req.model.startsWith('higgsfield/')) return req
  const billing: HiggsfieldBilling = req.modelTest ? 'api' : (await readBilling(db, accountId)).default
  return { ...req, billing }
}
