import { auditLog } from '../db/schema.js'
import type { Db } from '../db/client.js'
import type { Ctx } from '../context.js'
import { newId } from './ids.js'

// Security-relevant actions (keys, budgets, run approvals, logins) are kept
// in an append-only audit trail per account.
export async function audit(db: Db, ctx: Ctx, action: string, target: { type?: string; id?: string } = {}, data: Record<string, unknown> = {}): Promise<void> {
  await db.insert(auditLog).values({
    id: newId('aud'),
    accountId: ctx.accountId,
    userId: ctx.userId,
    action,
    targetType: target.type ?? '',
    targetId: target.id ?? '',
    data,
  })
}
